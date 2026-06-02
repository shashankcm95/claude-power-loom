'use strict';

// packages/kernel/spawn-state/integrator.js
//
// PR-P3c-b — the ORDERED INTEGRATOR (the consumer half of the P3 enforcing arc).
// It reads the hidden refs/loom/candidates/* refs the P3c-a producer pins, stacks
// each candidate's delta onto a dedicated loom/integration branch in a DECLARED
// order, conflict->quarantines (plain update-ref loom-promote/<safeId>, in order),
// and publishes via ONE terminal CAS. It NEVER touches the user's checked-out
// HEAD/working tree — the whole fold is out-of-tree plumbing (merge-tree/commit-tree
// → a tree, never a checkout), and the only refs/heads/ writes are loom/integration
// (the disposable assembly branch the user merges FROM) + loom-promote/* (durable
// conflict-review branches). DESCOPED (USER 2026-06-01): a pure git-merge stacker —
// no record store, no provenance minting, no live-walk (those are a follow-up PR).
//
// THE MERGE-BASE RULE (load-bearing correctness; firsthand-probed, verify-plan board):
// the 3-way merge-base for stacking a candidate is the DYNAMIC common ancestor
// `git merge-base --all (integrationTip, candidate.delta_sha)`. It is NOT delta_sha^1
// (that silently DROPS the main commits that landed between differing fork points)
// and NOT the parent's HEAD. `--all` is used so a CRISS-CROSS history (>1 least-common
// ancestor) is DETECTED: != exactly 1 base -> QUARANTINE, never merge against an
// arbitrary single base (which `git merge-base` would pick, producing a false-clean
// wrong tree — the same silent-loss class).
//
// Fail-soft: integrateCandidates NEVER throws — one outer try/catch wraps the whole
// body, and every exit returns a structured {integrated, tip, integratedIds[],
// quarantinedIds[], skippedIds[], casOutcome, reRunnable, reason} run-report.
//
// DIP: the git seam (runGitFn) + the lock seam (acquireLockFn/releaseLockFn) are
// injectable so the spec drives real git in a temp repo; the CLI (integrate-cli.js)
// is the only place that binds the concretions (runGitDefault, lock.js, process.argv).

const { runGitDefault } = require('../_lib/invoke-git.js');
const { acquireLock, releaseLock } = require('../_lib/lock.js');
const { mergeTreeWriteTree, commitMergedTree, casAdvanceRef, GIT_SHA_RE } = require('../_lib/integrate-merge.js');
const { sanitizeAgentId } = require('../_lib/quarantine-promote.js');
// PR-P3c-c — the OPTIONAL minting arm's collaborators (used only when minting is ON).
const { computePostStateHash } = require('../_lib/transaction-record.js');
const { buildChainedRecord } = require('../_lib/integration-record.js');
const { appendRecord, readByPostStateHash } = require('../_lib/record-store.js');
const { checkEvidenceLinkPreCommit } = require('../_lib/k9-promote-deltas.js');

const DEFAULT_INTEGRATION_REF = 'refs/heads/loom/integration';
const CANDIDATE_PREFIX = 'refs/loom/candidates/';
const QUARANTINE_PREFIX = 'refs/heads/loom-promote/';
const DEFAULT_SCHEMA_VERSION = 'v3'; // for minted integration records (overridable via opts.schemaVersion)
// Provisional default (verify-plan Sub-Decision 2): sized to a small N-candidate
// fold's O(N) git ops with generous headroom; overridable; pending a measured
// N-sibling concurrency test. Explicit here, NOT inherited from lock.js's 3000ms.
const DEFAULT_MAX_WAIT_MS = 5000;

/**
 * Build a complete, immutable run-report from a partial set of fields. Every exit
 * path returns the same shape (callers/CLI never see an absent key). Creates a NEW
 * object — never mutates an accumulator.
 *
 * @param {Object} fields the populated subset.
 * @returns {Object} the full run-report.
 */
function report(fields) {
  return {
    integrated: false,
    tip: null,
    integratedIds: [], // on a merge-error/cas-lost report: FOLDED-before-the-stop, NOT on the ref
    quarantinedIds: [], // DURABLE — the loom-promote/* refs were written (survive an abort)
    skippedIds: [],
    quarantineOverwrites: [], // quarantined ids whose loom-promote/* branch pre-existed with a different sha
    provenanceRejectedIds: [], // clean merges whose provenance did NOT link to genesis (minting; NOT integrated, NOT a conflict)
    casOutcome: null,
    reRunnable: false,
    reason: null,
    ...fields,
  };
}

/**
 * Validate + dedup the declared order, PRE-lock (cheap, no git). Refuses
 * genuinely-malformed input (empty/non-array, a non-string element, or an element
 * that sanitizes to '' — which would form the git-invalid bare ref loom-promote/).
 * A post-sanitize DUPLICATE is dedup-to-first-occurrence, NOT a whole-run refuse
 * (the producer already coalesced two such raw ids into one candidate ref).
 *
 * @param {*} orderedIds the caller's declared ids.
 * @returns {{ok:true, ids:string[]}|{ok:false, reason:string}}
 */
function validateOrderedIds(orderedIds) {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return { ok: false, reason: 'invalid-args' };
  }
  const seen = new Set();
  const ids = [];
  for (const raw of orderedIds) {
    if (typeof raw !== 'string' || raw.length === 0) return { ok: false, reason: 'invalid-args' };
    const safeId = sanitizeAgentId(raw);
    if (!safeId) return { ok: false, reason: 'invalid-args' };
    if (seen.has(safeId)) continue; // dedup-to-first (post-sanitize duplicate)
    seen.add(safeId);
    ids.push(raw);
  }
  return { ok: true, ids };
}

/**
 * HAZARD GUARD (never-touch-HEAD / S3 desync). Refuse if loom/integration is the
 * checked-out HEAD symref. A detached HEAD (symbolic-ref exits 128 "not a symbolic
 * ref") is NOT the integration branch -> proceed. Any OTHER non-zero (a git I/O
 * error, a not-a-repo cwd — same 128 but a different stderr signature) -> fail
 * CLOSED, never a silent proceed.
 *
 * @param {string} integrationRef the integration branch ref.
 * @param {function} runGit the git seam.
 * @returns {{refuse:boolean, reason?:string}}
 */
function refuseIfIntegrationIsHead(integrationRef, runGit) {
  const res = runGit(['symbolic-ref', 'HEAD']);
  if (res && res.ok) {
    return String(res.stdout).trim() === integrationRef
      ? { refuse: true, reason: 'integration-is-current-head' }
      : { refuse: false };
  }
  if (res && res.code === 128 && /not a symbolic ref/.test(String(res.stderr))) {
    return { refuse: false }; // detached HEAD — safe to proceed
  }
  return { refuse: true, reason: 'symref-check-failed' }; // ambiguous git error — fail closed
}

/**
 * Resolve each declared id to its pinned candidate delta, INSIDE the lock (a
 * consistent snapshot — closes the ABA window vs a concurrent producer). An id
 * whose ref is absent is SKIPPED (not a whole-run refuse). Keys identity off the
 * RAW id; reads the ref by the sanitized safeId.
 *
 * @param {string[]} ids the validated+deduped declared ids.
 * @param {function} runGit the git seam.
 * @returns {{resolved:Array<{rawId,safeId,delta_sha}>, skipped:string[]}}
 */
function resolveOrderedCandidates(ids, runGit) {
  const resolved = [];
  const skipped = [];
  for (const rawId of ids) {
    const safeId = sanitizeAgentId(rawId);
    const res = runGit(['rev-parse', '--verify', '--quiet', `${CANDIDATE_PREFIX}${safeId}`]);
    const sha = res && res.ok ? String(res.stdout).trim() : '';
    if (GIT_SHA_RE.test(sha)) resolved.push({ rawId, safeId, delta_sha: sha });
    else skipped.push(rawId);
  }
  return { resolved, skipped };
}

/**
 * Derive the 3-way merge-base = the DYNAMIC common ancestor (NOT delta_sha^1).
 * `git merge-base --all` so a criss-cross (>1 LCA) is detected as 'ambiguous'.
 *
 * @param {Object} opts {runGit, ours, theirs}.
 * @returns {{status:'ok', base:string}|{status:'ambiguous'}|{status:'none'}}
 */
function deriveMergeBase(opts) {
  const { runGit, ours, theirs } = opts || {};
  const res = runGit(['merge-base', '--all', ours, theirs]);
  // A non-zero exit folds into 'none' (the conservative quarantine route): "no common
  // ancestor" (exit 1) and a transient exec-error are indistinguishable here, and a
  // quarantine is non-destructive + re-runnable — never merge a candidate on doubt.
  if (!res || !res.ok) return { status: 'none' };
  const bases = String(res.stdout).split('\n').map((s) => s.trim()).filter(Boolean);
  if (bases.length === 0) return { status: 'none' };
  if (bases.length > 1) return { status: 'ambiguous' }; // criss-cross -> quarantine
  return { status: 'ok', base: bases[0] };
}

/**
 * The tri-state merge dispatch for one candidate (the most error-prone unit). A
 * non-single merge-base -> quarantine (never merge against an arbitrary/absent
 * base). Else merge-tree, branching `.conflict` FIRST (a CONFLICT is {ok:true,
 * conflict:true} — a naive !ok would misroute it), THEN `!ok` -> error.
 *
 * @returns {{outcome:'clean', tree:string}|{outcome:'conflict'}|{outcome:'error'}}
 */
function stackOneCandidate(tip, cand, runGit) {
  const mb = deriveMergeBase({ runGit, ours: tip, theirs: cand.delta_sha });
  if (mb.status !== 'ok') return { outcome: 'conflict' }; // 0 or >1 base -> quarantine route
  const merge = mergeTreeWriteTree({ mergeBase: mb.base, ours: tip, theirs: cand.delta_sha, runGit });
  if (merge.conflict) return { outcome: 'conflict' };
  if (!merge.ok) return { outcome: 'error' };
  return { outcome: 'clean', tree: merge.tree };
}

/**
 * MINTING ARM (P3c-c) — bootstrap the chain head from the SEED, upfront. record_1's
 * walk resolves to the seed's genesis record, so the seed's provenance is REQUIRED
 * (a whole-run condition, NOT a per-candidate skip — re-board HIGH). Fail-soft.
 *
 * @returns {{ok:true, post:string}|{ok:false, reason:string}}
 */
function bootstrapSeedChain(seedDelta, ctx) {
  try {
    const res = ctx.runGit(['rev-parse', `${seedDelta}^{tree}`]);
    const tree = res && res.ok ? String(res.stdout).trim() : '';
    if (!GIT_SHA_RE.test(tree)) return { ok: false, reason: 'seed-rev-parse-failed' };
    const seedPost = computePostStateHash(tree);
    // PRESENCE GATE only: record_1's walk resolves the seed's genesis here, so it MUST
    // exist. (The seed genesis txid is NOT record_1's evidence — that is the candidate's
    // OWN genesis txid, read separately per-candidate in mintIntegrationRecord.)
    if (!ctx.resolveParentFn(seedPost)) return { ok: false, reason: 'seed-unprovenanced' };
    return { ok: true, post: seedPost };
  } catch {
    return { ok: false, reason: 'seed-rev-parse-failed' };
  }
}

/**
 * MINTING ARM (P3c-c) — mint a non-genesis chained record for one clean merge, walk it
 * to genesis, append it. NEVER throws → {ok:false} on ANY failure (read-miss / walk-fail
 * / append-fail / throw), which the fold routes to provenance-reject. The per-candidate
 * provenance GATE is the read: `resolveParentFn(candPost)` must resolve the candidate's
 * OWN genesis record; its txid is recorded in evidence_refs (an A10-satisfying,
 * R10-unverified back-reference — NOT walked). `prev = prevPost` is the STORED chain head.
 *
 * @returns {{ok:true, post:string}|{ok:false}}
 */
function mintIntegrationRecord(prevPost, cand, mergedTree, ctx) {
  try {
    const res = ctx.runGit(['rev-parse', `${cand.delta_sha}^{tree}`]);
    const candTree = res && res.ok ? String(res.stdout).trim() : '';
    if (!GIT_SHA_RE.test(candTree)) return { ok: false };
    const candGenesis = ctx.resolveParentFn(computePostStateHash(candTree));
    if (!candGenesis) return { ok: false }; // no per-candidate provenance -> reject
    const post = computePostStateHash(mergedTree); // M1 verbatim
    const record = ctx.chainRecordFn({ prevPost, post, evidenceTxid: candGenesis.transaction_id, safeId: cand.safeId, schemaVersion: ctx.schemaVersion });
    const walk = checkEvidenceLinkPreCommit({ record, isGenesisPosition: false, resolveParent: ctx.resolveParentFn });
    if (!walk.ok) return { ok: false }; // fail-CLOSED — never advance an unprovenanced merge
    // PR-4 INV-22 positive idempotency: appendRecord returns {ok:true, deduped:true} when
    // this chained record's idempotency_key already exists (re-folding the SAME merge — the
    // integrator-side F-01). That is SUCCESS, not a failure: .ok is true (a deduped append's
    // .file points at the EXISTING record, but the integrator returns rawIds, not provenance
    // paths, so it is unused here). We advance the chain to `post` either way — the prior fold
    // already stored the equivalent record.
    if (!ctx.appendRecordFn(record).ok) return { ok: false };
    return { ok: true, post };
  } catch {
    return { ok: false }; // computePostStateHash / chainRecordFn validate throw -> provenance-reject
  }
}

/**
 * Commit a clean merge (COMMIT-FIRST: build the object, then — when minting — mint+walk+
 * append; advance ONLY if both succeed). A `commit` failure aborts the run; a
 * `provenance` failure (walk/append/throw) is a per-candidate skip. commitMergedTree
 * THROWS on bad input (local try/catch) + RETURNS {ok:false} on a git-exec failure.
 *
 * @returns {{ok:true, tip:string, chainHeadPost:(string|null)}|{ok:false, kind:'provenance'|'commit'}}
 */
function integrateOneClean(tip, chainHeadPost, cand, tree, runGit, ctx) {
  let commit;
  try {
    commit = commitMergedTree({ tree, parents: [tip, cand.delta_sha], runGit });
  } catch {
    return { ok: false, kind: 'commit' };
  }
  if (!commit.ok) return { ok: false, kind: 'commit' };
  if (!ctx.minting) return { ok: true, tip: commit.commit, chainHeadPost: null };
  const m = mintIntegrationRecord(chainHeadPost, cand, tree, ctx);
  if (!m.ok) return { ok: false, kind: 'provenance' };
  return { ok: true, tip: commit.commit, chainHeadPost: m.post };
}

/**
 * Quarantine a conflicting candidate: pin its delta to a DURABLE
 * refs/heads/loom-promote/<safeId> branch via a plain update-ref (no worktree, no
 * checkout). The safeId is already sanitized (no ref-name escape). A human can
 * `git merge` the branch later. If a branch for this safeId ALREADY exists with a
 * DIFFERENT sha (a stale review branch from a prior run/session — the cross-session
 * ENFORCE-kept-branch hazard), it is overwritten and the caller surfaces it in the
 * run-report's quarantineOverwrites (so a human-review branch is never silently lost).
 *
 * @returns {{ok:boolean, overwrote:boolean}}
 */
function quarantineCandidate(cand, runGit) {
  const ref = `${QUARANTINE_PREFIX}${cand.safeId}`;
  const prior = runGit(['rev-parse', '--verify', '--quiet', ref]);
  const priorSha = prior && prior.ok ? String(prior.stdout).trim() : '';
  const overwrote = GIT_SHA_RE.test(priorSha) && priorSha !== cand.delta_sha;
  const res = runGit(['update-ref', ref, cand.delta_sha]);
  return { ok: !!(res && res.ok), overwrote };
}

/**
 * Fold the resolved candidates onto one out-of-tree tip, IN DECLARED ORDER, writing
 * NO ref (the terminal CAS is the composer's job). SEED = resolved[0].delta_sha
 * (candidate-0 adopted WHOLE — never merged/quarantined). When MINTING, the seed's
 * chain is bootstrapped upfront (its genesis is required) + each clean merge mints a
 * chained record (advance only on mint success). Threads an IMMUTABLE accumulator. A
 * clean step advances; a conflict quarantines + continues; a provenance-fail skips +
 * continues; a commit/merge ERROR aborts the whole run fail-closed.
 *
 * @returns {{finalTip, integratedIds, quarantinedIds, quarantineOverwrites, provenanceRejectedIds, aborted, reason?}}
 */
function foldCandidatesOntoTip(resolved, runGit, ctx) {
  let chainHeadPost = null;
  if (ctx.minting) {
    const boot = bootstrapSeedChain(resolved[0].delta_sha, ctx);
    if (!boot.ok) return { finalTip: resolved[0].delta_sha, integratedIds: [], quarantinedIds: [], quarantineOverwrites: [], provenanceRejectedIds: [], aborted: true, reason: boot.reason };
    chainHeadPost = boot.post;
  }
  let tip = resolved[0].delta_sha;
  let integratedIds = [resolved[0].rawId];
  let quarantinedIds = [];
  let quarantineOverwrites = [];
  let provenanceRejectedIds = [];
  for (let i = 1; i < resolved.length; i++) {
    const cand = resolved[i];
    const acc = { finalTip: tip, integratedIds, quarantinedIds, quarantineOverwrites, provenanceRejectedIds };
    const s = stackOneCandidate(tip, cand, runGit);
    if (s.outcome === 'clean') {
      const c = integrateOneClean(tip, chainHeadPost, cand, s.tree, runGit, ctx);
      if (c.ok) { tip = c.tip; chainHeadPost = c.chainHeadPost; integratedIds = [...integratedIds, cand.rawId]; }
      else if (c.kind === 'provenance') { provenanceRejectedIds = [...provenanceRejectedIds, cand.rawId]; }
      else return { ...acc, aborted: true, reason: 'merge-error' }; // kind:'commit' — shared-substrate health
    } else if (s.outcome === 'conflict') {
      const q = quarantineCandidate(cand, runGit);
      if (!q.ok) return { ...acc, aborted: true, reason: 'merge-error' };
      quarantinedIds = [...quarantinedIds, cand.rawId];
      if (q.overwrote) quarantineOverwrites = [...quarantineOverwrites, cand.rawId];
    } else {
      return { ...acc, aborted: true, reason: 'merge-error' };
    }
  }
  return { finalTip: tip, integratedIds, quarantinedIds, quarantineOverwrites, provenanceRejectedIds, aborted: false };
}

/**
 * Read the current integration tip INSIDE the lock (fresh oldOid for the CAS).
 *
 * @returns {{exists:boolean, oldTip:(string|null)}}
 */
function observeIntegrationTip(integrationRef, runGit) {
  const res = runGit(['rev-parse', '--verify', '--quiet', integrationRef]);
  const sha = res && res.ok ? String(res.stdout).trim() : '';
  return GIT_SHA_RE.test(sha) ? { exists: true, oldTip: sha } : { exists: false, oldTip: null };
}

/**
 * The ONE terminal ref advance (CAS atomicity under a concurrent sibling). oldOid
 * is null on a first integrate (the create-form), else the observed tip. A lost CAS
 * (a racing sibling won, or the ref already existed on create) -> discard the whole
 * computed stack: only GC-able out-of-tree objects were written, integrationRef is
 * byte-unchanged, and the run is re-runnable.
 *
 * @returns {{ok:true, casOutcome:string}|{ok:false, casOutcome:'cas-lost', reRunnable:true}}
 */
function commitNewTip(finalTip, oldTip, exists, integrationRef, runGit) {
  try {
    const cas = casAdvanceRef({ ref: integrationRef, newOid: finalTip, oldOid: exists ? oldTip : null, runGit });
    if (cas.ok) return { ok: true, casOutcome: cas.created ? 'created' : 'advanced' };
    return { ok: false, casOutcome: 'cas-lost', reRunnable: true };
  } catch {
    // Defense-in-depth: casAdvanceRef NEVER throws on CAS loss (it returns {ok:false});
    // this catch only guards its INPUT-validation throws (a non-refs/ ref / non-sha oid),
    // which the call graph already prevents. Folds to cas-lost to honor never-throws.
    return { ok: false, casOutcome: 'cas-lost', reRunnable: true };
  }
}

/**
 * The critical-section body (runs holding the lock): resolve -> observe -> fold ->
 * commit. Returns the run-report. Throws are caught by the composer's outer guard.
 *
 * @returns {Object} the run-report.
 */
function runIntegration(ids, integrationRef, runGit, ctx) {
  const { resolved, skipped } = resolveOrderedCandidates(ids, runGit);
  if (resolved.length === 0) return report({ skippedIds: skipped, reason: 'no-candidates' });
  const observed = observeIntegrationTip(integrationRef, runGit);
  const fold = foldCandidatesOntoTip(resolved, runGit, ctx);
  const common = {
    integratedIds: fold.integratedIds,
    quarantinedIds: fold.quarantinedIds,
    skippedIds: skipped,
    quarantineOverwrites: fold.quarantineOverwrites,
    provenanceRejectedIds: fold.provenanceRejectedIds,
  };
  if (fold.aborted) return report({ ...common, reason: fold.reason || 'merge-error' }); // seed-unprovenanced / seed-rev-parse-failed / merge-error
  const cas = commitNewTip(fold.finalTip, observed.oldTip, observed.exists, integrationRef, runGit);
  if (!cas.ok) return report({ ...common, casOutcome: cas.casOutcome, reRunnable: cas.reRunnable, reason: 'cas-lost' });
  return report({ ...common, integrated: true, tip: fold.finalTip, casOutcome: cas.casOutcome });
}

/**
 * Stack the declared candidates onto the integration branch. The public composer +
 * the whole safety envelope. NEVER throws (the outer try/catch). See the module
 * header for the merge-base rule + the never-touch-HEAD guarantee.
 *
 * @param {Object} opts
 * @param {string[]} opts.orderedIds the RAW candidate ids, in the declared stack order.
 * @param {string} opts.parentRoot the repo root (binds the default git seam).
 * @param {string} opts.lockPath the integration lock file path.
 * @param {string} [opts.integrationRef] default refs/heads/loom/integration.
 * @param {number} [opts.maxWaitMs] lock wait (default 5000, overridable).
 * @param {function} [opts.runGitFn] git seam override (default runGitDefault-bound).
 * @param {function} [opts.acquireLockFn] lock-acquire override (default acquireLock).
 * @param {function} [opts.releaseLockFn] lock-release override (default releaseLock).
 * @param {string} [opts.runId] enables MINTING (with stateDir): the provenance run id.
 * @param {string} [opts.stateDir] the record-store root (with runId enables minting).
 * @param {string} [opts.schemaVersion] minted-record schema_version (default 'v3').
 * @param {function} [opts.chainRecordFn] non-genesis builder override (default buildChainedRecord).
 * @param {function} [opts.resolveParentFn] chain-walk seam override (default readByPostStateHash).
 * @param {function} [opts.appendRecordFn] record-append override (default appendRecord).
 * @returns {Object} the run-report.
 */
function integrateCandidates(opts) {
  const o = opts || {};
  // An explicit integrationRef must be a fully-qualified refs/ name (a short name like
  // 'main' would slip past the guards and surface a misleading cas-lost at the terminal
  // CAS — casAdvanceRef throws on a non-refs/ ref). null/absent -> the default.
  const integrationRef = o.integrationRef == null
    ? DEFAULT_INTEGRATION_REF
    : (typeof o.integrationRef === 'string' && o.integrationRef.startsWith('refs/') ? o.integrationRef : null);
  const runGit = typeof o.runGitFn === 'function' ? o.runGitFn : (args) => runGitDefault(o.parentRoot, args);
  const acquire = typeof o.acquireLockFn === 'function' ? o.acquireLockFn : acquireLock;
  const release = typeof o.releaseLockFn === 'function' ? o.releaseLockFn : releaseLock;
  // The minting arm (P3c-c): ON iff runId+stateDir are supplied (the CLI binds them from
  // --run-id). Absent -> ctx.minting=false -> the integrator is a pure stacker (P3c-b).
  const ctx = {
    minting: !!(o.runId && o.stateDir),
    runGit,
    schemaVersion: typeof o.schemaVersion === 'string' && o.schemaVersion ? o.schemaVersion : DEFAULT_SCHEMA_VERSION,
    chainRecordFn: typeof o.chainRecordFn === 'function' ? o.chainRecordFn : buildChainedRecord,
    resolveParentFn: typeof o.resolveParentFn === 'function' ? o.resolveParentFn : (h) => readByPostStateHash(h, { runId: o.runId, stateDir: o.stateDir }),
    appendRecordFn: typeof o.appendRecordFn === 'function' ? o.appendRecordFn : (r) => appendRecord(r, { runId: o.runId, stateDir: o.stateDir }),
  };

  const valid = validateOrderedIds(o.orderedIds);
  if (!valid.ok) return report({ reason: valid.reason });
  if (!integrationRef) return report({ reason: 'invalid-args' }); // a malformed integrationRef

  try {
    const guard = refuseIfIntegrationIsHead(integrationRef, runGit);
    if (guard.refuse) return report({ reason: guard.reason });

    let locked = false;
    try {
      locked = acquire(o.lockPath, { maxWaitMs: o.maxWaitMs == null ? DEFAULT_MAX_WAIT_MS : o.maxWaitMs });
    } catch {
      return report({ reason: 'lock-error' }); // acquireLock threw (e.g. ENOTDIR) — distinct from a timeout
    }
    if (!locked) return report({ reason: 'lock-unavailable' });
    try {
      return runIntegration(valid.ids, integrationRef, runGit, ctx);
    } finally {
      if (locked) release(o.lockPath); // ONLY because acquire returned true (no lock theft)
    }
  } catch {
    return report({ reason: 'threw' }); // the outer fail-soft boundary
  }
}

module.exports = {
  integrateCandidates,
  deriveMergeBase, // exposed for the spec + future reuse
};
