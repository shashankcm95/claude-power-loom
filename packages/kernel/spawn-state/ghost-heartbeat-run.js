'use strict';

// packages/kernel/spawn-state/ghost-heartbeat-run.js
//
// Ghost Heartbeat W2-PR3a — the background DRAIN RUNNER. Invoked by a scheduler
// (cron / launchd, PR-3b) or manually. When opted in and not killed, it discovers
// session transcripts under ~/.claude/projects, audits the ones whose content is NEW
// since it last saw them (bounded, fail-open, idempotent), and emits drift via the
// existing producer. The unattended drain path (the real runner-to-judge end-to-end is gated to a post-install dogfood) — and the backstop for the
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
const { envInt } = require('../_lib/env-int');
const { auditTranscript } = require('./drift-audit');
const { pruneEmittedState, DEFAULT_STATE_PATH: DEFAULT_EMITTED_STATE_PATH } = require('./ghost-heartbeat-state');
const { markerDir } = require('../hooks/lifecycle/ghost-heartbeat-stop');

const HOME = os.homedir();
const DEFAULT_PROJECTS_DIR = path.join(HOME, '.claude', 'projects');
const DEFAULT_RUN_STATE_PATH = path.join(HOME, '.claude', 'checkpoints', 'ghost-heartbeat-run.json');
// PR-B marker grammar: markerPathFor writes sha256(path).slice(0,16) + '.json'. The
// sweep unlinks ONLY names matching this — a foreign / traversal name in a (possibly
// env-mis-pointed) markerDir is never deleted (VERIFY board hack-LOW).
const MARKER_NAME_RE = /^[0-9a-f]{16}\.json$/;
const MAX_CAPTURE_FAILURES = 1000000; // captureFailures poison ceiling (R13 rigor)
// Per-path captured-sid keyset cap. A real transcript references a handful of sessions
// (compaction rotation); this bounds the on-disk cost-map against a crafted transcript
// AND bounds the monotonic union (a sid once captured for a path is never dropped, to
// survive >8MB tail-truncation) so the union cannot grow without limit.
const MAX_KEYSET_PER_PATH = 256;
// A home-readable touch-file killswitch (PR-3b, VERIFY hacker MED #12): the env
// killswitch (GHOST_HEARTBEAT_DISABLED) is INERT for a launchd/cron task -- the
// scheduled minimal env does NOT source the user's shell profile, so a user who
// exported the var to "turn it off" still has the SCHEDULED run firing. The scheduled
// process CAN read $HOME, so `touch ~/.claude/checkpoints/ghost-heartbeat.disabled`
// is the off-switch that works for BOTH the interactive and the scheduled path.
const DEFAULT_KILLSWITCH_FILE = path.join(HOME, '.claude', 'checkpoints', 'ghost-heartbeat.disabled');
const RUN_STATE_VERSION = 1;

// Whole-digit env int, clamped to [min, max]. The impl is now the canonical `_lib/env-int` (this is a
// thin arg-shape adapter kept for the local 4-arg call sites + the exported test surface): rejects '',
// 'garbage', '0x10', '-1', '1e9' -> default; clamps an in-range parse so a huge value cannot remove the
// cap and a tiny one cannot zero it (use the killswitch to disable, not a 0 cap).
function envIntClamped(name, def, min, max) {
  return envInt(name, def, { min, max });
}

// FIFO-safe + numeric-validated run-state read. withRegularFileFd opens O_NONBLOCK +
// fstat + reads from the bound fd (a FIFO at the path would hang a raw readFileSync
// forever). Each audited[path] is an mtime-ms and MUST be a finite number in
// [0, now + 1 day] — drop anything else. A bare `Number.isFinite && >= 0` is NOT
// enough: Infinity -> JSON `null` (dropped by typeof), a numeric STRING -> dropped by
// isFinite, BUT a huge FINITE number (1e308, valid JSON) would satisfy the skip-gate
// `>=` forever (silent denial-of-monitoring); an mtime cannot be far in the future,
// so the ceiling rejects it. Own-enumerable keys only (Object.entries).
// audited[path] is one of (PR-B tri-state):
//   - a bare finite mtime NUMBER (legacy / pre-PR-B) -> "never captured a sid";
//     force-re-audited + blocks prune-completeness until resolved (self-heals on the
//     first successful re-audit -> the object form forever).
//   - { mtimeMs:<finite>, sessionIds:string[] } -> the FULL present sid-set captured at
//     that mtime (an empty array = a no-session-id transcript: resolved, contributes
//     nothing, does NOT block). A non-array sessionIds normalizes to [] (keep the
//     mtime anchor; never drop a valid entry as poison — VERIFY board CR-LOW).
// Anything else -> dropped (R13 poison: a huge-finite / numeric-string / null value).
function sanitizeAudited(raw, ceiling) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (Number.isFinite(v) && v >= 0 && v <= ceiling) { out[k] = v; continue; } // legacy bare number
    if (v && typeof v === 'object' && !Array.isArray(v)
        && Number.isFinite(v.mtimeMs) && v.mtimeMs >= 0 && v.mtimeMs <= ceiling) {
      const sessionIds = (Array.isArray(v.sessionIds) ? v.sessionIds.filter((s) => typeof s === 'string' && s) : []).slice(0, MAX_KEYSET_PER_PATH);
      out[k] = { mtimeMs: v.mtimeMs, sessionIds };
    }
  }
  return out;
}

// captureFailures[path] = consecutive throwing-audit count (a never-captured path stops
// blocking prune-completeness once it reaches CAPTURE_GRACE). Numeric-validated with the
// same rigor as audited (a forged huge value would not change correctness here — it only
// stops blocking SOONER, which is bounded-safe — but keep the type discipline).
function sanitizeCaptureFailures(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (Number.isInteger(v) && v >= 0 && v <= MAX_CAPTURE_FAILURES) out[k] = v;
  }
  return out;
}

function entryMtime(entry) {
  if (typeof entry === 'number') return entry;
  if (entry && typeof entry === 'object' && Number.isFinite(entry.mtimeMs)) return entry.mtimeMs;
  return 0;
}
function isCaptured(entry) { return !!(entry && typeof entry === 'object' && Array.isArray(entry.sessionIds)); }

function loadRunState(statePath) {
  const parsed = withRegularFileFd(statePath, (fd) => JSON.parse(fs.readFileSync(fd, 'utf8')), null);
  const ceiling = Date.now() + 86400000; // 1 day of clock-skew slack
  const p = (parsed && typeof parsed === 'object') ? parsed : {};
  return { audited: sanitizeAudited(p.audited, ceiling), captureFailures: sanitizeCaptureFailures(p.captureFailures) };
}

// Discover candidate transcripts: <projectsDir>/<proj>/<sid>.jsonl, newest-first.
// lstat NO-FOLLOW at BOTH levels rejects a symlinked project dir / a symlinked or
// FIFO .jsonl — a symlink would feed an out-of-tree path to the judge (CWE-22), a
// FIFO would be a non-regular file. Fail-open: a missing projectsDir -> []; one bad
// entry (vanished file / unreadable dir) is skipped, never aborts the scan.
// Returns { candidates, discoveryComplete }. discoveryComplete is false if ANY
// project-dir readdir/lstat threw (a transiently-unreadable dir, e.g. an NFS outage or
// a chmod) — those transcripts vanish from the scan, so PR-B must DEFER the prune that
// run rather than count their sessions falsely-absent (VERIFY board hack-MED). A
// per-file lstat error (a single vanished file) is NOT a discovery failure — it is a
// genuine absence the existing cost-map prune already handles.
function discover(projectsDir) {
  let projs;
  try { projs = fs.readdirSync(projectsDir); } catch { return { candidates: [], discoveryComplete: false }; }
  const out = [];
  let discoveryComplete = true;
  for (const proj of projs) {
    const pp = path.join(projectsDir, proj);
    try { if (!fs.lstatSync(pp).isDirectory()) continue; } catch { discoveryComplete = false; continue; }
    let files;
    try { files = fs.readdirSync(pp); } catch { discoveryComplete = false; continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const fp = path.join(pp, f);
      try {
        const st = fs.lstatSync(fp);
        if (!st.isFile()) continue; // symlink / FIFO / dir -> never reaches the judge
        out.push({ path: fp, mtimeMs: st.mtimeMs });
      } catch { continue; } // a single vanished file is a genuine absence, not a discovery gap
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { candidates: out, discoveryComplete };
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

// Bounded GC for the Stop-hook's debounce markers (no consumer; the producer's emitted-set
// is the correctness floor, so losing a marker costs AT MOST one extra debounced spawn, and
// that spawn does NOT re-emit because the emitted-set still de-dups). Two eviction paths:
//   - AGE: effectiveTtl = max(ttlMs, floorMs) floors the age threshold to the emitted-set
//     prune floor, so the AGE path never GCs a marker younger than an emitted entry could be
//     pruned (the decoupling the prune floor needs).
//   - keep-newest: an anti-runaway BACKSTOP — with > keepNewest live markers it CAN evict an
//     older still-emitted one (age-independent). That is bounded + safe (one extra debounced
//     spawn, no re-emit), NOT an unconditional "marker always outlives its entry" guarantee.
// Unlinks ONLY marker-grammar names, ONLY regular files (lstat NO-FOLLOW), re-lstat'd
// immediately before unlink (TOCTOU), fail-open per file. Returns { swept }.
function sweepMarkers({ dir, keepNewest, ttlMs, floorMs, now = Date.now } = {}) {
  const effectiveTtl = Math.max(ttlMs, floorMs);
  let names;
  try { names = fs.readdirSync(dir); } catch { return { swept: [] }; }
  const tnow = now();
  const entries = [];
  for (const name of names) {
    if (!MARKER_NAME_RE.test(name)) continue;            // allowlist the marker grammar
    const p = path.join(dir, name);
    try {
      const st = fs.lstatSync(p);                          // NO-FOLLOW
      if (!st.isFile()) continue;                          // symlink / dir / FIFO -> never unlink
      entries.push({ path: p, mtimeMs: st.mtimeMs });
    } catch { continue; }
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);          // newest-first
  const swept = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const tooOld = e.mtimeMs < tnow - effectiveTtl;
    const overCount = i >= keepNewest;
    if (!tooOld && !overCount) continue;
    try {
      const st = fs.lstatSync(e.path);                     // re-lstat: a swap to a symlink between collect + unlink
      if (!st.isFile()) continue;
      fs.unlinkSync(e.path);
      swept.push(e.path);
    } catch { /* fail-open per file */ }
  }
  return { swept };
}

// The drain. killswitch + opt-in FIRST. Sequential audits, bounded by a clamped count
// cap AND a wall-clock budget (the budget gates LAUNCH; a synchronous in-flight audit
// runs to its own judge timeout — GHOST_HEARTBEAT_JUDGE_TIMEOUT_MS, default 120s, clamped
// <=300s, so worst-case wall-clock is budget + one judge timeout). Per-session fail-open.
// Always returns; never throws.
// Presence-only check (lstat NO-FOLLOW, never opens -> can't block on a FIFO): ANY
// node at the path (file / symlink / dir) means "disabled". A stat error means absent.
function killswitchFilePresent(p) {
  try { fs.lstatSync(p); return true; } catch { return false; }
}

function runHeartbeat({ projectsDir, statePath, emittedStatePath, auditFn, now = Date.now, log = () => {}, killswitchFile } = {}) {
  if (process.env.GHOST_HEARTBEAT_DISABLED === '1') return { ok: false, reason: 'killswitch', audited: [] };
  const ksFile = killswitchFile || process.env.GHOST_HEARTBEAT_KILLSWITCH_FILE || DEFAULT_KILLSWITCH_FILE;
  if (killswitchFilePresent(ksFile)) return { ok: false, reason: 'killswitch-file', audited: [] };
  if (process.env.GHOST_HEARTBEAT_EMIT !== '1') return { ok: false, reason: 'opt-out', audited: [] };

  const pdir = projectsDir || process.env.GHOST_HEARTBEAT_PROJECTS_DIR || DEFAULT_PROJECTS_DIR;
  const spath = statePath || process.env.GHOST_HEARTBEAT_RUN_STATE || DEFAULT_RUN_STATE_PATH;
  // The emitted-set (correctness store) path — MUST be the same file the audits write
  // to, else the prune targets the wrong file (VERIFY board CR-HIGH). Defaults to the
  // producer's DEFAULT_STATE_PATH, which auditTranscript also defaults to -> aligned.
  const epath = emittedStatePath || process.env.GHOST_HEARTBEAT_STATE || DEFAULT_EMITTED_STATE_PATH;
  const audit = auditFn || ((o) => auditTranscript(o));
  const maxN = envIntClamped('GHOST_HEARTBEAT_MAX_SESSIONS_PER_RUN', 20, 1, 500);
  const budget = envIntClamped('GHOST_HEARTBEAT_RUN_BUDGET_MS', 240000, 1000, 600000);
  const grace = envIntClamped('GHOST_HEARTBEAT_CAPTURE_GRACE', 3, 1, 100);
  const absentRuns = envIntClamped('GHOST_HEARTBEAT_PRUNE_ABSENT_RUNS', 2, 1, 100);
  const floorMs = envIntClamped('GHOST_HEARTBEAT_PRUNE_FLOOR_MS', 86400000, 3600000, 31536000000);
  const markerKeep = envIntClamped('GHOST_HEARTBEAT_MARKER_KEEP', 1024, 1, 1000000);
  const markerTtl = envIntClamped('GHOST_HEARTBEAT_MARKER_TTL_MS', 604800000, 3600000, 31536000000);

  const { candidates: cands, discoveryComplete } = discover(pdir);
  const state = loadRunState(spath);
  const start = now();
  const done = [];
  let attempts = 0; // cap counts ATTEMPTS (cost), so a failing session can't be retried unboundedly within a run
  let malformed = 0; // count judge-malformed audits so the fail-silent is OBSERVABLE on the durable run-result (VALIDATE hacker M1)
  const nextAudited = { ...state.audited };
  const nextFailures = { ...state.captureFailures };

  for (const c of cands) {
    if (attempts >= maxN) break;
    if (now() - start >= budget) break;                         // stop launching; an in-flight audit finishes
    const prevEntry = state.audited[c.path];
    // Skip ONLY an up-to-date OBJECT entry (a captured sid-set for this content). mtime
    // is monotonic for append-only transcripts. A bare-number / missing (never-captured)
    // entry is force-re-audited so its sid-set gets captured (self-heals the cost-map;
    // the emitted-set prevents any double-emit regardless).
    if (isCaptured(prevEntry) && entryMtime(prevEntry) >= c.mtimeMs) continue;
    attempts += 1;
    try {
      const res = audit({ transcriptPath: c.path });
      const fresh = (res && Array.isArray(res.sessionIds)) ? res.sessionIds.filter((s) => typeof s === 'string' && s) : [];
      // MONOTONIC union with the path's PRIOR captured keyset (VALIDATE hacker HIGH): for an
      // oversized (>8MB) transcript the producer's keyset is TAIL-ONLY, so a sid that scrolled
      // into the truncated head would be lost and wrongly pruned WHILE the file is present.
      // A transcript's referenced-sid set is monotonic in practice -> never DROP a captured sid
      // (default-KEEP / superset-safe; capped to bound the cost-map). `fresh` first so a cap
      // retains the current sids.
      const prevSids = isCaptured(prevEntry) ? prevEntry.sessionIds : [];
      const sessionIds = [...new Set([...fresh, ...prevSids])].slice(0, MAX_KEYSET_PER_PATH);
      nextAudited[c.path] = { mtimeMs: c.mtimeMs, sessionIds }; // object form -> RESOLVED
      delete nextFailures[c.path];
      done.push(c.path);
      // A malformed / continuation judge response is captured (above) but must NOT vanish silently — the
      // whole point of the fix is that it is distinguishable from a genuine no-drift. Surface it.
      if (res && res.reason === 'judge-malformed') { malformed += 1; log('judge-malformed', { path: c.path }); }
    } catch (e) {
      // A throwing audit does NOT advance audited (so it RETRIES next run) but DOES count a
      // capture-failure -> a permanently-throwing present path stops BLOCKING prune-
      // completeness after `grace` attempts, so one un-auditable file cannot starve the prune
      // for the whole emitted-set. A path that throws transiently AFTER a prior emit is the
      // bounded "absent-then-returns" residual (its sid may be pruned then re-emitted once on
      // recovery — narrows-only); the grace path does not claim to PROTECT such a sid.
      nextFailures[c.path] = Math.min((nextFailures[c.path] || 0) + 1, MAX_CAPTURE_FAILURES);
      log('audit-error', { path: c.path, msg: e && e.message });
    }
  }

  const prunedAudited = prune(nextAudited, cands);     // drop vanished transcripts (cost-map hygiene)
  const prunedFailures = prune(nextFailures, cands);
  try {
    writeAtomic(spath, { version: RUN_STATE_VERSION, audited: prunedAudited, captureFailures: prunedFailures, lastRunAt: new Date(now()).toISOString() });
  } catch (e) {
    log('run-state-write-error', { msg: e && e.message }); // writeAtomic can throw (disk full) -> fail-open
  }

  // --- PR-B retention: OBSERVE here, DECIDE under the lock in pruneEmittedState. ------
  // presentSids = union of captured sids over present files (a stale-but-captured entry
  // still over-approximates -> superset-safe). A present file that is never-captured AND
  // within its capture grace BLOCKS the prune (default-KEEP on uncertainty). A discovery
  // failure also defers (a transiently-unreadable dir must not falsely-absent its sids).
  const presentSids = new Set();
  let blocked = false;
  for (const c of cands) {
    const entry = prunedAudited[c.path];
    if (isCaptured(entry)) { for (const s of entry.sessionIds) presentSids.add(s); continue; }
    if ((prunedFailures[c.path] || 0) < grace) blocked = true; // sid unknown, still within grace
  }
  const complete = discoveryComplete && !blocked;
  try {
    pruneEmittedState({ presentSids: [...presentSids], complete, now, absentRuns, floorMs, statePath: epath });
  } catch (e) {
    log('prune-emitted-error', { msg: e && e.message }); // fail-open (disk-full / lock)
  }
  try {
    sweepMarkers({ dir: markerDir(), keepNewest: markerKeep, ttlMs: markerTtl, floorMs, now });
  } catch (e) {
    log('marker-sweep-error', { msg: e && e.message }); // fail-open
  }

  return { ok: true, audited: done, scanned: cands.length, malformed };
}

module.exports = {
  runHeartbeat, discover, loadRunState, prune, sweepMarkers, envIntClamped, killswitchFilePresent,
  entryMtime, isCaptured, sanitizeAudited, sanitizeCaptureFailures,
  DEFAULT_PROJECTS_DIR, DEFAULT_RUN_STATE_PATH, DEFAULT_KILLSWITCH_FILE, RUN_STATE_VERSION,
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
