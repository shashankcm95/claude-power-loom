#!/usr/bin/env node

// @loom-layer: lab
//
// v3.10-W3 E3 — the LIVE diagnostic: run the reputation-gate advisory over the REAL projectReputation output +
// the REAL breaker (pinned to the live default source `verdict-fail`, non-starved). Reports "where we stand":
// does the closed loop DISCRIMINATE on the real data, or fail-safe to no-narrowing because the lane is thin /
// all-pass / key-fragmented? OUT of CI (reads the user's real ~/.claude lab-state).

'use strict';

const { projectReputation } = require('../project');
const { recommendNarrowing } = require('../reputation-gate');
const { evaluate } = require('../../circuit-breaker/project');

const out = (s) => process.stdout.write(`${s}\n`);

const reputation = projectReputation({});
const candidates = reputation.personas.map((p) => p.persona);
// breakerOf pinned to the LIVE default source (verdict-fail, non-starved); wrap evaluate so it never throws.
const breakerOf = (c) => { try { return evaluate({ persona: c, source: 'verdict-fail' }); } catch { return null; } };

out('=== v3.10-W3 E3 — reputation-gate over the LIVE authenticated lane ===');
out(`source=${reputation.source} | personas=${candidates.length} | candidates=${JSON.stringify(candidates)}`);
out(`per-persona verdicts: ${JSON.stringify(reputation.personas.map((p) => ({ persona: p.persona, total: p.total, by_verdict: p.by_verdict })))}`);

for (const minEvidence of [5, 1]) {
  const rec = recommendNarrowing(candidates, reputation, breakerOf, { minEvidence, passFloor: 0.5 });
  out(`\n--- minEvidence=${minEvidence} ---`);
  for (const r of rec) out(`  ${r.candidate}: ${r.recommendation} (${r.reason}) | total=${r.evidence.total} pass_ratio=${r.evidence.pass_ratio} tripped=${r.evidence.breaker_tripped} starved=${r.evidence.source_starved}`);
  const narrowed = rec.filter((r) => r.recommendation !== 'proceed');
  out(`  -> ${narrowed.length}/${rec.length} narrowed`);
}

// The honest read: do any two DISTINCT personas get DIFFERENT recommendations (real discrimination)?
const recLow = recommendNarrowing(candidates, reputation, breakerOf, { minEvidence: 1, passFloor: 0.5 });
const distinctRecs = new Set(recLow.map((r) => r.recommendation));
const anyFail = reputation.personas.some((p) => p.by_verdict && p.by_verdict.fail > 0);
out('\n=== WHERE WE STAND ===');
out(`  loop CLOSES (the consumer ran end-to-end over the real lane): YES`);
out(`  any negative signal in the lane (a fail verdict anywhere)? ${anyFail}`);
out(`  the gate DISCRIMINATES on the real data (>1 distinct recommendation)? ${distinctRecs.size > 1} (recs seen: ${JSON.stringify([...distinctRecs])})`);
out(`  key fragmentation: ${candidates.length} keys for ${new Set(candidates.map((c) => c.replace(/^\d+-/, ''))).size} canonical persona(s)`);
