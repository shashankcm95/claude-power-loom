#!/usr/bin/env node

// SubagentStop hook — SELF-CORRECTING KB-citation enforcement.
//
// The complement to kb-citation-gate.js (PostToolUse:Agent). #508 made that gate
// SKIP async-launch stubs, because for a background/async spawn PostToolUse only
// ever sees the launch ack (`status:'async_launched'`), never the response — so
// async architect responses went UNENFORCED (a tracked coverage gap). This hook
// closes that gap via the completion event PostToolUse can't substitute for.
//
// FIRSTHAND-PROBED (2026-07-04, isolated `claude -p` spikes):
//   - SubagentStop fires for BOTH sync AND async/background subagents.
//   - Its payload carries the subagent's FINAL message verbatim as the top-level
//     `last_assistant_message` (untruncated at 9.6KB in the one long-reply probe;
//     the truncation boundary, if any, is uncharacterized — a truncated-but-
//     nonempty message would false-block, self-correct once, then yield), and the
//     persona as top-level `agent_type`.
//   - Emitting `{decision:'block', reason}` makes the subagent CONTINUE and
//     address the reason: a KB-less subagent, blocked, re-fired with a
//     `## KB Sources Consulted` heading present, and that revised text reached the
//     parent. So it self-corrects AT SOURCE — better than the PostToolUse
//     parent-block (which needs a cross-spawn re-spawn decision). HONEST SCOPE: the
//     block forces the SECTION SHAPE, not genuine grounding — in the dogfood the
//     subagent CONTESTED the requirement ("the contract doesn't apply here") and
//     added an n/a-style body rather than real `kb:` refs (a live instance of the
//     F6c meta-edit ambiguity: shape-compliant, body-contested). It did NOT
//     fabricate a `kb:` ref that run, but the mechanism cannot guarantee genuine
//     citation — only that the section is present (see the presence-only note in
//     _lib/kb-citation-check.js).
//   - On the block-induced re-fire `stop_hook_active` is `true` (harness 8-block
//     cap, CLAUDE_CODE_STOP_HOOK_BLOCK_CAP). Blocking only when it is NOT `=== true`
//     gives exactly ONE forced self-correction, then yields.
//
// OUTPUT SCHEMA (Stop-class, NOT PostToolUse): allow-stop = `{}` (empty object);
// block = `{decision:'block', reason}`. `{decision:'approve'}` is NOT a valid
// Stop-class value — hence this hook has its OWN emit convention and does not
// reuse kb-citation-gate.js's emit() (architect VERIFY F1).
//
// PERSONA FIELD: SubagentStop carries the type as top-level `agent_type`, NOT
// `tool_input.subagent_type` (which is a PostToolUse shape). Reading the wrong
// field would make this hook silently pass every architect — inert-but-shipped,
// the ADR-0012 failure class (architect VERIFY F2).
//
// Composition with the PostToolUse gate (additive, no double-block): SubagentStop
// is OBSERVED to fire before PostToolUse:Agent (probe 1: 53ms, single sync sample;
// ordering is observed behavior, not a guaranteed contract — monitor before
// treating as load-bearing), so it self-corrects first; PostToolUse then sees the
// corrected response (sync) or skips the stub (async). If self-correction is
// exhausted (stop_hook_active), this hook yields and PostToolUse's sync path is
// the backstop (so the "no double-block" property holds even if the ordering
// ever changes).
//
// Fail-soft per ADR-0001: any error path ALLOWS the stop (`{}`). Never brick a
// subagent close.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { log } = require('../_lib/_log.js');
const { KB_REQUIRED_SUBAGENTS, normalizeSubagentType, isKbCompliant } = require('../_lib/kb-citation-check.js');
const logger = log('kb-citation-subagent-stop');

const LOG_FILE = process.env.LOOM_KB_CITATION_LOG_PATH
  || path.join(os.homedir(), '.claude/checkpoints/kb-citation-log.jsonl');

function readStdin() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); }
  catch (err) { logger('stdin-read-failed', { error: err.message }); return null; }
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch (err) { logger('stdin-parse-failed', { error: err.message }); return null; }
}

// Stop-class emit convention (F1). Allow-stop is an EMPTY object (or exit 0 with
// empty stdout); block carries a reason. `{decision:'approve'}` is deliberately
// never emitted here — it is not a recognized Stop-class value.
function emitAllow() { process.stdout.write('{}\n'); }
function emitBlock(reason) { process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n'); }

function appendLog(entry) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch (err) {
    logger('log-append-failed', { error: err.message });
  }
}

/**
 * Extract the response text from `last_assistant_message`. It is a plain string
 * in the common case, but a final message with tool-use / thinking blocks can be
 * a content-array or a { text } / { content } object. Deliberately duplicated
 * (not shared) per the spawn-record.js precedent — a format-shape helper each
 * hook may evolve. Crucially it does NOT `String()` an object (that yields
 * "[object Object]" → the regex never matches → a false block; architect F6a).
 */
function extractMessageText(msg) {
  if (!msg) return '';
  if (typeof msg === 'string') return msg;
  if (Array.isArray(msg)) {
    return msg.map(c => (c && typeof c === 'object' ? (c.text || c.content || '') : String(c))).join('\n');
  }
  if (typeof msg === 'object') {
    if (typeof msg.text === 'string') return msg.text;
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content.map(c => (c && typeof c === 'object' ? (c.text || '') : String(c))).join('\n');
    }
    return '';
  }
  return String(msg);
}

/**
 * Pure-ish decision (appends an audit-log line as a guarded side effect). Returns
 * `{ block: false }` to allow the stop, or `{ block: true, reason }` to force one
 * self-correction. Exported for unit tests.
 */
function decide(input) {
  if (!input || typeof input !== 'object') return { block: false };

  // Defensive: only act on SubagentStop. A different (or absent) event bails.
  if (input.hook_event_name && input.hook_event_name !== 'SubagentStop') {
    return { block: false };
  }

  // Loop guard (F5): block ONLY on a confirmed-true re-fire. Strict `=== true`
  // so a malformed/absent value falls through to block-eligible — the SAFE
  // direction for a loop guard (at most one extra block, still bounded by the
  // harness 8-block cap), the opposite of the async-stub check's safe direction.
  if (input.stop_hook_active === true) return { block: false };

  // Persona from the top-level `agent_type` (F2), normalized via the shared helper.
  const rawAgentType = input.agent_type || input.agentType || '';
  const agentBase = normalizeSubagentType(rawAgentType);
  if (!KB_REQUIRED_SUBAGENTS.has(agentBase)) return { block: false };

  const message = extractMessageText(input.last_assistant_message);

  // Empty/absent final message = absence-of-data, NOT a violation (F6b). Do not
  // block a subagent that may have legitimately errored out. Log honestly
  // (compliant:null, not false — mirrors #508's null-not-false discipline).
  if (!message) {
    appendLog({
      timestamp: new Date().toISOString(),
      session_id: input.session_id || null,
      agent_id: input.agent_id || null,
      subagent_type: rawAgentType,
      subagent_base: agentBase,
      has_kb_section: null,
      kb_refs_count: null,
      result_length: null,
      compliant: null,
      disposition: 'skip-empty-message',
      event: 'SubagentStop',
    });
    return { block: false };
  }

  const { hasKbSection, kbRefsCount, compliant } = isKbCompliant(message);

  appendLog({
    timestamp: new Date().toISOString(),
    session_id: input.session_id || null,
    agent_id: input.agent_id || null,
    subagent_type: rawAgentType,
    subagent_base: agentBase,
    has_kb_section: hasKbSection,
    kb_refs_count: kbRefsCount,
    result_length: message.length,
    compliant,
    disposition: compliant ? 'subagent-stop-pass' : 'subagent-stop-block',
    event: 'SubagentStop',
  });

  if (compliant) return { block: false };

  // Non-compliant: block → the subagent CONTINUES and appends the section
  // in-place (self-correction at source). The reason is addressed to the
  // SUBAGENT (it will keep working), not the parent.
  return {
    block: true,
    reason: `[KB-CITATION-MISSING] Your ${agentBase} response is missing the required '## KB Sources Consulted' section with at least 1 'kb:' reference (found section=${hasKbSection ? 'yes' : 'no'}, kb_refs=${kbRefsCount}). Per agents/${agentBase}.md Output Contract (H.9.20.0), append this section now: a '## KB Sources Consulted' heading followed by the 'kb:<id>' references you actually consulted, before finishing.`,
  };
}

function main() {
  // Fail-soft (ADR-0001): compute the decision under a guard; ANY throw allows
  // the stop. Exactly one emit happens.
  let decision = { block: false };
  try {
    decision = decide(readStdin());
  } catch (err) {
    logger('subagent-stop-threw', { error: err.message });
    decision = { block: false };
  }
  if (decision.block) emitBlock(decision.reason);
  else emitAllow();
}

if (require.main === module) main();

module.exports = { __test__: { decide, extractMessageText } };
