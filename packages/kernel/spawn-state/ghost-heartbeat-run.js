'use strict';

// packages/kernel/spawn-state/ghost-heartbeat-run.js
//
// Ghost Heartbeat W2-PR3a — the background DRAIN RUNNER. Invoked by a scheduler
// (cron / launchd, PR-3b) or manually. When opted in and not killed, it discovers
// session transcripts under ~/.claude/projects, audits the ones whose content is NEW
// since it last saw them (bounded, fail-open, idempotent), and emits drift via the
// existing producer. The GUARANTEED unattended heartbeat — and the backstop for the
// PR-2 Stop-hook carrier (whose detached child may be reaped).
//
// Correctness vs cost (two layers): the producer's emitted-set (ghost-heartbeat-
// state.js, keyed by the in-transcript content sessionId) is the IDEMPOTENCY /
// correctness boundary — re-auditing never double-emits. This runner's per-path
// `audited[path] = mtimeMs` map is ONLY a COST optimization (skip re-judging a
// transcript whose mtime has not advanced). A lossy / reset / poisoned audited map
// can only WASTE a judge call, never miss a real drift.
//
// Security (VERIFY board): killswitch+opt-in FIRST (before any FS read); discovery
// rejects symlinks / FIFOs / non-regular files via lstat NO-FOLLOW (CWE-22 confused
// deputy + FIFO hang); the run-state read is FIFO-safe (withRegularFileFd) and its
// values are numeric-validated (an Infinity/string poison would make the skip-gate
// `>=` true forever — silent denial-of-monitoring); the caps are clamped (NaN /
// negative / huge would silently disable them); every write + the CLI fail open.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { withRegularFileFd } = require('../_lib/safe-read');
const { writeAtomic } = require('../_lib/atomic-write');
const { auditTranscript } = require('./drift-audit');

const HOME = os.homedir();
const DEFAULT_PROJECTS_DIR = path.join(HOME, '.claude', 'projects');
const DEFAULT_RUN_STATE_PATH = path.join(HOME, '.claude', 'checkpoints', 'ghost-heartbeat-run.json');
const RUN_STATE_VERSION = 1;

// Whole-digit env int, clamped to [min, max]. Rejects '', 'garbage', '0x10', '-1',
// '1e9' -> default; clamps an in-range parse so a huge value cannot remove the cap
// and a tiny one cannot zero it (use the killswitch to disable, not a 0 cap).
function envIntClamped(name, def, min, max) {
  const s = (process.env[name] || '').trim();
  if (!/^\d+$/.test(s)) return def;
  return Math.min(max, Math.max(min, parseInt(s, 10)));
}

// FIFO-safe + numeric-validated run-state read. withRegularFileFd opens O_NONBLOCK +
// fstat + reads from the bound fd (a FIFO at the path would hang a raw readFileSync
// forever). Each audited[path] is an mtime-ms and MUST be a finite number in
// [0, now + 1 day] — drop anything else. A bare `Number.isFinite && >= 0` is NOT
// enough: Infinity -> JSON `null` (dropped by typeof), a numeric STRING -> dropped by
// isFinite, BUT a huge FINITE number (1e308, valid JSON) would satisfy the skip-gate
// `>=` forever (silent denial-of-monitoring); an mtime cannot be far in the future,
// so the ceiling rejects it. Own-enumerable keys only (Object.entries).
function loadRunState(statePath) {
  const parsed = withRegularFileFd(statePath, (fd) => JSON.parse(fs.readFileSync(fd, 'utf8')), null);
  const ceiling = Date.now() + 86400000; // 1 day of clock-skew slack
  const audited = {};
  if (parsed && typeof parsed === 'object' && parsed.audited
      && typeof parsed.audited === 'object' && !Array.isArray(parsed.audited)) {
    for (const [k, v] of Object.entries(parsed.audited)) {
      if (Number.isFinite(v) && v >= 0 && v <= ceiling) audited[k] = v;
    }
  }
  return { audited };
}

// Discover candidate transcripts: <projectsDir>/<proj>/<sid>.jsonl, newest-first.
// lstat NO-FOLLOW at BOTH levels rejects a symlinked project dir / a symlinked or
// FIFO .jsonl — a symlink would feed an out-of-tree path to the judge (CWE-22), a
// FIFO would be a non-regular file. Fail-open: a missing projectsDir -> []; one bad
// entry (vanished file / unreadable dir) is skipped, never aborts the scan.
function discover(projectsDir) {
  let projs;
  try { projs = fs.readdirSync(projectsDir); } catch { return []; }
  const out = [];
  for (const proj of projs) {
    const pp = path.join(projectsDir, proj);
    try { if (!fs.lstatSync(pp).isDirectory()) continue; } catch { continue; }
    let files;
    try { files = fs.readdirSync(pp); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const fp = path.join(pp, f);
      try {
        const st = fs.lstatSync(fp);
        if (!st.isFile()) continue; // symlink / FIFO / dir -> never reaches the judge
        out.push({ path: fp, mtimeMs: st.mtimeMs });
      } catch { continue; }
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

// Keep only audited[] entries whose transcript is still present this run (cost-opt
// hygiene). Pruning against a partially-failed discovery can drop a still-valid entry
// -> that transcript is re-audited next run (a wasted judge call; the emitted-set
// prevents any double-emit). Bounded and tolerable.
function prune(audited, cands) {
  const present = new Set(cands.map((c) => c.path));
  const out = {};
  for (const [k, v] of Object.entries(audited)) {
    if (present.has(k)) out[k] = v;
  }
  return out;
}

// The drain. killswitch + opt-in FIRST. Sequential audits, bounded by a clamped count
// cap AND a wall-clock budget (the budget gates LAUNCH; a synchronous in-flight audit
// runs to its own 60s timeout). Per-session fail-open. Always returns; never throws.
function runHeartbeat({ projectsDir, statePath, auditFn, now = Date.now, log = () => {} } = {}) {
  if (process.env.GHOST_HEARTBEAT_DISABLED === '1') return { ok: false, reason: 'killswitch', audited: [] };
  if (process.env.GHOST_HEARTBEAT_EMIT !== '1') return { ok: false, reason: 'opt-out', audited: [] };

  const pdir = projectsDir || process.env.GHOST_HEARTBEAT_PROJECTS_DIR || DEFAULT_PROJECTS_DIR;
  const spath = statePath || process.env.GHOST_HEARTBEAT_RUN_STATE || DEFAULT_RUN_STATE_PATH;
  const audit = auditFn || ((o) => auditTranscript(o));
  const maxN = envIntClamped('GHOST_HEARTBEAT_MAX_SESSIONS_PER_RUN', 20, 1, 500);
  const budget = envIntClamped('GHOST_HEARTBEAT_RUN_BUDGET_MS', 240000, 1000, 600000);

  const cands = discover(pdir);
  const state = loadRunState(spath);
  const start = now();
  const done = [];
  let attempts = 0; // cap counts ATTEMPTS (cost), so a failing session can't be retried unboundedly within a run
  const nextAudited = { ...state.audited };

  for (const c of cands) {
    if (attempts >= maxN) break;
    if (now() - start >= budget) break;                         // stop launching; an in-flight audit finishes
    // mtime is monotonic for append-only transcripts; a same-ms rewrite self-heals
    // next run (and the emitted-set prevents any double-emit regardless).
    if ((state.audited[c.path] || 0) >= c.mtimeMs) continue;    // skip unchanged (no attempt, no cost)
    attempts += 1;
    try {
      audit({ transcriptPath: c.path });
      nextAudited[c.path] = c.mtimeMs;                          // record ONLY on success -> a throwing audit is RETRIED next run
      done.push(c.path);
    } catch (e) {
      log('audit-error', { path: c.path, msg: e && e.message }); // per-session fail-open; NOT recorded -> retried
    }
  }

  try {
    writeAtomic(spath, { version: RUN_STATE_VERSION, audited: prune(nextAudited, cands), lastRunAt: new Date(now()).toISOString() });
  } catch (e) {
    log('run-state-write-error', { msg: e && e.message }); // writeAtomic can throw (disk full) -> fail-open
  }
  return { ok: true, audited: done, scanned: cands.length };
}

module.exports = {
  runHeartbeat, discover, loadRunState, prune, envIntClamped,
  DEFAULT_PROJECTS_DIR, DEFAULT_RUN_STATE_PATH, RUN_STATE_VERSION,
};

if (require.main === module) {
  try {
    const res = runHeartbeat({
      log: (e, d) => process.stderr.write(`[ghost-heartbeat-run] ${e} ${d !== undefined ? JSON.stringify(d) : ''}\n`),
    });
    process.stdout.write(`${JSON.stringify(res)}\n`);
  } catch (e) {
    process.stderr.write(`[ghost-heartbeat-run] fatal ${e && e.message}\n`);
  }
  process.exit(0); // advisory runner: ALWAYS exit 0 (a scheduler must not see a failure)
}
