// R6 (v3.2 Wave 1) — the Pattern-A persona-internal trampoline. THE Wave-1 headline.
//
// A single persona decomposes a task into a sequence of leaves and processes them
// SERIALLY, descending one recursion level per leaf and building a nested folder
// hierarchy under the run scratch dir, bounded by the R10 recursion-depth budget.
// On budget exhaust it emits a `commit_outcome: ABORTED` transaction record and
// stops. Pattern B (sibling multi-spawn) is OUT OF SCOPE (deferred v3.5+).
//
// Integrates: R7 todo-checkpoint (progress ledger), R8 decomposition-disciplines
// (each leaf's discipline must be in the frozen vocabulary), R10 budget-tracker
// (enterDepth/exitDepth), and the kernel record path (appendRecord).
//
// CONSUMES the kernel `_lib` record path; emits the ABORTED record DIRECTLY — NOT
// via buildSpawnRecord, which hardcodes operation_class CREATE + commit_outcome
// COMMITTED and so cannot emit ABORTED (plan Q5 CRITICAL; quarantine-promote.js:297,300).
//
// WRITE-SCOPE (plan Q3): the folder hierarchy + checkpoint live under
// runStateDir(runId) (gitignored run-scratch — NEVER the user's tree). Every runId
// and leaf-folder path is checkWithinRoot-guarded against RUN_STATE_BASE BEFORE any
// mkdir (runState.js does no canonicalization — record-store.js:36-42).

'use strict';

const fs = require('fs');
const path = require('path');

const { runStateDir, RUN_STATE_BASE } = require('../../kernel/_lib/runState');
const { checkWithinRoot } = require('../../kernel/_lib/path-canonicalize');
const { isValidDiscipline, DECOMPOSITION_DISCIPLINES } = require('./_lib/decomposition-disciplines'); // R8
const { writeCheckpoint, updateLeafStatus, readCheckpoint } = require('./todo-checkpoint'); // R7
const { enterDepth, exitDepth } = require('./budget-tracker'); // R10
const {
  computeGenesisHash, computeTransactionId, validateTransactionRecord,
} = require('../../kernel/_lib/transaction-record');
const { sanitizeAgentId } = require('../../kernel/_lib/quarantine-promote');
const { appendRecord } = require('../../kernel/_lib/record-store');
const { isSafePathSegment } = require('./_lib/safe-segment'); // shared raw-token guard

// abort_reason for a recursion-budget exhaust. 'budget-exhausted' is the canonical
// value per the schema's §5.4 DESCRIPTION (the recursion depth IS a budget dimension
// — budget-tracker.js:342). NB: validateTransactionRecord does NOT enforce abort_reason
// (the schema constrains it only to a non-empty string | null) — so this is
// canonical-by-CONVENTION, deliberately chosen over "recursion-depth-exhausted".
const ABORT_REASON_BUDGET = 'budget-exhausted';
// Schema version for emitted records. 'v3' is the v6-era transaction-record schema
// generation (schema_version pattern ^v[0-9]+...; v2 = v5.4 baseline, v3+ = v6).
const DEFAULT_SCHEMA_VERSION = 'v3';
// Bound the decomposition fan-out: nesting depth equals the leaf count, so an
// uncapped (attacker-influenced) leaf list means unbounded folder nesting — inode /
// PATH_MAX exhaustion (hacker-lens DoS). Pattern-A is persona-internal; a few dozen
// leaves is already generous.
const MAX_LEAVES = 64;

function assertWithinRunState(targetPath, label) {
  const scope = checkWithinRoot(targetPath, RUN_STATE_BASE);
  if (!scope.ok) {
    throw new Error(`trampoline: ${label} escapes run-state (${scope.reason})`);
  }
}

// Build + append the ABORTED transaction record DIRECTLY. prev_state_hash is the
// computed genesis hash (no canonical predecessor → validates on the normal
// non-genesis path); A10 (state-changing ⇒ non-empty evidence_refs) is satisfied by
// the ROOT_TASK_RECORD bootstrap sentinel binding the abort to its root task.
function emitAbortedRecord({ runId, personaId, schemaVersion, taskId, stateDir }) {
  const safeTaskId = sanitizeAgentId(taskId);
  if (safeTaskId.length === 0) {
    throw new Error(`trampoline: taskId did not sanitize to a valid ROOT_TASK_RECORD sentinel: ${JSON.stringify(taskId)}`);
  }
  const now = new Date().toISOString(); // one logical instant for both stamps (code-review LOW)
  const fields = {
    prev_state_hash: computeGenesisHash(schemaVersion, 'per-project'),
    writer_persona_id: personaId,
    // R6 is persona-internal (NOT a spawn) → a deterministic synthesized id in the
    // documented sp-<iso>-<persona>-<seq> shape (writer_spawn_id needs only minLength 1).
    writer_spawn_id: `sp-${now}-${personaId}-trampoline`,
    operation_class: 'CREATE',
    evidence_refs: [`ROOT_TASK_RECORD:${safeTaskId}`],
    intent_recorded_at: now,
    commit_outcome: 'ABORTED',
    abort_reason: ABORT_REASON_BUDGET,
    schema_version: schemaVersion,
  };
  // content-address: hash the body, then attach the id (computeTransactionId strips
  // transaction_id before hashing, so the spread order is immaterial). No
  // idempotency_key — a keyless ABORTED record is admissible (record-store.js:223,246).
  const record = { ...fields, transaction_id: computeTransactionId(fields) };
  const v = validateTransactionRecord(record);
  if (!v.valid) {
    throw new Error(`trampoline: built ABORTED record is invalid: ${(v.errors || []).join('; ')}`);
  }
  const appendResult = appendRecord(record, { runId, stateDir });
  if (!appendResult.ok) {
    throw new Error(`trampoline: appendRecord rejected the ABORTED record: ${appendResult.reason}`);
  }
  return { record, appendResult };
}

/**
 * Run a Pattern-A decomposition. Processes `leaves` serially, descending one
 * recursion level per leaf (nested folders), bounded by `maxDepth` (R10). Returns
 * `{outcome:'COMPLETED', leavesCompleted, checkpoint}` on a clean run, or
 * `{outcome:'ABORTED', abortedAtLeaf, depth, record, appendResult}` on budget exhaust.
 *
 * @param {object} opts
 * @param {string} opts.runId           run identifier (must resolve within run-state)
 * @param {string} opts.personaId       the persona running the trampoline
 * @param {string} opts.taskId          root task id (bound into the abort record's sentinel)
 * @param {Array<{id,content,discipline?}>} opts.leaves  the decomposition leaves
 * @param {number} opts.maxDepth        recursion-depth budget (positive integer)
 * @param {string} [opts.schemaVersion='v3']
 * @param {string} [opts.stateDir]      record-store root override (test isolation)
 */
function runTrampoline(opts) {
  const {
    runId, personaId, taskId, leaves, maxDepth,
    schemaVersion = DEFAULT_SCHEMA_VERSION, stateDir,
  } = opts || {};

  // runId RAW-token guard FIRST: runStateDir(runId) is path.join'd, and path.join
  // normalizes `..` away before a downstream checkWithinRoot can see it — so a
  // traversal runId (`a/../a`, `x/..`) must be rejected on the RAW string here, not
  // post-join (hacker-lens VULNERABLE: a post-join-only guard let `realrun/../realrun`
  // clobber `realrun`'s state). Mirrors record-store isSafeRunId; subsumes the
  // non-empty-string check.
  if (!isSafePathSegment(runId)) {
    throw new Error(`trampoline: runId ${JSON.stringify(runId)} is not a safe path segment — no separators or '..' allowed`);
  }
  if (typeof personaId !== 'string' || personaId.length === 0) {
    throw new Error('trampoline: personaId is required');
  }
  if (!Array.isArray(leaves) || leaves.length === 0) {
    throw new Error('trampoline: leaves must be a non-empty array');
  }
  if (leaves.length > MAX_LEAVES) {
    throw new Error(`trampoline: too many leaves (${leaves.length} > ${MAX_LEAVES}) — bounds the decomposition fan-out / folder nesting`);
  }
  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    throw new Error('trampoline: maxDepth must be a positive integer');
  }
  // taskId must sanitize to a non-empty ROOT_TASK_RECORD sentinel — validate UP FRONT,
  // not lazily on the abort path (which would leave a partial checkpoint with no
  // terminal record — code-review MEDIUM).
  if (typeof taskId !== 'string' || sanitizeAgentId(taskId).length === 0) {
    throw new Error(`trampoline: taskId ${JSON.stringify(taskId)} is required and must sanitize to a non-empty ROOT_TASK_RECORD sentinel`);
  }

  // Fail-fast (continued): each leaf's discipline is in the frozen R8 vocabulary,
  // and each leaf id is a safe single path segment (the nested-folder write surface).
  assertWithinRunState(runStateDir(runId), `unsafe runId "${runId}"`); // defense-in-depth
  for (const leaf of leaves) {
    if (leaf && leaf.discipline !== undefined && !isValidDiscipline(leaf.discipline)) {
      throw new Error(`trampoline: leaf "${leaf.id}" declares discipline "${leaf.discipline}" not in the frozen vocabulary [${DECOMPOSITION_DISCIPLINES.join(', ')}]`);
    }
    if (!isSafePathSegment(leaf && leaf.id)) {
      throw new Error(`trampoline: leaf id ${JSON.stringify(leaf && leaf.id)} is not a safe path segment — no separators or '..' allowed in a leaf folder name`);
    }
  }

  // Initialize the R7 checkpoint (also validates leaf structure + one-in_progress).
  writeCheckpoint(runId, leaves);

  let dir = path.join(runStateDir(runId), 'decomposition');
  let entered = 0;
  try {
    for (const leaf of leaves) {
      const depth = enterDepth(runId, maxDepth);
      entered += 1;
      if (depth.depthExhausted) {
        // Budget exhausted: emit the ABORTED record, leave this leaf pending, stop.
        const { record, appendResult } = emitAbortedRecord({ runId, personaId, schemaVersion, taskId, stateDir });
        return { outcome: 'ABORTED', abortedAtLeaf: leaf.id, depth, record, appendResult };
      }
      updateLeafStatus(runId, leaf.id, 'in_progress');
      dir = path.join(dir, leaf.id);
      assertWithinRunState(dir, `leaf "${leaf.id}" folder`);
      fs.mkdirSync(dir, { recursive: true });
      updateLeafStatus(runId, leaf.id, 'completed');
    }
    return { outcome: 'COMPLETED', leavesCompleted: leaves.length, checkpoint: readCheckpoint(runId) };
  } finally {
    // Unwind every level we entered — on the clean path, the abort path, AND any throw.
    for (let i = 0; i < entered; i += 1) exitDepth(runId);
  }
}

module.exports = { runTrampoline };
