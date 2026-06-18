#!/usr/bin/env node

// PreToolUse:Agent|Task hook — OBSERVABILITY ONLY (records which contract
// reminder WOULD apply to each persona spawn). It does NOT enforce anything.
//
// HISTORY + WHY THIS IS NOT AN ENFORCER (ADR-0012):
//   This hook was authored (GAP-E, 2026-05-21) to deterministically enforce
//   per-persona output contracts by mutating the sub-agent prompt via
//   `hookSpecificOutput.updatedInput.prompt`. ADR-0012 (accepted 2026-05-31)
//   then proved EMPIRICALLY (two `claude -p` probes) that a PreToolUse hook's
//   `updatedInput` is INERT on Agent/Task spawns — the sub-agent runs its
//   ORIGINAL prompt; the rewrite is never honored. Capability/prompt injection
//   at spawn time does not exist; enforcement is STATIC (the persona's
//   `agents/<name>.md` body + the reconciliation validator). The sibling
//   `pre-spawn-tool-mask` hook was unregistered for exactly this reason.
//
//   So this hook no longer emits `updatedInput` (it would be a no-op that also
//   writes a misleading "new_prompt_len" audit line implying a mutation took
//   effect). It now passes through (`emit({})`) and only appends an
//   observability record of which reminder maps to the spawned persona.
//
//   Compliance is actually observed post-hoc by kb-citation-gate.js
//   (PostToolUse:Agent → ~/.claude/checkpoints/kb-citation-log.jsonl). This
//   hook is therefore a candidate for full removal (its CONTRACT_REMINDERS map
//   could move to documentation); it is kept for now as a low-cost spawn-time
//   observability signal. Removing it also requires de-registering it in
//   packages/kernel/hooks.json.
//
// SEPARATION OF CONCERNS: route-decide-on-agent-spawn.js (also PreToolUse:Agent)
//   handles route-decide consultation + logging; both co-exist on the matcher
//   and fire in registration order.
//
// FAIL-SOFT per ADR-0001: any error path passes through with no mutation.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { log } = require('../_lib/_log.js');
const logger = log('contract-reminder-on-agent-spawn');

const LOG_FILE = path.join(os.homedir(), '.claude/checkpoints/contract-reminder-log.jsonl');

// Map of subagent_type → contract-reminder text to prepend to the prompt.
// Plugin-prefixed names ("power-loom:architect") are normalized via `:` split.
//
// Each reminder is a self-contained instruction block the sub-agent will see
// at the very top of its task. Keep it concise — every byte costs the
// sub-agent's input tokens.
// Shared format reminders to avoid drift across agent reminders.
//
// NB: do NOT include `kb:`-formatted strings as "do not cite" examples here —
// observed behavior 2026-05-21: model literally cited `kb:my-rules/foo` because
// it appeared kb:-formatted in the reminder text. Use parenthetical descriptions
// instead of concrete `kb:`-strings for the warning.
const VALID_KB_FORMAT = [
  'Use the CANONICAL kb_id format from your definition file:',
  '  - format: `kb:<topic>/<doc>` (NOT a filesystem path with a `kb:` prefix)',
  '  - the topic AND the doc must exist in the kb index in your definition',
  '  - do NOT invent kb_ids; if no fitting ref exists in the index, that is a smell',
].join('\n');

const CONTRACT_REMINDERS = {
  // architect — trailing `## KB Sources Consulted` section (+ optional Requirements Checklist)
  architect: [
    '[CONTRACT-REMINDER — H.9.20.0 + bench-GAP-E — HARD CONTRACT]',
    '',
    'Your response MUST end with a `## KB Sources Consulted` section listing',
    '≥2 VALID `kb:<id>` references. ' + VALID_KB_FORMAT,
    '',
    'Examples of VALID kb refs for architect:',
    '  - `kb:architecture/crosscut/single-responsibility`',
    '  - `kb:architecture/crosscut/information-hiding`',
    '  - `kb:architecture/discipline/error-handling-discipline`',
    '  - `kb:architecture/discipline/stability-patterns`',
    '  - `kb:hets/symmetric-pair-conventions`',
    '',
    'If the task enumerates ≥2 explicit requirements, ALSO include a',
    '`## Requirements Checklist` section listing each one with disposition',
    '(ADDRESSED / DEFERRED / REJECTED).',
    '',
    'These sections are a HARD CONTRACT. Omitting them OR using invalid',
    'kb_id formats is a contract violation that the bench harness and',
    'downstream reviewers will detect.',
    '',
    '--- ORIGINAL TASK ---',
    '',
  ].join('\n'),

  // code-reviewer — INLINE per-finding kb citations (different shape; no trailing section)
  'code-reviewer': [
    '[CONTRACT-REMINDER — code-reviewer output contract — HARD CONTRACT]',
    '',
    'Each PRINCIPLE-severity finding MUST cite a specific kb doc inline.',
    'Each CRITICAL-severity finding MUST cite the kb-security-dev doc that',
    'names the vulnerability class. Findings without kb citation get tagged',
    '`[needs-kb-cite]` rather than being silently dropped.',
    '',
    VALID_KB_FORMAT,
    '',
    'Examples of VALID kb refs for code-reviewer:',
    '  - PRINCIPLE: `kb:architecture/crosscut/single-responsibility` (SRP)',
    '  - PRINCIPLE: `kb:architecture/crosscut/information-hiding` (leaky abstraction)',
    '  - PRINCIPLE: `kb:architecture/crosscut/idempotency` (replay-safety)',
    '  - HIGH:      `kb:architecture/discipline/error-handling-discipline`',
    '  - HIGH:      `kb:architecture/discipline/stability-patterns` (fault isolation)',
    '  - CRITICAL:  `kb:security-dev/auth-patterns` (auth bypass, weak hashing)',
    '  - CRITICAL:  `kb:security-dev/threat-modeling-essentials`',
    '',
    'Inline format example:',
    '  `[PRINCIPLE] kb:architecture/crosscut/single-responsibility / handler does',
    '   parsing + validation + dispatch (3 concerns)`',
    '',
    'Your response must also include a final verdict line:',
    '  `Verdict: APPROVE | APPROVE-WITH-NITS | REQUEST-CHANGES | BLOCK`',
    '',
    'Omitting kb citations on PRINCIPLE/CRITICAL findings OR using invalid',
    'kb_id formats is a contract violation downstream reviewers will detect.',
    '',
    '--- ORIGINAL TASK ---',
    '',
  ].join('\n'),

  // security-auditor — INLINE per-finding kb:security-dev/* citations + severity discipline
  'security-auditor': [
    '[CONTRACT-REMINDER — security-auditor output contract — HARD CONTRACT]',
    '',
    'Each CRITICAL / HIGH finding MUST cite the specific kb doc that names',
    'the vulnerability class. Findings without kb citation get tagged',
    '`[needs-kb-cite]` rather than being silently dropped.',
    '',
    VALID_KB_FORMAT,
    '',
    'Examples of VALID kb refs for security-auditor:',
    '  - `kb:security-dev/auth-patterns` — auth bypass, weak hashing',
    '  - `kb:security-dev/threat-modeling-essentials` — missing-mitigation',
    '  - `kb:security-dev/input-validation` — injection, XSS, SSRF',
    '  - `kb:security-dev/secrets-management` — hardcoded secrets, key rotation',
    '  - `kb:architecture/discipline/error-handling-discipline` — info-leakage',
    '',
    'Inline format example:',
    '  `[CRITICAL] kb:security-dev/auth-patterns / SQL injection via string',
    '   concatenation at file.js:42`',
    '',
    'Findings must be categorized by severity: CRITICAL / HIGH / MEDIUM / LOW.',
    '',
    'Omitting kb citations on CRITICAL/HIGH findings OR using invalid kb_id',
    'formats is a contract violation downstream reviewers will detect.',
    '',
    '--- ORIGINAL TASK ---',
    '',
  ].join('\n'),

  // planner — `## Principle Audit` section + kb-anchored phase rationale
  planner: [
    '[CONTRACT-REMINDER — planner output contract (H.7.22/H.7.24) — HARD CONTRACT]',
    '',
    'Every plan output MUST include a `## Principle Audit` section mapping',
    'concrete plan decisions to the foundational principles they uphold or',
    'trade off: SOLID, DRY, KISS, YAGNI.',
    '',
    'Phase rationale should anchor to kb docs. ' + VALID_KB_FORMAT,
    '',
    'Examples of VALID kb refs for planner:',
    '  - `kb:architecture/discipline/trade-off-articulation` — surface phase options',
    '  - `kb:architecture/crosscut/single-responsibility` — phase boundaries respect SRP',
    '  - `kb:architecture/discipline/error-handling-discipline` — failure paths',
    '  - `kb:architecture/discipline/refusal-patterns` — push back vs accommodate',
    '  - `kb:architecture/discipline/reliability-scalability-maintainability` — phase ordering',
    '  - `kb:architecture/discipline/stability-patterns` — rollback per phase',
    '  - `kb:hets/spawn-conventions` — for HETS-routed plans',
    '',
    'For HETS-routed plans (route-decide → `route`), the plan must also',
    'contain a `## HETS Spawn Plan` section (non-N/A) AND a `Routing Decision`',
    'JSON block. The plan-schema validator enforces this at PostToolUse.',
    '',
    'Omitting the Principle Audit OR using invalid kb_id formats is a',
    'contract violation downstream validators will detect.',
    '',
    '--- ORIGINAL TASK ---',
    '',
  ].join('\n'),

  // optimizer — trailing `## KB Sources Consulted` section (same shape as architect)
  optimizer: [
    '[CONTRACT-REMINDER — optimizer output contract — HARD CONTRACT]',
    '',
    'The Optimization Report MUST end with a `## KB Sources Consulted` section',
    'citing ≥2 specific `kb:<id>` refs that grounded the tuning decisions.',
    '',
    VALID_KB_FORMAT,
    '',
    'Examples of VALID kb refs for optimizer:',
    '  - `kb:architecture/discipline/reliability-scalability-maintainability` — RSM framing',
    '  - `kb:architecture/discipline/stability-patterns` — fault-isolation preservation',
    '  - `kb:infra-dev/observability-basics` — measure-before-optimize',
    '  - `kb:architecture/ai-systems/inference-cost-management` — token + latency budgeting',
    '  - `kb:hets/spawn-conventions` — spawn-cost tradeoffs',
    '',
    'Omitting the section OR using invalid kb_id formats is a contract',
    'violation downstream reviewers will detect.',
    '',
    '--- ORIGINAL TASK ---',
    '',
  ].join('\n'),
};

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

function main() {
  const input = readStdin();
  if (!input) {
    emit({});
    return;
  }

  const toolName = input.tool_name || input.toolName;
  const toolInput = input.tool_input || input.toolInput || {};

  // Only act on sub-agent spawn tools (Agent in v2.x; Task in v1.x for compat).
  if (toolName !== 'Agent' && toolName !== 'Task') {
    emit({});
    return;
  }

  // Normalize plugin-prefixed subagent_type names (e.g. "power-loom:architect"
  // → "architect"). Spawn dispatch sometimes carries the prefix, sometimes not.
  const rawSubagentType = (toolInput.subagent_type || toolInput.subagent || toolInput.type || '').toLowerCase();
  const subagentBase = rawSubagentType.includes(':')
    ? rawSubagentType.split(':').pop()
    : rawSubagentType;

  const reminder = CONTRACT_REMINDERS[subagentBase];
  if (!reminder) {
    // No contract for this subagent type — pass through unchanged.
    emit({});
    return;
  }

  const originalPrompt = toolInput.prompt || '';

  // Observability only: record which contract reminder maps to this persona
  // spawn. We do NOT mutate the prompt — `updatedInput` is inert on Agent/Task
  // spawns (ADR-0012), so emitting it would be a no-op plus a misleading audit
  // trail. Post-hoc compliance is observed by kb-citation-gate.js.
  appendLog({
    timestamp: new Date().toISOString(),
    session_id: input.session_id || input.sessionId || null,
    tool_use_id: input.tool_use_id || input.toolUseId || null,
    subagent_type: rawSubagentType,
    subagent_base: subagentBase,
    original_prompt_len: originalPrompt.length,
    reminder_len: reminder.length,
    applied: false,
    reason: 'updatedInput-inert-on-agent-spawn (ADR-0012); observability-only',
  });

  // Pass through unchanged (no inert mutation).
  emit({});
}

main();
