#!/usr/bin/env node

// @loom-layer: lab
//
// v3.11 W1 — the FROZEN lesson signature + the lesson-key machinery. PURE +
// DETERMINISTIC: no claude, no fs, no child_process; CI-safe. This is the experience
// layer's KEY (the dedup / recurrence / retrieval address for every lesson node).
//
// THE ONE-WAY DOOR (see lesson-taxonomy-freeze.md, the committed audit record):
// the three closed enums below are a content-addressed key. Removing/renaming a value
// orphans every node minted on it (its lesson_signature stops re-deriving -> verifyNode
// rejects). The value set is therefore an APPEND-ONLY FLOOR: add freely, NEVER remove.
// The floor is the MINIMAL set the W1 OSS capture re-run can actually mint + confirm
// (a candidate-vs-accepted CODE diff classified into the three axes) — not an
// aspirational set. The DEF-3 raw-collision diagnostic signals when to append.
//
// Open/Closed: a NEW key (lessonClusterKey) + NEW enums + a NEW generic groupByKey.
// frictionClusterKey + clusterFriction (trajectory-friction.js) are UNTOUCHED. The
// shared closed-set primitive (safeEnumKey) lives in the neutral _lib/enum-key module
// that BOTH key spaces import (never sideways friction<->lesson coupling).
//
// NAMESPACE: lessonClusterKey is prefixed `lesson:`; frictionClusterKey emits no
// prefix, so the two key spaces are disjoint by construction. `:` and `|` are RESERVED
// separators — no enum value in EITHER key space may contain them (assertEnumDelimiterSafe).

'use strict';

const { safeEnumKey } = require('../_lib/enum-key');
const { RUBRIC_LEAK_MIN, normalizeAlnum } = require('./calibration-issue');

const LESSON_PREFIX = 'lesson:';

// --------------------------------------------------------------------------
// Artifact (1) — the FROZEN floor (4 / 3 / 2). Append-only; see the audit record.
// --------------------------------------------------------------------------

// The situation the bug lives in (the retrieval query key).
const TRIGGER_CLASS = Object.freeze([
  'boundary-contract', 'data-parse', 'api-shape', 'state-mutation',
]);
// The non-obvious trap (the discriminator within a trigger).
const GOTCHA_CLASS = Object.freeze([
  'unguarded-edge-case', 'silent-coercion', 'ordering-dependency',
]);
// The corrective principle (payload-as-key).
const CORRECTIVE_CLASS = Object.freeze([
  'fail-closed', 'handle-edge-explicitly',
]);

// --------------------------------------------------------------------------
// Artifact (2) — the composite key. safeEnumKey collapses any off-enum/non-string
// component to INVALID (a closed, delimiter-free token), so a RAW block that bypassed
// its validator can never inject a `|`/`:` separator or seat a poison key component.
// --------------------------------------------------------------------------

function lessonClusterKey(block) {
  const b = block || {};
  return LESSON_PREFIX
    + safeEnumKey(b.trigger_class, TRIGGER_CLASS) + '|'
    + safeEnumKey(b.gotcha_class, GOTCHA_CLASS) + '|'
    + safeEnumKey(b.corrective_class, CORRECTIVE_CLASS);
}

// A run-time / test assertion that the namespace separators stay reserved across BOTH
// key spaces (protecting the colon symmetrically is stronger than asserting the prefix
// on the lesson side alone). Throws on the first offender. Pure; cheap; call it in the
// test suite (and it self-checks the lesson enums at module load below).
function assertEnumDelimiterSafe(arrays) {
  for (const arr of arrays) {
    for (const v of arr) {
      if (typeof v !== 'string') throw new Error(`enum value not a string: ${JSON.stringify(v)}`);
      if (v.includes('|') || v.includes(':')) throw new Error(`enum value contains a reserved separator (| or :): ${JSON.stringify(v)}`);
    }
  }
  return true;
}

// Fail-fast at load: the lesson enums must themselves be delimiter-safe (a typo'd
// value with a `:` would silently break namespace disjointness).
assertEnumDelimiterSafe([TRIGGER_CLASS, GOTCHA_CLASS, CORRECTIVE_CLASS]);

// --------------------------------------------------------------------------
// lessonLeaks — the STRING-variant leak-guard (rubricLeaks type-guards objects and
// silently passes a flat string). Guards the rendered lesson_body PROSE before the key
// is trusted: does the body share a >=RUBRIC_LEAK_MIN normalized-alnum run with the
// sealed accepted_diff? Reuses the SAME min-run + normalizer as rubricLeaks (imported,
// never re-literal'd) so the two leak checks cannot diverge. The closed-enum key is
// exempt (its components are a fixed vocabulary, not free prose).
//
// KNOWN RESIDUALS (VALIDATE-hacker M3 — a calibrated contiguous-run heuristic, not a
// perfect oracle): (a) a secret whose total normalized content is < RUBRIC_LEAK_MIN chars
// (a one-token off-by-one fix, a single magic constant) can be quoted verbatim and slip
// under the threshold — lowering the threshold would false-positive on common prose, so
// 12 is the calibrated tradeoff (shared with rubricLeaks); (b) deliberate cross-script
// homoglyphs (cyrillic-o for latin-o) break the run and evade the match. Both require the
// derivation LEG to be adversarial; in the W1 backtest the leg is trusted-not-adversarial,
// and the dominant leak shape (verbatim multi-token identifiers) IS caught (normalizeAlnum
// stripping punctuation/whitespace HELPS the defender by re-joining split fragments). The
// caller additionally bounds the model-controlled body length (lesson-derive LESSON_BODY_MAX)
// to keep this scan O-bounded. Harden (NFKC/confusables + token-disjointness) if the threat
// model shifts to an adversarial leg (W2+).
// --------------------------------------------------------------------------

function lessonLeaks(str, acceptedDiff) {
  const hay = normalizeAlnum(acceptedDiff);
  if (hay.length === 0) return false;
  const n = normalizeAlnum(str);
  for (let i = 0; i + RUBRIC_LEAK_MIN <= n.length; i++) {
    if (hay.includes(n.slice(i, i + RUBRIC_LEAK_MIN))) return true;
  }
  return false;
}

// --------------------------------------------------------------------------
// groupByKey — a generic exact-key tally. NOT clusterFriction (which is closed over
// friction_* field names and would collapse every lesson to INVALID|INVALID|INVALID).
// members are POSITIONAL indices (the caller re-maps them to stable refs, mirroring
// aggregateFrictionMap). null-proto so a poison-token key can never pollute.
// --------------------------------------------------------------------------

function groupByKey(blocks, keyFn) {
  const list = Array.isArray(blocks) ? blocks : [];
  const groups = Object.create(null);
  for (let i = 0; i < list.length; i++) {
    const key = keyFn(list[i]);
    if (!groups[key]) groups[key] = { key, count: 0, members: [] };
    groups[key].count += 1;
    groups[key].members.push(i);
  }
  return { groups, n: Object.keys(groups).length };
}

module.exports = {
  TRIGGER_CLASS, GOTCHA_CLASS, CORRECTIVE_CLASS, LESSON_PREFIX,
  lessonClusterKey, assertEnumDelimiterSafe, lessonLeaks, groupByKey,
};
