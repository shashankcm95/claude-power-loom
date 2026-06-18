#!/usr/bin/env node

// @loom-layer: lab
//
// E1 ingest (v3.3 Wave 0 — the capture half of the un-darkening). Reads a `decompose-run`
// OUTBOX (`<run-state>/<run-id>/decompose-result.json`) as a DATA FILE and records each
// rejected leaf's `failure_signature` as a negative attestation.
//
// Layer discipline (K12, by path): this is `lab`. It imports kernel/_lib (runState — lab→kernel,
// legal) + the sibling lab store. It does NOT import the runtime decompose-run module — the
// runtime↔lab edge is a JSON-file data contract, not a code import (so neither layer imports the
// other; the lint stays clean and the Lab advisory boundary holds — Lab PULLS, nothing pushes in).
//
// Provenance comes from the outbox itself (run_id/persona/task written by decompose-run), so this
// ingest needs only `--run-id` — it is never told the persona (and so can't be told the wrong one).

'use strict';

const fs = require('fs');
const path = require('path');
const { runStateDir } = require('../../kernel/_lib/runState');
const { isSafePathSegment } = require('../../kernel/_lib/path-canonicalize'); // C1 — runId path-guard
const { recordAttestation } = require('./store');

// A BYTE cap on the outbox read: a hand-crafted / flooded decompose-result.json past V8's ~512MB
// single-string ceiling would make fs.readFileSync(path,'utf8') THROW (an unbounded read), and a
// huge-but-under-ceiling file would still spike RSS before JSON.parse. The real outbox is a small
// admitted/rejected leaf list — 16MB is far above any legitimate run. Env-overridable (the
// ENV-BEFORE-REQUIRE discipline) so a test can exercise the oversize path without a 16MB fixture.
const MAX_OUTBOX_BYTES = Number(process.env.LOOM_LAB_MAX_OUTBOX_BYTES) > 0
  ? Number(process.env.LOOM_LAB_MAX_OUTBOX_BYTES) : 16 * 1024 * 1024;

// A well-formed failure_signature is the frozen ADR-0015 block: 8 FLAT scalar fields (string-or-null),
// depth-1 (the schema is additionalProperties:false, all-scalar). The C1 ingest is untrusted (a
// hand-crafted outbox), so reject any signature carrying a nested object/array value BEFORE recording.
// This closes a deep/wide-nesting DoS at the boundary (hacker VALIDATE — the HIGH): a deeply-nested
// signature would otherwise overflow the RECURSIVE serializers downstream (canonicalJsonSerialize AND
// the verbatim JSONL writeLedger), throwing out of the un-try/caught loop and failing the WHOLE run's
// ingest — denying every GOOD leaf its witness. Forward-tolerant: a future NEW scalar field still
// passes (we reject nesting, not unknown keys).
function isFlatScalarSignature(sig) {
  return Object.values(sig).every((v) => v === null || typeof v !== 'object');
}

/**
 * Read + parse the decompose-run outbox for a run. Throws (bad runId / ENOENT / parse error) — the
 * CLI converts those into a clean exit, callers decide.
 * @param {string} runId
 * @returns {object} the outbox payload { run_id, persona, task, admitted, rejected, all_rejected }
 */
function readOutbox(runId) {
  // C1 (hacker VALIDATE — CRITICAL): the ingest is a SEPARATE entry point — an attacker can invoke
  // `cli.js record-from-decompose --run-id ../../secret` directly to read an arbitrary file into a
  // FORGED attestation. So the ingest MUST self-defend; it never trusts decompose-run to have
  // guarded runId. Guard the RAW segment PRE-join (isSafePathSegment rejects ALL separators + '..',
  // so path.join can't escape — the #215 trap-class: a post-join checkWithinRoot is blinded because
  // path.join collapses '..' first).
  if (!isSafePathSegment(runId)) {
    throw new Error(`record-from-decompose: runId ${JSON.stringify(runId)} is not a safe path segment — no separators or '..' allowed`);
  }
  const outboxPath = path.join(runStateDir(runId), 'decompose-result.json');
  // Bound the read by bytes BEFORE materializing the file as a string (fail-soft, never reads a
  // >MAX_OUTBOX_BYTES blob): stat first; an oversized outbox throws a clean Error (the CLI converts
  // throws into a clean exit) rather than spiking RSS / hitting V8's single-string ceiling.
  const size = fs.statSync(outboxPath).size;
  if (size > MAX_OUTBOX_BYTES) {
    throw new Error(`record-from-decompose: outbox for run ${JSON.stringify(runId)} is ${size} bytes, exceeding the ${MAX_OUTBOX_BYTES}-byte read cap — refusing to read (advisory)`);
  }
  return JSON.parse(fs.readFileSync(outboxPath, 'utf8'));
}

/**
 * Ingest a run's rejected leaves into the E1 store. ADVISORY — records only; blocks nothing.
 *
 * @param {object} opts
 * @param {string} opts.runId
 * @param {number} [opts.expiresAfterDays]
 * @param {number|string} [opts.now]   injected wall-clock (tests)
 * @returns {{runId, persona, rejectedCount, recorded, deduped, skipped}}
 */
function recordFromDecompose(opts) {
  const o = opts || {};
  if (typeof o.runId !== 'string' || o.runId.length === 0) {
    throw new Error('recordFromDecompose: runId (a non-empty string) is required');
  }
  const outbox = readOutbox(o.runId);
  const persona = (typeof outbox.persona === 'string' && outbox.persona.length > 0) ? outbox.persona : null;
  if (!persona) {
    throw new Error(`recordFromDecompose: outbox for run ${JSON.stringify(o.runId)} carries no persona — cannot attribute the attestation`);
  }
  const task = (typeof outbox.task === 'string' && outbox.task.length > 0) ? outbox.task : null;
  const rejected = Array.isArray(outbox.rejected) ? outbox.rejected : [];

  let recorded = 0;
  let deduped = 0;
  let skipped = 0;
  for (const r of rejected) {
    if (!r || typeof r !== 'object' || !r.failure_signature || typeof r.failure_signature !== 'object'
        || !isFlatScalarSignature(r.failure_signature)) {
      skipped += 1; // malformed OR non-flat (untrusted-ingest DoS guard) — skipped, not fatal (fail-soft)
      continue;
    }
    const res = recordAttestation({
      failureSignature: r.failure_signature,
      identity: { subagentType: persona, taskSignature: task, tags: [] },
      runId: o.runId,
      leafRef: (typeof r.id === 'string' && r.id.length > 0) ? r.id : null,
      expiresAfterDays: o.expiresAfterDays,
      now: o.now,
    });
    if (res && res.deduped) deduped += 1;
    else if (res && res.skipped) skipped += 1; // lock-contended advisory soft-skip (store M2)
    else recorded += 1;
  }
  return { runId: o.runId, persona, rejectedCount: rejected.length, recorded, deduped, skipped };
}

module.exports = { recordFromDecompose, readOutbox };
