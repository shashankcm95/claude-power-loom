#!/usr/bin/env node

// @loom-layer: lab
//
// live-solve-one — the single-issue entry point: a git issue in -> a SHADOW draft PR out. Fetches ONE
// explicitly-targeted GitHub issue into a validated PUBLIC record (fetchOneIssueRecord — the puller's
// hardened guard sequence, no search) and drives it through runLiveDraftLoop: classify -> [materialize] ->
// contained `claude -p` solve -> semantic/friction grade -> live-lesson capture -> emitPR DRY.
//
// SHADOW-DRY BY CONSTRUCTION (load-bearing): this CLI threads NO egress custody. runLiveDraftLoop calls
// emitPR(data, {}) with a hardcoded empty opts (live-draft-run.js), so emitPR fail-closes on ALL THREE of
// {dry-run default, no-token, killswitch-on} -> emitted:false. NO argv flag maps to deps.emitFn / loopDeps /
// any custody path; the injectable fetchFn/draftFn are TEST-ONLY seams. This module imports ONLY the
// populator + the loop -- never world-anchor/, custody-arming, or any egress-arming module -- so it cannot
// arm or emit. --materialize maps ONLY to LOOM_PERSONA_MATERIALIZE (the prompt-injection SHADOW field),
// never to emission.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { fetchOneIssueRecord } = require('../issue-corpus/live-puller');
const { runLiveDraftLoop } = require('./live-draft-run');

const CHECKPOINTS = path.join(os.homedir(), '.claude', 'checkpoints');
const DEFAULT_ARTIFACTS_DIR = path.join(CHECKPOINTS, 'live-solve-artifacts');
const DEFAULT_LEDGER_PATH = path.join(CHECKPOINTS, 'live-solve-ledger.json');
// The durable OUTCOME ledger (observability, dogfood-surfaced): a failed/timed-out solve writes NO
// draft artifact and (if it spent $0) NO cost-ledger line, so without this the pipeline is BLIND to
// failures. Every run appends its outcome (success OR failure) here as one JSONL line.
const DEFAULT_OUTCOME_LEDGER_PATH = path.join(CHECKPOINTS, 'live-solve-outcomes.jsonl');
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_CAP_USD = 12;

const USAGE = [
  'Usage: live-solve-one <owner>/<repo>#<issue> [--model <m>] [--max-budget-usd <n>] [--materialize] [--json]',
  '',
  '  Fetches the targeted GitHub issue and runs it through the SHADOW live-draft pipeline',
  '  (classify -> persona -> contained solve -> grade -> capture -> DRY emit), writing a draft-PR',
  '  artifact. Emits NOTHING to GitHub -- egress is dry by construction.',
  '',
  '  --materialize          inject the classified persona (KB/skills/instincts) into the actor prompt',
  '                         (sets LOOM_PERSONA_MATERIALIZE for this run; SHADOW, never arms egress)',
  '  --rebuild-image        rebuild the loom-actor image if its tag is absent (the containerd tag can',
  '                         silently vanish; a `docker build` is a real side-effect, so opt-in only)',
  '  --max-budget-usd <n>   per-run cost cap (default 12)',
  '  --timeout <seconds>    contained-solve wall-clock (default 180; raise for deep substrate issues)',
  '  --model <m>            actor model (default claude-sonnet-4-6)',
  '  --json                 print the raw runLiveDraftLoop report as JSON',
].join('\n');

// Parse `<owner>/<repo>#<issue>`: strict segments, no coercion. The owner/repo are re-guarded downstream by
// fetchOneIssueRecord (assertSafeOwnerRepo rejoins + forbids a second slash); the issue number is
// boundary-validated here with a strict 1-15-digit regex so `#2e3`/`#0x1F`/`# 5` are rejected (Number()/
// parseInt would silently coerce). 15 digits is always < 2^53, so the result is a safe integer.
function parseTarget(spec) {
  if (typeof spec !== 'string') throw new Error('usage: a <owner>/<repo>#<issue> target is required');
  const hash = spec.indexOf('#');
  if (hash < 0) throw new Error(`usage: target must be <owner>/<repo>#<issue> (got ${JSON.stringify(spec)})`);
  const slug = spec.slice(0, hash);
  const numStr = spec.slice(hash + 1);
  if (!/^[0-9]{1,15}$/.test(numStr)) throw new Error(`usage: issue must be 1-15 digits (got ${JSON.stringify(numStr)})`);
  const slash = slug.indexOf('/');
  if (slash <= 0 || slash === slug.length - 1) throw new Error(`usage: target must be <owner>/<repo>#<issue> (got ${JSON.stringify(spec)})`);
  // split on the FIRST slash only; any extra '/' stays in repo and is rejected by assertSafeOwnerRepo.
  return { owner: slug.slice(0, slash), repo: slug.slice(slash + 1), number: Number(numStr) };
}

function parseFlags(argv) {
  const flags = { model: DEFAULT_MODEL, maxBudgetUsd: DEFAULT_CAP_USD, materialize: false, json: false, rebuildImage: false };
  let target = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--materialize') flags.materialize = true;
    else if (a === '--rebuild-image') flags.rebuildImage = true;
    else if (a === '--json') flags.json = true;
    else if (a === '--model') {
      const v = argv[i + 1]; i += 1;
      if (typeof v !== 'string') throw new Error('usage: --model requires a value');
      // charset-validate (hacker M1): a flag-shaped / metachar model would arg-inject into `claude --model`
      // inside the container (shell-inert via the wrapper's `exec "$@"`, but still bad). No leading dash,
      // [A-Za-z0-9._-] only, 1-64 chars -> fail closed on a typo / hostile value.
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(v)) throw new Error('usage: --model must be a model name (no leading dash; [A-Za-z0-9._-], 1-64 chars)');
      flags.model = v;
    } else if (a === '--max-budget-usd') {
      const v = Number(argv[i + 1]); i += 1;
      if (!Number.isFinite(v) || v <= 0) throw new Error('usage: --max-budget-usd must be a positive number');
      flags.maxBudgetUsd = v;
    } else if (a === '--timeout') {
      // the contained-solve wall-clock in SECONDS (default 180s in docker-actor-backend). Substrate-audit
      // issues need deep context and blow the 3-min default -> operator-tunable (dogfood-surfaced).
      const v = Number(argv[i + 1]); i += 1;
      if (!Number.isInteger(v) || v <= 0) throw new Error('usage: --timeout must be a positive integer (seconds)');
      flags.timeoutMs = v * 1000;
    } else if (a.startsWith('--')) throw new Error(`usage: unknown flag ${a}`);
    else if (target === null) target = a;
    else throw new Error(`usage: unexpected extra argument ${JSON.stringify(a)}`);
  }
  if (target === null) throw new Error('usage: a <owner>/<repo>#<issue> target is required');
  return { target, flags };
}

/** Append each run outcome (success OR failure) to the durable JSONL outcome ledger. Best-effort:
 *  a ledger-write failure NEVER fails the run — observability must not break the pipeline. */
function appendOutcomeLedger(outcomeLedgerPath, runId, outcomes, nowIso) {
  const lines = (Array.isArray(outcomes) ? outcomes : []).map((o) => JSON.stringify({
    ts: nowIso, runId, record_id: o.record_id || null, stage: o.stage || null, ok: o.ok === true,
    reason: o.reason || null, persona: o.persona || null, classify_signal: o.classify_signal || null,
    cost_usd: typeof o.cost_usd === 'number' ? o.cost_usd : null,
    behavioral: (o.verdict && o.verdict.behavioral) || null,
  }));
  if (!lines.length) return;
  // mkdir first: on a run-level fatal the artifact/cost writers that would have created the checkpoints
  // dir never ran, so on a FRESH env the append would ENOENT and the catch would silently drop the very
  // failure this ledger exists to record (CodeRabbit #556). mkdir + append both stay best-effort.
  try {
    fs.mkdirSync(path.dirname(outcomeLedgerPath), { recursive: true, mode: 0o700 });
    fs.appendFileSync(outcomeLedgerPath, `${lines.join('\n')}\n`);
  } catch { /* best-effort */ }
}

// deps.fetchFn / deps.draftFn / deps.logFn / deps.artifactsDir / deps.ledgerPath are TEST-ONLY seams — NOT
// wired to argv (no flag can reach them). The default path fetches + drives the real loop.
async function run(argv, deps = {}) {
  const fetchFn = deps.fetchFn || fetchOneIssueRecord;
  const draftFn = deps.draftFn || runLiveDraftLoop;
  const logFn = deps.logFn || ((s) => process.stdout.write(`${s}\n`));

  const { target, flags } = parseFlags(argv);
  const { owner, repo, number } = parseTarget(target);

  const record = await fetchFn({ owner, repo, number });   // may throw -> caught by main()

  // --materialize scopes the SHADOW persona-prompt field to THIS run: set it around the solve and RESTORE
  // the prior value in a finally, so a long-lived host reusing run() never inherits it (hacker M2 — an
  // un-scoped process-global would silently arm persona-injection for every subsequent record).
  const prevMaterialize = process.env.LOOM_PERSONA_MATERIALIZE;
  if (flags.materialize) process.env.LOOM_PERSONA_MATERIALIZE = '1';
  let report;
  try {
    report = await draftFn({
      records: [record],
      artifactsDir: deps.artifactsDir || DEFAULT_ARTIFACTS_DIR,
      ledgerPath: deps.ledgerPath || DEFAULT_LEDGER_PATH,
      // estimatedUsd is deliberately unwired: capUsd + the per-record ledger cap bound the spend; a
      // pre-flight --estimated-usd is a future precision knob, not a safety gate (code-review MED).
      capUsd: flags.maxBudgetUsd,
      model: flags.model,
      timeout: flags.timeoutMs,   // undefined when unset -> runActorInContainer's DEFAULT_ACTOR_TIMEOUT_MS
      runId: `live-solve-${owner}__${repo}-issue-${number}`,
      // Wave D - record this live solve into the solve-queue (queued->solving->drafted) so the merge-poll cron
      // has an entry to observe. SHADOW/weight-inert (the queue gates nothing). F4: --rebuild-image opts into
      // the ensure-image rebuild when the actor tag has vanished.
      recordToQueue: true,
      rebuildImageIfAbsent: flags.rebuildImage,
    });
  } finally {
    if (flags.materialize) {
      if (prevMaterialize === undefined) delete process.env.LOOM_PERSONA_MATERIALIZE;
      else process.env.LOOM_PERSONA_MATERIALIZE = prevMaterialize;
    }
  }

  // durable, failure-inclusive observability — append BEFORE the json/text output + the ok/fail exit.
  // A RUN-LEVEL fatal (preflight-threw / actor-key-absent / containment-unattested / tool-inertness) sets
  // report.fatal + outcomes:[] — the loop never starts — so synthesize ONE fatal record; otherwise the
  // ledger stays silent on exactly the "couldn't even start" failure it exists to surface (code-review HIGH).
  const ledgerOutcomes = (report && Array.isArray(report.outcomes) && report.outcomes.length)
    ? report.outcomes
    : (report && report.fatal ? [{ record_id: record.id, stage: 'fatal', ok: false, reason: report.fatal }] : []);
  appendOutcomeLedger(
    deps.outcomeLedgerPath || DEFAULT_OUTCOME_LEDGER_PATH,
    `live-solve-${owner}__${repo}-issue-${number}`,
    ledgerOutcomes, new Date().toISOString(),
  );

  if (flags.json) { logFn(JSON.stringify(report, null, 2)); return report; }

  const oc = (report && Array.isArray(report.outcomes) && report.outcomes[0]) || null;
  const v = oc && oc.verdict;
  const friction = v && v.friction && (v.friction.friction_class || v.friction);
  logFn(`issue:    ${owner}/${repo}#${number}`);
  logFn(`persona:  ${oc ? oc.persona : '(n/a)'} (${oc ? oc.classify_signal : 'n/a'})`);
  logFn(`stage:    ${oc ? `${oc.stage}/${oc.ok ? 'ok' : 'fail'} ${oc.reason}` : 'n/a'}`);
  if (v) logFn(`verdict:  semantic=${v.semantic_supported} friction=${friction} behavioral=${v.behavioral}`);
  logFn(`cost:     $${oc && oc.cost_usd != null ? oc.cost_usd : 0}`);
  if (report && report.fatal) logFn(`FATAL:    ${report.fatal}`);
  if (oc && oc.artifact) logFn(`draft PR: ${oc.artifact}  (emitted:false -- SHADOW/dry)`);
  return report;
}

async function main(argv) {
  try {
    const report = await run(argv);
    const ok = !!(report && !report.fatal && Array.isArray(report.outcomes) && report.outcomes[0] && report.outcomes[0].ok);
    process.exit(ok ? 0 : 1);
  } catch (e) {
    // value-redacted clean exit — never a raw stack or gh stderr (which can echo ambient-token context).
    const msg = (e && e.message) || 'error';
    process.stderr.write(`live-solve-one: ${msg}\n`);
    if (/^usage:/.test(msg)) process.stderr.write(`\n${USAGE}\n`);
    process.exit(1);
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { run, parseTarget, parseFlags, appendOutcomeLedger, USAGE };
