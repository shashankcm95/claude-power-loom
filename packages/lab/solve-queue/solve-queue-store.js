#!/usr/bin/env node

// @loom-layer: lab
//
// Wave A / item-8 Part-A - the solve-queue lifecycle store (I/O layer). A durable, append-only event log
// (`$LOOM_LAB_STATE_DIR/solve-queue/events.jsonl`) tracking each external-issue solve entry through its
// lifecycle (queued -> solving -> drafted -> in_flight -> merged -> minted; terminal, plus disposed which
// is re-openable). Current state = a fold over an entry's events (LINE ORDER authoritative; ts is audit-
// only). The pure fold + legality table live in solve-queue-fold.js (SRP split); this file is I/O + the
// store-wide lock + the hardened GROWING-log read + boundary validation.
//
// SHADOW / weight-inert: the queue gates NOTHING and MUST NEVER become a weight/trust input (the load-
// bearing invariant). It is operational bookkeeping. Wave B re-verifies merge_sha from gh INDEPENDENTLY,
// so a tampered entry can at worst deny/mis-drive; PR-opening is operator-gated. Hence - deliberately - no
// per-event content-addressing (KISS); a tamper-evident hash-chain is the escalation IF that ever changes.
//
// Read-path hardening is templated on live-pending-store.js (O_RDONLY|O_NOFOLLOW|O_NONBLOCK + fstat the
// SAME fd + reject non-regular / foreign-owned / size > MAX_LOG_BYTES BEFORE a bounded read). The byte
// bound is MAX_LOG_BYTES (a LOG, not the 64 KiB per-node cap - verify-plan CR3). Every refuse is OBSERVABLE.
//
// Imports: kernel/_lib (canonical-json, lock, safe-resolve) + kernel/egress/alert. NO runtime/kernel STATE.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { canonicalJsonSerialize } = require('../../kernel/_lib/canonical-json');
const { currentUid } = require('../../kernel/_lib/safe-resolve');
const { withLockSoft } = require('../../kernel/_lib/lock');
const { emitEgressAlert } = require('../../kernel/egress/alert');
// Validators + the enum/legality live in the fold (pure, DRY) - the store and the fold share ONE definition,
// and the fold re-checks field content on READ (verify-on-read, #273); the store re-checks at the WRITE
// boundary here so a bad input never lands in the log in the first place.
const {
  STATES, isLegalTransition, foldEntry, MAX, HEX64, validRepo, validIssueRef, badEvidence,
} = require('./solve-queue-fold');

const LAB_STATE_BASE = process.env.LOOM_LAB_STATE_DIR || path.join(os.homedir(), '.claude', 'lab-state');
const DEFAULT_DIR = path.join(LAB_STATE_BASE, 'solve-queue');
const EVENTS_FILE = 'events.jsonl';
const LOCK_FILE = '.lock';
const MAX_LOG_BYTES = 8 * 1024 * 1024;                 // a LOG bound (thousands of events), NOT a node cap

function alert(kind, detail) { emitEgressAlert('solve-queue-refuse', { kind, ...detail }); }

function entryId(repo, issue_ref) { return crypto.createHash('sha256').update(canonicalJsonSerialize({ repo, issue_ref })).digest('hex'); }

// ---- hardened GROWING-log read ----
function isForeign(st, selfUid) { return selfUid !== null && st.uid !== selfUid; }

// Templated on live-pending-store.validateReadDir: an ABSENT dir is a not-yet-created store (benign);
// a symlink / foreign-uid / non-dir root is an attack-shaped redirect. Returns a reason or null (safe).
function validateReadDir(dir, selfUid) {
  let st;
  try { st = fs.lstatSync(dir); } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return 'absent';
    return (err && err.code) || 'stat-error';
  }
  if (st.isSymbolicLink()) return 'symlink';
  if (!st.isDirectory()) return 'not-a-dir';
  if (isForeign(st, selfUid)) return 'foreign';
  return null;
}

function readBoundedText(fd, cap) {
  const buf = Buffer.alloc(cap + 1);
  let n = 0;
  let r = 0;
  do { r = fs.readSync(fd, buf, n, cap + 1 - n, n); n += r; } while (r > 0 && n <= cap);
  if (n > cap) return null;
  return buf.toString('utf8', 0, n);
}

// Read events.jsonl hardened, parse line-by-line. A torn/unparseable line is SKIPPED (a read racing an
// append can legitimately see a half-written last line - CR2). Returns the events array in LINE ORDER,
// or [] (fail-closed + observable on any attack-shaped read; silent [] only for a benign absent store).
function readEvents(dir) {
  const selfUid = currentUid();
  const dirReason = validateReadDir(dir, selfUid);
  if (dirReason === 'absent') return [];
  if (dirReason !== null) { alert('bad-read-dir', { dir_reason: dirReason }); return []; }
  const file = path.join(dir, EVENTS_FILE);
  let fd = null;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const st = fs.fstatSync(fd);
    if (!st.isFile()) { alert('read-reject', { kind: 'non-regular-file' }); return []; }
    if (isForeign(st, selfUid)) { alert('read-reject', { kind: 'foreign-owned' }); return []; }
    if (st.size > MAX_LOG_BYTES) { alert('read-reject', { kind: 'oversize', size: st.size }); return []; }
    const text = readBoundedText(fd, MAX_LOG_BYTES);
    if (text === null) { alert('read-reject', { kind: 'oversize-race' }); return []; }
    const out = [];
    for (const line of text.split('\n')) {
      if (line.length === 0) continue;
      let evt;
      try { evt = JSON.parse(line); } catch { continue; }         // torn / non-JSON line -> skip (CR2)
      if (evt && typeof evt === 'object' && !Array.isArray(evt)) out.push(evt);
    }
    return out;
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];                   // absent log = empty (benign)
    alert('read-reject', { io_code: err && err.code });            // ELOOP (symlinked file), EACCES, ... observable
    return [];
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
}

// Group events by entry_id (line order preserved) + record the last `-> queued` line index per entry (FIFO
// key for claimNext). Returns { byEntry: Map, queuedAt: Map }.
function groupEvents(events) {
  const byEntry = new Map();
  const queuedAt = new Map();
  events.forEach((evt, idx) => {
    if (!evt || typeof evt.entry_id !== 'string') return;
    if (!byEntry.has(evt.entry_id)) byEntry.set(evt.entry_id, []);
    byEntry.get(evt.entry_id).push(evt);
    if (evt.to_state === 'queued') queuedAt.set(evt.entry_id, idx);
  });
  return { byEntry, queuedAt };
}

function foldAll(dir) {
  const { byEntry, queuedAt } = groupEvents(readEvents(dir));
  const entries = [];
  for (const [eid, evs] of byEntry) {
    const f = foldEntry(evs);
    if (f) entries.push({ ...f, _queuedAt: queuedAt.has(eid) ? queuedAt.get(eid) : Infinity });
  }
  return entries;
}

function foldOne(dir, eid) {
  const { byEntry } = groupEvents(readEvents(dir).filter((e) => e && e.entry_id === eid));
  return byEntry.has(eid) ? foldEntry(byEntry.get(eid)) : null;
}

// Hardened append (under the caller's lock). Rejects a symlinked/foreign STATE DIR (O_NOFOLLOW guards only
// the final component, not the parent - M2); opens the log O_NOFOLLOW (a planted events.jsonl symlink ->
// ELOOP); writes a LEADING \n so a torn tail from a crash-mid-append is self-framed and never glues onto the
// next record (M3). Returns {ok:true} or {ok:false, reason:'write-failed'} + an OBSERVABLE alert (M4;
// fail-closed-must-be-observable) - every op propagates the failure instead of throwing uncaught.
function appendEvent(dir, evt) {
  const dirReason = validateReadDir(dir, currentUid());
  if (dirReason !== null && dirReason !== 'absent') { alert('write-reject', { dir_reason: dirReason }); return { ok: false, reason: 'write-failed' }; }
  let fd = null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fd = fs.openSync(path.join(dir, EVENTS_FILE), fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeSync(fd, `\n${JSON.stringify(evt)}`);
    return { ok: true };
  } catch (err) {
    alert('write-reject', { io_code: err && err.code });
    return { ok: false, reason: 'write-failed' };
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
}

function mkEvent(entry_id, repo, issue_ref, from_state, to_state, evidence) {
  return { entry_id, repo, issue_ref, from_state, to_state, ts: Date.now(), evidence: evidence || {} };
}

function underLock(dir, op, fn) {
  const lr = withLockSoft(path.join(dir, LOCK_FILE), fn, { maxWaitMs: 3000 });
  if (!lr.ok) { alert('lock-timeout', { op }); return { ok: false, reason: 'lock-timeout' }; }
  return lr.value;
}

// ---- public ops ----
function enqueue(input, opts = {}) {
  const { repo, issue_ref, persona } = input || {};
  if (!validRepo(repo)) { alert('bad-input', { field: 'repo' }); return { ok: false, reason: 'bad-input' }; }
  if (!validIssueRef(issue_ref)) { alert('bad-input', { field: 'issue_ref' }); return { ok: false, reason: 'bad-input' }; }
  if (persona !== undefined && !(typeof persona === 'string' && persona.length >= 1 && persona.length <= MAX.persona)) {
    alert('bad-input', { field: 'persona' }); return { ok: false, reason: 'bad-input' };
  }
  const dir = opts.dir || DEFAULT_DIR;
  const eid = entryId(repo, issue_ref);
  return underLock(dir, 'enqueue', () => {
    const cur = foldOne(dir, eid);
    const from = cur ? cur.state : null;
    if (cur && cur.state !== 'disposed') return { ok: true, entry_id: eid, state: cur.state };   // idempotent
    const w = appendEvent(dir, mkEvent(eid, repo, issue_ref, from, 'queued', persona ? { persona } : {}));
    return w.ok ? { ok: true, entry_id: eid, state: 'queued' } : w;
  });
}

function claimNext(opts = {}) {
  const dir = opts.dir || DEFAULT_DIR;
  return underLock(dir, 'claimNext', () => {
    const queued = foldAll(dir).filter((e) => e.state === 'queued').sort((a, b) => a._queuedAt - b._queuedAt);
    if (queued.length === 0) return { ok: false, reason: 'queue-empty' };
    const e = queued[0];
    const w = appendEvent(dir, mkEvent(e.entry_id, e.repo, e.issue_ref, 'queued', 'solving', {}));
    if (!w.ok) return w;
    return { ok: true, entry_id: e.entry_id, repo: e.repo, issue_ref: e.issue_ref, state: 'solving', evidence: e.evidence };
  });
}

function advance(input, opts = {}) {
  const { entry_id, to_state, evidence } = input || {};
  if (typeof entry_id !== 'string' || !HEX64.test(entry_id)) { alert('bad-input', { field: 'entry_id' }); return { ok: false, reason: 'bad-input' }; }
  if (!STATES.includes(to_state)) { alert('bad-input', { field: 'to_state' }); return { ok: false, reason: 'bad-input' }; }
  const evBad = badEvidence(evidence);
  if (evBad) { alert('bad-input', { field: 'evidence', detail: evBad }); return { ok: false, reason: 'bad-input' }; }
  const dir = opts.dir || DEFAULT_DIR;
  return underLock(dir, 'advance', () => {
    const cur = foldOne(dir, entry_id);
    if (!cur) { alert('unknown-entry', { entry_id, op: 'advance' }); return { ok: false, reason: 'unknown-entry' }; }
    if (!isLegalTransition(cur.state, to_state)) { alert('illegal-transition', { entry_id, from: cur.state, to: to_state }); return { ok: false, reason: 'illegal-transition' }; }
    const w = appendEvent(dir, mkEvent(entry_id, cur.repo, cur.issue_ref, cur.state, to_state, evidence));
    return w.ok ? { ok: true, entry_id, state: to_state } : w;
  });
}

function get(input, opts = {}) {
  const eid = input && input.entry_id;
  const dir = opts.dir || DEFAULT_DIR;
  const f = (typeof eid === 'string' && HEX64.test(eid)) ? foldOne(dir, eid) : null;
  if (f) return { ok: true, ...f };
  alert('unknown-entry', { entry_id: eid, op: 'get' });
  return { ok: false, reason: 'unknown-entry' };
}

function list(input = {}, opts = {}) {
  const dir = opts.dir || DEFAULT_DIR;
  const entries = foldAll(dir).map(({ _queuedAt, ...e }) => e);
  return input && input.state ? entries.filter((e) => e.state === input.state) : entries;
}

module.exports = { enqueue, claimNext, advance, get, list, entryId, MAX_LOG_BYTES, DEFAULT_DIR };
