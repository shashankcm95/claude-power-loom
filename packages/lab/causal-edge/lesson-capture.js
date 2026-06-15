#!/usr/bin/env node

// @loom-layer: lab
//
// v3.11 W1 — the CAPTURE RE-RUN orchestration (the re-plumb). The bootcamp nodes lost
// the candidate patch to a dead 16-char digest (RFC Sec 1/8); this re-plumbs the content
// the derivation leg needs: candidate patch -> the SIDECAR (full sha == candidate_patch_sha),
// accepted diff -> a content-address REF (a POINTER, not the body — git is the answer key,
// memory is the margin-notes; never re-store the sealed diff), fail_to_pass -> the node
// (the W2 cross-run-join key). Then derive -> mint the lesson node -> consolidate.
//
// PURE of the LLM: the derive leg is INJECTED (deriveFn). The store/sidecar writers are
// dir-injectable, so this is CI-testable with a mock leg + temp dirs. The REAL claude -p
// leg + the driver-over-the-real-corpus live in _spike/lesson-capture-rerun.js (out of CI).
//
// SRP (architect fold): the admission gate is REUSED (isEligibleForPopulation — leg-B +
// contamination), the derive + mint is a SEPARATE step composed at THIS call site — never
// merged into the contamination gate.

'use strict';

const crypto = require('crypto');
const { deriveLesson } = require('./lesson-derive');
const { consolidateLessons, writeConsolidationReport } = require('./lesson-consolidate');
const { buildWorkedExampleNode, isEligibleForPopulation, LESSON_ERR_CODE } = require('../attribution/recall-graph');
const { writeNode } = require('../attribution/recall-graph-store');
const { writeCandidate, sidecarSha } = require('../attribution/candidate-sidecar');

// A content-address POINTER to the accepted diff (the body stays in git/corpus — never
// re-stored; storing the answer key is the contamination we are guarding against).
function acceptedDiffRef(accepted) {
  return crypto.createHash('sha256').update(String(accepted == null ? '' : accepted)).digest('hex');
}

// items: [{ attempt, candidate_patch, accepted_diff, fail_to_pass }]. deriveFn: injected
// (real claude -p in the spike; mock in tests). All dirs/file injectable for CI temp dirs.
async function captureLessons(items, deriveFn, opts = {}) {
  const { recallGraphDir, sidecarDir, reportFile, provenance, now } = opts;
  const list = Array.isArray(items) ? items : [];
  const minted = [];
  let n_eligible = 0; let n_derive_fallback = 0; let n_off_floor = 0; let n_leak = 0; let n_written = 0;
  let n_sidecar_failed = 0; let n_deduped = 0;

  for (const it of list) {
    const attempt = it && it.attempt;
    if (!isEligibleForPopulation(attempt)) continue;              // REUSE the leg-B + contamination gate
    n_eligible += 1;

    const candidate_patch = it.candidate_patch;
    const accepted_diff = it.accepted_diff;
    const d = await deriveLesson({
      problem_statement_digest: attempt.reference.problem_statement_digest,
      candidate_patch, accepted_diff,
    }, deriveFn);
    if (!d.ok) {
      if (d.fallback_reason === 'lesson-leak') n_leak += 1;
      else if (d.fallback_reason === 'off-floor-enum') n_off_floor += 1;
      else n_derive_fallback += 1;
      continue;
    }

    // re-plumb: persist the candidate BYTES (recoverable) keyed by the SAME full sha the
    // node carries; the accepted diff stays a ref-only pointer. A sidecar write FAILURE must
    // not mint a node pointing at a missing patch (VALIDATE-reviewer HIGH-2) — count + skip.
    const candidate_patch_sha = sidecarSha(candidate_patch);
    const cw = writeCandidate(candidate_patch, { dir: sidecarDir });
    if (!cw.ok) { n_sidecar_failed += 1; continue; }
    let node;
    try {
      node = buildWorkedExampleNode(attempt, {
        provenance, lesson: d.lesson,
        accepted_diff_ref: acceptedDiffRef(accepted_diff),
        candidate_patch_sha, fail_to_pass: it.fail_to_pass,
      });
    } catch (e) {
      // narrow the catch (VALIDATE-reviewer HIGH-1 / LOW-2): an off-floor lesson is the ONLY
      // expected throw (deriveLesson already validated, so this is defensive) -> count + skip.
      // ANY other throw (e.g. the canonical-depth guard, a persona-tag error) MUST surface.
      if (e && e.code === LESSON_ERR_CODE) { n_off_floor += 1; continue; }
      throw e;
    }
    const w = writeNode(node, { dir: recallGraphDir });
    // push ONLY a genuine first-write to `minted` (VALIDATE-reviewer HIGH-3): a dedup re-run
    // (same node_id, divergent body) would otherwise double-count in the DEF-3 recurrence tally.
    if (w.ok && !w.deduped) { n_written += 1; minted.push(node); }
    else if (w.ok && w.deduped) { n_deduped += 1; }
  }

  const report = consolidateLessons(minted);
  // do NOT clobber the global default report path on an empty run (VALIDATE-reviewer MEDIUM-2):
  // write only when there is something to report OR an explicit destination was given.
  const report_written = (minted.length > 0 || reportFile) ? writeConsolidationReport(report, { file: reportFile, now }) : { ok: true, skipped: true };
  return { n_eligible, n_written, n_deduped, n_sidecar_failed, n_derive_fallback, n_off_floor, n_leak, minted, report, report_written };
}

module.exports = { captureLessons, acceptedDiffRef };
