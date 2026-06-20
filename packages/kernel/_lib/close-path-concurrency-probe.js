'use strict';

// ③.2.0-B (ARCH-PC-4): a concurrency probe for the SHARED withLockSoft primitive that backs the
// close-path / catalog-write hooks. It forks N REAL OS processes — a single-process async loop
// self-serializes on the event loop and would NEVER contend on the wx-flag lock (the false-0%-drop
// trap the VERIFY architect flagged), so a faithful drop-rate measurement REQUIRES separate processes
// (the lock's own T108 precedent forked children too).
//
// HONEST LABEL (the VERIFY re-target): this measures the `withLockSoft` PRIMITIVE's contention — the
// lock that backs `catalog-reconcile-write` (a PostToolUse hook) and the K13 serial path. It does NOT
// drive the close-resolver itself, whose K13 lock is SHADOW-STUBBED to a no-op (spawn-close-resolver
// injects no-op K13 seams in shadow mode — the ③.1 finding), so there is no close-path drop-rate to
// measure in the default mode. The number here is the primitive's, labeled as such — never dressed up
// as "the close hook's lock."
//
// Run `node packages/kernel/_lib/close-path-concurrency-probe.js` for the ARCH-PC-4 measurement.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { withLockSoft } = require('./lock');

// The harness hook-timeout budget the close path must stay under (ARCH-PC-4's assertion target).
const CLOSE_HOOK_BUDGET_MS = 10000;

// One child: `ops` lock cycles on the shared lock (an instant critical section — the cost being
// measured is acquisition contention); tally {attempts, acquired, dropped}; write it to outFile.
function runChildTally(lockPath, ops, maxWaitMs, outFile) {
  let acquired = 0;
  let dropped = 0;
  for (let i = 0; i < ops; i++) {
    const r = withLockSoft(lockPath, () => 0, { maxWaitMs });
    if (r.ok) acquired += 1; else dropped += 1;
  }
  fs.writeFileSync(outFile, JSON.stringify({ attempts: ops, acquired, dropped }));
}

/**
 * Fork `processes` OS processes each hammering a shared withLockSoft lock `opsPerProcess` times;
 * aggregate the soft-fail DROP-RATE + the per-op WALL-TIME. Returns a labeled measurement record.
 * @param {{processes?:number, opsPerProcess?:number, maxWaitMs?:number, stateDir?:string}} [o]
 * @returns {Promise<object>}
 */
async function measureLockContention({ processes = 4, opsPerProcess = 25, maxWaitMs = 3000, stateDir } = {}) {
  // Ephemeral state dir — NEVER the real ~/.claude state (a parallel real session could be writing it).
  // VALIDATE MED: clean up a SELF-created dir in a finally (the `require.main` diagnostic run leaked one
  // temp dir per call; a caller-supplied stateDir is the caller's to clean).
  const selfCreated = !stateDir;
  const dir = stateDir || fs.mkdtempSync(path.join(os.tmpdir(), 'loom-archpc4-'));
  try {
    const lockPath = path.join(dir, 'probe.lock');
    const start = Date.now();
    const children = Array.from({ length: processes }, (_unused, k) => {
      const outFile = path.join(dir, `tally-${k}.json`);
      return new Promise((resolve) => {
        const cp = spawn(process.execPath, [__filename, '--child', lockPath, String(opsPerProcess), String(maxWaitMs), outFile], { stdio: 'ignore' });
        cp.on('exit', (code) => resolve({ code, outFile }));
        cp.on('error', () => resolve({ code: -1, outFile }));
      });
    });
    const done = await Promise.all(children);
    const wallMs = Date.now() - start;
    let attempts = 0;
    let acquired = 0;
    let dropped = 0;
    for (const { outFile } of done) {
      try {
        const t = JSON.parse(fs.readFileSync(outFile, 'utf8'));
        attempts += t.attempts; acquired += t.acquired; dropped += t.dropped;
      } catch { /* a child that didn't write its tally is surfaced via all_children_ok below */ }
    }
    return {
      seam: 'withLockSoft primitive (close-path/catalog-write lock); NOT the shadow-stubbed K13 close-resolver lock',
      processes,
      ops_per_process: opsPerProcess,
      max_wait_ms: maxWaitMs,
      attempts,
      acquired,
      dropped,
      drop_rate: attempts ? dropped / attempts : 0,
      wall_ms: wallMs,
      per_op_ms: attempts ? wallMs / attempts : 0,
      all_children_ok: done.every((d) => d.code === 0),
      within_close_hook_budget: wallMs < CLOSE_HOOK_BUDGET_MS,
    };
  } finally {
    if (selfCreated) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } }
  }
}

module.exports = { measureLockContention, runChildTally, CLOSE_HOOK_BUDGET_MS };

// --child <lockPath> <ops> <maxWaitMs> <outFile>  (the forked worker)
// (no args)                                       (the ARCH-PC-4 measurement run)
if (require.main === module) {
  const [flag, lockPath, ops, maxWaitMs, outFile] = process.argv.slice(2);
  if (flag === '--child') {
    runChildTally(lockPath, Number(ops), Number(maxWaitMs), outFile);
  } else {
    measureLockContention({ processes: 8, opsPerProcess: 50, maxWaitMs: 3000 })
      .then((m) => { process.stdout.write(`${JSON.stringify(m, null, 2)}\n`); });
  }
}
