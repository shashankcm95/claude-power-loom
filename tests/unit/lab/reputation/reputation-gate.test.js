'use strict';

// v3.10-W3 — the reputation-gate advisory consumer (the spawn-narrowing decision that closes the loop
// INTERNALLY). The VERIFY board's load-bearing fold: THREE INDEPENDENT axes (reputation distribution /
// breaker / evidence-sufficiency), combined by MOST-restrictive, fail-safe to NO-SIGNAL per-axis -- never a
// single short-circuit ladder. E1-E8 below.

const assert = require('assert');
const { recommendNarrowing } = require('../../../../packages/lab/reputation/reputation-gate');
const { SOURCE } = require('../../../../packages/lab/reputation/project');

let passed = 0;
function test(name, fn) { fn(); passed += 1; }

// a projectReputation-shaped output (authenticated lane)
const rep = (personas) => ({ source: SOURCE, label: 'x', excluded_unenriched: 0, excluded_malformed: 0, personas });
const persona = (p, pass, partial = 0, fail = 0) => ({ persona: p, total: pass + partial + fail, by_verdict: { pass, partial, fail } });
const recOf = (out, c) => out.find((r) => r.candidate === c);
const OPTS = { minEvidence: 5, passFloor: 0.5 };
const trippedBreaker = () => ({ tripped: true, source_starved: false });
const cleanBreaker = () => ({ tripped: false, source_starved: false });
const starvedBreaker = () => ({ tripped: true, source_starved: true }); // tripped but source is starved

test('W3-E1 discrimination — A all-pass -> proceed; B mostly-fail -> down-weight; tripped -> reroute', () => {
  const out = recommendNarrowing(['A', 'B', 'C'], rep([persona('A', 6, 0, 0), persona('B', 1, 0, 5), persona('C', 6)]),
    (c) => (c === 'C' ? trippedBreaker() : cleanBreaker()), OPTS);
  assert.strictEqual(recOf(out, 'A').recommendation, 'proceed', 'all-pass over threshold -> proceed');
  assert.strictEqual(recOf(out, 'B').recommendation, 'down-weight', '1/6 pass < 0.5 -> down-weight');
  assert.strictEqual(recOf(out, 'C').recommendation, 'reroute', 'tripped breaker -> reroute');
});

test('W3-E1 INDEPENDENT axes — a THIN persona under a TRIPPED breaker -> reroute (axis B not swallowed by axis-A thinness)', () => {
  const out = recommendNarrowing(['T'], rep([persona('T', 1)]), () => trippedBreaker(), OPTS); // total 1 < minEvidence 5
  assert.strictEqual(recOf(out, 'T').recommendation, 'reroute', 'thin reputation must NOT swallow a tripped breaker');
});

test('W3-E1 partial counts as NON-passing -> a partial-heavy persona (0 fail) down-weights', () => {
  const out = recommendNarrowing(['P'], rep([persona('P', 1, 5, 0)]), () => cleanBreaker(), OPTS); // pass_ratio 1/6 < 0.5
  assert.strictEqual(recOf(out, 'P').recommendation, 'down-weight');
  assert.strictEqual(recOf(out, 'P').evidence.pass_ratio, 1 / 6);
});

test('W3-E2 per-axis fail-safe — source_starved suppresses ONLY the breaker axis, NOT the reputation down-weight', () => {
  // a poor distribution + a STARVED breaker source: axis A still down-weights (one env var must not neutralize it).
  const out = recommendNarrowing(['B'], rep([persona('B', 1, 0, 5)]), () => starvedBreaker(), OPTS);
  assert.strictEqual(recOf(out, 'B').recommendation, 'down-weight', 'a starved breaker source cannot neutralize the reputation axis');
  assert.strictEqual(recOf(out, 'B').evidence.source_starved, true);
  assert.strictEqual(recOf(out, 'B').evidence.breaker_tripped, false, 'starved -> no breaker signal');
});

test('W3-E2 thin/no-row -> proceed; EMPTY projection -> ALL proceed', () => {
  const out = recommendNarrowing(['X', 'Y'], rep([]), () => cleanBreaker(), OPTS);
  assert.ok(out.every((r) => r.recommendation === 'proceed'), 'empty projection -> all proceed');
  assert.strictEqual(recOf(out, 'X').reason, 'no-row');
});

test('W3-E4 authenticated-lane ENFORCED — a non-verdict-attestation source -> ALL proceed reason unauthenticated-lane', () => {
  const mirror = { source: 'mock', personas: [persona('B', 1, 0, 5)] }; // a hardening-signal-shaped mirror
  const out = recommendNarrowing(['B'], mirror, () => trippedBreaker(), OPTS);
  assert.strictEqual(recOf(out, 'B').recommendation, 'proceed', 'mirror lane must never narrow trust');
  assert.strictEqual(recOf(out, 'B').reason, 'unauthenticated-lane');
  // also a non-array personas / null reputation
  assert.strictEqual(recommendNarrowing(['B'], { source: SOURCE, personas: null }, null, OPTS)[0].reason, 'unauthenticated-lane');
  assert.strictEqual(recommendNarrowing(['B'], null, null, OPTS)[0].reason, 'unauthenticated-lane');
});

test('W3-E5 advisory — no output is ever `exclude`; the worst is reroute', () => {
  const out = recommendNarrowing(['A', 'B', 'C'], rep([persona('A', 6), persona('B', 0, 0, 6), persona('C', 6)]),
    (c) => (c === 'C' ? trippedBreaker() : cleanBreaker()), OPTS);
  assert.ok(out.every((r) => ['proceed', 'down-weight', 'reroute'].includes(r.recommendation)), 'no exclude');
});

test('W3-E6 NO NaN-laundering — a row over minEvidence with a stripped by_verdict -> down-weight unreadable, NEVER proceed', () => {
  const broken = rep([{ persona: 'Z', total: 9, by_verdict: { pass: 'x', partial: 0, fail: 0 } }]); // non-integer pass
  const out = recommendNarrowing(['Z'], broken, () => cleanBreaker(), OPTS);
  assert.strictEqual(recOf(out, 'Z').recommendation, 'down-weight');
  assert.strictEqual(recOf(out, 'Z').reason, 'unreadable-distribution');
  // a missing by_verdict entirely, over threshold -> same
  const out2 = recommendNarrowing(['Z'], rep([{ persona: 'Z', total: 9 }]), () => cleanBreaker(), OPTS);
  assert.strictEqual(recOf(out2, 'Z').recommendation, 'down-weight');
  // total 0 is THIN (insufficient), NOT a divide-by-zero -> proceed with reason insufficient-evidence
  const out3 = recommendNarrowing(['Z'], rep([{ persona: 'Z', total: 0, by_verdict: { pass: 0, partial: 0, fail: 0 } }]), () => cleanBreaker(), { minEvidence: 0, passFloor: 0.5 });
  assert.strictEqual(recOf(out3, 'Z').recommendation, 'proceed', 'total 0 -> thin/insufficient, no divide-by-zero');
  assert.strictEqual(recOf(out3, 'Z').reason, 'insufficient-evidence', 'total 0 reason is insufficient-evidence, NOT sufficient-pass (reviewer LOW)');
});

test('W3-E8b a THROWING getter on the breaker decision must NOT crash the consumer (VALIDATE-hacker HIGH)', () => {
  const r = rep([persona('B', 1, 0, 5)]); // a poor distribution so axis A still down-weights
  const throwTripped = () => ({ source_starved: false, get tripped() { throw new Error('getter-boom'); } });
  const throwStarved = () => ({ get source_starved() { throw new Error('getter-boom'); }, tripped: true });
  let out;
  assert.doesNotThrow(() => { out = recommendNarrowing(['B'], r, throwTripped, OPTS); }, 'a throwing .tripped getter must not crash');
  assert.strictEqual(recOf(out, 'B').recommendation, 'down-weight', 'axis A still evaluated after a breaker-getter throw');
  assert.doesNotThrow(() => { recommendNarrowing(['B'], r, throwStarved, OPTS); }, 'a throwing .source_starved getter must not crash');
});

test('W3-E9 an INCONSISTENT total (total != sum by_verdict) over minEvidence -> down-weight unreadable (no lying-total launder)', () => {
  // total clears minEvidence with a high pass count, but the buckets do not sum to total (hidden fails).
  const lying = rep([{ persona: 'L', total: 9, by_verdict: { pass: 9, partial: 0, fail: 0 } /* sums to 9 == total: consistent */ }]);
  assert.strictEqual(recOf(recommendNarrowing(['L'], lying, () => cleanBreaker(), OPTS), 'L').recommendation, 'proceed', 'a CONSISTENT all-pass row -> proceed');
  const inconsistent = rep([{ persona: 'L', total: 9, by_verdict: { pass: 9, partial: 0, fail: 5 } /* sums to 14 != 9 */ }]);
  assert.strictEqual(recOf(recommendNarrowing(['L'], inconsistent, () => cleanBreaker(), OPTS), 'L').recommendation, 'down-weight', 'total != sum -> down-weight, never launder');
  // a malformed (negative / non-int) total on an existing row -> down-weight, not proceed-as-thin
  assert.strictEqual(recOf(recommendNarrowing(['L'], rep([{ persona: 'L', total: -3, by_verdict: { pass: 0, partial: 0, fail: 0 } }]), () => cleanBreaker(), OPTS), 'L').recommendation, 'down-weight');
});

test('W3-E10 a DUPLICATE persona key -> down-weight (fail toward narrowing; a tampered dup cannot clobber a bad row)', () => {
  // the append-attack: an all-fail row then an all-pass dup. last-wins would launder; we down-weight instead.
  const dup = rep([persona('D', 0, 0, 9), persona('D', 9, 0, 0)]);
  assert.strictEqual(recOf(recommendNarrowing(['D'], dup, () => cleanBreaker(), OPTS), 'D').recommendation, 'down-weight');
  assert.strictEqual(recOf(recommendNarrowing(['D'], dup, () => cleanBreaker(), OPTS), 'D').reason, 'duplicate-row');
});

test('W3-E11 invalid opts fall back to DEFAULTS (cannot silently disable an axis — VALIDATE-hacker LOW)', () => {
  const bad = rep([persona('B', 1, 0, 5)]); // pass_ratio 1/6, would down-weight at the default passFloor 0.5
  // minEvidence NaN/Infinity would make total>=minEvidence always false (axis off) -> must fall back to 5; but
  // total is 6 >= 5 so it down-weights under the default.
  assert.strictEqual(recOf(recommendNarrowing(['B'], rep([persona('B', 1, 0, 5)]), () => cleanBreaker(), { minEvidence: NaN }), 'B').recommendation, 'down-weight', 'NaN minEvidence -> default 5');
  assert.strictEqual(recOf(recommendNarrowing(['B'], rep([persona('B', 1, 0, 5)]), () => cleanBreaker(), { minEvidence: Infinity }), 'B').recommendation, 'down-weight', 'Infinity minEvidence -> default 5');
  // passFloor out of [0,1] -> default 0.5
  assert.strictEqual(recOf(recommendNarrowing(['B'], bad, () => cleanBreaker(), { passFloor: 99 }), 'B').recommendation, 'down-weight', 'out-of-range passFloor -> default 0.5');
  // a null / non-object opts must NOT crash (CodeRabbit #326) -> falls back to defaults
  assert.doesNotThrow(() => recommendNarrowing(['B'], bad, () => cleanBreaker(), null), 'null opts must not crash');
  assert.strictEqual(recOf(recommendNarrowing(['B'], bad, () => cleanBreaker(), null), 'B').recommendation, 'down-weight', 'null opts -> defaults (minEvidence 5, passFloor 0.5)');
  assert.doesNotThrow(() => recommendNarrowing(['B'], bad, () => cleanBreaker(), 'nope'), 'non-object opts must not crash');
});

test('W3-E7 __proto__/prototype-key safety — a candidate/persona key of __proto__ resolves via Map (no launder)', () => {
  const out = recommendNarrowing(['__proto__', 'constructor'], rep([persona('__proto__', 0, 0, 6)]), () => cleanBreaker(), OPTS);
  // __proto__ has a real all-fail row -> must down-weight (a plain-object index would miss it -> launder to proceed)
  assert.strictEqual(recOf(out, '__proto__').recommendation, 'down-weight', '__proto__ key must resolve to its real row');
  assert.strictEqual(recOf(out, 'constructor').recommendation, 'proceed', 'no row for constructor -> proceed (no prototype walk)');
});

test('W3-E8 breakerOf MUST NOT crash the consumer — a thrown breakerOf is caught as null (no reroute; axis A still evaluated)', () => {
  const out = recommendNarrowing(['B'], rep([persona('B', 1, 0, 5)]), () => { throw new Error('boom'); }, OPTS);
  assert.strictEqual(recOf(out, 'B').recommendation, 'down-weight', 'a throwing breaker must not crash; axis A still down-weights');
  assert.strictEqual(recOf(out, 'B').evidence.breaker_tripped, false);
});

console.log(`reputation-gate.test.js: ${passed} passed`);
