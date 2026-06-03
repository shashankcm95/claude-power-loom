// R7 (v3.2 Wave 1) — the TodoWrite-as-checkpoint primitive.
//
// The durable progress ledger the Pattern-A trampoline (R6) writes against as it
// decomposes a task into leaves. NOT an observer of the TodoWrite tool (TodoWrite
// is unhooked in this substrate); a pure data primitive modeled on
// budget-tracker.js — import-friendly (no process.exit), atomic write, and its OWN
// per-file lock (withBudgetLock guards budgets.json only; the checkpoint is a
// separate file, so it needs a separate lock — plan Q4).
//
// Storage: swarm/run-state/<run-id>/todo-checkpoint.json (gitignored run-state).
//
// Liskov invariant (mirrors TodoWrite's documented semantics): at most one leaf
// `in_progress` at a time.
// R7 owns the checkpoint MECHANICS (status enum, unique ids, one-in_progress); it
// stores a leaf's `discipline` OPAQUELY — the R8 vocabulary is R6/R9's concern, so
// R7 stays decoupled from R8 (ISP / low coupling).

'use strict';

const fs = require('fs');
const path = require('path');
const { withLock } = require('../../kernel/_lib/lock');
const { runStateDir, RUN_STATE_BASE } = require('../../kernel/_lib/runState');
const { writeAtomic } = require('../../kernel/_lib/atomic-write');
const { checkWithinRoot } = require('../../kernel/_lib/path-canonicalize');
const { isSafePathSegment } = require('./_lib/safe-segment'); // shared raw-token guard

// The leaf-status vocabulary (mirrors TodoWrite). Frozen — a status outside this
// set is rejected at the boundary.
const CHECKPOINT_STATUSES = Object.freeze(['pending', 'in_progress', 'completed']);

function checkpointFilePath(runId) {
  // RAW-token guard FIRST: runStateDir(runId) is path.join'd, and path.join
  // normalizes `..` away BEFORE checkWithinRoot can see it — so an in-base traversal
  // runId (`a/../a`, `x/..`) would slip a base-anchored checkWithinRoot and clobber a
  // sibling run's checkpoint (hacker-lens VULNERABLE). Reject the raw runId here so
  // R7 self-defends even when called DIRECTLY (not only via R6 pre-validating).
  if (!isSafePathSegment(runId)) {
    throw new Error(`todo-checkpoint: runId ${JSON.stringify(runId)} is not a safe path segment — no separators or '..' allowed`);
  }
  const fp = path.join(runStateDir(runId), 'todo-checkpoint.json');
  // Defense-in-depth: a base-anchored containment check still catches absolute /
  // symlink escape that the raw-segment check above does not model.
  const scope = checkWithinRoot(fp, RUN_STATE_BASE);
  if (!scope.ok) {
    throw new Error(`checkpoint path escapes run-state (${scope.reason}) for runId: ${runId}`);
  }
  return fp;
}

function withCheckpointLock(runId, fn) {
  const lockPath = checkpointFilePath(runId) + '.lock';
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  // 15s timeout matches withBudgetLock — generous under test/CI contention.
  return withLock(lockPath, fn, { maxWaitMs: 15000 });
}

// Read-safe: null when absent. Atomic writes guarantee no torn read, so reads are
// lock-free (mirrors budget-tracker.getRecursion). THROWS on corrupt JSON (a
// caller advancing on a corrupt ledger would be worse than a loud failure).
function readCheckpoint(runId) {
  const fp = checkpointFilePath(runId);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

// Normalize + validate a leaf set; returns frozen-shape leaf objects or throws.
function normalizeLeaves(leaves) {
  if (!Array.isArray(leaves)) {
    throw new Error('writeCheckpoint: leaves must be an array');
  }
  const seen = new Set();
  let inProgress = 0;
  const normalized = leaves.map((leaf, i) => {
    if (!leaf || typeof leaf.id !== 'string' || leaf.id.length === 0) {
      throw new Error(`writeCheckpoint: leaf[${i}] must have a non-empty string "id"`);
    }
    if (seen.has(leaf.id)) {
      throw new Error(`writeCheckpoint: duplicate leaf id "${leaf.id}" (ids must be unique)`);
    }
    seen.add(leaf.id);
    if (typeof leaf.content !== 'string' || leaf.content.length === 0) {
      throw new Error(`writeCheckpoint: leaf "${leaf.id}" must have a non-empty string "content"`);
    }
    const status = leaf.status === undefined ? 'pending' : leaf.status;
    if (!CHECKPOINT_STATUSES.includes(status)) {
      throw new Error(`writeCheckpoint: leaf "${leaf.id}" has invalid status "${status}" (expected one of ${CHECKPOINT_STATUSES.join(', ')})`);
    }
    if (status === 'in_progress') inProgress += 1;
    const out = { id: leaf.id, content: leaf.content, status };
    // discipline is optional + opaque (R7 stores, R6/R9 validate the vocabulary).
    if (leaf.discipline !== undefined) out.discipline = leaf.discipline;
    return out;
  });
  if (inProgress > 1) {
    throw new Error('writeCheckpoint: at most one leaf may be "in_progress" at a time');
  }
  return normalized;
}

// Initialize / replace the checkpoint's leaf set for a run. Preserves an existing
// createdAt; always bumps updatedAt. Atomic + lock-guarded. Returns the checkpoint.
function writeCheckpoint(runId, leaves) {
  const normalized = normalizeLeaves(leaves);
  let result;
  withCheckpointLock(runId, () => {
    const fp = checkpointFilePath(runId);
    const existing = fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf8')) : null;
    const now = new Date().toISOString();
    const checkpoint = {
      runId,
      leaves: normalized,
      createdAt: (existing && existing.createdAt) || now,
      updatedAt: now,
    };
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    writeAtomic(fp, checkpoint);
    result = checkpoint;
  });
  return result;
}

// Advance one leaf's status. Enforces the one-in_progress invariant (a 2nd leaf
// going in_progress while another already is → reject; re-marking the SAME leaf
// in_progress is idempotent). Atomic + lock-guarded RMW. Returns the checkpoint.
function updateLeafStatus(runId, leafId, status) {
  if (!CHECKPOINT_STATUSES.includes(status)) {
    throw new Error(`updateLeafStatus: invalid status "${status}" (expected one of ${CHECKPOINT_STATUSES.join(', ')})`);
  }
  let result;
  withCheckpointLock(runId, () => {
    const fp = checkpointFilePath(runId);
    if (!fs.existsSync(fp)) {
      throw new Error(`updateLeafStatus: no checkpoint for run "${runId}"`);
    }
    const checkpoint = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const target = checkpoint.leaves.find((l) => l.id === leafId);
    if (!target) {
      throw new Error(`updateLeafStatus: leaf "${leafId}" not found in run "${runId}"`);
    }
    if (status === 'in_progress') {
      const other = checkpoint.leaves.find((l) => l.id !== leafId && l.status === 'in_progress');
      if (other) {
        throw new Error(`updateLeafStatus: cannot mark "${leafId}" in_progress — leaf "${other.id}" already is (at most one in_progress)`);
      }
    }
    // Immutable update (fundamentals: never mutate, create new objects) — a new
    // leaves array + a new checkpoint object, not in-place field assignment.
    const updated = {
      ...checkpoint,
      leaves: checkpoint.leaves.map((l) => (l.id === leafId ? { ...l, status } : l)),
      updatedAt: new Date().toISOString(),
    };
    writeAtomic(fp, updated);
    result = updated;
  });
  return result;
}

module.exports = { writeCheckpoint, updateLeafStatus, readCheckpoint, CHECKPOINT_STATUSES };
