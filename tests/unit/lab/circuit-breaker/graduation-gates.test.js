#!/usr/bin/env node

// tests/unit/lab/circuit-breaker/graduation-gates.test.js
//
// v3.8b W1 — the E11 graduation gates (the USER-#250 BINDING pre-kernel-gate set):
//   G1  dedup-by-subject: the verdict-fail source counts DISTINCT failed subject spawns
//       (evidence_refs.agent_id), not fail-VERDICT records (the D6 multi-reviewer inflation).
//   G2  source-validation: SOURCES carry a static `starved` flag; source_starved surfaces in
//       view + decision; evaluate({requireLive:true}) THROWS on a starved source (bypass wins).
//   LATCH  the stateless hysteresis look-back: a trip persists LATCH_MS past the last
//       threshold-crossing (continuous-time crossing; per-plane; same exclusions as the window).
//
// Locks the VERIFY-board folds: CR-F1 (both-ids-missing rows never collapse), CR-F2 (a forged
// future-dated line neither hides a real denial nor vanishes from excluded_future), CR-F3
// (bypass beats requireLive), CR-F5 (the --require-live hyphen-key CLI mapping), CR-F8 (the
// concrete latch-expiry boundary), A-F1 (promote-shape try/catch composition), A-F3 (the
// trickle bump-forward documented), the F2/F4 synthesis (scope stays the PLANE; latched_* are
// the explanatory axis), and the self-caught scan-source fetch horizon (test 25).
//
// ENV-BEFORE-REQUIRE: both lab stores capture LOOM_LAB_STATE_DIR at module-load -> set it first.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const TMP = path.join(os.tmpdir(), 'e11gates-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP; // BEFORE requiring the stores (ENV-BEFORE-REQUIRE)
fs.mkdirSync(TMP, { recursive: true });

const REPO = path.join(__dirname, '..', '..', '..', '..');
const vstore = require(path.join(REPO, 'packages', 'lab', 'verdict-attestation', 'store.js'));
const negstore = require(path.join(REPO, 'packages', 'lab', 'negative-attestation', 'store.js'));
const { projectBreaker, evaluate } = require(path.join(REPO, 'packages', 'lab', 'circuit-breaker', 'project.js'));
const CLI = path.join(REPO, 'packages', 'lab', 'circuit-breaker', 'cli.js');

const NOW = Date.parse('2026-06-12T12:00:00.000Z');
const W = 10 * 60 * 1000;           // default window_ms (and the default latch_ms)
const MIN = 60 * 1000;
const BREAKER_ENVS = [
  'LOOM_BREAKER_SOURCE', 'LOOM_DISABLE_CIRCUIT_BREAKER', 'LOOM_BREAKER_WINDOW_MS',
  'LOOM_BREAKER_MAX_DENIALS', 'LOOM_BREAKER_GLOBAL_MAX_DENIALS', 'LOOM_BREAKER_LATCH_MS',
];

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fs.rmSync(vstore.LEDGER_PATH, { force: true }); } catch { /* */ }
  try { fs.rmSync(negstore.LEDGER_PATH, { force: true }); } catch { /* */ }
  for (const e of BREAKER_ENVS) delete process.env[e];
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// -- seeding helpers ------------------------------------------------------------------------
let seq = 0;
function nextAgentId(prefix) { seq += 1; return `${prefix || 'a'}${String(seq).padStart(16, '0')}`; }

// One fail verdict on a DISTINCT subject spawn (one build = one denial under G1).
function seedFailDistinct(persona, atMs) {
  return vstore.recordVerdict({
    verdict: 'fail', subject: { persona },
    verifier: { identity: '03-code-reviewer.nova', kind: 'structural' },
    agentId: nextAgentId(), now: atMs,
  });
}

// N reviewers each record a fail about the SAME subject spawn (the D6 case): same agentId +
// persona, DISTINCT verifier identities -> distinct attestation_ids (no store dedup), and the
// H-1 one-spawn-one-persona guard is satisfied.
const REVIEWERS = ['03-code-reviewer.nova', '04-hacker.rex', '05-honesty-auditor.iris', '06-architect.sage'];
function seedMultiReviewerVerdict(verdict, agentId, n, persona, atMs) {
  for (let i = 0; i < n; i += 1) {
    vstore.recordVerdict({
      verdict, subject: { persona },
      verifier: { identity: REVIEWERS[i % REVIEWERS.length], kind: 'structural' },
      agentId, now: atMs,
    });
  }
}

function appendRaw(obj) { // a hand-crafted verdict-ledger line (forged-input cases)
  fs.mkdirSync(path.dirname(vstore.LEDGER_PATH), { recursive: true });
  fs.appendFileSync(vstore.LEDGER_PATH, `${JSON.stringify(obj)}\n`);
}
function personaOf(view, name) { return view.personas.find((p) => p.persona === name); }

// A kernel-store fixture for the manage-promote scan source (mirrors record-scan.test.js):
// <stateDir>/<runId>/records/record-<64hex>.json with a controlled FS mtime.
function writeCommittedOp(stateDir, runId, opClass, mtimeMs) {
  const txid = crypto.randomBytes(32).toString('hex');
  const dir = path.join(stateDir, runId, 'records');
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, `record-${txid}.json`);
  fs.writeFileSync(fp, JSON.stringify({ transaction_id: txid, operation_class: opClass }));
  fs.utimesSync(fp, mtimeMs / 1000, mtimeMs / 1000);
}

// ════ G1 — dedup-by-subject (verdict-fail only) ═════════════════════════════════════════════

test('1. G1 headline (D6): 3 reviewers fail ONE subject spawn -> denials_in_window 1, not 3', () => {
  seedMultiReviewerVerdict('fail', nextAgentId('s'), 3, 'node-backend', NOW - 1000);
  const row = personaOf(projectBreaker({ now: NOW }), 'node-backend');
  assert.ok(row, 'persona row present');
  assert.strictEqual(row.denials_in_window, 1, 'one BUILD failed, not three records');
});

test('2. G1: fails on 3 DISTINCT subject spawns -> 3 denials', () => {
  for (let i = 0; i < 3; i += 1) seedFailDistinct('node-backend', NOW - 1000);
  assert.strictEqual(personaOf(projectBreaker({ now: NOW }), 'node-backend').denials_in_window, 3);
});

test('3. G1 mixed: 2 reviewers on spawn A + 1 on spawn B -> 2 denials', () => {
  seedMultiReviewerVerdict('fail', nextAgentId('s'), 2, 'node-backend', NOW - 1000);
  seedFailDistinct('node-backend', NOW - 1000);
  assert.strictEqual(personaOf(projectBreaker({ now: NOW }), 'node-backend').denials_in_window, 2);
});

test('4. G1 straddle: same spawn failed at NOW-2W and NOW-1s -> deduped LATEST is in-window -> counts 1', () => {
  const agentId = nextAgentId('s');
  seedMultiReviewerVerdict('fail', agentId, 1, 'node-backend', NOW - 2 * W); // aged out alone
  vstore.recordVerdict({
    verdict: 'fail', subject: { persona: 'node-backend' },
    verifier: { identity: REVIEWERS[1], kind: 'adversarial-security' }, agentId, now: NOW - 1000,
  });
  const row = personaOf(projectBreaker({ now: NOW }), 'node-backend');
  assert.ok(row, 'the deduped denial is in-window (latest countable wins)');
  assert.strictEqual(row.denials_in_window, 1);
});

test('5. G1 fail-soft: two hand-written fails missing agent_id -> 2 denials via attestation_id', () => {
  appendRaw({ attestation_id: 'h1', verdict: 'fail', subject: { persona: 'node-backend' }, recorded_at: new Date(NOW - 1000).toISOString(), expires_after_days: 30 });
  appendRaw({ attestation_id: 'h2', verdict: 'fail', subject: { persona: 'node-backend' }, recorded_at: new Date(NOW - 2000).toISOString(), expires_after_days: 30 });
  assert.strictEqual(personaOf(projectBreaker({ now: NOW }), 'node-backend').denials_in_window, 2, 'no cross-record collapse on the attestation_id rung');
});

test('5b. G1 fail-soft terminal (CR-F1): two rows missing BOTH agent_id AND attestation_id -> 2 denials', () => {
  appendRaw({ verdict: 'fail', subject: { persona: 'node-backend' }, recorded_at: new Date(NOW - 1000).toISOString(), expires_after_days: 30 });
  appendRaw({ verdict: 'fail', subject: { persona: 'node-backend' }, recorded_at: new Date(NOW - 2000).toISOString(), expires_after_days: 30 });
  assert.strictEqual(personaOf(projectBreaker({ now: NOW }), 'node-backend').denials_in_window, 2, 'the positional sentinel prevents the undefined-key collapse (under-count)');
});

test('5c. G1 group-silencing lock (CR-F2): a forged FUTURE line on a real spawn neither hides the denial nor vanishes from excluded_future', () => {
  const agentId = nextAgentId('s');
  seedMultiReviewerVerdict('fail', agentId, 1, 'node-backend', NOW - 1000); // real, in-window
  appendRaw({ attestation_id: 'f1', verdict: 'fail', subject: { persona: 'node-backend' }, evidence_refs: { agent_id: agentId }, recorded_at: new Date(NOW + 3600000).toISOString(), expires_after_days: 30 });
  const v = projectBreaker({ now: NOW });
  assert.strictEqual(personaOf(v, 'node-backend').denials_in_window, 1, 'the real denial still counts');
  assert.strictEqual(v.excluded_future, 1, 'the forged future line stays visible as a tamper signal');
});

test('6. G1 + D2: pass/partial verdicts on the same spawn never count; fails dedup to 1', () => {
  const agentId = nextAgentId('s');
  seedMultiReviewerVerdict('pass', agentId, 2, 'node-backend', NOW - 1000);
  seedMultiReviewerVerdict('fail', agentId, 2, 'node-backend', NOW - 1000);
  const row = personaOf(projectBreaker({ now: NOW }), 'node-backend');
  assert.strictEqual(row.denials_in_window, 1, '2 fail records on one spawn = 1; the 2 passes = 0');
});

test('7. G1 is verdict-fail-SPECIFIC: the negative-attestation source stays per-record (3 -> 3)', () => {
  process.env.LOOM_BREAKER_SOURCE = 'negative-attestation';
  for (let i = 0; i < 3; i += 1) {
    seq += 1;
    negstore.recordAttestation({ failureSignature: { sig: `leaf-${seq}` }, identity: { subagentType: 'node-backend' }, runId: `r-${seq}`, leafRef: `leaf-${seq}`, now: NOW - 1000 });
  }
  assert.strictEqual(personaOf(projectBreaker({ now: NOW }), 'node-backend').denials_in_window, 3, 'E1 records are per-EVENT; no dedup');
});

// ════ G2 — source-validation in the API layer ═══════════════════════════════════════════════

test('8. G2: source_starved:false for every LIVE source (view + decision)', () => {
  const emptyStore = fs.mkdtempSync(path.join(TMP, 'ks-'));
  assert.strictEqual(projectBreaker({ now: NOW }).source_starved, false, 'verdict-fail');
  assert.strictEqual(evaluate({ now: NOW }).source_starved, false, 'verdict-fail decision');
  assert.strictEqual(projectBreaker({ now: NOW, source: 'manage-promote', stateDir: emptyStore }).source_starved, false, 'manage-promote');
  assert.strictEqual(projectBreaker({ now: NOW, source: 'reject-event', stateDir: emptyStore }).source_starved, false, 'reject-event');
});

test('9. G2 polarity lock: negative-attestation is the ONLY starved source', () => {
  const v = projectBreaker({ now: NOW, source: 'negative-attestation' });
  assert.strictEqual(v.source_starved, true);
  const e = evaluate({ now: NOW, source: 'negative-attestation' });
  assert.strictEqual(e.source_starved, true);
});

test('10. G2 requireLive: a starved source THROWS a clear Error', () => {
  assert.throws(() => evaluate({ now: NOW, source: 'negative-attestation', requireLive: true }), /starved/i);
});

test('10d. G2 requireLive is TRUTHY, not === true (VALIDATE hacker H1): a stray truthy value still arms the gate', () => {
  // The strict === true silently disabled the gate on requireLive:'x'/1 — the fail-OPEN footgun.
  assert.throws(() => evaluate({ now: NOW, source: 'negative-attestation', requireLive: 'x' }), /starved/i, "'x' must arm the gate");
  assert.throws(() => evaluate({ now: NOW, source: 'negative-attestation', requireLive: 1 }), /starved/i, '1 must arm the gate');
  // falsy values DON'T arm it (no explicit intent) — a clear, advisory read, no throw.
  assert.doesNotThrow(() => evaluate({ now: NOW, source: 'negative-attestation', requireLive: 0 }));
  assert.doesNotThrow(() => evaluate({ now: NOW, source: 'negative-attestation', requireLive: '' }));
  assert.doesNotThrow(() => evaluate({ now: NOW, source: 'negative-attestation', requireLive: false }));
});

test('10b. G2 composition (A-F1): a promote-shaped try/catch caller gets a clean refusal value, not a crash', () => {
  const consume = () => {
    try { return { ok: true, decision: evaluate({ now: NOW, source: 'negative-attestation', requireLive: true }) }; }
    catch (e) { return { refused: true, reason: e && e.message ? e.message : String(e) }; }
  };
  const out = consume();
  assert.strictEqual(out.refused, true);
  assert.ok(/starved/i.test(out.reason), 'the refusal carries the starved-source reason');
});

test('10c. G2 (CR-F3): bypass WINS over requireLive — no throw, scope bypassed', () => {
  process.env.LOOM_DISABLE_CIRCUIT_BREAKER = '1';
  const e = evaluate({ now: NOW, source: 'negative-attestation', requireLive: true });
  assert.strictEqual(e.tripped, false);
  assert.strictEqual(e.scope, 'bypassed');
});

test('11. G2 requireLive with a LIVE source is a no-op (normal decision, no throw)', () => {
  seedFailDistinct('node-backend', NOW - 1000);
  const e = evaluate({ now: NOW, persona: 'node-backend', requireLive: true });
  assert.strictEqual(e.scope, 'clear');
  assert.strictEqual(e.source_starved, false);
});

test('12. G2 shape-stability: the bypassed view carries source_starved + the latch fields', () => {
  process.env.LOOM_DISABLE_CIRCUIT_BREAKER = '1';
  const v = projectBreaker({ now: NOW, source: 'negative-attestation' });
  assert.strictEqual(v.bypassed, true);
  assert.strictEqual(v.source_starved, true, 'the registry fact is computable without a read');
  assert.strictEqual(v.global.latched, false);
  assert.strictEqual(typeof v.latch_ms, 'number');
  const e = evaluate({ now: NOW, persona: 'x' }); // bypassed decision keys
  assert.strictEqual(e.latched, false);
  assert.strictEqual(e.latched_global, false);
  assert.strictEqual(e.latched_persona, false);
});

test('13. G2 CLI warn parity: starved source warns on STDERR; live non-default does NOT; stdout stays JSON', () => {
  const starved = spawnSync(process.execPath, [CLI, 'check', '--persona', 'x', '--source', 'negative-attestation'], { env: { ...process.env, LOOM_LAB_STATE_DIR: TMP }, encoding: 'utf8' });
  assert.strictEqual(starved.status, 0, `exit 0 (stderr=${starved.stderr})`);
  assert.ok(/WARNING/.test(starved.stderr), 'starved source warns');
  JSON.parse(starved.stdout); // throws if the warning leaked into stdout
  const emptyStore = fs.mkdtempSync(path.join(TMP, 'ks-'));
  const live = spawnSync(process.execPath, [CLI, 'check', '--source', 'reject-event', '--state-dir', emptyStore], { env: { ...process.env, LOOM_LAB_STATE_DIR: TMP }, encoding: 'utf8' });
  assert.strictEqual(live.status, 0, `exit 0 (stderr=${live.stderr})`);
  assert.ok(!/WARNING/.test(live.stderr), 'a live non-default source does not warn (the deleted-set parity)');
});

test('13b. G2 CLI --require-live (CR-F5 hyphen-key lock): starved source -> exit 1 + starved message', () => {
  const res = spawnSync(process.execPath, [CLI, 'check', '--source', 'negative-attestation', '--require-live'], { env: { ...process.env, LOOM_LAB_STATE_DIR: TMP }, encoding: 'utf8' });
  assert.strictEqual(res.status, 1, `expected the requireLive refusal to exit 1 (stdout=${res.stdout})`);
  assert.ok(/starved/i.test(res.stderr), 'the starved-source reason reaches stderr');
});

test('13c. G2 CLI --require-live + STRAY TOKEN (VALIDATE hacker H1): the gate is NOT silently disabled', () => {
  // parseArgs assigns the next token as the flag value, so `--require-live x` -> args['require-live']='x'.
  // A safety gate must not fail-OPEN on a stray token: presence still REFUSES.
  const res = spawnSync(process.execPath, [CLI, 'check', '--source', 'negative-attestation', '--require-live', 'x'], { env: { ...process.env, LOOM_LAB_STATE_DIR: TMP }, encoding: 'utf8' });
  assert.strictEqual(res.status, 1, `--require-live <stray> MUST still refuse, not exit 0 (stdout=${res.stdout})`);
  assert.ok(/starved/i.test(res.stderr));
});

// ════ The hysteresis LATCH — stateless look-back ════════════════════════════════════════════

test('14. latch headline: a 5-fail burst aged OUT of the window still trips via the latch', () => {
  const T0 = NOW - W - MIN; // outside the window (now-W, now], inside the look-back horizon
  for (let i = 0; i < 5; i += 1) seedFailDistinct('node-backend', T0);
  const e = evaluate({ persona: 'node-backend', now: NOW });
  assert.strictEqual(e.tripped, true, 'the latch holds the trip past the optimistic window reset');
  assert.strictEqual(e.latched, true);
  assert.strictEqual(e.latched_persona, true);
  assert.strictEqual(e.persona_tripped, false, 'the WINDOW axis is honestly clear');
  assert.strictEqual(e.scope, 'persona', 'scope reports the PLANE (the F2/F4 synthesis)');
  const row = personaOf(projectBreaker({ now: NOW }), 'node-backend');
  assert.ok(row, 'a latched-but-aged-out persona is VISIBLE in the view');
  assert.strictEqual(row.denials_in_window, 0);
  assert.strictEqual(row.latched, true);
  assert.strictEqual(row.tripped, false, 'row tripped stays window-only (per-axis view)');
});

test('15. latch expiry boundary (CR-F8): denials at t0, LATCH=W -> latched until t0+2W (exclusive)', () => {
  const T0 = NOW - 3 * W; // an absolute anchor; we evaluate at injected nows
  for (let i = 0; i < 5; i += 1) seedFailDistinct('node-backend', T0);
  assert.strictEqual(evaluate({ persona: 'node-backend', now: T0 + 2 * W - 1 }).latched, true, 'latched at t0+2W-1ms');
  const atEdge = evaluate({ persona: 'node-backend', now: T0 + 2 * W });
  assert.strictEqual(atEdge.latched, false, 'clear at exactly t0+2W (left-exclusive look-back)');
  assert.strictEqual(atEdge.tripped, false);
  assert.strictEqual(atEdge.scope, 'clear');
});

test('16. re-latch extension: a second burst during the latch extends the trip past the first burst expiry', () => {
  const T0 = NOW - 4 * W;
  const T1 = T0 + W;
  for (let i = 0; i < 5; i += 1) seedFailDistinct('node-backend', T0);
  for (let i = 0; i < 5; i += 1) seedFailDistinct('node-backend', T1);
  const at = T1 + 2 * W - 1000; // first burst alone clears at T0+2W < this
  assert.ok(at > T0 + 2 * W, 'fixture sanity: past the first burst expiry');
  assert.strictEqual(evaluate({ persona: 'node-backend', now: at }).latched, true, 'the second crossing re-arms the latch');
});

test('18. below-threshold denials never latch', () => {
  const T0 = NOW - W - MIN;
  for (let i = 0; i < 4; i += 1) seedFailDistinct('node-backend', T0); // 4 < 5
  const e = evaluate({ persona: 'node-backend', now: NOW });
  assert.strictEqual(e.latched, false);
  assert.strictEqual(e.tripped, false);
});

test('19. planes latch independently: A latched, B (1 in-window) not; global (6 < 10) not', () => {
  const T0 = NOW - W - MIN;
  for (let i = 0; i < 5; i += 1) seedFailDistinct('persona-a', T0);
  seedFailDistinct('persona-b', NOW - 1000);
  const v = projectBreaker({ now: NOW });
  assert.strictEqual(personaOf(v, 'persona-a').latched, true);
  assert.strictEqual(personaOf(v, 'persona-b').latched, false);
  assert.strictEqual(v.global.latched, false, '6 total never crossed the global 10');
  assert.strictEqual(evaluate({ persona: 'persona-b', now: NOW }).tripped, false);
});

test('20. latch env clamps: floor 60s / 24h ceiling / garbage -> default (= window_ms)', () => {
  process.env.LOOM_BREAKER_LATCH_MS = '1';
  assert.strictEqual(projectBreaker({ now: NOW }).latch_ms, 60000, 'clamped UP to the 60s floor');
  process.env.LOOM_BREAKER_LATCH_MS = '999999999999';
  assert.strictEqual(projectBreaker({ now: NOW }).latch_ms, 24 * 60 * 60 * 1000, 'clamped to the 24h ceiling');
  process.env.LOOM_BREAKER_LATCH_MS = 'garbage';
  const v = projectBreaker({ now: NOW });
  assert.strictEqual(v.latch_ms, v.window_ms, 'default latch = the window');
});

test('21. determinism with latch state present: pinned now -> deep-equal; no ledger write', () => {
  const T0 = NOW - W - MIN;
  for (let i = 0; i < 5; i += 1) seedFailDistinct('node-backend', T0);
  const before = fs.readFileSync(vstore.LEDGER_PATH, 'utf8');
  assert.deepStrictEqual(projectBreaker({ now: NOW }), projectBreaker({ now: NOW }));
  assert.strictEqual(fs.readFileSync(vstore.LEDGER_PATH, 'utf8'), before, 'no write');
});

test('22. future-dated denials never enter the latch math (CR-1 stays closed)', () => {
  for (let i = 0; i < 5; i += 1) seedFailDistinct('node-backend', NOW + 1000);
  const v = projectBreaker({ now: NOW });
  assert.strictEqual(v.excluded_future, 5);
  assert.strictEqual(personaOf(v, 'node-backend'), undefined, 'future-only denials: absent, not latched');
  assert.strictEqual(v.global.latched, false);
});

test('23. the latched-global triple is self-explaining (F2/F4 synthesis)', () => {
  const T0 = NOW - W - MIN;
  for (let i = 0; i < 5; i += 1) seedFailDistinct('persona-a', T0);
  for (let i = 0; i < 5; i += 1) seedFailDistinct('persona-b', T0); // 10 total crossed the global cap at T0
  const e = evaluate({ now: NOW });
  assert.strictEqual(e.tripped, true);
  assert.strictEqual(e.scope, 'global', 'the PLANE, not a latched scope value');
  assert.strictEqual(e.global_tripped, false, 'the window axis is honestly clear');
  assert.strictEqual(e.latched_global, true, 'the explanatory field resolves the triple');
  assert.strictEqual(e.latched, true);
});

test('24. trickle documented (A-F3): a fresh re-review of an OLD build bumps its deduped timestamp in-window', () => {
  const agentId = nextAgentId('s');
  seedMultiReviewerVerdict('fail', agentId, 1, 'node-backend', NOW - 3 * W); // ancient first fail
  vstore.recordVerdict({
    verdict: 'fail', subject: { persona: 'node-backend' },
    verifier: { identity: REVIEWERS[1], kind: 'adversarial-security' }, agentId, now: NOW - 1000,
  });
  const row = personaOf(projectBreaker({ now: NOW }), 'node-backend');
  assert.strictEqual(row.denials_in_window, 1, 'the re-review keeps the single deduped denial live (known over-halt-direction behavior; the v3.9 human is the release valve)');
});

test('26. H2 persona-relocate BLOCKED (VALIDATE hacker): forged same-agentId different-persona later lines cannot silence the real persona', () => {
  // 5 real victim builds (distinct agent_ids) that would trip the per-persona threshold of 5.
  const agentIds = [];
  for (let i = 0; i < 5; i += 1) {
    const a = nextAgentId('victim');
    agentIds.push(a);
    vstore.recordVerdict({ verdict: 'fail', subject: { persona: 'victim' }, verifier: { identity: REVIEWERS[0], kind: 'structural' }, agentId: a, now: NOW - 2000 });
  }
  // For each, a forged LATER-dated hand-written line claiming persona 'sink' on the SAME agent_id.
  agentIds.forEach((a, i) => appendRaw({ attestation_id: `relocate-${i}`, verdict: 'fail', subject: { persona: 'sink' }, evidence_refs: { agent_id: a }, recorded_at: new Date(NOW - 1000).toISOString(), expires_after_days: 30 }));
  const e = evaluate({ persona: 'victim', now: NOW });
  assert.strictEqual(e.denials_in_window, 5, 'the real victim denials survive — (persona,id) keying forks the relocate');
  assert.strictEqual(e.tripped, true, 'victim still trips; the forged sink lines only ADD an over-halt');
});

test('27. M1 relocate-to-unknown BLOCKED: a non-string-persona forged line cannot silence the real persona', () => {
  const agentIds = [];
  for (let i = 0; i < 5; i += 1) {
    const a = nextAgentId('victim');
    agentIds.push(a);
    vstore.recordVerdict({ verdict: 'fail', subject: { persona: 'victim' }, verifier: { identity: REVIEWERS[0], kind: 'structural' }, agentId: a, now: NOW - 2000 });
  }
  // A single forged later line per build with a NON-STRING persona (normalizes to 'unknown').
  agentIds.forEach((a, i) => appendRaw({ attestation_id: `obj-${i}`, verdict: 'fail', subject: { persona: {} }, evidence_refs: { agent_id: a }, recorded_at: new Date(NOW - 1000).toISOString(), expires_after_days: 30 }));
  assert.strictEqual(evaluate({ persona: 'victim', now: NOW }).tripped, true, 'the unknown-relocate cannot remove the real victim trip');
});

test('25. scan-source fetch horizon (self-caught): aged-out mints still feed the latch (manage-promote)', () => {
  const stateDir = fs.mkdtempSync(path.join(TMP, 'ks-'));
  for (let i = 0; i < 10; i += 1) writeCommittedOp(stateDir, `run-${i}`, 'TOMBSTONE', NOW - 15 * MIN); // out of the 10min window, inside the 20min look-back
  const v = projectBreaker({ now: NOW, source: 'manage-promote', stateDir });
  assert.strictEqual(v.global.denials_in_window, 0, 'the window honestly reports 0');
  assert.strictEqual(v.global.latched, true, 'the 10-mint crossing at now-15min latches the global plane');
  const e = evaluate({ now: NOW, source: 'manage-promote', stateDir });
  assert.strictEqual(e.tripped, true);
  assert.strictEqual(e.scope, 'global');
  assert.strictEqual(e.latched_global, true);
});

process.stdout.write(`\ngraduation-gates.test.js (v3.8b W1): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
