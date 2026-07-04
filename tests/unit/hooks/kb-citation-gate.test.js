#!/usr/bin/env node

// tests/unit/hooks/kb-citation-gate.test.js
//
// v2.7.1 — regression guard for kb-citation-gate.js heading detection.
//
// HISTORY: the gate's regex `##\s*KB Sources Consulted` (v2.4.x..v2.7.0)
// over-fired three times during architect dispatches in 2026-05-21:
//   - v2.6.0 ship architect → numbered "### 7. KB Sources Consulted"
//   - GAP-H architect → also tripped
//   - SynthId design architect → "## 7. KB Sources Consulted" with 8 valid refs
// In all three cases architects WERE producing canonical `kb:topic/doc` refs;
// the gate was tripping on harmless numbered structural prefixes.
//
// v2.7.1 fix: accept an optional numbered prefix in the heading
// (`## 7. KB Sources Consulted`). Still rejects:
//   - non-h2 headings (### or # — contract preserved)
//   - missing section
//   - section present but zero kb: refs
//
// TDD-treatment: tests first (this file), then regex change in
// packages/kernel/hooks/post/kb-citation-gate.js. Initial run vs v2.7.0: numbered-prefix
// tests FAIL; canonical-form tests PASS.

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const HOOK = path.resolve(__dirname, '../../../packages/kernel/hooks/post/kb-citation-gate.js');

// Hermetic log path: the gate honors LOOM_KB_CITATION_LOG_PATH, so every runGate
// call appends here instead of the real ~/.claude/checkpoints/kb-citation-log.jsonl
// (closes a pre-existing test-hygiene leak) AND lets us assert the skip-path audit
// record. PID-scoped so parallel test processes don't collide.
const TEST_LOG = path.join(os.tmpdir(), `kb-citation-gate-test-${process.pid}.jsonl`);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`  PASS ${name}\n`);
    passed++;
  } catch (err) {
    process.stdout.write(`  FAIL ${name}: ${err.message}\n`);
    failed++;
  }
}

function clearTestLog() {
  if (fs.existsSync(TEST_LOG)) fs.unlinkSync(TEST_LOG);
}

/** Last JSON line appended to the hermetic test log (null if none). */
function lastLogEntry() {
  if (!fs.existsSync(TEST_LOG)) return null;
  const lines = fs.readFileSync(TEST_LOG, 'utf8').trim().split('\n').filter(Boolean);
  return lines.length ? JSON.parse(lines[lines.length - 1]) : null;
}

/**
 * Run kb-citation-gate against a synthetic Claude Code envelope.
 * @param {object} envelope - hook input
 * @returns {{decision: 'approve'|'block', reason?: string}}
 */
function runGate(envelope) {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(envelope),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_HOOKS_QUIET: '1', LOOM_KB_CITATION_LOG_PATH: TEST_LOG },
  });
  if (r.status !== 0) {
    throw new Error(`gate exited non-zero: status=${r.status}, stderr=${r.stderr}`);
  }
  try {
    return JSON.parse(r.stdout || '{}');
  } catch (e) {
    throw new Error(`gate stdout not parseable JSON: ${r.stdout} (${e.message})`);
  }
}

/** runGate with a cleared log; returns { decision, log } so a test can assert the audit record. */
function runGateCapture(envelope) {
  clearTestLog();
  const decision = runGate(envelope);
  return { decision, log: lastLogEntry() };
}

/**
 * Build a realistic architect-output envelope with given result text.
 */
function makeEnvelope(resultText, subagentType = 'architect') {
  return {
    tool_name: 'Agent',
    tool_input: { subagent_type: subagentType },
    tool_response: {
      content: [{ type: 'text', text: resultText }],
    },
    session_id: 'test-session',
    tool_use_id: 'test-tool-use',
  };
}

/**
 * Build an envelope whose tool_response is the ASYNC-LAUNCH STUB the harness
 * returns when an Agent is launched with run_in_background (now the default).
 * This is a structured object with NO .text/.content — the agent's real
 * response arrives out-of-band via a task-notification and NEVER re-fires
 * PostToolUse:Agent (firsthand-verified: 193 async agentIds, 0 completion
 * re-fires). `overrides` lets a test drop a field or bend a value.
 * Verified shape (spawn-state excerpt_head 2026-07-04):
 *   {isAsync,status:'async_launched',agentId,description,resolvedModel,prompt,
 *    outputFile,canReadOutputFile}
 */
function makeAsyncStub(subagentType = 'architect', overrides = {}) {
  const stub = {
    isAsync: true,
    status: 'async_launched',
    agentId: 'a0c475929aa3971ff',
    description: `${subagentType} VERIFY lens`,
    resolvedModel: 'claude-opus-4-8',
    prompt: 'You are the ARCHITECT lens. Read the plan and report findings.',
    outputFile: '/tmp/tasks/a0c475929aa3971ff.output',
    canReadOutputFile: true,
    ...overrides,
  };
  return {
    tool_name: 'Agent',
    tool_input: { subagent_type: subagentType },
    tool_response: stub,
    session_id: 'test-session',
    tool_use_id: 'test-tool-use',
  };
}

/**
 * Build an envelope whose tool_response is a COMPLETED (sync) spawn object —
 * `status:'completed'` (per spawn-close-resolver) with the real response in
 * `content`. This MUST still be evaluated by the gate (NOT skipped as an async
 * stub) — the guard against `status`-field over-matching / false-skip.
 */
function makeCompletedEnvelope(resultText, subagentType = 'architect') {
  return {
    tool_name: 'Agent',
    tool_input: { subagent_type: subagentType },
    tool_response: {
      status: 'completed',
      agentId: 'a0f786850bcc30b9b',
      content: [{ type: 'text', text: resultText }],
    },
    session_id: 'test-session',
    tool_use_id: 'test-tool-use',
  };
}

process.stdout.write('\n=== kb-citation-gate (v2.7.1 heading-regex tolerance) ===\n');

// ============================================================================
// T1: canonical heading + valid kb ref → approve (preserved baseline behavior)
// ============================================================================
test('T1: canonical heading `## KB Sources Consulted` → approve', () => {
  const text = `Some analysis here.

## KB Sources Consulted

- kb:architecture/crosscut/single-responsibility — anchor`;
  const decision = runGate(makeEnvelope(text));
  if (decision.decision !== 'approve') {
    throw new Error(`expected approve, got ${decision.decision}: ${decision.reason}`);
  }
});

// ============================================================================
// T2 (LOAD-BEARING — the v2.7.1 fix): numbered prefix `## 7. KB Sources Consulted`
// ============================================================================
test('T2: numbered prefix `## 7. KB Sources Consulted` → approve', () => {
  const text = `## 1. Design

stuff

## 7. KB Sources Consulted

- kb:architecture/crosscut/single-responsibility — anchor
- kb:architecture/discipline/stability-patterns — drift detection`;
  const decision = runGate(makeEnvelope(text));
  if (decision.decision !== 'approve') {
    throw new Error(`expected approve for numbered heading, got ${decision.decision}: ${decision.reason || ''}`);
  }
});

// ============================================================================
// T3: multi-digit numbered prefix `## 12. KB Sources Consulted`
// ============================================================================
test('T3: multi-digit numbered prefix `## 12. KB Sources Consulted` → approve', () => {
  const text = `Long structured response.

## 12. KB Sources Consulted

- kb:architecture/crosscut/idempotency — anchor`;
  const decision = runGate(makeEnvelope(text));
  if (decision.decision !== 'approve') {
    throw new Error(`expected approve for multi-digit numbered heading, got ${decision.decision}`);
  }
});

// ============================================================================
// T4: h3 heading `### KB Sources Consulted` → STILL REJECT (contract preserved)
// ============================================================================
test('T4: h3 heading `### KB Sources Consulted` → reject (contract preserved)', () => {
  const text = `### KB Sources Consulted

- kb:architecture/crosscut/single-responsibility — anchor`;
  const decision = runGate(makeEnvelope(text));
  if (decision.decision !== 'block') {
    throw new Error(`expected block for h3 heading, got ${decision.decision}`);
  }
});

// ============================================================================
// T5: h1 heading `# KB Sources Consulted` → reject (contract preserved)
// ============================================================================
test('T5: h1 heading `# KB Sources Consulted` → reject', () => {
  const text = `# KB Sources Consulted

- kb:architecture/crosscut/single-responsibility — anchor`;
  const decision = runGate(makeEnvelope(text));
  if (decision.decision !== 'block') {
    throw new Error(`expected block for h1 heading, got ${decision.decision}`);
  }
});

// ============================================================================
// T6: no KB Sources section at all → reject
// ============================================================================
test('T6: no heading at all → reject', () => {
  const text = `Just some analysis without any KB section.

kb:architecture/crosscut/single-responsibility — even with a stray kb: ref, no section means reject`;
  const decision = runGate(makeEnvelope(text));
  if (decision.decision !== 'block') {
    throw new Error(`expected block for missing section, got ${decision.decision}`);
  }
});

// ============================================================================
// T7: canonical heading but no kb: refs → reject
// ============================================================================
test('T7: heading present but zero kb: refs → reject', () => {
  const text = `## KB Sources Consulted

- file paths only; no canonical kb: refs
- /Users/foo/bar/baz.md — file path masquerading as anchor`;
  const decision = runGate(makeEnvelope(text));
  if (decision.decision !== 'block') {
    throw new Error(`expected block when heading present but kb_refs=0, got ${decision.decision}`);
  }
});

// ============================================================================
// T8: non-Agent tool name → approve (pass-through)
// ============================================================================
test('T8: non-Agent tool name → pass-through approve', () => {
  const env = {
    tool_name: 'Bash',
    tool_input: { command: 'ls' },
    tool_response: { stdout: 'output' },
  };
  const decision = runGate(env);
  if (decision.decision !== 'approve') {
    throw new Error(`expected approve for non-Agent tool, got ${decision.decision}`);
  }
});

// ============================================================================
// T9: non-KB-contracted sub-agent (e.g., general-purpose) → approve
// ============================================================================
test('T9: non-KB-contracted subagent → pass-through approve', () => {
  const text = `Some general-purpose output without any contract.`;
  const decision = runGate(makeEnvelope(text, 'general-purpose'));
  if (decision.decision !== 'approve') {
    throw new Error(`expected approve for non-contracted subagent, got ${decision.decision}`);
  }
});

// ============================================================================
// T10: numbered prefix with extra spaces `## 7 . KB Sources Consulted` → approve
// ============================================================================
test('T10: numbered prefix with extra spaces `##  7.  KB Sources Consulted` → approve', () => {
  const text = `##  7.  KB Sources Consulted

- kb:architecture/crosscut/single-responsibility — anchor`;
  const decision = runGate(makeEnvelope(text));
  if (decision.decision !== 'approve') {
    throw new Error(`expected approve for spaced numbered heading, got ${decision.decision}: ${decision.reason || ''}`);
  }
});

// ============================================================================
// T11: plugin-prefixed subagent type `power-loom:architect` → normalize + check
// ============================================================================
test('T11: plugin-prefixed `power-loom:architect` normalizes + checks contract', () => {
  // No KB section → block (verifies normalization works + contract still fires)
  const text = `Analysis without KB section.`;
  const decision = runGate(makeEnvelope(text, 'power-loom:architect'));
  if (decision.decision !== 'block') {
    throw new Error(`expected block for plugin-prefixed architect missing section, got ${decision.decision}`);
  }
});

// ============================================================================
// ASYNC-LAUNCH STUB handling (2026-07-04 fix).
//
// When an Agent is launched with run_in_background (the harness default), the
// IMMEDIATE tool_response is a launch-ACK object, not the agent's response:
//   {isAsync:true,status:'async_launched',agentId,prompt:'<echoed>',...}
// It has no .text/.content, so extractResultText() stringifies the whole
// object (dominated by the echoed prompt) — result_length 3000-8000, which the
// gate scanned for '## KB Sources Consulted' and (of course) never found, so it
// blocked EVERY async architect spawn. The real response arrives out-of-band
// via a task-notification and NEVER re-fires PostToolUse:Agent (firsthand:
// 193 async agentIds, 0 completion re-fires). So the gate must NOT block on the
// launch stub. The sync path is unchanged (see T17-T19 non-regression guards).
// ============================================================================

// ----------------------------------------------------------------------------
// T12 (LOAD-BEARING — the fix): full async-launch stub for architect → approve
// ----------------------------------------------------------------------------
test('T12: full async-launch stub (isAsync + status:async_launched) → approve + audited', () => {
  const { decision, log } = runGateCapture(makeAsyncStub('architect'));
  if (decision.decision !== 'approve') {
    throw new Error(`expected approve for async-launch stub, got ${decision.decision}: ${decision.reason || ''}`);
  }
  // The audit record must land (not a silent skip) and must be honest: the
  // response was NOT evaluated, so compliant is null (not false).
  if (!log || log.disposition !== 'skip-async-launch-stub') {
    throw new Error(`expected a skip-async-launch-stub log entry, got ${JSON.stringify(log)}`);
  }
  if (log.compliant !== null || log.has_kb_section !== null || log.kb_refs_count !== null) {
    throw new Error(`expected null (not-evaluated) fields on the skip entry, got ${JSON.stringify(log)}`);
  }
});

// ----------------------------------------------------------------------------
// T13: status:'async_launched' alone (isAsync dropped) → approve (robustness)
// ----------------------------------------------------------------------------
test('T13: status:async_launched alone (no isAsync) → approve', () => {
  const decision = runGate(makeAsyncStub('architect', { isAsync: undefined }));
  if (decision.decision !== 'approve') {
    throw new Error(`expected approve for status-only async stub, got ${decision.decision}`);
  }
});

// ----------------------------------------------------------------------------
// T14: isAsync:true alone (status dropped) → approve (robustness)
// ----------------------------------------------------------------------------
test('T14: isAsync:true alone (no status) → approve', () => {
  const decision = runGate(makeAsyncStub('architect', { status: undefined }));
  if (decision.decision !== 'approve') {
    throw new Error(`expected approve for isAsync-only async stub, got ${decision.decision}`);
  }
});

// ----------------------------------------------------------------------------
// T15: async stub whose ECHOED PROMPT contains a real '## KB Sources Consulted'
// heading + kb: ref → still approve. We skip on the async SHAPE, never on the
// stringified content — the gate must not pretend to have evaluated the (absent)
// response. (Behavior is approve either way; this pins the skip-on-shape intent.)
// ----------------------------------------------------------------------------
test('T15: async stub with KB-looking echoed prompt → approve via SKIP path (not false-compliant)', () => {
  const { decision, log } = runGateCapture(makeAsyncStub('architect', {
    prompt: 'End your reply with\n## KB Sources Consulted\n- kb:architecture/crosscut/idempotency',
  }));
  if (decision.decision !== 'approve') {
    throw new Error(`expected approve for async stub regardless of echoed prompt, got ${decision.decision}`);
  }
  // Load-bearing: it must approve because we SKIPPED the stub (disposition), NOT
  // because the stringified stub was mistaken for a compliant response. Without
  // this assertion the test can't tell "skipped correctly" from "fooled".
  if (!log || log.disposition !== 'skip-async-launch-stub') {
    throw new Error(`expected skip-async-launch-stub disposition, got ${JSON.stringify(log)}`);
  }
});

// ----------------------------------------------------------------------------
// T16: plugin-prefixed `power-loom:architect` async stub → approve
// (normalization + async-skip compose)
// ----------------------------------------------------------------------------
test('T16: plugin-prefixed architect async stub → approve', () => {
  const decision = runGate(makeAsyncStub('power-loom:architect'));
  if (decision.decision !== 'approve') {
    throw new Error(`expected approve for plugin-prefixed architect async stub, got ${decision.decision}`);
  }
});

// ----------------------------------------------------------------------------
// T17 (NON-FALSE-SKIP GUARD): a COMPLETED (sync) object with status:'completed'
// and NO KB section MUST still block. `status` alone must not trigger the skip —
// only 'async_launched' / isAsync:true. This is the load-bearing guard that the
// fix does not weaken the case the gate CAN catch.
// ----------------------------------------------------------------------------
test('T17: completed-object (status:completed) KB-less architect → block', () => {
  const decision = runGate(makeCompletedEnvelope('Analysis with no KB section at all.'));
  if (decision.decision !== 'block') {
    throw new Error(`expected block for completed KB-less response, got ${decision.decision} (false-skip regression!)`);
  }
});

// ----------------------------------------------------------------------------
// T18 (NON-REGRESSION): a COMPLETED (sync) object that IS compliant → approve
// ----------------------------------------------------------------------------
test('T18: completed-object compliant architect → approve', () => {
  const text = `Design review.

## KB Sources Consulted

- kb:architecture/crosscut/single-responsibility — anchor`;
  const decision = runGate(makeCompletedEnvelope(text));
  if (decision.decision !== 'approve') {
    throw new Error(`expected approve for completed compliant response, got ${decision.decision}: ${decision.reason || ''}`);
  }
});

// ----------------------------------------------------------------------------
// T19 (NON-REGRESSION): a plain-STRING KB-less sync response still blocks
// ----------------------------------------------------------------------------
test('T19: plain-string KB-less architect response → block', () => {
  const env = {
    tool_name: 'Agent',
    tool_input: { subagent_type: 'architect' },
    tool_response: 'Just prose analysis, no KB section.',
    session_id: 'test-session',
    tool_use_id: 'test-tool-use',
  };
  const decision = runGate(env);
  if (decision.decision !== 'block') {
    throw new Error(`expected block for plain-string KB-less response, got ${decision.decision}`);
  }
});

// ----------------------------------------------------------------------------
// T20: non-architect async stub (general-purpose) → approve via pass-through
// (the subagent-not-required gate; async-skip ordering must not matter here)
// ----------------------------------------------------------------------------
test('T20: non-architect (general-purpose) async stub → approve', () => {
  const decision = runGate(makeAsyncStub('general-purpose'));
  if (decision.decision !== 'approve') {
    throw new Error(`expected approve for non-contracted async stub, got ${decision.decision}`);
  }
});

clearTestLog();

process.stdout.write(`\n=== Summary ===\n`);
process.stdout.write(`  Passed: ${passed}\n`);
process.stdout.write(`  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
