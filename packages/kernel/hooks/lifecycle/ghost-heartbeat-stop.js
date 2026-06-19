#!/usr/bin/env node
'use strict';

// packages/kernel/hooks/lifecycle/ghost-heartbeat-stop.js
//
// Ghost Heartbeat W2-PR2 — the Stop-hook CARRIER. On (opted-in) turn end, hand the
// just-finished transcript to the drift-audit producer as a DETACHED background
// process, then pass the hook's stdin through and exit. Advisory, draft-only,
// opt-in (GHOST_HEARTBEAT_EMIT=1), default-OFF.
//
// Stop fires PER TURN (not once per session close), so the carrier DEBOUNCES per
// session — one marker file per sha256(transcript_path), holding {lastSpawnAt} —
// to bound the spawn rate to ~1 per GHOST_HEARTBEAT_DEBOUNCE_MS per session, NOT
// one `claude -p` per turn. The same marker is PR-3's drain queue.
//
// Fail-open is ABSOLUTE: every gate just returns; a single finally passes stdin
// through; nothing throws out of the handler; no process.exit (stdout drains on
// natural exit). A Stop hook must NEVER break the turn.
//
// Security (VERIFY board #369/PR-2): process.execPath (not bare 'node') keeps PATH
// out of the trust surface for the detached child; statFile()'s isFile() check
// rejects a symlink-to-FIFO/dir at stat time (the producer re-checks isFile before
// read, closing the readFileSync-on-FIFO hang); the spawn is an argv ARRAY
// (shell:false) so a flag-/whitespace-looking transcript_path is a single literal.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { writeAtomic } = require('../../_lib/atomic-write');
const { withRegularFileFd } = require('../../_lib/safe-read');
const { log } = require('../_lib/_log.js');

const logger = log('ghost-heartbeat-stop');

// The producer, absolute + __dirname-anchored (the hook's cwd is the project root,
// not its own dir — a relative path would resolve wrong).
const DRIFT_AUDIT = path.join(__dirname, '../../spawn-state/drift-audit.js');

const DEFAULT_MIN_BYTES = 16384;     // coarse "skip trivial sessions" pre-filter
const DEFAULT_DEBOUNCE_MS = 900000;  // 15 min — the real per-session rate control

// NaN/neg-guarded env int. A garbage value MUST fall back to the default: parseInt
// 'garbage' is NaN, and `size < NaN` is false — which would SILENTLY DISABLE a
// size throttle. The guard prevents that footgun.
function envInt(name, def) {
  const s = (process.env[name] || '').trim();
  // Whole-string digits only -> default. Rejects '', 'garbage', AND the radix-10
  // footguns parseInt would silently truncate: '0x10' -> 0 (disables a throttle),
  // '1e9' -> 1, '-1' -> a negative size. A pure-digit string parses finite.
  return /^\d+$/.test(s) ? parseInt(s, 10) : def;
}

// Marker dir resolved LIVE (like _log's logDir) so a test/operator can redirect it.
function markerDir() {
  return process.env.GHOST_HEARTBEAT_MARKER_DIR
    || path.join(os.homedir(), '.claude', 'checkpoints', 'ghost-heartbeat-spawns');
}
function markerPathFor(transcriptPath) {
  const h = crypto.createHash('sha256').update(String(transcriptPath)).digest('hex').slice(0, 16);
  return path.join(markerDir(), `${h}.json`);
}

// ONE stat: returns the stat ONLY for a regular file (covers missing /
// permission-denied / symlink-to-dir / symlink-to-FIFO in a single call, and
// yields size without a second stat — no carrier-side TOCTOU between two stats).
function statFile(p) {
  try {
    const st = fs.statSync(p);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

// Debounce: spawn at most once per DEBOUNCE_MS per session anchor. Tolerant read —
// a missing/corrupt marker means "go ahead" (fail TOWARD auditing).
function shouldSpawn(transcriptPath, now) {
  const debounceMs = envInt('GHOST_HEARTBEAT_DEBOUNCE_MS', DEFAULT_DEBOUNCE_MS);
  // TOCTOU-safe (CodeRabbit #371): read the marker FROM a pinned fd — a name-based
  // statFile()-then-readFileSync(path) leaves a swap window where the marker can be
  // replaced with a FIFO and the read BLOCKS the turn. withRegularFileFd opens
  // O_NONBLOCK, fstats the bound fd, rejects non-regular, and reads from THAT fd.
  // Absent / non-regular / corrupt -> fallback 0 -> spawn (fail toward auditing).
  const last = withRegularFileFd(markerPathFor(transcriptPath), (fd) => {
    const m = JSON.parse(fs.readFileSync(fd, 'utf8'));
    return (m && typeof m.lastSpawnAt === 'number') ? m.lastSpawnAt : 0;
  }, 0);
  return now - last >= debounceMs;
}

// Pure (golden-tested): the detached, non-blocking, PATH-independent spawn shape.
// process.execPath (not the bare string 'node') removes PATH from the trust
// surface; the script may be overridden in tests via GHOST_HEARTBEAT_AUDIT_BIN.
function buildSpawn(transcriptPath) {
  const script = process.env.GHOST_HEARTBEAT_AUDIT_BIN || DRIFT_AUDIT;
  return {
    bin: process.execPath,
    args: [script, '--transcript', transcriptPath],
    options: { detached: true, stdio: 'ignore' },
  };
}

// The decision. No side effect on stdout — the caller's finally owns pass-through.
function carry(input) {
  if (process.env.GHOST_HEARTBEAT_EMIT !== '1') return;     // OPT-IN, default-off
  if (process.env.GHOST_HEARTBEAT_DISABLED === '1') return; // killswitch

  let envelope;
  try { envelope = input ? JSON.parse(input) : {}; } catch { return; }
  const transcriptPath = envelope && envelope.transcript_path;
  if (!transcriptPath) return;

  const st = statFile(transcriptPath);
  if (!st) return;                                                  // missing / not a regular file
  if (st.size < envInt('GHOST_HEARTBEAT_MIN_BYTES', DEFAULT_MIN_BYTES)) return; // trivial session
  const now = Date.now();
  if (!shouldSpawn(transcriptPath, now)) return;                    // per-session debounce

  // Upsert the marker BEFORE spawning so a concurrent turn debounces against it. A
  // marker-write failure fails CLOSED on the spawn (skip this turn) — without a
  // durable marker we cannot debounce, so spawning would risk one audit per turn.
  try { writeAtomic(markerPathFor(transcriptPath), { transcriptPath, lastSpawnAt: now }); }
  catch (e) { logger('marker-write-failed', { msg: e && e.message }); return; }

  const { bin, args, options } = buildSpawn(transcriptPath);
  // spawn() never emits 'error' synchronously (PATH/exec failures surface as an
  // ASYNC 'error' event), so this listener is always attached before it can fire —
  // it prevents an uncaught-'error' crash. Do NOT refactor to spawnSync (it would
  // block the turn — the whole point of the detached handoff).
  const child = spawn(bin, args, options);
  child.on('error', (e) => logger('spawn-error', { msg: e && e.message }));
  child.unref();
  logger('spawned', { transcriptPath, size: st.size });
}

module.exports = { buildSpawn, statFile, markerPathFor, markerDir, shouldSpawn, envInt, DRIFT_AUDIT };

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    try { carry(input); }
    catch (e) { logger('error', { msg: e && e.message }); }
    finally { process.stdout.write(input); } // SINGLE pass-through; natural exit drains stdout
  });
}
