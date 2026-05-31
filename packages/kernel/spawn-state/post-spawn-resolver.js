'use strict';

// packages/kernel/spawn-state/post-spawn-resolver.js
//
// PR-4b INTEGRATION — the post-spawn-resolver: the FIRST production importer of
// K9 (promote-deltas) + K13 (serial-enforcer) + K14 (write-scope orchestrator).
// Importing K9 here ends K9's dormancy (the dormancy-assertion-k9 CI gate is
// deleted by the orchestrator in the same PR — NOT here; this module is kernel-
// only per the 4b scope split).
//
// WHAT IT DOES: at spawn-close, decide the fate of a spawn's recorded delta by
// running the SINGLE authoritative transition table (ADR-0011 §canonical-resolver-
// table) encoded AS DATA — a frozen map from a K9 outcome code → {action, audit}.
// The resolver-SRP finding forbids an if/else state machine: the six K9 outcomes
// dispatch through RESOLVER_TABLE so the completeness (no unhandled default) is a
// data property the test can inspect, not a branch coverage claim.
//
// The decision spine (ADR-0011 §canonical-resolver-table rows, in precedence):
//   1. INV-20-TwoPhaseCommitClosure — a PENDING envelope with no COMMITTED is an
//      un-closed spawn: resolve ABORTED + write a WAL ABORTED record carrying the
//      SAME spawn_id. K9 is NEVER entered (the spawn never committed its intent).
//   2. K14 scope gate — detectWriteScopeViolations(ctx) (the orchestrator FACADE
//      only; never a K14 leaf). detect THROWS → fail-closed ABORTED, no K9. A
//      non-empty violation set with no override → REJECT_SCOPE, K9 not entered.
//      With LOOM_ALLOW_OUT_OF_SCOPE_WRITES (passed as an explicit opt — F23, not
//      env-sniffed in the pure path) → K9 IS entered, audited Class-4.
//   3. K9 promote — promoteDelta(...) returns one of six outcome codes; the table
//      maps each. NOOP_ALREADY_PRESENT resolves to terminal ACCEPT with NO 2nd
//      promote/runGit (the delta is already present — re-cherry-picking is a bug).
//      ABORT_UNCONFIRMED triggers the whole-tree `git status --porcelain` verify
//      (clean → REJECT_CONFLICT | dirty → HARD_RESET + Class-4) because a single-
//      file snapshot is NOT a whole-tree-clean verdict.
//   4. K13 marker release — ALWAYS, regardless of action (the spawn is closing).
//      The release id is sourced by READING THE MARKER (readMarker), NOT the
//      envelope spawn_id (ADR-0011 §K13-spawn-id-provenance): the envelope id is
//      UUID-keyed and can never equal the marker's admission id, so passing it
//      silently no-ops the release and the marker persists to age-reap, blocking
//      all spawns. Under serial-only there is ≤1 active marker, so read-then-
//      release matches the owner-check by construction.
//
// DATA-DRIVEN, NOT CONTROL-FLOW: the K9-outcome → action mapping is the frozen
// RESOLVER_TABLE below. The dispatch is a single table lookup; the only genuine
// branch is ABORT_UNCONFIRMED's whole-tree probe (a sub-decision the table marks
// with verify:'whole-tree', resolved by a dedicated helper).
//
// All K9/K13/K14 dependencies are INJECTABLE seams (F23 — no env-var trigger in
// the pure path; clocks/locks/git all passed as functions). Immutability: the
// resolver builds NEW result objects and never mutates the envelope or opts.

const os = require('os');
const path = require('path');
const k9 = require('../_lib/k9-promote-deltas');
const k13 = require('../enforcement/k13-serial-enforcer');
const k14 = require('../_lib/k14-write-scope');
const { appendWalRecord } = require('../_lib/wal-append');

// ── §canonical-resolver-table — the SINGLE authoritative transition table, AS
//    DATA. Keyed by K9 outcome code. Every one of K9's six outcomes appears
//    exactly once (the resolver-SRP no-unhandled-default guarantee is a data
//    property — the test serializes this object and asserts all six are present).
//    `verify: 'whole-tree'` marks the ABORT_UNCONFIRMED row as needing the
//    `git status --porcelain` sub-decision (clean/dirty resolved at dispatch).
const RESOLVER_TABLE = Object.freeze({
  PROMOTED: Object.freeze({ action: 'PROMOTE', audit: 'promote-ok' }),
  NOOP_ALREADY_PRESENT: Object.freeze({ action: 'ACCEPT', audit: 'promote-noop' }),
  ABORTED: Object.freeze({ action: 'REJECT_CONFLICT', audit: 'reject-cherry-conflict' }),
  ABORT_UNCONFIRMED: Object.freeze({ action: 'WHOLE_TREE_VERIFY', audit: 'abort-unconfirmed', verify: 'whole-tree' }),
  REJECTED_EVIDENCE: Object.freeze({ action: 'REJECT_EVIDENCE', audit: 'reject-evidence' }),
  REJECTED_REQUEST: Object.freeze({ action: 'REJECT_REQUEST', audit: 'reject-request' }),
});

// Non-K9 terminal rows (the crash/scope spine cells of §canonical-resolver-table).
// Kept as data too so every disposition is inspectable in one place.
const SCOPE_REJECT = Object.freeze({ action: 'REJECT_SCOPE', audit: 'reject-scope-violation' });
const OVERRIDE_PROMOTE = Object.freeze({ action: 'PROMOTE_WITH_AUDIT', audit: 'override-allowed' });
const TWO_PHASE_ABORTED = Object.freeze({ action: 'ABORTED', audit: 'two-phase-commit-not-closed' });
const K14_FAILED_ABORTED = Object.freeze({ action: 'ABORTED', audit: 'k14-detection-failed' });

// WAL append uses the shared _lib/wal-append primitive with failSoft:true — a WAL
// write failure must NEVER mask the resolver verdict (ADR-0001 fail-soft). The
// shared utility (kb:architecture/crosscut/single-responsibility) is the one place
// the read-modify-rewrite append + its failure contract live; the recovery-sweep
// uses the same utility with a per-orphan-isolated (fail-hard) call instead.
function appendResolverWal(walPath, record) {
  if (typeof walPath !== 'string' || walPath.length === 0) return;
  appendWalRecord(walPath, record, { failSoft: true });
}

/**
 * Fail-soft audit emit through the injected seam. A thrown auditFn (a bad
 * collector) must never change the resolver's decision.
 */
function emitAudit(auditFn, record) {
  if (typeof auditFn !== 'function') return;
  try { auditFn(record); } catch { /* audit never blocks (ADR-0001) */ }
}

/**
 * Is the spawn's two-phase commit closed? An envelope is "closed" when its
 * commit_outcome is COMMITTED. A PENDING (or absent) outcome with no committed_at
 * is an un-closed spawn (crash between intent and commit) — INV-20 resolves it to
 * ABORTED rather than promoting an intent the spawn never committed.
 */
function isTwoPhaseClosed(envelope) {
  return envelope && envelope.commit_outcome === 'COMMITTED';
}

/**
 * Resolve the single git runner ONCE per resolve() call. Either the injected
 * `runGitFn` seam, or a default bound to the envelope's worktree_root via
 * k9.runGitDefault. Threaded to BOTH dispatchPromote (cherry-pick) and
 * resolveAbortUnconfirmed (whole-tree probe/reset) so the worktree_root→runner
 * derivation lives in exactly one place (kb:architecture/crosscut/single-
 * responsibility — no two divergent default-runner construction sites).
 */
function resolveRunGit(opts) {
  if (typeof opts.runGitFn === 'function') return opts.runGitFn;
  const worktreeRoot = opts.envelope && opts.envelope.worktree_root;
  return (args) => k9.runGitDefault(worktreeRoot, args);
}

/**
 * The ABORT_UNCONFIRMED whole-tree sub-decision (ADR-0011 §recovery-replay row).
 * A conflict whose `cherry-pick --abort` did not CONFIRM may have left OTHER
 * worktree files dirty even if the single candidate file looks clean — so the
 * resolver runs `git status --porcelain` (whole-tree fidelity, NOT a single-file
 * snapshot). Clean (empty porcelain) → REJECT_CONFLICT. Dirty → HARD_RESET (a
 * `git reset --hard` to restore the tree) + a Class-4 audit (the highest-severity
 * reject path). `runGit` is the single resolved runner from resolveRunGit().
 *
 * @returns {{action: string, audit: string}}
 */
function resolveAbortUnconfirmed(ctx) {
  const { runGit, auditFn, spawnId } = ctx;

  const status = runGit(['status', '--porcelain']);
  const porcelain = (status && typeof status.stdout === 'string') ? status.stdout.trim() : '';

  if (porcelain.length === 0) {
    // Whole tree is clean — the abort effectively held. Reject the conflict.
    return { action: 'REJECT_CONFLICT', audit: 'abort-unconfirmed-worktree-clean' };
  }

  // Dirty whole tree — hard-reset to restore it, and raise a Class-4 alert.
  runGit(k9.HOOKS_DISABLED_ARGS.concat(['reset', '--hard', 'HEAD']));
  emitAudit(auditFn, {
    class: 4,
    kind: 'abort-unconfirmed-worktree-dirty',
    spawn_id: spawnId,
    porcelain_excerpt: porcelain.slice(0, 500),
  });
  return { action: 'HARD_RESET', audit: 'abort-unconfirmed-worktree-dirty' };
}

// Default state dir for the K13 marker (consistent with k13-serial-enforcer +
// spawn-record): ~/.claude/spawn-state, overridable via LOOM_SPAWN_STATE_DIR for
// hermetic tests. Resolved lazily inside the default seams so a test that injects
// readMarkerFn/releaseSerialMarkerFn never touches the real filesystem.
function defaultStateDir() {
  return process.env.LOOM_SPAWN_STATE_DIR || path.join(os.homedir(), '.claude', 'spawn-state');
}

/**
 * Release the K13 serial marker for the closing spawn. Sources the admission id
 * by READING THE MARKER (§K13-spawn-id-provenance) so the owner-check matches by
 * construction; falls back to the envelope spawn_id ONLY when no marker can be
 * read (best-effort). The read + release default to the real K13 primitives
 * (k13.readMarker / k13.releaseSerialMarker) — this is what makes the resolver a
 * genuine production importer of K13 — but BOTH are injectable seams (the tests
 * wire the real K13 against a hermetic state dir; a unit test can stub them).
 * Fail-soft: a release failure is surfaced in the result but never throws into
 * the decision path.
 *
 * @returns {{released: boolean, reason: string}}
 */
function releaseK13Marker(opts) {
  const { envelope } = opts;
  // F23: defer the LOOM_SPAWN_STATE_DIR env read INTO the default closures, so a
  // fully-seamed call (both readMarkerFn + releaseSerialMarkerFn injected) never
  // consults process.env at all — the env var is read ONLY when a default closure
  // actually runs and neither opts.stateDir nor that seam was provided.
  const resolveStateDir = () => opts.stateDir || defaultStateDir();
  const readMarkerFn = typeof opts.readMarkerFn === 'function'
    ? opts.readMarkerFn
    : (() => k13.readMarker(k13.markerPathFor(resolveStateDir())));
  const releaseSerialMarkerFn = typeof opts.releaseSerialMarkerFn === 'function'
    ? opts.releaseSerialMarkerFn
    : ((o) => k13.releaseSerialMarker({ stateDir: resolveStateDir(), spawnId: o.spawnId }));

  let markerId = null;
  try {
    const marker = readMarkerFn();
    if (marker && typeof marker.spawn_id === 'string') markerId = marker.spawn_id;
  } catch {
    markerId = null; // unreadable marker → fall back to envelope id below
  }
  // §K13-spawn-id-provenance: prefer the marker-sourced admission id. The
  // envelope spawn_id is the documented WRONG key (UUID-keyed; never the
  // marker's admission id) — only used as a last resort when no marker exists.
  const spawnId = markerId != null ? markerId : (envelope && envelope.spawn_id);
  try {
    const res = releaseSerialMarkerFn({ spawnId });
    return (res && typeof res === 'object')
      ? { released: res.released === true, reason: res.reason || 'release-attempted' }
      : { released: false, reason: 'release-no-result' };
  } catch {
    return { released: false, reason: 'release-threw' };
  }
}

/**
 * Decide the K9-or-pre-K9 action for a CLOSED, scope-checked spawn. Returns the
 * {action, audit} row plus the raw K9 outcome (for diagnostics). Pure dispatch
 * through RESOLVER_TABLE — the only branch is the ABORT_UNCONFIRMED whole-tree
 * sub-decision.
 */
function dispatchPromote(opts, hasViolations, allowOverride, runGit) {
  const { envelope, promoteDeltaFn, auditFn } = opts;
  const promote = typeof promoteDeltaFn === 'function' ? promoteDeltaFn : k9.promoteDelta;

  const promoteResult = promote({
    deltaSha: envelope.delta_sha,
    parentRoot: envelope.worktree_root,
    candidatePath: envelope.candidate_path,
    record: envelope.transaction_record,
    journalPath: envelope.journal_path,
    runGitFn: runGit,
    // Thread the K9 evidence-gate inputs from the envelope/opts. Without them the
    // resolver under-specified promoteDelta: checkEvidenceLinkPreCommit rejected a
    // genesis record (forged-genesis at the default isGenesisPosition:false) AND a
    // non-genesis record (missing resolveParent), so EVERY real promote returned
    // REJECTED_* — the PROMOTE path was unreachable through the real composition
    // (the e2e discovery). A genesis-position spawn now promotes; a chained spawn
    // threads its resolveParent chain-walk seam (v3.1 wires it to the record store).
    isGenesisPosition: envelope.is_genesis_position === true,
    resolveParent: typeof opts.resolveParentFn === 'function' ? opts.resolveParentFn : undefined,
    is_recovery_sweep: envelope.is_recovery_sweep === true,
  });
  const outcome = promoteResult && promoteResult.outcome;
  const row = RESOLVER_TABLE[outcome];

  // No row → an unknown K9 outcome at this security-significant decision point.
  // FAIL-CLOSED (kb:architecture/discipline/error-handling-discipline): return the
  // terminal ABORTED action (a guaranteed no-promote) rather than an action string
  // a caller might not recognize as blocking, and raise a Class-4 audit. The six
  // known outcomes all map (the no-unhandled-default test guards that); this guards
  // the impossible-but-fatal case where K9 returns an out-of-table outcome — a
  // future caller pattern-matching only the known actions can never silently
  // no-op (= promote an unverified delta) on it.
  if (!row) {
    emitAudit(auditFn, { class: 4, kind: 'unhandled-k9-outcome', spawn_id: envelope.spawn_id, k9_outcome: outcome });
    return { action: 'ABORTED', audit: 'unhandled-k9-outcome', outcome, k9: promoteResult };
  }

  // Override path: violations were allowed, K9 promoted → PROMOTE_WITH_AUDIT
  // (Class-4) instead of the plain PROMOTE row.
  if (hasViolations && allowOverride && outcome === 'PROMOTED') {
    emitAudit(auditFn, { class: 4, kind: 'override-allowed', spawn_id: envelope.spawn_id });
    return { action: OVERRIDE_PROMOTE.action, audit: OVERRIDE_PROMOTE.audit, outcome, k9: promoteResult };
  }

  // ABORT_UNCONFIRMED → whole-tree verify sub-decision (same resolved runGit).
  if (row.verify === 'whole-tree') {
    const wt = resolveAbortUnconfirmed({
      runGit, auditFn, spawnId: envelope.spawn_id,
    });
    return { action: wt.action, audit: wt.audit, outcome, k9: promoteResult };
  }

  return { action: row.action, audit: row.audit, outcome, k9: promoteResult };
}

/**
 * Resolve a closing spawn to a terminal action. The integration entry point —
 * runs the §canonical-resolver-table decision spine, then ALWAYS releases the
 * K13 marker (sourced via readMarker). Returns a union audit record per path.
 *
 * @param {object} opts
 * @param {object} opts.envelope                       the spawn-record envelope
 * @param {function} [opts.detectWriteScopeViolationsFn] K14 FACADE seam (default k14.detectWriteScopeViolations)
 * @param {function} [opts.promoteDeltaFn]              K9 seam (default k9.promoteDelta)
 * @param {function} [opts.runGitFn]                    whole-tree status/reset git seam
 * @param {function} [opts.releaseSerialMarkerFn]       K13 release seam
 * @param {function} [opts.readMarkerFn]                K13 readMarker seam (provenance)
 * @param {function} [opts.resolveParentFn]             K9 evidence chain-walk seam (hash)=>parentRecord|null; threaded to promoteDelta for a non-genesis spawn (v3.1 wires it to the record store; a genesis spawn needs none)
 * @param {function} [opts.auditFn]                     audit-collector seam
 * @param {boolean} [opts.allowOutOfScopeWrites=false]  LOOM_ALLOW_OUT_OF_SCOPE_WRITES (explicit, F23)
 * @param {string} [opts.walPath]                       WAL to append an ABORTED record on the INV-20 path
 *
 * Envelope detection/promote inputs threaded to the real K14/K9 (absent in a
 * v3.0-alpha observational envelope → safe no-ops; v3.1's spawn hook populates them):
 *   envelope.k14_ctx            K14 detection ctx ({ targetPath, preSnapshot, ... })
 *   envelope.is_genesis_position  K9 evidence gate: genesis spawn promotes without a chain-walk
 *   envelope.is_recovery_sweep    K9 F20 sentinel: skip the evidence walk for a sweep-promoted delta
 * @returns {{action: string, audit: string, markerReleased: boolean, k13: object, outcome: string|null}}
 */
function resolve(opts) {
  if (!opts || typeof opts !== 'object' || !opts.envelope) {
    throw new Error('post-spawn-resolver.resolve: { envelope } is required');
  }
  const envelope = opts.envelope;

  // ── Step 1: INV-20-TwoPhaseCommitClosure. A PENDING-with-no-COMMITTED spawn is
  //    un-closed → ABORTED + a WAL ABORTED record (SAME spawn_id). K9 not entered.
  if (!isTwoPhaseClosed(envelope)) {
    appendResolverWal(opts.walPath, {
      spawn_id: envelope.spawn_id,
      commit_outcome: 'ABORTED',
      outcome: 'ABORTED',
      abort_reason: 'two-phase-commit-not-closed',
      resolved_at: new Date().toISOString(),
    });
    emitAudit(opts.auditFn, { class: 4, kind: TWO_PHASE_ABORTED.audit, spawn_id: envelope.spawn_id });
    const k13rel = releaseK13Marker(opts);
    return { action: TWO_PHASE_ABORTED.action, audit: TWO_PHASE_ABORTED.audit, markerReleased: k13rel.released, k13: k13rel, outcome: null };
  }

  // ── Step 2: K14 scope gate (the FACADE only). Fail-closed if detection throws.
  const detect = typeof opts.detectWriteScopeViolationsFn === 'function'
    ? opts.detectWriteScopeViolationsFn
    : k14.detectWriteScopeViolations;
  let violations;
  try {
    // Thread the K14 snapshot signals from the envelope. classifyTarget needs
    // ctx.targetPath (+ preSnapshot) to detect anything, so a bare {worktreeRoot}
    // made the scope-reject path INERT through the real composition (the e2e
    // discovery). The envelope carries the detection inputs under `k14_ctx`
    // (populated by v3.1's spawn-close detection hook; absent in a v3.0-alpha
    // observational envelope → detect() safely returns [] = clean).
    violations = detect({
      ...(envelope.k14_ctx && typeof envelope.k14_ctx === 'object' ? envelope.k14_ctx : {}),
      worktreeRoot: envelope.worktree_root,
    });
  } catch {
    // A K14 detection failure means scope is UNVERIFIED — never promote on an
    // unverified scope (fail-closed). No K9 call, no git.
    emitAudit(opts.auditFn, { class: 4, kind: K14_FAILED_ABORTED.audit, spawn_id: envelope.spawn_id });
    const k13rel = releaseK13Marker(opts);
    return { action: K14_FAILED_ABORTED.action, audit: K14_FAILED_ABORTED.audit, markerReleased: k13rel.released, k13: k13rel, outcome: null };
  }
  const hasViolations = Array.isArray(violations) && violations.length > 0;
  const allowOverride = opts.allowOutOfScopeWrites === true;

  // Violations + NO override → REJECT_SCOPE; K9 is never entered. A write-scope
  // violation IS the Tampering (STRIDE-T) threat — it carries class:4 like every
  // other security-meaningful reject path here, so an audit consumer routing on
  // `class === 4` surfaces it at the highest severity (does not silently drop it).
  if (hasViolations && !allowOverride) {
    emitAudit(opts.auditFn, { class: 4, kind: SCOPE_REJECT.audit, spawn_id: envelope.spawn_id, violation_count: violations.length });
    const k13rel = releaseK13Marker(opts);
    return { action: SCOPE_REJECT.action, audit: SCOPE_REJECT.audit, markerReleased: k13rel.released, k13: k13rel, outcome: null };
  }

  // ── Step 3: K9 promote dispatch through RESOLVER_TABLE. The single git runner
  //    is resolved ONCE here and threaded to both the cherry-pick and the
  //    ABORT_UNCONFIRMED whole-tree probe (one worktree_root→runner derivation).
  const runGit = resolveRunGit(opts);
  const decided = dispatchPromote(opts, hasViolations, allowOverride, runGit);

  // ── Step 4: ALWAYS release the K13 marker (the spawn is closing), sourced via
  //    readMarker (§K13-spawn-id-provenance).
  const k13rel = releaseK13Marker(opts);

  return {
    action: decided.action,
    audit: decided.audit,
    outcome: decided.outcome,
    markerReleased: k13rel.released,
    k13: k13rel,
    k9: decided.k9,
  };
}

module.exports = {
  resolve,
  RESOLVER_TABLE,
  // exported for inspection / reuse (no other production importer in v3.0-alpha)
  isTwoPhaseClosed,
  resolveAbortUnconfirmed,
};
