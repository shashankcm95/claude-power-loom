#!/usr/bin/env node

// tests/unit/lab/circuit-breaker/changes-requested-source.test.js
//
// Gap-8 review-loop Wave A-2 — the `changes-requested` denial source: the breaker projecting the
// Wave A-1 review-outcome store (the FIRST consumer of that store). Template: reject-event-source.test.js
// (the SHADOW source-registration precedent).
//
// Contracts pinned here (the VERIFY board's settled design + folds):
//   - STATE-count, NOT rate-count (CR-1): a currently-blocked PR emits recorded_at = nowMs, so it is
//     always in the counting window regardless of its record's file mtime (an mtime-window would silently
//     age out a still-blocking review whose mtime froze at first-observation).
//   - dismissal-aware, per-review_id: a review_id is ACTIVE iff it has a CHANGES_REQUESTED record and NO
//     same-review_id DISMISSED record (GitHub review-state is monotonic — presence-based, no ordering).
//   - the HALT authority is NARROWED to {OWNER,COLLABORATOR}, applied to BOTH states BEFORE pairing (H2):
//     the store admits MEMBER (display/Wave-B), the breaker drops it; a MEMBER DISMISSED must NOT cancel
//     an insider CHANGES_REQUESTED.
//   - one denial per currently-blocked (repo, pr_number); constant persona = the bare id 'changes-requested'
//     (NOT a kernel: shape — the IDOR class); GLOBAL-only.
//   - STARVED: requireLive fail-closes-LOUD (dormant-until-armed + provenance-unestablished); the throw
//     message is source-agnostic (F1 — no "probe-dead" for a source whose producer exists).
//   - OPT-IN: registering it does NOT change the default (verdict-fail). SHADOW: reads only, writes nothing.
//   - poison-key safe (H3): the store admits a __proto__-bearing repo segment; the grouping uses new Map().
//   - the forged-DISMISSED under-halt (H1) is a KNOWN same-uid residual (back-to-baseline, §0a.3.1-safe).
//
// ENV-BEFORE-REQUIRE: the review-outcome store resolves LOOM_LAB_STATE_DIR at module-load -> set first.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const LAB_TMP = path.join(os.tmpdir(), 'cr-lab-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = LAB_TMP; // BEFORE requires
fs.mkdirSync(LAB_TMP, { recursive: true });

const REPO = path.join(__dirname, '..', '..', '..', '..');
const P = (...a) => path.join(REPO, 'packages', ...a);
const { projectBreaker, evaluate } = require(P('lab', 'circuit-breaker', 'project.js'));
const { recordReviewOutcome } = require(P('lab', 'world-anchor', 'review-outcome-store.js'));

const NOW = Date.parse('2026-07-07T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const BREAKER_ENVS = ['LOOM_BREAKER_SOURCE', 'LOOM_DISABLE_CIRCUIT_BREAKER', 'LOOM_BREAKER_WINDOW_MS', 'LOOM_BREAKER_MAX_DENIALS', 'LOOM_BREAKER_GLOBAL_MAX_DENIALS'];

function freshStore() {
  const d = path.join(os.tmpdir(), 'cr-store-' + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(d, { recursive: true });
  return d;
}
/** Seed a review-outcome record via the REAL producer path. Returns the record file path. */
function seed(dir, { repo = 'acme/widgets', pr = 1, review_id, state, assoc = 'OWNER', submitted = '2026-07-07T10:00:00Z' }) {
  const pull_request_url = `https://api.github.com/repos/${repo}/pulls/${pr}`;
  const r = recordReviewOutcome(
    { repo, pr_number: pr, review_id, state, author_association: assoc, submitted_at: submitted, pull_request_url },
    { dir, now: NOW },
  );
  assert.strictEqual(r.ok, true, `seed ok (reason=${r.reason || ''}) for review ${review_id}:${state}:${assoc}`);
  return path.join(dir, r.node_id + '.json');
}
function project(dir) { return projectBreaker({ now: NOW, source: 'changes-requested', stateDir: dir }); }

let passed = 0; let failed = 0;
function test(name, fn) {
  for (const e of BREAKER_ENVS) delete process.env[e];
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

test('1. an insider CHANGES_REQUESTED blocks a PR -> 1 denial under the constant persona "changes-requested"', () => {
  const s = freshStore();
  try {
    seed(s, { pr: 1, review_id: 100, state: 'CHANGES_REQUESTED', assoc: 'OWNER' });
    const v = project(s);
    assert.strictEqual(v.source, 'changes-requested', 'the resolved source is echoed');
    assert.strictEqual(v.global.denials_in_window, 1, 'the blocked PR counts');
    const row = v.personas.find((p) => p.persona === 'changes-requested');
    assert.ok(row, 'the constant persona row exists (bare id, no kernel: prefix)');
    assert.ok(!v.personas.some((p) => /^kernel:/.test(p.persona)), 'never a kernel: persona shape (IDOR class)');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

test('2. dismissal-aware: a CHANGES_REQUESTED with a same-review_id DISMISSED -> NOT blocked (0 denials)', () => {
  const s = freshStore();
  try {
    seed(s, { pr: 1, review_id: 100, state: 'CHANGES_REQUESTED', assoc: 'OWNER' });
    seed(s, { pr: 1, review_id: 100, state: 'DISMISSED', assoc: 'OWNER' });
    assert.strictEqual(project(s).global.denials_in_window, 0, 'a dismissed review does not block');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

test('3. auth-narrow: a MEMBER CHANGES_REQUESTED is admitted by the STORE but NOT counted by the breaker ({OWNER,COLLABORATOR})', () => {
  const s = freshStore();
  try {
    seed(s, { pr: 1, review_id: 100, state: 'CHANGES_REQUESTED', assoc: 'MEMBER' });
    assert.strictEqual(project(s).global.denials_in_window, 0, 'MEMBER is not a halt authority');
    // control: the same review as COLLABORATOR DOES count
    const s2 = freshStore();
    seed(s2, { pr: 1, review_id: 100, state: 'CHANGES_REQUESTED', assoc: 'COLLABORATOR' });
    assert.strictEqual(project(s2).global.denials_in_window, 1, 'COLLABORATOR is a halt authority');
    fs.rmSync(s2, { recursive: true, force: true });
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

test('4. H2: a non-{OWNER,COLLABORATOR} DISMISSED does NOT cancel an insider CHANGES_REQUESTED (narrow BOTH states)', () => {
  const s = freshStore();
  try {
    seed(s, { pr: 1, review_id: 100, state: 'CHANGES_REQUESTED', assoc: 'OWNER' });
    seed(s, { pr: 1, review_id: 100, state: 'DISMISSED', assoc: 'MEMBER' }); // a MEMBER dismissal must NOT clear the OWNER block
    assert.strictEqual(project(s).global.denials_in_window, 1, 'a MEMBER DISMISSED cannot cancel an OWNER CHANGES_REQUESTED');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

test('5. per-PR dedup: two insider CHANGES_REQUESTED on ONE PR -> ONE denial', () => {
  const s = freshStore();
  try {
    seed(s, { pr: 7, review_id: 100, state: 'CHANGES_REQUESTED', assoc: 'OWNER' });
    seed(s, { pr: 7, review_id: 101, state: 'CHANGES_REQUESTED', assoc: 'COLLABORATOR' });
    assert.strictEqual(project(s).global.denials_in_window, 1, 'one blocked PR = one denial, not per-review');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

test('6. GLOBAL cap gates: 3 blocked PRs trip the global breaker at the threshold', () => {
  const s = freshStore();
  try {
    process.env.LOOM_BREAKER_GLOBAL_MAX_DENIALS = '3';
    seed(s, { pr: 1, review_id: 100, state: 'CHANGES_REQUESTED', assoc: 'OWNER' });
    seed(s, { pr: 2, review_id: 200, state: 'CHANGES_REQUESTED', assoc: 'OWNER' });
    seed(s, { pr: 3, review_id: 300, state: 'CHANGES_REQUESTED', assoc: 'COLLABORATOR' });
    const v = project(s);
    assert.strictEqual(v.global.denials_in_window, 3);
    assert.strictEqual(v.global.tripped, true, '3 blocked PRs >= GLOBAL_MAX_DENIALS(3) -> global tripped');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

test('7. STATE-count (CR-1): an OLD-mtime active review STILL counts (recorded_at = nowMs, not the frozen file mtime)', () => {
  const s = freshStore();
  try {
    const f = seed(s, { pr: 1, review_id: 100, state: 'CHANGES_REQUESTED', assoc: 'OWNER' });
    fs.utimesSync(f, (NOW - 100 * DAY) / 1000, (NOW - 100 * DAY) / 1000); // freeze the file 100 days in the past
    assert.strictEqual(project(s).global.denials_in_window, 1, 'a still-blocking review is NOT aged out by an old file mtime');
    // and the emitted event carries nowMs
    const v = project(s);
    assert.strictEqual(v.excluded_future, 0, 'nowMs is never future-dated');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

test('8. STARVED: evaluate({requireLive:true}) THROWS with a source-agnostic message (F1: no "probe-dead")', () => {
  const s = freshStore();
  try {
    seed(s, { pr: 1, review_id: 100, state: 'CHANGES_REQUESTED', assoc: 'OWNER' });
    assert.throws(
      () => evaluate({ now: NOW, source: 'changes-requested', stateDir: s, requireLive: true }),
      (err) => /starved/i.test(err.message) && !/probe-dead/.test(err.message),
      'a requireLive gating consumer fail-closes-LOUD, and the message does not falsely claim "probe-dead"',
    );
    // an ADVISORY read (no requireLive) does NOT throw AND surfaces the blocked PR + source_starved
    const adv = evaluate({ now: NOW, source: 'changes-requested', stateDir: s });
    assert.strictEqual(adv.source_starved, true, 'source_starved is surfaced');
    assert.strictEqual(adv.denials_in_window, 1, 'the advisory read counts the blocked PR (global)');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

test('9. OPT-IN: no source/env -> the default stays verdict-fail (registration changes no default)', () => {
  assert.strictEqual(projectBreaker({ now: NOW }).source, 'verdict-fail');
});

test('10. env selection: LOOM_BREAKER_SOURCE=changes-requested resolves the source (explicit opts.source still wins)', () => {
  const s = freshStore();
  try {
    process.env.LOOM_BREAKER_SOURCE = 'changes-requested';
    seed(s, { pr: 1, review_id: 100, state: 'CHANGES_REQUESTED', assoc: 'OWNER' });
    assert.strictEqual(projectBreaker({ now: NOW, stateDir: s }).source, 'changes-requested', 'the env selects the source');
    assert.strictEqual(projectBreaker({ now: NOW, source: 'verdict-fail', stateDir: s }).source, 'verdict-fail', 'explicit opts.source wins');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

test('11. H1 under-halt residual (KNOWN): a same-uid insider DISMISSED for a real CHANGES_REQUESTED suppresses the halt', () => {
  const s = freshStore();
  try {
    seed(s, { pr: 1, review_id: 100, state: 'CHANGES_REQUESTED', assoc: 'OWNER' });
    assert.strictEqual(project(s).global.denials_in_window, 1, 'the block is active');
    seed(s, { pr: 1, review_id: 100, state: 'DISMISSED', assoc: 'OWNER' }); // a same-uid writer plants a valid insider dismissal
    assert.strictEqual(project(s).global.denials_in_window, 0, 'the (possibly forged) dismissal suppresses the halt: back-to-baseline, halt-only NARROWS (§0a.3.1-safe while SHADOW+same-uid; re-examined at arming)');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

test('12. H3 poison-key: a stored record with repo="__proto__/foo" does NOT corrupt the accumulator', () => {
  const s = freshStore();
  try {
    seed(s, { repo: '__proto__/foo', pr: 1, review_id: 100, state: 'CHANGES_REQUESTED', assoc: 'OWNER' });
    const v = project(s);
    assert.strictEqual(v.global.denials_in_window, 1, 'the __proto__-repo PR counts as one denial');
    assert.strictEqual(({}).polluted, undefined, 'Object.prototype is not polluted');
    assert.strictEqual(Object.prototype.hasOwnProperty.call({}, '__proto__') , false, 'no own __proto__ leaked onto a fresh object');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

test('13. edge cases: DISMISSED-without-CR, only COMMENTED/APPROVED, empty store -> 0 denials, no throw', () => {
  const a = freshStore();
  const b = freshStore();
  const c = freshStore();
  try {
    seed(a, { pr: 1, review_id: 100, state: 'DISMISSED', assoc: 'OWNER' });           // dismissal with no prior CR
    assert.strictEqual(project(a).global.denials_in_window, 0, 'a lone DISMISSED does not block');
    seed(b, { pr: 1, review_id: 100, state: 'COMMENTED', assoc: 'OWNER' });
    seed(b, { pr: 1, review_id: 101, state: 'APPROVED', assoc: 'OWNER' });
    assert.strictEqual(project(b).global.denials_in_window, 0, 'COMMENTED/APPROVED do not block');
    assert.strictEqual(project(c).global.denials_in_window, 0, 'an empty store is clear');
  } finally { for (const d of [a, b, c]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('14. determinism + SHADOW: pinned now -> deep-equal across calls; the projection writes nothing', () => {
  const s = freshStore();
  try {
    seed(s, { pr: 1, review_id: 100, state: 'CHANGES_REQUESTED', assoc: 'OWNER' });
    const storeSub = path.join(s); // the review-outcome records live directly under the passed dir
    const before = fs.readdirSync(storeSub).sort().join(',');
    assert.deepStrictEqual(project(s), project(s), 'deterministic given (source, now)');
    assert.strictEqual(fs.readdirSync(storeSub).sort().join(','), before, 'the projection wrote nothing');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

test('15. bypass env: the kill-switch returns the all-clear shape with the resolved source echoed', () => {
  const s = freshStore();
  try {
    process.env.LOOM_DISABLE_CIRCUIT_BREAKER = '1';
    seed(s, { pr: 1, review_id: 100, state: 'CHANGES_REQUESTED', assoc: 'OWNER' });
    const v = projectBreaker({ now: NOW, source: 'changes-requested', stateDir: s });
    assert.strictEqual(v.bypassed, true);
    assert.strictEqual(v.source, 'changes-requested', 'the source field is consistent under bypass');
    assert.deepStrictEqual(v.personas, []);
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

test('17. VALIDATE HIGH: a DISMISSED for an UNRELATED (repo,pr) sharing a review_id does NOT cancel a real block', () => {
  const s = freshStore();
  try {
    seed(s, { repo: 'acme/widgets', pr: 1, review_id: 999, state: 'CHANGES_REQUESTED', assoc: 'OWNER' });
    assert.strictEqual(project(s).global.denials_in_window, 1, 'the block is active');
    seed(s, { repo: 'evil/other-repo', pr: 42, review_id: 999, state: 'DISMISSED', assoc: 'OWNER' }); // same review_id, DIFFERENT PR
    assert.strictEqual(project(s).global.denials_in_window, 1, 'a cross-PR dismissal must NOT un-block acme/widgets#1 (pairing is scoped to (repo,pr,review_id))');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

test('18. VALIDATE HIGH: two active PRs sharing a review_id are TWO denials, not collapsed to one', () => {
  const s = freshStore();
  try {
    seed(s, { repo: 'acme/a', pr: 1, review_id: 555, state: 'CHANGES_REQUESTED', assoc: 'OWNER' });
    seed(s, { repo: 'acme/b', pr: 2, review_id: 555, state: 'CHANGES_REQUESTED', assoc: 'COLLABORATOR' });
    assert.strictEqual(project(s).global.denials_in_window, 2, 'two distinct blocked PRs must both count (not collapsed by a shared review_id)');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

test('19. VALIDATE LOW: a case-variant repo for the SAME logical PR does NOT inflate the count (case-folded key)', () => {
  const s = freshStore();
  try {
    seed(s, { repo: 'acme/widgets', pr: 1, review_id: 100, state: 'CHANGES_REQUESTED', assoc: 'OWNER' });
    seed(s, { repo: 'Acme/Widgets', pr: 1, review_id: 200, state: 'CHANGES_REQUESTED', assoc: 'OWNER' });
    assert.strictEqual(project(s).global.denials_in_window, 1, 'case-variant repo slugs are the same logical PR -> one denial');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

test('16. absent store -> clean empty view (no throw)', () => {
  const missing = path.join(os.tmpdir(), 'cr-absent-' + crypto.randomBytes(6).toString('hex'));
  const v = projectBreaker({ now: NOW, source: 'changes-requested', stateDir: missing });
  assert.strictEqual(v.global.denials_in_window, 0);
  assert.strictEqual(v.global.tripped, false);
  assert.deepStrictEqual(v.personas, []);
});

process.stdout.write(`\nchanges-requested-source.test.js (Gap-8 Wave A-2): ${passed} passed, ${failed} failed\n`);
fs.rmSync(LAB_TMP, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
