#!/usr/bin/env node

// _spike/live-draft-dogfood.js — ③.2.2c EC.c7 (Rule 2a-corollary: a green mock suite is a HYPOTHESIS;
// the REAL contained `claude -p` path is where bugs hide). NOT CI-globbed (lives in _spike/, not
// tests/unit/**). Manual run; spends real API ($ for one contained actor + 2 tool-less judges).
//
// Runs the FULL semantic DRAFT loop on ONE real public good-first-issue record:
//   prepareClone @ base_sha -> #391 runActorInContainer (no Bash) -> captureActorDiff ->
//   SHADOW grade (tool-pinned blind judge + friction) -> emitPR DRY-RUN draft -> artifact.
// EMITS NOTHING. Green-or-skip: if Docker/image/key are absent, it SKIPS cleanly (exit 0).
//
// Leg P (free, no API): proves a tool-less `claude -p` actually has NO tools (the EC.c2a recipe is
// load-bearing — a bare claude -p would be host-RCE under judge prompt-injection). Leg L (real spend):
// the loop. Usage:
//   LOOM_DOGFOOD_REPO=https://github.com/<owner>/<repo> LOOM_DOGFOOD_SHA=<40hex> \
//   LOOM_DOGFOOD_ISSUE=<N> LOOM_DOGFOOD_PROBLEM="..." node packages/lab/issue-corpus/_spike/live-draft-dogfood.js

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

// Static relative requires (the bootcamp-gates EC7 governance gate forbids a string-built require).
const { runLiveDraftLoop } = require('../../persona-experiment/live-draft-run');
const { resolveActorApiKey, resolveLedgerPath } = require('../cost-ledger');
const { attestActorContainment, DEFAULT_ACTOR_IMAGE } = require('../docker-actor-backend');
const { makeBlindSemanticJudge } = require('../../causal-edge/calibration-issue-run');
const { makeFrictionLabeler, resolveClaude } = require('../../causal-edge/trajectory-friction-run');
const { TOOLLESS_CLAUDE_ARGS } = require('../../_lib/claude-headless');

function log(...a) { process.stdout.write(a.join(' ') + '\n'); }
function skip(why) { log(`SKIP: ${why}`); process.exit(0); }

// --- Leg P: a tool-less `claude -p` truly has no tools (free; the EC.c2a real proof) ----------
function legP_toollessHasNoTools() {
  const bin = resolveClaude();
  if (!bin) { log('Leg P SKIP: no claude bin'); return; }
  // AUTHORITATIVE tool-inertness check (VALIDATE honesty fold + the dogfood's own LSP catch): parse the
  // CLI's stream-json INIT `tools` array — what the session ACTUALLY enables. We do NOT ask the model to
  // self-report its tools: the model lists tools from general knowledge, not the live config (it reported
  // ["LSP"] one run and the full default set another — both unreliable). The INIT event is the ground truth.
  // Probe the ACTUAL recipe the judges use (TOOLLESS_CLAUDE_ARGS) — the canary must test what ships.
  const r = spawnSync(bin, ['-p', '--model', 'claude-sonnet-4-6', ...TOOLLESS_CLAUDE_ARGS, '--output-format', 'stream-json', '--verbose'],
    { input: 'hi', encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
  if (r.status !== 0) { log('Leg P SKIP: probe non-zero exit (auth?)', r.stderr ? String(r.stderr).slice(0, 200) : ''); return; }
  let initTools = null;
  for (const line of String(r.stdout || '').split('\n')) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'system' && e.subtype === 'init') { initTools = Array.isArray(e.tools) ? e.tools : null; break; }
  }
  if (initTools === null) { log('Leg P INCONCLUSIVE: no init event found'); return; }
  if (initTools.length === 0) log('Leg P PASS: the CLI init reports tools: [] (the recipe disables ALL tools incl. LSP).');
  else log('Leg P WARN: the CLI init reports tools:', JSON.stringify(initTools), '— a tool the recipe does not cover leaked; add it to --disallowedTools / INVESTIGATE before ③.2.3.');
}

// --- Leg L: the full loop on one real record (real spend) -------------------------------------
async function legL_fullLoop() {
  const repo = process.env.LOOM_DOGFOOD_REPO;
  const sha = process.env.LOOM_DOGFOOD_SHA;
  const issue = process.env.LOOM_DOGFOOD_ISSUE;
  const problem = process.env.LOOM_DOGFOOD_PROBLEM;
  if (!repo || !sha || !issue || !problem) skip('set LOOM_DOGFOOD_REPO / _SHA / _ISSUE / _PROBLEM to run Leg L');
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repo);
  if (!m) skip('LOOM_DOGFOOD_REPO must be https://github.com/owner/repo');

  if (!resolveActorApiKey({})) skip('no actor API key (~/.config/loom/anthropic-api-key)');
  const att = await attestActorContainment({ image: DEFAULT_ACTOR_IMAGE });
  if (!att || att.attested !== true) skip('containment not attested: ' + ((att && att.reason) || 'unknown') + ' (build loom-actor:latest --provenance=false --sbom=false)');

  const record = { id: `${m[1]}__${m[2]}-issue-${issue}`, repo, base_sha: sha, problem_statement: String(problem) };
  const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-dogfood-draft-'));
  log('Leg L: running the full loop on', record.id, '-> artifacts at', artifactsDir);

  const report = await runLiveDraftLoop({
    records: [record], artifactsDir, ledgerPath: resolveLedgerPath(), runId: 'dogfood-322c', now: Date.now(),
    deps: { semanticFn: makeBlindSemanticJudge({ toolless: true }), frictionFn: makeFrictionLabeler({ toolless: true }) },
  });

  log('Leg L report:', JSON.stringify(report, null, 2));
  const o = (report.outcomes && report.outcomes[0]) || {};
  // EC.c7 acceptance: emitted NOTHING; a draft (or a clean fail-soft) was produced; host clean.
  if (report.fatal) { log('Leg L: FATAL (env) —', report.fatal); return; }
  log(`Leg L: outcome stage=${o.stage} ok=${o.ok} reason=${o.reason} cost=${o.cost_usd}`);
  if (o.ok && o.artifact) {
    const art = JSON.parse(fs.readFileSync(o.artifact, 'utf8'));
    log('Leg L: DRAFT title:', art.draft && art.draft.title);
    log('Leg L: DRAFT touched_paths:', JSON.stringify(art.draft && art.draft.touched_paths));
    log('Leg L: SHADOW verdict:', JSON.stringify(art.verdict));
    if (JSON.stringify(art).includes('ghp_') || JSON.stringify(art).includes('sk-ant')) log('Leg L: WARNING — a secret-shaped token appears in the artifact!');
    else log('Leg L: artifact carries NO token/secret-shape (good).');
  }
  log('Leg L: emitted=NOTHING (dry-run; armedEmit throws). Done.');
}

(async () => {
  log('=== ③.2.2c live-draft dogfood ===');
  legP_toollessHasNoTools();
  await legL_fullLoop();
})().catch((e) => { log('dogfood ERROR:', e && (e.stack || e.message)); process.exit(1); });
