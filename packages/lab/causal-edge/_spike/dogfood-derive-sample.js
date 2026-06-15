#!/usr/bin/env node

// @loom-layer: lab
//
// v3.11 W1 — the Rule-2a-corollary DOGFOOD driver (reproducible). Runs the REAL claude -p
// derive leg end-to-end through captureLessons on ONE synthetic-but-realistic (candidate,
// accepted) windowed boundary bug, into a temp store. OUT of CI (manual; needs `claude`).
//
// SCOPE (honest, per VALIDATE-honesty): this is an N=1 SMOKE that the real path EXECUTES and
// produces a valid, leak-free, floor-keyed lesson — NOT evidence the leg works across the
// corpus or at any rate. A backtest/synthetic dogfood NARROWS only; only a world-anchored run
// HARDENS. A full bootcamp re-run remains owed (W1 machinery is CI-proven via mocks). The
// recorded output of one run is in DOGFOOD-SAMPLE.md beside this file.
//
//   run:  node packages/lab/causal-edge/_spike/dogfood-derive-sample.js
//   dry:  node packages/lab/causal-edge/_spike/dogfood-derive-sample.js --dry   (no network)

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCaptureRerun } = require('./lesson-capture-rerun');
const { loadNode } = require('../../attribution/recall-graph-store');
const { readCandidate } = require('../../attribution/candidate-sidecar');

// A real-shaped windowed() boundary bug: candidate guards n<0 only; accepted handles n==0.
const candidate_patch = [
  'diff --git a/more_itertools/more.py b/more_itertools/more.py',
  '--- a/more_itertools/more.py',
  '+++ b/more_itertools/more.py',
  '@@ def windowed(seq, n):',
  '-    if n < 0:',
  '-        raise ValueError',
  '+    if n < 0:',
  '+        raise ValueError("n must be >= 0")',
  '     it = iter(seq)',
].join('\n');
const accepted_diff = [
  'diff --git a/more_itertools/more.py b/more_itertools/more.py',
  '--- a/more_itertools/more.py',
  '+++ b/more_itertools/more.py',
  '@@ def windowed(seq, n):',
  '+    if n == 0:',
  '+        yield ()',
  '+        return',
  '     if n < 0:',
  '         raise ValueError("n must be >= 0")',
].join('\n');

const ITEM = {
  attempt: {
    id: 'more-itertools__windowed-invalid-size', attempt_index: 0, recall_eligible: true, resolution_friction: null,
    reference: {
      issue_id: 'more-itertools__windowed-invalid-size', repo: 'https://github.com/more-itertools/more-itertools',
      problem_statement_digest: 'windowed(seq, 0) silently yielded an empty tuple instead of handling n==0 per contract',
      candidate_patch_ref: 'deadbeefcafe0001', behavioral_verdict: 'BEHAVIORAL_PASS',
      reference_divergence: 0.4, contamination_tier: 'clean',
    },
  },
  candidate_patch, accepted_diff, fail_to_pass: ['test_windowed_zero'],
};

async function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'w1-dogfood-'));
  const opts = { recallGraphDir: path.join(base, 'rg'), sidecarDir: path.join(base, 'sc'), reportFile: path.join(base, 'report.json') };
  process.stdout.write('[dogfood] calling the real claude -p derive leg (N=1 smoke) ...\n');
  const r = await runCaptureRerun([ITEM], opts);
  process.stdout.write(`[dogfood] counters: ${JSON.stringify({ n_eligible: r.n_eligible, n_written: r.n_written, n_leak: r.n_leak, n_off_floor: r.n_off_floor, n_derive_fallback: r.n_derive_fallback })}\n`);
  if (r.minted.length) {
    const n = r.minted[0];
    const back = loadNode(n.node_id, { dir: opts.recallGraphDir });
    process.stdout.write(`[dogfood] lesson_signature: ${n.lesson_signature}\n`);
    process.stdout.write(`[dogfood] lesson_body: ${n.lesson_body}\n`);
    process.stdout.write(`[dogfood] loads back + verifies: ${!!back}\n`);
    process.stdout.write(`[dogfood] candidate recoverable: ${readCandidate(n.candidate_patch_sha, { dir: opts.sidecarDir }) === candidate_patch}\n`);
  } else {
    process.stdout.write('[dogfood] no node minted (the real leg fell back this run) — machinery is CI-proven via mocks; this run did not produce a valid floor classification.\n');
  }
}

main();
