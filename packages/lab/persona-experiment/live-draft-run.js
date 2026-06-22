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
const { gradeLiveIssueSemantic } = require('../causal-edge/live-grade');
const { makeBlindSemanticJudge } = require('../causal-edge/calibration-issue-run');
const { makeFrictionLabeler, buildActorPrompt } = require('../causal-edge/trajectory-friction-run');

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
  record, apiKey, model, timeout, ledgerPath, runId, maxBudgetUsd, dockerBin, image, deps = {},
} = {}) {
  const prepareCloneFn = deps.prepareCloneFn || prepareClone;
  const runActorFn = deps.runActorFn || runActorInContainer;
  const captureFn = deps.captureFn || captureActorDiff;
  const recordCostFn = deps.recordCostFn || recordCost;
  const safeDiscardFn = deps.safeDiscardFn || safeDiscard;
  let clone = null;
  try {
    clone = await prepareCloneFn({ repo: record.repo, base_sha: record.base_sha });
    const result = await runActorFn({
      workDir: clone.workDir, prompt: buildActorPrompt(record), apiKey, model, maxBudgetUsd, timeout, dockerBin, image,
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
// Per-record: solve -> symlink-reject -> grade -> emitPR dry-run -> artifact. All stages fail-soft.
async function solveGradeDraftOne(ctx) {
  const { record, env, artifactsDir, solveFn, gradeFn, emitFn, semanticFn, frictionFn, now } = ctx;
  let ref;
  try { ref = parseRecordRef(record); }
  catch (e) { return recordOutcome(record, { stage: 'parse', ok: false, reason: (e && e.message) || 'bad-record' }); }

  const solveRes = await solveFn({
    record, apiKey: env.apiKey, model: ctx.model, timeout: ctx.timeout, ledgerPath: ctx.ledgerPath,
    runId: ctx.runId, maxBudgetUsd: ctx.maxBudgetUsd, dockerBin: ctx.dockerBin, image: ctx.image, deps: ctx.deps,
  });
  if (!solveRes || solveRes.ok !== true) {
    return recordOutcome(record, { stage: 'solve', ok: false, reason: (solveRes && solveRes.reason) || 'solve-failed', cost_usd: solveRes && solveRes.costUsd });
  }
  // fold #5 — a symlink-entry candidate never reaches the DRAFT.
  if (hasSymlinkEntry(solveRes.candidate)) {
    return recordOutcome(record, { stage: 'draft', ok: false, reason: 'symlink-entry-rejected', cost_usd: solveRes.costUsd });
  }
  let verdict = null;
  try { verdict = await gradeFn({ record, candidate: solveRes.candidate, semanticFn, frictionFn }); }
  catch (e) { verdict = { error: 'grade-threw:' + ((e && e.message) || 'error') }; }

  // fold #4 — emitPR dry-run is NOT guaranteed ok:true (lock / empty / .github -> ok:false). Fail-soft.
  const emitRes = await emitFn({ repo: ref.slug, issueRef: ref.issueRef, diff: solveRes.candidate }, {});
  if (!emitRes || emitRes.ok !== true) {
    return recordOutcome(record, { stage: 'draft', ok: false, reason: 'emit:' + ((emitRes && emitRes.reason) || 'unknown'), verdict, cost_usd: solveRes.costUsd });
  }
  if (emitRes.emitted !== false) { // defense-in-depth: a dry-run MUST never emit
    return recordOutcome(record, { stage: 'draft', ok: false, reason: 'UNEXPECTED-EMISSION', cost_usd: solveRes.costUsd });
  }
  // writeArtifact is the one post-gate step that touches the filesystem; an fs error (ENOSPC, perms)
  // must stay per-record fail-soft (VALIDATE HIGH), not abort the loop.
  let artifact = null;
  try {
    artifact = writeArtifact(artifactsDir, {
      record_id: record.id, slug: ref.slug, issue_ref: ref.issueRef, verdict,
      draft: emitRes.draft, cost_usd: solveRes.costUsd, redacted: solveRes.redacted, generated_at: now != null ? now : null,
    });
  } catch (e) {
    return recordOutcome(record, { stage: 'draft', ok: false, reason: 'artifact-write-failed:' + ((e && e.message) || 'error'), verdict, cost_usd: solveRes.costUsd });
  }
  return recordOutcome(record, { stage: 'draft', ok: true, reason: 'draft-written', verdict, cost_usd: solveRes.costUsd, artifact });
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
        model, timeout, ledgerPath, runId, maxBudgetUsd: capUsd, dockerBin, image, deps, now,
      });
    } catch (e) {
      outcome = recordOutcome(recs[i], { stage: 'loop', ok: false, reason: 'record-threw:' + ((e && e.message) || 'error') });
    }
    report.outcomes.push(outcome);
  }
  return finalizeReport(report, artifactsDir);
}

module.exports = {
  parseRecordRef, hasSymlinkEntry, preflightEnv, solveLiveIssueContained, runLiveDraftLoop,
};
