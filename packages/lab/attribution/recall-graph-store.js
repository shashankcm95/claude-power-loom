#!/usr/bin/env node

// @loom-layer: lab
//
// v3.9 W4 — the per-node-file recall-graph store (the bootcamp's RETRIEVAL artifact
// home). A content-addressed node store: one file per worked-example node, named by
// node_id, under a PHYSICALLY SEPARATE dir `$LOOM_LAB_STATE_DIR/recall-graph-backtest/`.
// Mirrors manage-proposal/store.js (per-record, content-verify-on-read) — NOT the
// single-ledger verdict store (VERIFY-arch: a node store has no expiry/cap/ledger needs).
//
// THE OQ-7 PHYSICAL FIREWALL (VERIFY-hacker H-CRITICAL — a stamped-but-unread
// provenance tag excludes NOTHING): the store REJECTS any node whose provenance is
// not the backtest value, and every node lives under recall-graph-backtest/. A future
// v3.10 live retriever pointed at a live store can NEVER reach a path here. This is a
// FORWARD contract (queryable-as-excluded + physically unreachable), not an enforced
// runtime live-exclusion (no live retriever exists today).
//
// THE STORE IS NOT A SANDBOX (#273): loadNode re-derives node_id (basis incl.
// provenance) + content_hash (body) and refuses (fail-soft -> null) any file whose
// name/id/body disagree. Dedup is FIRST-eligible-wins (a re-run with a divergent
// body never overwrites — the id is patch-stable, the body varies since claude -p has
// no seed). Read-back is DEEP-frozen incl. the nested worked_example_ref (the read-path
// immutability leak that bit the Lab store twice — do NOT inherit a write-only freeze).
//
// Layer (K12, by PATH): under packages/lab/, so `lab`. Imports ONLY kernel/_lib
// (atomic-write / deep-freeze — lab->kernel = LEGAL) + the sibling ./recall-graph
// (the SAME deriveNodeId/computeContentHash the builder used). NO runtime/kernel STATE.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeAtomicString } = require('../../kernel/_lib/atomic-write');
const { deepFreeze } = require('../../kernel/_lib/deep-freeze');
const { deriveNodeId, computeContentHash, PROVENANCE, classifyLessonLayer } = require('./recall-graph');

const LAB_STATE_BASE = process.env.LOOM_LAB_STATE_DIR || path.join(os.homedir(), '.claude', 'lab-state');
const DEFAULT_DIR = path.join(LAB_STATE_BASE, 'recall-graph-backtest');
const HEX64 = /^[0-9a-f]{64}$/;
// #536 (VALIDATE-hacker MEDIUM) — a per-node-file READ cap. A single node is a few KB; this
// bounds a hostile planted file BEFORE readFileSync slurps it (a 200MB file -> ~200MB RSS;
// listNodes/retire iterate EVERY file). Generous vs a legit node, far below an OOM.
// Env-overridable (mirrors negative-attestation's LOOM_LAB_MAX_LEDGER_BYTES convention).
const MAX_NODE_FILE_BYTES = Number(process.env.LOOM_LAB_MAX_NODE_BYTES) > 0
  ? Number(process.env.LOOM_LAB_MAX_NODE_BYTES) : 1024 * 1024;

function storeDir(opts) { return (opts && opts.dir) || DEFAULT_DIR; }

// v3.10-W0' — two built_by tags differ? FIELD-BY-FIELD (VALIDATE-reviewer: order-independent, so a
// future producer with a different key order can't cause a false/missed collision). null -> absent.
function personaTagsDiffer(a, b) {
  if (a == null && b == null) return false;
  if (a == null || b == null) return true;
  return a.role !== b.role || a.roster_name !== b.roster_name || a.actor_kind !== b.actor_kind;
}

// Re-derive both addresses from the body + basis; a file that lies about either is
// not a node we wrote (the store is not a sandbox). Returns the node or null.
function verifyNode(node, expectedId) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
  if (node.provenance !== PROVENANCE) return null;               // OQ-7: only backtest nodes live here
  if (!HEX64.test(String(node.node_id || ''))) return null;
  if (expectedId != null && node.node_id !== expectedId) return null; // filename must equal the field
  const reId = deriveNodeId(node.worked_example_ref, node.provenance);
  if (reId !== node.node_id) return null;                        // basis must derive the id
  if (computeContentHash(node.worked_example_ref) !== node.content_hash) return null; // body must hash to content_hash
  // v3.11 W1 — presence-conditional lesson-layer integrity (#273 on a new artifact): a
  // lesson-LESS node passes; a node WITH a lesson layer must carry a matching
  // lesson_content_hash + a lesson_signature that re-derives from its block, else REJECT
  // (incl. the strip-to-look-absent forge). The store is not a sandbox.
  if (classifyLessonLayer(node) === 'invalid') return null;
  return node;
}

// --------------------------------------------------------------------------
// writeNode — REJECT a non-backtest node; dedup first-wins by file existence; else
// atomic-write <node_id>.json.
// --------------------------------------------------------------------------

function writeNode(node, opts = {}) {
  if (!node || node.provenance !== PROVENANCE) return { ok: false, reason: 'provenance-rejected' };
  if (!HEX64.test(String(node.node_id || ''))) return { ok: false, reason: 'bad-node-id' };
  // Verify-on-WRITE too (VALIDATE-hacker LOW): the write side must not deposit a node
  // whose basis/body do not derive its node_id/content_hash — symmetric with loadNode
  // (the #273 "verify content not key" discipline applied write-side, not just read-side).
  // #536 sibling (VALIDATE-reviewer MEDIUM): verifyNode re-hashes worked_example_ref and can
  // THROW on a pathological deep/wide body. A DIRECT caller (spike/dogfood scripts call the
  // exported writeNode) must get the {ok:false} reject convention, not an uncaught crash.
  let selfConsistent;
  try { selfConsistent = verifyNode(node, node.node_id); }
  catch { return { ok: false, reason: 'unverifiable' }; }
  if (!selfConsistent) return { ok: false, reason: 'self-inconsistent' };
  const dir = storeDir(opts);
  const file = path.join(dir, `${node.node_id}.json`);
  // W4d Item 2d (+ CodeRabbit Major): tighten the lab-state dir on EVERY write path (dedup + repair +
  // create), not just create — a node carries the (scrubbed-best-effort) lesson_body and a world-
  // readable dir is the threat the scrub amplifies against. mkdir(mode) is create-only + umask-subject,
  // so a pre-existing loose leaf would stay 0755 on a dedup re-run; the chmod tightens it. Best-effort.
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.chmodSync(dir, 0o700); } catch { /* */ }
  // RETIREMENT-LIFECYCLE stamp: `recorded_at` (first-population time) is a TOP-LEVEL field
  // OUTSIDE the content-hashed worked_example_ref + the node_id basis, so it never affects
  // dedup/content-verify — it only supports age/date-based retirement of these SCAFFOLDING
  // nodes once external trust accrues. Injectable `now` for deterministic tests.
  const stored = { ...node, recorded_at: opts.now || new Date().toISOString() };
  // Dedup is content-AWARE, not bare file-existence (VALIDATE-hacker LOW: a squatted/
  // truncated stub must not silently drop the real node while reporting ok:true). On an
  // existing-file hit: if it reads back as a VALID node, genuine first-eligible-wins (its
  // ORIGINAL recorded_at is kept — age = since FIRST populated); if it is unverifiable
  // garbage (a squat or a crash-truncated write), REPAIR by overwriting.
  if (fs.existsSync(file)) {
    const prior = loadNode(node.node_id, opts);                 // the kept (first-eligible) node, if valid
    if (prior != null) {
      // v3.10-W0' persona-collision (VERIFY-hacker H1): the worked example is SHARED (node_id
      // excludes persona), but a DIFFERENT built_by means a 2nd persona produced the same example.
      // First-eligible-wins, but SIGNAL it so the caller LOGS the erasure -- NEVER a silent drop.
      // (Multi-author MERGE is the documented step-2 upgrade.)
      if (personaTagsDiffer(prior.built_by, node.built_by)) {
        return { ok: true, deduped: true, persona_collision: true, kept_built_by: prior.built_by || null, incoming_built_by: node.built_by || null, node_id: node.node_id };
      }
      return { ok: true, deduped: true, node_id: node.node_id };
    }
    try { writeAtomicString(file, `${JSON.stringify(stored, null, 2)}\n`); }
    catch (e) { return { ok: false, reason: 'write-failed', error: e.message }; }
    return { ok: true, deduped: false, repaired: true, node_id: node.node_id };
  }
  try {
    writeAtomicString(file, `${JSON.stringify(stored, null, 2)}\n`); // dir created + hardened above
  } catch (e) { return { ok: false, reason: 'write-failed', error: e.message }; }
  return { ok: true, deduped: false, node_id: node.node_id };
}

// --------------------------------------------------------------------------
// retireBacktestNodes — the RETIREMENT lifecycle (USER 2026-06-13). Bootcamp nodes are
// SCAFFOLDING (provenance='backtest', physically separate, recorded_at-stamped). Once
// EXTERNAL trust accrues (a v3.10+ world-anchored live merge — OQ-NS-6: only that
// HARDENS), retire them: ALL (no `before`), or only those populated before an ISO `before`
// cutoff (age-based). Only OUR OWN verified backtest nodes are prunable — a foreign /
// tampered file is left untouched. A consumer that prefers DOWN-WEIGHT over delete can
// instead just rank `provenance==='backtest'` below live nodes (the tag is the differentiator).
// --------------------------------------------------------------------------

function retireBacktestNodes({ dir, before } = {}) {
  const d = dir || DEFAULT_DIR;
  let entries;
  try { entries = fs.readdirSync(d); } catch { return { retired: 0, kept: 0 }; }
  // TEMPORAL compare, not raw string ordering (CodeRabbit #316): ISO timestamps with different
  // formats (e.g. a +HH:MM offset vs Z) sort wrong lexically. Parse to epoch ms. A bad/unparseable
  // `before` retires NOTHING (fail-safe — a typo'd cutoff must not wipe the store).
  const beforeMs = before ? Date.parse(before) : NaN;
  let retired = 0; let kept = 0;
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const node = loadNode(name.slice(0, -'.json'.length), { dir: d });
    if (!node) { kept += 1; continue; }                            // foreign/tampered — not ours to prune
    // no `before` => retire all; else retire only nodes datable as older than the cutoff (a node
    // whose recorded_at is missing/unparseable is KEPT — never retire what you can't date).
    const recordedMs = typeof node.recorded_at === 'string' ? Date.parse(node.recorded_at) : NaN;
    const drop = !before || (Number.isFinite(beforeMs) && Number.isFinite(recordedMs) && recordedMs < beforeMs);
    if (drop) { try { fs.rmSync(path.join(d, name)); retired += 1; } catch { kept += 1; } }
    else kept += 1;
  }
  return { retired, kept };
}

// --------------------------------------------------------------------------
// loadNode / listNodes — verify-on-read + deep-freeze. A tampered/foreign file
// fail-softs to null (skipped in a list), never throws the read.
// --------------------------------------------------------------------------

function loadNode(node_id, opts = {}) {
  const file = path.join(storeDir(opts), `${node_id}.json`);
  // never-throws (the section contract): a tampered / foreign / HOSTILE file fail-softs
  // to null. #536: verifyNode re-hashes the UNTRUSTED body — computeContentHash /
  // deriveNodeId -> canonicalJsonSerialize THROWS a controlled TypeError on a
  // pathological deep/wide worked_example_ref (the depth/node-budget guards) — so it
  // must sit INSIDE the try, not after it, or a single planted file crashes the read
  // (and listNodes, and the backtest consumer).
  try {
    // Bound the read: reject a non-regular file (a planted fifo/device/dir would hang or
    // mislead readFileSync) or one over the size cap, BEFORE slurping it into memory.
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_NODE_FILE_BYTES) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const verified = verifyNode(parsed, node_id);
    return verified ? deepFreeze(verified) : null;
  } catch { return null; }
}

function listNodes(opts = {}) {
  const dir = storeDir(opts);
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const node = loadNode(name.slice(0, -'.json'.length), opts);
    if (node) out.push(node);
  }
  return out;
}

module.exports = { writeNode, loadNode, listNodes, retireBacktestNodes, DEFAULT_DIR };
