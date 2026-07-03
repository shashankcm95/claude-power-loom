'use strict';

// @loom-layer: lab (test)
//
// VC-W2a — the PURE anti-bypass disposition-decider. Proves the folded VERIFY table: EMIT ONLY on a
// SEALED resolved pass (never a gameable observed-pass — hacker VERIFY C1); no-observed-tests => BLOCK
// (O-NULL); KILLED_FOR_DOS => BLOCK (anti-bypass); backend-threw => BLOCK (NOT fail-open, hacker H2);
// only no-attested-backend fails OPEN (loom-side, pre-candidate); fail-CLOSED default on any
// unrecognized/garbage verdict (non-vacuous). UNWIRED — this is the pure decider only (no I/O).

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { decideDisposition } = require(path.join(REPO, 'packages', 'lab', 'verify-container', 'disposition-decider.js'));
const { RESULT_CLASS } = require(path.join(REPO, 'packages', 'lab', 'issue-corpus', 'container-adapter.js'));

const CR = RESULT_CLASS.CONTAINED_RESULT;
const SF = RESULT_CLASS.SETUP_FAILURE;
const DOS = RESULT_CLASS.KILLED_FOR_DOS;

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function emits(verdict, msg) { const d = decideDisposition(verdict); assert.strictEqual(d.emit, true, `${msg} (got reason=${d.reason})`); return d; }
function blocks(verdict, msg) { const d = decideDisposition(verdict); assert.strictEqual(d.emit, false, `${msg} (got reason=${d.reason})`); return d; }

// === EMIT cases (the ONLY two ways to pass the gate) ===

test('EMIT: CONTAINED_RESULT + resolved===true (the sealed regression pass) => emit "resolved"', () => {
  assert.strictEqual(emits({ result_class: CR, reason: 'all-observed-pass', resolved: true }, 'a sealed resolved pass emits').reason, 'resolved');
});

test('EMIT: SETUP_FAILURE + no-attested-backend (loom-side infra, pre-candidate) => emit "loom-infra-advisory"', () => {
  assert.strictEqual(emits({ result_class: SF, reason: 'no-attested-backend' }, 'the ONE loom-side fail-open emits').reason, 'loom-infra-advisory');
});

// === C1 — the load-bearing anti-bypass: an UNSEALED observed-pass must NEVER emit ===

test('C1 BLOCK: CONTAINED_RESULT + all-observed-pass but NO sealed resolved => BLOCK "unsealed-pass" (gameable)', () => {
  assert.strictEqual(blocks({ result_class: CR, reason: 'all-observed-pass' }, 'an unsealed observed-pass is gameable => BLOCK').reason, 'unsealed-pass');
});

test('C1 BLOCK: resolved must be STRICT === true (1 / "true" / truthy does NOT emit)', () => {
  for (const r of [1, 'true', {}, 'yes']) {
    blocks({ result_class: CR, reason: 'all-observed-pass', resolved: r }, `resolved=${JSON.stringify(r)} is not strict true => BLOCK`);
  }
});

// === BLOCK cases (fail-closed) ===

test('BLOCK: CONTAINED_RESULT + resolved===false (a sealed-set red) => "sealed-regression-failed"', () => {
  assert.strictEqual(blocks({ result_class: CR, reason: 'test-failed', resolved: false }, 'a sealed red blocks').reason, 'sealed-regression-failed');
});

test('BLOCK: CONTAINED_RESULT + test-failed (unsealed honest red) => "test-failed"', () => {
  assert.strictEqual(blocks({ result_class: CR, reason: 'test-failed' }, 'an honest red blocks').reason, 'test-failed');
});

test('O-NULL BLOCK: CONTAINED_RESULT + no-observed-tests => "zero-observed-signal" (a one-line gate-skip must fail closed)', () => {
  assert.strictEqual(blocks({ result_class: CR, reason: 'no-observed-tests' }, 'zero observed signal blocks').reason, 'zero-observed-signal');
});

test('anti-bypass BLOCK: KILLED_FOR_DOS + resource-bound => "resource-bound-dos" (DoS-to-skip fails closed)', () => {
  assert.strictEqual(blocks({ result_class: DOS, reason: 'resource-bound' }, 'a self-DoS blocks').reason, 'resource-bound-dos');
});

test('BLOCK: SETUP_FAILURE + containment-uncertain (the candidate run never started) => BLOCK', () => {
  assert.strictEqual(blocks({ result_class: SF, reason: 'containment-uncertain' }, 'containment-uncertain blocks').reason, 'containment-uncertain');
});

test('H2 BLOCK: SETUP_FAILURE + backend-threw (conflates a candidate applyPatch throw) => BLOCK, NOT fail-open', () => {
  blocks({ result_class: SF, reason: 'backend-threw' }, 'backend-threw must NOT fail open (candidate-steerable)');
});

test('H2 BLOCK: SETUP_FAILURE + candidate-patch-apply-failed (the future adapter split) => BLOCK', () => {
  blocks({ result_class: SF, reason: 'candidate-patch-apply-failed' }, 'a candidate patch-apply throw blocks');
});

// === fail-CLOSED default (non-vacuous — inject garbage, watch BLOCK fire) ===

test('DEFAULT BLOCK (non-vacuous): unrecognized / null / undefined / garbage verdict => BLOCK', () => {
  for (const g of [null, undefined, {}, { result_class: 'BOGUS' }, { result_class: null }, 42, 'x', { result_class: CR }]) {
    blocks(g, `garbage ${JSON.stringify(g)} fails closed`);
  }
  assert.strictEqual(decideDisposition(null).reason, 'unrecognized', 'a null verdict => unrecognized');
  assert.strictEqual(decideDisposition({ result_class: 'BOGUS' }).reason, 'unrecognized', 'an unknown class => unrecognized');
});

test('anti-bypass: resolved===true on a NON-CONTAINED class does NOT emit (resolved is trustworthy ONLY for CONTAINED_RESULT)', () => {
  blocks({ result_class: SF, reason: 'containment-uncertain', resolved: true }, 'a SETUP_FAILURE + resolved:true still BLOCKs (resolved ignored off CONTAINED)');
  blocks({ result_class: DOS, reason: 'resource-bound', resolved: true }, 'a KILLED_FOR_DOS + resolved:true still BLOCKs');
  blocks({ result_class: 'BOGUS', resolved: true }, 'an unknown class + resolved:true still BLOCKs');
});

test('M1 own-property guard: an INHERITED (Object.create prototype) result_class does NOT reach EMIT', () => {
  blocks(Object.create({ result_class: CR }), 'an inherited result_class + no own props => BLOCK');
  const p1 = Object.create({ result_class: CR }); p1.resolved = true;   // own resolved:true, INHERITED class
  blocks(p1, 'inherited CONTAINED class + own resolved:true => BLOCK (own-prop guard defeats the prototype smuggle)');
  blocks(Object.create({ result_class: SF, reason: 'no-attested-backend' }), 'inherited SETUP + inherited loom-side reason => BLOCK');
});

test('M2 reason echo: a SETUP_FAILURE with an UNKNOWN/hostile reason => BLOCK "setup-unknown" (no verbatim echo); a KNOWN reason still echoes', () => {
  const hostile = `"); (allow default) ${'x'.repeat(200)}`;
  assert.strictEqual(blocks({ result_class: SF, reason: hostile }, 'a hostile reason blocks').reason, 'setup-unknown', 'the hostile reason is NOT echoed verbatim');
  assert.strictEqual(blocks({ result_class: SF, reason: 'containment-uncertain' }, 'a known reason blocks').reason, 'containment-uncertain', 'a KNOWN reason is still echoed for audit');
});

test('immutable: the decision object is frozen', () => {
  assert.ok(Object.isFrozen(decideDisposition({ result_class: CR, resolved: true })), 'the decision is frozen');
});

(async () => {
  let passed = 0; let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`  PASS ${t.name}`); passed += 1; }
    catch (e) { console.log(`  FAIL ${t.name}: ${e && e.message}`); failed += 1; }
  }
  console.log(`=== ${path.basename(__filename)}: ${passed} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
})();
