'use strict';

// ③.2.2b — the ACTOR real-auth + cost dogfood (Rule 2a-corollary: a green mock suite is a HYPOTHESIS;
// the real claude -p path is where bugs hide). A verification probe (NOT a unit test) — lives in _spike
// so Linux CI never globs it. REQUIRES Docker up + the loom-actor image built + a real Anthropic API key
// at ~/.config/loom/anthropic-api-key. The real-call leg SPENDS REAL API CREDITS (~$0.03-0.50 on the
// metered key), capped by --max-budget-usd AND the host-side budget guard.
//
// TWO legs (VALIDATE honesty-auditor: the old single check was VACUOUS — it asserted absence of `sk-` in
// the ALREADY-scrubbed return, with no proof the key was ever in the raw stream):
//   LEG A (FREE, deterministic) — the env -> stdout -> scrub PIPELINE on the REAL container: inject a fake
//     `sk-ant-` CANARY as the key into a NON-LLM node env-echo payload; assert the RAW container stdout
//     CARRIED the canary (the /proc-readable-env leak is REAL — the precondition), then assert
//     scrubLabSecrets REMOVES it. Non-vacuous: it proves the scrub fired on a present secret.
//   LEG B (~$0.03-0.50) — one real claude -p call AUTHENTICATES via the injected key (network-on) and
//     returns ok + a captured positive total_cost_usd; the cost is ledgered; an over-cap guard REFUSES.
//
// SCOPE (honest): the scrubber is a COARSE `sk-`-anchored DEFENSE-IN-DEPTH net (scrub-lab-secrets.js
// header), NOT a guarantee — a split/encoded/non-`sk-` credential SURVIVES (VALIDATE hacker H2); the HARD
// close is egress restriction at ③.2.3. The production actor prompt must NOT instruct a /proc env read.
//
// Run: node packages/lab/issue-corpus/_spike/actor-dogfood.js  (exit 0 green, 1 fail, 2 skip)

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  attestActorContainment, runActorInContainer, buildActorRunArgs, DEFAULT_ACTOR_IMAGE,
} = require('../docker-actor-backend');
const { dockerDaemonUp, dockerImageExists, runInContainer, dockerName } = require('../docker-backend');
const { mkScoped, safeDiscard } = require('../_clone-lifecycle');
const { scrubLabSecrets } = require('../../_lib/scrub-lab-secrets');
const { resolveActorApiKey, recordCost, assertWithinBudget } = require('../cost-ledger');

function containerNames() {
  try { return execFileSync('docker', ['ps', '-a', '--filter', 'name=loom-run-', '--format', '{{.Names}}'], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
}

// A FAKE sk-ant- canary built at RUNTIME by concatenation (no contiguous secret literal in source — the
// secrets gate). Matches the coarse `sk-[A-Za-z0-9_-]{20,}` scrubber class.
const CANARY = `sk${'-ant-api03-'}${'C'.repeat(44)}`;
// Leg B prompt — benign, fast; does NOT instruct a /proc env read (that is LEG A's deterministic job).
const PROMPT = 'Reply with the single word DONE. Do not read or modify any files.';

async function main() {
  if (!dockerDaemonUp('docker')) { console.error('SKIP: docker daemon not reachable'); process.exit(2); }
  if (!dockerImageExists('docker', DEFAULT_ACTOR_IMAGE)) { console.error(`SKIP: image ${DEFAULT_ACTOR_IMAGE} absent (build: docker build --provenance=false --sbom=false -t ${DEFAULT_ACTOR_IMAGE} - < packages/lab/issue-corpus/Dockerfile.actor)`); process.exit(2); }
  const apiKey = resolveActorApiKey();
  if (!apiKey) { console.error('SKIP: no API key at ~/.config/loom/anthropic-api-key (LOOM_ANTHROPIC_KEY_FILE overrides)'); process.exit(2); }

  const attestation = await attestActorContainment({ image: DEFAULT_ACTOR_IMAGE });
  console.log('attest:', JSON.stringify({ attested: attestation.attested, reason: attestation.reason }));
  if (!attestation.attested) { console.error('SKIP/FAIL: containment not attested — refusing to run the actor'); process.exit(1); }

  const containersBefore = containerNames();
  const work = mkScoped('loom-actor-dogfood-');
  fs.writeFileSync(path.join(work, 'README.md'), '# tiny fixture\n');
  const ledgerDir = mkScoped('loom-dogfood-ledger-');
  const ledgerPath = path.join(ledgerDir, 'cost-ledger.jsonl');
  let checks = null;
  try {
    // ── LEG A (FREE): the env -> stdout -> scrub pipeline on the REAL container, with a present-canary
    //    precondition. Inject the CANARY as the key into a NON-LLM env-echo payload; capture RAW stdout.
    const probeName = dockerName();
    const probeArgs = buildActorRunArgs({
      image: DEFAULT_ACTOR_IMAGE, workDir: work, command: 'node',
      argv: ['-e', 'process.stdout.write(JSON.stringify(process.env))'], name: probeName,
    });
    const probeRaw = await runInContainer({
      image: DEFAULT_ACTOR_IMAGE, workDir: work, name: probeName, runArgs: probeArgs,
      spawnEnv: { ANTHROPIC_API_KEY: CANARY }, limits: { wallClockMs: 20000 },
    });
    const rawHadCanary = String(probeRaw.stdout || '').includes(CANARY); // PRECONDITION: the key crossed + is /proc-readable
    const scrubbedProbe = scrubLabSecrets(String(probeRaw.stdout || ''));
    const canaryScrubbed = !scrubbedProbe.includes(CANARY);
    console.log('leg A (scrub pipeline):', JSON.stringify({ rawHadCanary, canaryScrubbed }));

    // ── LEG B (~$0.03-0.50): the real claude -p call — auth + cost.
    const r = await runActorInContainer({
      image: DEFAULT_ACTOR_IMAGE, workDir: work, prompt: PROMPT, apiKey,
      maxBudgetUsd: 0.50, timeout: 120000,
    });
    console.log('leg B (real actor):', JSON.stringify({ ok: r.ok, reason: r.reason, costUsd: r.costUsd, events: r.events.length, redacted: r.redacted }));

    let recorded = false; let refused = false;
    if (Number.isFinite(r.costUsd)) {
      recordCost({ ledgerPath, runId: 'dogfood', issueId: 'spike__actor-dogfood-issue-0', costUsd: r.costUsd });
      recorded = true;
      try { assertWithinBudget({ ledgerPath, capUsd: 0.001, estimatedUsd: 0.001 }); } // tiny cap -> must refuse
      catch { refused = true; }
    }
    const ledgerRaw = recorded ? fs.readFileSync(ledgerPath, 'utf8') : '';

    checks = {
      attested: attestation.attested === true,
      // LEG A — the scrub pipeline, non-vacuous:
      rawCarriedCanary: rawHadCanary === true,     // the precondition (the key WAS in the raw stream)
      canaryScrubbed: canaryScrubbed === true,      // ...and the scrub REMOVED it
      // LEG B — auth + cost:
      actorOk: r.ok === true,
      costCaptured: Number.isFinite(r.costUsd) && r.costUsd > 0,
      realTranscriptKeyFree: !/sk-/.test(r.stdout), // the returned transcript is key-free (weak alone; LEG A is the proof)
      costRecorded: recorded,
      overCapRefused: refused,
      ledgerKeyFree: !/sk-/.test(ledgerRaw),
      noLeakedContainer: containerNames() === containersBefore,
    };
  } finally {
    safeDiscard(work);
    safeDiscard(ledgerDir);
  }

  console.log('\nchecks:', JSON.stringify(checks, null, 2));
  const ok = Object.values(checks).every(Boolean);
  console.log(ok
    ? '\nACTOR DOGFOOD GREEN — the env->stdout->scrub pipeline redacts a PRESENT canary on the real container (LEG A), and a real claude -p call authenticated in-container with cost captured + ledgered + the over-cap guard refusing (LEG B). The coarse scrubber is defense-in-depth (split/encoded keys survive -> egress restriction at ③.2.3). Emitted nothing.'
    : '\nACTOR DOGFOOD FAILED — see checks above.');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('DOGFOOD CRASHED:', e); process.exit(1); });
