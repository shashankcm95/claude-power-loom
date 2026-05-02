// Shared file-lock primitive for HETS scripts. Closes 2 CS-1 CRITs in one
// place: kb-resolver + budget-tracker concurrency hazards (per CS-1
// orch-code recommendation #1).
//
// Extraction note: this code was originally inline in agent-identity.js
// (since H.2-bridge) and pattern-recorder.js (since H.1, slight variant).
// H.3.2 unifies both copies + applies the wrapper to 3 more scripts that
// were doing read-modify-write without locks (kb-resolver, budget-tracker,
// tree-tracker — flagged by code-reviewer.nova X-3 in CS-1).
//
// Usage:
//   const { withLock } = require('./_lib/lock');
//   withLock(LOCK_PATH, () => {
//     const data = readStore();
//     data.someField += 1;
//     writeStore(data);
//   });
//
// Stale-lock recovery: if the lock file holds a PID that's no longer alive,
// the wait loop unlinks it and retries. Same logic as the original
// agent-identity implementation.

const fs = require('fs');

function acquireLock(lockPath, opts) {
  const maxWaitMs = (opts && opts.maxWaitMs) || 3000;
  const sleepMs = (opts && opts.sleepMs) || 50;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      return true;
    } catch {
      // Stale lock recovery: if the locking pid is gone, take it over.
      try {
        const pid = parseInt(fs.readFileSync(lockPath, 'utf8'), 10);
        if (pid && !Number.isNaN(pid) && pid !== process.pid) {
          try { process.kill(pid, 0); } // throws if pid is gone
          catch { try { fs.unlinkSync(lockPath); } catch {} continue; }
        } else if (Number.isNaN(pid)) {
          // Garbage in lock file → assume corrupt + reclaim
          try { fs.unlinkSync(lockPath); } catch {}
          continue;
        }
      } catch { /* lock disappeared between check and read */ }
      const end = Date.now() + sleepMs;
      while (Date.now() < end) {} // brief busy-wait
    }
  }
  return false;
}

function releaseLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
}

// Convenience wrapper that acquires + runs + releases. Exits with code 2
// if lock cannot be acquired within timeout (matches the original
// agent-identity behavior).
function withLock(lockPath, fn, opts) {
  if (!acquireLock(lockPath, opts)) {
    console.error(`Could not acquire lock at ${lockPath} within ${(opts && opts.maxWaitMs) || 3000}ms. Aborting.`);
    process.exit(2);
  }
  try { return fn(); } finally { releaseLock(lockPath); }
}

module.exports = { acquireLock, releaseLock, withLock };
