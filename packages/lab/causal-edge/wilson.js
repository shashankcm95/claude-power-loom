#!/usr/bin/env node

// @loom-layer: lab
//
// v-next MV-W1 — the Wilson score interval (95%, NO continuity correction). A pure stats helper;
// none existed in the repo (the only nearby stats was a confusion-matrix divide). Used by the
// lesson-merge-lift harden-gate's "disjoint-above" interval test (the FORK-6 lesson_merge_lift
// observable). Pure: (successes, n) -> { lower, upper } | null. No I/O, no deps.
//
// VARIANT (pinned, VERIFY-architect): Wilson SCORE interval WITHOUT continuity correction, z=1.96
// (two-sided 95%). The plain score interval is the small-sample-honest method the
// evaluation-under-nondeterminism KB names; the no-CC variant is fixed here so the gate is
// reproducible (the CC variant gives materially wider intervals at small N). Bounds clamped to [0,1].

'use strict';

const Z = 1.96; // two-sided 95%

// wilson(successes, n) -> { lower, upper } clamped to [0,1], or null on invalid input (never throws).
function wilson(successes, n) {
  if (!Number.isInteger(successes) || !Number.isInteger(n)) return null;
  if (n <= 0 || successes < 0 || successes > n) return null;
  const phat = successes / n;
  const z2 = Z * Z;
  const denom = 1 + z2 / n;
  const center = (phat + z2 / (2 * n)) / denom;
  const margin = (Z * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n)) / denom;
  const lower = center - margin;
  const upper = center + margin;
  return { lower: lower < 0 ? 0 : lower, upper: upper > 1 ? 1 : upper };
}

module.exports = { wilson, Z };
