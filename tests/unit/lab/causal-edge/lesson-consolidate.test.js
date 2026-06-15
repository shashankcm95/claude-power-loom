#!/usr/bin/env node

// tests/unit/lab/causal-edge/lesson-consolidate.test.js
//
// v3.11 W1 — the consolidation pass (DEF-3 raw-collision diagnostic). PURE core +
// dir-injectable write. Pins: same-signature lessons roll into one weighted entry;
// the count is RAW (confirmed:false — D3 gate is W2); the under-separation signal fires
// when distinct issues collide in one cell; the report is deterministic.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { consolidateLessons, writeConsolidationReport } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'lesson-consolidate.js'));

let passed = 0; let failed = 0;
const _tests = [];
function test(name, fn) { _tests.push({ name, fn }); }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-consol-')); }

// A real node carries the on-floor block its signature re-derives from (M2: consolidate
// re-validates sig-vs-block, so a fixture must populate the block, not just the bare signature).
function node(sig, issue, id) {
  const [trigger_class, gotcha_class, corrective_class] = sig.replace('lesson:', '').split('|');
  return { node_id: id, lesson_signature: sig, trigger_class, gotcha_class, corrective_class, worked_example_ref: { issue_id: issue } };
}
const SIG_A = 'lesson:boundary-contract|unguarded-edge-case|fail-closed';
const SIG_B = 'lesson:data-parse|silent-coercion|handle-edge-explicitly';

test('same-signature lessons roll into one weighted entry; count is RAW (unconfirmed)', () => {
  const r = consolidateLessons([node(SIG_A, 'i1', 'n1'), node(SIG_A, 'i2', 'n2'), node(SIG_B, 'i3', 'n3')]);
  assert.strictEqual(r.confirmed, false, 'W1 is raw-collision only; D3 confirmation is W2');
  assert.strictEqual(r.n_lessons, 3);
  assert.strictEqual(r.n_signatures, 2);
  const a = r.per_signature.find((s) => s.lesson_signature === SIG_A);
  assert.strictEqual(a.recurrence_count_raw, 2);
  assert.strictEqual(a.distinct_issues, 2);
});

test('the DEF-3 under-separation signal fires when distinct issues collide in one cell', () => {
  const r = consolidateLessons([node(SIG_A, 'i1', 'n1'), node(SIG_A, 'i2', 'n2'), node(SIG_B, 'i3', 'n3')]);
  assert.deepStrictEqual(r.under_separation_signatures, [SIG_A]); // SIG_A has 2 distinct issues; SIG_B has 1
});

test('non-lesson nodes are ignored; empty input is a clean empty report', () => {
  assert.strictEqual(consolidateLessons([{ node_id: 'x' }, null, 42]).n_lessons, 0);
  assert.strictEqual(consolidateLessons([]).n_signatures, 0);
  assert.strictEqual(consolidateLessons(null).n_lessons, 0);
});

// VALIDATE-hacker M2: consolidateLessons is EXPORTED — it must re-validate a stored signature
// against its block (a future caller passing raw disk nodes must not corrupt the DEF-3 signal).
test('M2: a forged-signature node (sig != its block) is skipped from the tally', () => {
  const good = node(SIG_A, 'i1', 'n1');
  good.trigger_class = 'boundary-contract'; good.gotcha_class = 'unguarded-edge-case'; good.corrective_class = 'fail-closed';
  const forged = node('lesson:FORGED|BANANA|HACK', 'i2', 'n2'); // no on-floor block backing the signature
  const offFloor = { node_id: 'n3', lesson_signature: SIG_A, trigger_class: 'auth-or-gate', gotcha_class: 'unguarded-edge-case', corrective_class: 'fail-closed', worked_example_ref: { issue_id: 'i3' } };
  const r = consolidateLessons([good, forged, offFloor]);
  assert.strictEqual(r.n_lessons, 1, 'only the re-derivable, on-floor node counts');
  assert.deepStrictEqual(r.per_signature.map((s) => s.lesson_signature), [SIG_A]);
});

test('the report is deterministic (signatures sorted; same input -> same output)', () => {
  const input = [node(SIG_B, 'i3', 'n3'), node(SIG_A, 'i1', 'n1')];
  const r1 = consolidateLessons(input);
  const r2 = consolidateLessons([...input].reverse());
  assert.deepStrictEqual(r1.per_signature.map((s) => s.lesson_signature), [SIG_A, SIG_B]); // sorted
  assert.deepStrictEqual(r1.per_signature.map((s) => s.lesson_signature), r2.per_signature.map((s) => s.lesson_signature));
});

test('writeConsolidationReport writes a stamped JSON (injectable now + file)', () => {
  const dir = tmp();
  const file = path.join(dir, 'consolidation-report.json');
  const r = consolidateLessons([node(SIG_A, 'i1', 'n1')]);
  const w = writeConsolidationReport(r, { file, now: '2026-06-15T00:00:00.000Z' });
  assert.strictEqual(w.ok, true);
  const back = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(back.generated_at, '2026-06-15T00:00:00.000Z');
  assert.strictEqual(back.n_lessons, 1);
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && e.message}`); }
  }
  console.log(`\nlesson-consolidate: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
