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

const HOOK = path.resolve(__dirname, '../../../packages/kernel/hooks/post/kb-citation-gate.js');

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

/**
 * Run kb-citation-gate against a synthetic Claude Code envelope.
 * @param {object} envelope - hook input
 * @returns {{decision: 'approve'|'block', reason?: string}}
 */
function runGate(envelope) {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(envelope),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_HOOKS_QUIET: '1' },
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

process.stdout.write(`\n=== Summary ===\n`);
process.stdout.write(`  Passed: ${passed}\n`);
process.stdout.write(`  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
