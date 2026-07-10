'use strict';

// ③.2.2c — the semantic-only DRAFT loop on REAL repos. Per live-puller record:
//   contained actor-solve (#391 runActorInContainer over a host prepareClone) ->
//   SHADOW semantic grade (oracle-free) -> emitPR DRY-RUN draft -> write artifact.
// EMITS NOTHING (emitPR default disposition = dry-run; armedEmit throws). Executes stranger code
// ONLY inside the #391 container; the host-side judges are tool-PINNED (no host-action blast radius).

const fs = require('fs');
const path = require('path');

const {
  resolveActorApiKey, assertWithinBudget, recordCost, DEFAULT_COST_CAP_USD,
} = require('../issue-corpus/cost-ledger');
const { runActorInContainer, attestActorContainment } = require('../issue-corpus/docker-actor-backend');
const { prepareClone, captureActorDiff, safeDiscard } = require('../issue-corpus/_clone-lifecycle');
const { MAX_PATCH_BYTES } = require('./real-solve');
const { emitPR } = require('../../kernel/egress/emit-pr');
const { gradeLiveIssueSemantic, digest } = require('../causal-edge/live-grade');
const { makeBlindSemanticJudge } = require('../causal-edge/calibration-issue-run');
const { makeFrictionLabeler, buildActorPrompt, resolveClaude } = require('../causal-edge/trajectory-friction-run');
const { verifyToollessRuntime } = require('../_lib/claude-headless');
const { classifyIssue } = require('./issue-classifier');
const { materialize: materializePersona } = require('./persona-prompt-materializer');
// Track A W1 - the cross-uid recall-inject bridge. SHADOW-inert (returns '' on every un-deployed box)
// until an operator deploys the cross-uid launcher; it is the ONLY seam by which recall reaches the
// drafter (subprocess-only, never a static require of the recall lane - the disjointness dam holds).
const { retrieveRecallBlock } = require('./recall-inject-boundary');
// item-3-live PR-1 - the draft-time live-solve lesson CAPTURE branch (D3). A LIVE solve produces a lesson
// HYPOTHESIS captured weight-INERT into the live_pending lane (NO merge wire; PR-2 connects the merge). The
// capture is FAIL-SOFT + OUTCOME-PURE: a derive/write/throw never aborts the record (the draft still
// writes). scrubLabSecrets + sidecarSha give the candidate_patch_sha on the SCRUBBED candidate (matching
// lesson-capture.js's convention so the PR-2 join agrees on scrubbed-vs-raw).
const { isLiveLessonEligible, deriveLiveLesson } = require('../causal-edge/live-lesson-derive');
const { makeLiveLessonDeriver } = require('../causal-edge/live-lesson-derive-run');   // item-3-live leg 1 - the real claude -p deriveFn producer
const { mintLivePendingLesson } = require('../causal-edge/live-pending-store');
const { computeLessonCommitment } = require('../../kernel/_lib/lesson-commitment');   // OQ-3 - the single-source lesson commitment (moved kernel-ward in W2, fold F2)
const { sidecarSha } = require('../attribution/candidate-sidecar');
const { scrubLabSecrets } = require('../_lib/scrub-lab-secrets');
const { emitEgressAlert } = require('../../kernel/egress/alert');
// Gap-7 Part-B + Gap-9 - the submit-time terminal-block classifier + the (default-OFF) disposal of a dead
// candidate. classifyEmitTerminalBlock reads the FAILED emit result only (pure); disposeCandidate records the
// observable "why" + tombstones the pending lesson. SHADOW/dormant: the terminal branch is unreachable in the
// dry pipeline (emitPR returns ok:true), and disposal is gated OFF unless deps.disposeOnTerminalBlock is set
// (an operator-arming knob) - so both are byte-inert here.
const { classifyEmitTerminalBlock } = require('../issue-corpus/terminal-block');
const { disposeCandidate } = require('../causal-edge/live-disposal');

// item 4 (D5) - the SHADOW flag that gates the PROMPT change ONLY (default OFF keeps the prompt
// byte-identical). The classify FIELDS ride on the outcome + artifact UNCONDITIONALLY (shadow
// record), independent of this flag.
//
// M-1 (security.md asymmetric-flag rule): enabling the privileged path (injecting actor-prompt
// context) needs a STRICT explicit-truthy allowlist. A typo ('ture') or any garbage token fails
// CLOSED to the bare prompt - NOT a lenient "anything-not-falsey" parse that would let a typo
// silently enable injection.
const PERSONA_MATERIALIZE_TRUTHY = Object.freeze(['1', 'true', 'yes', 'on']);
function personaMaterializeEnabled() {
  const v = String(process.env.LOOM_PERSONA_MATERIALIZE || '').trim().toLowerCase();
  return PERSONA_MATERIALIZE_TRUTHY.includes(v);
}

// --------------------------------------------------------------------------
// Pure transforms (fold #2 / fold #5)

// parseRecordRef: record -> { slug: 'owner/repo', issueRef: <int> }.
// slug from the UNAMBIGUOUS URL (record.repo), issueRef END-anchored on the id (a repo name may
// legally contain `-issue-`, so a non-anchored parse would mis-extract — VERIFY fold #2).
function parseRecordRef(record) {
  if (!record || typeof record !== 'object') throw new Error('parseRecordRef: record required');
  const repoUrl = String(record.repo || '');
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/.exec(repoUrl);
  if (!m) throw new Error('parseRecordRef: record.repo is not a bare github URL');
  const im = /-issue-(\d+)$/.exec(String(record.id || ''));
  if (!im) throw new Error('parseRecordRef: record.id has no -issue-<N> suffix');
  const issueRef = Number(im[1]);
  // Bound to a safe integer (VALIDATE hacker MED): a 20-digit id parses to a precision-lost float for
  // which Number.isInteger() is still true; reject it now so a corrupt issue number can never target a
  // wrong/non-existent issue once ③.2.3 arms emission.
  if (!Number.isInteger(issueRef) || issueRef <= 0 || issueRef > Number.MAX_SAFE_INTEGER) throw new Error('parseRecordRef: bad issue number');
  return { slug: m[1], issueRef };
}

// hasSymlinkEntry: reject a candidate that introduces a symlink (git mode 120000). Content-exfil is
// already prevented (git stores the target PATH STRING, not bytes), but a symlink ENTRY must not ride
// into a DRAFT (an attacker-chosen path-string leak + a merged-PR foot-gun) — VERIFY fold #5, closes M1.
// Anchored to the git header lines; a `+`-prefixed content line never matches. The trailing
// `[ \t\r]*` tolerates a CRLF diff (ECMAScript `$` does not consume `\r` before `\n`) + any stray
// trailing space (VALIDATE folds: a CRLF symlink diff must not slip the filter).
function hasSymlinkEntry(diff) {
  return /^(new file mode|new mode|old mode|deleted file mode) 120000[ \t\r]*$/m.test(String(diff || ''));
}

function recordOutcome(record, fields) {
  return Object.assign({ record_id: record && record.id }, fields);
}

// --------------------------------------------------------------------------
// Env preflight (fold #3 / fold #6) — key + attest, ONCE. Budget is per-record (cumulative).
// resolveActorApiKey: ENOENT -> null -> a no-run reason; EACCES -> it THROWS, which propagates to
// runLiveDraftLoop's try/catch as a host-misconfig FATAL (a bad key file affects every record).
async function preflightEnv({ dockerBin, image, deps = {} } = {}) {
  const resolveKeyFn = deps.resolveKeyFn || resolveActorApiKey;
  const attestFn = deps.attestFn || attestActorContainment;
  const apiKey = resolveKeyFn({});
  if (!apiKey) return { ok: false, reason: 'actor-key-absent' };
  const att = await attestFn({ dockerBin, image });
  if (!att || att.attested !== true) return { ok: false, reason: 'containment-unattested:' + ((att && att.reason) || 'unknown') };
  return { ok: true, apiKey };
}

// --------------------------------------------------------------------------
// Contained solve (fold #6) — clone -> run (in #391) -> cost -> capture (git plumbing) -> discard.
// The ONLY read of the actor's tree is captureActorDiff (git), preserving the only-git-capture
// invariant (M1). All side-effecting primitives are injectable seams for unit tests.
async function solveLiveIssueContained({
  record, apiKey, model, timeout, ledgerPath, runId, maxBudgetUsd, dockerBin, image, persona = null, deps = {},
} = {}) {
  const prepareCloneFn = deps.prepareCloneFn || prepareClone;
  const runActorFn = deps.runActorFn || runActorInContainer;
  const captureFn = deps.captureFn || captureActorDiff;
  const recordCostFn = deps.recordCostFn || recordCost;
  const safeDiscardFn = deps.safeDiscardFn || safeDiscard;
  const materializeFn = deps.materializeFn || materializePersona;
  const retrieveRecallFn = deps.retrieveRecallBlockFn || retrieveRecallBlock;
  let clone = null;
  try {
    clone = await prepareCloneFn({ repo: record.repo, base_sha: record.base_sha });
    // item 4 (D5) SHADOW persona-prompt injection + Track A W1 SHADOW recall-inject. Both are
    // flag-gated and fail-soft to null; extraContext combines whichever blocks are present. Both flags
    // off (or SHADOW-empty recall) -> extraContext null -> byte-identical bare prompt.
    let personaBlock = null;
    if (persona && personaMaterializeEnabled()) {
      const m = materializeFn(persona);
      personaBlock = m && m.block ? m.block : null;
    }
    // recall is advisory DATA via the audited cross-uid boundary; '' on every un-deployed box (SHADOW)
    // -> no recall block. trigger_class scoping (1a) is deferred; Wave 1 recall is sort-preference only.
    const recallBlock = retrieveRecallFn({ triggerClass: null }) || null;
    const extraContext = [personaBlock, recallBlock].filter(Boolean).join('\n\n') || null;
    const prompt = extraContext ? buildActorPrompt(record, extraContext) : buildActorPrompt(record);
    const result = await runActorFn({
      workDir: clone.workDir, prompt, apiKey, model, maxBudgetUsd, timeout, dockerBin, image,
    });
    const costUsd = result && Number.isFinite(result.costUsd) ? result.costUsd : null;
    if (costUsd != null && costUsd >= 0) {
      try { recordCostFn({ ledgerPath, runId, issueId: record.id, costUsd }); } catch { /* ledger best-effort */ }
    }
    if (!result || result.ok !== true) return { ok: false, reason: 'actor:' + ((result && result.reason) || 'unknown'), costUsd };
    const candidate = String(captureFn({ workDir: clone.workDir, configSnapshot: clone.configSnapshot }) || '');
    if (!candidate.trim()) return { ok: false, reason: 'empty-candidate', costUsd };
    if (Buffer.byteLength(candidate, 'utf8') > MAX_PATCH_BYTES) return { ok: false, reason: 'candidate-too-large', costUsd };
    return { ok: true, candidate, costUsd, redacted: !!(result && result.redacted) };
  } catch (e) {
    return { ok: false, reason: 'solve-threw:' + ((e && e.message) || 'error') };
  } finally {
    if (clone && clone.workDir) { try { safeDiscardFn(clone.workDir); } catch { /* discard best-effort */ } }
  }
}

// --------------------------------------------------------------------------
// Artifact + report writers — chmod 700 dir / 600 files; store the SCRUBBED draft (no raw secret,
// no token). artifactsDir MUST be outside the repo + the throwaway clone.
function writeArtifact(artifactsDir, payload) {
  if (!artifactsDir) return null;
  fs.mkdirSync(artifactsDir, { recursive: true, mode: 0o700 });
  const safeId = String(payload.record_id || 'unknown').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 200);
  const file = path.join(artifactsDir, `draft-${safeId}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), { mode: 0o600 });
  try { fs.chmodSync(artifactsDir, 0o700); fs.chmodSync(file, 0o600); } catch { /* mode best-effort */ }
  return file;
}

function finalizeReport(report, artifactsDir) {
  if (artifactsDir) {
    try {
      fs.mkdirSync(artifactsDir, { recursive: true, mode: 0o700 });
      const f = path.join(artifactsDir, 'run-report.json');
      fs.writeFileSync(f, JSON.stringify(report, null, 2), { mode: 0o600 });
      try { fs.chmodSync(f, 0o600); } catch { /* mode best-effort */ }
    } catch { /* report best-effort */ }
  }
  return report;
}

// --------------------------------------------------------------------------
// item-3-live PR-1 - the draft-time live-solve lesson CAPTURE (D3). FAIL-SOFT + OUTCOME-PURE: returns the
// additive observable fields {lesson_captured, lesson_reason} PLUS (OQ-3 W1) an always-a-string
// lesson_commitment; it NEVER throws and NEVER mutates the record/outcome. A derive/write/throw is one
// observable field, never a record abort.
//
// OQ-3 W1 - lesson_commitment is the content-address over the SAME {lesson_signature, lesson_body} that
// were persisted (the byte-identical round-trip with the store's buildBody). It is '' on EVERY fail-soft
// branch (no lesson minted, so no commitment) and a 64-hex on the captured branch. It is an EMIT-threading
// value only - the caller threads it into the egress data + does NOT put it on any outcome/artifact.
//
// The deriver inputs are computed HERE (they are not computed anywhere else): candidate_patch_sha =
// sidecarSha(SCRUBBED candidate) (matching lesson-capture.js's convention so the PR-2 join agrees on
// scrubbed-vs-raw), problem_statement_digest = digest(record.problem_statement) (the RAW statement NEVER
// reaches the deriveFn). The SECURITY-shaped non-mint paths (derive-threw, store-refused) ALSO
// emitEgressAlert on a NON-`reason` key (the positional reason is clobbered by alert.js - use lesson_reason).
//
// lesson_reason closed-enum: captured | ineligible | off-floor | derive-threw | store-refused | no-candidate.
async function captureLiveLesson({ record, candidate, verdict, ref, eligibleFn, deriveFn, writeFn }) {
  // DEFENSIVE-REDUNDANT / caller-precluded (mirrors isLiveLessonEligible's friction re-validation note): on
  // the live path solveLiveIssueContained already rejects an empty/whitespace candidate (`!candidate.trim()`)
  // + a too-large one, so this branch is unreachable from solveGradeDraftOne. KEPT as defense-in-depth (the
  // helper is also called directly in tests + may be reused), so a future caller can never reach the deriver
  // with an empty candidate. The `no-candidate` enum is therefore live-unreachable but contract-meaningful.
  if (typeof candidate !== 'string' || !candidate.trim()) return { lesson_captured: false, lesson_reason: 'no-candidate', lesson_commitment: '', lesson_node_id: '' };
  // eligibleFn is an injectable seam; a future/injected eligibility check that THROWS must NOT escape (the
  // "captureLiveLesson NEVER throws" contract - an escape would convert a written draft into a loop failure).
  // A thrown eligibility is fail-closed to ineligible (no capture) + observable.
  let eligible = false;
  try { eligible = typeof eligibleFn === 'function' && eligibleFn(verdict) === true; }
  catch (e) {
    emitEgressAlert('live-pending-capture-eligible-threw', { detail: (e && e.message) || 'error' });
    return { lesson_captured: false, lesson_reason: 'ineligible', lesson_commitment: '', lesson_node_id: '' };
  }
  if (!eligible) return { lesson_captured: false, lesson_reason: 'ineligible', lesson_commitment: '', lesson_node_id: '' };

  const scrubbedCandidate = scrubLabSecrets(candidate);
  const candidate_patch_sha = sidecarSha(scrubbedCandidate);
  const problem_statement_digest = digest(record.problem_statement);

  let lesson;
  try { lesson = await deriveFn({ verdict, candidate_patch_sha, problem_statement_digest }); }
  catch (e) {
    emitEgressAlert('live-pending-capture-derive-threw', { detail: (e && e.message) || 'error' });
    return { lesson_captured: false, lesson_reason: 'derive-threw', lesson_commitment: '', lesson_node_id: '' };
  }
  if (!lesson) return { lesson_captured: false, lesson_reason: 'off-floor', lesson_commitment: '', lesson_node_id: '' };  // benign coverage-narrowing (no alert)

  let res;
  try {
    res = writeFn({
      repo: record.repo, issue_ref: ref.issueRef, candidate_patch_sha,
      lesson_signature: lesson.lesson_signature, lesson_body: lesson.lesson_body,
    });
  } catch (e) {
    emitEgressAlert('live-pending-capture-store-threw', { detail: (e && e.message) || 'error' });
    return { lesson_captured: false, lesson_reason: 'store-refused', lesson_commitment: '', lesson_node_id: '' };
  }
  if (!res || res.ok !== true) {
    emitEgressAlert('live-pending-capture-store-refused', { store_reason: (res && res.reason) || 'unknown' });
    return { lesson_captured: false, lesson_reason: 'store-refused', lesson_commitment: '', lesson_node_id: '' };
  }
  // OQ-3 W1 - the node was written; compute the commitment over the SAME lesson fields that were passed to
  // writeFn (byte-identical round-trip with what the store persists via buildBody). Wrapped in try/catch to
  // preserve the "captureLiveLesson NEVER throws" contract: computeLessonCommitment throws only on a bad
  // (empty/undefined) field, which the store-validated lesson cannot have, so this is practically-impossible
  // - but a future deriver change must never convert a written draft into a loop failure. lesson_captured
  // STAYS true (the node IS written); only the commitment falls back to '' on the impossible throw.
  let lesson_commitment;
  try {
    lesson_commitment = computeLessonCommitment({ lesson_signature: lesson.lesson_signature, lesson_body: lesson.lesson_body });
  } catch (e) {
    emitEgressAlert('live-pending-capture-commitment-threw', { detail: (e && e.message) || 'error' });
    return { lesson_captured: true, lesson_reason: 'captured', lesson_commitment: '', lesson_node_id: res.node_id };
  }
  // Gap-9: thread the minted node_id out (additive; '' on every non-mint branch above) so a terminal block
  // downstream can tombstone the RIGHT pending node. res.node_id is set on both the fresh-mint + dedup paths.
  return { lesson_captured: true, lesson_reason: 'captured', lesson_commitment, lesson_node_id: res.node_id };
}

// --------------------------------------------------------------------------
// Per-record: solve -> symlink-reject -> grade -> emitPR dry-run -> artifact. All stages fail-soft.
async function solveGradeDraftOne(ctx) {
  const { record, env, artifactsDir, solveFn, gradeFn, emitFn, semanticFn, frictionFn, now } = ctx;
  // item-3-live PR-1 capture deps (injectable; default to the real deriver/eligibility/store). A partial
  // or absent injection still runs the REAL defaults (the capture is fail-soft so a real-default failure
  // is one observable field, never a record abort).
  const lessonEligibleFn = (ctx.deps && ctx.deps.lessonEligibleFn) || isLiveLessonEligible;
  // The default deriver binds deriveLiveLesson to the real claude -p leg via ctx.deps.lessonLegFn. item-3-live
  // leg 1 wires that leg as the default ON THE REAL-RUN PATH ONLY (runLiveDraftLoop builds it guarded on
  // !judgesInjected, so the test/DI path stays inert): with a leg configured, deriveLiveLesson(input, leg)
  // spawns the tool-less, host-guarded leg; with none (the injected test path) it returns null (no leg, no lesson).
  const lessonLegFn = (ctx.deps && ctx.deps.lessonLegFn) || null;
  const lessonDeriveFn = (ctx.deps && ctx.deps.lessonDeriveFn)
    || ((input) => deriveLiveLesson(input, lessonLegFn));
  const lessonWriteFn = (ctx.deps && ctx.deps.lessonWriteFn) || mintLivePendingLesson;
  // Gap-9 disposal is default-OFF (dormant): a no-op unless the operator-arming knob deps.disposeOnTerminalBlock
  // is set, in which case the real disposeCandidate (or an injected test double) runs. Default no-op => the
  // shipped dry pipeline writes NO disposal record + NO tombstone (byte-inert).
  const disposeFn = (ctx.deps && ctx.deps.disposeOnTerminalBlock)
    ? ((ctx.deps && ctx.deps.disposeFn) || disposeCandidate)
    : (() => {});

  // item 4 (D5) - classify ALWAYS (it is total). The classifyFn dep defaults to classifyIssue;
  // a dep that throws is degraded to the total fail shape so the wire NEVER aborts the record.
  const classifyFn = (ctx.deps && ctx.deps.classifyFn) || classifyIssue;
  let classification;
  try { classification = classifyFn(record); }
  catch { classification = { persona: null, classify_signal: 'classify-threw', matched: null }; }
  const classifyFields = {
    persona: classification && classification.persona != null ? classification.persona : null,
    classify_signal: classification && classification.classify_signal ? classification.classify_signal : 'classify-threw',
    matched: classification && classification.matched != null ? classification.matched : null,
  };

  let ref;
  try { ref = parseRecordRef(record); }
  catch (e) { return recordOutcome(record, { stage: 'parse', ok: false, reason: (e && e.message) || 'bad-record', ...classifyFields }); }

  // item 4 (CodeRabbit Major): a throw from solveFn must NOT escape to the loop-catch (which would
  // stamp classify-threw and DROP a persona that already classified). Catch here, preserve classifyFields.
  let solveRes;
  try {
    solveRes = await solveFn({
      record, apiKey: env.apiKey, model: ctx.model, timeout: ctx.timeout, ledgerPath: ctx.ledgerPath,
      runId: ctx.runId, maxBudgetUsd: ctx.maxBudgetUsd, dockerBin: ctx.dockerBin, image: ctx.image,
      persona: classifyFields.persona, deps: ctx.deps,
    });
  } catch (e) {
    return recordOutcome(record, { stage: 'solve', ok: false, reason: 'solve-threw:' + ((e && e.message) || 'error'), ...classifyFields });
  }
  if (!solveRes || solveRes.ok !== true) {
    return recordOutcome(record, { stage: 'solve', ok: false, reason: (solveRes && solveRes.reason) || 'solve-failed', cost_usd: solveRes && solveRes.costUsd, ...classifyFields });
  }
  // fold #5 — a symlink-entry candidate never reaches the DRAFT.
  if (hasSymlinkEntry(solveRes.candidate)) {
    return recordOutcome(record, { stage: 'draft', ok: false, reason: 'symlink-entry-rejected', cost_usd: solveRes.costUsd, ...classifyFields });
  }
  let verdict = null;
  try { verdict = await gradeFn({ record, candidate: solveRes.candidate, semanticFn, frictionFn }); }
  catch (e) { verdict = { error: 'grade-threw:' + ((e && e.message) || 'error') }; }

  // OQ-3 W1 - the lesson CAPTURE runs right after the verdict + BEFORE emitFn (the capture-before-emit
  // reorder), so the seal can be threaded into the egress data AND a minted lesson is OBSERVED even when
  // the emit/artifact then fails (the minted-but-unobserved fix). FAIL-SOFT: captureLiveLesson never throws
  // and never blocks the emit - on any capture failure the emit proceeds with lesson_commitment ''. The
  // lesson_commitment is an EMIT-threading value only (NOT a key of any outcome/artifact); only the two
  // observable fields (captureFields) ride onto the post-capture termini.
  const capture = await captureLiveLesson({
    record, candidate: solveRes.candidate, verdict, ref, eligibleFn: lessonEligibleFn, deriveFn: lessonDeriveFn, writeFn: lessonWriteFn,
  });
  const { lesson_commitment: capCommit, lesson_captured, lesson_reason, lesson_node_id: capNodeId } = capture;
  const captureFields = { lesson_captured, lesson_reason };

  // fold #4 — emitPR dry-run is NOT guaranteed ok:true (lock / empty / .github -> ok:false). Fail-soft.
  // item 4 (CodeRabbit Major): an emitFn throw must also preserve classifyFields, not escape to the loop-catch.
  // OQ-3 W1: the captured lesson_commitment threads into the egress data (emitPR ignores an unknown field in
  // SHADOW; the seal is consumed by a later wave). The post-capture termini all carry ...captureFields so a
  // minted lesson is never unobserved when a downstream step fails.
  let emitRes;
  try {
    emitRes = await emitFn({ repo: ref.slug, issueRef: ref.issueRef, diff: solveRes.candidate, lesson_commitment: capCommit }, {});
  } catch (e) {
    return recordOutcome(record, { stage: 'draft', ok: false, reason: 'emit-threw:' + ((e && e.message) || 'error'), verdict, cost_usd: solveRes.costUsd, ...classifyFields, ...captureFields });
  }
  if (!emitRes || emitRes.ok !== true) {
    // Gap-7 Part-B + Gap-9 - classify a FAILED emit as a terminal PR-acceptance block, and (default-OFF)
    // dispose the dead candidate. OWN try/catch (mirrors the emitFn / artifact-write pattern) so a
    // classify/dispose throw becomes ONE observable field on THIS outcome, NEVER escaping to the loop-level
    // catch that would re-stamp classify-threw and DISCARD the persona/verdict fields (the fixed F4 bug
    // class). SHADOW/dormant: emitRes.ok===false only on the armed emit path (the dry pipeline returns
    // ok:true), and disposeFn is a no-op unless armed - so this whole block is byte-inert in the shipped run.
    let reason = 'emit:' + ((emitRes && emitRes.reason) || 'unknown');
    try {
      const cls = classifyEmitTerminalBlock(emitRes);
      if (cls.terminal) {
        reason = `terminal-block:${cls.block_reason}`;
        // candidate_patch_sha over the SCRUBBED candidate (matches captureLiveLesson's convention) - computed
        // here so it is available even when no lesson was captured (capNodeId === '').
        const candidatePatchSha = sidecarSha(scrubLabSecrets(solveRes.candidate));
        disposeFn({
          repo: ref.slug, issueRef: ref.issueRef, candidatePatchSha, blockReason: cls.block_reason,
          pendingNodeId: capNodeId || undefined,
        });
      } else if (cls.unclassified) {
        // drift-canary (fail-silent close): a 403/404 permission error on the /pulls family we could NOT
        // attribute to PR-creation (a gh-output drift, or the dedup GET). Bounded, value-redacted - never the
        // raw reason. The operator re-tunes the classifier rather than silently missing a real terminal block.
        emitEgressAlert('terminal-block-unclassified', { repo: ref.slug, issue_ref: ref.issueRef, shape: 'permission-error-non-create-pulls' });
      }
    } catch (e) {
      emitEgressAlert('terminal-block-classify-threw', { detail: (e && e.message) || 'error' });
    }
    return recordOutcome(record, { stage: 'draft', ok: false, reason, verdict, cost_usd: solveRes.costUsd, ...classifyFields, ...captureFields });
  }
  if (emitRes.emitted !== false) { // defense-in-depth: a dry-run MUST never emit
    return recordOutcome(record, { stage: 'draft', ok: false, reason: 'UNEXPECTED-EMISSION', verdict, cost_usd: solveRes.costUsd, ...classifyFields, ...captureFields });
  }
  // writeArtifact is the one post-gate step that touches the filesystem; an fs error (ENOSPC, perms)
  // must stay per-record fail-soft (VALIDATE HIGH), not abort the loop.
  let artifact = null;
  try {
    artifact = writeArtifact(artifactsDir, {
      record_id: record.id, slug: ref.slug, issue_ref: ref.issueRef, verdict,
      draft: emitRes.draft, cost_usd: solveRes.costUsd, redacted: solveRes.redacted, generated_at: now != null ? now : null,
      ...classifyFields,
    });
  } catch (e) {
    return recordOutcome(record, { stage: 'draft', ok: false, reason: 'artifact-write-failed:' + ((e && e.message) || 'error'), verdict, cost_usd: solveRes.costUsd, ...classifyFields, ...captureFields });
  }
  return recordOutcome(record, { stage: 'draft', ok: true, reason: 'draft-written', verdict, cost_usd: solveRes.costUsd, artifact, ...classifyFields, ...captureFields });
}

// --------------------------------------------------------------------------
// The driver. Env-preflight once (fatal on failure), per-record budget re-check (fatal on over-cap),
// per-record solve/grade/draft fail-soft. Judges default to TOOL-PINNED (fold #1) — a caller cannot
// accidentally get un-pinned judges.
async function runLiveDraftLoop({
  records, artifactsDir, ledgerPath, capUsd = DEFAULT_COST_CAP_USD, estimatedUsd,
  model, timeout, dockerBin, image, runId = 'live-draft', now = null, deps = {},
} = {}) {
  const solveFn = deps.solveFn || solveLiveIssueContained;
  const gradeFn = deps.gradeFn || gradeLiveIssueSemantic;
  const emitFn = deps.emitFn || emitPR;
  const assertBudgetFn = deps.assertBudgetFn || assertWithinBudget;
  const semanticFn = deps.semanticFn || makeBlindSemanticJudge({ toolless: true });
  const frictionFn = deps.frictionFn || makeFrictionLabeler({ toolless: true });

  const recs = Array.isArray(records) ? records : [];
  const report = { runId, total: recs.length, outcomes: [], fatal: null };

  // ③.2.3 H5 — RUNTIME tool-inertness gate (the FIRST, cheapest fail-closed preflight). When the judges are
  // the REAL tool-pinned `claude -p` (i.e. NOT both dependency-injected), verify the live CLI actually exposes
  // `tools: []` before any attacker-influenced text reaches a judge. Fail-CLOSED: anything but a confirmed empty
  // tools array aborts the run. SKIPPED when both judges are injected (the test path uses mocks — no real claude).
  const judgesInjected = typeof deps.semanticFn === 'function' && typeof deps.frictionFn === 'function';
  if (!judgesInjected) {
    const verifyToollessFn = deps.verifyToollessFn || verifyToollessRuntime;
    // an undefined `model` falls through to verifyToollessRuntime's own default ('claude-sonnet-4-6').
    const r = verifyToollessFn({ bin: resolveClaude(), model });
    if (!r || r.ok !== true) {
      report.fatal = 'tool-inertness:' + ((r && r.reason) || 'unknown');
      return finalizeReport(report, artifactsDir);
    }
  }

  // item-3-live leg 1 - flip the real live-lesson deriver leg ON, REAL-RUN PATH ONLY. Built ONCE here
  // (resolveClaude() at build time, shared across records) and ONLY when !judgesInjected - the test/DI path
  // (both judges mocked) never constructs/spawns a real leg, so the H5 preflight skip (keyed on judgesInjected,
  // UNCHANGED) and the injected test path stay inert. The leg is a 5th host-side claude -p chokepoint
  // (armed-guard + tool-less pin live inside makeLiveLessonDeriver). PRESENCE check (NOT `||`): an explicit
  // deps.lessonLegFn (including `null` = "no leg") ALWAYS wins; a `||` would silently override an explicit null
  // with the real default (VALIDATE MED fold).
  const lessonLegFn = Object.prototype.hasOwnProperty.call(deps, 'lessonLegFn')
    ? deps.lessonLegFn                                              // explicit deps.lessonLegFn (incl. null = "no leg") always wins
    : (!judgesInjected ? makeLiveLessonDeriver({}) : null);         // real default ONLY on the live path

  let env;
  try { env = await preflightEnv({ dockerBin, image, deps }); }
  catch (e) { report.fatal = 'preflight-threw:' + ((e && e.message) || 'error'); return finalizeReport(report, artifactsDir); }
  if (!env.ok) { report.fatal = env.reason; return finalizeReport(report, artifactsDir); }

  for (let i = 0; i < recs.length; i++) {
    try { assertBudgetFn({ ledgerPath, capUsd, estimatedUsd }); }
    catch (e) { report.fatal = 'budget:' + ((e && e.message) || 'over-cap'); break; }
    // Defense-in-depth (VALIDATE HIGH): any unexpected throw from a per-record step stays fail-soft —
    // it becomes one bad outcome, never aborts the loop.
    let outcome;
    try {
      outcome = await solveGradeDraftOne({
        record: recs[i], env, artifactsDir, solveFn, gradeFn, emitFn, semanticFn, frictionFn,
        model, timeout, ledgerPath, runId, maxBudgetUsd: capUsd, dockerBin, image,
        // item-3-live leg 1 - thread the resolved leg via the deps spread. lessonLegFn was resolved above by a
        // hasOwnProperty presence check, so it already equals an explicit deps.lessonLegFn (incl. null) when the
        // caller set one, else the live-path default; overwriting deps.lessonLegFn here is identity-preserving.
        deps: { ...deps, lessonLegFn }, now,
      });
    } catch (e) {
      // F4 - the loop-level catch ALSO stamps the classify fields so the "classify fields on
      // every outcome" invariant (D5/D7) is unconditional. We never reached solveGradeDraftOne's
      // own classify (or it is the thing that threw), so the fields are the total fail shape.
      outcome = recordOutcome(recs[i], {
        stage: 'loop', ok: false, reason: 'record-threw:' + ((e && e.message) || 'error'),
        persona: null, classify_signal: 'classify-threw', matched: null,
      });
    }
    report.outcomes.push(outcome);
  }
  return finalizeReport(report, artifactsDir);
}

module.exports = {
  parseRecordRef, hasSymlinkEntry, preflightEnv, solveLiveIssueContained, runLiveDraftLoop,
  captureLiveLesson,
};
