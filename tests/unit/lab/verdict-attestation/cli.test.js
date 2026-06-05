#!/usr/bin/env node

// tests/unit/lab/verdict-attestation/cli.test.js
//
// v3.4 Wave 1 — the verdict-attestation CLI. Driven via spawnSync (the CLI's main() calls
// process.exit, so it must run as a subprocess, not in-process). Covers the subcommand dispatch,
// exit codes, the --expires-after-days NaN guard, and the validation error path (VALIDATE
// code-reviewer LOW — no CLI coverage existed).
//
// Extended (record-review): the ergonomic batch over record + enrich. Covers the happy batch, the
// all-or-nothing pre-validation contract (a malformed/over-long/bad-verdict triple writes NOTHING),
// in-batch dedup, the auto-enrich exit-code contract (a post-record enrich throw → exit 0 + a stderr
// warning), --no-enrich, the empty batch, and a regression that parseArgs is unchanged for the
// existing single-value subcommands.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const rid = crypto.randomBytes(6).toString('hex');
const LAB_TMP = path.join(os.tmpdir(), 'w1-cli-lab-' + rid);
const SPAWN_TMP = path.join(os.tmpdir(), 'w1-cli-spawn-' + rid);
fs.mkdirSync(LAB_TMP, { recursive: true });
fs.mkdirSync(SPAWN_TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'packages', 'lab', 'verdict-attestation', 'cli.js');
const LEDGER = path.join(LAB_TMP, 'verdict-attestations', 'ledger.jsonl');

function run(args, extraEnv) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    env: {
      ...process.env, LOOM_LAB_STATE_DIR: LAB_TMP, LOOM_SPAWN_STATE_DIR: SPAWN_TMP, ...extraEnv,
    },
    encoding: 'utf8',
  });
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
}

// Read the raw ledger as parsed records (or [] when absent) — for the all-or-nothing assertions.
function readLedger() {
  let raw;
  try { raw = fs.readFileSync(LEDGER, 'utf8'); } catch { return []; }
  return raw.split('\n').filter((l) => l.length > 0).map((l) => JSON.parse(l));
}

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fs.rmSync(path.join(LAB_TMP, 'verdict-attestations'), { recursive: true, force: true }); } catch { /* */ }
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

const RECORD_ARGS = ['record', '--verdict', 'pass', '--subject-persona', 'node-backend',
  '--verifier-identity', '03-code-reviewer.nova', '--verifier-kind', 'structural',
  '--agent-id', 'a104143b476ed011f'];

// ── existing single-value `record`/`list`/`stats`/`enrich` coverage (unchanged) ────────────────────

test('record (happy) → exit 0, prints a record with attestation_id', () => {
  const r = run(RECORD_ARGS);
  assert.strictEqual(r.code, 0, `exit 0 (stderr=${r.err})`);
  assert.ok(/"attestation_id"/.test(r.out) && /"agent_id": "a104143b476ed011f"/.test(r.out), 'prints the record');
});

test('record missing --agent-id → exit 1, clean error (no stack dump)', () => {
  const r = run(['record', '--verdict', 'pass', '--subject-persona', 'p', '--verifier-identity', 'i', '--verifier-kind', 'structural']);
  assert.strictEqual(r.code, 1, 'exit 1');
  assert.ok(/agentId/.test(r.err) && !/at Object\.|at Module/.test(r.err), 'clean message, no stack');
});

test('record --expires-after-days abc → exit 1 (NaN guard)', () => {
  const r = run([...RECORD_ARGS, '--expires-after-days', 'abc']);
  assert.strictEqual(r.code, 1, 'exit 1');
  assert.ok(/positive number/.test(r.err), 'NaN rejected with a clear message');
});

test('list (empty) → exit 0, []', () => {
  const r = run(['list']);
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.out.trim(), '[]');
});

test('record then stats → exit 0, live:1 unenriched:1', () => {
  run(RECORD_ARGS);
  const r = run(['stats']);
  assert.strictEqual(r.code, 0);
  assert.ok(/"live": 1/.test(r.out) && /"unenriched": 1/.test(r.out), 'stats reflect the one record');
});

test('enrich (no journals) → exit 0, summary', () => {
  run(RECORD_ARGS);
  const r = run(['enrich']);
  assert.strictEqual(r.code, 0);
  assert.ok(/"enriched": 0/.test(r.out) && /"unresolved": 1/.test(r.out), 'summary printed; the record is unresolved (no journal)');
});

test('no command → exit 1, usage', () => {
  const r = run([]);
  assert.strictEqual(r.code, 1);
  assert.ok(/Usage:/.test(r.err), 'usage printed');
});

// ── record-review (the new batch subcommand) ───────────────────────────────────────────────────────

const RR_BASE = ['record-review', '--subject-persona', 'node-backend', '--agent-id', 'a104143b476ed011f'];

// (a) happy batch: N distinct verifier triples → N records + a correct summary.
test('record-review (happy) → 3 triples = 3 records + summary {recorded:3,deduped:0}', () => {
  const r = run([...RR_BASE,
    '--review', '03-code-reviewer.nova|structural|pass',
    '--review', '12-security-engineer.atlas|test-run|partial',
    '--review', '07-honesty-auditor.sol|structural|fail',
  ]);
  assert.strictEqual(r.code, 0, `exit 0 (stderr=${r.err})`);
  const summary = JSON.parse(r.out);
  assert.strictEqual(summary.recorded, 3, 'recorded 3');
  assert.strictEqual(summary.deduped, 0, 'deduped 0');
  assert.strictEqual(readLedger().length, 3, 'three records persisted to the ledger');
});

// (b) malformed --review (≠ 3 parts) → exit 1, NOTHING written (the bad value is named).
test('record-review malformed --review (2 parts) → exit 1, naming the value, nothing written', () => {
  const r = run([...RR_BASE,
    '--review', '03-code-reviewer.nova|pass', // only 2 parts
  ]);
  assert.strictEqual(r.code, 1, 'exit 1');
  assert.ok(/"03-code-reviewer.nova\|pass"/.test(r.err), 'names the bad value');
  assert.ok(/exactly 3/.test(r.err) && !/at Object\.|at Module/.test(r.err), 'clean message, no stack');
  assert.strictEqual(readLedger().length, 0, 'ALL-OR-NOTHING: nothing written');
});

test('record-review --review with empty part (i||pass) → exit 1, nothing written', () => {
  const r = run([...RR_BASE, '--review', 'i||pass']);
  assert.strictEqual(r.code, 1, 'exit 1');
  assert.ok(/non-empty/.test(r.err), 'empty-part rejected');
  assert.strictEqual(readLedger().length, 0, 'nothing written');
});

// (c) pre-validation failure among GOOD triples → exit 1, ledger UNCHANGED (the atomicity contract).
test('record-review one bad verdict among good triples → exit 1, ledger unchanged (all-or-nothing)', () => {
  const r = run([...RR_BASE,
    '--review', '03-code-reviewer.nova|structural|pass',  // good
    '--review', '12-security-engineer.atlas|structural|MAYBE', // bad verdict
    '--review', '07-honesty-auditor.sol|structural|fail',  // good
  ]);
  assert.strictEqual(r.code, 1, 'exit 1');
  assert.ok(/verdict must be pass\|partial\|fail/.test(r.err), 'bad verdict named');
  assert.strictEqual(readLedger().length, 0, 'ALL-OR-NOTHING: not even the good triples were written');
});

test('record-review over-long field among good triples → exit 1, ledger unchanged', () => {
  const longId = 'x'.repeat(513); // > MAX_FIELD_LEN (512)
  const r = run([...RR_BASE,
    '--review', '03-code-reviewer.nova|structural|pass', // good
    '--review', `${longId}|structural|pass`, // identity over the cap
  ]);
  assert.strictEqual(r.code, 1, 'exit 1');
  assert.ok(/512 chars/.test(r.err), 'over-length field rejected with the cap named');
  assert.strictEqual(readLedger().length, 0, 'ALL-OR-NOTHING: nothing written');
});

test('record-review bad subject-persona (over-long) → exit 1, nothing written', () => {
  const longP = 'p'.repeat(513);
  const r = run(['record-review', '--subject-persona', longP, '--agent-id', 'abc123',
    '--review', '03-code-reviewer.nova|structural|pass']);
  assert.strictEqual(r.code, 1, 'exit 1');
  assert.ok(/subject-persona/.test(r.err), 'subject-persona rejected');
  assert.strictEqual(readLedger().length, 0, 'nothing written');
});

test('record-review missing --agent-id → exit 1, nothing written', () => {
  const r = run(['record-review', '--subject-persona', 'node-backend',
    '--review', '03-code-reviewer.nova|structural|pass']);
  assert.strictEqual(r.code, 1, 'exit 1');
  assert.ok(/agent-id/.test(r.err) && !/at Object\.|at Module/.test(r.err), 'clean message about agent-id');
  assert.strictEqual(readLedger().length, 0, 'nothing written');
});

// (d) duplicate triple in one batch → records one, dedups the second (the store dedups an identical
//     (spawn, verifier, kind, verdict) replay; distinct verifiers still accumulate).
test('record-review duplicate triple → records 1, dedups 1 (one ledger record)', () => {
  const r = run([...RR_BASE,
    '--review', '03-code-reviewer.nova|structural|pass',
    '--review', '03-code-reviewer.nova|structural|pass', // identical replay
  ]);
  assert.strictEqual(r.code, 0, `exit 0 (stderr=${r.err})`);
  const summary = JSON.parse(r.out);
  assert.strictEqual(summary.recorded, 1, 'recorded 1');
  assert.strictEqual(summary.deduped, 1, 'deduped 1');
  assert.strictEqual(readLedger().length, 1, 'only one record persisted (dedup by content-address)');
});

test('record-review distinct verifiers, same verdict → both ACCUMULATE (not deduped)', () => {
  const r = run([...RR_BASE,
    '--review', '03-code-reviewer.nova|structural|pass',
    '--review', '12-security-engineer.atlas|structural|pass', // different identity → distinct id
  ]);
  assert.strictEqual(r.code, 0);
  const summary = JSON.parse(r.out);
  assert.strictEqual(summary.recorded, 2, 'two distinct verifiers accumulate');
  assert.strictEqual(summary.deduped, 0, 'nothing deduped');
});

// (e) auto-enrich throw → records persisted, exit 0 + stderr WARNING. We stub the enrich path via a
//     tiny harness (the CLI destructures enrichLedger at require time, so mutating the export object
//     BEFORE require()ing the CLI rebinds it to the throwing stub). The spec explicitly permits
//     stubbing/redirecting the enrich path for this case.
test('record-review auto-enrich throws → records persisted, exit 0, stderr warning', () => {
  const enrichPath = JSON.stringify(path.join(REPO_ROOT, 'packages', 'lab', 'verdict-attestation', 'enrich-from-spawn-state'));
  const cliPath = JSON.stringify(CLI);
  const harness = path.join(os.tmpdir(), `w1-cli-harness-${rid}.js`);
  fs.writeFileSync(harness, [
    "'use strict';",
    `const enrichMod = require(${enrichPath});`,
    "enrichMod.enrichLedger = () => { throw new Error('simulated fs boom'); };",
    `const cli = require(${cliPath});`,
    'cli.main(process.argv.slice(2));',
    '',
  ].join('\n'));
  try {
    const res = spawnSync(process.execPath, [harness,
      'record-review', '--subject-persona', 'node-backend', '--agent-id', 'a104143b476ed011f',
      '--review', '03-code-reviewer.nova|structural|pass'], {
      env: { ...process.env, LOOM_LAB_STATE_DIR: LAB_TMP, LOOM_SPAWN_STATE_DIR: SPAWN_TMP },
      encoding: 'utf8',
    });
    assert.strictEqual(res.status, 0, `exit 0 despite enrich throw (stderr=${res.stderr})`);
    assert.ok(/records persisted; enrich failed: simulated fs boom/.test(res.stderr || ''), 'stderr names the enrich failure');
    assert.ok(/run `enrich` to resolve links/.test(res.stderr || ''), 'stderr suggests re-running enrich');
    const summary = JSON.parse(res.stdout);
    assert.strictEqual(summary.recorded, 1, 'the record persisted (the load-bearing part)');
    assert.strictEqual(summary.enriched, null, 'enriched is null when enrich threw');
    assert.strictEqual(readLedger().length, 1, 'the record is on disk');
  } finally {
    try { fs.rmSync(harness, { force: true }); } catch { /* */ }
  }
});

// (f) --no-enrich → records, skips enrich (enriched/unresolved are null; no enrich attempted).
test('record-review --no-enrich → records, skips enrich (enriched:null)', () => {
  const r = run([...RR_BASE, '--review', '03-code-reviewer.nova|structural|pass', '--no-enrich']);
  assert.strictEqual(r.code, 0, `exit 0 (stderr=${r.err})`);
  const summary = JSON.parse(r.out);
  assert.strictEqual(summary.recorded, 1, 'recorded 1');
  assert.strictEqual(summary.enriched, null, 'enrich skipped → null');
  assert.strictEqual(summary.unresolved, null, 'enrich skipped → null');
  assert.ok(!/enrich failed/.test(r.err), 'no enrich-failure warning when skipped');
  assert.strictEqual(readLedger().length, 1, 'the record persisted');
});

// (g) empty batch (no --review) → exit 1, nothing written.
test('record-review with no --review → exit 1, nothing written', () => {
  const r = run([...RR_BASE]);
  assert.strictEqual(r.code, 1, 'exit 1');
  assert.ok(/at least one --review/.test(r.err), 'empty batch rejected');
  assert.strictEqual(readLedger().length, 0, 'nothing written');
});

test('record-review bare --no-enrich with no --review → exit 1 (empty batch beats the flag)', () => {
  const r = run([...RR_BASE, '--no-enrich']);
  assert.strictEqual(r.code, 1, 'exit 1');
  assert.ok(/at least one --review/.test(r.err), 'empty batch still rejected');
});

// --expires-after-days carries on record-review too (NaN guard, before any write).
test('record-review --expires-after-days abc → exit 1 (NaN guard), nothing written', () => {
  const r = run([...RR_BASE, '--review', '03-code-reviewer.nova|structural|pass', '--expires-after-days', 'abc']);
  assert.strictEqual(r.code, 1, 'exit 1');
  assert.ok(/whole number/.test(r.err), 'non-numeric rejected');
  assert.strictEqual(readLedger().length, 0, 'rejected before any write');
});

// VALIDATE hacker L-1: --expires-after-days is decimal-whole + ceiling-bounded (reject hex/exponent
// footguns + an absurd magnitude), before any write.
test('record-review --expires-after-days non-decimal / over-ceiling → exit 1, nothing written', () => {
  const hex = run([...RR_BASE, '--review', '03-code-reviewer.nova|structural|pass', '--expires-after-days', '0x10']);
  assert.strictEqual(hex.code, 1, 'hex rejected (exit 1)');
  assert.ok(/whole number/.test(hex.err), 'decimal-only message');
  const huge = run([...RR_BASE, '--review', '03-code-reviewer.nova|structural|pass', '--expires-after-days', '99999999']);
  assert.strictEqual(huge.code, 1, 'over-ceiling rejected (exit 1)');
  assert.ok(/between 1 and/.test(huge.err), 'ceiling message');
  assert.strictEqual(readLedger().length, 0, 'neither wrote anything');
});

// VALIDATE hacker M-2: the --review batch is count-capped (bounds the O(N²) whole-ledger re-serialize).
test('record-review over-cap batch (> MAX_REVIEWS_PER_BATCH) → exit 1, nothing written', () => {
  const many = [];
  for (let i = 0; i < 65; i += 1) { many.push('--review', `r${i}|structural|pass`); } // 65 distinct > 64
  const r = run([...RR_BASE, ...many]);
  assert.strictEqual(r.code, 1, 'exit 1');
  assert.ok(/too many --review/.test(r.err), 'batch cap enforced (pre-write)');
  assert.strictEqual(readLedger().length, 0, 'over-cap batch wrote nothing');
});

// (h) REGRESSION: parseArgs (the shared last-wins parser) is byte-unchanged for existing subcommands.
// Asserted two ways: (1) parseArgs() still last-wins + bare-flag→true exactly as before; (2) the
// single-value `record` path still behaves identically (a fresh record + correct dedup on replay).
test('regression: parseArgs is unchanged (last-wins + bare-flag→true)', () => {
  const { parseArgs } = require(CLI);
  // last-wins on a repeated key (the property record-review needed a SEPARATE walk for):
  assert.deepStrictEqual(
    parseArgs(['--verdict', 'pass', '--verdict', 'fail']),
    { verdict: 'fail' },
    'last-wins preserved (a repeated --verdict keeps the LAST)',
  );
  // bare flag → true; "--flag value" → value:
  assert.deepStrictEqual(
    parseArgs(['--no-enrich', '--agent-id', 'abc']),
    { 'no-enrich': true, 'agent-id': 'abc' },
    'bare flag → true; valued flag → value',
  );
});

test('regression: record subcommand still records + dedups identically', () => {
  const r1 = run(RECORD_ARGS);
  assert.strictEqual(r1.code, 0, 'first record exit 0');
  assert.ok(/"attestation_id"/.test(r1.out), 'first record prints a record');
  const r2 = run(RECORD_ARGS); // identical replay
  assert.strictEqual(r2.code, 0, 'replay exit 0');
  assert.ok(/"deduped": true/.test(r2.out), 'identical replay dedups (store contract unchanged)');
  assert.strictEqual(readLedger().length, 1, 'still one record after the replay');
});

process.stdout.write(`\ncli.test.js (verdict-attestation): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
