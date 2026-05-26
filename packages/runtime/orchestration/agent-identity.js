#!/usr/bin/env node

// agent-identity.js — thin dispatcher for the identity registry CLI.
//
// HT.1.3 (5-module split + ADR-0002 bridge-script entrypoint criterion):
// the registry-CRUD + verdict-recording + trust-scoring + verification-policy
// + lifecycle/spawn responsibilities now live as 5 sub-modules under
// `./identity/`. This file dispatches subcommands to the imported cmd
// functions and re-exports all public symbols (constants + pure helpers +
// cmd handlers) from sub-modules to preserve the external `require()` surface
// that `_h70-test.js` depends on.
//
// Implements the Agent Identity & Reputation pattern
// (skills/agent-team/patterns/agent-identity-reputation.md).
//
// Storage: ~/.claude/agent-identities.json (gitignored, absolute path so
// the tree-tracker __dirname-resolution bug does NOT recur here). See
// `./identity/registry.js` for STORE_PATH details.
//
// Usage:
//   node agent-identity.js init
//   node agent-identity.js assign --persona 04-architect [--task <task-tag>]
//   node agent-identity.js list [--persona 04-architect]
//   node agent-identity.js stats [--identity 04-architect.mira] [--json]
//   node agent-identity.js record --identity 04-architect.mira --verdict pass [--task <tag>]
//                                  [--skills security-audit,review]

'use strict';

// Sub-module imports — the 5 sub-modules created at HT.1.3.
const registry = require('./identity/registry');
const trustScoring = require('./identity/trust-scoring');
const verdictRecording = require('./identity/verdict-recording');
const verificationPolicy = require('./identity/verification-policy');
const lifecycleSpawn = require('./identity/lifecycle-spawn');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    }
  }
  return args;
}

// Module exports — re-export a purposeful subset of sub-module symbols matching
// the pre-HT.1.3-split `module.exports` surface. Existing `require('./agent-identity.js')`
// callers (like `_h70-test.js:56` and `_h70-test.js:74`) see the same surface as
// before the 5-module split.
//
// NOT re-exported (intentionally; full surface is accessible via require of the
// sub-module directly): CLI handlers other than {cmdAssign, cmdBreed, cmdRecord,
// cmdRecommendVerification, cmdStats} — i.e., cmdInit, cmdList, cmdPrune,
// cmdUnretire, cmdAssignChallenger, cmdAssignPair, cmdTier are CLI-only;
// verification-policy constants (VERIFICATION_POLICY, FULL_VERIFY_POLICY,
// ASYMMETRIC_CHALLENGER_POLICY, VALID_VERIFICATION_DEPTHS, FULL_EQUIVALENT_DEPTHS);
// trust-scoring internals (_windowedAvg, _slopeSign, QUALITY_FACTORS_HISTORY_CAP,
// QUALITY_TREND_FLAT_THRESHOLD_PCT). Per audit Tier 1 H5: prior comment claimed
// "all 23 symbols" — corrected to "purposeful subset" with explicit non-export list.
//
// Symbol-to-module mapping verified against pre-split agent-identity.js
// module.exports block (HT.1.3-verify code-reviewer Q3).
module.exports = {
  // Constants from trust-scoring (8)
  WEIGHT_PROFILE_VERSION: trustScoring.WEIGHT_PROFILE_VERSION,
  WEIGHTS: trustScoring.WEIGHTS,
  REFERENCE_SCALES: trustScoring.REFERENCE_SCALES,
  BONUS_CAP: trustScoring.BONUS_CAP,
  RECENCY_HALF_LIFE_DAYS: trustScoring.RECENCY_HALF_LIFE_DAYS,
  QUALITY_TREND_WINDOW: trustScoring.QUALITY_TREND_WINDOW,
  TASK_COMPLEXITY_BUCKET_WEIGHTS: trustScoring.TASK_COMPLEXITY_BUCKET_WEIGHTS,
  // Constants from registry (1)
  DEFAULT_ROSTERS: registry.DEFAULT_ROSTERS,
  // Constants from verification-policy (1)
  RECALIBRATION_SPAWN_THRESHOLD: verificationPolicy.RECALIBRATION_SPAWN_THRESHOLD,
  // Pure helpers from trust-scoring (8)
  tierOf: trustScoring.tierOf,
  bucketTaskComplexity: trustScoring.bucketTaskComplexity,
  computeTaskComplexityWeightedPass: trustScoring.computeTaskComplexityWeightedPass,
  computeRecencyDecay: trustScoring.computeRecencyDecay,
  computeQualityTrend: trustScoring.computeQualityTrend,
  aggregateQualityFactors: trustScoring.aggregateQualityFactors,
  computeWeightedTrustScore: trustScoring.computeWeightedTrustScore,
  normalizeAxis: trustScoring.normalizeAxis,
  // Backfill helper from registry (1)
  _backfillSchema: registry._backfillSchema,
  // Subcommand handlers (5)
  cmdBreed: lifecycleSpawn.cmdBreed,
  cmdRecommendVerification: verificationPolicy.cmdRecommendVerification,
  cmdAssign: lifecycleSpawn.cmdAssign,
  cmdRecord: verdictRecording.cmdRecord,
  cmdStats: registry.cmdStats,  // HT.1.3-verify FLAG-1: relocated registry → registry
};

// CLI dispatch — only fires when this file is invoked directly (not required).
if (require.main !== module) {
  // Required as a module — skip CLI dispatch.
} else {

const cmd = process.argv[2];
const args = parseArgs(process.argv.slice(3));
switch (cmd) {
  case 'init': registry.cmdInit(); break;
  case 'assign': lifecycleSpawn.cmdAssign(args); break;
  case 'assign-challenger': lifecycleSpawn.cmdAssignChallenger(args); break;
  case 'assign-pair': lifecycleSpawn.cmdAssignPair(args); break;
  case 'tier': verificationPolicy.cmdTier(args); break;
  case 'recommend-verification': verificationPolicy.cmdRecommendVerification(args); break;
  case 'list': registry.cmdList(args); break;
  case 'stats': registry.cmdStats(args); break;  // HT.1.3-verify FLAG-1: relocated to registry
  case 'record': verdictRecording.cmdRecord(args); break;
  case 'prune': registry.cmdPrune(args); break;
  case 'unretire': registry.cmdUnretire(args); break;
  case 'breed': lifecycleSpawn.cmdBreed(args); break;  // H.7.0 — evolution loop L3
  case '__test_internals__':
    // H.7.0 — test-only: dump internals for inline test runners. Not for use
    // by production callers; gated behind explicit subcommand name so it's
    // never accidentally invoked. Used by packages/runtime/orchestration/_h70-test.js.
    //
    // HT.1.3-verify FLAG-4 + FLAG-C: imports 8 constants from TWO sub-modules.
    // 7 from trust-scoring (WEIGHT_PROFILE_VERSION, WEIGHTS, REFERENCE_SCALES,
    // BONUS_CAP, RECENCY_HALF_LIFE_DAYS, QUALITY_TREND_WINDOW,
    // TASK_COMPLEXITY_BUCKET_WEIGHTS) and 1 from verification-policy
    // (RECALIBRATION_SPAWN_THRESHOLD).
    console.log(JSON.stringify({
      WEIGHT_PROFILE_VERSION: trustScoring.WEIGHT_PROFILE_VERSION,
      WEIGHTS: trustScoring.WEIGHTS,
      REFERENCE_SCALES: trustScoring.REFERENCE_SCALES,
      BONUS_CAP: trustScoring.BONUS_CAP,
      RECALIBRATION_SPAWN_THRESHOLD: verificationPolicy.RECALIBRATION_SPAWN_THRESHOLD,
      RECENCY_HALF_LIFE_DAYS: trustScoring.RECENCY_HALF_LIFE_DAYS,
      QUALITY_TREND_WINDOW: trustScoring.QUALITY_TREND_WINDOW,
      TASK_COMPLEXITY_BUCKET_WEIGHTS: trustScoring.TASK_COMPLEXITY_BUCKET_WEIGHTS,
    }, null, 2));
    break;
  default:
    console.error('Usage: agent-identity.js {init|assign|list|stats|record|prune|unretire|breed} [args]');
    console.error('  prune [--auto] [--retire-min-verdicts N] [--retire-pass-rate-max F] [--specialist-min-verdicts N] [--specialist-pass-rate-min F] [--specialist-min-invocations N]');
    console.error('    Default: advisory (prints recommendations). --auto applies them.');
    console.error('  unretire --identity <persona.name>');
    console.error('    Restore a soft-retired identity to the active pool.');
    console.error('  breed --persona <NN-name> [--parent <id>] [--name <kid>] [--auto]');
    console.error('    H.7.0 — evolution loop. Diversity-guard + population-cap apply.');
    console.error('See https://github.com/anthropics/claude-code for context.');
    process.exit(1);
}

}  // end if (require.main === module) block
