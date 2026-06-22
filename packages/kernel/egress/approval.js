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
 * @param {{ hash: string, approvedAt: number, nonce: string, key_id?: string }} o
 * @returns {string} 64-hex
 */
function approvalSigBasis({ hash, approvedAt, nonce, key_id }) {
  return crypto.createHash('sha256').update(canonicalJsonSerialize({ hash, approvedAt, nonce, key_id }), 'utf8').digest('hex');
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
 * @param {{ fileBytes: string|Buffer, requestedHash: string, now: number, ttlMs?: number, verifyKeyPem: string }} o
 * @returns {{ ok: boolean, reason?: string }}
 */
function verifyApproval({ fileBytes, requestedHash, now, ttlMs = DEFAULT_TTL_MS, verifyKeyPem } = {}) {
  if (typeof requestedHash !== 'string' || requestedHash.length === 0) return { ok: false, reason: 'no-requested-hash' };
  if (typeof now !== 'number' || !Number.isFinite(now)) return { ok: false, reason: 'no-clock' };
  // the trust anchor is a custody-pinned key; absent => fail-closed BEFORE any verify (the env fallback in
  // loadPublicKey can NEVER be reached for this gate — H1). Provenance roots in custody, never ambient.
  if (typeof verifyKeyPem !== 'string' || verifyKeyPem.length === 0) return { ok: false, reason: 'no-verify-key' };
  let body;
  try { body = JSON.parse(String(fileBytes)); } catch { return { ok: false, reason: 'unparseable' }; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, reason: 'not-an-object' };
  if (typeof body.hash !== 'string' || body.hash !== requestedHash) return { ok: false, reason: 'hash-mismatch' };
  if (typeof body.nonce !== 'string' || body.nonce.trim().length === 0) return { ok: false, reason: 'no-nonce' };
  if (typeof body.approvedAt !== 'number' || !Number.isFinite(body.approvedAt)) return { ok: false, reason: 'no-approvedAt' };
  if (now - body.approvedAt > ttlMs || now < body.approvedAt) return { ok: false, reason: 'stale-or-future' };
  // #273 verify-the-BODY: the claimed hash must re-derive from the file's OWN emission, not just match the name.
  let rederived;
  try { rederived = computeEmissionHash(body.emission); } catch { return { ok: false, reason: 'emission-unhashable' }; }
  if (rederived !== body.hash) return { ok: false, reason: 'body-hash-mismatch' };
  // ③.2.5a — the broker SIGNATURE over the FRESHNESS-BOUND basis (hash + approvedAt + nonce + key_id), against the
  // CUSTODY pin (no env fallback). Binding the basis (not the bare hash) defeats the TTL-bump / nonce-swap replay
  // (VALIDATE-hacker H1): editing approvedAt/nonce/key_id flips the basis -> sig-invalid, so only the key-holder
  // can issue a fresh-TTL approval. Missing/invalid/wrong-key => fail-closed. The pin selects the key; key_id never does.
  if (typeof body.sig !== 'string' || body.sig.length === 0) return { ok: false, reason: 'sig-missing' };
  const basis = approvalSigBasis({ hash: body.hash, approvedAt: body.approvedAt, nonce: body.nonce, key_id: body.key_id });
  if (!verifyRecordSig(basis, body.sig, { publicKeyPem: verifyKeyPem, allowEnvFallback: false })) {
    return { ok: false, reason: 'sig-invalid' };
  }
  return { ok: true };
}

module.exports = { emissionAxiom, computeEmissionHash, approvalSigBasis, verifyApproval, normalizeRepo, DEFAULT_TTL_MS };
