#!/usr/bin/env node

// tests/unit/lab/persona-experiment/live-solve-one.test.js
//
// The single-issue CLI front door. Locks: strict target/flag parsing (coercion-prone issue numbers
// rejected at the boundary), the fetch->loop wiring, and — the load-bearing property — the SHADOW-dry
// guarantee as a TESTED invariant: no egress-custody / emit / deps key is ever threaded to the loop, the
// CLI sets ONLY LOOM_PERSONA_MATERIALIZE, and it imports no egress-arming module. The fetch + loop are
// INJECTED seams (no network, no container).

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const os = require('os');
const { run, parseTarget, parseFlags, appendOutcomeLedger } = require(path.join(REPO, 'packages', 'lab', 'persona-experiment', 'live-solve-one.js'));

let passed = 0; let failed = 0;
const pending = [];
function test(name, fn) {
  pending.push(
    Promise.resolve().then(fn)
      .then(() => { process.stdout.write(`  PASS ${name}\n`); passed++; })
      .catch((err) => { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }),
  );
}

function okReport(record, over) {
  return Object.assign({
    runId: 'x', total: 1, fatal: null,
    outcomes: [Object.assign({
      record_id: record.id, stage: 'draft', ok: true, reason: 'draft-written',
      persona: 'python-backend', classify_signal: 'matched',
      verdict: { semantic_supported: true, friction: { friction_class: 'incorrect-implementation' }, behavioral: 'UNAVAILABLE' },
      cost_usd: 0, artifact: '/tmp/draft.json',
    }, (over && over.outcome) || {})],
  }, (over && over.report) || {});
}

// ── parsing ──
test('r1. parseTarget — valid; the extra "/" stays in repo (rejected downstream, not silently dropped)', () => {
  assert.deepStrictEqual(parseTarget('octo/widget#7'), { owner: 'octo', repo: 'widget', number: 7 });
  assert.deepStrictEqual(parseTarget('foo/bar/baz#7'), { owner: 'foo', repo: 'bar/baz', number: 7 });
});
test('r2. parseTarget REJECTS malformed targets + coercion-prone issue numbers (#2e3 / #0x1F / # 5 / 17-digit)', () => {
  for (const bad of ['no-hash', '#7', 'owner#7', 'owner/#7', '/repo#7', 'owner/repo#', 'owner/repo#2e3',
    'owner/repo#0x1F', 'owner/repo# 5', 'owner/repo#12345678901234567', 42, null]) {
    assert.throws(() => parseTarget(bad), /usage/i, JSON.stringify(bad));
  }
});
test('r3. parseFlags — defaults, overrides, and usage errors', () => {
  assert.deepStrictEqual(parseFlags(['o/r#7']).flags, { model: 'claude-sonnet-4-6', maxBudgetUsd: 12, materialize: false, json: false, rebuildImage: false });
  assert.strictEqual(parseFlags(['o/r#7', '--model', 'claude-opus-4-8']).flags.model, 'claude-opus-4-8');
  assert.strictEqual(parseFlags(['o/r#7', '--max-budget-usd', '5']).flags.maxBudgetUsd, 5);
  assert.strictEqual(parseFlags(['o/r#7', '--materialize']).flags.materialize, true);
  assert.strictEqual(parseFlags(['o/r#7', '--rebuild-image']).flags.rebuildImage, true);
  assert.throws(() => parseFlags(['o/r#7', '--nope']), /unknown flag/i);
  assert.throws(() => parseFlags(['o/r#7', '--max-budget-usd', '-1']), /positive/i);
  assert.throws(() => parseFlags(['o/r#7', '--model']), /requires a value/i);
  assert.throws(() => parseFlags([]), /target is required/i);
});

// ── the load-bearing SHADOW-dry wiring ──
test('r4. run() wires fetch->loop with capUsd/model + NO egress-custody key; prints the SHADOW summary', async () => {
  let loopArgs = null;
  const record = { id: 'octo__widget-issue-7', repo: 'https://github.com/octo/widget', base_sha: 'a'.repeat(40), problem_statement: 'x' };
  const fetchFn = (a) => { assert.deepStrictEqual(a, { owner: 'octo', repo: 'widget', number: 7 }); return record; };
  const draftFn = (args) => { loopArgs = args; return okReport(record); };
  const out = [];
  const report = await run(['octo/widget#7'], { fetchFn, draftFn, logFn: (s) => out.push(s) });

  assert.deepStrictEqual(loopArgs.records, [record]);
  assert.strictEqual(loopArgs.capUsd, 12);
  assert.strictEqual(loopArgs.model, 'claude-sonnet-4-6');
  // SHADOW-dry INVARIANT: not one egress-custody / emit / deps key reaches the loop.
  for (const k of ['custodyTokenPath', 'ghConfigDir', 'custodyApprovalsDir', 'killswitchPath',
    'custodyDispositionPath', 'emitFn', 'deps', 'loopDeps', 'token', 'armedEmitFn']) {
    assert.ok(!(k in loopArgs), `loop opts must not carry ${k}`);
  }
  assert.ok(out.join('\n').includes('python-backend'), 'summary shows the classified persona');
  assert.ok(out.join('\n').includes('emitted:false'), 'summary marks the draft SHADOW/dry');
  assert.strictEqual(report.outcomes[0].ok, true);
});

test('r5. --max-budget-usd maps to capUsd (not estimatedUsd); --model threads through', async () => {
  let loopArgs = null;
  const record = { id: 'o__r-issue-1', repo: 'https://github.com/o/r', base_sha: 'a'.repeat(40), problem_statement: 'x' };
  await run(['o/r#1', '--max-budget-usd', '3', '--model', 'claude-opus-4-8'],
    { fetchFn: () => record, draftFn: (a) => { loopArgs = a; return okReport(record); }, logFn: () => {} });
  assert.strictEqual(loopArgs.capUsd, 3);
  assert.strictEqual(loopArgs.estimatedUsd, undefined);
  assert.strictEqual(loopArgs.model, 'claude-opus-4-8');
});

test('r6. --materialize SCOPES LOOM_PERSONA_MATERIALIZE to the run (set during solve, RESTORED after)', async () => {
  const prev = process.env.LOOM_PERSONA_MATERIALIZE;
  try {
    delete process.env.LOOM_PERSONA_MATERIALIZE;
    const record = { id: 'o__r-issue-1', repo: 'https://github.com/o/r', base_sha: 'a'.repeat(40), problem_statement: 'x' };
    let duringRun;
    const draftFn = () => { duringRun = process.env.LOOM_PERSONA_MATERIALIZE; return okReport(record); };
    await run(['o/r#1', '--materialize'], { fetchFn: () => record, draftFn, logFn: () => {} });
    assert.strictEqual(duringRun, '1', 'set DURING the solve');
    assert.strictEqual(process.env.LOOM_PERSONA_MATERIALIZE, undefined, 'RESTORED after (not an un-scoped global) — hacker M2');
  } finally { if (prev === undefined) delete process.env.LOOM_PERSONA_MATERIALIZE; else process.env.LOOM_PERSONA_MATERIALIZE = prev; }
});

test('r7. run() propagates a fetch refusal (main() turns it into a clean non-zero exit)', async () => {
  const fetchFn = () => { throw new Error('fetchOneIssueRecord: refuse — o/r license is not in the permissive allowlist'); };
  await assert.rejects(() => run(['o/r#7'], { fetchFn, draftFn: () => okReport({ id: 'x' }), logFn: () => {} }), /license/i);
});

test('r9. --json prints the raw report exactly once + returns it', async () => {
  const record = { id: 'o__r-issue-1', repo: 'https://github.com/o/r', base_sha: 'a'.repeat(40), problem_statement: 'x' };
  const rep = okReport(record);
  const out = [];
  const got = await run(['o/r#1', '--json'], { fetchFn: () => record, draftFn: () => rep, logFn: (s) => out.push(s) });
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(JSON.parse(out[0]), rep);
  assert.strictEqual(got, rep);
});

test('r10. a fatal report prints FATAL and does NOT crash the oc===null summary path', async () => {
  const record = { id: 'o__r-issue-1', repo: 'https://github.com/o/r', base_sha: 'a'.repeat(40), problem_statement: 'x' };
  const out = [];
  const rep = { runId: 'x', total: 1, fatal: 'containment-unattested:image-absent', outcomes: [] };
  const got = await run(['o/r#1'], { fetchFn: () => record, draftFn: () => rep, logFn: (s) => out.push(s) });
  assert.ok(out.join('\n').includes('FATAL:'));
  assert.ok(out.join('\n').includes('containment-unattested'));
  assert.strictEqual(got, rep);
});

test('r11. --model REJECTS a flag-shaped / metachar value (arg-injection into `claude --model`)', () => {
  for (const m of ['-oops', '--json', '$(rm -rf /)', 'a b', 'x;y', '../../etc', '', 'a'.repeat(65)]) {
    assert.throws(() => parseFlags(['o/r#7', '--model', m]), /model|requires a value/i, JSON.stringify(m));
  }
  assert.strictEqual(parseFlags(['o/r#7', '--model', 'claude-opus-4-8']).flags.model, 'claude-opus-4-8');
});

// ── import-exclusion: the CLI structurally cannot arm/emit ──
test('r8. live-solve-one imports NO egress-arming module + sets ONLY LOOM_PERSONA_MATERIALIZE', () => {
  const src = fs.readFileSync(path.join(REPO, 'packages', 'lab', 'persona-experiment', 'live-solve-one.js'), 'utf8');
  const requires = [...src.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
  for (const req of requires) {
    assert.ok(!/world-anchor|custody-arming|\barming\b|egress|loom-broker|loom-edge/.test(req), `must not import ${req}`);
  }
  // the DISTINCT set of env vars the CLI writes (the restore path assigns LOOM_PERSONA_MATERIALIZE twice —
  // set + restore — which is fine; the invariant is that no OTHER env var is ever touched).
  const envSets = [...new Set([...src.matchAll(/process\.env\.(LOOM_[A-Za-z_]+)\s*=/g)].map((m) => m[1]))];
  assert.deepStrictEqual(envSets, ['LOOM_PERSONA_MATERIALIZE'], 'the CLI must touch ONLY LOOM_PERSONA_MATERIALIZE');
});

// ── --timeout (observability tunability) ──
test('r12. parseFlags --timeout: valid seconds -> ms; 0 / negative / non-integer rejected; unset -> undefined', () => {
  assert.strictEqual(parseFlags(['o/r#7', '--timeout', '480']).flags.timeoutMs, 480000);
  assert.strictEqual(parseFlags(['o/r#7']).flags.timeoutMs, undefined, 'unset -> undefined (the 180s default stands downstream)');
  for (const bad of ['0', '-5', '1.5', 'abc']) {
    assert.throws(() => parseFlags(['o/r#7', '--timeout', bad]), /positive integer/i, bad);
  }
});

// ── the durable outcome ledger (failure-inclusive observability) ──
test('r13. run() appends a SUCCESS outcome to the durable outcome ledger', async () => {
  const record = { id: 'octo__widget-issue-7', repo: 'https://github.com/octo/widget', base_sha: 'a'.repeat(40), problem_statement: 'x' };
  const ledger = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lso-led-')), 'outcomes.jsonl');
  await run(['octo/widget#7', '--json'], { fetchFn: () => record, draftFn: () => okReport(record), logFn: () => {}, outcomeLedgerPath: ledger });
  const lines = fs.readFileSync(ledger, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].record_id, record.id);
  assert.strictEqual(lines[0].ok, true);
  assert.strictEqual(lines[0].stage, 'draft');
});

test('r14. run() synthesizes a FATAL ledger record when the run never starts (report.fatal + outcomes:[]) — HIGH fix', async () => {
  const record = { id: 'octo__widget-issue-7', repo: 'https://github.com/octo/widget', base_sha: 'a'.repeat(40), problem_statement: 'x' };
  const ledger = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lso-fatal-')), 'outcomes.jsonl');
  const fatalReport = { runId: 'x', total: 1, fatal: 'containment-unattested:image-absent', outcomes: [] };
  await run(['octo/widget#7', '--json'], { fetchFn: () => record, draftFn: () => fatalReport, logFn: () => {}, outcomeLedgerPath: ledger });
  const lines = fs.readFileSync(ledger, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(lines.length, 1, 'a run-level fatal must NOT vanish from the ledger (the failure it exists to surface)');
  assert.strictEqual(lines[0].ok, false);
  assert.strictEqual(lines[0].stage, 'fatal');
  assert.strictEqual(lines[0].reason, 'containment-unattested:image-absent');
  assert.strictEqual(lines[0].record_id, record.id);
});

test('r15. appendOutcomeLedger is best-effort: a bad path never throws', () => {
  assert.doesNotThrow(() => appendOutcomeLedger('/no/such/dir/x.jsonl', 'r', [{ record_id: 'a', ok: false }], 't'));
});

test('r16. appendOutcomeLedger creates a missing parent dir (fresh env -> the fatal record is NOT dropped) — CR #556', () => {
  const ledger = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lso-fresh-')), 'absent', 'checkpoints', 'outcomes.jsonl');
  appendOutcomeLedger(ledger, 'r', [{ record_id: 'a', stage: 'fatal', ok: false, reason: 'containment-unattested' }], 't');
  assert.ok(fs.existsSync(ledger), 'the ledger is written even when the parent dir did not exist');
  assert.strictEqual(JSON.parse(fs.readFileSync(ledger, 'utf8').trim()).reason, 'containment-unattested');
});

Promise.all(pending).then(() => {
  process.stdout.write(`\nlive-solve-one.test.js: ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
});
