'use strict';

// @loom-layer: lab
//
// VC-W1a — the advisory verify sidecar (SHADOW). A candidate-id-keyed store under a DEDICATED dir,
// NOT any trust-axis store: the verify verdict is a QUALITY signal that must NEVER reach a lab weight /
// world_anchored / reputation / verdict-attestation / LIVE_SOURCES (OQ-NS-6). That disjointness is
// enforced structurally by trust-axis-exclusion.test.js; this store deliberately imports nothing from
// those lanes and writes only its own dir.
//
// Env-pinned default dir (SCAR #9 — a test that omits an injected dir must not write the REAL store):
// LOOM_VERIFY_SIDECAR_DIR is read at module load; a test pins it to a tmp dir BEFORE requiring this.
// Reads are immutable (frozen). The record carries ONLY quality fields — no weight/trust field exists.

const fs = require('fs');
const path = require('path');
const os = require('os');

// The candidate id is a filename segment — a strict leading-alnum token bars path traversal (`..`
// starts with `.`, so it fails the leading `[A-Za-z0-9]`) and any `/` (#215 raw-segment trap).
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const DEFAULT_DIR = process.env.LOOM_VERIFY_SIDECAR_DIR
  || path.join(os.homedir(), '.claude', 'verify-container-shadow');

// A per-process monotonic suffix so a temp name never collides within a process (the atomic write below).
let TMP_SEQ = 0;

function assertSafeId(candidateId) {
  if (typeof candidateId !== 'string' || !SAFE_ID_RE.test(candidateId)) {
    throw new Error(`verify-sidecar: candidateId is not a safe token: ${JSON.stringify(String(candidateId).slice(0, 40))}`);
  }
  return candidateId;
}

function resolveDir(dir) {
  return typeof dir === 'string' && dir.length > 0 ? dir : DEFAULT_DIR;
}

// Record an advisory verify verdict. QUALITY-only fields are stored; there is deliberately no
// weight / score / trust field to store (the verdict is never a trust input).
function recordVerify(dir, { candidateId, base_sha, result_class, passed, reason } = {}) {
  assertSafeId(candidateId);
  const resolved = resolveDir(dir);
  fs.mkdirSync(resolved, { recursive: true });
  const record = {
    candidateId,
    base_sha: typeof base_sha === 'string' ? base_sha : '',
    result_class: typeof result_class === 'string' ? result_class : 'SETUP_FAILURE',
    passed: passed === true ? true : passed === false ? false : null,
    reason: typeof reason === 'string' ? reason : null,
  };
  const file = path.join(resolved, `${candidateId}.json`);
  // Atomic + no-symlink-follow write (the sibling-store convention — world-anchor-store.js et al.):
  // create an EXCLUSIVE temp in the SAME dir (flag 'wx' => O_EXCL refuses to follow/clobber a
  // pre-planted symlink), then rename onto the final name (rename REPLACES the name and never follows a
  // symlink at the destination — a planted `<id>.json` symlink is removed, its target untouched).
  // Overwrite-on-rerun stays supported (unlike a bare 'wx' on the final path), and a crash mid-write
  // can only leave an orphan temp, never a truncated record.
  const tmp = path.join(resolved, `.${candidateId}.${process.pid}.${TMP_SEQ += 1}.tmp`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort temp cleanup */ }
    throw e;
  }
  return { id: candidateId, path: file };
}

// Immutable read-back — a frozen record or null when absent.
function readVerify(dir, candidateId) {
  assertSafeId(candidateId);
  const file = path.join(resolveDir(dir), `${candidateId}.json`);
  // Absent OR corrupt/malformed record reads as absent (a truncated/hand-edited/planted file must not
  // throw at the call site — matches the missing-file contract; the JSON.parse is INSIDE the catch).
  try { return Object.freeze(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return null; }
}

module.exports = { recordVerify, readVerify, assertSafeId, resolveDir, DEFAULT_DIR, SAFE_ID_RE };
