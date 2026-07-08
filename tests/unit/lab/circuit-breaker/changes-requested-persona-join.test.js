#!/usr/bin/env node

// tests/unit/lab/circuit-breaker/changes-requested-persona-join.test.js
//
// Gap-8 review-loop Wave A0 — THE INTERNAL FULL-JOIN PROOF (the beta-internal-verification-mandate): the
// changes-requested breaker source joins a currently-blocked PR to its builder persona via the
// persona-attribution map, and attributes the halt PER-PERSONA. Verified end-to-end with MOCK records (the
// producer with an injected (repo, pr, persona); the reviews as in the A-2 tests) — mock-vs-real identical per
// the mandate. No armed emit, no real review, needed for "done".
//
// Contracts pinned here (the VERIFY board's folds):
//   - PER-PERSONA HALT: a mapped blocked PR emits its denial under the MAPPED persona plane, not the sentinel.
//   - GLOBAL SENTINEL FALLBACK: an un-mapped (or unverifiable-map) blocked PR falls to 'changes-requested'.
//   - F7 GLOBAL-COUNT INVARIANT: the global denials count is a persona-agnostic sum -> INVARIANT to the split.
//   - F3 MIXED-CASE JOIN: a map under 'Acme/Widgets' joins a block under 'acme/widgets' (folded, mock-visible).
//   - F6 FAIL-SOFT: a tampered map record -> lookup null -> the PR counts under the sentinel, no projection throw.
//   - BACKWARD-COMPAT: an empty map is byte-identical to the pre-A0 global-only behavior.
//
// TWO independently-injectable store dirs (F4): stateDir = the review-outcome store; personaMapDir = the map.
// ENV-BEFORE-REQUIRE: both stores resolve LOOM_LAB_STATE_DIR at module-load -> set first.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const LAB_TMP = path.join(os.tmpdir(), 'crpj-lab-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = LAB_TMP; // BEFORE requires
fs.mkdirSync(LAB_TMP, { recursive: true });

const REPO = path.join(__dirname, '..', '..', '..', '..');
const P = (...a) => path.join(REPO, 'packages', ...a);
const { projectBreaker } = require(P('lab', 'circuit-breaker', 'project.js'));
const { recordReviewOutcome } = require(P('lab', 'world-anchor', 'review-outcome-store.js'));
const { recordPersonaForPr } = require(P('lab', 'world-anchor', 'persona-attribution-store.js'));

const NOW = Date.parse('2026-07-08T12:00:00.000Z');
const BREAKER_ENVS = ['LOOM_BREAKER_SOURCE', 'LOOM_DISABLE_CIRCUIT_BREAKER', 'LOOM_BREAKER_WINDOW_MS', 'LOOM_BREAKER_MAX_DENIALS', 'LOOM_BREAKER_GLOBAL_MAX_DENIALS'];

function freshDir(tag) {
  const d = path.join(os.tmpdir(), `crpj-${tag}-` + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(d, { recursive: true });
  return d;
}
/** Seed a currently-blocking insider CHANGES_REQUESTED review via the REAL producer path. */
function block(reviewDir, { repo = 'acme/widgets', pr = 1, review_id, assoc = 'OWNER' }) {
  const pull_request_url = `https://api.github.com/repos/${repo}/pulls/${pr}`;
  const r = recordReviewOutcome(
    { repo, pr_number: pr, review_id, state: 'CHANGES_REQUESTED', author_association: assoc, submitted_at: '2026-07-08T10:00:00Z', pull_request_url },
    { dir: reviewDir, now: NOW },
  );
  assert.strictEqual(r.ok, true, `block seed ok (reason=${r.reason || ''})`);
}
/** Seed a persona-map entry via the REAL producer path. Returns the map record file path. */
function map(mapDir, { repo = 'acme/widgets', pr = 1, persona }) {
  const r = recordPersonaForPr({ repo, pr_number: pr, persona }, { dir: mapDir, now: NOW });
  assert.strictEqual(r.ok, true, `map seed ok (reason=${r.reason || ''})`);
  return path.join(mapDir, r.node_id + '.json');
}
function project(reviewDir, mapDir) {
  return projectBreaker({ now: NOW, source: 'changes-requested', stateDir: reviewDir, personaMapDir: mapDir });
}

let passed = 0; let failed = 0;
function test(name, fn) {
  for (const e of BREAKER_ENVS) delete process.env[e];
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

test('1. PER-PERSONA ATTRIBUTION: a mapped blocked PR emits under the MAPPED persona plane, not the sentinel', () => {
  const rev = freshDir('rev'); const mp = freshDir('map');
  try {
    block(rev, { pr: 1, review_id: 100 });
    map(mp, { pr: 1, persona: 'node-backend' });
    const v = project(rev, mp);
    assert.strictEqual(v.global.denials_in_window, 1, 'the blocked PR counts globally');
    const row = v.personas.find((p) => p.persona === 'node-backend');
    assert.ok(row, 'the denial is attributed to the mapped persona plane');
    assert.strictEqual(row.denials_in_window, 1, 'one denial under node-backend');
    assert.ok(!v.personas.some((p) => p.persona === 'changes-requested'), 'a MAPPED PR does not fall to the sentinel');
  } finally { fs.rmSync(rev, { recursive: true, force: true }); fs.rmSync(mp, { recursive: true, force: true }); }
});

test('2. GLOBAL SENTINEL FALLBACK: an un-mapped blocked PR falls to the constant persona "changes-requested"', () => {
  const rev = freshDir('rev'); const mp = freshDir('map');
  try {
    block(rev, { pr: 1, review_id: 100 }); // no map entry
    const v = project(rev, mp);
    assert.strictEqual(v.global.denials_in_window, 1);
    const row = v.personas.find((p) => p.persona === 'changes-requested');
    assert.ok(row, 'an un-mapped block lands on the sentinel plane');
    assert.ok(!v.personas.some((p) => /^kernel:/.test(p.persona)), 'never a kernel: shape');
  } finally { fs.rmSync(rev, { recursive: true, force: true }); fs.rmSync(mp, { recursive: true, force: true }); }
});

test('3. F7 GLOBAL-COUNT INVARIANT: the global count is the same whether PRs are mapped, unmapped, or mixed', () => {
  // scenario A: both mapped (to different personas)
  const revA = freshDir('rev'); const mpA = freshDir('map');
  // scenario B: both unmapped
  const revB = freshDir('rev'); const mpB = freshDir('map');
  // scenario C: one mapped, one not
  const revC = freshDir('rev'); const mpC = freshDir('map');
  try {
    block(revA, { repo: 'acme/a', pr: 1, review_id: 1 }); block(revA, { repo: 'acme/b', pr: 2, review_id: 2 });
    map(mpA, { repo: 'acme/a', pr: 1, persona: 'node-backend' }); map(mpA, { repo: 'acme/b', pr: 2, persona: 'code-reviewer' });

    block(revB, { repo: 'acme/a', pr: 1, review_id: 1 }); block(revB, { repo: 'acme/b', pr: 2, review_id: 2 });

    block(revC, { repo: 'acme/a', pr: 1, review_id: 1 }); block(revC, { repo: 'acme/b', pr: 2, review_id: 2 });
    map(mpC, { repo: 'acme/a', pr: 1, persona: 'node-backend' });

    const gA = project(revA, mpA).global.denials_in_window;
    const gB = project(revB, mpB).global.denials_in_window;
    const gC = project(revC, mpC).global.denials_in_window;
    assert.strictEqual(gA, 2, 'both-mapped: 2 blocked PRs = 2 global denials');
    assert.strictEqual(gB, 2, 'both-unmapped: 2 global denials');
    assert.strictEqual(gC, 2, 'mixed: 2 global denials');
    // and the split is real: scenario A has TWO persona planes, scenario B has ONE (the sentinel with 2)
    assert.strictEqual(project(revA, mpA).personas.length, 2, 'both-mapped -> two persona planes');
    const bRow = project(revB, mpB).personas.find((p) => p.persona === 'changes-requested');
    assert.strictEqual(bRow.denials_in_window, 2, 'both-unmapped -> the sentinel carries both');
  } finally {
    for (const d of [revA, mpA, revB, mpB, revC, mpC]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('4. F3 MIXED-CASE JOIN: a map under "Acme/Widgets" joins a block under "acme/widgets" (folded, mock-visible)', () => {
  const rev = freshDir('rev'); const mp = freshDir('map');
  try {
    block(rev, { repo: 'acme/widgets', pr: 7, review_id: 100 }); // review stored under lowercased consumer key
    map(mp, { repo: 'Acme/Widgets', pr: 7, persona: 'node-backend' }); // producer stored a mixed-case slug
    const v = project(rev, mp);
    assert.ok(v.personas.find((p) => p.persona === 'node-backend'), 'the mixed-case map still joins the block');
    assert.ok(!v.personas.some((p) => p.persona === 'changes-requested'), 'NOT the sentinel — the fold makes them agree');
  } finally { fs.rmSync(rev, { recursive: true, force: true }); fs.rmSync(mp, { recursive: true, force: true }); }
});

test('5. F6 FAIL-SOFT: a tampered map record -> the PR counts under the SENTINEL, and the projection does NOT throw', () => {
  const rev = freshDir('rev'); const mp = freshDir('map');
  try {
    block(rev, { pr: 1, review_id: 100 });
    const mapFile = map(mp, { pr: 1, persona: 'node-backend' });
    fs.writeFileSync(mapFile, '{ corrupt json'); // poison the map record
    let v;
    assert.doesNotThrow(() => { v = project(rev, mp); }, 'a poisoned map record must not abort the projection');
    assert.strictEqual(v.global.denials_in_window, 1, 'the block still counts globally (no data loss)');
    assert.ok(v.personas.find((p) => p.persona === 'changes-requested'), 'an unverifiable map record relocates the PR to the sentinel');
    assert.ok(!v.personas.some((p) => p.persona === 'node-backend'), 'the tampered persona is NOT attributed');
  } finally { fs.rmSync(rev, { recursive: true, force: true }); fs.rmSync(mp, { recursive: true, force: true }); }
});

test('6. BACKWARD-COMPAT: an empty map is byte-identical to pre-A0 (every block under the sentinel)', () => {
  const rev = freshDir('rev'); const mp = freshDir('map'); // map dir empty
  try {
    block(rev, { pr: 1, review_id: 100 });
    block(rev, { pr: 2, review_id: 200 });
    const v = project(rev, mp);
    assert.strictEqual(v.global.denials_in_window, 2);
    assert.strictEqual(v.personas.length, 1, 'only the sentinel plane');
    assert.strictEqual(v.personas[0].persona, 'changes-requested');
    assert.strictEqual(v.personas[0].denials_in_window, 2, 'both blocks under the sentinel');
  } finally { fs.rmSync(rev, { recursive: true, force: true }); fs.rmSync(mp, { recursive: true, force: true }); }
});

test('7. NO personaMapDir arg (the A-2 default path): every block falls to the sentinel (empty default store)', () => {
  const rev = freshDir('rev');
  try {
    block(rev, { pr: 1, review_id: 100 });
    // projectBreaker WITHOUT personaMapDir -> the store's DEFAULT_DIR under LAB_TMP (empty) -> sentinel
    const v = projectBreaker({ now: NOW, source: 'changes-requested', stateDir: rev });
    assert.strictEqual(v.global.denials_in_window, 1);
    assert.ok(v.personas.find((p) => p.persona === 'changes-requested'), 'no map dir -> sentinel (backward-compatible with the A-2 tests)');
  } finally { fs.rmSync(rev, { recursive: true, force: true }); }
});

test('8. PER-PERSONA TRIP (the differential halt): 5 blocked PRs under ONE mapped persona trip that plane while global stays UNtripped', () => {
  // The actual per-persona-halt semantic (VALIDATE honesty-auditor NIT): default max_denials=5 (per-persona),
  // global_max_denials=10. Five distinct blocked PRs all mapped to ONE persona -> that plane hits its threshold
  // (tripped) while the global sum (5) stays below its own (10) -> per-persona fires EARLIER than global.
  const rev = freshDir('rev'); const mp = freshDir('map');
  try {
    for (let i = 1; i <= 5; i += 1) {
      block(rev, { repo: 'acme/widgets', pr: i, review_id: i });
      map(mp, { repo: 'acme/widgets', pr: i, persona: 'node-backend' });
    }
    const v = project(rev, mp);
    const row = v.personas.find((p) => p.persona === 'node-backend');
    assert.ok(row, 'the node-backend plane exists');
    assert.strictEqual(row.denials_in_window, 5, 'five blocked PRs under one persona');
    assert.strictEqual(row.tripped, true, 'the per-persona plane TRIPS at max_denials (5)');
    assert.strictEqual(v.global.denials_in_window, 5, 'global counts all five');
    assert.strictEqual(v.global.tripped, false, 'global stays UNtripped (5 < global_max 10) -> per-persona fires EARLIER');
  } finally { fs.rmSync(rev, { recursive: true, force: true }); fs.rmSync(mp, { recursive: true, force: true }); }
});

process.stdout.write(`\nchanges-requested-persona-join.test.js (Gap-8 Wave A0): ${passed} passed, ${failed} failed\n`);
fs.rmSync(LAB_TMP, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
