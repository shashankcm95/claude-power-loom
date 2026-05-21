// identity/verification-policy.js — cmdTier + cmdRecommendVerification
// (trust-tiered verification policy + drift triggers) extracted from
// agent-identity.js per HT.1.3 (5-module split + ADR-0002 bridge-script
// entrypoint criterion).
//
// Module characteristics:
//   - 2 subcommands (cmdTier, cmdRecommendVerification) plus 4 supporting
//     constants (VERIFICATION_POLICY, RECALIBRATION_SPAWN_THRESHOLD,
//     FULL_VERIFY_POLICY, ASYMMETRIC_CHALLENGER_POLICY)
//   - Imports `readStore` + `_backfillSchema` from `./registry`
//   - Imports `tierOf` + `computeQualityTrend` from `./trust-scoring`

'use strict';

const { readStore, _backfillSchema } = require('./registry');
const { tierOf, computeQualityTrend } = require('./trust-scoring');

// H.2.4 — trust-tiered verification policy. Translates per-identity trust
// (from tierOf) into a verification recommendation: how much to verify,
// whether to spawn a challenger, which expensive checks to skip.
//
// Policy table (per patterns/trust-tiered-verification.md):
//   high-trust    -> spot-check only;       no challenger;       skip noTextSimilarityToPriorRun
//   medium-trust  -> asymmetric challenger; 1 challenger;        skip nothing
//   low-trust     -> symmetric pair;        2 challengers;       skip nothing
//   unproven      -> treated as low-trust per pattern doc (cautious default)
const VERIFICATION_POLICY = {
  'high-trust': {
    verification: 'spot-check-only',
    spawnChallenger: false,
    challengerCount: 0,
    skipChecks: ['noTextSimilarityToPriorRun'],
    rationale: 'High pass-rate over >=5 runs — full verification adds latency without catching new bugs',
  },
  'medium-trust': {
    verification: 'asymmetric-challenger',
    spawnChallenger: true,
    challengerCount: 1,
    skipChecks: [],
    rationale: 'Mid pass-rate — full verification + 1 different-persona challenger catches asymmetric blind spots',
  },
  'low-trust': {
    verification: 'symmetric-pair',
    spawnChallenger: true,
    challengerCount: 2,
    skipChecks: [],
    rationale: 'Low pass-rate or unproven — full verification + 2 challengers (different persona preferred) per asymmetric-challenger pattern',
  },
  'unproven': {
    verification: 'symmetric-pair',
    spawnChallenger: true,
    challengerCount: 2,
    skipChecks: [],
    rationale: 'Under 5 runs — treated as low-trust per pattern doc until track record establishes',
  },
};

function cmdTier(args) {
  if (!args.identity) {
    console.error('Usage: tier --identity <persona.name>');
    process.exit(1);
  }
  const store = readStore();
  const data = store.identities[args.identity];
  if (!data) {
    console.error(`Unknown identity: ${args.identity}`);
    process.exit(1);
  }
  const total = data.verdicts.pass + data.verdicts.partial + data.verdicts.fail;
  const passRate = total === 0 ? 0 : data.verdicts.pass / total;
  console.log(JSON.stringify({
    identity: args.identity,
    tier: tierOf(data),
    passRate: Math.round(passRate * 100) / 100,
    totalRuns: total,
    threshold: { highTrust: 0.8, mediumTrust: 0.5, minRuns: 5 },
    verdicts: data.verdicts,
  }, null, 2));
}

// H.7.0 — drift-detection threshold.
const RECALIBRATION_SPAWN_THRESHOLD = 10;

// H.7.0 — full-verify policy used by drift triggers.
const FULL_VERIFY_POLICY = Object.freeze({
  verification: 'symmetric-pair',
  spawnChallenger: true,
  challengerCount: 2,
  skipChecks: [],
  rationale: 'Full-verify forced by drift trigger; tier policy preempted',
});

const ASYMMETRIC_CHALLENGER_POLICY = Object.freeze({
  verification: 'asymmetric-challenger',
  spawnChallenger: true,
  challengerCount: 1,
  skipChecks: [],
  rationale: 'Drift trigger: task signature outside identity specializations[]',
});

function cmdRecommendVerification(args) {
  if (!args.identity) {
    console.error('Usage: recommend-verification --identity <persona.name> [--task <tag>] [--force-full-verify]');
    process.exit(1);
  }
  const store = readStore();
  const data = store.identities[args.identity];
  if (!data) {
    console.error(`Unknown identity: ${args.identity}`);
    process.exit(1);
  }
  _backfillSchema(data);
  const tier = tierOf(data);

  // H.7.0 — drift pre-check block. Order is load-bearing; first match wins.

  // (1) --force-full-verify flag: explicit user override
  if (args['force-full-verify']) {
    console.log(JSON.stringify({
      identity: args.identity,
      tier,
      ...FULL_VERIFY_POLICY,
      recalibration_reason: 'force-full-verify-flag',
    }, null, 2));
    return;
  }

  // (2) recalibration_due: spawnsSinceFullVerify >= threshold
  const recalibrationDue = (data.spawnsSinceFullVerify || 0) >= RECALIBRATION_SPAWN_THRESHOLD;
  if (recalibrationDue) {
    console.log(JSON.stringify({
      identity: args.identity,
      tier,
      ...FULL_VERIFY_POLICY,
      recalibration_reason: 'spawn-counter',
      spawnsSinceFullVerify: data.spawnsSinceFullVerify,
      threshold: RECALIBRATION_SPAWN_THRESHOLD,
    }, null, 2));
    return;
  }

  // (2.5) synthid-drift: persona contract drift detected on prior assign.
  //       Mirrors the recalibration_due trigger — fires BEFORE tier-based
  //       triggers (3)+(4) and the fall-through policy table (5).
  //       Flag is set in lifecycle-spawn.js cmdAssign when hash mismatches
  //       prior synthid_history head; cleared in verdict-recording.js on
  //       FULL_EQUIVALENT_DEPTHS verdicts.
  //       INTENTIONALLY STICKY (post-pair-run LOW-1): if an identity only
  //       accumulates `spot` / `asymmetric` verdicts after a drift, this
  //       trigger keeps firing and forcing FULL_VERIFY_POLICY until at
  //       least one full-verify completes. By design — drift is a strong
  //       signal that warrants re-calibration; ignore-tolerance would
  //       defeat the purpose. A non-sticky variant would need a separate
  //       expiry counter, which v2.8.0.x deliberately defers.
  //       Out-of-scope (deferred to v2.8.1+): combining drift signal with
  //       quality-trend or task-novelty into a single "compound recalibration".
  if (data.pendingSynthIdDrift) {
    const tail = Array.isArray(data.synthid_history)
      ? data.synthid_history.slice(-2)
      : [];
    console.log(JSON.stringify({
      identity: args.identity,
      tier,
      ...FULL_VERIFY_POLICY,
      recalibration_reason: 'synthid-drift',
      synthid_history_tail: tail,
    }, null, 2));
    return;
  }

  // (3) high-trust + task-novelty (no specialization overlap)
  if (tier === 'high-trust' && typeof args.task === 'string' && args.task.length > 0) {
    const specs = Array.isArray(data.specializations) ? data.specializations : [];
    const overlap = specs.includes(args.task) ||
      specs.some((s) => typeof s === 'string' && (
        args.task.includes(s) || s.includes(args.task)
      ));
    if (specs.length > 0 && !overlap) {
      console.log(JSON.stringify({
        identity: args.identity,
        tier,
        ...ASYMMETRIC_CHALLENGER_POLICY,
        recalibration_reason: 'task-novelty',
        task: args.task,
        specializations: specs,
      }, null, 2));
      return;
    }
  }

  // (4) high-trust + qualityTrend declining
  if (tier === 'high-trust') {
    const qt = computeQualityTrend(data.quality_factors_history || []);
    if (qt) {
      const findingsDown = qt.findings_per_10k && qt.findings_per_10k.slope_sign === 'down';
      const citationsDown = qt.file_citations_per_finding && qt.file_citations_per_finding.slope_sign === 'down';
      if (findingsDown || citationsDown) {
        console.log(JSON.stringify({
          identity: args.identity,
          tier,
          ...FULL_VERIFY_POLICY,
          recalibration_reason: 'quality-trend-down',
          qualityTrend: qt,
        }, null, 2));
        return;
      }
    }
  }

  // (5) Fall-through to existing tier-based policy table.
  const policy = VERIFICATION_POLICY[tier];
  console.log(JSON.stringify({
    identity: args.identity,
    tier,
    ...policy,
  }, null, 2));
}

module.exports = {
  VERIFICATION_POLICY,
  RECALIBRATION_SPAWN_THRESHOLD,
  FULL_VERIFY_POLICY,
  ASYMMETRIC_CHALLENGER_POLICY,
  cmdTier,
  cmdRecommendVerification,
};
