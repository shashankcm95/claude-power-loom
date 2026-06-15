#!/usr/bin/env node

// @loom-layer: lab
//
// v3.10-W1 — the MOCKED hardening-signal store (the consumer's MIRROR lane). A content-
// addressed per-record store: one file per signal, named by signal_id, under a PHYSICALLY
// SEPARATE dir `$LOOM_LAB_STATE_DIR/hardening-signals-mock/`. Mirrors recall-graph-store.js
// (per-record, content-verify-on-read, deep-freeze, first-eligible-wins).
//
// THE OQ-NS-6 FIREWALL (VERIFY-hacker CRITICAL — a stamped-but-unchecked tag excludes nothing):
//   - `source` is folded INTO the content-address (signal_id = hash([node_id, outcome, source,
//     recorded_at])), so a file hand-edited to source:'real' after write FAILS re-derivation on
//     READ and is fail-soft dropped — the source tag CANNOT be laundered.
//   - The store REJECTS a non-'mock' record on WRITE and rejects it again on READ. This is the
//     mock-only lane; a real signal can never land here. (The mirror, not projectReputation,
//     is where the firewall lives — the verdict-attestation lane has no `source` field.)
//
// THE STORE IS NOT A SANDBOX (#273): loadSignal re-derives signal_id (basis incl. source) and
// refuses (fail-soft -> null) any file whose name/id/body disagree. Dedup is first-eligible-wins.
//
// ENV-BEFORE-REQUIRE (VERIFY-hacker CRITICAL): LAB_STATE_BASE is a module-load const, so a caller
// MUST set LOOM_LAB_STATE_DIR BEFORE requiring this module (the documented Lab-store discipline;
// the W1 harness runs in a CHILD PROCESS with env pre-set to honor this).
//
// Layer (K12, by PATH): packages/lab/, so `lab`. Imports ONLY kernel/_lib (atomic-write /
// deep-freeze / canonical-json — lab->kernel = LEGAL). NO runtime/kernel STATE.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { writeAtomicString } = require('../../kernel/_lib/atomic-write');
const { deepFreeze } = require('../../kernel/_lib/deep-freeze');
const { canonicalJsonSerialize } = require('../../kernel/_lib/canonical-json');

const LAB_STATE_BASE = process.env.LOOM_LAB_STATE_DIR || path.join(os.homedir(), '.claude', 'lab-state');
const DEFAULT_DIR = path.join(LAB_STATE_BASE, 'hardening-signals-mock');
const SOURCE_MOCK = 'mock';                 // the ONLY source this lane admits (OQ-NS-6)
const OUTCOMES = new Set(['support', 'refute']);
const HEX64 = /^[0-9a-f]{64}$/;

function storeDir(opts) { return (opts && opts.dir) || DEFAULT_DIR; }
function sha256hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

// signal_id over the IDENTITY basis. `source` is IN the basis (the firewall: a flipped tag
// fails re-derivation on read), as recall-graph folds provenance into deriveNodeId.
function deriveSignalId(sig) {
  return sha256hex(canonicalJsonSerialize([
    sig.node_id == null ? '' : String(sig.node_id),
    sig.outcome == null ? '' : String(sig.outcome),
    sig.source == null ? '' : String(sig.source),
    sig.recorded_at == null ? '' : String(sig.recorded_at),
  ]));
}

// Re-derive the address + revalidate the shape; a file that lies is not one we wrote.
function verifySignal(sig, expectedId) {
  if (!sig || typeof sig !== 'object' || Array.isArray(sig)) return null;
  if (sig.source !== SOURCE_MOCK) return null;                  // OQ-NS-6: mock-only lane
  if (!OUTCOMES.has(sig.outcome)) return null;
  if (typeof sig.node_id !== 'string' || sig.node_id.length === 0) return null;
  if (typeof sig.recorded_at !== 'string' || sig.recorded_at.length === 0) return null;
  if (!HEX64.test(String(sig.signal_id || ''))) return null;
  if (expectedId != null && sig.signal_id !== expectedId) return null; // filename == field
  if (deriveSignalId(sig) !== sig.signal_id) return null;       // body (incl source) hashes to id
  return sig;
}

function normalize(signal) {
  return {
    signal_id: deriveSignalId(signal),
    node_id: signal.node_id,
    outcome: signal.outcome,
    source: signal.source,
    recorded_at: signal.recorded_at,
  };
}

// --------------------------------------------------------------------------
// writeSignal — REJECT a non-mock / malformed record; dedup first-wins; atomic-write.
// --------------------------------------------------------------------------
function writeSignal(signal, opts = {}) {
  if (!signal || typeof signal !== 'object') return { ok: false, reason: 'bad-signal' };
  if (signal.source !== SOURCE_MOCK) return { ok: false, reason: 'source-rejected' }; // E5 write firewall
  if (!OUTCOMES.has(signal.outcome)) return { ok: false, reason: 'bad-outcome' };
  if (typeof signal.node_id !== 'string' || signal.node_id.length === 0) return { ok: false, reason: 'bad-node-id' };
  if (typeof signal.recorded_at !== 'string' || signal.recorded_at.length === 0) return { ok: false, reason: 'bad-recorded-at' };
  // VALIDATE-reviewer MED: reject an UNPARSEABLE recorded_at at the source -- else it rides through and
  // silently nulls the consumer's recency scalar (computeRecencyDecayAt skips a non-ISO ts -> null).
  if (!Number.isFinite(Date.parse(signal.recorded_at))) return { ok: false, reason: 'bad-recorded-at-format' };
  const stored = normalize(signal);
  if (!verifySignal(stored, stored.signal_id)) return { ok: false, reason: 'self-inconsistent' };
  const dir = storeDir(opts);
  const file = path.join(dir, `${stored.signal_id}.json`);
  if (fs.existsSync(file)) {
    const prior = loadSignal(stored.signal_id, opts);
    if (prior != null) return { ok: true, deduped: true, signal_id: stored.signal_id };
    // unverifiable garbage at the path -> repair by overwriting
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    writeAtomicString(file, `${JSON.stringify(stored, null, 2)}\n`);
  } catch (e) { return { ok: false, reason: 'write-failed', error: e.message }; }
  return { ok: true, deduped: false, signal_id: stored.signal_id };
}

// --------------------------------------------------------------------------
// loadSignal / listSignals — verify-on-read + deep-freeze; a tampered/foreign file
// (incl. a flipped source) fail-softs to null.
// --------------------------------------------------------------------------
function loadSignal(signalId, opts = {}) {
  const file = path.join(storeDir(opts), `${signalId}.json`);
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  const verified = verifySignal(parsed, signalId);
  return verified ? deepFreeze(verified) : null;
}

function listSignals(opts = {}) {
  const dir = storeDir(opts);
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const sig = loadSignal(name.slice(0, -'.json'.length), opts);
    if (sig) out.push(sig);
  }
  return out;
}

module.exports = { writeSignal, loadSignal, listSignals, deriveSignalId, DEFAULT_DIR, SOURCE_MOCK };
