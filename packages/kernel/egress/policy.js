'use strict';

// @loom-layer: kernel
//
// ③.2.1b PR-B — egress POLICY gates: a GLOBAL per-window emission cap, 429/abuse backpressure, and a
// one-PR-per-issue etiquette ledger. All state lives in CUSTODY-owned files threaded through emitPR's opts
// (exactly like PR-A's custodyTokenPath) — NEVER derived from the actor-influenced `data`. The
// actor-supplied (repo, issueRef) is used ONLY as a canonicalized lookup KEY after it has been validated.
// These gates run INSIDE emitPR's withLockSoft critical section (shared-state read-modify-write).

const fs = require('fs');
const crypto = require('crypto');

const DEFAULT_PER_WINDOW_CAP = 5;
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;       // 24h rolling window
const DEFAULT_BACKPRESSURE_THRESHOLD = 3;            // consecutive in-window 429/abuse responses -> halt

// Atomic write (temp + rename) so a crash mid-write cannot corrupt the custody state (the gates run under
// the lock, but a partial JSON would fail-closed all subsequent reads).
// Collision-proof temp name (a random suffix, not pid+len) + orphan cleanup if the rename fails
// (EXDEV/perms) so a failed write leaves no stray .tmp (VALIDATE-hacker/reviewer). These run under the
// egress lock (emitPR's withLockSoft), so there is no concurrent race on the target.
function writeAtomic(p, data) {
  const tmp = `${p}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  fs.writeFileSync(tmp, data);
  try { fs.renameSync(tmp, p); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* best-effort */ } throw e; }
}

// --------------------------------------------------------------------------
// Per-window cap (GLOBAL — counts ALL emits in the window; varying the key cannot multiply the budget).
// --------------------------------------------------------------------------

function readCapState(statePath) {
  try {
    const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (s && typeof s.windowStart === 'number' && typeof s.count === 'number') return s;
  } catch { /* missing/corrupt -> fresh */ }
  return { windowStart: 0, count: 0 };
}

/** Pure read: is the GLOBAL emission budget for the current window exhausted? */
function capExceeded(statePath, { now = Date.now(), perWindowCap = DEFAULT_PER_WINDOW_CAP, windowMs = DEFAULT_WINDOW_MS } = {}) {
  const s = readCapState(statePath);
  const count = (now - s.windowStart) < windowMs ? s.count : 0;   // a rolled window resets the count
  return count >= perWindowCap;
}

/** Increment the window counter (read-modify-write). Called ONLY on a real emit (③.2.3). Returns the new count. */
function recordEmit(statePath, { now = Date.now(), windowMs = DEFAULT_WINDOW_MS } = {}) {
  const s = readCapState(statePath);
  const next = (now - s.windowStart) < windowMs
    ? { windowStart: s.windowStart, count: s.count + 1 }
    : { windowStart: now, count: 1 };
  writeAtomic(statePath, JSON.stringify(next));
  return next.count;
}

// --------------------------------------------------------------------------
// 429/abuse backpressure (consumed at ③.2.3; the logic is unit-tested here in isolation).
// --------------------------------------------------------------------------

function isRateLimited(status) { return status === 429 || status === 403; } // 403 = GitHub secondary/abuse limit

/** True iff the last `threshold` responses are ALL rate-limit/abuse — the signal to halt emission. */
function backpressureHalts(recentStatuses, threshold = DEFAULT_BACKPRESSURE_THRESHOLD) {
  if (!Array.isArray(recentStatuses) || recentStatuses.length < threshold) return false;
  return recentStatuses.slice(-threshold).every(isRateLimited);
}

// --------------------------------------------------------------------------
// Etiquette ledger — one PR per CANONICAL (repo, issue) key.
// --------------------------------------------------------------------------

/** Canonicalize so `Owner/Repo.git` + `#7` and `owner/repo` + `7` collapse to ONE key (no bypass-by-casing). */
function etiquetteKey(repo, issueRef) {
  const [owner = '', name = ''] = String(repo == null ? '' : repo).split('/');
  const cleanName = name.replace(/\.git$/i, '');
  const issue = Number(String(issueRef == null ? '' : issueRef).replace(/^#/, ''));
  return `${owner.toLowerCase()}/${cleanName.toLowerCase()}#${issue}`;
}

function readLedger(ledgerPath) {
  try { return new Set(fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean)); } catch { return new Set(); }
}

/** Has this canonical (repo, issue) already been emitted? */
function alreadyEmitted(ledgerPath, key) { return readLedger(ledgerPath).has(key); }

/** Append the key (idempotent). Called ONLY on a real emit (③.2.3). Returns true if newly added. */
function recordEmitted(ledgerPath, key) {
  const led = readLedger(ledgerPath);
  if (led.has(key)) return false;
  led.add(key);
  writeAtomic(ledgerPath, `${[...led].join('\n')}\n`);
  return true;
}

module.exports = {
  // isRateLimited is intentionally NOT exported — it is an internal detail of backpressureHalts, the public surface.
  capExceeded, recordEmit, backpressureHalts,
  etiquetteKey, alreadyEmitted, recordEmitted,
  DEFAULT_PER_WINDOW_CAP, DEFAULT_WINDOW_MS, DEFAULT_BACKPRESSURE_THRESHOLD,
};
