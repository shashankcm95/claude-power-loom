#!/usr/bin/env node

// @loom-layer: lab
//
// Autonomous-SDE ladder item 3 (PR-3) - the gh-verified-lane MINTER (SHADOW, UNSIGNED).
//
// mintFromMergeOutcome({ join_key_id }, opts) consumes the kernel-sealed, gh-verified merge-outcome
// RECORD (#451, merge-outcome-store.js) - the FIRST reader of that record - and mints the world_anchored
// NODE (live-recall-store.js) + the world-anchored-by EDGE (world-anchor-edge-store.js). It rebinds the
// edge's TRUST ANCHOR off the LEGACY unsafe path:
//   - **`to_delta_ref = record.approval_hash`** (the kernel-SEALED field, content-address of EXACTLY the
//     bytes that shipped under a valid broker-signed human approval - join-key-store.js), NEVER
//     `att.diff_hash` (the old unauthenticated lab anchor) and NEVER `att.approval_hash` (lab-written,
//     same-uid co-forgeable). The attestation's `approval_hash` is an ADVISORY defense-in-depth
//     cross-check ONLY (emit-on-divergence, never a gate, never the binding source - see the cross-check
//     site below).
//   - **`merge_sha = record.merge_commit_sha`** (gh-verified-at-observe-time), NEVER a caller/CLI arg
//     (the legacy pasted-sha forge surface is removed with the legacy mint).
// The node's merge_sha is gh-verified world-EVIDENCE, NOT authentication (live-recall-store.js:24 frames
// it as world-evidence - keep that framing); the EDGE (`to_delta_ref`), not the node, is the trust-anchor
// rebind target.
//
// SHADOW / WEIGHT-INERT: the edge stays UNSIGNED in production (no edgeSigner vehicle - that is the
// deferred PR-A2b). LIVE_SOURCES stays Object.freeze([]); no production consumer admits the world-anchor
// source. This mint NARROWS the #273 surface (trust moves from an unauthenticated lab field onto the
// kernel-authoritative gh-verified join-key) but does NOT close it: the edge is unsigned (same-uid
// co-forge of the merge-outcome record + attestation is still possible). The provenance close is the
// deferred cross-uid signer (PR-A2b) + the LIVE_SOURCES flip (PR-B). Merged code only narrows; only a
// DEPLOYED cross-uid signer the host cannot read() + accumulated world-anchored merges HARDEN (OQ-NS-6).
//
// PR-A2a (RFC S5.5 steps 1+2) - the INBOUND authentication. The W3 merge-outcome record carries a
// broker-sig provenance bundle {lesson_commitment, approvedAt, nonce, key_id, broker_sig}, SHAPE-validated
// at rest but NOT crypto-verified by any store (the stores hold no verify key, by design). This mint is the
// FIRST + ONLY crypto-verifier of that persisted broker_sig, and it strengthens the lesson join from
// signature-only to BODY-binding. The two steps (engaged when opts.verifyKeyPem is supplied):
//   - STEP 1 (broker_sig verify): reconstruct approvalSigBasis({hash: record.approval_hash, approvedAt,
//     nonce, key_id, lesson_commitment}) and verifyRecordSig against the CUSTODY-pinned verifyKeyPem with
//     allowEnvFallback:false (a same-uid host must NOT point the verifier at its own ambient key - the H1
//     close). A false verify -> refuse broker-sig-invalid; a throw in either primitive -> refuse
//     auth-verify-error. Runs BEFORE the node mint (refuse-before-write).
//   - STEP 2 (commitment re-derive): computeLessonCommitment({lesson_signature, lesson_body}) over the
//     RESOLVED floor lesson must === record.lesson_commitment. The mint's own join is by lesson_signature
//     ALONE, so the commitment (which binds the BODY) is strictly stronger and catches a lesson_body reword
//     under a kept signature. A mismatch -> refuse lesson-commitment-mismatch; a throw -> auth-verify-error.
// ENGAGEMENT-ON-PRESENCE (SHADOW-safe, NOT fail-open): no consumer reads the mint for a weight, the edge is
// UNSIGNED, LIVE_SOURCES is frozen, so an un-authenticated mint produces an edge no live consumer admits. The
// fail-closed boundary correctly lives at the CONSUMER (PR-B, which MUST flip this to refuse-on-absent when a
// consumer goes live - a NAMED PR-B residual). ENGAGEMENT is by PRESENCE, asymmetric (security.md): an ABSENT
// verifyKeyPem (property missing / undefined / null) = un-armed -> un-authenticated SHADOW; a PRESENT-but-invalid
// one ('' / non-string) = intent-to-authenticate-misconfigured -> ENGAGE + fail closed (never a silent skip).
// When NO verifyKeyPem is supplied (today's un-armed production
// path), the mint proceeds un-authenticated SHADOW BUT emits world-anchor-mint-unauthenticated on EVERY
// auto-mint - the skip is never silent (security.md). That observable-skip token is DISTINCT from the refuse
// family (live-recall-mint-refused), so a triager reading the stream never mistakes an un-armed mint for a
// failure. OQ3-5 (the static grandfather, lesson_commitment==='') is ADMITTED-and-OBSERVED
// (world-anchor-mint-uncommitted-lesson): step 1 still verifies the broker_sig over the '' basis (proving a
// legitimate no-lesson approval bound this merge), step 2 is skipped (no committed body to bind). The final
// commitment-required-vs-human-vetted policy is OQ3-5, deferred to the PR-B HARDEN gate; PR-A2a's choice is
// named-provisional, never silent.
//
// THE att-vs-record CROSS-CHECK IS DEFENSE-IN-DEPTH ONLY, NOT PROVENANCE (hacker H1): both sides of a
// same-uid co-forge are set equal by construction (the forger writes both the merge-outcome record and
// the attestation via the same exported derivations). The cross-check catches an HONEST stale attestation
// / an uncoordinated divergence, NOT a coordinated plant. It SURFACES the disagreement (emit) and STILL
// mints, binding the KERNEL `record.approval_hash` regardless - a divergence must NOT block a legit mint
// (a fatal refuse would be BOTH over-strict AND a same-uid denial lever).
//
// PR-2 (Half A, the captured-lesson MINT-SIDE wire) - WIDENS #273 in a NAMED, bounded way. The lesson
// floor is now TWO explicit branches that converge only at the final {lesson_signature, lesson_body}:
//   - Branch A (static grandfather): the issue-bound LESSON_2137 seed, built INSIDE the totality guard.
//   - Branch B (captured): a content-verified live_pending node (listLivePendingLessons), consumed
//     VERBATIM - the store content-address-verified it on read; the captured body has NO enum axes on
//     disk so buildWorldAnchorLesson is impossible on it (the node body comes from the verified record,
//     NEVER from the open-writable att). The two stay DISTINCT (KISS / security-over-DRY) - different
//     shapes + trust origins (human-vetted vs same-uid-forgeable).
// The join is an EXACT-SET (repo-slug, issue_ref, lesson_signature); the matched signature must round-trip
// the frozen 24-key taxonomy (off-taxonomy-lesson refuse); the floor resolves to EXACTLY ONE candidate or
// refuses (no-floor-lesson / ambiguous-floor-lesson). The #273 WIDENING (3 dimensions, all tolerable ONLY
// because weight-INERT + zero trusting readers): (1) the floor grows 1 -> N (the lever the header above
// named, landing here); (2) the body trust class flips human-vetted-constant -> untrusted model prose
// (live-lesson-derive output, carrying that module's named vacuous-leak residual); (3) the exact-one join
// is DEDUP/correctness, NOT authorization - for any uncontested (repo, issue, sig) a same-uid attacker
// co-forges one captured node + one attestation -> exactly-one match -> the mint world-anchors the
// attacker body with NO refuse. The protection that ACTUALLY holds = weight-inertness (LIVE_SOURCES=
// Object.freeze([])) + zero trusting readers; the authenticated edge minter (signed/kernel-writer edges,
// PR-A2 / item 5) is the missing AuthN + the prerequisite before ANY live_pending node gates a weight or
// the LIVE_SOURCES flip. Half B (the emit-time attestation-from-capture sourcing) is a DEFERRED named
// seam: production attestations still carry the static signature, so the captured branch is built +
// proven but PRODUCTION-INERT today (exactly #454's deriveFn=null posture). A world-anchored merge proves
// DIFF-ACCEPTANCE, never LESSON-CORRECTNESS (lesson.js:57-62 - the maintainer corrected LESSON_2137).
//
// The minter MUST NOT read the kernel join-key store - it reads the merge-outcome record's already-sealed
// `approval_hash`. The kernel join-key dam (join-key-shadow.test.js REQUIRE_ALLOWLIST = {emit-pr.js,
// merge-observer.js}) structurally ENFORCES this: a `require('.../join-key-store')` here would FAIL the
// dam. A test asserts this source carries no join-key-store require (belt + suspenders with the kernel dam).
//
// `mintFromMergeOutcome` is TOTAL end-to-end: every read is verify-on-read (returns null, never throws),
// every lesson build is try/catch'd, and every refuse is a returned `{minted:false, mint_reason}` + an
// emit. The cli auto-mint arm treats a mint throw/failure as observable-but-non-fatal (the recorded
// outcome's exit code stands).
//
// Imports: the sibling lab stores (a sibling importer is allowed by the world-anchor/ dam) + the
// causal-edge live-pending store (PR-2 captured floor - the ONE admitted reader by the live-pending dam's
// full-path allowlist) + causal-edge lesson-signature (the frozen taxonomy, for the off-taxonomy gate) +
// kernel/egress/alert (the shared observable signal; lab -> kernel + lab -> lab are LEGAL). NO kernel
// join-key store. NO runtime/kernel STATE. PURE-ish: only the stores' fs I/O + crypto.

'use strict';

const { resolveAnchorForPr, readAnchor } = require('./world-anchor-store');
const { loadMergeOutcome } = require('./merge-outcome-store');
const { mintWorldAnchoredNode } = require('./live-recall-store');
const { writeWorldAnchorEdge, loadWorldAnchorEdge, WORLD_ANCHOR_EDGE_TYPE } = require('./world-anchor-edge-store');
const { buildWorldAnchorLesson, LESSON_2137 } = require('./lesson');
const { listLivePendingLessons } = require('../causal-edge/live-pending-store');
const { lessonClusterKey, TRIGGER_CLASS, GOTCHA_CLASS, CORRECTIVE_CLASS } = require('../causal-edge/lesson-signature');
const { emitEgressAlert } = require('../../kernel/egress/alert');
// PR-A2a (RFC S5.5 steps 1+2) - the mint-side INBOUND authentication primitives (lab -> kernel, all legal;
// NOT join-key-store - the dam stays at {emit-pr.js, merge-observer.js}). approvalSigBasis reconstructs the
// broker-signed basis; verifyRecordSig crypto-verifies it custody-pinned (allowEnvFallback:false);
// computeLessonCommitment re-derives the body commitment so the join binds the body, not just the signature.
const { approvalSigBasis } = require('../../kernel/egress/approval');
const { verifyRecordSig } = require('../../kernel/_lib/edge-attestation');
const { computeLessonCommitment } = require('../../kernel/_lib/lesson-commitment');

// The orchestrator-authored STATIC GRANDFATHER floor (relocated here from cli.js): a STATIC list of
// ISSUE-BOUND seed blocks. PR-2 makes each seed issue-bound (repo + issue_ref) so the captured floor and
// the grandfather seed share ONE exact-set join key (repo-slug, issue_ref, lesson_signature). The mint
// NEVER reads a caller-supplied body (hacker H2); it builds each seed INSIDE the guarded mint path and
// matches the built lesson_signature against the VERIFIED attestation's content_hash-SEALED one. spec-kitty
// predates the capture lane; this issue-bound seed keeps its mint working (the grandfather). item 4's
// classifier extends this list (append-only, mirroring the frozen taxonomy floor).
//
// CodeRabbit Major (FOLD A): this is a STATIC SEED LIST, NOT a derived-key map. The prior shape
// (`{ [buildWorldAnchorLesson(SEED).lesson_signature]: SEED }`) called the builder at MODULE-LOAD - a
// seed/builder regression would throw at REQUIRE, BEFORE the guarded `lesson-build-failed` path,
// breaking the documented TOTAL/non-fatal contract observe-merge relies on (and it is exactly wrong for
// item 4, when the floor becomes a runtime classifier map). All building now happens inside the mint's
// try/catch (collectStaticCandidates below), so a regression surfaces `lesson-build-failed`/
// `no-floor-lesson`, never a load-time crash.
const ORCHESTRATOR_LESSON_SEEDS = Object.freeze([
  Object.freeze({ repo: 'Priivacy-ai/spec-kitty', issue_ref: 2097, seed: LESSON_2137 }),
]);

// The frozen 24-key taxonomy set (TRIGGER x GOTCHA x CORRECTIVE), derived ONCE at module load over the
// frozen enums (PURE - no fs/build, so it does NOT break the FOLD-A no-build-at-require invariant). A
// matched lesson_signature MUST be one of these (MED-1): validateBlock on the captured lane only
// length-bounds the signature (<=512), so a co-forged node can carry a non-canonical key
// (lesson:INVALID|...); resolving it would seat an off-taxonomy node in the recall graph (breaking the
// freeze invariant). A non-canonical MATCH -> refuse off-taxonomy-lesson + emit.
const CANONICAL_LESSON_SIGNATURES = (() => {
  const set = new Set();
  for (const trigger_class of TRIGGER_CLASS) {
    for (const gotcha_class of GOTCHA_CLASS) {
      for (const corrective_class of CORRECTIVE_CLASS) {
        set.add(lessonClusterKey({ trigger_class, gotcha_class, corrective_class }));
      }
    }
  }
  return set;
})();

/** Is `sig` one of the 24 canonical lessonClusterKey keys (the frozen taxonomy)? (MED-1) */
function isCanonicalLessonSignature(sig) { return CANONICAL_LESSON_SIGNATURES.has(sig); }

// The owner/repo slug from EITHER a `https://github.com/owner/repo` URL OR a bare `owner/repo` slug;
// null for anything else. The JOIN-BUG fix: the attestation `repo` is a SLUG (validateAttestation only
// length-bounds it; resolveAnchorForPr forces it === the merge record's slug), but the captured lane
// enforces a URL (GH_REPO_RE -> https://github.com/owner/repo). So `captured.repo === att.repo` is broken
// by construction. Normalize BOTH sides to the slug before comparing. A non-matching shape -> null (which
// can never equal another slug, so a malformed repo never joins).
const GH_URL_SLUG_RE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/;
const BARE_SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
function repoSlug(s) {
  if (typeof s !== 'string') return null;
  const m = GH_URL_SLUG_RE.exec(s);
  const raw = m ? m[1] : (BARE_SLUG_RE.test(s) ? s : null);
  if (raw === null) return null;
  // Strip a trailing `.git` (a clone-URL suffix GH_REPO_RE/GH_URL_SLUG_RE both admit via `.` in the
  // char class). The canonical GH slug has no `.git`, so normalizing it lets a `.git`-form captured repo
  // and a bare-slug attestation join (VALIDATE M-1/L-1: fail-safe today since the producer emits no
  // `.git`, folded so a future Half-B producer format never silently splits the lane). One strip, like git.
  return raw.replace(/\.git$/, '');
}

/**
 * Emit a namespaced, observable mint-refuse alert. The distinguishing classifier rides `mint_reason` (a
 * NON-`reason` key): emitEgressAlert forces the positional `reason` token LAST, so a `reason` detail key
 * would be clobbered (the cli.js M1 / alert.js:19 lesson).
 */
function mintRefuseAlert(detail) { emitEgressAlert('live-recall-mint-refused', detail); }

/**
 * Mint ONE world-anchored-by EDGE binding the minted node to the kernel-SEALED approval_hash (the PR-3
 * rebind). A SMALL TOTAL helper (relocated from cli.js) so the additive-failure isolation lives in one
 * named, testable place: it NEVER throws (the store is total) and always returns the edge_* shape.
 * UNSIGNED by default (production passes no edgeSigner -> the store's signer is undefined -> a SHADOW,
 * integrity-only edge that gates nothing - no production consumer admits the world-anchor source).
 * @param {string} node_id  the minted node's id (the edge's from_node_id)
 * @param {string} approvalHash  the VERIFIED kernel-SEALED record.approval_hash (HEX64) - the to_delta_ref
 * @param {{edgeDir?: string,
 *   edgeSigner?: (id: string, edgeBody: {from_node_id, to_delta_ref, edge_type}) => string|null|undefined,
 *   now?: string}} opts
 * @returns {{edge_minted: boolean, edge_id?: string, edge_deduped?: boolean, edge_signed: boolean, edge_reason?: string}}
 */
function mintWorldAnchorEdge(node_id, approvalHash, opts = {}) {
  // recorded_at = the STABLE per-record FIRST-WRITE timestamp (opts.now = record.observed_at), so a
  // re-mint DEDUPS (recorded_at is in bodiesEqual but NOT the edge_id basis -> a fresh Date() would
  // COLLIDE-refuse). Read from loadMergeOutcome, NEVER a fresh Date() (VERIFY L2).
  const recorded_at = typeof opts.now === 'string' && opts.now.length > 0 ? opts.now : new Date().toISOString();
  // to_delta_ref = the kernel-SEALED record.approval_hash (HEX64), NEVER att.diff_hash (the old anchor)
  // and NEVER a pasted sha. The store re-validates to_delta_ref is HEX64 (-> {ok:false,reason:'bad-to-delta-ref'});
  // approval_hash is sealed-HEX64 so that store refuse is defense-in-depth, surfaced as edge_reason.
  const e = writeWorldAnchorEdge(
    { from_node_id: node_id, to_delta_ref: approvalHash, edge_type: WORLD_ANCHOR_EDGE_TYPE[0], recorded_at },
    { dir: opts.edgeDir, signer: opts.edgeSigner },   // signer UNDEFINED in production -> UNSIGNED
  );
  if (!e.ok) return { edge_minted: false, edge_signed: false, edge_reason: e.reason };
  // edge_signed = the PERSISTED on-disk truth, NOT `typeof signer` (VALIDATE hacker H1: a supplied-but-
  // failing signer degrades to UNSIGNED in the store, so deriving from the input would LIE). Re-read the
  // verified edge: production (no signer) is always false; a failed/garbage signer is also false.
  const persisted = loadWorldAnchorEdge(e.edge_id, { dir: opts.edgeDir });
  return { edge_minted: true, edge_id: e.edge_id, edge_deduped: !!e.deduped, edge_signed: !!(persisted && persisted.sig_alg) };
}

/**
 * BRANCH A (static grandfather): collect the candidate lesson(s) from the issue-bound STATIC seed floor.
 * For each seed where the slug + issue_ref + built signature all join the attestation, the candidate body
 * is the BUILT seed lesson (the FOLD-A no-build-at-require invariant stays: buildLesson runs INSIDE the
 * caller's try/catch, never at module load). A built lesson is human-vetted (LESSON_2137 was
 * maintainer-corrected); its trust origin is DISTINCT from a captured lesson (the §4 trust distinction).
 * @returns {{lesson_signature: string, lesson_body: string, origin: 'static'}[]}
 */
function collectStaticCandidates(att, buildLesson) {
  const out = [];
  const attSlug = repoSlug(att.repo);
  for (const seed of ORCHESTRATOR_LESSON_SEEDS) {
    if (repoSlug(seed.repo) !== attSlug || seed.issue_ref !== att.issueRef) continue;
    const built = buildLesson(seed.seed);
    if (built && built.lesson_signature === att.lesson_signature) {
      out.push({ lesson_signature: built.lesson_signature, lesson_body: built.lesson_body, origin: 'static' });
    }
  }
  return out;
}

/**
 * BRANCH B (captured): collect the candidate lesson(s) from the content-verified live_pending floor. A
 * captured record is consumed VERBATIM - the store already content-address-verified it on read, and the
 * captured body carries NO enum axes on disk (live-pending buildBody persists the solve-identity + lesson
 * fields + the Track-A-W2 persona-context pins, but NO trigger_class/gotcha/corrective enum), so
 * buildWorldAnchorLesson is impossible on it; the verified store body IS the lesson. The pins are NOT
 * carried forward here - the forward-carry into the world_anchored node is a later wave (blueprint 3a). The
 * join is the exact-set (repo-slug, issue_ref, lesson_signature) - listLivePendingLessons is TOTAL (never
 * throws). The node body comes from the content-verified record, NEVER from the open-writable att.
 * @returns {{lesson_signature: string, lesson_body: string, origin: 'captured'}[]}
 */
function collectCapturedCandidates(att, pendingDir) {
  const out = [];
  const attSlug = repoSlug(att.repo);
  for (const rec of listLivePendingLessons({ dir: pendingDir })) {
    if (repoSlug(rec.repo) === attSlug && rec.issue_ref === att.issueRef && rec.lesson_signature === att.lesson_signature) {
      out.push({ lesson_signature: rec.lesson_signature, lesson_body: rec.lesson_body, origin: 'captured' });
    }
  }
  return out;
}

/**
 * Mint a world_anchored lesson NODE + the approval_hash-anchored EDGE from the gh-verified merge-outcome
 * RECORD (#451). The SOLE mint path as of PR-3 (the legacy pasted-sha record-merge mint is removed). It
 * takes ONLY the record's join_key_id; there is NO caller surface for the lesson body / merge_sha /
 * approval_hash (every trust input is read verify-on-read from the record + the resolved attestation -
 * hacker H2). TOTAL: never throws; every refuse is a returned `{minted:false, mint_reason}` + an emit.
 *
 * @param {{join_key_id: string}} args  the merge-outcome record key (a content-addressed HEX64).
 * @param {{anchorDir?: string, outcomeDir?: string, liveDir?: string, edgeDir?: string, pendingDir?: string,
 *   edgeSigner?: (id: string, edgeBody: {from_node_id, to_delta_ref, edge_type}) => string|null|undefined,
 *   buildLesson?: (seed: object) => object, verifyKeyPem?: string}} [opts]
 *   SYMMETRIC per-store opt keys (hacker M1: a wrong key must not silently fall through to a REAL store):
 *   anchorDir = the world-anchor (attestation) store dir; outcomeDir = the merge-outcome store dir;
 *   liveDir = the live-recall node store dir; edgeDir = the world-anchored-by edge store dir; pendingDir =
 *   the captured live_pending store dir (PR-2 captured floor); edgeSigner = the off-host signer (UNDEFINED
 *   in production -> UNSIGNED); buildLesson = the static-seed builder (a TEST seam for Branch A's M2
 *   totality path; defaults to buildWorldAnchorLesson). verifyKeyPem = the PR-A2a custody verify key (the
 *   ENGAGEMENT signal: present -> broker_sig verify + commitment re-derive, fail-closed; absent -> the
 *   un-authenticated SHADOW path that emits world-anchor-mint-unauthenticated). It is NOT a dir key (read by
 *   name, never iterated), so it sits OUTSIDE the FOLD-B all-or-nothing dirKeys guard + the `'dir' in o`
 *   reject. A null/non-object opts is normalized to {} (TOTAL contract); production passes none (every store
 *   defaults to its real dir; no verify key -> un-authenticated SHADOW).
 * @returns {{minted: boolean, node_id?: string, deduped?: boolean, mint_reason?: string,
 *   edge_minted?: boolean, edge_id?: string, edge_deduped?: boolean, edge_signed?: boolean, edge_reason?: string,
 *   auth_observed?: boolean, commitment_verified?: boolean}}
 *   `edge_signed:false` is the PRODUCTION invariant (no signer). A consumer MUST read
 *   `edge_minted:true, edge_signed:false` as RECORDED-not-TRUSTED (an integrity-only, UNSIGNED,
 *   weight-inert edge), NEVER a weight source. `minted`/`edge_minted` are RECORD events, not trust events.
 *   PR-A2a adds `auth_observed` + `commitment_verified` on the minted path - BOTH are RECORD events, not
 *   trust events (mirroring `edge_signed`): a same-uid caller controls this in-process return; downstream
 *   trust comes ONLY from the SIGNED edge (authenticatedWorldAnchorIds, PR-A2b). `auth_observed` /
 *   `commitment_verified` are meaningful only in conjunction with `edge_signed:true`, which PR-A2a NEVER
 *   produces. NEITHER flag enters any node/edge SCHEMA (return-shape only).
 */
function mintFromMergeOutcome(args, opts = {}) {
  // TOTALITY (hacker L1): normalize a bad opts (null / non-object / array) to {} so opts.* reads cannot
  // throw a TypeError - mirrors the args guard below + merge-observer.js:64. The function is documented
  // TOTAL (never throws); a caller passing `null` for opts must get a refuse, not a crash.
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const join_key_id = args && typeof args === 'object' && !Array.isArray(args) ? args.join_key_id : undefined;
  const buildLesson = typeof o.buildLesson === 'function' ? o.buildLesson : buildWorldAnchorLesson;

  // FOLD B (CodeRabbit Major): isolation is ALL-OR-NOTHING. The minter reads + writes FIVE stores
  // (anchorDir/outcomeDir/liveDir/edgeDir + pendingDir for the PR-2 captured floor); a PARTIAL set
  // silently lets the un-wired stores fall back to the REAL ~/.claude/lab-state, so a run that LOOKS
  // isolated cross-writes real state. Enforce: the supported per-store dir keys must be supplied either 0
  // (production - all real, fully consistent) or 5 (fully isolated). A stray legacy `dir` key (the
  // pre-FOLD-2 attestation key) is rejected outright - silently ignoring it would let a "dir"-passing
  // caller think it isolated the attestation store. Both are TOTAL refuses (emit + return; never throw).
  // The correct ISOLATION ROOT for the CLI is LOOM_LAB_STATE_DIR (each store derives its own subdir
  // natively); these opt keys are the TEST seam.
  if ('dir' in o) {
    mintRefuseAlert({ join_key_id, mint_reason: 'unsupported-dir-key' });
    return { minted: false, mint_reason: 'unsupported-dir-key' };
  }
  const dirKeys = ['anchorDir', 'outcomeDir', 'liveDir', 'edgeDir', 'pendingDir'];
  const supplied = dirKeys.filter((k) => o[k] !== undefined);
  if (supplied.length !== 0 && supplied.length !== dirKeys.length) {
    mintRefuseAlert({ join_key_id, mint_reason: 'incomplete-dir-wiring', supplied });
    return { minted: false, mint_reason: 'incomplete-dir-wiring' };
  }

  // 1. the gh-verified merge-outcome RECORD (verify-on-read; null on absent/tampered/foreign/oversize).
  //    The minter ALSO emits its own merge-outcome-unreadable so a triager sees "the minter refused",
  //    not just a store returning null (VERIFY M1).
  const record = loadMergeOutcome(join_key_id, { dir: o.outcomeDir });
  if (!record) {
    mintRefuseAlert({ join_key_id, mint_reason: 'merge-outcome-unreadable' });
    return { minted: false, mint_reason: 'merge-outcome-unreadable' };
  }

  // 2. EXACT-string outcome gate (never a subset/includes - the manage-promote IDOR class). DEFENSE-IN-
  //    DEPTH-FOR-WHEN-OUTCOMES-GROWS: merge-outcome-store.OUTCOMES is ['merged'] today, so loadMergeOutcome
  //    rejects any non-merged record on read (this branch is unconstructible now); the gate stays as a
  //    forward guard for when OUTCOMES grows past 'merged'.
  if (record.outcome !== 'merged') {
    mintRefuseAlert({ join_key_id, mint_reason: 'outcome-not-merged', outcome: record.outcome });
    return { minted: false, mint_reason: 'outcome-not-merged' };
  }

  // 3. resolve the attestation by the RECORD's (repo, pr_number, pr_url) tuple (the EXACT-set join;
  //    resolveAnchorForPr already emits world-anchor-unattested-merge on 0/>1). Surface its reason as
  //    the mint_reason ('no-match' / 'ambiguous'); the minter ALSO emits attestation-unreadable so the
  //    minter-layer refuse is observable (VERIFY M1).
  const resolved = resolveAnchorForPr(
    { repo: record.repo, pr_number: record.pr_number, pr_url: record.pr_url },
    { dir: o.anchorDir },
  );
  if (!resolved.ok) {
    mintRefuseAlert({ join_key_id, mint_reason: resolved.reason, anchor_resolve: 'attestation-unreadable' });
    return { minted: false, mint_reason: resolved.reason };
  }
  const att = readAnchor(resolved.anchor_id, { dir: o.anchorDir });        // VERIFIED + content_hash-sealed
  if (!att) {
    mintRefuseAlert({ join_key_id, anchor_id: resolved.anchor_id, mint_reason: 'attestation-unreadable' });
    return { minted: false, mint_reason: 'attestation-unreadable' };
  }

  // 4. ADVISORY cross-check (NOT a gate, NOT provenance - see the header). att.approval_hash is lab-written
  //    + same-uid co-forgeable, so it is NEVER the binding source; a divergence must NOT block a legit mint
  //    (a fatal refuse would be over-strict AND a same-uid denial lever). SURFACE the disagreement, then
  //    STILL mint, binding the KERNEL record.approval_hash regardless. Defense-in-depth only.
  if (att.approval_hash !== record.approval_hash) {
    emitEgressAlert('world-anchor-approval-hash-divergence', {
      anchor_id: resolved.anchor_id,
      join_key_id,
      divergence: 'att-approval-hash-vs-record',   // a distinguishing token on a NON-`reason` key
    });
    // intentional fall-through: bind record.approval_hash regardless (the kernel-sealed field).
  }

  // 4a. PR-A2a STEP 1 (RFC S5.5 step 1) - the INBOUND broker_sig verify. Engages on opts.verifyKeyPem
  //     presence (mirroring the edgeSigner / authenticatedWorldAnchorIds precedent). Runs BEFORE lesson
  //     resolution (needs only the record bundle) + BEFORE the node mint (refuse-before-write). When
  //     engaged, MANDATORY + fail-closed: reconstruct the basis the broker signed and crypto-verify it
  //     against the CUSTODY-pinned key (allowEnvFallback:false - a same-uid host must not point the
  //     verifier at its own ambient LOOM_EDGE_VERIFY_KEY, the H1 close). approvalSigBasis THROWS on a
  //     non-string lesson_commitment + verifyRecordSig is fail-soft (never throws), but BOTH are wrapped in
  //     ONE try/catch -> a throw becomes a fail-closed auth-verify-error, never a crash (TOTAL). Each refuse
  //     EMITS before returning (security.md: never a silent {ok:false}). When NOT engaged, the un-armed
  //     SHADOW path emits an observable-skip (distinct token from the refuse family) and continues.
  //     ENGAGE on PRESENCE, fail CLOSED on present-but-invalid (CodeRabbit Major + security.md asymmetric-
  //     parse): ABSENT (property missing / undefined / null) = the un-armed path -> un-authenticated SHADOW
  //     skip; PRESENT-but-invalid ('' / non-string / malformed PEM) = intent-to-authenticate-misconfigured
  //     -> ENGAGE and fail closed (verifyRecordSig returns false on an empty/unloadable key -> broker-sig-
  //     invalid; a non-string throws -> the try/catch yields auth-verify-error). A present-but-empty custody
  //     key must NOT silently degrade to the unauthenticated path (the PR-B arming footgun, closed here).
  const authEngaged = Object.prototype.hasOwnProperty.call(o, 'verifyKeyPem')
    && o.verifyKeyPem !== undefined
    && o.verifyKeyPem !== null;
  const verifyKeyPem = authEngaged ? o.verifyKeyPem : null;
  if (authEngaged) {
    let sigOk;
    try {
      const basis = approvalSigBasis({
        hash: record.approval_hash,
        approvedAt: record.approvedAt,
        nonce: record.nonce,
        key_id: record.key_id,
        lesson_commitment: record.lesson_commitment,
      });
      sigOk = verifyRecordSig(basis, record.broker_sig, { publicKeyPem: verifyKeyPem, allowEnvFallback: false });
    } catch (err) {
      mintRefuseAlert({ join_key_id, anchor_id: resolved.anchor_id, mint_reason: 'auth-verify-error', detail: (err && err.message) || 'error' });
      return { minted: false, mint_reason: 'auth-verify-error' };
    }
    if (!sigOk) {
      mintRefuseAlert({ join_key_id, anchor_id: resolved.anchor_id, mint_reason: 'broker-sig-invalid' });
      return { minted: false, mint_reason: 'broker-sig-invalid' };
    }
  } else {
    // un-armed SHADOW (today's production): proceed un-authenticated but NEVER silently - the skip is an
    // observable event, distinct from the live-recall-mint-refused refuse family so a triager can filter.
    emitEgressAlert('world-anchor-mint-unauthenticated', { join_key_id });
  }

  // 5. TWO-BRANCH lesson resolution (PR-2 CRITICAL-1) on the VERIFIED attestation's content_hash-SEALED
  //    lesson_signature (never a caller field - hacker H2). Branch A (static grandfather, built INSIDE the
  //    totality guard - FOLD A no-build-at-require) + Branch B (captured live_pending, consumed verbatim;
  //    a captured body has NO enum axes on disk so it cannot be rebuilt) converge ONLY at the final
  //    {lesson_signature, lesson_body}. The two are kept DISTINCT (KISS / security-over-DRY) - different
  //    shapes + trust origins (human-vetted vs same-uid-forgeable); a premature merge erases the trust
  //    distinction §4 depends on. TOTALITY (VERIFY M2): a Branch-A build throw -> lesson-build-failed +
  //    refuse, NEVER throw (item 4 loads seeds at runtime; a throw would crash the cli auto-mint arm).
  let candidates;
  try {
    candidates = [
      ...collectStaticCandidates(att, buildLesson),
      ...collectCapturedCandidates(att, o.pendingDir),
    ];
  } catch (err) {
    mintRefuseAlert({ join_key_id, anchor_id: resolved.anchor_id, mint_reason: 'lesson-build-failed', detail: (err && err.message) || 'error' });
    return { minted: false, mint_reason: 'lesson-build-failed' };
  }
  // EXACT-SET resolution (mirrors resolveAnchorForPr; never a subset/.includes). 0 -> no-floor-lesson;
  // the matched signature must round-trip the frozen 24-key taxonomy (MED-1: validateBlock only
  // length-bounds a captured signature) else off-taxonomy-lesson; >1 -> ambiguous-floor-lesson
  // (fail-closed: protects the grandfather from silent substitution - a planted competing tuple DENIES a
  // weight-inert shadow mint, never SUBSTITUTES the body). Each refuse is OBSERVABLE.
  if (candidates.length === 0) {
    mintRefuseAlert({ join_key_id, anchor_id: resolved.anchor_id, mint_reason: 'no-floor-lesson', lesson_signature: att.lesson_signature });
    return { minted: false, mint_reason: 'no-floor-lesson' };
  }
  if (!isCanonicalLessonSignature(att.lesson_signature)) {
    mintRefuseAlert({ join_key_id, anchor_id: resolved.anchor_id, mint_reason: 'off-taxonomy-lesson', lesson_signature: att.lesson_signature });
    return { minted: false, mint_reason: 'off-taxonomy-lesson' };
  }
  if (candidates.length > 1) {
    mintRefuseAlert({ join_key_id, anchor_id: resolved.anchor_id, mint_reason: 'ambiguous-floor-lesson', lesson_signature: att.lesson_signature, matches: candidates.length });
    return { minted: false, mint_reason: 'ambiguous-floor-lesson' };
  }
  // `lesson.origin` ('static' | 'captured') is a STRUCTURAL trust-discriminator on the candidate (the §4
  // human-vetted-vs-captured distinction); it is DELIBERATELY not propagated to the node schema (no
  // consumer needs it yet - VALIDATE L-2). Only {lesson_signature, lesson_body} cross to the store.
  const lesson = candidates[0];

  // 5a. PR-A2a STEP 2 (RFC S5.5 step 2) - the commitment RE-DERIVE (the BODY binding). Only when engaged +
  //     after lesson resolution (it needs the resolved body) + BEFORE the node mint (refuse-before-write).
  //     The mint's own join is by lesson_signature ALONE, so re-deriving computeLessonCommitment over the
  //     RESOLVED floor lesson's {signature, body} and asserting it === record.lesson_commitment binds the
  //     BODY - strictly stronger; it catches a lesson_body reword under a kept signature (F5: the floor
  //     body is seated verbatim into the node, live-recall-store.js buildBody, so this is byte-equivalent to
  //     the RFC's "verified node body" re-derive and strictly stronger - it refuses without persisting).
  //     OQ3-5: a '' record.lesson_commitment is the static grandfather (no committed lesson); the re-derive
  //     is SKIPPED (computeLessonCommitment would THROW on the body-vs-'' mismatch anyway) + an observable
  //     uncommitted-lesson emit, ADMITTING the grandfather on its step-1 broker-sig provenance.
  //     commitment_verified stays false on the '' skip (the body was NOT bound). A throw -> auth-verify-error.
  let commitmentVerified = false;
  if (authEngaged) {
    if (record.lesson_commitment === '') {
      emitEgressAlert('world-anchor-mint-uncommitted-lesson', { join_key_id });
    } else {
      let rederived;
      try {
        rederived = computeLessonCommitment({ lesson_signature: lesson.lesson_signature, lesson_body: lesson.lesson_body });
      } catch (err) {
        mintRefuseAlert({ join_key_id, anchor_id: resolved.anchor_id, mint_reason: 'auth-verify-error', detail: (err && err.message) || 'error' });
        return { minted: false, mint_reason: 'auth-verify-error' };
      }
      if (rederived !== record.lesson_commitment) {
        mintRefuseAlert({ join_key_id, anchor_id: resolved.anchor_id, mint_reason: 'lesson-commitment-mismatch' });
        return { minted: false, mint_reason: 'lesson-commitment-mismatch' };
      }
      commitmentVerified = true;
    }
  }

  // 6. node: the gh-verified record.merge_commit_sha is world-EVIDENCE (live-recall-store.js:24), NEVER a
  //    pasted arg. The lesson identity is re-derived from the floor block (== att.lesson_signature).
  const m = mintWorldAnchoredNode({
    anchor_id: resolved.anchor_id,
    merge_sha: record.merge_commit_sha,                                 // gh-verified, NEVER a caller arg
    lesson_signature: lesson.lesson_signature,
    lesson_body: lesson.lesson_body,
  }, { dir: o.liveDir });
  if (!m.ok) return { minted: false, mint_reason: m.reason };           // the live store already emitted an observable alert

  // 7. NODE-RESULT-FIRST + additive edge (D2): the node mint is the load-bearing result. mintWorldAnchorEdge
  //    is TOTAL (it cannot throw), and a FRESH spread (never a mutation) keeps the node-result byte-identical
  //    on an edge failure. recorded_at = record.observed_at (the persisted first-write timestamp, NEVER a
  //    fresh Date() - L2), so a re-mint DEDUPS. to_delta_ref = record.approval_hash (the kernel-SEALED field).
  const nodeResult = { minted: true, node_id: m.node_id, deduped: !!m.deduped };
  const edge = mintWorldAnchorEdge(m.node_id, record.approval_hash, {
    edgeDir: o.edgeDir,
    edgeSigner: o.edgeSigner,
    now: record.observed_at,
  });
  // PR-A2a (F1) - thread the TWO RECORD-event flags (NOT trust events; see the return JSDoc + the
  // edge_signed RECORD-not-trust framing above). auth_observed === authEngaged: reaching this point with
  // authEngaged true means step 1's broker_sig verify PASSED (a false verify / a throw already returned a
  // fail-closed refuse), so authEngaged here IS "broker_sig verified". commitment_verified is true ONLY
  // when step 2 actually RAN and MATCHED (false on the '' grandfather skip + when not engaged) - this is
  // what stops a downstream reader treating a '' record as body-bound. NEITHER enters the node/edge schema.
  return { ...nodeResult, ...edge, auth_observed: authEngaged, commitment_verified: commitmentVerified };
}

/**
 * Half B (item-3-live) - the EMIT-side producer's captured-lesson lookup. Given the attestation's
 * pre-normalized (repoSlug, issueRef, candidatePatchSha), select EXACTLY the captured live_pending lesson
 * the emit-side attestation should carry, such that the #455 mint's Branch B (collectCapturedCandidates,
 * which re-joins on (repoSlug, issue_ref, lesson_signature) ONLY) will resolve exactly-one. It lives HERE,
 * in the existing admitted lane reader, so the producer's lookup and the mint's Branch-B join CANNOT
 * diverge (same module, same repoSlug + listLivePendingLessons) - and cli.js never reads the lane directly
 * (the dam stays at one reader). It is a READ-ONLY lookup returning a coarse-bucket signature string; it
 * exposes no trust-bypass (the mint's binding stays gated by its own exact-set re-resolution). The
 * exact-set checks below are DEDUP/correctness, NOT authorization (cf. the file-header #273 dimension-3
 * note): a same-uid co-forge of one captured node + one attestation still yields exactly-one -> a clean
 * (attacker-body) mint with NO refuse - tolerable ONLY because weight-inert; PR-A2's authenticated minter is the close.
 *
 * TWO fail-closed exact-set checks (compute-the-set, require-exactly-one - NEVER .find()/[0]/first-wins,
 * mirroring collectCapturedCandidates + resolveAnchorForPr):
 *   1. Filter the lane to (repoSlug, issue_ref, candidate_patch_sha); require EXACTLY ONE (0 ->
 *      no-captured-lesson; >1 -> ambiguous-captured-patch [two lesson axes from one patch]). This yields
 *      ONE lesson_signature.
 *   2. Verify (repoSlug, issue_ref, that lesson_signature) is EXACTLY ONE in the lane (the mint's
 *      Branch-B precondition - so producer-success <=> the mint's CARDINALITY precondition is met; the
 *      taxonomy gate is the mint's SEPARATE authority - an off-taxonomy sig then mints OR refuses
 *      off-taxonomy-lesson). Else ambiguous-captured-lesson (the mint would refuse anyway; attesting it
 *      is meaningless).
 *
 * TOTAL: listLivePendingLessons is total (never throws); this returns {ok, lesson_signature} | {ok:false,
 * reason} and never throws. Every refuse is OBSERVABLE (the classifier rides the NON-`reason` mint_reason
 * key, mirroring mintRefuseAlert).
 *
 * @param {{repoSlug: string, issueRef: number, candidatePatchSha: string}} q  the attestation's join keys
 *   (repoSlug already normalized by the caller via the same repoSlug used here).
 * @param {{pendingDir?: string}} [opts]  pendingDir = the captured live_pending store dir (a TEST seam;
 *   production passes none -> the real default). A null/non-object opts normalizes to {}.
 * @returns {{ok: true, lesson_signature: string} | {ok: false, reason: string}}
 */
function resolveCapturedSignatureForAttest(q, opts = {}) {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const query = q && typeof q === 'object' && !Array.isArray(q) ? q : {};
  const wantSlug = repoSlug(query.repoSlug);
  const wantIssue = query.issueRef;
  const wantCps = query.candidatePatchSha;
  const lane = listLivePendingLessons({ dir: o.pendingDir });

  // Check 1: EXACTLY ONE captured node for (repoSlug, issue_ref, candidate_patch_sha).
  const byPatch = lane.filter((rec) => repoSlug(rec.repo) === wantSlug
    && rec.issue_ref === wantIssue
    && rec.candidate_patch_sha === wantCps);
  if (byPatch.length === 0) {
    mintRefuseAlert({ mint_reason: 'no-captured-lesson', repo_slug: wantSlug, issue_ref: wantIssue });
    return { ok: false, reason: 'no-captured-lesson' };
  }
  if (byPatch.length > 1) {
    mintRefuseAlert({ mint_reason: 'ambiguous-captured-patch', repo_slug: wantSlug, issue_ref: wantIssue, matches: byPatch.length });
    return { ok: false, reason: 'ambiguous-captured-patch' };
  }
  const lesson_signature = byPatch[0].lesson_signature;
  const lesson_body = byPatch[0].lesson_body;               // Wave B: the promoter needs the body too

  // Check 2: the mint's Branch-B precondition - EXACTLY ONE node for (repoSlug, issue_ref, lesson_signature).
  const bySignature = lane.filter((rec) => repoSlug(rec.repo) === wantSlug
    && rec.issue_ref === wantIssue
    && rec.lesson_signature === lesson_signature);
  if (bySignature.length !== 1) {
    mintRefuseAlert({ mint_reason: 'ambiguous-captured-lesson', repo_slug: wantSlug, issue_ref: wantIssue, matches: bySignature.length });
    return { ok: false, reason: 'ambiguous-captured-lesson' };
  }
  // lesson_body is returned so a caller (merge-promote.js) sources it via THIS one dam-admitted reader,
  // never by importing live-pending-store directly (the full-path reader allowlist). Additive - the prior
  // caller (runAttestFromCapture) reads only .lesson_signature.
  return { ok: true, lesson_signature, lesson_body };
}

// INFORMATION HIDING (code-reviewer LOW-1): export the gated entry point + the Half B read-only lookup.
// mintWorldAnchorEdge stays PRIVATE - exporting it would let a future caller bind an UNCHECKED to_delta_ref,
// bypassing the verify-on-read merge-outcome record that is the whole trust basis (the rebind PR-3 makes).
// The lesson FLOOR (ORCHESTRATOR_LESSON_SEEDS) also stays private (the mint never reads a caller-supplied
// lesson). resolveCapturedSignatureForAttest IS exported (Half B's producer needs it) but is read-only -
// it returns a coarse-bucket signature string, exposing no trust-bypass (the mint re-resolves exactly-one
// independently). Tests drive mintFromMergeOutcome (the structural/header asserts read the source via fs).
module.exports = { mintFromMergeOutcome, resolveCapturedSignatureForAttest };
