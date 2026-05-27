#!/usr/bin/env node

// packages/kernel/hooks/pre/pre-spawn-tool-mask.js
//
// **THE ONE THING** — per v6 §6.5 Round-3d additions (5-persona pair-review C2).
//
// v6 spec anchors:
//   §6.5 v3.0-alpha Round-3d additions — "pre-spawn-tool-mask.js hook (NEW per
//                                         persona-Sam S4 + Round-3d C2 —
//                                         THE ONE THING)"
//   §6.5.2 K9 rollback scope — confirms v3.0-alpha forbids network-side-effecting
//                              tools entirely; this hook is the kernel-layer
//                              enforcement (replaces honor-system persona-contract
//                              discipline that was the §2.4 "enforce, not document"
//                              anti-pattern)
//   §0a Pillar 2 — Byzantine treatment of LLM (this hook IS the Pillar-2
//                  enforcement boundary for v3.0-alpha before K6/K8 ship in v3.1)
//   §0.v6 IS NOT — "v3.0-alpha does NOT defend against local filesystem tampering"
//                  (this hook is in-scope; tamper-evidence is OQ-20 deferred)
//
// Why this exists:
//   Per the 5-persona implementation pair-review (Maya/Jordan/Alex/Sam/Tess —
//   commit 09ba3c6), Sam (Security/SRE) identified that v3.0-alpha's
//   network-prohibition was honor-system: §6.5.2 said "enforced via persona
//   contracts + audit" which is Pillar-4 TDD/role-separation discipline, NOT
//   Pillar-2 Byzantine-treatment-of-LLM enforcement. The 5 prior SPEC reviewers
//   (Gemini Flash + GPT + Gemini 3.1 Pro + internal architect + internal
//   honesty-auditor) all missed this because spec review reads the line as a
//   documented constraint. Implementation pair-review caught it.
//
// What this hook does (in scope):
//   - Runs as PreToolUse:Agent|Task hook (registered in packages/kernel/hooks.json)
//   - Reads hook input JSON from stdin
//   - If tool_name is 'Task' or 'Agent', inspects tool_input.tools array (when present)
//   - STRIPS network-side-effecting tools, regardless of persona contract:
//       * WebFetch, WebSearch
//       * MCP tools matching `mcp__*`
//       * Bash patterns matching `curl|wget|gh|aws|nc|ssh|http`
//   - Emits updated tool_input via `updatedInput` JSON response
//   - Logs Class-4 audit event with strip-count
//   - Fail-soft per ADR-0001: any error → exit 0 with unchanged input
//
// What this hook does NOT do (deferred):
//   - K6 full capability subset check (v3.1) — narrower-grained per-persona
//   - K8 capability injection (v3.1) — replaces this hook when shipped
//   - R13 idempotency keys (v3.1) — when network tools become permitted
//
// Composes with: v3.1 K8 (when K8 ships, K8 owns the spawn-init `updatedInput`
// surface exclusively per Wave -1 P-HookChain finding; this hook becomes a thin
// `K8.preMask()` call OR is deleted entirely once K8 narrows capability properly).
//
// PR scope: ~30-50 LoC per Round-3d C1 K2 reservation envelope. Implementation
// at ~140 LoC including audit-event emission + bash-pattern matcher.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Tools to strip wholesale by name. Network-side-effecting + no read-only mode.
 */
const STRIP_TOOL_NAMES = new Set(['WebFetch', 'WebSearch']);

/**
 * MCP tool name prefix. All MCP tools potentially side-effecting; v3.0-alpha
 * forbids ALL of them (v3.1 K6 may narrow this with per-MCP allow/deny lists).
 */
const MCP_PREFIX = 'mcp__';

/**
 * Bash command patterns that indicate network side effects.
 *
 * Matches a Bash command if the FIRST word matches these patterns OR if the
 * command line contains them as a discrete word (pipe-chained, shell-redirected,
 * etc.). Conservative — false positives are preferred over false negatives at
 * the v3.0-alpha network-prohibition gate.
 */
const NETWORK_BASH_PATTERNS = [
  /\bcurl\b/,
  /\bwget\b/,
  /\bgh\b/,
  /\baws\b/,
  /\bnc\b/,
  /\bssh\b/,
  /\bscp\b/,
  /\bhttp(?:ie)?\b/,
  /\bnpm\s+(install|publish|i\b)/,  // npm install can fetch packages
  /\bpnpm\s+(install|publish|add)/,
  /\byarn\s+(install|add|publish)/,
  /\bpip\s+install/,
];

function isNetworkBashCommand(command) {
  if (typeof command !== 'string') return false;
  return NETWORK_BASH_PATTERNS.some((pat) => pat.test(command));
}

/**
 * Read all of stdin synchronously (hook input pattern matches existing hooks).
 */
function readStdinSync() {
  try {
    const data = fs.readFileSync(0, 'utf8');
    return data;
  } catch {
    return '';
  }
}

/**
 * Audit log destination. Same path as other Class-4 events; written via
 * append-only JSONL.
 */
function auditLogPath() {
  return path.join(os.homedir(), '.claude', 'checkpoints', 'pre-spawn-tool-mask-log.jsonl');
}

function logAuditEvent(event) {
  try {
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      class: 4,
      kind: 'pre-spawn-tool-mask-applied',
      ...event,
    });
    const logPath = auditLogPath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, entry + '\n');
  } catch {
    // Audit-log failure is non-blocking; fail-soft per ADR-0001.
  }
}

/**
 * Apply the tool mask to a tools array. Returns:
 *   { masked: <new array>, stripped: <array of dropped entries> }
 */
function applyMask(tools) {
  if (!Array.isArray(tools)) return { masked: tools, stripped: [] };
  const masked = [];
  const stripped = [];

  for (const tool of tools) {
    let toolName;
    let toolDetail;

    if (typeof tool === 'string') {
      toolName = tool;
      toolDetail = tool;
    } else if (tool && typeof tool === 'object') {
      toolName = tool.name || tool.tool_name || tool.type || '';
      toolDetail = tool;
    } else {
      // Pass through unknown shapes (fail-soft).
      masked.push(tool);
      continue;
    }

    // Strip by name match.
    if (STRIP_TOOL_NAMES.has(toolName)) {
      stripped.push({ reason: 'name-strip', tool: toolDetail });
      continue;
    }

    // Strip by MCP prefix.
    if (typeof toolName === 'string' && toolName.startsWith(MCP_PREFIX)) {
      stripped.push({ reason: 'mcp-strip', tool: toolDetail });
      continue;
    }

    // Strip Bash entries with network command patterns.
    if (toolName === 'Bash' || toolName.startsWith('Bash(')) {
      // If toolName carries embedded pattern (e.g., "Bash(curl:*)"), check it.
      if (isNetworkBashCommand(toolName)) {
        stripped.push({ reason: 'bash-network-pattern', tool: toolDetail });
        continue;
      }
      // If tool is an object with embedded command, check it.
      if (typeof tool === 'object' && tool.command && isNetworkBashCommand(tool.command)) {
        stripped.push({ reason: 'bash-network-pattern', tool: toolDetail });
        continue;
      }
    }

    // Pass through.
    masked.push(tool);
  }

  return { masked, stripped };
}

function main() {
  let hookInput;
  try {
    const raw = readStdinSync();
    if (!raw || raw.trim().length === 0) {
      process.exit(0);
      return;
    }
    hookInput = JSON.parse(raw);
  } catch {
    // Malformed input → fail-soft (exit 0 with no output).
    process.exit(0);
    return;
  }

  const toolName = hookInput.tool_name;
  const toolInput = hookInput.tool_input;

  // Only act on Agent or Task tool calls. Other tools (Read/Edit/Write/Grep/etc.)
  // are not delegating to a sub-agent; this hook has no business modifying them.
  if (toolName !== 'Agent' && toolName !== 'Task') {
    process.exit(0);
    return;
  }

  // The Agent/Task tool's input may carry an explicit `tools` array; if present,
  // mask it. Some Anthropic plugin sub-agent forms don't expose tools as a
  // first-class array — in that case, mask is a no-op (the sub-agent inherits
  // parent capabilities and Pillar-2 enforcement must move to K8 in v3.1).
  let updatedToolInput = toolInput;
  let stripped = [];

  if (toolInput && Array.isArray(toolInput.tools)) {
    const result = applyMask(toolInput.tools);
    if (result.stripped.length > 0) {
      updatedToolInput = { ...toolInput, tools: result.masked };
      stripped = result.stripped;
    }
  }

  if (stripped.length > 0) {
    logAuditEvent({
      tool_name: toolName,
      stripped_count: stripped.length,
      stripped_reasons: stripped.map((s) => s.reason),
      subagent_type: toolInput && toolInput.subagent_type ? toolInput.subagent_type : null,
    });

    // Emit updatedInput response per Claude Code hook protocol.
    process.stdout.write(
      JSON.stringify({
        decision: 'allow',
        updatedInput: updatedToolInput,
      })
    );
  }

  process.exit(0);
}

// Run main only when invoked directly, not when required as a module (tests).
if (require.main === module) {
  try {
    main();
  } catch {
    // Top-level fail-soft per ADR-0001.
    process.exit(0);
  }
}

module.exports = {
  applyMask,
  isNetworkBashCommand,
  STRIP_TOOL_NAMES,
  MCP_PREFIX,
  NETWORK_BASH_PATTERNS,
  // exposed for testing only:
  _auditLogPath: auditLogPath,
};
