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
const { deriveNodeId, computeContentHash, PROVENANCE } = require('./recall-graph');

const LAB_STATE_BASE = process.env.LOOM_LAB_STATE_DIR || path.join(os.homedir(), '.claude', 'lab-state');
const DEFAULT_DIR = path.join(LAB_STATE_BASE, 'recall-graph-backtest');
const HEX64 = /^[0-9a-f]{64}$/;

function storeDir(opts) { return (opts && opts.dir) || DEFAULT_DIR; }

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
  if (!verifyNode(node, node.node_id)) return { ok: false, reason: 'self-inconsistent' };
  const dir = storeDir(opts);
  const file = path.join(dir, `${node.node_id}.json`);
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
    if (loadNode(node.node_id, opts) != null) return { ok: true, deduped: true, node_id: node.node_id };
    try { writeAtomicString(file, `${JSON.stringify(stored, null, 2)}\n`); }
    catch (e) { return { ok: false, reason: 'write-failed', error: e.message }; }
    return { ok: true, deduped: false, repaired: true, node_id: node.node_id };
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    writeAtomicString(file, `${JSON.stringify(stored, null, 2)}\n`);
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
  let retired = 0; let kept = 0;
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const node = loadNode(name.slice(0, -'.json'.length), { dir: d });
    if (!node) { kept += 1; continue; }                            // foreign/tampered — not ours to prune
    // no `before` => retire all; else retire only nodes datable as older than the cutoff
    // (a node with no recorded_at is KEPT under a date-based retire — never retire what you can't date).
    const drop = !before || (typeof node.recorded_at === 'string' && node.recorded_at < before);
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
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  const verified = verifyNode(parsed, node_id);
  return verified ? deepFreeze(verified) : null;
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
