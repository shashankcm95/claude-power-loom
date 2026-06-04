// @loom-layer: lab
//
// v3.4 Wave 3 — the off-hot-path A6 materializer. project.js is a PURE deterministic theorem (v6:509),
// so ALL I/O for E4 lives HERE (SRP): projectReputation → a snapshot body → the SHARED content-hash →
// an atomic-rename write to the SHARED resolveSnapshotPath(). The kernel's spawn-record hook then reads
// that file O(1) (never the live projection) — the §3.6 Lab→Kernel A6 mediation.
//
// "Invalidation" is not a thing here: the snapshot is an immutable point-in-time axiom (v6:179). A
// burst of new verdicts does not invalidate it — a later materialize SUPERSEDES it via atomic rename,
// applying to spawns initiated after the rename (v6:408). The atomic rename (write-tmp-in-dir + rename,
// POSIX-atomic on one filesystem) is the ONLY concurrency control needed: a concurrent reader sees the
// old-complete OR the new-complete file, never a torn one — no lock on the hot path.
//
// Trigger = on-demand this wave (the `reputation materialize` CLI). Wiring a production trigger
// (session-start / post-enrich tail) is a deliberate later activation, paired with breakers
// (v3.4 design-input (a)). Until then the snapshot is simply absent/stale → the reader fails open.
//
// Layer discipline (K12): imports `./project` (lab→lab) + `kernel/_lib/{evolution-snapshot-read,
// atomic-write}` (lab→kernel/_lib, legal). Imports no kernel STATE.

'use strict';

const fs = require('fs');
const path = require('path');
const { projectReputation } = require('./project');
const { resolveSnapshotPath, computeSnapshotHash } = require('../../kernel/_lib/evolution-snapshot-read');
const { writeAtomicString } = require('../../kernel/_lib/atomic-write');

const SCHEMA_VERSION = 'v1';
const KIND = 'evolution-snapshot/reputation';

// The watermark makes staleness OBSERVABLE (nothing acts on it — the hot path never compares it to the
// live ledger). record_count = every ledger record the projection saw (enriched-counted + excluded).
function buildWatermark(rep) {
  const enrichedTotal = rep.personas.reduce((n, p) => n + (Number(p.total) || 0), 0);
  let maxRecordedAt = null;
  for (const p of rep.personas) {
    if (typeof p.last_seen === 'string' && (maxRecordedAt === null || p.last_seen > maxRecordedAt)) {
      maxRecordedAt = p.last_seen;
    }
  }
  return {
    record_count: enrichedTotal + (rep.excluded_unenriched || 0) + (rep.excluded_malformed || 0),
    max_recorded_at: maxRecordedAt,
    excluded_unenriched: rep.excluded_unenriched || 0,
    excluded_malformed: rep.excluded_malformed || 0,
  };
}

/**
 * Project the live E4 view and write a content-addressed snapshot file atomically.
 *
 * @param {object} [opts] { now?: number|string (determinism), outPath?: string }
 * @returns {{path:string, content_hash:string, persona_count:number, generated_at:string}}
 */
function materializeSnapshot(opts) {
  const o = opts || {};
  const rep = projectReputation({ now: o.now }); // pure; the ONLY ledger read
  const body = {
    schema_version: SCHEMA_VERSION,
    kind: KIND,
    generated_at: rep.generated_at,
    source: rep.source,
    label: rep.label,
    watermark: buildWatermark(rep),
    personas: rep.personas,
  };
  // The hash is over the canonical body (computeSnapshotHash strips content_hash; body has none yet).
  // It is independent of the file's pretty-printing — JSON.parse → canonical re-serialize on read.
  // Guard the canonical-json node-cap (VALIDATE code-reviewer MED): a future wave that grows the
  // distribution past ~10k nodes (e.g. E5–E11 secondary persona axes) would otherwise throw a raw
  // TypeError here, silently stopping snapshot production. Re-throw with an operator-legible message.
  let content_hash;
  try {
    content_hash = computeSnapshotHash(body);
  } catch (e) {
    throw new Error(`materialize: snapshot too large to content-hash (canonical-json node budget exceeded — reduce the persona/axis count). Underlying: ${e.message}`);
  }
  const snapshot = { ...body, content_hash };
  const target = o.outPath || resolveSnapshotPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  writeAtomicString(target, `${JSON.stringify(snapshot, null, 2)}\n`);
  return { path: target, content_hash, persona_count: rep.personas.length, generated_at: rep.generated_at };
}

module.exports = { materializeSnapshot, buildWatermark, SCHEMA_VERSION, KIND };
