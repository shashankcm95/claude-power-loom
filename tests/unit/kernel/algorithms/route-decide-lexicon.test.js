#!/usr/bin/env node

// tests/unit/kernel/algorithms/route-decide-lexicon.test.js
//
// Router-V2 W1 — the lexicon-as-data artifact + the phrase-aware invert +
// the fail-closed boundary. These pin the paths the 19-test behavioral suite
// (route-decide.test.js) leaves uncovered (arch-F1 / cr-F2,F3,F6,F7): the four
// structural ROLES, the exact word-boundary rule (multi-space / hyphen-prefix /
// case-fold / underscore-unit / tab / slash), the --context pass (3 behaviors),
// compound_weak suppression-by-stakes, and OQ4 fail-closed (throw -> exit!=0,
// NEVER a fabricated exit-0 verdict).
//
// The byte-for-byte behavior-identical guarantee is enforced separately by the
// throwaway equivalence harness over the 803-case log (old scoreTask IS the
// oracle); this file pins the NEW concern (the artifact boundary) + the boundary
// nuances no existing fixture exercises.
//
// House idiom: imperative assert + hand-rolled runner + exit code.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RD_PATH = path.join(__dirname, '../../../../packages/kernel/algorithms/route-decide.js');
const LEXICON_PATH = path.join(__dirname, '../../../../packages/kernel/_lib/route-lexicon.json');
const { scoreTask, loadLexicon } = require(RD_PATH);
const artifact = require(LEXICON_PATH);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// matched tokens for a given scored dim
function dimMatched(out, dim) { return (out.scores_by_dim[dim] && out.scores_by_dim[dim].matched) || []; }

// ---------- artifact structure: the FOUR roles (cr-F1 / arch-F6) ----------

test('artifact roles: scored === the 8 weighted dims; counter/infra/detection are SEPARATE roles', () => {
  assert.deepStrictEqual(artifact.roles.scored, [
    'stakes', 'domain_novelty', 'compound_strong', 'compound_weak',
    'audit_binary', 'scope_size', 'convergence_value', 'user_facing_or_ux',
  ], 'the 8 scored dims, in order');
  assert.strictEqual(artifact.roles.counter_penalty, 'counter_signals', 'counter-penalty role');
  assert.strictEqual(artifact.roles.infra_lift, 'infra_terms', 'infra-lift role');
  assert.strictEqual(artifact.roles.detection_only, 'substrate_meta', 'detection-only role');
  // the special-path roles must NOT be mislabeled as scored dims
  assert.ok(!artifact.roles.scored.includes('counter_signals'), 'counter_signals is not scored');
  assert.ok(!artifact.roles.scored.includes('infra_terms'), 'infra_terms is not scored');
});

test('artifact overlap: scored_and_detected_overlap === actual compound_strong/substrate_meta intersection (17 tokens)', () => {
  const cs = new Set(artifact.categories.compound_strong);
  const sm = new Set(artifact.categories.substrate_meta);
  const actual = artifact.categories.compound_strong.filter((t) => sm.has(t)).sort();
  const declared = [...artifact.scored_and_detected_overlap].sort();
  assert.deepStrictEqual(declared, actual, 'declared overlap === actual intersection');
  assert.strictEqual(declared.length, 17, 'the 17 intentional scored+detected tokens');
  for (const t of artifact.scored_and_detected_overlap) {
    assert.ok(cs.has(t) && sm.has(t), `'${t}' is in BOTH compound_strong and substrate_meta`);
  }
});

// ---------- the phrase-aware invert: the EXACT boundary rule (cr-F3 / arch-F1) ----------

test('boundary: single-space phrase matches; multi-space / tab / newline near-misses do NOT', () => {
  assert.ok(dimMatched(scoreTask('enforce rate limiting on the public endpoints'), 'stakes').includes('rate limiting'),
    'single-space "rate limiting" matches');
  assert.ok(!dimMatched(scoreTask('enforce rate  limiting now and forever'), 'stakes').includes('rate limiting'),
    'double-space must NOT match the single-space token');
  assert.ok(!dimMatched(scoreTask('enforce rate\tlimiting via the tab variant'), 'stakes').includes('rate limiting'),
    'tab between words is not the literal single space');
  assert.ok(!dimMatched(scoreTask('enforce rate\nlimiting via the newline variant'), 'stakes').includes('rate limiting'),
    'newline between words is not the literal single space');
});

test('boundary: a hyphenated token matches as a sub-phrase of a longer hyphenated compound', () => {
  assert.ok(dimMatched(scoreTask('a sweeping multi-file-system refactor'), 'scope_size').includes('multi-file'),
    'multi-file matches inside multi-file-system');
  assert.ok(!dimMatched(scoreTask('a single multifile change with no hyphen'), 'scope_size').includes('multi-file'),
    'multi-file must NOT match the no-hyphen "multifile"');
});

test('boundary: case-fold — uppercase input matches the lowercase token', () => {
  assert.ok(dimMatched(scoreTask('A PRODUCTION DEPLOYMENT WITH OAUTH'), 'stakes').includes('production'),
    'PRODUCTION matches production');
});

test('boundary: underscore is a word char — post_state_hash is ONE unit (scoring path)', () => {
  assert.ok(dimMatched(scoreTask('verify the post_state_hash keyspace isolation'), 'compound_strong').includes('post_state_hash'),
    'underscored token scores as a unit in compound_strong');
  assert.ok(!dimMatched(scoreTask('document the post state of the hash table'), 'compound_strong').includes('post_state_hash'),
    'the space-separated near-miss must NOT score');
});

test('boundary: a space-token does not match its hyphen variant, and vice versa (a4 gate / verdict-attestation)', () => {
  assert.ok(scoreTask('flip the a4 gate to enforcing').substrate_meta_tokens.includes('a4 gate'),
    '"a4 gate" (space) detects');
  assert.ok(!scoreTask('the a4-gate hyphen variant here').substrate_meta_tokens.includes('a4 gate'),
    '"a4-gate" (hyphen) must NOT match the space token');
  assert.ok(dimMatched(scoreTask('wire the verdict-attestation store'), 'compound_strong').includes('verdict-attestation'),
    'hyphenated "verdict-attestation" scores');
  assert.ok(!dimMatched(scoreTask('the verdict attestation space form'), 'compound_strong').includes('verdict-attestation'),
    'the space form "verdict attestation" is NOT the hyphen token (cr-F8)');
});

test('boundary: a slash is a boundary — refs/loom matches', () => {
  assert.ok(scoreTask('point refs/loom at the new tip').substrate_meta_tokens.includes('refs/loom'),
    'refs/loom detects across the slash boundary');
});

// ---------- the --context pass: its 3 distinct behaviors (cr-F2) ----------

test('context: iterates ONLY the weighted dims — a counter-signal in context applies NO penalty', () => {
  const out = scoreTask('do the thing', { context: 'production auth with a small typo cleanup' });
  assert.ok(out.context_contributions.stakes, 'a weighted-dim (stakes) match in context contributes');
  assert.ok(!('counter_signals' in out.context_contributions), 'counter_signals is NOT a context contribution');
  assert.strictEqual(out.counter_signal_contribution, 0, 'no counter penalty from context');
});

test('context: infra-implicit lift applies via its own block at half weight (0.30 * 0.5)', () => {
  const out = scoreTask('do the thing', { context: 'kubernetes terraform deployment across the fleet' });
  assert.ok(out.context_contributions.infra_implicit, 'infra-implicit fires in context');
  assert.strictEqual(out.context_contributions.infra_implicit.contribution, 0.15, 'lift 0.30 * mult 0.5 = 0.15');
});

test('context: borderline-promotion — bare zero-signal + a WEAK-but-meaningful context promotes root -> borderline', () => {
  // The promotion path fires ONLY when the post-context score stays within the
  // root band (a rich context would reach borderline by score alone, bypassing
  // the promotion mechanism). A stakes-only context contributes 0.25 * 0.5 = 0.125
  // (>= the 0.10 floor, <= ROOT_THRESHOLD).
  const out = scoreTask('please proceed with the next step now', {
    context: 'this concerns the production auth path',
  });
  assert.strictEqual(out.bare_score_total, 0, 'bare task is zero-signal');
  assert.ok(out.context_score >= 0.10 && (out.bare_score_total + out.context_score) <= 0.30,
    `context is meaningful but stays within the root band; got context_score ${out.context_score}`);
  assert.strictEqual(out.borderline_promotion_applied, true, 'promotion fired');
  assert.strictEqual(out.recommendation, 'borderline', 'promoted to borderline');
});

// ---------- compound_weak suppression-by-stakes (cr-F6) ----------

test('compound_weak: zeroed when stakes fires (suppressed_by_stakes); contributes when stakes does NOT', () => {
  const suppressed = scoreTask('a secure production architecture redesign');
  assert.ok(dimMatched(suppressed, 'stakes').length > 0, 'stakes fired');
  assert.ok(dimMatched(suppressed, 'compound_weak').length > 0, 'compound_weak matched a token');
  assert.strictEqual(suppressed.scores_by_dim.compound_weak.suppressed_by_stakes, true, 'suppression flag set');
  assert.strictEqual(suppressed.scores_by_dim.compound_weak.contribution, 0, 'compound_weak contributes 0 under stakes');

  const fires = scoreTask('a clean architecture and design framework layer');
  assert.strictEqual(dimMatched(fires, 'stakes').length, 0, 'no stakes term');
  assert.ok(dimMatched(fires, 'compound_weak').length > 0, 'compound_weak matched');
  assert.strictEqual(fires.scores_by_dim.compound_weak.contribution, 0.075, 'compound_weak contributes its weight');
  assert.ok(!('suppressed_by_stakes' in fires.scores_by_dim.compound_weak), 'no suppression flag when stakes absent');
});

// ---------- OQ4: fail-closed at the A4 boundary (throw -> exit!=0, never a fabricated verdict) ----------

let tmpDir;
function fixture(name, contents) {
  if (!tmpDir) tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv2-lex-'));
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, contents);
  return p;
}
function validArtifact() { return JSON.parse(fs.readFileSync(LEXICON_PATH, 'utf8')); }

test('fail-closed: an ABSENT artifact throws LexiconError (not a degenerate scorer)', () => {
  assert.throws(() => loadLexicon(path.join(os.tmpdir(), 'rv2-does-not-exist-9981.json')),
    (e) => e.name === 'LexiconError', 'absent file -> LexiconError');
});

test('fail-closed: a MALFORMED-JSON artifact throws LexiconError', () => {
  const p = fixture('malformed.json', '{ this is : not, valid json ]');
  assert.throws(() => loadLexicon(p), (e) => e.name === 'LexiconError', 'bad JSON -> LexiconError');
});

test('fail-closed: a VERSION-MISMATCHED artifact throws (no silent acceptance)', () => {
  const a = validArtifact();
  a.lexicon_version = 'v0-stale';
  const p = fixture('badver.json', JSON.stringify(a));
  assert.throws(() => loadLexicon(p), (e) => e.name === 'LexiconError' && /version mismatch/.test(e.message));
});

test('fail-closed: a BAD-SHAPE artifact (scored != WEIGHTS) throws (no misclassification)', () => {
  const a = validArtifact();
  a.roles.scored = a.roles.scored.slice(0, 7);  // drop a weighted dim
  const p = fixture('badshape.json', JSON.stringify(a));
  assert.throws(() => loadLexicon(p), (e) => e.name === 'LexiconError' && /scored must equal WEIGHTS/.test(e.message));
});

test('fail-closed: a tampered overlap declaration throws (drift-proof first-class field)', () => {
  const a = validArtifact();
  a.scored_and_detected_overlap = a.scored_and_detected_overlap.slice(0, 5);
  const p = fixture('badoverlap.json', JSON.stringify(a));
  assert.throws(() => loadLexicon(p), (e) => e.name === 'LexiconError' && /scored_and_detected_overlap/.test(e.message));
});

test('fail-closed: a re-introduced scored+counter double-count throws at LOAD (W3 M1 enforcement)', () => {
  // VALIDATE/hacker M1: graduate the de-dup invariant from test-only to load-time
  // fail-closed. Re-introducing `experiment` into counter_signals (it stays in
  // domain_novelty) must now throw, not load silently at exit 0.
  const a = validArtifact();
  a.categories.counter_signals = [...a.categories.counter_signals, 'experiment'];
  const p = fixture('doublecount.json', JSON.stringify(a));
  assert.throws(() => loadLexicon(p),
    (e) => e.name === 'LexiconError' && /counter-signal|double-count/.test(e.message),
    'a scored token re-added to counter_signals fails closed');
});

test('fail-closed CLI: a bad artifact -> non-zero exit + NO stdout (never a fabricated exit-0 verdict)', () => {
  const bad = fixture('cli-bad.json', '{ "lexicon_version": "v1-2026-06-19"');  // truncated JSON
  const r = spawnSync(process.execPath, [RD_PATH, '--task', 'design a secure production auth system'],
    { encoding: 'utf8', env: { ...process.env, ROUTE_LEXICON_PATH: bad } });
  assert.notStrictEqual(r.status, 0, 'exit code is non-zero on a bad lexicon');
  assert.strictEqual((r.stdout || '').trim(), '', 'NO stdout JSON (the hook reads non-zero exit as route-decide-failed -> approve)');
  assert.ok(/LexiconError|route-lexicon/.test(r.stderr || ''), 'the typed error surfaces on stderr');
});

test('fail-closed CLI sanity: the REAL bundled artifact loads -> exit 0 + a parseable verdict', () => {
  const r = spawnSync(process.execPath, [RD_PATH, '--task', 'design a secure production auth system'],
    { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'the real artifact yields exit 0');
  const parsed = JSON.parse(r.stdout);
  assert.ok(['route', 'borderline', 'root'].includes(parsed.recommendation), 'a real verdict');
  assert.strictEqual(typeof parsed.score_total, 'number', 'score_total numeric');
});

// ---------- W3 curation: de-dup invariant + transferable adds + version bump ----------

test('W3 de-dup invariant: counter_signals is DISJOINT from the UNION of all scored dims', () => {
  // The `experiment`/`prototype` double-count (a token in BOTH a +scored dim and the
  // -counter set) was internally incoherent. This guards against the WHOLE class, not
  // just the experiment pair (VERIFY-folded: broadened from domain_novelty-only).
  const counter = new Set(artifact.categories.counter_signals);
  const offenders = [];
  for (const dim of artifact.roles.scored) {
    for (const tok of artifact.categories[dim]) {
      if (counter.has(tok)) offenders.push(`${tok} (in ${dim} AND counter_signals)`);
    }
  }
  assert.deepStrictEqual(offenders, [], `no token may be both scored and a counter-signal; found: ${offenders.join(', ')}`);
});

test('W3 de-dup direction: experiment + prototype live in domain_novelty, NOT counter_signals', () => {
  assert.ok(artifact.categories.domain_novelty.includes('experiment'), 'experiment kept in domain_novelty (novelty signal)');
  assert.ok(artifact.categories.domain_novelty.includes('prototype'), 'prototype kept in domain_novelty');
  assert.ok(!artifact.categories.counter_signals.includes('experiment'), 'experiment removed from counter_signals (was a false-positive triviality penalty)');
  assert.ok(!artifact.categories.counter_signals.includes('prototype'), 'prototype removed from counter_signals');
});

test('W3 de-dup behavior: a substantive "experiment" task is no longer counter-penalized', () => {
  // ISOLATED task (cr LOW-1): "fresh angle" carries no other lexicon token, so the
  // counter_signal_contribution===0 assertion is unambiguously about the de-dup.
  const out = scoreTask('experiment with a fresh angle');
  assert.ok(!out.counter_signals.includes('experiment'), 'experiment is not a fired counter-signal');
  assert.strictEqual(out.counter_signal_contribution, 0, 'no -0.25 penalty from experiment alone');
  assert.ok(dimMatched(out, 'domain_novelty').includes('experiment'), 'experiment still lifts domain_novelty (+0.15)');
});

test('W3 transferable adds: the high-precision review COMPOUNDS are in audit_binary', () => {
  const ab = new Set(artifact.categories.audit_binary);
  for (const tok of ['code review', 'code-review', 'design review', 'security review',
    'architecture review', 'arch review', 'threat model', 'threat-model', 'threat modeling']) {
    assert.ok(ab.has(tok), `'${tok}' added to audit_binary`);
  }
});

test('W3 transferable behavior: "code review" fires audit_binary (+0.20), bare "review" does NOT', () => {
  const reviewed = scoreTask('do a thorough code review of the new auth handler');
  assert.ok(dimMatched(reviewed, 'audit_binary').includes('code review'), '"code review" matches audit_binary');
  assert.ok(reviewed.scores_by_dim.audit_binary.contribution > 0, 'audit_binary contributes');
  // bare "review" must NOT be a token (deliberately excluded: 43 lift / 5 root regressions = overfit + gate FAIL)
  assert.ok(!artifact.categories.audit_binary.includes('review'), 'bare "review" is NOT an audit_binary token');
});

test('W3 version bump: the bundled lexicon is v2-2026-06-19 and loads (EXPECTED lockstep holds)', () => {
  assert.strictEqual(artifact.lexicon_version, 'v2-2026-06-19', 'lexicon_version bumped for the W3 curation');
  // loadLexicon throws on version mismatch -> a clean load proves EXPECTED_LEXICON_VERSION
  // was bumped in lockstep (route-decide.js:92).
  assert.doesNotThrow(() => loadLexicon(LEXICON_PATH), 'the real artifact loads -> EXPECTED matches v2');
});

// --- cleanup + summary ---

if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ } }
process.stdout.write(`\nroute-decide-lexicon.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
