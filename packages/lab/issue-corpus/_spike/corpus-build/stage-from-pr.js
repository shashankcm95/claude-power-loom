#!/usr/bin/env node

// @loom-layer: lab
//
// v3.11 bootcamp Phase 1 — the per-issue STAGER. Codifies the sourcing recipe (snapshot
// 2026-06-16-v3.11-bootcamp-corpus-grind) in code so the diff-split + base_sha derivation are
// deterministic, not hand-escaped JSON (the error class the recipe's gotchas warn about). Manual
// spike, OUT of CI. Given a merged GitHub PR, it emits a staged corpus record ready for
// verify-record.js. The gate (verify-record.js) is the real quality check; this just assembles.
//
// Usage:
//   node stage-from-pr.js --repo <owner/name> --pr <N> --id <slug> \
//        --fail "tests/test_x.py::Class::test_a[,...]" [--problem "one-line statement"]
//
//   base_sha = the merge commit's FIRST PARENT (mergeCommit^1), per the recipe gotcha.
//   The PR diff is split per-file: paths under tests/ or matching test_*/ *_test / conftest go to
//   test_patch; everything else to accepted_diff. --fail is REQUIRED (the recipe's judgment step);
//   the stager also prints auto-detected added `def test_*` as a sanity cross-check.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function arg(name, required) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i === process.argv.length - 1) {
    if (required) { console.error(`missing --${name}`); process.exit(2); }
    return null;
  }
  return process.argv[i + 1];
}

const repo = arg('repo', true);
const pr = arg('pr', true);
const id = arg('id', true);
const failCsv = arg('fail', true);
const problem = arg('problem', false);

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

// --- PR metadata -----------------------------------------------------------
const meta = JSON.parse(gh(['pr', 'view', pr, '--repo', repo, '--json', 'title,body,closedAt,mergeCommit']));
const mergeOid = meta.mergeCommit && meta.mergeCommit.oid;
if (!mergeOid) { console.error('no mergeCommit — PR not merged?'); process.exit(2); }
// Robust base = the parent of the PR's FIRST commit (the fork point `gh pr diff` is computed
// against). mergeCommit^1 is WRONG for SQUASH-merged repos: it is main-at-merge-time, not the
// fork point, so the diff's context lines do not match and the patch silently fails to apply.
const baseSha = gh(['api', `repos/${repo}/pulls/${pr}/commits`, '--jq', '.[0].parents[0].sha']).trim();
if (!/^[0-9a-f]{40}$/.test(baseSha)) { console.error(`bad base_sha derived: ${baseSha}`); process.exit(2); }

// --- diff split by file path ----------------------------------------------
const rawDiff = gh(['pr', 'diff', pr, '--repo', repo]);
// Each file block starts at a line "diff --git a/<path> b/<path>". Split keeping the markers.
const blocks = rawDiff.split(/(?=^diff --git )/m).filter((b) => b.startsWith('diff --git '));
const isTestPath = (p) => /(^|\/)tests?\//.test(p) || /(^|\/)(test_[^/]+|[^/]+_test|conftest)\.py$/.test(p);

// Classification: a Python-corpus record's behavioral content is .py only. Keep ALL test-dir files
// (incl. fixtures the tests load); route .py non-test files to the fix; DROP everything else (docs,
// configs, .spell-dict, .pyi stubs) — they never change pytest behavior and their context can drift,
// silently breaking the accepted_diff apply (the squash/markdown-1606 class).
const testBlocks = [];
const srcBlocks = [];
const dropped = [];
const addedTests = [];
for (const b of blocks) {
  const m = b.match(/^diff --git a\/(.+?) b\/(.+)$/m);
  const p = m ? m[1] : '';
  if (isTestPath(p)) {
    testBlocks.push(b);
    for (const line of b.split('\n')) {
      const dm = line.match(/^\+\s*def (test_\w+)/);
      if (dm) addedTests.push(dm[1]);
    }
  } else if (/\.py$/.test(p)) {
    srcBlocks.push(b);
  } else {
    dropped.push(p);
  }
}

if (srcBlocks.length === 0) console.error('WARN: no source-file blocks — pyi/test-only PR? (likely not fail-before/pass-after verifiable)');
if (testBlocks.length === 0) console.error('WARN: no test-file blocks — no regression test to fail-before');

const record = {
  id,
  repo: `https://github.com/${repo}`,
  base_sha: baseSha,
  problem_statement: problem || meta.title,
  accepted_diff: srcBlocks.join(''),
  test_patch: testBlocks.join(''),
  fail_to_pass: failCsv.split(',').map((s) => s.trim()).filter(Boolean),
  pass_to_pass: [],
  resolved_at: meta.closedAt,
  provenance: 'backtest',
  contamination_tier: 'clean-pending-probe',
  source_pr: `https://github.com/${repo}/pull/${pr}`,
};

const outPath = path.join(__dirname, 'staged', `${id}.json`);
fs.writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);

console.log(`staged -> ${outPath}`);
console.log(`  base_sha (PR fork base = first-commit^1): ${baseSha}`);
console.log(`  resolved_at: ${meta.closedAt}`);
console.log(`  src blocks: ${srcBlocks.length}  test blocks: ${testBlocks.length}  dropped (non-.py): ${dropped.length ? dropped.join(', ') : '0'}`);
console.log(`  fail_to_pass (provided): ${record.fail_to_pass.join(' , ')}`);
console.log(`  added def test_* (auto-detected sanity): ${addedTests.length ? addedTests.join(', ') : '(none — data-driven test? confirm --fail names an existing method)'}`);
