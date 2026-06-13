#!/usr/bin/env node

// @loom-layer: lab
//
// v3.8b W3 — the rung-2 calibration CLI. Two surfaces:
//   calibrate              DRY run over a built-in deterministic MOCK judge (CI-safe, no LLM) — the
//                          harness-wiring smoke test; prints the result JSON, exit 0.
//   calibrate --real       the MEASURED spike: runs the real `claude -p` judge over the corpus +
//                          writes a calibration record. REQUIRES an UNSANDBOXED, network-enabled,
//                          authenticated shell (H6 — a sandboxed agent/CI blocks the call). NOT CI.
//
// The real run lives in calibration-run.js (out of the unit glob); this CLI just wires the surfaces.

'use strict';

const fs = require('fs');
const path = require('path');
const { scoreCalibration } = require('./calibration');

const USAGE = [
  'Usage:',
  '  calibration-cli.js              DRY run (built-in mock judge; CI-safe; no LLM) — prints the result JSON',
  '  calibration-cli.js --real [--model <m>]   the MEASURED claude -p spike → writes a calibration record',
  '                                  (UNSANDBOXED + network + authed shell ONLY — not CI, not a sandboxed agent)',
  '',
].join('\n');

// A built-in deterministic mock judge for the dry path: answers each fixture's ground truth (read
// from the corpus the CLI loads), so the dry run reports a perfect-judge baseline + 0 injection-follow
// — proving the wiring without an LLM.
function mockJudgeFrom(corpus) {
  const byBlocks = new Map(corpus.map((f) => [f.source_block + ' ' + f.target_block, f.expected_supported]));
  return (edge) => ({ supported: byBlocks.get(edge.source_block + ' ' + edge.target_block) === true });
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { process.stdout.write(USAGE); process.exit(0); }
  const real = argv.includes('--real');
  const modelIdx = argv.indexOf('--model');
  const model = modelIdx >= 0 ? argv[modelIdx + 1] : undefined;

  if (!real) {
    const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'calibration-fixtures.json'), 'utf8')).fixtures;
    const result = scoreCalibration(corpus, mockJudgeFrom(corpus));
    process.stdout.write(`${JSON.stringify({ mode: 'dry', ...result }, null, 2)}\n`);
    process.exit(0);
  }

  // Real spike — lazy-require the LLM module so the dry path never loads spawn machinery.
  const { runCalibration } = require('./calibration-run');
  try {
    const { record, path: outPath } = runCalibration({ model });
    process.stdout.write(`${JSON.stringify({ mode: 'real', written: outPath, ...record }, null, 2)}\n`);
    process.exit(0);
  } catch (e) {
    process.stderr.write(`calibrate: real run failed: ${e && e.message ? e.message : String(e)}\n`);
    process.exit(1);
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { main, mockJudgeFrom };
