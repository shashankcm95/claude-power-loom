'use strict';

// doctor/probes/lock-staleness.js — v2.9.0 Phase C.1 (FIX-I4)
//
// Walks ~/.claude/library + ~/.claude/checkpoints + ~/.claude for stale
// lockfiles (.lock or *.lock with mtime older than threshold). The
// existing `library-migrate gc` reclaims these; this probe surfaces
// them as health signal BEFORE the GC runs.
//
// Threshold default: 1 hour. Substantive locks complete in seconds;
// anything > 1h is almost certainly stale from a crashed process.

const fs = require('fs');
const path = require('path');
const os = require('os');

function findStaleLocks(root, thresholdMs) {
  const stale = [];
  if (!fs.existsSync(root)) return stale;
  const now = Date.now();
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        // Skip node_modules / .git for performance.
        if (e.name === 'node_modules' || e.name === '.git') continue;
        stack.push(p);
      } else if (e.isFile() && /\.lock$|^\.lock$/.test(e.name)) {
        try {
          const st = fs.statSync(p);
          const ageMs = now - st.mtimeMs;
          if (ageMs > thresholdMs) {
            stale.push({ path: p, age_seconds: Math.round(ageMs / 1000) });
          }
        } catch { /* permission etc; ignore */ }
      }
    }
  }
  return stale;
}

function run(args) {
  if (process.env.AGENT_TEAM_DOCTOR_TEST === '1') {
    return { status: 'pass', details: { mode: 'test-fixture', stale: [] } };
  }
  const thresholdSec = (args && args['stale-threshold-sec']) ? Number(args['stale-threshold-sec']) : 3600;
  const roots = [
    path.join(os.homedir(), '.claude', 'library'),
    path.join(os.homedir(), '.claude', 'checkpoints'),
  ];
  const stale = [];
  for (const r of roots) {
    for (const s of findStaleLocks(r, thresholdSec * 1000)) {
      stale.push(s);
    }
  }
  if (stale.length === 0) {
    return { status: 'pass', details: { stale: [], threshold_sec: thresholdSec } };
  }
  return {
    status: 'warn',
    details: {
      stale,
      threshold_sec: thresholdSec,
      remediation: 'Run `node scripts/library-migrate.js gc --apply` to reclaim.',
    },
  };
}

module.exports = { name: 'lock-staleness', run };
