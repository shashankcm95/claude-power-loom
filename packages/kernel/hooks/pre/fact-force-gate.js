#!/usr/bin/env node

// PreToolUse hook: fact-forcing gate
// Blocks Edit/Write on a file that hasn't been Read first in this session.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { log } = require('../_lib/_log.js');
const logger = log('fact-force-gate');
// H.9.8: migrated saveTracker (Class C hook fail-soft; function-scoped try-
// catch + log('atomic_write_failed') preserved) from inline atomic-write
// pattern to shared helper. Cross-tree require precedent per HT.2.3 Part B.
const { writeAtomic } = require('../../_lib/atomic-write');
// F14 (PR 2): consume the shared K7 path canonicalizer instead of a local
// realpath helper (DRY). K7 additionally resolves symlinked ancestors of a
// not-yet-existing leaf, which only strengthens the read-tracker keying.
const { canonicalize } = require('../../_lib/path-canonicalize');
// ③.0-W4: reuse the canonical Windows-null uid discipline (do NOT hand-roll
// `typeof process.getuid`). currentUid() returns null on Windows -> POSIX
// ownership checks are skipped. Sibling of safe-resolve.js:79-88 isSafeExecStat.
const { currentUid } = require('../../_lib/safe-resolve');

// Session-scoped tracker key resolution (③.0-W3).
//
// The tracker must use a key that is STABLE across the two separate hook
// processes a single Read-then-Edit produces (else the gate bricks — the Read
// records under key A, the Edit looks under key B, finds nothing, blocks every
// edit). It should ALSO be as session-DISTINCT as the harness allows, so a Read
// in one session does not authorize an Edit in another.
//
// Resolution order, most-distinct first (firsthand-probed ③.0-W3 — a `claude -p`
// Read+Edit confirmed `session_id` is PRESENT on the Read|Edit|Write PreToolUse
// payload and BYTE-IDENTICAL across the two separate processes; only snake_case
// is sent, camel `sessionId` is always null but kept as a defensive fallback):
//   data.session_id  (payload — session-distinct + cross-process stable)
//     -> CLAUDE_SESSION_ID / CLAUDE_CONVERSATION_ID env  (operator-set)
//       -> process.ppid  (the floor: same-parent spawns share it)
//         -> 'default'
//
// The resolved value is then sha256'd to a 16-hex key before going into the
// tmp filename. This is the spawn-record.js:228 precedent and it makes the key
// (now derived from an EXTERNAL payload field) inherently safe: hex-only (no
// path separators -> no os.tmpdir() escape), fixed-width (no ENAMETOOLONG from a
// hostile multi-MB session_id), and collision-resistant (two distinct ids never
// collapse to one tracker — a 'drop disallowed chars' sanitizer would collapse
// '/' and '@@@' both to '', re-opening the very cross-contamination this fixes).
//
// RESIDUAL (honest, ③.0-W3): whether the harness gives CONCURRENT same-parent
// sub-agents DISTINCT session_id values is an unverified harness assumption (it
// cannot be probed without spawning concurrent agents). If they share one
// session_id the cross-contamination is NARROWED, not closed — but the failure
// mode is strictly fail-OPEN (it over-approves a read-before-edit; it never
// produces a false block that would brick an edit) and strictly dominates the
// ppid floor (which collides on EVERY same-parent spawn). Not "fixed" — narrowed.
function deriveSessionKey(data) {
  const d = data || {};
  const raw = d.session_id || d.sessionId
    || process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_CONVERSATION_ID
    || String(process.ppid || 'default');
  const coerced = String(raw) || 'default';
  return crypto.createHash('sha256').update(coerced).digest('hex').slice(0, 16);
}

// ③.0-W4 — per-uid 0700 subdir for the tracker (TOCTOU hardening; W3 VALIDATE H-LOW-1 follow-up).
//
// THREAT (the only IN-MODEL one): a FOREIGN uid on a world-writable tmpdir (Linux
// /tmp = 1777) pre-plants a symlink at the predictable tracker path; writeAtomic's
// _resolveForAtomicWrite refuses a foreign-uid redirect to an EXISTING target but
// FOLLOWS a symlink to a NON-EXISTENT one (atomic-write.js:121-125), a foreign-uid
// file-create primitive. Containing the tracker in a 0700 subdir a foreign uid
// cannot enter removes the plant surface WHEN the subdir is established (a foreign
// uid that pre-plants `claude-loom-<uid>` itself forces the fallback — see below).
// macOS tmpdir is ALREADY per-user 0700 -> there this is defense-in-depth + Linux
// portability.
//
// SAME-uid is NOT closed (conceded, container-tier): a same-uid process owns the
// 0700 dir and could write the target file directly — no privilege boundary to
// cross (the atomic-write.js:120 concession). And the closure is CONDITIONAL: a
// foreign uid can pre-plant `claude-loom-<uid>` itself (predictable name) to FORCE
// the fallback-to-flat; we LOG that fallback (observable, not silent), and the
// fallback is status-quo (never worse). NO rand-suffix retry — the Read process and
// the Edit process are SEPARATE processes that must derive the SAME dir, so the dir
// name must be deterministic (a per-process random suffix would brick the gate).

/**
 * PURE policy: is `stat` (an lstat result) a tracker DIRECTORY safe to use as our
 * private container? Rejects a symlink, a non-directory, a foreign-owned dir, and
 * any dir carrying group/other permission bits. Mirrors safe-resolve.js:79-88
 * (isSafeExecStat) but for a DIRECTORY: isDirectory + 0o077 (owner-ONLY for a
 * private dir) vs the exec variant's isFile + 0o022 (no group/other WRITE for a
 * script). selfUid===null (Windows) skips the POSIX checks. Pure -> unit-testable.
 * @param {fs.Stats|null} stat result of an lstat (NOT a follow stat)
 * @param {number|null} selfUid current uid, or null to skip (Windows)
 * @returns {boolean}
 */
function isSafeTrackerDirStat(stat, selfUid) {
  if (!stat) return false;
  if (stat.isSymbolicLink()) return false;       // belt-and-suspenders: isDirectory already excludes a symlink-to-dir on an lstat; documents intent
  if (!stat.isDirectory()) return false;
  if (selfUid !== null) {                          // POSIX checks (skipped on Windows — uid unknowable)
    if (stat.uid !== selfUid) return false;         // foreign-owned -> untrusted
    if ((stat.mode & 0o077) !== 0) return false;    // any group/other bit -> not owner-only
  }
  return true;
}

/**
 * Resolve (and best-effort establish) the per-uid 0700 tracker directory under
 * `base` (default os.tmpdir()). NEVER THROWS: on any failure — an unsafe
 * pre-existing entry (symlink / foreign-owned / loose perms), a TOCTOU race, or any
 * mkdir error (ENOSPC/EACCES/EROFS) — it returns the flat `base` (status quo, no
 * regression). The `base` param is a test seam; production omits it.
 * @param {string} [base] container root (default os.tmpdir())
 * @returns {string} the per-uid subdir if safely established, else the flat base
 */
function trackerDir(base) {
  const root = base || os.tmpdir();
  const uid = currentUid();
  const dir = path.join(root, `claude-loom-${uid === null ? 'default' : uid}`);
  try {
    // mkdir is atomic (fails EEXIST if present). mode 0o700 is BEST-EFFORT — umask
    // can NARROW it but never loosen (0o700 has no group/other bits, so a sane umask
    // leaves 0700); the lstat-verify on the reuse path below is the ACTUAL 0700
    // enforcement, not the create mode.
    fs.mkdirSync(dir, { mode: 0o700 });
    return dir;                                     // freshly created -> owned by us
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      try {
        if (isSafeTrackerDirStat(fs.lstatSync(dir), uid)) return dir; // safe pre-existing per-uid dir
      } catch { /* lstat race -> fall through to flat */ }
      // Unsafe pre-existing entry OR a race -> flat fallback (status quo). Log so a
      // FORCED fallback (an active foreign-plant on a world-writable tmpdir, which
      // permanently disables the subdir hardening until cleanup) is OBSERVABLE.
      logger('tracker_subdir_unsafe_fallback', { dir });
      return root;
    }
    return root;                                    // any other mkdir error -> flat fallback; never throw
  }
}

function resolveTrackerPath(data, base) {
  return path.join(trackerDir(base), `claude-read-tracker-${deriveSessionKey(data)}.json`);
}

/**
 * Load the per-session read tracker from disk. Returns a fresh tracker on
 * any error (missing file, parse failure) — first-run case is the common
 * path. Tracker shape: `{ files: { [absPath]: <readTimestamp> }, sessionStart: <ts> }`.
 *
 * @param {string} trackerPath Resolved tracker path for this session (W3: was a module-scope const)
 * @returns {{files: Object<string, number>, sessionStart: number}}
 */
function loadTracker(trackerPath) {
  try {
    const raw = fs.readFileSync(trackerPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { files: {}, sessionStart: Date.now() };
  }
}

/**
 * Atomically write the read tracker to disk via tmp-file + rename.
 * Concurrent readers see either the old or new tracker, never a
 * half-written file. Errors are logged but never thrown — tracker save
 * is best-effort; the gate proceeds on errors via the surrounding
 * try/catch fail-open path.
 *
 * @param {string} trackerPath Resolved tracker path for this session
 * @param {{files: Object<string, number>, sessionStart: number}} tracker State to persist
 * @returns {void}
 */
function saveTracker(trackerPath, tracker) {
  // H.9.8: migrated to writeAtomic; helper cleanup-on-error absorbed the
  // inline unlinkSync + tmpFile bookkeeping; log event preserved as
  // test-surface (hook fail-soft contract).
  try {
    // ③.0-W4 (H4-2): re-assert the parent dir at 0700 right before the write, so a
    // plain remove-race in the window after trackerDir() does not let writeAtomic's
    // mode-LESS recursive mkdir (atomic-write.js:148 -> 0755) recreate the tracker
    // dir group/other-traversable. recursive:true is a no-op on an existing dir (it
    // does NOT chmod), so a live 0700 dir stays 0700 and a removed one is recreated
    // at 0700. Best-effort: a failure here still lets writeAtomic do its own mkdir.
    // SCOPE (VALIDATE M1): this closes the remove-WITHOUT-replant case only. A remove
    // -THEN-symlink-plant in the same window is NOT closed (recursive mkdir follows a
    // planted symlink-to-dir) — but its precondition is same-uid OR a non-sticky
    // world-writable tmpdir (sticky /tmp blocks a foreign rm of our owned 0700 dir;
    // _foreignOwned refuses a foreign redirect target), so it stays the conceded
    // same-uid container-tier residual. Still strictly safer than the pre-W4 flat path.
    try { fs.mkdirSync(path.dirname(trackerPath), { recursive: true, mode: 0o700 }); }
    catch { /* best-effort 0700 pre-ensure; writeAtomic mkdirs as fallback */ }
    writeAtomic(trackerPath, tracker);
  } catch (err) {
    logger('atomic_write_failed', { error: err.message });
  }
}

/**
 * Normalize a file path to its canonical absolute form. Resolves symlinks
 * via `fs.realpathSync` when possible (so `Read` of a symlink and `Edit`
 * of the target both hit the same tracker key). Falls back to
 * `path.resolve` if realpath fails (e.g., file doesn't exist yet — Write
 * to a new path is a normal case).
 *
 * @param {string} filePath Raw path from tool_input.file_path
 * @returns {string} Canonical absolute path, or empty string if input was falsy
 */
function normalizePath(filePath) {
  // F14: delegate to the shared K7 canonicalizer (packages/kernel/_lib/
  // path-canonicalize.js). Behavior is a strict superset of the prior local
  // helper — symlinked ancestors of non-existent leaves now resolve too.
  return canonicalize(filePath);
}

function handleEnd(input) {
  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name || '';
    const toolInput = data.tool_input || {};
    const filePath = normalizePath(toolInput.file_path || toolInput.path || '');

    if (!filePath) {
      logger('approve', { toolName, reason: 'no_file_path' });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    // W3: derive the per-session tracker path from THIS payload (session_id-first
    // — see deriveSessionKey). Inside the fail-open try/catch so a malformed
    // payload still fail-opens to approve.
    const trackerPath = resolveTrackerPath(data);
    const tracker = loadTracker(trackerPath);

    if (toolName === 'Read') {
      tracker.files[filePath] = Date.now();
      saveTracker(trackerPath, tracker);
      logger('read_recorded', { filePath });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    if (toolName === 'Edit' || toolName === 'Write') {
      const wasRead = tracker.files[filePath];

      // v2.8.5 FIX-H5 (P2-5) — Write satisfies fact-knowledge.
      //
      // Pre-v2.8.5 the gate approved Write but did NOT mark the file as read.
      // Consequence: Write→Edit on the same file blocked because the tracker
      // had no entry. The fix: record Write the same way Read does — the
      // author of a Write KNOWS the resulting contents (they just wrote them),
      // so the "must Read before Edit" requirement is already satisfied.
      //
      // Two cases:
      //   (a) Write to NEW file (does not exist): always approve; record in
      //       tracker so subsequent Edit to same path passes.
      //   (b) Write to EXISTING file: approve + record. (Pre-v2.8.5 this case
      //       went through the wasRead check below, blocking when no prior
      //       Read occurred. But Write IS the most authoritative form of
      //       file-knowledge — strict than Read.)
      //
      // v2.8.2-run1 P2-5 + v2.8.4 self-witnessed (I hit this 3× authoring
      // the v2.8.4 bundle). Common pattern: Write file -> realize a small
      // edit needed -> Edit blocked because no Read happened.
      //
      // Safety analysis: a Write that succeeds is necessarily a fact-grounded
      // operation (the writer chose the content). The gate's purpose is to
      // prevent edits-from-memory; Write doesn't have that pathology.
      if (toolName === 'Write') {
        if (!fs.existsSync(filePath) && wasRead) {
          // Edge case retained from pre-v2.8.5: file was Read then deleted
          // before Write. Worth logging — possible rm-then-Write bypass.
          logger('write_to_deleted_file', {
            filePath,
            readAt: wasRead,
            note: 'File was previously Read but no longer exists. Possible rm-then-Write bypass.',
          });
        }
        // Record the Write so subsequent Edit to this path passes.
        tracker.files[filePath] = Date.now();
        saveTracker(trackerPath, tracker);
        logger('approve', {
          toolName,
          filePath,
          reason: fs.existsSync(filePath) ? 'write_existing_recorded' : 'write_new_recorded',
        });
        process.stdout.write(JSON.stringify({ decision: 'approve' }));
        return;
      }

      // Edit case (toolName === 'Edit')
      if (!wasRead) {
        logger('block', { toolName, filePath, reason: 'not_read' });
        process.stdout.write(JSON.stringify({
          decision: 'block',
          reason: `FACT-FORCING GATE: You must Read "${filePath}" before editing it. Read the file first to understand its current state, then retry the edit.`,
        }));
        return;
      }

      logger('approve', { toolName, filePath, reason: 'previously_read' });
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      return;
    }

    logger('approve', { toolName, reason: 'unknown_tool' });
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
  } catch (err) {
    logger('error', { error: err.message });
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
  }
}

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => handleEnd(input));
}

module.exports = { deriveSessionKey, trackerDir, isSafeTrackerDirStat, resolveTrackerPath, loadTracker, saveTracker, normalizePath };
