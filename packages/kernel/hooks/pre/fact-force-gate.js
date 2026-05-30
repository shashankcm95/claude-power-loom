#!/usr/bin/env node

// PreToolUse hook: fact-forcing gate
// Blocks Edit/Write on a file that hasn't been Read first in this session.

const fs = require('fs');
const path = require('path');
const os = require('os');
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

// Session-scoped tracker. PPID is the key: child hook processes spawned
// from the same Claude Code parent share the parent's PPID, so reads
// and subsequent edits hit the same tracker file.
const SESSION_ID = process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_CONVERSATION_ID || String(process.ppid || 'default');
const TRACKER_PATH = path.join(os.tmpdir(), `claude-read-tracker-${SESSION_ID}.json`);

/**
 * Load the per-session read tracker from disk. Returns a fresh tracker on
 * any error (missing file, parse failure) — first-run case is the common
 * path. Tracker shape: `{ files: { [absPath]: <readTimestamp> }, sessionStart: <ts> }`.
 *
 * @returns {{files: Object<string, number>, sessionStart: number}}
 */
function loadTracker() {
  try {
    const raw = fs.readFileSync(TRACKER_PATH, 'utf8');
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
 * @param {{files: Object<string, number>, sessionStart: number}} tracker State to persist
 * @returns {void}
 */
function saveTracker(tracker) {
  // H.9.8: migrated to writeAtomic; helper cleanup-on-error absorbed the
  // inline unlinkSync + tmpFile bookkeeping; log event preserved as
  // test-surface (hook fail-soft contract).
  try {
    writeAtomic(TRACKER_PATH, tracker);
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

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
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

    const tracker = loadTracker();

    if (toolName === 'Read') {
      tracker.files[filePath] = Date.now();
      saveTracker(tracker);
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
        saveTracker(tracker);
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
});
