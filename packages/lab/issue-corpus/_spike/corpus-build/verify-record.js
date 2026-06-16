#!/usr/bin/env node

// @loom-layer: lab
//
// v3.11 bootcamp Phase 1 — the per-issue CORPUS GATE. Given a staged record, prove in the sandbox
// that it is a genuine fail-before / pass-after OSS bug (the quality bar every corpus issue clears
// before it counts). Manual spike — real clone + sandbox, OUT of CI. Reuses the Phase-2a-proven path
// (makeBehavioralFn + the sandbox-exec backend). Anti-hang: a watchdog backstop + the backend's own
// timeouts; always run in the background so it can never block the session.
//
// Usage: node verify-record.js <staged-record.json>
//   record = { id, repo, base_sha, accepted_diff, test_patch, fail_to_pass[], pass_to_pass[] }
// Emits VERIFIED (fail-before AND pass-after) or REJECTED (with the failing leg), and writes the
// verdict next to the record as <id>.verdict.json.

'use strict';

const fs = require('fs');
// Static relative requires (NOT require(path.join(...))) — the EC7 bootcamp-gates DYNAMIC_IMPORT
// gate flags any require() whose argument is not a string literal. corpus-build/ -> _spike ->
// issue-corpus is `../..`; the causal-edge sibling is `../../../causal-edge`.
const { createSandboxExecBackend } = require('../../sandbox-exec-backend');
const { makePytestResolver } = require('../../pytest-runner');
const { makeBehavioralFn } = require('../../../causal-edge/calibration-issue-run');

const recPath = process.argv[2];
if (!recPath) { console.log('usage: node verify-record.js <record.json>'); process.exit(2); }
// CodeRabbit #333: the verdict path is recPath with .json -> .verdict.json; a non-.json (or already
// .verdict.json) input would make that a no-op and overwrite the INPUT file. Reject it up front.
if (!/\.json$/i.test(recPath) || /\.verdict\.json$/i.test(recPath)) {
  console.log(`invalid input: ${recPath} (expected a staged <id>.json, not a .verdict.json)`); process.exit(2);
}
const record = JSON.parse(fs.readFileSync(recPath, 'utf8'));
const out = (s) => process.stdout.write(`${s}\n`);

const wd = setTimeout(() => { out('BACKSTOP TIMEOUT at 8min — a clone/sandbox leg hung'); process.exit(99); }, 480000);

(async () => {
  out(`=== corpus gate: ${record.id} (${record.repo} @ ${String(record.base_sha).slice(0, 12)}) ===`);
  const backend = createSandboxExecBackend({ resolveTestCommand: makePytestResolver() });
  if (!backend.attest().attested) { out('NO sandbox — abort'); clearTimeout(wd); process.exit(1); }
  const grade = makeBehavioralFn(backend);

  // fail-before: NO fix, only the test_patch -> the regression test must FAIL.
  out('\n--- fail-before: apply ONLY the test_patch (no fix) -> expect FAIL ---');
  const before = await grade(record, '');
  out(`  ${JSON.stringify(before)}`);

  // pass-after: the accepted fix + the test_patch -> the regression test must PASS (+ pass_to_pass kept).
  out('\n--- pass-after: apply the accepted_diff + test_patch -> expect PASS ---');
  const after = await grade(record, record.accepted_diff);
  out(`  ${JSON.stringify(after)}`);

  const failBefore = before.issue_tests === 'FAIL';
  const passAfter = after.issue_tests === 'PASS';
  const verified = failBefore && passAfter;
  const verdict = {
    id: record.id, verified, fail_before: before.issue_tests, pass_after: after.issue_tests,
    reason: verified ? null : (!failBefore ? `fail-before was ${before.issue_tests} (a non-FAIL baseline -> not a genuine regression test, or a clone/dep issue)` : `pass-after was ${after.issue_tests} (the accepted fix did not resolve it in the sandbox)`),
  };
  const vPath = recPath.replace(/\.json$/, '.verdict.json');
  fs.writeFileSync(vPath, `${JSON.stringify(verdict, null, 2)}\n`);
  out(`\n=== ${verified ? 'VERIFIED' : 'REJECTED'} — ${record.id} ===`);
  if (!verified) out(`  reason: ${verdict.reason}`);
  out(`  verdict -> ${vPath}`);
  clearTimeout(wd);
  process.exit(verified ? 0 : 3);
})().catch((e) => { out(`THREW: ${e && e.stack}`); clearTimeout(wd); process.exit(2); });
