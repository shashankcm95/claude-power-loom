#!/usr/bin/env node

// PostToolUse:Agent|Task hook — enforces KB citation contract on sub-agent results.
//
// GAP-D fix (caught by bench harness 2026-05-20). The GAP-A architect.md
// fix added a "## KB Sources Consulted (H.9.20.0, mandatory)" output contract
// to the architect agent's definition. Bench evidence over 3 runs showed
// instruction-following variance: 2 of 3 runs honored the contract, 1 didn't.
// "MUST include" text doesn't bind reliably.
//
// This hook makes KB citation enforcement DETERMINISTIC by:
//
//   1. Reading the PostToolUse payload (tool name + input + response)
//   2. If tool is Agent/Task AND subagent_type is in KB_REQUIRED_SUBAGENTS:
//      a. Extract the sub-agent's reply text
//      b. Check for both: ## KB Sources Consulted section AND ≥1 kb: ref
//      c. If non-compliant: emit decision=block with a [KB-CITATION-MISSING]
//         forcing instruction that tells the parent to re-spawn or note
//         the analysis is incomplete
//      d. If compliant: emit decision=approve
//   3. Always logs verdicts to ~/.claude/checkpoints/kb-citation-log.jsonl
//      for cross-run analysis
//
// Block-and-retry pattern: same shape as verify-plan-gate.js. The parent
// Claude sees the [KB-CITATION-MISSING] forcing instruction and decides
// whether to re-spawn the agent or proceed treating the response as
// incomplete. No infinite loop risk because the parent has agency over
// the next move (re-spawn vs proceed-with-caveat).
//
// Currently scoped to ONE persona (architect) because it's the only agent
// with the trailing-section contract. code-reviewer + security-auditor use
// per-finding inline citations (different pattern; not enforced here).
//
// Fail-soft per ADR-0001: any error path approves anyway. Better to miss
// enforcement than to block the session on hook failures.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { log } = require('../_lib/_log.js');
const logger = log('kb-citation-gate');

// Overridable log path (mirrors the LOOM_<THING>_PATH override convention of the
// sibling kernel hooks). Lets tests point the append at a temp file so they stay
// hermetic instead of polluting the real ~/.claude/checkpoints log.
const LOG_FILE = process.env.LOOM_KB_CITATION_LOG_PATH
  || path.join(os.homedir(), '.claude/checkpoints/kb-citation-log.jsonl');

// Subagents that MUST include `## KB Sources Consulted` section per their
// definition's output contract. Plugin-prefixed names (power-loom:architect)
// are normalized via the `:` split before lookup.
const KB_REQUIRED_SUBAGENTS = new Set(['architect']);

function readStdin() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); }
  catch (err) { logger('stdin-read-failed', { error: err.message }); return null; }
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch (err) { logger('stdin-parse-failed', { error: err.message }); return null; }
}

function emit(decision) {
  process.stdout.write(JSON.stringify(decision) + '\n');
}

function appendLog(entry) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch (err) {
    logger('log-append-failed', { error: err.message });
  }
}

/**
 * Extract a single string from the various tool_response shapes Claude
 * Code uses across versions: plain string, array of content blocks, or
 * { text: "..." } object.
 */
function extractResultText(toolResponse) {
  if (!toolResponse) return '';
  if (typeof toolResponse === 'string') return toolResponse;
  if (Array.isArray(toolResponse)) {
    return toolResponse
      .map(c => (c && typeof c === 'object' ? (c.text || c.content || '') : String(c)))
      .join('\n');
  }
  if (typeof toolResponse === 'object') {
    if (typeof toolResponse.text === 'string') return toolResponse.text;
    if (typeof toolResponse.content === 'string') return toolResponse.content;
    if (Array.isArray(toolResponse.content)) {
      return toolResponse.content
        .map(c => (c && typeof c === 'object' ? (c.text || '') : String(c)))
        .join('\n');
    }
    return JSON.stringify(toolResponse);
  }
  return String(toolResponse);
}

/**
 * Detect the ASYNC-LAUNCH STUB the harness returns as the IMMEDIATE tool_response
 * when an Agent/Task is launched in the background. (Per the Claude Code sub-agents
 * doc — external, not repo-probed — background launch is now the default; the STUB
 * SHAPE below is what is firsthand-verified against on-disk spawn-state, distinct
 * from any doc-sourced version claim.)
 *
 * The stub is a structured launch ACKNOWLEDGMENT, not the agent's response:
 *   { isAsync: true, status: 'async_launched', agentId, description,
 *     resolvedModel, prompt: <full prompt echoed>, outputFile, canReadOutputFile }
 * It carries no `.text`/`.content`, so extractResultText() falls through to
 * JSON.stringify(obj) — a 3-8KB blob dominated by the echoed prompt that never
 * contains `## KB Sources Consulted`, so the gate blocked EVERY async architect
 * spawn (a 100% false positive). The agent's real response is delivered
 * out-of-band via a task-notification and does NOT re-fire PostToolUse:Agent
 * (firsthand-verified 2026-07-04: 193 async-launch agentIds, 0 completion
 * re-fires). So this hook cannot see the response here — it must not block.
 * Restoring async enforcement is a tracked SubagentStop follow-up (its payload is
 * undocumented + inferred advisory-only; building block-enforcement on it now
 * would be the ADR-0012 assumed-harness-mechanism trap).
 *
 * Discriminator: `status === 'async_launched'` is unique to the launch stub — a
 * COMPLETED spawn carries `status === 'completed'` (per spawn-close-resolver), so
 * this never false-skips a completed response we could evaluate. The strict
 * `isAsync === true` branch is a DEFENSIVE fallback for an unobserved future stub
 * that might drop `status`; the only shape actually probed carries both fields.
 * It costs nothing: no completed-response shape (string / {content:[…]} / {text})
 * carries an `isAsync` field. Strict `=== true` (not truthy) is deliberate — it
 * refuses to skip on a garbage `isAsync: 'false'` / `isAsync: 1`, failing toward
 * the safe direction (evaluate rather than skip when the flag is malformed).
 */
function isAsyncLaunchStub(toolResponse) {
  if (!toolResponse || typeof toolResponse !== 'object' || Array.isArray(toolResponse)) {
    return false;
  }
  return toolResponse.status === 'async_launched' || toolResponse.isAsync === true;
}

function main() {
  const input = readStdin();
  if (!input) {
    emit({ decision: 'approve' });
    return;
  }

  const toolName = input.tool_name || input.toolName;
  const toolInput = input.tool_input || input.toolInput || {};
  const toolResponse = input.tool_response || input.toolResponse || input.tool_result || input.toolResult;

  // Only act on sub-agent spawn tools.
  if (toolName !== 'Agent' && toolName !== 'Task') {
    emit({ decision: 'approve' });
    return;
  }

  const rawSubagentType = (toolInput.subagent_type || toolInput.subagent || toolInput.type || '').toLowerCase();
  // Normalize plugin-prefixed names: "power-loom:architect" → "architect"
  const subagentBase = rawSubagentType.includes(':')
    ? rawSubagentType.split(':').pop()
    : rawSubagentType;

  if (!KB_REQUIRED_SUBAGENTS.has(subagentBase)) {
    emit({ decision: 'approve' });
    return;
  }

  // Async-launch stub: the harness fired PostToolUse at LAUNCH with a launch-ack
  // object, not the agent's response (which arrives out-of-band via a
  // task-notification and never re-fires this hook). We cannot evaluate a
  // response we cannot see — approve, but RECORD the coverage gap so it stays
  // auditable rather than silent (the failure mode that made blocking-on-the-stub
  // and silent-skip both wrong). Placed AFTER the KB-required gate so non-KB
  // personas exit via the pass-through above (keeps this disposition scoped to
  // KB-contracted personas), and BEFORE extractResultText so we never stringify
  // an 8KB launch-ack we are about to skip. See isAsyncLaunchStub() for rationale.
  if (isAsyncLaunchStub(toolResponse)) {
    appendLog({
      timestamp: new Date().toISOString(),
      session_id: input.session_id || input.sessionId || null,
      tool_use_id: input.tool_use_id || input.toolUseId || null,
      subagent_type: rawSubagentType,
      subagent_base: subagentBase,
      // null (not false/0): the response was NOT evaluated — it was not observable
      // here. false/0 would dishonestly read as "evaluated, found none".
      has_kb_section: null,
      kb_refs_count: null,
      result_length: null,
      compliant: null,
      disposition: 'skip-async-launch-stub',
    });
    emit({ decision: 'approve' });
    return;
  }

  const resultText = extractResultText(toolResponse);
  // v2.7.1 regex update: accept an optional numbered structural prefix
  // (`## 7. KB Sources Consulted`) — observed three times in 2026-05-21
  // architect dispatches (v2.6.0 ship + GAP-H + SynthId design) where
  // canonical kb refs WERE produced but the heading carried a numbered
  // prefix. Also tightens the line anchor: `^##\s+` rejects `### KB Sources
  // Consulted` (h3) which the prior unanchored pattern accidentally matched
  // via substring (pre-existing bug surfaced by T4).
  const hasKbSection = /^##\s+(?:\d+\.\s*)?KB Sources Consulted/im.test(resultText);
  const kbRefs = resultText.match(/kb:[a-z][a-z0-9\-/]+/gi) || [];
  const compliant = hasKbSection && kbRefs.length >= 1;

  appendLog({
    timestamp: new Date().toISOString(),
    session_id: input.session_id || input.sessionId || null,
    tool_use_id: input.tool_use_id || input.toolUseId || null,
    subagent_type: rawSubagentType,
    subagent_base: subagentBase,
    has_kb_section: hasKbSection,
    kb_refs_count: kbRefs.length,
    result_length: resultText.length,
    compliant,
  });

  if (compliant) {
    emit({ decision: 'approve' });
    return;
  }

  // Non-compliant: block + emit a forcing instruction. The parent Claude
  // sees the reason on its next turn and decides: re-spawn with explicit
  // KB reminder, OR proceed treating this analysis as incomplete.
  emit({
    decision: 'block',
    reason: `[KB-CITATION-MISSING] The ${subagentBase} sub-agent response did not include the required '## KB Sources Consulted' section with at least 1 'kb:' reference (found section=${hasKbSection ? 'yes' : 'no'}, kb_refs=${kbRefs.length}). Per agents/${subagentBase}.md Output Contract (H.9.20.0), every ${subagentBase} response MUST end with this section. EITHER: (a) re-spawn the ${subagentBase} agent with explicit instruction "your response MUST include the ## KB Sources Consulted section per H.9.20.0", OR (b) proceed but note in your reasoning that this analysis is INCOMPLETE — kb grounding was not verified.`,
  });
}

main();
