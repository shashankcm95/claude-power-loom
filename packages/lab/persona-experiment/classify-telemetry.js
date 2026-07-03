#!/usr/bin/env node

// @loom-layer: lab
//
// item 4 (W1-next) - a PURE, read-only telemetry fold over persisted live artifacts. Each
// artifact (draft-<id>.json, written by live-draft-run.js) carries top-level {persona,
// classify_signal}. This aggregates them into a queryable distribution so the classifier's
// abstain / tie / no-signal rates are observable. It is SHADOW: it reads artifacts, computes a
// summary, and gates NOTHING - it never writes, never touches a trust weight.
//
// Expected invariant of a WELL-FORMED artifact stream: sum(per_persona) === matched + tied,
// because an `ambiguous-tie` also returns a NON-null persona (the priority winner), not only
// `matched`. This aggregator does NOT trust that the upstream writer honored it — it reads
// persisted files that a future writer bug, a legacy record, or a hand-edit could violate. So it
// DETECTS violations: an `inconsistent` counter increments whenever a recognized signal and the
// persona-present bit disagree (a matched/tie row with no persona, or an abstain/threw row WITH a
// persona), surfacing a corrupt distribution instead of silently miscounting it.
//
// per_persona is a NULL-PROTOTYPE object (Object.create(null)) so a hostile/legacy persona key
// like '__proto__' / 'constructor' / 'hasOwnProperty' is a normal own key, never prototype
// pollution or an inherited-truthy read.

'use strict';

const fs = require('fs');
const path = require('path');

// classify_signal (the closed enum from issue-classifier.js) -> the summary counter it feeds.
// A signal NOT in this map (missing, legacy pre-item-4, or an unrecognized future value) falls
// to `unknown` so a bad/renamed enum can never be silently miscounted as a clean outcome.
// NULL-PROTOTYPE (Object.create(null)): the lookup key comes from an untrusted persisted artifact,
// so a hostile classify_signal like 'constructor' / '__proto__' must miss (-> unknown), NOT resolve
// to an inherited Object.prototype member and corrupt the fold.
const SIGNAL_BUCKET = Object.freeze(Object.assign(Object.create(null), {
  matched: 'matched',
  'no-keyword-match': 'abstained',
  'ambiguous-tie': 'tied',
  'matched-no-brief': 'matched_no_brief',
  'classify-threw': 'threw',
}));

// Recognized signals for which a NON-null persona is expected (matched, ambiguous-tie). Used by the
// `inconsistent` self-check: any OTHER recognized signal (abstained/matched-no-brief/threw) should
// carry a null persona.
const PERSONA_BEARING = Object.freeze(new Set(['matched', 'ambiguous-tie']));

function emptySummary() {
  return { total: 0, matched: 0, abstained: 0, tied: 0, matched_no_brief: 0, threw: 0, unknown: 0, inconsistent: 0, per_persona: Object.create(null) };
}

/**
 * Fold a list of persisted artifacts into a classification distribution. Pure, total, idempotent,
 * non-mutating.
 * @param {Array<{persona?:*, classify_signal?:*}>} artifacts
 * @returns {{total,matched,abstained,tied,matched_no_brief,threw,unknown,inconsistent,per_persona}}
 */
function summarizeClassifications(artifacts) {
  const summary = emptySummary();
  if (!Array.isArray(artifacts)) return summary;
  for (const a of artifacts) {
    summary.total += 1;
    const signal = a && typeof a.classify_signal === 'string' ? a.classify_signal : null;
    const bucket = signal ? SIGNAL_BUCKET[signal] : undefined;
    if (bucket) summary[bucket] += 1;
    else summary.unknown += 1;
    const persona = a && typeof a.persona === 'string' && a.persona.length > 0 ? a.persona : null;
    if (persona) summary.per_persona[persona] = (summary.per_persona[persona] || 0) + 1;
    // Self-check: for a RECOGNIZED signal, persona-present must match persona-bearing. A mismatch
    // means the artifact stream is corrupt (writer bug / hand-edit / legacy) — surface it.
    if (bucket && (persona !== null) !== PERSONA_BEARING.has(signal)) summary.inconsistent += 1;
  }
  return summary;
}

// --------------------------------------------------------------------------
// Thin read-only CLI shell. Reads <artifactsDir>/draft-*.json (skipping run-report.json + any
// unreadable/parse-error file), folds, prints the summary JSON. Never writes.

function readArtifacts(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const artifacts = [];
  for (const name of names) {
    if (!name.startsWith('draft-') || !name.endsWith('.json')) continue; // draft-<id>.json only
    const full = path.join(dir, name);
    // lstat (no-follow) + require a REGULAR file: a draft-*.json SYMLINK must not be followed out of
    // the artifacts dir (the repo's fs.lstatSync no-follow discipline). A dir/symlink/socket is skipped.
    let st;
    try { st = fs.lstatSync(full); } catch { continue; }
    if (!st.isFile()) continue;
    try {
      artifacts.push(JSON.parse(fs.readFileSync(full, 'utf8')));
    } catch { /* skip an unreadable / malformed artifact */ }
  }
  return artifacts;
}

function main(argv) {
  const dir = argv[2];
  if (!dir) {
    process.stderr.write('usage: classify-telemetry.js <artifactsDir>\n');
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(summarizeClassifications(readArtifacts(dir)), null, 2)}\n`);
}

module.exports = { summarizeClassifications, readArtifacts };

if (require.main === module) main(process.argv);
