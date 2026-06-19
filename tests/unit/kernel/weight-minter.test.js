#!/usr/bin/env node

// tests/unit/kernel/weight-minter.test.js
//
// v-next Authenticated Minter — P0 (RFC 2026-06-18-authenticated-minter-provenance-close, Option B).
// TDD Phase 1: written FIRST, runs RED against a missing module
// (packages/kernel/_lib/weight-minter.js). This file IS the behavioral contract for the build.
//
// The minter closes (mechanically, SHADOW) the integrity!=provenance gap (#273 family): a gating
// weight becomes a SIGNED, recompute-from-authoritative artifact instead of a co-forgeable store
// read. P0 ships the mechanics frozen; NO consumer gates on it yet.
//
// Build contract (from the architect+hacker VERIFY board, both APPROVE-WITH-CHANGES):
//   INV-MINT (F1/H-1): sig is over minted_id = sha256(canonical({kind,subject,value,basis_digest,
//     minted_at,key_id})) — it COMMITS value. verifyMintedWeight re-derives minted_id from an
//     EXPLICIT field allowlist (H-2: mintedIdBasis, shared by mint+verify) and verifies sig over it;
//     it does NOT re-run the policy. A value-swap (genuine basis_digest+sig, forged value) -> FALSE.
//   F2: mintWeight takes {kind,subject} ONLY (no caller value/bytes). subject is a validated scalar;
//     a hostile subject (object/array/__proto__/non-hex for the kernel policy) -> null.
//   OQ-B (beta): ONE real kernel-chain policy exercised end-to-end against a REAL appended record
//     (Rule-2a-corollary: the real recompute path, not a mock).
//   F3: key_id is minter-set ('v0' sentinel), inside minted_id, NOT caller-overridable.
//   F4: SHADOW is mechanically checkable — no non-test file imports weight-minter.js.
//   F5: identity aliases (covered in edge-attestation.test.js) + depth-bounded canonical serializer
//     -> mint null / verify false on a pathological basis, never a throw.
//   SHADOW default: no key -> mintWeight null, verifyMintedWeight false (fail-closed).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..', '..');
const minter = require(path.join(REPO, 'packages', 'kernel', '_lib', 'weight-minter.js'));
const {
  mintWeight, verifyMintedWeight, registerWeightPolicy, makeKernelRecordPolicy, mintedIdBasis,
  KERNEL_RECORD_KIND, KEY_ID_V0,
} = minter;
const { generateEdgeKeypair, signRecordId } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'edge-attestation.js'));
const store = require(path.join(REPO, 'packages', 'kernel', '_lib', 'record-store.js'));
const { computeTransactionId } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'transaction-record.js'));

// Hermetic: no ambient edge keys (signRecordId/verifyRecordSig fall back to env).
delete process.env.LOOM_EDGE_SIGNING_KEY;
delete process.env.LOOM_EDGE_VERIFY_KEY;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
}

const KEYS = generateEdgeKeypair();
const SIGN = { privateKeyPem: KEYS.privateKeyPem };
const VERIFY = { publicKeyPem: KEYS.publicKeyPem };
const RUN_ID = 'run-2026-06-19-minter-p0';

function tmpStateDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'minter-p0-')); }
function cleanup(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } }

// A canonical, integrity-consistent kernel transaction record (transaction_id computed over the
// marker-free body, so appendRecord's integrity check passes). Mirrors record-store.test.js.
function buildRecord(seed) {
  const post = crypto.createHash('sha256').update(`post-${seed}`).digest('hex');
  const body = {
    prev_state_hash: 'GENESIS',
    writer_persona_id: '04-architect.theo',
    writer_spawn_id: `sp-2026-06-19T00:00:00.000Z-arch-${seed}`,
    operation_class: 'CREATE',
    evidence_refs: [`ROOT_TASK_RECORD:task-${seed}`],
    intent_recorded_at: '2026-06-19T00:00:00.000Z',
    commit_outcome: 'COMMITTED',
    schema_version: 'v3',
    post_state_hash: post,
  };
  return { transaction_id: computeTransactionId(body), ...body };
}

// Append one real record into a temp store; returns { stateDir, txid }.
function withRealRecord(seed, fn) {
  const stateDir = tmpStateDir();
  try {
    const rec = buildRecord(seed);
    const res = store.appendRecord(rec, { runId: RUN_ID, stateDir });
    assert.strictEqual(res.ok, true, `append failed: ${JSON.stringify(res)}`);
    return fn({ stateDir, txid: rec.transaction_id });
  } finally {
    cleanup(stateDir);
  }
}

const CTX = (stateDir) => ({ context: { runId: RUN_ID, stateDir } });

// ── 1. End-to-end over a REAL kernel record (the β recompute path) ───────────────────────────────

test('mintWeight over a REAL kernel record -> well-formed signed weight; verifyMintedWeight true', () => {
  withRealRecord('e2e', ({ stateDir, txid }) => {
    const w = mintWeight({ kind: KERNEL_RECORD_KIND, subject: txid }, { ...SIGN, ...CTX(stateDir), now: '2026-06-19T00:00:00.000Z' });
    assert.ok(w && typeof w === 'object', 'expected a minted weight object');
    assert.strictEqual(w.kind, KERNEL_RECORD_KIND);
    assert.strictEqual(w.subject, txid);
    assert.strictEqual(w.value, 1, 'present + content-valid -> value 1');
    assert.ok(/^[0-9a-f]{64}$/.test(w.basis_digest), 'basis_digest is 64-hex');
    assert.strictEqual(w.key_id, KEY_ID_V0);
    assert.strictEqual(typeof w.sig, 'string');
    assert.strictEqual(verifyMintedWeight(w, VERIFY), true);
  });
});

test('mintWeight over an ABSENT txid -> null (policy resolves nothing against the kernel reader)', () => {
  withRealRecord('absent', ({ stateDir }) => {
    const absent = 'f'.repeat(64);
    const w = mintWeight({ kind: KERNEL_RECORD_KIND, subject: absent }, { ...SIGN, ...CTX(stateDir) });
    assert.strictEqual(w, null);
  });
});

// ── 2. INV-MINT — the signature commits value (F1/H-1): value-swap forgery -> FALSE ───────────────

test('value-swap forgery: genuine basis_digest+sig, forged value -> verifyMintedWeight FALSE', () => {
  withRealRecord('swap', ({ stateDir, txid }) => {
    const w = mintWeight({ kind: KERNEL_RECORD_KIND, subject: txid }, { ...SIGN, ...CTX(stateDir) });
    assert.strictEqual(verifyMintedWeight(w, VERIFY), true);
    const forged = { ...w, value: 999 }; // keep basis_digest + sig + minted_at + key_id UNCHANGED
    assert.strictEqual(verifyMintedWeight(forged, VERIFY), false, 'forged value must NOT verify');
  });
});

test('tampering any signed field (kind/subject/basis_digest/minted_at/key_id) -> FALSE', () => {
  withRealRecord('tamper', ({ stateDir, txid }) => {
    const w = mintWeight({ kind: KERNEL_RECORD_KIND, subject: txid }, { ...SIGN, ...CTX(stateDir) });
    assert.strictEqual(verifyMintedWeight({ ...w, kind: 'other-kind' }, VERIFY), false);
    assert.strictEqual(verifyMintedWeight({ ...w, subject: 'a'.repeat(64) }, VERIFY), false);
    assert.strictEqual(verifyMintedWeight({ ...w, basis_digest: 'b'.repeat(64) }, VERIFY), false);
    assert.strictEqual(verifyMintedWeight({ ...w, minted_at: '2099-01-01T00:00:00.000Z' }, VERIFY), false);
    assert.strictEqual(verifyMintedWeight({ ...w, key_id: 'v9' }, VERIFY), false);
  });
});

test('swapped/garbage sig -> FALSE; wrong verify key -> FALSE', () => {
  withRealRecord('sig', ({ stateDir, txid }) => {
    const w = mintWeight({ kind: KERNEL_RECORD_KIND, subject: txid }, { ...SIGN, ...CTX(stateDir) });
    assert.strictEqual(verifyMintedWeight({ ...w, sig: 'not!base64!' }, VERIFY), false);
    const other = generateEdgeKeypair();
    assert.strictEqual(verifyMintedWeight(w, { publicKeyPem: other.publicKeyPem }), false);
  });
});

// ── 3. H-2 — explicit field allowlist (mintedIdBasis shared by mint+verify) ───────────────────────

test('mintedIdBasis returns ONLY the 6 allowlisted fields (drift-proof)', () => {
  const basis = mintedIdBasis({
    kind: 'k', subject: 's', value: 1, basis_digest: 'd', minted_at: 't', key_id: 'v0',
    sig: 'IGNORED', extra: 'IGNORED', minted_id: 'IGNORED',
  });
  assert.deepStrictEqual(
    Object.keys(basis).sort(),
    ['basis_digest', 'key_id', 'kind', 'minted_at', 'subject', 'value'],
  );
});

test('an injected EXTRA body field does NOT change verification (allowlist, not spread-minus-sig)', () => {
  withRealRecord('allow', ({ stateDir, txid }) => {
    const w = mintWeight({ kind: KERNEL_RECORD_KIND, subject: txid }, { ...SIGN, ...CTX(stateDir) });
    assert.strictEqual(verifyMintedWeight({ ...w, injected: 'attacker-field' }, VERIFY), true,
      'an out-of-allowlist field must not affect minted_id');
  });
});

// ── 4. Oracle defense (F2) — caller picks WHICH record, never the VALUE ───────────────────────────

test('mintWeight ignores a caller-supplied value/key_id in the spec (oracle defense)', () => {
  withRealRecord('oracle', ({ stateDir, txid }) => {
    const w = mintWeight(
      { kind: KERNEL_RECORD_KIND, subject: txid, value: 999, key_id: 'evil' },
      { ...SIGN, ...CTX(stateDir), key_id: 'evil-opt' },
    );
    assert.strictEqual(w.value, 1, 'value comes from the policy, never the caller');
    assert.strictEqual(w.key_id, KEY_ID_V0, 'key_id is minter-set, never caller-overridable');
    assert.strictEqual(verifyMintedWeight(w, VERIFY), true);
  });
});

test('unregistered kind -> null (mints nothing; cannot be coerced)', () => {
  withRealRecord('unreg', ({ stateDir, txid }) => {
    assert.strictEqual(mintWeight({ kind: 'no-such-policy', subject: txid }, { ...SIGN, ...CTX(stateDir) }), null);
  });
});

test('hostile subject (object/array/__proto__/non-hex) -> null', () => {
  withRealRecord('hostile', ({ stateDir }) => {
    const opts = { ...SIGN, ...CTX(stateDir) };
    assert.strictEqual(mintWeight({ kind: KERNEL_RECORD_KIND, subject: { a: 1 } }, opts), null);
    assert.strictEqual(mintWeight({ kind: KERNEL_RECORD_KIND, subject: ['a'] }, opts), null);
    assert.strictEqual(mintWeight({ kind: KERNEL_RECORD_KIND, subject: '__proto__' }, opts), null);
    assert.strictEqual(mintWeight({ kind: KERNEL_RECORD_KIND, subject: 'not-hex' }, opts), null);
    assert.strictEqual(mintWeight({ kind: KERNEL_RECORD_KIND, subject: '' }, opts), null);
    assert.strictEqual(mintWeight({ kind: KERNEL_RECORD_KIND, subject: null }, opts), null);
  });
});

// ── 5. SHADOW default — no key -> fail-closed ─────────────────────────────────────────────────────

test('SHADOW default: no signing key -> mintWeight null; no verify key -> verifyMintedWeight false', () => {
  withRealRecord('shadow', ({ stateDir, txid }) => {
    assert.strictEqual(mintWeight({ kind: KERNEL_RECORD_KIND, subject: txid }, CTX(stateDir)), null,
      'no signing key -> mint nothing (fail-closed)');
    // A weight minted WITH a key must not verify when the verifier has NO key.
    const w = mintWeight({ kind: KERNEL_RECORD_KIND, subject: txid }, { ...SIGN, ...CTX(stateDir) });
    assert.strictEqual(verifyMintedWeight(w, {}), false, 'no verify key -> fail-closed');
  });
});

test('verifyMintedWeight fail-closed on malformed input; never throws', () => {
  assert.strictEqual(verifyMintedWeight(null, VERIFY), false);
  assert.strictEqual(verifyMintedWeight(undefined, VERIFY), false);
  assert.strictEqual(verifyMintedWeight([], VERIFY), false);
  assert.strictEqual(verifyMintedWeight({}, VERIFY), false);
  assert.strictEqual(verifyMintedWeight({ kind: 'k' }, VERIFY), false); // missing fields
});

// CodeRabbit #360 (Major): a throwing getter / proxy on the untrusted spec|weight must NOT escape
// the documented "NEVER throws" contract (mint -> null, verify -> false).
test('throwing-getter / proxy input is fail-soft: mintWeight -> null, verifyMintedWeight -> false [CR#360]', () => {
  const HEX = 'a'.repeat(64);
  // mintWeight: a throwing getter on spec.kind or spec.subject
  assert.strictEqual(mintWeight({ get kind() { throw new Error('boom'); }, subject: HEX }, SIGN), null);
  assert.strictEqual(mintWeight({ kind: KERNEL_RECORD_KIND, get subject() { throw new Error('boom'); } }, SIGN), null);
  // verifyMintedWeight: a throwing getter on an accessed property
  const wThrow = {
    get kind() { throw new Error('boom'); },
    subject: HEX, value: 1, basis_digest: 'd'.repeat(64), minted_at: 't', key_id: KEY_ID_V0, sig: 'AAAA',
  };
  assert.strictEqual(verifyMintedWeight(wThrow, VERIFY), false);
  // a Proxy that throws on ANY property get
  const proxy = new Proxy({}, { get() { throw new Error('proxy-boom'); } });
  assert.strictEqual(mintWeight(proxy, SIGN), null);
  assert.strictEqual(verifyMintedWeight(proxy, VERIFY), false);
});

// ── 6. F5 — depth-bounded serializer: a pathological basis -> null/false, never a throw ───────────

test('a policy returning an over-deep basis -> mintWeight null (fail-soft), never throws', () => {
  // Build a deeply-nested basis past canonicalJsonSerialize's MAX_CANONICAL_DEPTH (100).
  let deep = {};
  let cur = deep;
  for (let i = 0; i < 200; i += 1) { cur.a = {}; cur = cur.a; }
  const policies = new Map();
  policies.set('deep-basis', () => ({ value: 1, basis: deep }));
  const w = mintWeight({ kind: 'deep-basis', subject: 'x'.repeat(64) }, { ...SIGN, policies });
  assert.strictEqual(w, null, 'a depth-overflow basis must fail-soft to null, not throw');
});

test('verifyMintedWeight on a weight with an over-deep value -> false (fail-closed), never throws', () => {
  let deep = {};
  let cur = deep;
  for (let i = 0; i < 200; i += 1) { cur.a = {}; cur = cur.a; }
  const w = { kind: 'k', subject: 's'.repeat(64), value: deep, basis_digest: 'd'.repeat(64), minted_at: '2026-06-19T00:00:00.000Z', key_id: KEY_ID_V0, sig: 'AAAA' };
  assert.strictEqual(verifyMintedWeight(w, VERIFY), false);
});

// ── 7. registerWeightPolicy — Open/Closed extension via an injected policy map ────────────────────

test('registerWeightPolicy: a custom pure policy can be minted + verified', () => {
  const policies = new Map();
  policies.set('custom', (subject) => ({ value: subject.length, basis: { subject } }));
  const w = mintWeight({ kind: 'custom', subject: 'z'.repeat(64) }, { ...SIGN, policies });
  assert.ok(w, 'custom policy mints');
  assert.strictEqual(w.value, 64);
  assert.strictEqual(verifyMintedWeight(w, VERIFY), true);
});

test('registerWeightPolicy rejects a non-string kind or non-function policy', () => {
  assert.throws(() => registerWeightPolicy('', () => ({})));
  assert.throws(() => registerWeightPolicy('k', 'not-a-fn'));
});

// ── 9. VALIDATE-board folds (CR-1/CR-2/CR-3/CR-4 + hacker-H1) ─────────────────────────────────────

test('a policy returning basis:null -> mintWeight null (no authoritative input -> no mint) [CR-1]', () => {
  const policies = new Map();
  policies.set('null-basis', () => ({ value: 1, basis: null }));
  assert.strictEqual(mintWeight({ kind: 'null-basis', subject: 'a'.repeat(64) }, { ...SIGN, policies }), null);
});

test('value === 0 round-trips through mint + verify (a falsy value is not dropped) [CR-2]', () => {
  const policies = new Map();
  policies.set('zero', () => ({ value: 0, basis: { sentinel: true } }));
  const w = mintWeight({ kind: 'zero', subject: 'a'.repeat(64) }, { ...SIGN, policies });
  assert.ok(w, 'value 0 must mint');
  assert.strictEqual(w.value, 0);
  assert.strictEqual(verifyMintedWeight(w, VERIFY), true);
});

test('opts.now whitespace-only -> falls back to a real ISO timestamp (not the blank) [CR-3]', () => {
  const policies = new Map();
  policies.set('c', () => ({ value: 1, basis: { x: 1 } }));
  const w = mintWeight({ kind: 'c', subject: 'a'.repeat(64) }, { ...SIGN, policies, now: '   ' });
  assert.ok(w);
  assert.notStrictEqual(w.minted_at.trim(), '', 'minted_at must not be whitespace-only');
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(w.minted_at), 'minted_at falls back to an ISO timestamp');
  assert.strictEqual(verifyMintedWeight(w, VERIFY), true);
});

test('makeKernelRecordPolicy uses the INJECTED reader (DIP seam — Option-C enforcement) [CR-4]', () => {
  let seen = null;
  const stub = (subject) => {
    seen = subject;
    return subject === 'd'.repeat(64) ? { transaction_id: subject, post_state_hash: 'e'.repeat(64) } : null;
  };
  const policies = new Map();
  policies.set(KERNEL_RECORD_KIND, makeKernelRecordPolicy({ readById: stub }));
  const w = mintWeight({ kind: KERNEL_RECORD_KIND, subject: 'd'.repeat(64) }, { ...SIGN, policies });
  assert.ok(w && seen === 'd'.repeat(64), 'the injected reader was called with the subject');
  assert.strictEqual(verifyMintedWeight(w, VERIFY), true);
  assert.strictEqual(
    mintWeight({ kind: KERNEL_RECORD_KIND, subject: 'f'.repeat(64) }, { ...SIGN, policies }), null,
    'absent via the injected reader -> null',
  );
});

test('registerWeightPolicy is APPEND-ONLY: re-registering an existing kind throws [hacker-H1]', () => {
  // The built-in kernel policy (registered at module load) must not be silently overwritable —
  // that would subvert recompute-from-authoritative once P2 wires the minter into a key-holding process.
  assert.throws(
    () => registerWeightPolicy(KERNEL_RECORD_KIND, () => ({ value: 1, basis: { forged: true } })),
    /already registered/,
  );
});

// ── 8. F4 — SHADOW is mechanically checkable: no non-test file imports weight-minter ──────────────

test('SHADOW: no file under packages/ require()s weight-minter.js (no gating consumer in P0)', () => {
  let out = '';
  try {
    out = execSync(
      "grep -rEn \"require\\([^)]*weight-minter\" packages/ 2>/dev/null || true",
      { cwd: REPO, encoding: 'utf8' },
    );
  } catch { out = ''; }
  const offenders = out.split('\n').map((s) => s.trim()).filter(Boolean);
  assert.deepStrictEqual(offenders, [], `weight-minter must have NO production caller in P0; found:\n${out}`);
});

// ── 10. M-1 — opt-in freshness window (default-off keeps SHADOW) ─────────────────────────────────

const FRESH_POLICIES = new Map([['fresh', () => ({ value: 1, basis: { x: 1 } })]]);
const T0 = '2026-06-19T12:00:00.000Z';
const T0_MS = Date.parse(T0);
function mintAt(nowIso) {
  return mintWeight({ kind: 'fresh', subject: 'a'.repeat(64) }, { ...SIGN, policies: FRESH_POLICIES, now: nowIso });
}
// Forge a weight with a VALID signature over an arbitrary body (the defense-in-depth path: a
// key-holder — or a future key-compromise — signing a non-canonical minted_at). computeMintedId is
// the SAME derivation verifyMintedWeight uses, so the sig verifies — isolating the freshness guards
// from the sig gate (M1-T1: the bad-sig 'AAAA' weight never reached them).
function signWeight(body) {
  return { ...body, sig: signRecordId(minter.computeMintedId(body), SIGN) };
}

test('default (no maxAgeMs): a freshly-minted weight still verifies — no behavior change [M-1]', () => {
  assert.strictEqual(verifyMintedWeight(mintAt(T0), VERIFY), true);
});

test('maxAgeMs: fresh/within-window -> true; stale -> false; implausibly-future -> false [M-1]', () => {
  const w = mintAt(T0);
  const maxAgeMs = 60000; // 60s
  assert.strictEqual(verifyMintedWeight(w, { ...VERIFY, maxAgeMs, nowMs: T0_MS }), true, 'exactly fresh');
  assert.strictEqual(verifyMintedWeight(w, { ...VERIFY, maxAgeMs, nowMs: T0_MS + 30000 }), true, 'within window');
  assert.strictEqual(verifyMintedWeight(w, { ...VERIFY, maxAgeMs, nowMs: T0_MS + 120000 }), false, 'stale (2x window old)');
  assert.strictEqual(verifyMintedWeight(w, { ...VERIFY, maxAgeMs, nowMs: T0_MS - 120000 }), false, 'implausibly future');
  assert.strictEqual(verifyMintedWeight(w, { ...VERIFY, maxAgeMs, nowMs: T0_MS + maxAgeMs }), true, 'exactly at maxAgeMs is inclusive [M1-N1]');
  assert.strictEqual(verifyMintedWeight(w, { ...VERIFY, maxAgeMs, nowMs: T0_MS + maxAgeMs + 1 }), false, 'one ms past the boundary [M1-N1]');
});

test('garbage maxAgeMs does NOT silently disable the check -> false [M-1 / no silent downgrade]', () => {
  const w = mintAt(T0);
  for (const bad of [0, -1, NaN, '60000', null]) {
    assert.strictEqual(
      verifyMintedWeight(w, { ...VERIFY, maxAgeMs: bad, nowMs: T0_MS }), false,
      `maxAgeMs=${String(bad)} must fail-closed, not disable freshness`,
    );
  }
});

test('VALID-sig weight over an unparseable / tz-ambiguous minted_at -> freshness fail-closed [M-1 / M1-T1 / H1]', () => {
  const base = { kind: 'fresh', subject: 'a'.repeat(64), value: 1, basis_digest: 'd'.repeat(64), key_id: KEY_ID_V0 };
  // garbage minted_at + a GENUINE sig -> reaches the canonical/Date.parse guard, NOT the sig gate (M1-T1)
  const badDate = signWeight({ ...base, minted_at: 'not-a-date' });
  assert.strictEqual(verifyMintedWeight(badDate, VERIFY), true, 'no maxAgeMs -> no freshness check -> sig valid -> true');
  assert.strictEqual(verifyMintedWeight(badDate, { ...VERIFY, maxAgeMs: 60000, nowMs: T0_MS }), false, 'unparseable minted_at -> fail-closed');
  // tz-AMBIGUOUS (parseable but no offset) minted_at + a GENUINE sig -> rejected by the canonical guard (H1)
  const tzless = signWeight({ ...base, minted_at: '2026-06-19T12:00:00' });
  assert.strictEqual(verifyMintedWeight(tzless, VERIFY), true, 'no maxAgeMs -> still true');
  assert.strictEqual(
    verifyMintedWeight(tzless, { ...VERIFY, maxAgeMs: 60000, nowMs: Date.parse('2026-06-19T12:00:00.000Z') }), false,
    'non-canonical (tz-ambiguous) minted_at -> fail-closed regardless of host TZ [H1]',
  );
  // non-finite nowMs -> false
  const w = mintAt(T0);
  assert.strictEqual(verifyMintedWeight(w, { ...VERIFY, maxAgeMs: 60000, nowMs: NaN }), false);
  assert.strictEqual(verifyMintedWeight(w, { ...VERIFY, maxAgeMs: 60000, nowMs: 'soon' }), false);
});

test('mint never SIGNS a timezone-ambiguous opts.now -> falls back to canonical UTC [H1]', () => {
  const w = mintWeight({ kind: 'fresh', subject: 'a'.repeat(64) }, { ...SIGN, policies: FRESH_POLICIES, now: '2026-06-19T12:00:00' });
  assert.ok(w, 'still mints');
  assert.notStrictEqual(w.minted_at, '2026-06-19T12:00:00', 'a tz-less now must NOT be signed verbatim');
  assert.ok(/Z$/.test(w.minted_at), 'minted_at falls back to a canonical UTC (Z) timestamp');
  assert.strictEqual(verifyMintedWeight(w, VERIFY), true);
});

test('freshness never rescues a bad sig (stale window irrelevant if sig invalid) [M-1]', () => {
  const forged = { ...mintAt(T0), value: 999 }; // breaks the sig
  assert.strictEqual(verifyMintedWeight(forged, { ...VERIFY, maxAgeMs: 60000, nowMs: T0_MS }), false);
});

process.stdout.write(`\nweight-minter: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
