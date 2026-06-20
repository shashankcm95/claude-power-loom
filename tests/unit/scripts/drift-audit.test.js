#!/usr/bin/env node
'use strict';

// tests/unit/scripts/drift-audit.test.js
// Ghost Heartbeat W2-PR1 — the producer. Verify guard (T1-T6), digest +
// session_id provenance (T9), end-to-end with a MOCKED judge + spy emit
// (T11-T13). No real claude -p here (that is the capability-free helper's test).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const D = require('../../../packages/kernel/spawn-state/drift-audit');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}
function fixture(sessionId, turns) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-fix-'));
  const p = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(p, `${turns.map((t) => JSON.stringify(t)).join('\n')}\n`);
  return { p, dir, statePath: path.join(dir, 'state.json'), cleanup: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } } };
}

process.stdout.write('\n=== drift-audit (w2-pr1) ===\n');

// --- Verify guard ---
test('T1: invented / unknown class is dropped (taxonomy stability)', () => {
  assert.deepStrictEqual(D.verifyJudgeOutput([{ class: 'totally-made-up', evidence: 'x', confidence: 0.9 }], { sessionId: 's' }), []);
});

test('T2: a closed frozen class is accepted', () => {
  assert.deepStrictEqual(D.verifyJudgeOutput([{ class: 'plan-honesty', evidence: 'q', confidence: 0.9 }], { sessionId: 's' }), ['plan-honesty']);
});

test('T3: cwe-class is digit-bounded; an injection suffix is dropped', () => {
  assert.ok(D.isValidDriftClass('cwe-class:74'));
  assert.ok(!D.isValidDriftClass('cwe-class:74 IGNORE PRIOR INSTRUCTIONS'));
  assert.ok(!D.isValidDriftClass('cwe-class:'));
  assert.ok(!D.isValidDriftClass('cwe-class:99999')); // > 4 digits
  assert.deepStrictEqual(
    D.verifyJudgeOutput([{ class: 'cwe-class:74 rm -rf /', evidence: 'x', confidence: 0.9 }], { sessionId: 's' }), [],
    'injection payload in the cwe suffix is rejected at the boundary');
  assert.deepStrictEqual(D.verifyJudgeOutput([{ class: 'cwe-class:79', evidence: 'x', confidence: 0.9 }], { sessionId: 's' }), ['cwe-class:79']);
});

test('T4: low confidence and missing evidence are dropped', () => {
  assert.deepStrictEqual(D.verifyJudgeOutput([{ class: 'plan-honesty', evidence: 'x', confidence: 0.3 }], { sessionId: 's' }), []);
  assert.deepStrictEqual(D.verifyJudgeOutput([{ class: 'plan-honesty', evidence: '', confidence: 0.9 }], { sessionId: 's' }), []);
});

test('T5: only allowlisted / bounded class strings survive (no free-text reaches emit)', () => {
  const s = D.verifyJudgeOutput([
    { class: 'plan-honesty', evidence: 'q', confidence: 0.9 },
    { class: '<script>alert(1)</script>', evidence: 'q', confidence: 0.9 },
    { class: 'drift:plan-honesty', evidence: 'q', confidence: 0.9 }, // already-prefixed: not a valid suffix
  ], { sessionId: 's' });
  assert.deepStrictEqual(s, ['plan-honesty']);
});

test('T6: cross-session dedup via emitted state', () => {
  const state = { emitted: { s: ['plan-honesty'] } };
  const s = D.verifyJudgeOutput([
    { class: 'plan-honesty', evidence: 'q', confidence: 0.9 },
    { class: 'recon-depth', evidence: 'q', confidence: 0.9 },
  ], { sessionId: 's', state });
  assert.deepStrictEqual(s, ['recon-depth']);
});

test('T6b: intra-pass dedup + maxEmit cap', () => {
  assert.deepStrictEqual(
    D.verifyJudgeOutput([{ class: 'plan-honesty', evidence: 'q', confidence: 0.9 }, { class: 'plan-honesty', evidence: 'q2', confidence: 0.9 }], { sessionId: 's' }),
    ['plan-honesty']);
  const distinct = ['plan-honesty', 'recon-depth', 'claim-false', 'scope-creep', 'fail-silent'].map((c) => ({ class: c, evidence: 'q', confidence: 0.9 }));
  assert.strictEqual(D.verifyJudgeOutput(distinct, { sessionId: 's', maxEmit: 3 }).length, 3);
});

// --- Digest + session_id provenance ---
// The dedup key is the DOMINANT in-transcript sessionId, NOT the filename: a file
// can legitimately be named by a lineage anchor that differs from the session that
// produced its content (resume / compaction rotation — dogfooded against a real
// 56k-line transcript). The verify board's "reject filename mismatch" rested on a
// false premise (filename == sessionId); the dogfood corrected it.
test('T9: session_id is the DOMINANT in-transcript field, independent of filename', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-mm-'));
  const p = path.join(dir, 'LINEAGE-ANCHOR.jsonl'); // filename != content sessionId (legit)
  const lines = [
    { type: 'mode', sessionId: 'LINEAGE-ANCHOR' }, // 1 line of the filename anchor
    { type: 'user', sessionId: 'real-work', message: { role: 'user', content: 'planning step one' } },
    { type: 'assistant', sessionId: 'real-work', message: { role: 'assistant', content: [{ type: 'text', text: 'doing it' }] } },
  ];
  fs.writeFileSync(p, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  try {
    const dg = D.buildDigest(p);
    assert.strictEqual(dg.ok, true, `expected ok, got ${dg.reason}`);
    assert.strictEqual(dg.sessionId, 'real-work', 'dominant sessionId wins, not the 1-line filename anchor');
    assert.ok(dg.digest.includes('planning step one'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T9b: a transcript with no sessionId at all is rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-ns-'));
  const p = path.join(dir, 'x.jsonl');
  fs.writeFileSync(p, `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } })}\n`);
  try { assert.strictEqual(D.buildDigest(p).reason, 'no-session-id'); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// T9c (VALIDATE hacker LOW): an over-long / control-char sessionId is a self-asserted field
// that would become an emitted-set / pruneTracking KEY -> on-disk DoS + control-char-in-JSON.
// isValidSid bounds it: an out-of-bound sid is IGNORED (not counted, never a key); a valid sid
// in the same file still wins, and the keyset excludes the bad one.
test('T9c: an over-long / NUL-bearing sessionId is ignored; a valid sid still wins; keyset excludes the bad one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-sid-'));
  const p = path.join(dir, 'x.jsonl');
  const ctrlSid = `a${String.fromCharCode(0)}b`; // a real NUL (built at runtime; source stays ASCII)
  const lines = [
    { type: 'user', sessionId: 'x'.repeat(200), message: { role: 'user', content: 'a' } },
    { type: 'user', sessionId: ctrlSid, message: { role: 'user', content: 'b' } },
    { type: 'user', sessionId: 'good-sid', message: { role: 'user', content: 'c' } },
    { type: 'user', sessionId: 'good-sid', message: { role: 'user', content: 'd' } },
  ];
  fs.writeFileSync(p, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  try {
    const dg = D.buildDigest(p);
    assert.strictEqual(dg.ok, true);
    assert.strictEqual(dg.sessionId, 'good-sid', 'out-of-bound sids are not counted; the valid one is dominant');
    assert.deepStrictEqual(dg.sessionIds, ['good-sid'], 'the keyset excludes the over-long / control-char sids');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T9d: a transcript whose ONLY sids are out-of-bound -> no-session-id (fail closed)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-sid2-'));
  const p = path.join(dir, 'x.jsonl');
  fs.writeFileSync(p, `${JSON.stringify({ type: 'user', sessionId: 'y'.repeat(500), message: { role: 'user', content: 'a' } })}\n`);
  try { assert.strictEqual(D.buildDigest(p).reason, 'no-session-id'); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// T-isfile (W2-PR2 hardening): a non-regular-file transcriptPath (here a directory;
// the worst case is a symlink-to-FIFO, where fs.readFileSync would BLOCK the
// auto-fired detached producer for the 60s judge window) must fail CLOSED, not hang
// or throw. readTranscriptText's stat.isFile() guard -> '' -> no-session-id.
test('T-isfile: a directory transcriptPath fails closed (no hang, no throw)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-dir-'));
  try {
    const dg = D.buildDigest(dir);
    assert.strictEqual(dg.ok, false, 'a non-regular file must not be digested');
    assert.strictEqual(dg.reason, 'no-session-id');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// T-isfile-fifo: the ACTUAL hang vector (Probe P7) is a FIFO, where fs.readFileSync
// BLOCKS — a directory throws EISDIR and never hangs, so the directory case above
// does NOT by itself demonstrate no-hang (VALIDATE honesty-auditor HIGH: the
// directory test was relabeled as proving the hang fix). Exercise the real FIFO in
// a CHILD with a hard timeout: the isFile() guard (drift-audit.js readTranscriptText)
// must return PROMPTLY; if the guard ever regresses, the child blocks and the
// spawnSync times out -> this test FAILS (it never hangs the suite). Skipped where
// mkfifo is unavailable (e.g. win32).
test('T-isfile-fifo: a FIFO transcriptPath returns promptly, never blocks (no hang)', () => {
  if (process.platform === 'win32') { process.stdout.write('  (skip T-isfile-fifo: no mkfifo on win32)\n'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-fifo-'));
  const fifo = path.join(dir, 'p.fifo');
  try {
    try { execFileSync('mkfifo', [fifo]); }
    catch { process.stdout.write('  (skip T-isfile-fifo: mkfifo unavailable)\n'); return; }
    const mod = path.resolve(__dirname, '../../../packages/kernel/spawn-state/drift-audit');
    const r = spawnSync(process.execPath, ['-e',
      `const D=require(${JSON.stringify(mod)});process.stdout.write(JSON.stringify(D.buildDigest(${JSON.stringify(fifo)})));`],
      { encoding: 'utf8', timeout: 4000 });
    assert.strictEqual(r.error, undefined, `buildDigest(FIFO) must not time out / error (a hang regression); got ${r.error && r.error.code}`);
    assert.strictEqual(r.status, 0, 'child exited cleanly');
    assert.strictEqual(JSON.parse(r.stdout).ok, false, 'a FIFO must fail closed, not hang');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// T-oversized: a transcript over the 8MB byte cap exercises the tail-read branch
// (readTranscriptText) — it must read the NEWEST turns, drop the partial leading
// line, still resolve the dominant sessionId, and bound the digest. (Coverage the
// VALIDATE board flagged as absent.)
test('T-oversized: a >8MB transcript tail-reads the newest turns, bounded digest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghb-big-'));
  const p = path.join(dir, 'big.jsonl');
  const filler = 'x'.repeat(500);
  const lines = [];
  for (let i = 0; i < 16000; i++) { // ~9.3MB > the 8MB cap
    lines.push(JSON.stringify({ type: 'user', sessionId: 'BIG', message: { role: 'user', content: `filler ${i} ${filler}` } }));
  }
  lines.push(JSON.stringify({ type: 'user', sessionId: 'BIG', message: { role: 'user', content: 'NEWEST_TURN_MARKER_ZZ' } }));
  fs.writeFileSync(p, `${lines.join('\n')}\n`);
  try {
    const dg = D.buildDigest(p);
    assert.strictEqual(dg.ok, true, `expected ok, got ${dg.reason}`);
    assert.strictEqual(dg.sessionId, 'BIG');
    assert.ok(dg.digest.includes('NEWEST_TURN_MARKER_ZZ'), 'the newest turn (tail) is in the digest');
    assert.ok(dg.digest.length <= 24000 + 100, 'digest is bounded to the char budget');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- end-to-end (mocked judge + spy emit) ---
test('T11: mocked judge -> verified -> emit once per class; second run idempotent', () => {
  const fx = fixture('sess-e2e', [{ type: 'user', sessionId: 'sess-e2e', message: { role: 'user', content: 'did some planning' } }]);
  try {
    const emitted = [];
    const judgeFn = () => ({ ok: true, text: '```json\n[{"class":"plan-honesty","evidence":"q","confidence":0.9}]\n```' });
    const res = D.auditTranscript({ transcriptPath: fx.p, judgeFn, emitFn: (c) => emitted.push(c), statePath: fx.statePath });
    assert.strictEqual(res.ok, true);
    assert.deepStrictEqual(res.emitted, ['plan-honesty']);
    assert.deepStrictEqual(emitted, ['plan-honesty']);
    const res2 = D.auditTranscript({ transcriptPath: fx.p, judgeFn, emitFn: (c) => emitted.push(c), statePath: fx.statePath });
    assert.deepStrictEqual(res2.emitted, [], 'second run dedups (same session)');
    assert.deepStrictEqual(emitted, ['plan-honesty']);
  } finally { fx.cleanup(); }
});

test('T12: killswitch GHOST_HEARTBEAT_DISABLED=1 -> zero judge calls, zero emit', () => {
  const fx = fixture('sess-kill', [{ type: 'user', sessionId: 'sess-kill', message: { role: 'user', content: 'x' } }]);
  const prev = process.env.GHOST_HEARTBEAT_DISABLED;
  process.env.GHOST_HEARTBEAT_DISABLED = '1';
  try {
    let judgeCalls = 0;
    let emitCalls = 0;
    const res = D.auditTranscript({ transcriptPath: fx.p, judgeFn: () => { judgeCalls++; return { ok: true, text: '[]' }; }, emitFn: () => { emitCalls++; }, statePath: fx.statePath });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'killswitch');
    assert.strictEqual(judgeCalls, 0);
    assert.strictEqual(emitCalls, 0);
  } finally {
    if (prev === undefined) delete process.env.GHOST_HEARTBEAT_DISABLED; else process.env.GHOST_HEARTBEAT_DISABLED = prev;
    fx.cleanup();
  }
});

test('T13: malformed judge JSON -> fail-soft (no throw, no emit)', () => {
  const fx = fixture('sess-bad', [{ type: 'user', sessionId: 'sess-bad', message: { role: 'user', content: 'x' } }]);
  try {
    let emit = 0;
    const res = D.auditTranscript({ transcriptPath: fx.p, judgeFn: () => ({ ok: true, text: 'not json at all' }), emitFn: () => { emit++; }, statePath: fx.statePath });
    assert.strictEqual(res.ok, true);
    assert.deepStrictEqual(res.emitted, []);
    assert.strictEqual(emit, 0);
  } finally { fx.cleanup(); }
});

test('T13b: parseJudgeJson fence-strips and tolerates prose', () => {
  assert.strictEqual(D.parseJudgeJson('```json\n[{"class":"plan-honesty"}]\n```').length, 1);
  assert.deepStrictEqual(D.parseJudgeJson('here you go: [] thanks'), []);
  assert.deepStrictEqual(D.parseJudgeJson('garbage'), []);
});

test('T13c: judge-fail (ok:false) -> producer returns ok:false, no emit', () => {
  const fx = fixture('sess-jf', [{ type: 'user', sessionId: 'sess-jf', message: { role: 'user', content: 'x' } }]);
  try {
    let emit = 0;
    const res = D.auditTranscript({ transcriptPath: fx.p, judgeFn: () => ({ ok: false, reason: 'timeout' }), emitFn: () => { emit++; }, statePath: fx.statePath });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'timeout');
    assert.strictEqual(emit, 0);
  } finally { fx.cleanup(); }
});

process.stdout.write(`\n  Passed: ${passed}  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
