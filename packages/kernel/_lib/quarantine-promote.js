'use strict';

// packages/kernel/_lib/quarantine-promote.js
//
// PR-3c-a — DORMANT materialization library for the enforcing spawn-close
// resolver. This module SHIPS DORMANT: no production code imports it in PR-3c-a
// (only its unit test requires it). PR-3c-b's `stagePromote` is the first
// production importer — it CONSUMES the `delta_sha` + genesis `transaction_record`
// these pure-ish builders PRODUCE, then runs the real `k9.promoteDelta` against a
// throwaway staging worktree. The seam is a clean data handoff (plan §"The split
// (architect rec) — 3c-a then 3c-b"); this half does ZERO worktree mutation.
//
// EXPORTS:
//   deriveParentRoot(worktreePath, runGit)        -> canonicalized parent repo root
//   materializeDelta({worktreePath, agentId, runGit, runGitWithEnv})
//                                  -> {delta_sha, candidateRel, isEmpty, tree, parentHead}
//   buildGenesisRecord({agentId, personaId, schemaVersion}) -> a genesis-valid record
//   buildSpawnRecord({agentId, personaId, schemaVersion, postStateHash, headAnchor})
//                                  -> a genesis-valid record + post_state_hash + head_anchor
//
// ── PR-P2a additions (DORMANT — P2b is the first live caller) ──
// `materializeDelta` now ALSO returns `tree` (the post-state write-tree) + `parentHead`
// (the forked-from HEAD) — both already computed; the auto-merge producer (P2b) needs
// them. `buildSpawnRecord` is a NEW export (NOT an extension of buildGenesisRecord —
// Open/Closed + ISP; buildGenesisRecord's signature is frozen + its OUTPUT field-set +
// content-hash body are unchanged — NOT literally byte-identical, since the wall-clock
// intent_recorded_at differs per call; the regression test pins exactly that property):
// it shares the genesis field-assembly via the internal genesisRecordFields(opts) helper,
// then adds post_state_hash + head_anchor before re-hashing + re-validating. post_state_hash MUST
// be produced via transaction-record.computePostStateHash (the forward-coupling invariant
// — see that fn's doc); buildSpawnRecord takes the already-computed value so this module
// stays agnostic about the tree source.
//
// ── materializeDelta — the squash (Agent-C silent-drop fix) ──
// A spawn worktree may carry MULTIPLE commits PLUS uncommitted working-tree
// changes. K9's downstream cherry-pick takes a SINGLE commit, so a bare
// `cherry-pick HEAD` would silently DROP every commit before HEAD. We instead
// squash the FULL <merge-base>..HEAD range PLUS the working tree into ONE commit
// (`commit-tree <tree> -p <base>`), so the whole delta survives. The staging
// `add -A` runs against a TEMP index (selected via GIT_INDEX_FILE — invoke-git's
// PR-3c-a extraEnv param) so the worktree's REAL .git/index is NEVER touched.
// The temp index is a UNIQUE path under os.tmpdir() (so concurrent calls never
// collide) and is removed in a try/finally on EVERY path, including errors
// (code-reviewer HIGH-4 / plan A-D3). An empty squash (tree === <base>^{tree})
// reports isEmpty:true so downstream K9 takes its NOOP branch.
//
// ── No-shell git (CWE-78) ── all git runs through the injected runGit /
// runGitWithEnv seams (args arrays, never a shell string), defaulting to the
// shared _lib/invoke-git runner. The seams are injectable so unit tests drive
// real git in a temp repo without this module knowing about child_process.
//
// ── buildGenesisRecord — REUSE, do not hand-roll ── the hash, the genesis
// prev_state_hash, the sentinel charset, and the validation all come from
// _lib/transaction-record (computeTransactionId / computeGenesisHash /
// isBootstrapSentinel / validateTransactionRecord). agentId is sanitized to the
// ROOT_TASK_RECORD sentinel charset [A-Za-z0-9_-] so a dotted/colon'd spawn id
// (e.g. "agent.123:x") cannot produce an evidence_ref the A10 gate would reject
// downstream as a cryptic K9 REJECTED_EVIDENCE (plan A-D4 / F10). We ASSERT the
// sentinel + genesis-validity here so a bad input fails FAST with a concrete
// message rather than far downstream.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { canonicalize } = require('./path-canonicalize');
const {
  computeTransactionId,
  computeGenesisHash,
  isBootstrapSentinel,
  validateTransactionRecord,
} = require('./transaction-record');

// Monotonic per-process counter folded into the temp-index name alongside pid +
// random bytes, so two materializeDelta calls in the same millisecond (even from
// the same pid) can never select the same temp index (LOAD-BEARING uniqueness
// constraint, plan A-D3).
let _tempIndexCounter = 0;

/**
 * Build a UNIQUE absolute temp-index path under os.tmpdir(). Combines pid, a
 * monotonic counter, and 6 random bytes so concurrent / same-ms calls never
 * collide. Not created on disk here — git creates it when add -A first writes.
 *
 * @returns {string} absolute temp-index path.
 */
function makeTempIndexPath() {
  _tempIndexCounter += 1;
  const rand = crypto.randomBytes(6).toString('hex');
  return path.join(os.tmpdir(), `loom-idx-${process.pid}-${_tempIndexCounter}-${rand}`);
}

/**
 * Run a worktree-bound git seam and return trimmed stdout, throwing a concrete
 * Error on a non-ok result. Centralizes the "fail fast with a readable message"
 * discipline so each step in materializeDelta stays a single readable line and
 * the try/finally cleanup always fires on failure.
 *
 * @param {function} runGit injectable (args[]) => {ok, stdout, stderr}.
 * @param {string[]} args git argv.
 * @param {string} label human label for the error message.
 * @returns {string} trimmed stdout.
 */
function gitOut(runGit, args, label) {
  const res = runGit(args);
  if (!res || !res.ok) {
    const stderr = (res && res.stderr) ? String(res.stderr).slice(0, 200) : 'no stderr';
    throw new Error(`quarantine-promote: git ${label} failed: ${stderr}`);
  }
  return String(res.stdout || '').trim();
}

/**
 * Derive the absolute, canonicalized parent repo root from a spawn worktree.
 *
 * `git worktree list --porcelain` (run via the worktree-bound seam) lists every
 * linked worktree; the FIRST `worktree <path>` line is the main working tree
 * (the parent). We canonicalize() it so a macOS /tmp -> /private/tmp symlink (and
 * any other symlinked ancestor) is collapsed before any downstream path scope
 * check compares against it (plan A-D2 / code-reviewer MED-6).
 *
 * @param {string} worktreePath the spawn worktree (informational; the seam is
 *   already bound to its cwd).
 * @param {function} runGit injectable (args[]) => result, bound to the worktree.
 * @returns {string} the canonicalized absolute parent repo root.
 */
function deriveParentRoot(worktreePath, runGit) {
  const out = gitOut(runGit, ['worktree', 'list', '--porcelain'], 'worktree list');
  const firstLine = out.split('\n').map((s) => s.trim()).find((s) => s.startsWith('worktree '));
  if (!firstLine) {
    throw new Error('quarantine-promote: no "worktree" line in `worktree list --porcelain` output');
  }
  const parentPath = firstLine.slice('worktree '.length).trim();
  const canonical = canonicalize(parentPath);
  if (!canonical) {
    throw new Error(`quarantine-promote: parent root did not canonicalize: ${parentPath}`);
  }
  return canonical;
}

/**
 * Stage the worktree's FULL working tree into a THROWAWAY index (selected by the
 * caller's GIT_INDEX_FILE env, so the real .git/index is never touched) and
 * return the resulting tree SHA. Factored out of materializeDelta so the squash-
 * into-temp-index concern is one named unit (SRP) and materializeDelta stays a
 * readable orchestration. Throws a concrete, stderr-bearing Error on any failure.
 *
 * @param {function} runGitWithEnv injectable (args[], extraEnv) => result.
 * @param {Object<string,string>} env the per-call git env (carries GIT_INDEX_FILE).
 * @returns {string} the validated tree object SHA.
 */
function writeTreeViaTempIndex(runGitWithEnv, env) {
  const stage = runGitWithEnv(['add', '-A'], env);
  if (!stage || !stage.ok) {
    const stderr = (stage && stage.stderr) ? String(stage.stderr).slice(0, 200) : 'no stderr';
    throw new Error(`quarantine-promote: temp-index add -A failed: ${stderr}`);
  }
  // Check .ok BEFORE reading stdout (symmetry with the add -A block above): a
  // failed write-tree (object-store corruption / disk full) returns {ok:false,
  // stdout:''}; extracting tree='' and throwing a name-paraphrasing "did not
  // return a tree object" would DISCARD the real git stderr — the exact
  // error-handling smell (kb:architecture/discipline/error-handling-discipline —
  // "error messages that paraphrase the function name add no value"). Surface the
  // bounded stderr instead.
  const wtRes = runGitWithEnv(['write-tree'], env);
  if (!wtRes || !wtRes.ok) {
    const stderr = (wtRes && wtRes.stderr) ? String(wtRes.stderr).slice(0, 200) : 'no stderr';
    throw new Error(`quarantine-promote: temp-index write-tree failed: ${stderr}`);
  }
  const tree = String(wtRes.stdout || '').trim();
  if (!/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(tree)) {
    throw new Error(`quarantine-promote: write-tree returned a non-tree value: ${JSON.stringify(tree.slice(0, 80))}`);
  }
  return tree;
}

/**
 * Squash a spawn worktree's FULL delta (committed range + uncommitted working
 * tree) into ONE commit object and report what it carries.
 *
 * @param {Object} opts
 * @param {string} opts.worktreePath the spawn worktree.
 * @param {string} opts.agentId the spawn id (used in the commit message).
 * @param {function} opts.runGit injectable (args[]) => result, worktree-bound.
 * @param {function} opts.runGitWithEnv injectable (args[], extraEnv) => result.
 * @returns {{delta_sha: string, candidateRel: string, isEmpty: boolean}}
 *   delta_sha: the squashed commit; candidateRel: first changed path (repo-
 *   RELATIVE — PR-3c-b joins it to the staging root); isEmpty: the squash tree
 *   equals the merge-BASE tree (i.e. NO NET delta vs the fork point — the correct
 *   downstream K9 NOOP trigger). Note for 3c-b consumers: isEmpty:false means
 *   "tree differs from base", NOT "has commits" — a worktree that committed then
 *   reverted back to base reports isEmpty:true. Key off tree identity, not commit
 *   count.
 */
function materializeDelta(opts) {
  const { worktreePath, agentId, runGit, runGitWithEnv } = opts || {};
  if (typeof runGit !== 'function' || typeof runGitWithEnv !== 'function') {
    throw new Error('quarantine-promote: materializeDelta requires runGit + runGitWithEnv seams');
  }
  const parentRoot = deriveParentRoot(worktreePath, runGit);
  const parentHead = gitOut(runGit, ['-C', parentRoot, 'rev-parse', 'HEAD'], 'parent rev-parse HEAD');
  const base = gitOut(runGit, ['merge-base', parentHead, 'HEAD'], 'merge-base');
  const baseTree = gitOut(runGit, ['rev-parse', `${base}^{tree}`], 'base tree');

  const tempIndexPath = makeTempIndexPath();
  try {
    const tree = writeTreeViaTempIndex(runGitWithEnv, { GIT_INDEX_FILE: tempIndexPath });
    const isEmpty = tree === baseTree;
    // The commit message uses the SANITIZED id. No CWE-78 risk exists (this is an
    // execFile arg-array element, never shell-interpolated), but a raw agentId
    // carrying a newline (e.g. "arch\n--amend") would split into a multi-line
    // commit subject/body — sanitizing to [A-Za-z0-9_-] keeps the message a clean
    // single line (cosmetic, mirrors the evidence_ref sanitize in buildGenesisRecord).
    const deltaSha = gitOut(
      runGit,
      ['commit-tree', tree, '-p', base, '-m', `loom spawn ${sanitizeAgentId(agentId)}`],
      'commit-tree'
    );
    const namesOut = gitOut(
      runGit,
      ['diff-tree', '--no-commit-id', '--name-only', '-r', deltaSha],
      'diff-tree'
    );
    const changed = namesOut.split('\n').map((s) => s.trim()).filter(Boolean);
    // CONSCIOUS WIDENING of the single-return contract (PR-P2a, verify-plan F2):
    // additionally return `tree` (the write-tree post-state tree, :193) + `parentHead`
    // (the forked-from HEAD, :187) — both already computed here. This SUPERSEDES the
    // "clean single-return SRP" note at stage-promote.js:400-403 (a future reader must
    // not read these as contradictory). The new keys are OPT-IN: stage-promote.js:297
    // destructures only {delta_sha, candidateRel, isEmpty} and is unaffected. P2b's
    // producer consumes `tree` (-> computePostStateHash) + `parentHead` (-> head_anchor).
    return { delta_sha: deltaSha, candidateRel: changed[0] || '', isEmpty, tree, parentHead };
  } finally {
    fs.rmSync(tempIndexPath, { force: true });
  }
}

/**
 * Reduce a spawn id to the ROOT_TASK_RECORD sentinel charset [A-Za-z0-9_-] by
 * replacing every other char with '_'. Keeps a dotted/colon'd agentId (e.g.
 * "agent.123:x") from producing an evidence_ref the A10 sentinel regex rejects.
 *
 * NOT collision-free / NOT injective: "agent.001" and "agent-001" both map to
 * "agent_001". The result is a STRUCTURAL bootstrap anchor (it makes the genesis
 * record's A10 gate pass), NOT a unique spawn identifier — the unique id is the
 * raw agentId, carried verbatim in writer_spawn_id. PR-3c-b's downstream K9 chain
 * MUST NOT key uniqueness off evidence_refs[0]; use writer_spawn_id / the
 * content-addressed transaction_id for that.
 *
 * @param {string} agentId
 * @returns {string} sanitized id (>=1 char), or '' for a non-string.
 */
function sanitizeAgentId(agentId) {
  if (typeof agentId !== 'string') return '';
  return agentId.replace(/[^A-Za-z0-9_-]/g, '_');
}

/**
 * Assemble the SHARED genesis transaction-record base fields (every field EXCEPT
 * transaction_id, which the caller computes after adding its own specifics). The
 * single source of truth for the genesis field-assembly + the two fail-fast guards
 * (sentinel-charset agentId + non-empty personaId), so buildGenesisRecord and
 * buildSpawnRecord cannot DIVERGE (verify-plan F1/R-2: a NEW buildSpawnRecord, not an
 * extension, but sharing this helper avoids the duplication honesty flagged). The
 * record is a CREATE at the genesis position; human review (PR-3c-b quarantine) is the
 * only provenance gate (the structural A10 check it later passes is NOT provenance).
 *
 * @param {Object} opts
 * @param {string} opts.agentId the spawn id (sanitized into the ROOT_TASK_RECORD sentinel).
 * @param {string} opts.personaId the authoring persona.
 * @param {string} opts.schemaVersion e.g. 'v3' — drives the genesis hash.
 * @returns {Object} the base record fields (NO transaction_id; caller adds it).
 * @throws {Error} on an agentId that doesn't sanitize to a sentinel, or a missing personaId.
 */
function genesisRecordFields({ agentId, personaId, schemaVersion }) {
  const safeId = sanitizeAgentId(agentId);
  if (safeId.length === 0) {
    throw new Error(`quarantine-promote: agentId did not sanitize to a valid ROOT_TASK_RECORD sentinel: ${JSON.stringify(agentId)}`);
  }
  // Fail FAST on a missing/empty personaId. validateTransactionRecord's
  // required-field loop uses `field in record`, which is TRUE for
  // writer_persona_id:undefined — so a record built without a personaId would
  // pass genesis validation and only blow up far downstream (the schema declares
  // writer_persona_id type:string,minLength:1, but the lightweight validator
  // spot-checks presence, not type). Guard it so A-D4 "fail fast with a concrete
  // message" holds. Shared so buildSpawnRecord inherits the SAME guard (test #6b).
  if (typeof personaId !== 'string' || personaId.length === 0) {
    throw new Error(`quarantine-promote: a non-empty personaId string is required, got ${JSON.stringify(personaId)}`);
  }
  return {
    prev_state_hash: computeGenesisHash(schemaVersion, 'per-project'),
    writer_persona_id: personaId,
    writer_spawn_id: agentId,
    operation_class: 'CREATE',
    evidence_refs: [`ROOT_TASK_RECORD:${safeId}`],
    intent_recorded_at: new Date().toISOString(),
    commit_outcome: 'COMMITTED',
    schema_version: schemaVersion,
  };
}

/**
 * Finalize a genesis-position record: assert the bootstrap sentinel, compute the
 * content-addressed transaction_id, and validate at the genesis position. Throws a
 * concrete Error on any failure (fail-fast, not a cryptic K9 reject downstream).
 *
 * IMMUTABLE (fundamentals: never mutate; create new objects): returns a NEW object
 * (`{ ...record, transaction_id }`), never mutating the caller's record. computeTransactionId
 * strips transaction_id before hashing and canonical-JSON sorts keys, so the id is identical
 * regardless of spread order — the genesis output stays content-stable.
 *
 * @param {Object} record a genesis base record (+ any builder-specific fields), sans transaction_id.
 * @returns {Object} a NEW record = the input fields + the computed transaction_id.
 */
function finalizeGenesisRecord(record) {
  // Fail FAST + concretely here, not as a cryptic K9 REJECTED_EVIDENCE later.
  if (!isBootstrapSentinel(record.evidence_refs[0])) {
    throw new Error(`quarantine-promote: built evidence_ref is not a valid bootstrap sentinel: ${JSON.stringify(record.evidence_refs[0])}`);
  }
  const finalized = { ...record, transaction_id: computeTransactionId(record) };
  const v = validateTransactionRecord(finalized, { isGenesisPosition: true });
  if (!v.valid) {
    throw new Error(`quarantine-promote: genesis record failed validation: ${(v.errors || []).join('; ')}`);
  }
  return finalized;
}

/**
 * Build a genesis transaction-record for a spawn's quarantine-staged delta.
 * REUSES the transaction-record builders for the hash + genesis prev_state_hash +
 * sentinel + validation — nothing here is hand-rolled.
 *
 * NOTE (PR-P2a): the field-assembly + fail-fast guards moved to the shared
 * genesisRecordFields helper. This function's OUTPUT is behavior-preserving — the
 * SAME field-set + the SAME content-hash body as before (honesty FLAG: NOT literally
 * byte-identical across two calls, since intent_recorded_at is a per-call wall-clock
 * timestamp so transaction_id differs; the regression test
 * (quarantine-promote.test.js) pins the field-set + content-hash integrity MODULO that
 * timestamp+id, which is the load-bearing no-new-keys-leak property). It does NOT set
 * post_state_hash / head_anchor (those are buildSpawnRecord-only).
 *
 * @param {Object} opts
 * @param {string} opts.agentId the spawn id (sanitized into the sentinel).
 * @param {string} opts.personaId the authoring persona.
 * @param {string} opts.schemaVersion e.g. 'v3' — drives the genesis hash.
 * @returns {Object} a genesis-valid transaction-record (transaction_id set).
 */
function buildGenesisRecord(opts) {
  return finalizeGenesisRecord(genesisRecordFields(opts || {}));
}

/**
 * Build a genesis SPAWN transaction-record carrying the provenance producer fields:
 * post_state_hash (the forked state's content-addressed hash) + head_anchor (the
 * forked-from HEAD — the auto-merge re-check anchor, P3). A NEW export — NOT an
 * extension of buildGenesisRecord (Open/Closed + ISP; buildGenesisRecord's signature
 * + output stay frozen) — but it SHARES the genesis base via genesisRecordFields so the
 * two builders cannot diverge.
 *
 * DORMANT in P2a: only the unit test calls this; P2b's live producer is the first
 * real caller. Genesis in the all-genesis world (every spawn forks from main — no
 * nesting); post_state_hash is recorded for P1's value-equality join + future chaining.
 *
 * INVARIANT (verify-plan M1): `postStateHash` MUST be produced by
 * transaction-record.computePostStateHash (the caller's responsibility — this builder
 * stays tree-source-agnostic). Any other derivation silently breaks
 * record-store.readByPostStateHash's join.
 *
 * @param {Object} opts
 * @param {string} opts.agentId the spawn id (sanitized into the sentinel).
 * @param {string} opts.personaId the authoring persona.
 * @param {string} opts.schemaVersion e.g. 'v3' — drives the genesis hash.
 * @param {string} opts.postStateHash 64-hex post_state_hash (computePostStateHash output).
 * @param {string|null} [opts.headAnchor] the forked-from HEAD sha (40/64-hex), or null.
 * @returns {Object} a genesis-valid transaction-record with post_state_hash + head_anchor.
 */
function buildSpawnRecord(opts) {
  const { agentId, personaId, schemaVersion, postStateHash, headAnchor } = opts || {};
  // Immutable construction: the genesis base + the two producer fields. Normalize an
  // omitted headAnchor to an explicit null (the schema is null-tolerant; recording the
  // key keeps the record shape stable for the P2b/P3 consumers).
  const record = {
    ...genesisRecordFields({ agentId, personaId, schemaVersion }),
    post_state_hash: postStateHash,
    head_anchor: headAnchor === undefined ? null : headAnchor,
  };
  return finalizeGenesisRecord(record);
}

module.exports = {
  deriveParentRoot,
  materializeDelta,
  buildGenesisRecord,
  buildSpawnRecord,
  // Exposed for testing / PR-3c-b reuse:
  sanitizeAgentId,
};
