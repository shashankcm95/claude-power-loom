'use strict';

// packages/kernel/_lib/k9-promote-deltas.js
//
// K9 — promote-deltas cherry-pick orchestration (v3.0-alpha, PR 3).
//
// SHIPS DORMANT: no production code imports this module in PR 3. Only test files
// (and the K9 CWE-22 fixtures) import it. CI job `dormancy-assertion-k9` greps
// packages/ (excluding tests/ + the k9-*.js module files themselves) for any
// production importer of k9-(path-guard|promote-deltas|journal) and BLOCKS the
// merge on a non-zero hit. PR 4 (post-spawn-resolver) is the first production
// importer and deletes the gate in the same commit.
//
// WHAT K9 DOES: cherry-pick a spawn-worktree delta SHA INTO the parent worktree,
// GATED by a pre-commit evidence-link check (INV-21). On conflict / gate FAIL,
// leave host state byte-for-byte pre-spawn (INV-K9-RejectFidelity).
//
// Mandatory-split orchestration role: imports the two leaves; owns the git
// transaction + the evidence pre-commit gate + the F12 chain-walk bound. DAG
// direction is orchestration → {path-guard, journal} (strictly; no leaf imports
// this file — Martin acyclic-dependencies / morning-after syndrome guard).
//
// ── F11 cherry-pick contract (verify-plan ROUND-2 LOCKED — do NOT regress) ──
//   * invoke `git cherry-pick <SHA>` DIRECTLY. NO `git apply --check` pre-check.
//   * on non-zero exit → `git cherry-pick --abort` (resets index AND worktree,
//     incl. any .orig/.rej it wrote — NO separate `git clean` needed). The
//     .orig/.rej-absence claim is verified EMPIRICALLY in the test (real tmp git
//     repo), not trusted; CI git version is unpinned.
//   * pass `-c core.hooksPath=/dev/null` to disable the spawn-worktree's
//     .git/hooks (vlad CWE-732 local-trust).
//   * ALL git via execFile-style ARG ARRAYS, never a shell string (vlad CWE-78).
//     Git is injected via opts.runGitFn (args[]) => {ok, code, stdout, stderr}
//     so pure unit tests never touch real git (K1 worktree-allocator pattern).
//     The default runner is the SHARED kernel primitive _lib/invoke-git.js —
//     K1 and K9 both consume it (PR 3 DRY extraction), so the no-shell CWE-78
//     guarantee + any future hardening lives in exactly one place. safe-exec.js
//     is node-only (hardcodes 'node') and is not git-shaped, so it is not reused.
//
// ── F12 (CWE-400) ── MAX_EVIDENCE_CHAIN_DEPTH bounds the pre-commit chain-walk.
// ── F9  (INV-21) ── the pre-commit gate calls validateTransactionRecord(record,
//   {isGenesisPosition}) from transaction-record.js. Genesis-position records
//   (chain head; prev_state_hash is a bootstrap sentinel) are ACCEPTED. A
//   bootstrap-sentinel / "GENESIS" prev_state_hash claimed at a NON-genesis
//   position (a forged genesis claim) is REJECTED, as is a state-changing record
//   with empty evidence_refs (A10). NOTE: v3.0-alpha does NOT verify evidence_ref
//   CONTENT — a garbage ref string at a valid hex prev_state_hash is not caught
//   here; per-ref content + chain-membership verification is v3.1 R10 scope. See
//   checkEvidenceLinkPreCommit's docstring for the precise guarantee boundary.
// ── CWE-22 ── every write path goes through k9-path-guard (→ K7 checkWithinRoot).

const pathGuard = require('./k9-path-guard');
const journal = require('./k9-journal');
const { runGitDefault } = require('./invoke-git');
const { validateTransactionRecord, isBootstrapSentinel, computeGenesisHash } = require('./transaction-record');

// F12 (eli-H3, CWE-400): bound on the pre-commit evidence chain-walk. Replaced
// by v3.1 R10 (full chain-integrity verifier). ADR-0011 §F12 records the
// rationale.
const MAX_EVIDENCE_CHAIN_DEPTH = 1000;

// The git args K9 prepends to every invocation to disable spawn-worktree hooks
// (CWE-732). Exposed so the test can assert they are present in the recorded
// git call.
const HOOKS_DISABLED_ARGS = Object.freeze(['-c', 'core.hooksPath=/dev/null']);

// git's "already applied / empty" signal — a cherry-pick of a commit the parent
// already has reports this on a non-zero exit. K9 treats it as an idempotent
// NOOP, not a hard failure (INV-K9-PromoteIdempotency). isAlreadyPresent checks
// BOTH streams because git splits the signal: "previous cherry-pick is now
// empty" → stderr; "nothing to commit" → stdout (git 2.50.1 observed). Matching
// is substring, lowercased; the runner is invoked with LANG=C so these English
// markers are locale-stable across CI runners. This is an interim heuristic —
// v3.1 R10 replaces it with a structural empty-state probe (git diff --quiet).
const ALREADY_PRESENT_MARKERS = [
  'previous cherry-pick is now empty', // stderr
  'cherry-pick is now empty',          // stderr (shorter phrasing variants)
  'nothing to commit',                 // stdout
];

/**
 * True iff a record sits at a genesis chain position. Used to terminate the
 * bounded chain-walk (line ~184) and to drive the isGenesisPosition validator
 * branch (F9). Recognizes THREE genesis prev_state_hash forms:
 *   1. the literal "GENESIS" marker,
 *   2. a bootstrap sentinel carried in prev_state_hash, and
 *   3. (OQ-2, P3a) prev_state_hash === computeGenesisHash(schema_version, scope) —
 *      the form the genesis PRODUCERS actually emit (quarantine-promote's
 *      buildGenesisRecord/buildSpawnRecord set prev = computeGenesisHash(schema,
 *      'per-project'), a 64-hex hash that forms 1+2 do NOT match).
 *
 * OQ-2 (the bug this closes): before P3a, the live chain-walk resolved a producer
 * genesis record as a parent, isGenesisPosition returned false (its 64-hex prev is
 * neither "GENESIS" nor a sentinel), the walk kept going, resolveParent(that hash)
 * returned null, and the chain was REJECTED as 'chain-bottomed-out-non-genesis'.
 *
 * Why EXACT computeGenesisHash equality, not the two rejected alternatives
 * (verify-plan architect Ch5 + the P3a TDD-RED blast-radius probe):
 *   - NOT "any 64-hex prev = genesis": every NON-genesis record's prev is a 64-hex
 *     state hash, so that would make the entire chain look like genesis.
 *   - NOT "evidence_refs[0] is a bootstrap sentinel": records legitimately carry a
 *     USER_INTENT_AXIOM / GENESIS_EVIDENCE evidence_ref at a NON-genesis position
 *     (validRecord()'s own default evidence is USER_INTENT_AXIOM), so keying on the
 *     evidence ref would reclassify them and break the walk.
 * computeGenesisHash is keyed to (schema_version, scope) with scope a 2-element
 * domain {per-project, per-user}; schema_version is carried in the record, so we
 * recompute both and compare exactly. This is purely ADDITIVE (Open/Closed) — forms
 * 1+2 are unchanged, and no record with a real state-hash prev is reclassified.
 *
 * NOTE this does NOT weaken the forged-genesis gate: checkEvidenceLinkPreCommit
 * step 1 still validates the HEAD record via validateTransactionRecord with the
 * CALLER's isGenesisPosition flag (a separate function, untouched), which rejects a
 * sentinel/"GENESIS" prev claimed at a non-genesis position. Genesis stays a
 * STRUCTURAL position-recognizer; provenance is gated elsewhere (human review).
 *
 * @param {object} record
 * @returns {boolean}
 */
function isGenesisPosition(record) {
  if (!record || typeof record !== 'object') return false;
  const prev = record.prev_state_hash;
  if (prev === 'GENESIS' || isBootstrapSentinel(prev)) return true;
  // OQ-2: recognize the producer's prev = computeGenesisHash(schema_version, scope).
  const schema = record.schema_version;
  if (typeof prev === 'string' && typeof schema === 'string' && schema.length > 0) {
    if (prev === computeGenesisHash(schema, 'per-project')) return true;
    if (prev === computeGenesisHash(schema, 'per-user')) return true;
  }
  return false;
}

/**
 * Pre-commit evidence-link gate (INV-21-EvidenceLinkPreCommit). Validates the
 * head record via validateTransactionRecord(record, {isGenesisPosition}) (F9),
 * then walks the evidence chain via the injected resolveParent seam to a genesis
 * position, BOUNDED by MAX_EVIDENCE_CHAIN_DEPTH (F12 / CWE-400) and short-circuit
 * on a repeated prev_state_hash (cycle guard).
 *
 * WHAT THIS GATE ACTUALLY GUARANTEES (honesty — PR 3 architect HIGH): it rejects
 *   (a) a head record that fails structural validation, INCLUDING a
 *       bootstrap-sentinel / "GENESIS" prev_state_hash claimed at a NON-genesis
 *       position (a forged genesis claim) and a state-changing record with EMPTY
 *       evidence_refs (A10), and
 *   (b) a non-genesis chain that bottoms out off-genesis, cycles, or exceeds the
 *       depth bound.
 * It does NOT (v3.0-alpha) verify evidence_refs CONTENT — i.e. it does not check
 * that a non-empty evidence_ref is a real, chain-resolvable reference vs a
 * fabricated string. Per-ref content verification (hash validity + chain
 * membership) is v3.1 R10 scope. So "forged evidence_refs are rejected" holds
 * ONLY for the forged-genesis-position class above, not for a garbage ref string
 * carried at a valid hex prev_state_hash. The comments here are deliberately
 * narrow to what the code enforces.
 *
 * Fail-CLOSED on the chain-walk seam (PR 3 code-review PRINCIPLE / DIP): a
 * non-genesis record with NO resolveParent supplied is REJECTED, not silently
 * accepted at depth 0 — an unwalkable non-genesis chain has unverified
 * provenance. Genesis-position records terminate before reaching the seam.
 *
 * F20 recovery-sweep sentinel (ADR-0011 §F20-recovery-sweep-sentinel / eli-M2):
 * when the record carries `is_recovery_sweep: true`, the evidence-link walk is
 * SKIPPED entirely. A recovery-sweep promotes a crashed spawn's already-recorded
 * delta whose chain provenance the sweep cannot re-walk (the parent records may
 * be the very PENDING entries being reclassified) — without the skip K9 would
 * circularly reject every sweep record. The skip is the ONLY behavioral change;
 * a record WITHOUT the flag is validated exactly as before (non-vacuous: a
 * fail-closed unwalkable-chain record passes ONLY with the flag).
 *
 * @param {object} opts
 * @param {object} opts.record            the transaction record being promoted
 * @param {boolean} [opts.isGenesisPosition=false]
 * @param {boolean} [opts.is_recovery_sweep=false]  F20 sentinel — skip the gate
 * @param {function} [opts.resolveParent] (hash) => parentRecord|null — chain-walk seam
 * @returns {{ok: boolean, reason: string|null, depthWalked: number}}
 */
function checkEvidenceLinkPreCommit(opts) {
  if (!opts || typeof opts !== 'object' || !opts.record) {
    return { ok: false, reason: 'missing-record', depthWalked: 0 };
  }
  // F20: a recovery-sweep record bypasses the evidence-link walk (it has no
  // re-walkable provenance — the sweep is the recovery path, not a fresh commit).
  if (opts.is_recovery_sweep === true) {
    return { ok: true, reason: null, depthWalked: 0 };
  }
  const atGenesis = !!opts.isGenesisPosition;
  // 1. Validate the head record. F9: pass the genesis-position flag so a
  //    bootstrap-sentinel prev_state_hash is accepted ONLY at genesis. A
  //    "GENESIS" marker at a non-genesis position fails the 64-char-hex contract
  //    here (this is the forged-genesis rejection the test exercises).
  const headValidation = validateTransactionRecord(opts.record, { isGenesisPosition: atGenesis });
  if (!headValidation.valid) {
    return { ok: false, reason: 'head-record-invalid: ' + headValidation.errors.join('; '), depthWalked: 0 };
  }
  // 2. If the head is itself at genesis position, the chain terminates here —
  //    accept without walking.
  if (atGenesis || isGenesisPosition(opts.record)) {
    return { ok: true, reason: null, depthWalked: 0 };
  }
  // 3. Non-genesis record: a resolveParent seam is REQUIRED to walk provenance.
  //    Absent → fail-closed (DIP fix): we cannot verify the chain reaches
  //    genesis, so we must not silently admit it.
  if (typeof opts.resolveParent !== 'function') {
    return { ok: false, reason: 'missing-resolve-parent-for-non-genesis-record', depthWalked: 0 };
  }
  // 4. Bounded chain-walk (F12 / CWE-400) with cycle short-circuit. The seen-set
  //    rejects an adversarial cycle (e.g. A→B→A) on the first repeated hash
  //    rather than burning all MAX_EVIDENCE_CHAIN_DEPTH resolveParent calls.
  const seen = new Set();
  let depthWalked = 0;
  let cursor = opts.record;
  while (depthWalked < MAX_EVIDENCE_CHAIN_DEPTH) {
    const prevHash = cursor.prev_state_hash;
    if (seen.has(prevHash)) {
      return { ok: false, reason: 'evidence-chain-cycle-detected', depthWalked };
    }
    seen.add(prevHash);
    const parent = opts.resolveParent(prevHash);
    depthWalked += 1;
    if (!parent) {
      // Chain bottomed out without reaching genesis — incomplete provenance.
      return { ok: false, reason: 'chain-bottomed-out-non-genesis', depthWalked };
    }
    if (isGenesisPosition(parent)) {
      return { ok: true, reason: null, depthWalked };
    }
    cursor = parent;
  }
  // 5. Exceeded the bound without terminating at genesis (CWE-400 guard).
  return { ok: false, reason: 'evidence-chain-exceeds-max-depth', depthWalked };
}

/**
 * Best-effort parent HEAD sha via `git rev-parse HEAD`. Never throws; returns a
 * sentinel when git can't answer (the journal records the attempt regardless).
 */
function readHeadSha(runGit) {
  const res = runGit(['rev-parse', 'HEAD']);
  const out = (res && res.ok && typeof res.stdout === 'string') ? res.stdout.trim() : '';
  return out.length > 0 ? out : 'unknown';
}

/**
 * Best-effort byte snapshot of the candidate file. Returns a Buffer or null
 * (file absent). Used to assert host-unchanged on the reject/noop paths.
 */
function snapshotHost(candidatePath) {
  try {
    return require('fs').readFileSync(candidatePath);
  } catch {
    return null;
  }
}

/**
 * Whether two host snapshots are byte-identical (both-null counts as unchanged).
 */
function hostUnchangedBetween(before, after) {
  if (before === null && after === null) return true;
  if (before === null || after === null) return false;
  return before.equals(after);
}

/**
 * Fail-soft journal emission (ADR-0001 discipline — audit never blocks the
 * operation). Builds + appends the entry; on any error returns the built entry
 * (or null) without throwing, so a journal-write failure cannot corrupt the
 * promote result.
 */
function recordOutcome(journalPath, fields) {
  let entry = null;
  try {
    entry = journal.buildJournalEntry(fields);
    if (journalPath) journal.appendJournalEntry(journalPath, entry);
  } catch {
    // best-effort: never let a journal failure mask the promote outcome
  }
  return entry;
}

/**
 * Classify a non-zero cherry-pick result: NOOP_ALREADY_PRESENT (git "empty"
 * signal) vs a genuine conflict that must be aborted. The signal can land on
 * EITHER stream (git emits "previous cherry-pick is now empty" to stderr and
 * "nothing to commit" to stdout), so both are checked — runGitDefault returns ''
 * for stdout on a non-zero exit, but an injected runGitFn may populate it, and a
 * future git could move the marker. The runner is invoked with LANG=C upstream
 * so the English markers are locale-stable.
 */
function isAlreadyPresent(result) {
  const streams = [
    (result && typeof result.stderr === 'string') ? result.stderr.toLowerCase() : '',
    (result && typeof result.stdout === 'string') ? result.stdout.toLowerCase() : '',
  ];
  return streams.some((s) => ALREADY_PRESENT_MARKERS.some((m) => s.indexOf(m) !== -1));
}

/**
 * Shared REJECTED_REQUEST shape (CWE-22 admission failures). No git ran and no
 * host bytes were read, so the host is trivially unchanged.
 */
function rejectedRequest(reason, depthWalked) {
  return {
    promoted: false, outcome: 'REJECTED_REQUEST', reason,
    aborted: false, hostUnchanged: true, candidateUnchanged: true,
    journalEntry: null, depthWalked,
  };
}

/**
 * Classify + handle a NON-clean cherry-pick result (the cherry-pick already
 * returned !ok). Owns the NOOP-vs-conflict decision, the fail-closed --abort
 * (with hooks disabled on the rollback path), and the ABORT_UNCONFIRMED honesty
 * outcome. Split out of promoteDelta so each function has one responsibility
 * (kb:architecture/crosscut/single-responsibility) and stays small.
 *
 * @param {object} ctx {cherry, runGit, deltaSha, parentRoot, candidatePath, journalPath, preStateHash, hostBefore, depthWalked}
 * @returns {object} the promoteDelta result object for the non-clean path.
 */
function resolveCherryOutcome(ctx) {
  const {
    cherry, runGit, deltaSha, parentRoot, candidatePath, journalPath,
    preStateHash, hostBefore, depthWalked,
  } = ctx;

  // NOOP path: an "already present / empty" result means git did NOT enter a
  // mid-cherry-pick conflict state — there is nothing to abort. Issuing
  // `--abort` here would return non-zero ("no cherry-pick in progress") and
  // pollute the result, so we SKIP it (security LOW). Host was never mutated.
  if (isAlreadyPresent(cherry)) {
    const candidateUnchanged = hostUnchangedBetween(hostBefore, snapshotHost(candidatePath));
    const entry = recordOutcome(journalPath, {
      promoted_sha: deltaSha, pre_state_hash: preStateHash, post_state_hash: null,
      worktree_root: parentRoot, outcome: 'NOOP_ALREADY_PRESENT', abort_reason: null,
    });
    return {
      promoted: false, outcome: 'NOOP_ALREADY_PRESENT', reason: 'delta-already-present',
      aborted: false, hostUnchanged: candidateUnchanged, candidateUnchanged,
      journalEntry: entry, depthWalked,
    };
  }

  // Genuine conflict → abort to restore the host. F11/CWE-732: --abort carries
  // HOOKS_DISABLED_ARGS too — it performs a checkout-like reset that can fire a
  // post-checkout hook in parentRoot, so the no-hooks contract must hold on the
  // rollback path (the exact path an attacker would target), not just the
  // forward cherry-pick. Fail-CLOSED on the abort itself: if it throws
  // (INV-K9-SyntacticAtomicity crash injection) we swallow it — K9 never mutated
  // the host file, so it remains the pre-state ({pre, post} guarantee) and the
  // journal still records the attempt. We never rethrow a partial state.
  let aborted = false;
  let abortError = null;
  try {
    const ab = runGit(HOOKS_DISABLED_ARGS.concat(['cherry-pick', '--abort']));
    aborted = !!(ab && ab.ok);
  } catch (err) {
    abortError = err && err.message ? err.message : String(err);
  }

  const candidateUnchanged = hostUnchangedBetween(hostBefore, snapshotHost(candidatePath));

  // Whole-tree reject-fidelity (INV-K9-RejectFidelity) depends on the abort
  // SUCCEEDING. If the abort did not confirm (returned !ok, or crashed), the
  // candidate file may happen to be unchanged while OTHER worktree files retain
  // conflict state — so we MUST NOT report this as a clean reject. Surface a
  // distinct ABORT_UNCONFIRMED outcome (MEDIUM) so the caller re-verifies /
  // hard-resets rather than trusting the single-file snapshot.
  if (!aborted) {
    const reason = abortError
      ? 'cherry-pick-conflict-abort-crashed: ' + abortError
      : 'cherry-pick-conflict-abort-unconfirmed';
    const entry = recordOutcome(journalPath, {
      promoted_sha: deltaSha, pre_state_hash: preStateHash, post_state_hash: null,
      worktree_root: parentRoot, outcome: 'ABORTED', abort_reason: reason,
    });
    return {
      promoted: false, outcome: 'ABORT_UNCONFIRMED', reason,
      aborted: false, hostUnchanged: candidateUnchanged, candidateUnchanged,
      journalEntry: entry, depthWalked,
    };
  }

  // Genuine conflict, abort confirmed → ABORTED. host byte-for-byte pre-spawn.
  const abortReason = 'cherry-pick-conflict-aborted';
  const entry = recordOutcome(journalPath, {
    promoted_sha: deltaSha, pre_state_hash: preStateHash, post_state_hash: null,
    worktree_root: parentRoot, outcome: 'ABORTED', abort_reason: abortReason,
  });
  return {
    promoted: false, outcome: 'ABORTED', reason: abortReason,
    aborted: true, hostUnchanged: candidateUnchanged, candidateUnchanged,
    journalEntry: entry, depthWalked,
  };
}

/**
 * Promote a single delta SHA from a spawn worktree into the parent, gated by the
 * evidence pre-commit check and scoped by CWE-22. On conflict or gate FAIL, abort
 * so the host is byte-for-byte pre-spawn (INV-K9-RejectFidelity), then record the
 * outcome in the append-only reverse-cherrypick journal.
 *
 * Idempotent: re-promoting a SHA the parent already has is a safe NOOP
 * (INV-K9-PromoteIdempotency) — journal records NOOP_ALREADY_PRESENT, host
 * unchanged.
 *
 * Returned `hostUnchanged` / `candidateUnchanged` are the SAME value and report
 * ONLY the candidatePath snapshot (a single file), NOT the whole worktree —
 * whole-tree reject-fidelity (INV-K9-RejectFidelity) is delivered by `git
 * cherry-pick --abort` resetting index+worktree, which is asserted empirically in
 * the F11 real-git test. When the conflict abort does NOT confirm (`aborted ===
 * false` on a genuine conflict) the outcome is ABORT_UNCONFIRMED so a caller does
 * not read a single-file snapshot as a whole-tree-clean verdict.
 *
 * @param {object} opts  (see param block on each field below)
 * @returns {{promoted: boolean, outcome: string, reason: string, aborted: boolean, hostUnchanged: boolean, candidateUnchanged: boolean, journalEntry: object|null, depthWalked: number}}
 */
function promoteDelta(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new Error('K9 promoteDelta: opts object is required');
  }
  const {
    deltaSha, parentRoot, candidatePath, record, journalPath, resolveParent,
  } = opts;
  const atGenesis = !!opts.isGenesisPosition;
  const runGit = typeof opts.runGitFn === 'function'
    ? opts.runGitFn
    : ((args) => runGitDefault(parentRoot, args));

  // ── Gate 1: request admission (CWE-22 path scope + SHA shape). Fail-closed,
  //    BEFORE any side effect. The host snapshot is taken AFTER this gate so a
  //    path-traversal candidatePath ('../../etc/passwd') is rejected WITHOUT its
  //    bytes ever being read into memory (PR 3 code-review HIGH — info-disclosure
  //    window). journalPath is scope-checked too (it is an ancillary write path
  //    that would otherwise bypass the CWE-22 gate — security MEDIUM). ─────────
  const admit = pathGuard.admitPromoteRequest({ candidatePath, worktreeRoot: parentRoot, deltaSha });
  if (!admit.ok) {
    return rejectedRequest(admit.reason, 0);
  }
  if (journalPath != null && journalPath !== '') {
    const journalScope = pathGuard.checkWritePathInScope(journalPath, parentRoot);
    if (!journalScope.ok) {
      return rejectedRequest('journal-path-out-of-scope: ' + journalScope.reason, 0);
    }
  }

  // ── Gate 2: evidence pre-commit (INV-21 / F9 / F12). No git if this fails. ──
  //    F20: a recovery-sweep promote threads is_recovery_sweep through so the
  //    gate is skipped (the sweep record has no re-walkable provenance).
  const gate = checkEvidenceLinkPreCommit({
    record, isGenesisPosition: atGenesis, resolveParent, is_recovery_sweep: opts.is_recovery_sweep === true,
  });
  if (!gate.ok) {
    return {
      promoted: false, outcome: 'REJECTED_EVIDENCE', reason: gate.reason,
      aborted: false, hostUnchanged: true, candidateUnchanged: true,
      journalEntry: null, depthWalked: gate.depthWalked,
    };
  }

  // Both gates passed — NOW it is safe to snapshot the candidate file (post-gate
  // success path is the only path where the snapshot is meaningful).
  const hostBefore = snapshotHost(candidatePath);
  const preStateHash = readHeadSha(runGit);

  // ── The git transaction: cherry-pick the delta into the parent. F11/CWE-78/
  //    CWE-732: arg array + hooksPath disabled + direct cherry-pick. ──────────
  const cherryArgs = HOOKS_DISABLED_ARGS.concat(['cherry-pick', deltaSha]);
  const cherry = runGit(cherryArgs);

  if (cherry && cherry.ok) {
    // Clean apply — host advanced. PROMOTED.
    const postStateHash = readHeadSha(runGit);
    const entry = recordOutcome(journalPath, {
      promoted_sha: deltaSha, pre_state_hash: preStateHash, post_state_hash: postStateHash,
      worktree_root: parentRoot, outcome: 'PROMOTED', abort_reason: null,
    });
    return {
      promoted: true, outcome: 'PROMOTED', reason: 'cherry-pick-clean',
      aborted: false, hostUnchanged: false, candidateUnchanged: false,
      journalEntry: entry, depthWalked: gate.depthWalked,
    };
  }

  // Non-clean exit → classify (NOOP vs conflict), abort if needed, build result.
  return resolveCherryOutcome({
    cherry, runGit, deltaSha, parentRoot, candidatePath, journalPath,
    preStateHash, hostBefore, depthWalked: gate.depthWalked,
  });
}

// A git object name is 40 (sha1) or 64 (sha256) lowercase hex chars. Duplicated
// from k9-journal's PROMOTED_SHA_PATTERN intentionally: rollbackPromotion is a
// CWE-78 boundary and must validate the SHA shape LOCALLY before any git runs,
// not depend on the journal module's build-time guard having fired first
// (defense-in-depth — boundary validation must not be call-order-dependent).
const ROLLBACK_SHA_PATTERN = /^[a-f0-9]{40}$|^[a-f0-9]{64}$/;

/**
 * Reverse a prior promote (ADR-0011 §recovery-replay — the recovery executor the
 * post-spawn-resolver / recovery-sweep consume when an undo is needed). Runs
 * `git revert --no-edit <promotedSha>` in worktreeRoot via the no-shell arg-array
 * seam (CWE-78) with hooks disabled (CWE-732), then appends a REVERTED entry to
 * the append-only journal (INV-19 forward-only undo ledger — the undo is itself
 * recorded, never a history rewrite).
 *
 * SECURITY (CWE-78, the load-bearing contract): `promotedSha` is the hex-validated
 * FIELD. It is validated HERE (fail-closed: reject a non-hex / shell-metachar SHA
 * BEFORE any git runs) and passed as a DISCRETE argv element. The journal's
 * `reverse_op_description` string is DOCUMENTATION ONLY and is NEVER handed to a
 * shell-interpreting function — a stored description carrying `'; rm -rf /'` is
 * inert because only the arg-array `['revert','--no-edit', <sha>]` ever executes.
 *
 * Fail-soft on the journal write (ADR-0001 — audit never blocks the operation):
 * the revert result is reported even if the REVERTED entry fails to append.
 *
 * @param {object} opts
 * @param {string} opts.worktreeRoot   the parent worktree the promote landed in
 * @param {string} opts.promotedSha    the hex SHA that was promoted (the FIELD)
 * @param {string} [opts.journalPath]  append-only journal to record the REVERTED entry
 * @param {function} [opts.runGitFn]   (args[]) => {ok,code,stdout,stderr} seam; default invoke-git
 * @returns {{reverted: boolean, reason: string, code: number, journalEntry: object|null}}
 */
function rollbackPromotion(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new Error('K9 rollbackPromotion: opts object is required');
  }
  const { worktreeRoot, promotedSha, journalPath } = opts;
  const runGit = typeof opts.runGitFn === 'function'
    ? opts.runGitFn
    : ((args) => runGitDefault(worktreeRoot, args));

  // Fail-closed SHA-shape guard at the executor boundary. A metachar / non-hex
  // SHA is rejected BEFORE any git runs (the recorder asserts call-count 0).
  if (typeof promotedSha !== 'string' || !ROLLBACK_SHA_PATTERN.test(promotedSha)) {
    return { reverted: false, reason: 'invalid-promoted-sha', code: -1, journalEntry: null };
  }

  // CWE-78 / CWE-732: arg array + hooks disabled. The SHA is a discrete argv
  // element — no shell, no string concatenation, no description-string exec.
  const revertArgs = HOOKS_DISABLED_ARGS.concat(['revert', '--no-edit', promotedSha]);
  const res = runGit(revertArgs);
  const ok = !!(res && res.ok);

  // INV-19: record the undo as a forward REVERTED entry (fail-soft journal). The
  // revert creates a new commit; its post-state hash is not read back here (the
  // resolver re-derives HEAD if it needs it), so post_state_hash is left null.
  const entry = recordOutcome(journalPath, {
    promoted_sha: promotedSha, pre_state_hash: 'unknown', post_state_hash: null,
    worktree_root: worktreeRoot, outcome: 'REVERTED', abort_reason: null,
  });

  return {
    reverted: ok,
    reason: ok ? 'revert-clean' : 'revert-failed',
    code: (res && typeof res.code === 'number') ? res.code : -1,
    journalEntry: entry,
  };
}

module.exports = {
  checkEvidenceLinkPreCommit,
  promoteDelta,
  rollbackPromotion,
  isGenesisPosition,
  runGitDefault,
  MAX_EVIDENCE_CHAIN_DEPTH,
  HOOKS_DISABLED_ARGS,
};
