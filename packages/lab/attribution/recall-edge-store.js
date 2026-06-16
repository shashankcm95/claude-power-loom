#!/usr/bin/env node

// @loom-layer: lab
//
// v3.11 W2 — the recall-graph's FIRST edge: a content-addressed `confirmed-by` ledger.
// `(failure-context, lesson) --confirmed-by--> (delta-ref)`: a provisional lesson node
// (from_node_id) was confirmed by a DIFFERENT verified passing run on the SAME requirement
// (to_delta_ref = the confirming candidate's full sha). The presence of an edge is what
// moves a lesson from the HAZARD lane to the PREDICTOR lane (the lane predicate lives in
// lesson-confirm.js; this is just the persisted edge).
//
// MIRRORS authorship-store.js (the v3.10 (node_id, built_by) edge ledger): content-address,
// verify-on-WRITE-and-READ, dedup first-wins, `recorded_at` TOP-LEVEL outside the basis,
// opts.dir, deep-freeze on read, retire. The DELIBERATE-DUPLICATION DRY decision (authorship
// -store header): each lab store's verify predicate is security-load-bearing and DIFFERS (here:
// STRICT from/to HEX64 + a closed EDGE_TYPE + a non-empty fail_to_pass) — a shared factory would
// obscure each lane's distinct firewall, so independent auditability wins over DRY.
//
// THE STORE STAYS LESSON-AGNOSTIC (VERIFY-arch MED-3): it validates ONLY the edge's own shape
// (structural) — it NEVER imports classifyLessonLayer / persona. The lesson classification is
// the GATE's job (lesson-confirm.js).
//
// v-next C-W1 keeps the store an INTEGRITY store (the original ethos): it proves a self-consistent
// edge AND, for a SIGNED edge, that the signature is WELL-FORMED (sig_alg ed25519 + canonical base64).
// It does NOT crypto-verify — PROVENANCE (only a private-key holder could mint it) is proven solely by
// the authenticated lane (authenticatedEdgeIds, lesson-confirm.js, fail-closed). This split is
// deliberate (VALIDATE hacker MED): the key-free store never drops an integrity-valid edge on a key
// rotation/mismatch, and confirmedNodeIds is identical regardless of any verify-key config. W1 makes
// edges admitted to the AUTHENTICATED LANE unforgeable by a writer lacking the private key; the
// UNSIGNED path (and a shape-valid-but-lying sig, equally powerless) still inflates the integrity-only
// confirmedNodeIds count — the #273 co-forge survives there until W2 wires the authenticated lane into
// the live weight. This NARROWS, it does not HARDEN (OQ-NS-6): the weight gates nothing, and the
// in-process key-possession boundary is itself a forward deployment property (no production minter
// exists yet). The gate (runConfirmationPass) is the only legitimate signer.
//
// ONE-WAY DOORS (additive-only, mirror W1's LESSON_HASH_FIELDS): EDGE_TYPE is a FROZEN
// APPEND-ONLY set (it is in the edge_id basis — rename/remove orphans every edge keyed on it);
// the edge BASIS field-set is additive-only/versioned (a new basis field requires a basis
// version, never an in-place add).

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { writeAtomicString } = require('../../kernel/_lib/atomic-write');
const { deepFreeze } = require('../../kernel/_lib/deep-freeze');
const { canonicalJsonSerialize } = require('../../kernel/_lib/canonical-json');
// v-next Carry C W1: the ed25519 attestation primitive (kernel-layer, pure crypto). lab->kernel is
// the legal direction. The store SHAPE-checks a present signature (alg + canonical base64) but does
// NOT crypto-verify it — crypto PROVENANCE is the authenticated lane's sole job (authenticatedEdgeIds
// in lesson-confirm.js). So the store stays KEY-FREE: an integrity-valid edge is never dropped on a
// key mismatch (no data-loss/un-prunability — VALIDATE hacker MED), and "zero downstream change" is
// absolute. The store stays crypto-agnostic on WRITE too (persists the injected signer's opaque output).
const { isCanonicalBase64, SIG_ALG } = require('../../kernel/_lib/edge-attestation');

const LAB_STATE_BASE = process.env.LOOM_LAB_STATE_DIR || path.join(os.homedir(), '.claude', 'lab-state');
const DEFAULT_DIR = path.join(LAB_STATE_BASE, 'recall-edge');
const HEX64 = /^[0-9a-f]{64}$/;

// APPEND-ONLY frozen set (one-way door). W3 may add e.g. 'contradicted-by'; never rename/remove.
const EDGE_TYPE = Object.freeze(['confirmed-by']);

function storeDir(opts) { return (opts && opts.dir) || DEFAULT_DIR; }
function sha256hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

// STRICT — typeof===string BEFORE the regex (NOT String()-coercing), so a `[hex]`/number can not
// self-consistently address an edge (the authorship-store.js:54 discipline, the #273 class).
function isHex64(v) { return typeof v === 'string' && HEX64.test(v); }
// A non-empty array of non-empty strings (the requirement is load-bearing; empty proves nothing).
function isValidFtp(v) {
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x.length > 0);
}
// Canonical requirement form for the basis — String-map + sort (M1: order/type-stable so
// ["t_b","t_a"] and ["t_a","t_b"] address the SAME edge).
function normFtp(v) { return Array.isArray(v) ? v.map(String).slice().sort() : []; }

// edge_id over the IDENTITY basis (from + to + type + the matched requirement). recorded_at is
// NOT in the basis (a different-time re-record dedups to the same file). A flipped requirement /
// endpoint / type perturbs the id (tamper-evident — no separate content_hash needed: the edge has
// no free-prose field, unlike the W1 node's lesson_body).
function deriveEdgeId(rec) {
  const r = rec || {};
  return sha256hex(canonicalJsonSerialize([
    r.from_node_id == null ? '' : String(r.from_node_id),
    r.to_delta_ref == null ? '' : String(r.to_delta_ref),
    r.edge_type == null ? '' : String(r.edge_type),
    normFtp(r.fail_to_pass),
  ]));
}

// Re-derive the address + re-apply the SAME strict shape guards on read (read/write parity). A file
// that lies (coerced endpoint, bad type, empty/absent ftp, bad ts, forged id) is not one we wrote.
// v-next C-W1: + a signature SHAPE layer (NOT crypto-verification). An edge with NO sig is accepted
// (legacy/unsigned, shadow). An edge that CLAIMS a sig must be well-formed: sig_alg PINNED to ed25519
// (a reject-filter, never an alg selector) + canonical base64 (a malleability defense). It is NOT
// crypto-verified HERE — the store proves INTEGRITY + sig-well-formedness; crypto PROVENANCE is the
// authenticated lane's sole job (authenticatedEdgeIds in lesson-confirm.js, fail-closed). Rationale
// (VALIDATE hacker MED): keeping crypto OUT of the store means an integrity-valid edge is NEVER
// dropped on a key mismatch/rotation (no data-loss, stays prunable), and the store is key-free so
// confirmedNodeIds is identical regardless of any verify-key config ("zero downstream change" is
// absolute). A shape-valid but cryptographically-lying sig is thus accepted as an UNAUTHENTICATED
// edge — exactly as powerless as an unsigned forged edge (the known shadow residual): counted by
// confirmedNodeIds, NEVER admitted to the authenticated lane.
function verifyEdge(rec, expectedId) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
  if (!isHex64(rec.from_node_id)) return null;
  if (!isHex64(rec.to_delta_ref)) return null;
  if (!EDGE_TYPE.includes(rec.edge_type)) return null;
  if (!isValidFtp(rec.fail_to_pass)) return null;
  if (typeof rec.recorded_at !== 'string' || rec.recorded_at.length === 0) return null;
  if (!Number.isFinite(Date.parse(rec.recorded_at))) return null;
  if (!isHex64(rec.edge_id)) return null;
  if (expectedId != null && rec.edge_id !== expectedId) return null;     // filename == field
  if (deriveEdgeId(rec) !== rec.edge_id) return null;                    // body hashes to id
  const hasSig = rec.edge_sig != null || rec.sig_alg != null;
  if (hasSig) {
    if (rec.sig_alg !== SIG_ALG) return null;                           // alg PIN (reject-filter only)
    if (!isCanonicalBase64(rec.edge_sig)) return null;                  // no malleated/non-canonical sig
  }
  return rec;
}

// Normalize to the stored shape: a frozen, sorted, String-mapped fail_to_pass + the derived id.
// v-next C-W1: carry edge_sig/sig_alg through IF present (additive, OUTSIDE the edge_id basis — like
// recorded_at; a signed edge shares the SAME edge_id as its unsigned twin -> no orphaning). When
// absent, the stored JSON is byte-identical to the pre-W1 shape (no edge_sig key) -> shadow-clean.
function normalize(rec) {
  const out = {
    edge_id: deriveEdgeId(rec),
    from_node_id: rec.from_node_id,
    to_delta_ref: rec.to_delta_ref,
    edge_type: rec.edge_type,
    fail_to_pass: normFtp(rec.fail_to_pass),
    recorded_at: rec.recorded_at,
  };
  if (rec.edge_sig != null || rec.sig_alg != null) {
    out.sig_alg = rec.sig_alg;
    out.edge_sig = rec.edge_sig;
  }
  return out;
}

// --------------------------------------------------------------------------
// writeEdge — REJECT a malformed edge; verify-on-write; dedup first-wins; atomic-write.
// --------------------------------------------------------------------------
function writeEdge(rec, opts = {}) {
  if (!rec || typeof rec !== 'object') return { ok: false, reason: 'bad-edge' };
  if (!isHex64(rec.from_node_id)) return { ok: false, reason: 'bad-from-node-id' };
  if (!isHex64(rec.to_delta_ref)) return { ok: false, reason: 'bad-to-delta-ref' };
  if (!EDGE_TYPE.includes(rec.edge_type)) return { ok: false, reason: 'bad-edge-type' };
  if (!isValidFtp(rec.fail_to_pass)) return { ok: false, reason: 'bad-fail-to-pass' };
  if (typeof rec.recorded_at !== 'string' || rec.recorded_at.length === 0) return { ok: false, reason: 'bad-recorded-at' };
  if (!Number.isFinite(Date.parse(rec.recorded_at))) return { ok: false, reason: 'bad-recorded-at-format' };
  let stored = normalize(rec);
  // v-next C-W1: if a signer is injected and the edge is not already signed, sign the DERIVED
  // edge_id (the minter holds the private key; the store stays crypto-agnostic on WRITE — it just
  // persists the signer's opaque output). A signer that throws / returns non-string -> unsigned.
  if (typeof opts.signer === 'function' && stored.edge_sig == null) {
    let sig = null;
    try { sig = opts.signer(stored.edge_id); } catch { sig = null; }
    if (typeof sig === 'string' && sig.length > 0) stored = { ...stored, sig_alg: SIG_ALG, edge_sig: sig };
  }
  // verifyEdge is shape-only (no crypto) -> a freshly-signed edge self-checks without needing the
  // verify key on the write path (crypto adjudication is the authenticated lane's job on read).
  if (!verifyEdge(stored, stored.edge_id)) return { ok: false, reason: 'self-inconsistent' };
  const dir = storeDir(opts);
  const file = path.join(dir, `${stored.edge_id}.json`);
  if (fs.existsSync(file)) {
    if (loadEdge(stored.edge_id, opts) != null) return { ok: true, deduped: true, edge_id: stored.edge_id };
    // unverifiable garbage at the path -> repair by overwriting
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    writeAtomicString(file, `${JSON.stringify(stored, null, 2)}\n`);
  } catch (e) { return { ok: false, reason: 'write-failed', error: e.message }; }
  return { ok: true, deduped: false, edge_id: stored.edge_id };
}

// --------------------------------------------------------------------------
// loadEdge / listEdges — verify-on-read + deep-freeze; a tampered/foreign file -> null.
// --------------------------------------------------------------------------
function loadEdge(edgeId, opts = {}) {
  const file = path.join(storeDir(opts), `${edgeId}.json`);
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  const verified = verifyEdge(parsed, edgeId);
  return verified ? deepFreeze(verified) : null;
}

function listEdges(opts = {}) {
  const dir = storeDir(opts);
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const rec = loadEdge(name.slice(0, -'.json'.length), opts);
    if (rec) out.push(rec);
  }
  return out;
}

// --------------------------------------------------------------------------
// retireEdges — the disposal analogue of retireAuthorship / retireBacktestNodes. No `before` ->
// retire ALL our OWN valid edges; an ISO `before` -> retire only edges datable older than the
// cutoff; a foreign/tampered file is left; a bad/EMPTY/unparseable `before` retires NOTHING.
// --------------------------------------------------------------------------
function retireEdges({ dir, before } = {}) {
  const d = dir || DEFAULT_DIR;
  let entries;
  try { entries = fs.readdirSync(d); } catch { return { retired: 0, kept: 0 }; }
  const retireAll = before == null;
  const beforeMs = (typeof before === 'string' && before.length > 0) ? Date.parse(before) : NaN;
  let retired = 0; let kept = 0;
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const rec = loadEdge(name.slice(0, -'.json'.length), { dir: d });
    if (!rec) { kept += 1; continue; }                              // foreign/tampered -- not ours to prune
    const recordedMs = Date.parse(rec.recorded_at);
    const drop = retireAll || (Number.isFinite(beforeMs) && Number.isFinite(recordedMs) && recordedMs < beforeMs);
    if (drop) { try { fs.rmSync(path.join(d, name)); retired += 1; } catch { kept += 1; } }
    else kept += 1;
  }
  return { retired, kept };
}

module.exports = { writeEdge, loadEdge, listEdges, deriveEdgeId, retireEdges, EDGE_TYPE, DEFAULT_DIR };
