#!/usr/bin/env node

// @loom-layer: lab
//
// v3.9.x real-E2E spike — STEP A: prove the DETERMINISTIC grading path on a REAL
// resolved issue, end-to-end through the W1 sandbox, using the REAL leg-A code path
// (makeBehavioralFn). No actor noise yet (Step B adds claude -p). Manual spike,
// network + sandbox, OUTSIDE tests/unit/**.
//
// The issue: more-itertools edb3346 (2026-04-10, POST the Jan-2026 cutoff) — a real
// bug: numeric_range.__reversed__ raised IndexError on an EMPTY range instead of
// yielding an empty iterator. Zero runtime deps + pytest => runnable in the
// network-denied sandbox with no install step (the constraint the probe surfaced).
//
// Controls: candidate = the KNOWN accepted_diff (the real fix) => fail_to_pass must
// FLIP to PASS; candidate = '' (no fix) => the bug is present => fail_to_pass FAILS.
// If both hold THROUGH the sandbox, the real clone + sandbox + pytest + outcome-eval
// path is proven on real data.

'use strict';

const fs = require('fs');
const path = require('path');
const { createSandboxExecBackend } = require('../sandbox-exec-backend');
const { makePytestResolver } = require('../pytest-runner');
const { makeBehavioralFn } = require('../../causal-edge/calibration-issue-run');

const DIR = path.join(__dirname, 'real-e2e');
const out = (s) => process.stdout.write(`${s}\n`);

const record = {
  id: 'more-itertools__numeric-range-reversed-empty',
  repo: 'https://github.com/more-itertools/more-itertools',
  base_sha: '247e15b3a489d5805375c95dfa79486c9bd0eb1b',                // edb3346^ (the buggy parent)
  // PUBLIC input (Step B feeds this to the actor) — symptom + expected behavior, NOT the fix.
  problem_statement: 'numeric_range supports reversed(), but reversing an EMPTY numeric range raises '
    + 'IndexError instead of yielding an empty iterator. For example, list(reversed(numeric_range(0))) '
    + 'should return [] (an empty range reversed is still empty), but instead raises '
    + '"IndexError: numeric range object index out of range". Fix numeric_range.__reversed__ so that '
    + 'reversing an empty range returns an empty iterator.',
  fail_to_pass: ['tests/test_more.py::NumericRangeTests::test_empty_reversed'],
  pass_to_pass: ['tests/test_more.py::NumericRangeTests::test_bool', 'tests/test_more.py::NumericRangeTests::test_contains'],
  test_patch: fs.readFileSync(path.join(DIR, 'test_patch.patch'), 'utf8'),
  accepted_diff: fs.readFileSync(path.join(DIR, 'accepted_diff.patch'), 'utf8'),
};

(async () => {
  out('=== v3.9.x real-E2E STEP A — deterministic grading on a REAL issue ===');
  out(`issue: ${record.id}`);
  out(`repo:  ${record.repo} @ ${record.base_sha.slice(0, 12)}`);
  out(`fail_to_pass: ${record.fail_to_pass[0]}\n`);

  const backend = createSandboxExecBackend({ resolveTestCommand: makePytestResolver() });
  const att = backend.attest();
  out(`sandbox containment: attested=${att.attested}${att.reason ? ` (${att.reason})` : ''}`);
  if (!att.attested) { out('NO ATTESTED SANDBOX — abort (the behavioral leg is fail-closed by design)'); process.exit(1); }

  const behavioralFn = makeBehavioralFn(backend);

  out('\n--- POSITIVE control: candidate = the REAL accepted fix -> expect issue_tests PASS ---');
  const withFix = await behavioralFn(record, record.accepted_diff);
  out(`  ${JSON.stringify(withFix)}`);

  out('\n--- NEGATIVE control: candidate = NO fix -> bug present -> expect issue_tests FAIL ---');
  const noFix = await behavioralFn(record, '');
  out(`  ${JSON.stringify(noFix)}`);

  const ok = withFix.issue_tests === 'PASS' && withFix.outcome_source === 'model'
    && withFix.test_tree_mutated === false
    && noFix.issue_tests === 'FAIL' && noFix.outcome_source === 'model';
  out('');
  if (ok) {
    out('=== STEP A GREEN — the real clone + W1 sandbox + pytest + outcome-eval path is proven on REAL data ===');
    out('(the KNOWN fix flips fail_to_pass to PASS; no fix FAILS; the candidate did not mutate the test tree)');
    process.exit(0);
  }
  out('=== STEP A FAILED — inspect the verdicts above ===');
  process.exit(1);
})().catch((e) => { out(`SPIKE THREW: ${e.stack}`); process.exit(1); });
