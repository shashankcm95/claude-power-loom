'use strict';

// packages/kernel/_lib/wal-append.js
//
// Shared append-only JSONL-WAL append primitive. Extracted at PR-4b INTEGRATION
// (3-lens review, code-reviewer PRINCIPLE finding) because post-spawn-resolver.js
// AND recovery-sweep.js both shipped the same read-existing + newline-normalize +
// atomic-rewrite pattern, differing ONLY in their failure contract (the resolver's
// append is fail-soft — a WAL write must not mask the resolver verdict; the sweep's
// is fail-hard at the call site so the caller can isolate the failure per orphan).
// kb:architecture/crosscut/single-responsibility — one home so a future hardening
// (corruption detection, a different durability fence) lands in exactly one place.
//
// INV-19 (append-only): a record is APPENDED — the prior bytes are read, the tail
// newline is normalized so a torn final line cannot fuse two JSON objects, and the
// whole file is rewritten via the atomic tmp+rename primitive (a reader never sees
// a half-written WAL). This is a read-modify-rewrite append, not an O_APPEND write;
// the caller is expected to hold the relevant serial lock (K13) when concurrency is
// possible (the recovery-sweep does; the resolver runs at single-spawn close).
//
// The fail-soft vs fail-hard contract is a CALLER-CHOSEN parameter so the two
// behaviors live behind one implementation. Default is fail-hard (throw) — the
// conservative choice that surfaces disk failures rather than hiding them; the
// resolver opts into fail-soft explicitly.

const fs = require('fs');
const { writeAtomicString } = require('./atomic-write');

/**
 * Append one record to a JSONL WAL (read-existing + newline-normalize + atomic
 * rewrite). The underlying tmp+rename provides durability + atomicity; the prior
 * bytes are preserved (INV-19 byte-prefix). Immutability: builds a new string;
 * never mutates the record.
 *
 * @param {string} walPath                 the WAL file path
 * @param {object} record                  the record to append (JSON-serialized)
 * @param {object} [opts]
 * @param {boolean} [opts.failSoft=false]  true → swallow a write failure (return
 *                                          false); false → re-throw (the default —
 *                                          surface disk failures, do not hide them)
 * @returns {boolean}  true on success; false when failSoft swallowed a failure
 * @throws {Error}     on a write failure when failSoft is not set
 */
function appendWalRecord(walPath, record, opts) {
  if (typeof walPath !== 'string' || walPath.length === 0) {
    if (opts && opts.failSoft === true) return false;
    throw new Error('wal-append.appendWalRecord: a non-empty walPath is required');
  }
  try {
    let prior = '';
    try { prior = fs.readFileSync(walPath, 'utf8'); } catch { prior = ''; }
    // Normalize a missing tail newline so an append never fuses onto a torn line.
    const base = prior.length > 0 && !prior.endsWith('\n') ? prior + '\n' : prior;
    writeAtomicString(walPath, base + JSON.stringify(record) + '\n');
    return true;
  } catch (err) {
    // Fail-soft: the caller chose to let a WAL write failure not mask its verdict.
    if (opts && opts.failSoft === true) return false;
    throw err;
  }
}

module.exports = { appendWalRecord };
