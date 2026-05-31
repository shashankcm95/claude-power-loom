#!/usr/bin/env node

'use strict';

// PostToolUse:Bash hook — ADVISORY network-egress audit.
//
// Flags Bash commands that appear to reach hosts NOT declared in any persona's
// `network_*` capability trait (the traits-registry allowlist, today just
// `api.anthropic.com`). This is the "audited post-hoc" mechanism the registry's
// `network_anthropic._doc` promises but which did not exist until now.
//
// WHY audit, not prevention (ADR-0012 + the network-egress-audit plan):
//   - Tool-mediated network (WebFetch/WebSearch/MCP) is ALREADY enforced by the
//     harness via agents/<name>.md `tools:` — don't grant the tool, no egress.
//   - Bash-subprocess egress (curl/wget/nc) is the only uncovered vector;
//     `tools:` grants "Bash" wholesale and cannot express "Bash minus curl".
//   - Per-spawn capability injection is INERT (ADR-0012), and PreToolUse:Bash
//     pattern-DENY is evadable theater. So we DETECT + advise, never block.
//
// Forcing-instruction class: 1 (advisory) — same posture as error-critic.js.
// Fail-soft per ADR-0001: any error → exit 0, never disturb the Bash result.
// Non-blocking by construction (PostToolUse).

const fs = require('fs');
const path = require('path');
const { log } = require('../hooks/_lib/_log.js');
const { auditCommand, loadDeclaredHosts } = require('../_lib/network-egress-detect.js');

const logger = log('network-egress-audit');

const REGISTRY_PATH = path.join(
  __dirname, '..', '..', 'runtime', 'contracts', 'traits', '_registry.json',
);
// Fallback when the registry is unreadable — never widen past the canonical
// inference endpoint by accident; an empty allowlist would flag api.anthropic.com.
const DEFAULT_ALLOWLIST = ['api.anthropic.com'];
const MAX_STDIN_BYTES = 10 * 1024 * 1024;

function readStdin() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { return null; }
  if (!raw) return null;
  if (Buffer.byteLength(raw, 'utf8') > MAX_STDIN_BYTES) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function loadAllowlist() {
  try {
    const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    const declared = loadDeclaredHosts(registry);
    return declared.length > 0 ? declared : DEFAULT_ALLOWLIST;
  } catch {
    return DEFAULT_ALLOWLIST;
  }
}

// Sub-agent attribution breadcrumb: an isolation:worktree spawn's Bash runs with
// cwd inside `.claude/worktrees/agent-<id>` (proved by the OQ-21 spike). Surface
// the agentId so future per-persona allowlists can attribute the egress.
function spawnOrigin(cwd) {
  if (typeof cwd === 'string') {
    const m = cwd.match(/\.claude\/worktrees\/(agent-[a-z0-9]+)/i);
    if (m) return { origin: 'sub-agent', agentId: m[1] };
  }
  return { origin: 'main' };
}

function buildAdvisory(hosts, allowlist) {
  const list = hosts.map((h) => `  - ${h}`).join('\n');
  return `\n\n[NETWORK-EGRESS-UNDECLARED]

A Bash command appears to reach host(s) not declared in any persona's network
capability trait (declared allowlist: ${allowlist.join(', ') || '(none)'}):
${list}

This fires AFTER the command ran (PostToolUse) — the egress, if real, has already
occurred; this is a detection signal for follow-up, NOT an interception. It is an
ADVISORY audit (coarse pattern-match, not prevention). If this egress is intended,
add the host to the relevant \`network_*\` trait in
packages/runtime/contracts/traits/_registry.json. If it is unexpected, inspect
the command — a sub-agent may be reaching an undeclared endpoint.

Detection is defense-in-depth, not airtight (see _lib/network-egress-detect.js).
No subprocess LLM was invoked; the deterministic substrate flagged a pattern.

[/NETWORK-EGRESS-UNDECLARED]\n`;
}

function main() {
  const input = readStdin();
  if (!input) return;

  const toolName = input.tool_name || input.toolName;
  if (toolName !== 'Bash') return;

  const toolInput = input.tool_input || input.toolInput || {};
  const command = toolInput.command;
  if (!command || typeof command !== 'string') return;

  try {
    const allowlist = loadAllowlist();
    const verdict = auditCommand(command, allowlist);
    const origin = spawnOrigin(input.cwd || input.workspace);

    if (verdict.undeclaredHosts.length > 0) {
      logger('egress-undeclared', {
        ...origin,
        hosts: verdict.undeclaredHosts,
        command: command.slice(0, 200),
      });
      process.stdout.write(buildAdvisory(verdict.undeclaredHosts, allowlist));
      return;
    }

    if (verdict.egressVerbNoHost) {
      // Low-confidence: an egress verb with no parseable host (e.g. `curl "$URL"`).
      // Log for visibility, do NOT alert (avoids noise on indirected commands).
      logger('egress-verb-no-host', { ...origin, command: command.slice(0, 200) });
    }
  } catch (err) {
    logger('error', { error: err.message });
  }
}

if (require.main === module) main();

module.exports = {
  // Exported for unit/integration tests + the smoke harness.
  buildAdvisory,
  loadAllowlist,
  spawnOrigin,
  REGISTRY_PATH,
  DEFAULT_ALLOWLIST,
};
