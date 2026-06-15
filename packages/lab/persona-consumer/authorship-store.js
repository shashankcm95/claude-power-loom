#!/usr/bin/env node

// @loom-layer: lab
//
// v3.10-W2 — the authorship LEDGER: a content-addressed (node_id, built_by) edge store, the SHARED-memory
// substrate. A recall node's node_id EXCLUDES persona (recall-graph.js deriveNodeId), so two personas
// building the SAME worked example collide on one node_id; the node store keeps only the FIRST built_by
// (first-eligible-wins) and reports the collision return-only. This ledger PERSISTS one edge per (node,
// author) so a signal about a shared node can credit ALL its authors (the consumer's collision-first JOIN).
//
// SEPARATE dir `$LOOM_LAB_STATE_DIR/recall-authorship/`. Mirrors hardening-signal-store.js (content-address,
// verify-on-write AND on-read, dedup first-wins, opts.dir, deep-freeze). The DRY decision (architect LOW) is
// DELIBERATE duplication: each lab store's verify predicate differs and is security-load-bearing (signal:
// source==='mock'; node: provenance==='backtest'; authorship: STRICT node_id + roster shape) -- a shared
// factory would obscure each lane's distinct firewall, so independent auditability wins over DRY.
//
// ENV-BEFORE-REQUIRE (the Lab-store discipline): LAB_STATE_BASE is a module-load const, so a caller MUST set
// LOOM_LAB_STATE_DIR BEFORE requiring this module (or pass opts.dir explicitly, as the tests do).
//
// FIREWALL folds (VERIFY-hacker):
//   - STRICT node_id guard `typeof === 'string' && HEX64` (hardening-signal-store.js:63), NOT
//     recall-graph-store.js:57's `HEX64.test(String(node_id))` -- the authorship lane has NO separate
//     re-derivation source (node_id is itself a direct basis input), so a coerced `[NID]` would be
//     self-consistent under the loose form. (hacker HIGH, the #273 class on the new lane.)
//   - `recorded_at` is TOP-LEVEL, OUTSIDE the authorship_id basis (mirror the NODE store's outside-the-hash
//     stamp, NOT the signal store's IN-hash form) -- folding it in would break (node,author) dedup, since a
//     different-time re-record would stop colliding. It supports retireAuthorship + an audit trail. (hacker MED.)
//   - The ledger stores built_by FIELDS only, NEVER a precomputed persona_key (the consumer re-derives the
//     key via personaKeyOf so the `.`-delimiter collision-proofing can't be bypassed). (hacker LOW.)

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { writeAtomicString } = require('../../kernel/_lib/atomic-write');
const { deepFreeze } = require('../../kernel/_lib/deep-freeze');
const { canonicalJsonSerialize } = require('../../kernel/_lib/canonical-json');

const LAB_STATE_BASE = process.env.LOOM_LAB_STATE_DIR || path.join(os.homedir(), '.claude', 'lab-state');
const DEFAULT_DIR = path.join(LAB_STATE_BASE, 'recall-authorship');

// Re-declared locally (the DRY decision) -- mirrors recall-graph.js:58-59. role/roster_name shape +
// the actor_kind closed set. The `.` is forbidden by ROSTER_TOKEN so a `role.roster_name` key is collision-proof.
const ROSTER_TOKEN = /^[a-z][a-z0-9-]{0,30}$/;
const ACTOR_KINDS = new Set(['claude_p', 'agent_spawn', 'root']);
const HEX64 = /^[0-9a-f]{64}$/;

function storeDir(opts) { return (opts && opts.dir) || DEFAULT_DIR; }
function sha256hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

// STRICT node_id (NOT String()-coercing -- hacker HIGH).
function isValidNodeId(v) { return typeof v === 'string' && v.length > 0 && HEX64.test(v); }
// A real author tag: a {role, roster_name, actor_kind} all shape-legal (no null/unattributed edge).
function isValidBuiltBy(bb) {
  if (!bb || typeof bb !== 'object' || Array.isArray(bb)) return false;
  return typeof bb.role === 'string' && ROSTER_TOKEN.test(bb.role)
    && typeof bb.roster_name === 'string' && ROSTER_TOKEN.test(bb.roster_name)
    && ACTOR_KINDS.has(bb.actor_kind);
}

// authorship_id over the IDENTITY basis (node_id + the author fields). recorded_at is NOT in the basis
// (so a different-time re-record dedups to the same file). A flipped author perturbs the id.
function deriveAuthorshipId(rec) {
  // null-safe (CodeRabbit #325): the prior `rec && rec.node_id == null ? '' : String(rec.node_id)` form
  // THREW on a null `rec` -- the `&&` short-circuits to null (falsy), so the false branch ran
  // `String(rec.node_id)` on null. Normalize `rec`/`built_by` to {} up front so a null arg hashes to the
  // all-empty basis instead of throwing (this is a pure, EXPORTED helper; internal callers already guard).
  const r = rec || {};
  const bb = r.built_by || {};
  return sha256hex(canonicalJsonSerialize([
    r.node_id == null ? '' : String(r.node_id),
    bb.role == null ? '' : String(bb.role),
    bb.roster_name == null ? '' : String(bb.roster_name),
    bb.actor_kind == null ? '' : String(bb.actor_kind),
  ]));
}

// Re-derive the address + re-apply the SAME strict shape guards on read (read/write parity -- #323). A file
// that lies (coerced node_id, bad author, bad ts, forged id) is not one we wrote -> fail-soft null.
function verifyAuthorship(rec, expectedId) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
  if (!isValidNodeId(rec.node_id)) return null;
  if (!isValidBuiltBy(rec.built_by)) return null;
  if (typeof rec.recorded_at !== 'string' || rec.recorded_at.length === 0) return null;
  if (!Number.isFinite(Date.parse(rec.recorded_at))) return null;
  if (!HEX64.test(String(rec.authorship_id || ''))) return null;
  if (expectedId != null && rec.authorship_id !== expectedId) return null; // filename == field
  if (deriveAuthorshipId(rec) !== rec.authorship_id) return null;          // body hashes to id
  return rec;
}

function normalize(rec) {
  const bb = rec.built_by;
  return {
    authorship_id: deriveAuthorshipId(rec),
    node_id: rec.node_id,
    built_by: { role: bb.role, roster_name: bb.roster_name, actor_kind: bb.actor_kind }, // FIELDS only
    recorded_at: rec.recorded_at,
  };
}

// --------------------------------------------------------------------------
// writeAuthorship — REJECT a malformed edge; dedup first-wins; atomic-write.
// --------------------------------------------------------------------------
function writeAuthorship(rec, opts = {}) {
  if (!rec || typeof rec !== 'object') return { ok: false, reason: 'bad-authorship' };
  if (!isValidNodeId(rec.node_id)) return { ok: false, reason: 'bad-node-id' };
  if (!isValidBuiltBy(rec.built_by)) return { ok: false, reason: 'bad-built-by' };
  if (typeof rec.recorded_at !== 'string' || rec.recorded_at.length === 0) return { ok: false, reason: 'bad-recorded-at' };
  if (!Number.isFinite(Date.parse(rec.recorded_at))) return { ok: false, reason: 'bad-recorded-at-format' };
  const stored = normalize(rec);
  if (!verifyAuthorship(stored, stored.authorship_id)) return { ok: false, reason: 'self-inconsistent' };
  const dir = storeDir(opts);
  const file = path.join(dir, `${stored.authorship_id}.json`);
  if (fs.existsSync(file)) {
    const prior = loadAuthorship(stored.authorship_id, opts);
    if (prior != null) return { ok: true, deduped: true, authorship_id: stored.authorship_id };
    // unverifiable garbage at the path -> repair by overwriting
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    writeAtomicString(file, `${JSON.stringify(stored, null, 2)}\n`);
  } catch (e) { return { ok: false, reason: 'write-failed', error: e.message }; }
  return { ok: true, deduped: false, authorship_id: stored.authorship_id };
}

// --------------------------------------------------------------------------
// loadAuthorship / listAuthorships — verify-on-read + deep-freeze; a tampered/foreign file -> null.
// --------------------------------------------------------------------------
function loadAuthorship(authorshipId, opts = {}) {
  const file = path.join(storeDir(opts), `${authorshipId}.json`);
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  const verified = verifyAuthorship(parsed, authorshipId);
  return verified ? deepFreeze(verified) : null;
}

function listAuthorships(opts = {}) {
  const dir = storeDir(opts);
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const rec = loadAuthorship(name.slice(0, -'.json'.length), opts);
    if (rec) out.push(rec);
  }
  return out;
}

// --------------------------------------------------------------------------
// retireAuthorship — the disposal analogue of retireBacktestNodes (recall-graph-store.js:122-143). No
// `before` -> retire ALL our OWN valid edges; an ISO `before` -> retire only edges datable older than the
// cutoff; a foreign/tampered file is left; a bad/unparseable `before` retires NOTHING (fail-safe).
// --------------------------------------------------------------------------
function retireAuthorship({ dir, before } = {}) {
  const d = dir || DEFAULT_DIR;
  let entries;
  try { entries = fs.readdirSync(d); } catch { return { retired: 0, kept: 0 }; }
  // before == null (undefined/null) -> retire ALL; an EMPTY or unparseable `before` -> retire NOTHING
  // (fail-safe; VALIDATE-reviewer LOW: an empty string is falsy, so the bare `!before` form would have
  // treated `''` as 'retire all' -- a future caller that conditionally builds the cutoff and lands on `''`
  // must NOT wipe the store). A valid ISO `before` -> retire only edges older than the cutoff.
  const retireAll = before == null;
  const beforeMs = (typeof before === 'string' && before.length > 0) ? Date.parse(before) : NaN;
  let retired = 0; let kept = 0;
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const rec = loadAuthorship(name.slice(0, -'.json'.length), { dir: d });
    if (!rec) { kept += 1; continue; }                              // foreign/tampered -- not ours to prune
    const recordedMs = Date.parse(rec.recorded_at);
    const drop = retireAll || (Number.isFinite(beforeMs) && Number.isFinite(recordedMs) && recordedMs < beforeMs);
    if (drop) { try { fs.rmSync(path.join(d, name)); retired += 1; } catch { kept += 1; } }
    else kept += 1;
  }
  return { retired, kept };
}

module.exports = { writeAuthorship, loadAuthorship, listAuthorships, deriveAuthorshipId, retireAuthorship, DEFAULT_DIR };
