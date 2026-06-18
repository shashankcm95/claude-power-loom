#!/usr/bin/env node

// @loom-layer: lab
//
// 3.1-W4b SPIKE (_spike, OUTSIDE tests/unit/**) -- the Rule-2a-corollary REAL-PATH proof for the
// real `claude -p` solve+grade driver. A green mock suite (real-solve.test.js) is a HYPOTHESIS about
// the path it mocks; THIS spike proves the real path actually: resolves the claude binary, attests a
// live sandbox-exec backend, clones ONE staged corpus issue, runs the BLIND actor in the clone,
// diffs the clone for the candidate patch, GRADES it in the sandbox over the SEALED fail_to_pass/
// pass_to_pass, and returns a HARNESS-computed verdict (PASS/FAIL/UNAVAILABLE) -- never the actor's
// self-asserted claim.
//
// IT IS NONDETERMINISTIC + SLOW (a real LLM + a real clone + a real sandboxed pytest run) and is OUT
// of CI. The orchestrator runs it at VALIDATE; the builder does NOT run it.
//
//   HOW TO RUN (macOS, with the claude binary on PATH or at ~/.local/bin/claude):
//     node packages/lab/persona-experiment/_spike/real-solve-spike.js
//     # optionally pin a specific staged issue by id substring:
//     node packages/lab/persona-experiment/_spike/real-solve-spike.js faker__proxy
//
// Re-probe the DECAYING state here (per the plan): the claude binary version + backend.attest()
// (which spins a real Seatbelt profile). A failed attestation / missing binary aborts CLEAN (the
// driver itself would fail-closed to BEHAVIORAL_UNAVAILABLE -- this spike surfaces WHY out loud).

'use strict';

const fs = require('fs');
const path = require('path');
const { createSandboxExecBackend } = require('../../issue-corpus/sandbox-exec-backend');
const { makePytestResolver } = require('../../issue-corpus/pytest-runner');
const { resolveClaude } = require('../../causal-edge/trajectory-friction-run');
const { makeRealSolve } = require('../real-solve');
const { composeArm } = require('../arm-compose');

const STAGED_DIR = path.join(__dirname, '..', '..', 'issue-corpus', '_spike', 'corpus-build', 'staged');
const out = (s) => process.stdout.write(`${s}\n`);

// Pick ONE staged corpus issue (the first, or the first whose id matches an argv substring). The
// `*.verdict.json` sidecars are skipped -- only the full issue records carry base_sha/test_patch.
function pickIssue(filter) {
  const files = fs.readdirSync(STAGED_DIR)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.verdict.json'))
    .sort();
  const chosen = filter ? files.find((f) => f.includes(filter)) : files[0];
  if (!chosen) throw new Error(`no staged issue${filter ? ` matching ${JSON.stringify(filter)}` : ''} in ${STAGED_DIR}`);
  return { file: chosen, record: JSON.parse(fs.readFileSync(path.join(STAGED_DIR, chosen), 'utf8')) };
}

(async () => {
  const filter = process.argv[2];
  const { file, record } = pickIssue(filter);
  out('=== 3.1-W4b real-solve spike: REAL claude -p actor -> sandbox grade -> HARNESS verdict ===');
  out(`issue: ${record.id} (${file}) @ ${String(record.base_sha).slice(0, 12)}`);
  out(`repo: ${record.repo}`);
  out(`fail_to_pass: ${(record.fail_to_pass || []).length}  pass_to_pass: ${(record.pass_to_pass || []).length}\n`);

  // 1) resolve the actor binary (DECAYING state).
  const claudeBin = resolveClaude();
  if (!claudeBin) { out('claude binary NOT found -- the driver would fail-closed to BEHAVIORAL_UNAVAILABLE. Abort.'); process.exit(1); }
  out(`claude binary: ${claudeBin}`);

  // 2) build + ATTEST the sandbox-exec backend with the pytest resolver (the MED-1 wiring: NOT
  //    selectAttestedBackend, which lacks the resolver). Attest ONCE; pass into the factory.
  const backend = createSandboxExecBackend({ resolveTestCommand: makePytestResolver() });
  const att = backend.attest();
  out(`sandbox attestation: attested=${att.attested}${att.reason ? ` (${att.reason})` : ''}`);
  if (!att.attested) { out('NO attested sandbox -- the driver would fail-closed to BEHAVIORAL_UNAVAILABLE. Abort.'); process.exit(1); }

  // 3) compose the arm prompt the seam passes as extraContext. §2b CONTRACT: `task` is a fixed,
  //    PROBLEM-FREE instruction stub (identical across arms); the problem rides in `record` (via
  //    buildActorPrompt). The spike exercises arm B (archetype + task) for a non-empty persona delta.
  const TASK = 'Resolve the issue described above.';
  const PERSONA = 'python-backend';
  const armPrompt = composeArm('B', { persona: PERSONA, task: TASK });

  // 4) build the REAL solveFn + run it (this clones, runs the actor, diffs, grades, cleans up).
  const solveFn = makeRealSolve({ record, backend, claudeBin });
  out('\n--- running the REAL driver (clone -> blind actor -> diff -> sandbox grade) ... ---');
  const startedAt = Date.now();
  const result = await solveFn({ arm: 'B', prompt: armPrompt, task: TASK });
  const durMs = Date.now() - startedAt;

  out('\n--- HARNESS verdict (computed over the SEALED tests, NOT the actor stdout) ---');
  out(`  verdict: ${result.verdict}`);
  if (result.reason) out(`  reason:  ${result.reason}`);
  if (typeof result.test_tree_mutated === 'boolean') out(`  test_tree_mutated (C1 tamper signal, report-only): ${result.test_tree_mutated}`);
  out(`  wall-time: ${durMs} ms`);
  out('');
  out(result.verdict === 'BEHAVIORAL_PASS'
    ? 'SPIKE GREEN -- the real path RECREATED a passing fix for a real issue (existence-proof, NOT a measurement; OQ-NS-6 narrows-not-hardens).'
    : `SPIKE COMPLETE -- the real path ran end-to-end and returned ${result.verdict} (the machinery works; a non-PASS is a valid outcome of one nondeterministic sample).`);
  process.exit(0);
})().catch((e) => { out(`SPIKE THREW: ${e && e.stack}`); process.exit(1); });
