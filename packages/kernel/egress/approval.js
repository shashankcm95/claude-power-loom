'use strict';

// @loom-layer: kernel
//
// ③.2.4 — the PER-EMISSION approval AXIOM (PURE; no I/O). The human-gate model the USER chose: each candidate
// emission is content-addressed; once armed (③.2.5) emitPR fires the live seam ONLY when a human approval keyed
// to that EXACT content-hash exists. This module is the PURE core — the canonical hash + the verify predicate —
// mirroring the manage-promote USER_INTENT_AXIOM precedent (manage-op-record.js): a pure builder over
// `sha256(canonicalJsonSerialize(<approved>))`, with NO filesystem I/O. The fail-closed read/write/consume I/O
// lives in approval-store.js (the SoC split the VERIFY board required, F2).
//
// WHAT THE HASH BINDS (VERIFY board F4 + H5): the MINIMAL independent, emission-determining set —
// { repo: <.git-stripped, lowercased owner/name>, issueRef: Number, diff: <the scrubbed diff> }. `title` +
// `touched_paths` are DERIVED (a kernel template + parseDiffPaths) — hashing them adds no entropy and would
// couple the approval to a format string ③.2.5 will change, silently invalidating standing approvals. The repo
// is NORMALIZED ONCE (the SAME canonical the draft target + the ③.2.5 emit target read) so the approved identity
// and the emit target can never diverge (H5).
//
// FORWARD-CONTRACT (the binding is SOUND only if ③.2.5 honors it): the hash is over the SCRUBBED diff, which is
// EXACTLY what is emitted (draft.diff). ③.2.5 MUST emit that approved scrubbed draft verbatim (no re-scrub, no
// raw diff, no divergent blobs) and RE-DERIVE computeEmissionHash over the actual emission payload, refusing on
// mismatch. TRUST: this is INTEGRITY (self-consistent + draft-bound), NOT provenance — computeEmissionHash is
// exported, so any same-uid host process can co-forge a byte-valid approval. An AUTHENTICATED minter (a signed
// approval / a kernel-owned writer) is a HARD ③.2.5 ARMING precondition (#273 / security.md: a trust input that
// gates an action needs an authenticated minter, never a store re-hash).

const crypto = require('crypto');
const { canonicalJsonSerialize } = require('../_lib/canonical-json');
const { verifyRecordSig } = require('../_lib/edge-attestation');   // ③.2.5a — the broker-signature verify (provenance)

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;     // 24h — an approval that outlives the day's intent is stale.

// OQ-3 — the lesson_commitment contract: '' (no lesson) or a LOWERCASE 64-hex digest. verifyApproval enforces this
// SHAPE (not just typeof string) on BOTH the request and the body so a direct verifier caller cannot match on an
// arbitrary string and slip past the store / emit-gate / broker-bind shape gates (CodeRabbit Major — the verify
// chokepoint must fail-closed on a malformed commitment, the same contract the other four gates enforce, fold F4).
const LESSON_COMMITMENT_RE = /^[a-f0-9]{64}$/;
function isSafeLessonCommitment(v) { return v === '' || (typeof v === 'string' && LESSON_COMMITMENT_RE.test(v)); }

// F-W2b — the requestedBaseSha contract (the approver-INTENDED base commit, bound into the SIGNED basis for
// moved-base invalidation at the emit gate): '' (no base constraint — the DORMANT default) or a LOWERCASE 40-hex
// (SHA-1, GitHub today) or 64-hex (SHA-256 forward-compat) git commit sha. Defined ONCE here (mirror
// LESSON_COMMITMENT_RE/isSafeLessonCommitment) + imported at EVERY site (basis, verify, mint, broker-bind, CLI, and
// the gh-emit live-base check) so there is ONE hiding-point for "what is a valid base sha" — six independently-
// driftable regexes otherwise (fold D5).
const BASE_SHA_RE = /^([0-9a-f]{40}|[0-9a-f]{64})$/;
function isSafeBaseSha(v) { return v === '' || (typeof v === 'string' && BASE_SHA_RE.test(v)); }

/** Canonical (repo, issue) normalization — the SAME form the etiquette ledger uses (no bypass-by-casing/.git). */
function normalizeRepo(repo) {
  const [owner = '', name = ''] = String(repo == null ? '' : repo).split('/');
  return `${owner.toLowerCase()}/${name.replace(/\.git$/i, '').toLowerCase()}`;
}

/**
 * The MINIMAL emission-determining binding set. PURE. Reads `diff` from the draft (already the scrubbed diff,
 * built by emitPR) so the hashed bytes == the emitted bytes (Forward-Contract). issueRef -> a Number (the `#N`
 * and bare-N forms collapse). repo -> the canonical normalized form (H5).
 * @param {{repo: string, issueRef: number|string, diff: string}} draft
 * @returns {{repo: string, issueRef: number, diff: string}}
 */
function emissionAxiom(draft) {
  const d = draft || {};
  return {
    repo: normalizeRepo(d.repo),
    issueRef: Number(String(d.issueRef == null ? '' : d.issueRef).replace(/^#/, '')),
    diff: typeof d.diff === 'string' ? d.diff : '',
  };
}

/**
 * The content-address the human approval is keyed to. sha256 over the canonical (sorted-key, bounded) axiom —
 * key-insertion-order-independent, byte-stable. REUSE canonical-json (the INV-22 encoding rule).
 * @param {object} draft
 * @returns {string} 64-hex
 */
function computeEmissionHash(draft) {
  return crypto.createHash('sha256').update(canonicalJsonSerialize(emissionAxiom(draft)), 'utf8').digest('hex');
}

/**
 * The FRESHNESS-BOUND signing basis (VALIDATE-hacker H1). The broker signs THIS, not the bare emission hash — so
 * a non-key-holder cannot replay a signed approval past its TTL by editing `approvedAt`, nor swap the one-shot
 * `nonce`, without invalidating the sig (only the key-holder can mint a fresh-`approvedAt` approval). The emission
 * `hash` binds WHAT is emitted; the basis binds WHAT + WHEN (`approvedAt`) + the one-shot `nonce` + `key_id`.
 * key_id is bound (authenticated) here but is NOT used to SELECT the verify key — the custody pin selects (F2/H5).
 *
 * OQ-3 — the 5th field `lesson_commitment` (RFC §5.3) binds WHICH captured lesson rode this approval (a 64-hex
 * computeLessonCommitment digest, or '' for a no-lesson emission). ALWAYS-A-STRING (RFC §5.1, the canonical-hash
 * footgun): post-#550 canonicalJsonSerialize matches native JSON.stringify — an undefined-valued key is DROPPED,
 * so undefined and key-absent COLLAPSE to the same basis while '' stays distinct; leaning on that would let a
 * missing lesson silently sign as the no-lesson basis. So an undefined / absent value is COERCED to '' here (an
 * EXPLICIT no-lesson sentinel), and a non-string value THROWS (never silently hashed). The lesson is NOT emitted
 * in the PR (computeEmissionHash is untouched, §4); only this basis grows.
 *
 * F-W2b — the 6th field `requestedBaseSha` (the approver-INTENDED base commit) binds moved-base invalidation into
 * the SIGNED basis (a basis-only field, NEVER in the emission hash — the live base does not EXIST at approval time,
 * so it CANNOT enter emissionAxiom; the temporal-impossibility invariant). Same ALWAYS-A-STRING discipline as
 * lesson_commitment: undefined/absent -> '' (the dormant no-base default), a non-string THROWS. The gate at ghEmit
 * REFUSES when the live upstream base != this bound value; '' skips (dormant). computeEmissionHash is UNTOUCHED.
 * @param {{ hash: string, approvedAt: number, nonce: string, key_id?: string, lesson_commitment?: string, requestedBaseSha?: string }} o
 * @returns {string} 64-hex
 */
function approvalSigBasis({ hash, approvedAt, nonce, key_id, lesson_commitment, requestedBaseSha }) {
  const lc = lesson_commitment === undefined ? '' : lesson_commitment;
  if (typeof lc !== 'string') throw new Error('approvalSigBasis: lesson_commitment must be a string (64-hex or empty)');
  const rbs = requestedBaseSha === undefined ? '' : requestedBaseSha;
  if (typeof rbs !== 'string') throw new Error('approvalSigBasis: requestedBaseSha must be a string (40/64-hex or empty)');
  return crypto.createHash('sha256').update(canonicalJsonSerialize({ hash, approvedAt, nonce, key_id, lesson_commitment: lc, requestedBaseSha: rbs }), 'utf8').digest('hex');
}

/**
 * PURE verify predicate over already-read approval-file bytes. Fail-CLOSED: returns { ok:false, reason } on ANY
 * defect. The store (approval-store.js) does the fail-closed I/O (dir/symlink/uid/fd) and hands the bytes here.
 *
 * Closes #273 (verify the BODY, not the key): re-derives computeEmissionHash over the file's OWN `emission` and
 * requires it === the file's claimed `hash` === the `requestedHash` (the live draft's hash). Plus a TTL (H4) +
 * a non-empty nonce (the one-shot binding the store consumes on emit).
 *
 * ③.2.5a PROVENANCE: the approval must also carry a broker SIGNATURE over the exact `hash`, verified against the
 * CUSTODY-pinned `verifyKeyPem` with NO env fallback (allowEnvFallback:false — VERIFY-hacker H1). The pin SELECTS
 * the key; a body `key_id` is ADVISORY and NEVER selects it (F2/H5). Absent pin / missing / invalid / wrong-key
 * sig => fail-closed. (INTEGRITY-only until the cross-uid broker holds the key — PR-2 — but the verify-half is here.)
 *
 * OQ-3 (RFC §5.3) — the lesson binding: `requestedLessonCommitment` (the emit-time data value, 64-hex or '') must
 * EQUAL `body.lesson_commitment` (mirroring the body.hash === requestedHash gate), and the commitment is folded
 * into the re-derived sig basis so an in-place body edit flips the sig (sig-invalid). The check fires immediately
 * after the hash-match gate, BEFORE the body-hash re-derive + the sig verify (fold F1). The REQUEST is coerced
 * (undefined -> '', non-string -> fail-closed); the BODY is NOT coerced (a legacy/absent field is a DISTINCT
 * fail-closed reason, never silently treated as ''). On success the VERIFIED body is returned (the §5.4
 * provenance-bundle source for emit-pr / W3).
 *
 * @param {{ fileBytes: string|Buffer, requestedHash: string, now: number, ttlMs?: number, verifyKeyPem: string, requestedLessonCommitment?: string }} o
 * @returns {{ ok: boolean, reason?: string, body?: object }}
 */
function verifyApproval({ fileBytes, requestedHash, now, ttlMs = DEFAULT_TTL_MS, verifyKeyPem, requestedLessonCommitment } = {}) {
  if (typeof requestedHash !== 'string' || requestedHash.length === 0) return { ok: false, reason: 'no-requested-hash' };
  if (typeof now !== 'number' || !Number.isFinite(now)) return { ok: false, reason: 'no-clock' };
  // OQ-3 — coerce ONLY the request (undefined -> ''); a non-string request fail-closes BEFORE any body read.
  const reqLC = requestedLessonCommitment === undefined ? '' : requestedLessonCommitment;
  if (!isSafeLessonCommitment(reqLC)) return { ok: false, reason: 'no-requested-lesson-commitment' };
  // the trust anchor is a custody-pinned key; absent => fail-closed BEFORE any verify (the env fallback in
  // loadPublicKey can NEVER be reached for this gate — H1). Provenance roots in custody, never ambient.
  if (typeof verifyKeyPem !== 'string' || verifyKeyPem.length === 0) return { ok: false, reason: 'no-verify-key' };
  let body;
  try { body = JSON.parse(String(fileBytes)); } catch { return { ok: false, reason: 'unparseable' }; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, reason: 'not-an-object' };
  if (typeof body.hash !== 'string' || body.hash !== requestedHash) return { ok: false, reason: 'hash-mismatch' };
  // OQ-3 — the lesson binding (fold F1: immediately after the hash gate, before the body-hash re-derive + sig).
  // The BODY is NOT coerced: a legacy/absent field is its own DISTINCT fail-closed reason (a missing commitment is
  // never silently '' — that would launder a pre-OQ-3 approval into a no-lesson match).
  if (!isSafeLessonCommitment(body.lesson_commitment)) return { ok: false, reason: 'no-body-lesson-commitment' };
  if (body.lesson_commitment !== reqLC) return { ok: false, reason: 'lesson-commitment-mismatch' };
  // F-W2b — the requestedBaseSha binding (fold D1/D6: immediately AFTER the lesson gate, BEFORE nonce/approvedAt/TTL/
  // body-hash/sig). PARTIAL mirror: there is NO emit-time request analog to cross-check against (the "expected" base
  // is the LIVE upstream base, resolved in ghEmit, not an actor claim) — so verifyApproval ONLY shape-gates the BODY
  // (distinct fail-closed `no-body-requested-base-sha` if absent/non-string/malformed — the body is NEVER coerced,
  // never launder a pre-F-W2b approval into a no-base match) and folds it into the basis re-derive below.
  if (!isSafeBaseSha(body.requestedBaseSha)) return { ok: false, reason: 'no-body-requested-base-sha' };
  if (typeof body.nonce !== 'string' || body.nonce.trim().length === 0) return { ok: false, reason: 'no-nonce' };
  if (typeof body.approvedAt !== 'number' || !Number.isFinite(body.approvedAt)) return { ok: false, reason: 'no-approvedAt' };
  if (now - body.approvedAt > ttlMs || now < body.approvedAt) return { ok: false, reason: 'stale-or-future' };
  // #273 verify-the-BODY: the claimed hash must re-derive from the file's OWN emission, not just match the name.
  let rederived;
  try { rederived = computeEmissionHash(body.emission); } catch { return { ok: false, reason: 'emission-unhashable' }; }
  if (rederived !== body.hash) return { ok: false, reason: 'body-hash-mismatch' };
  // ③.2.5a — the broker SIGNATURE over the FRESHNESS-BOUND basis (hash + approvedAt + nonce + key_id + OQ-3
  // lesson_commitment), against the CUSTODY pin (no env fallback). Binding the basis (not the bare hash) defeats
  // the TTL-bump / nonce-swap / lesson-swap replay (VALIDATE-hacker H1): editing approvedAt/nonce/key_id/
  // lesson_commitment flips the basis -> sig-invalid, so only the key-holder can issue a fresh approval binding a
  // given lesson. Missing/invalid/wrong-key => fail-closed. The pin selects the key; key_id never does.
  if (typeof body.sig !== 'string' || body.sig.length === 0) return { ok: false, reason: 'sig-missing' };
  const basis = approvalSigBasis({ hash: body.hash, approvedAt: body.approvedAt, nonce: body.nonce, key_id: body.key_id, lesson_commitment: body.lesson_commitment, requestedBaseSha: body.requestedBaseSha });
  if (!verifyRecordSig(basis, body.sig, { publicKeyPem: verifyKeyPem, allowEnvFallback: false })) {
    return { ok: false, reason: 'sig-invalid' };
  }
  return { ok: true, body };
}

module.exports = { emissionAxiom, computeEmissionHash, approvalSigBasis, verifyApproval, normalizeRepo, isSafeBaseSha, BASE_SHA_RE, DEFAULT_TTL_MS };
