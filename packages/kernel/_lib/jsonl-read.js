// packages/kernel/_lib/jsonl-read.js
//
// Shared BOUNDED JSONL reader. EXTRACTED (the canonical-json / recency-decay precedent) so both Lab
// attestation stores read their ledger safely — a flooded/hand-written ledger past V8's ~512MB
// single-string ceiling would make a plain fs.readFileSync(path,'utf8') THROW, and an advisory
// store's catch returns [] → the reputation/attestation view goes silently blank (v3.4 Wave-2
// VALIDATE hacker H1). lab→kernel/_lib is K12-legal.
//
// Guarantees (advisory — NEVER throws; never crashes the caller):
//   - missing file → []
//   - file ≤ maxBytes → read whole (a maxBytes-bounded string, well under the 512MB ceiling)
//   - file > maxBytes → TAIL-read the last maxBytes as a Buffer (never materializes a >maxBytes
//     string → the ceiling is structurally unreachable), drop the partial leading line.
//   - the record cap is applied by a BACKWARD SCAN, NOT split()+slice — so a file with millions of
//     tiny lines (under the byte bound) can't blow up memory building an N-element array first
//     (VALIDATE hacker H-1: split() materializes ALL lines before the cap → ~1GB RSS on a 50MB
//     many-line ledger). lastLines() scans back over only the last maxRecords lines' bytes.
//   - it returns the NEWEST records by FILE POSITION (append-only ledgers put newest last → for a
//     single-writer ledger this == newest by time; a caller's read-modify-write keeps NEWEST, so a
//     flooded ledger self-heals on the next write — NOT [] which would wipe it). NOTE: for an
//     out-of-order / hand-written ledger, "newest" is positional, not recorded_at-sorted.
//   - a corrupt line → skipped (fail-soft); a single line longer than maxBytes with no newline in the
//     tail window → dropped to [] (pathological; the write path caps field size, so a real line is tiny).

'use strict';

const fs = require('fs');

const ONE_MB = 1024 * 1024;
const DEFAULT_MAX_BYTES = 64 * ONE_MB;   // 64MB — far below V8's ~512MB single-string ceiling
// Hard ceiling on maxBytes regardless of the caller (VALIDATE hacker M-1: an unclamped env override
// like LOOM_LAB_MAX_LEDGER_BYTES=Infinity/1e30 would make `size > maxBytes` always false → the tail
// path becomes unreachable → a >512MB file falls back to readFileSync → throws → blanks again). A bad
// caller can shrink the window but can NOT disable the ceiling protection. 256MB < the ~512MB limit.
const HARD_MAX_BYTES = 256 * ONE_MB;
const DEFAULT_MAX_RECORDS = 10000;

function warn(name, msg) {
  try { process.stderr.write(`${name}: ${msg}\n`); } catch { /* ignore */ }
}

function fmtBytes(n) {
  return n >= ONE_MB ? `${Math.round(n / ONE_MB)}MB` : `${n}B`;
}

// Return the last `max` NON-EMPTY lines of `text`, scanning BACKWARD — never builds an array of all
// lines (the H-1 fix). O(bytes in the last `max` lines), not O(file). Oldest-first (chronological).
function lastLines(text, max) {
  const out = [];
  let end = text.length;
  while (out.length < max && end > 0) {
    if (text[end - 1] === '\n') { end -= 1; continue; } // skip a trailing / empty-line newline
    const nl = text.lastIndexOf('\n', end - 1);
    out.push(text.slice(nl + 1, end)); // nl === -1 → slice(0, end) = the first line
    end = nl;                          // nl === -1 → end becomes -1 → loop ends
  }
  return out.reverse();
}

// Read the last `maxBytes` bytes of `filePath` (size known) as utf8 via a Buffer — bounded memory,
// never a >maxBytes string. Drops the partial leading line when we started mid-file.
function readTailText(filePath, size, maxBytes) {
  const start = Math.max(0, size - maxBytes);
  const len = size - start;
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.allocUnsafe(len);
    let off = 0;
    while (off < len) {
      const n = fs.readSync(fd, buf, off, len - off, start + off);
      if (n <= 0) break;
      off += n;
    }
    let text = buf.toString('utf8', 0, off); // bounded to bytes actually read
    if (start > 0) {
      const nl = text.indexOf('\n');
      text = nl === -1 ? '' : text.slice(nl + 1); // drop the partial first line (+ any split leading char)
    }
    return text;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Read a JSONL file → array of parsed records, bounded by byte-size + record-count. Advisory: never
 * throws. On an oversized file, returns the NEWEST records (tail read). See the module header.
 *
 * @param {string} filePath
 * @param {object} [opts] { maxRecords?, maxBytes?, name? }
 * @returns {object[]}
 */
function readJsonlBounded(filePath, opts) {
  const o = opts || {};
  const maxRecords = (typeof o.maxRecords === 'number' && o.maxRecords > 0) ? o.maxRecords : DEFAULT_MAX_RECORDS;
  let maxBytes = (typeof o.maxBytes === 'number' && Number.isFinite(o.maxBytes) && o.maxBytes > 0) ? o.maxBytes : DEFAULT_MAX_BYTES;
  maxBytes = Math.min(maxBytes, HARD_MAX_BYTES); // M-1: a bad caller can shrink, never disable, the bound
  const name = o.name || 'jsonl-read';

  let size;
  try {
    size = fs.statSync(filePath).size;
  } catch (err) {
    // ENOENT (no ledger yet) → quietly empty. Any other stat error → warn (don't vanish silently).
    if (!err || err.code !== 'ENOENT') {
      warn(name, `ledger stat failed (${(err && (err.code || err.message)) || 'unknown'}) — treating as empty (advisory)`);
    }
    return [];
  }

  let text;
  try {
    if (size > maxBytes) {
      warn(name, `ledger ${fmtBytes(size)} exceeds the ${fmtBytes(maxBytes)} read bound — reading the newest tail only (advisory; older records not loaded)`);
      text = readTailText(filePath, size, maxBytes);
    } else {
      text = fs.readFileSync(filePath, 'utf8'); // size ≤ maxBytes ≤ 256MB → string under the ceiling
    }
  } catch (err) {
    // A real read error (permission; a race where it grew past the ceiling between stat + read) →
    // warn + empty. Advisory: never crash the caller.
    warn(name, `ledger unreadable (${(err && (err.code || err.message)) || 'unknown'}) — treating as empty (advisory)`);
    return [];
  }

  // Cap the record count by a backward scan (NOT split()+slice — the H-1 memory blowup) → parse.
  return lastLines(text, maxRecords)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

module.exports = { readJsonlBounded, readTailText, lastLines, DEFAULT_MAX_BYTES, HARD_MAX_BYTES, DEFAULT_MAX_RECORDS };
