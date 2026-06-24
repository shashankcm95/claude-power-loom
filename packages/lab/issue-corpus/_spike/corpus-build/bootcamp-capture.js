#!/usr/bin/env node

// @loom-layer: lab
//
// v3.11 bootcamp Phase 2b — REAL capture over the VERIFIED corpus. Drives captureLessons (via the
// W3 real-claude derive leg, makeLessonDeriver) over the bootcamp-manifest records, minting one
// lesson node per record into a PERSISTENT recall-graph + sidecar under corpus-build/. Each record's
// known-passing accepted_diff IS the candidate_patch (the attempt that passed); the lesson is derived
// from (problem_statement, fix). Manual spike, OUT of CI. Anti-hang: the derive leg spawnSyncs claude
// with a per-call 60s timeout (kills the child), this runner adds a whole-run watchdog backstop, and
// it MUST be run in the background. Batch with --start/--count to checkpoint; the store dedups on
// node_id so re-runs/overlaps are safe. --dry uses the deterministic stub leg (no network).
//
// Usage: node bootcamp-capture.js [--start N] [--count M] [--dry]

'use strict';

const fs = require('fs');
const path = require('path');
// Static relative require (NOT require(path.join(...)) — the EC7 DYNAMIC_IMPORT gate flags non-literal
// require args). corpus-build -> _spike -> issue-corpus -> lab, then into causal-edge/_spike.
const { runCaptureRerun } = require('../../../causal-edge/_spike/lesson-capture-rerun');

const DIR = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'bootcamp-manifest.json'), 'utf8'));
const records = manifest.records || [];

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && i < process.argv.length - 1 ? process.argv[i + 1] : d; };
const start = parseInt(arg('start', '0'), 10);
const count = parseInt(arg('count', String(records.length)), 10);
const dry = process.argv.includes('--dry');
const only = (arg('only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
// --only <id,id> re-derives just those records (stochastic retry of a leaked/fallback derive);
// the persistent store dedups the rest by node_id, so a targeted re-run never disturbs them.
const batch = only.length ? records.filter((r) => only.includes(r.id)) : records.slice(start, start + count);

const recallGraphDir = path.join(DIR, 'recall-graph');
const sidecarDir = path.join(DIR, 'sidecar');
const reportFile = path.join(DIR, 'consolidation-report.json');

// Build a recall-eligible item per record: candidate_patch = the known-passing accepted_diff
// (we did NOT run a separate actor — the upstream fix IS the passing attempt; honest representation).
function itemFor(rec) {
  return {
    attempt: {
      id: rec.id, attempt_index: 0, recall_eligible: true, resolution_friction: null,
      reference: {
        issue_id: rec.id, repo: rec.repo,
        problem_statement_digest: String(rec.problem_statement || '').slice(0, 800),
        candidate_patch_ref: String(rec.base_sha || rec.id).slice(0, 16),
        behavioral_verdict: 'BEHAVIORAL_PASS', reference_divergence: 0.0,
        contamination_tier: rec.contamination_tier || 'clean-pending-probe',
      },
    },
    candidate_patch: rec.accepted_diff,
    accepted_diff: rec.accepted_diff,
    fail_to_pass: rec.fail_to_pass,
  };
}

const WATCHDOG_MS = 30 * 60 * 1000; // 30 min backstop for a whole batch (per-call 60s caps each leg)
const wd = setTimeout(() => { process.stdout.write('BACKSTOP TIMEOUT — a derive leg hung past the per-call cap\n'); process.exit(99); }, WATCHDOG_MS);

(async () => {
  process.stdout.write(`[capture] ${dry ? 'DRY' : 'REAL'} leg over records [${start}, ${start + batch.length}) of ${records.length}\n`);
  const items = batch.map(itemFor);
  const r = await runCaptureRerun(items, { recallGraphDir, sidecarDir, reportFile, provenance: 'backtest', dry, toolless: true });   // #430 PR-2 — direct-path tool-less pin on the deriver
  process.stdout.write(`[capture] counters: ${JSON.stringify({ n_eligible: r.n_eligible, n_written: r.n_written, n_deduped: r.n_deduped, n_off_floor: r.n_off_floor, n_leak: r.n_leak, n_derive_fallback: r.n_derive_fallback, n_sidecar_failed: r.n_sidecar_failed })}\n`);
  for (const n of r.minted) {
    process.stdout.write(`  MINTED ${n.lesson_signature}  <-  ${n.worked_example_ref.issue_id}\n`);
    process.stdout.write(`         body: ${String(n.lesson_body).slice(0, 110)}\n`);
  }
  clearTimeout(wd);
  process.exit(0);
})().catch((e) => { process.stdout.write(`THREW: ${e && e.stack}\n`); clearTimeout(wd); process.exit(2); });
