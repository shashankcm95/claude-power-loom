#!/usr/bin/env node
/**
 * extract-run.test.js — v2.9.0 Phase A.1 (FIX-I5) coverage
 *
 * TDD for the extract-run.sh fixes:
 *   - Regex matches BOTH "Sub-agent spawns total: N" AND "Total spawns: N"
 *   - Line 183 silent fallback fires WARN to stderr (per lior HIGH-3b)
 *   - --strict flag exits 2 when any null field remains
 *   - _unfilled: true JSON marker on null fields
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO, 'packages/specs/bench/control-runs/extract-run.sh');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { process.stdout.write('  PASS ' + msg + '\n'); passed++; }
  else { process.stdout.write('  FAIL ' + msg + '\n'); failed++; }
}

function createTestProject(finalDebriefContent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ex-run-test-'));
  const bench = path.join(dir, 'bench');
  fs.mkdirSync(path.join(bench, 'snapshots'), { recursive: true });
  // Minimal snapshot dirs for the ls -dt globs to find something
  const ts = '2026-05-22T13-00-00Z';
  for (const phase of ['baseline-pre-phase-1', 'phase-1-end', 'phase-2-end', 'phase-3-end', 'phase-4-end']) {
    const snap = path.join(bench, 'snapshots', phase + '-' + ts);
    fs.mkdirSync(snap, { recursive: true });
    // Empty agent-patterns.json + agent-identities.json stubs
    fs.writeFileSync(path.join(snap, 'agent-patterns.json'), '{"patterns":[]}');
    fs.writeFileSync(path.join(snap, 'agent-identities.json'), '{"identities":{}}');
  }
  fs.writeFileSync(path.join(bench, 'FINAL-DEBRIEF.md'), finalDebriefContent);
  return dir;
}

function runExtract(projectDir, targetDir, extraArgs = []) {
  return spawnSync('bash', [SCRIPT, '--project', projectDir, '--target', targetDir, ...extraArgs], {
    encoding: 'utf8',
    cwd: REPO,
  });
}

function cleanup(...dirs) {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

process.stdout.write('\n[FIX-I5] extract-run.sh regex + WARN + --strict + _unfilled marker\n');

// T1: regex matches "Sub-agent spawns total: 15" (v2.8.5+ shape)
{
  const debrief = '# DEBRIEF\n\n| Sub-agent spawns total | 15 |\n\n## Findings\n\n## CRITICAL\n### CRITICAL-1: foo\n';
  const proj = createTestProject(debrief);
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'ex-run-target-'));
  runExtract(proj, target);
  let metrics;
  try { metrics = JSON.parse(fs.readFileSync(path.join(target, 'metrics.json'), 'utf8')); } catch { /* metrics may be missing if extract failed */ }
  assert(metrics && metrics.actors_spawned_total === 15, 'T1: "Sub-agent spawns total: 15" -> actors_spawned_total=15');
  cleanup(proj, target);
}

// T2: regex matches "Total spawns: 8" (legacy shape; v2.8.2/v2.8.3 format)
{
  const debrief = '# DEBRIEF\n\n| Total spawns | 8 |\n\n## Findings\n\n## HIGH\n### HIGH-1: bar\n';
  const proj = createTestProject(debrief);
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'ex-run-target-'));
  runExtract(proj, target);
  let metrics;
  try { metrics = JSON.parse(fs.readFileSync(path.join(target, 'metrics.json'), 'utf8')); } catch { /* metrics may be missing if extract failed */ }
  assert(metrics && metrics.actors_spawned_total === 8, 'T2: "Total spawns: 8" -> actors_spawned_total=8');
  cleanup(proj, target);
}

// T3: regex misses (no spawn line); fallback fires WARN to stderr (lior HIGH-3b)
{
  const debrief = '# DEBRIEF\n\nNo spawn-count line whatsoever.\n\n## CRITICAL\n### CRITICAL-1: baz\n';
  const proj = createTestProject(debrief);
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'ex-run-target-'));
  const r = runExtract(proj, target);
  const stderrCombined = (r.stderr || '') + (r.stdout || '');
  assert(/(WARN|regex.*fallback|did not match)/i.test(stderrCombined),
    'T3: missing spawn-line emits WARN on stderr (lior HIGH-3b)');
  cleanup(proj, target);
}

// T4: missing spawn-line marks actors_spawned_total as _unfilled in JSON
{
  const debrief = '# DEBRIEF\n\nNo spawn line.\n\n## CRITICAL\n### CRITICAL-1: x\n';
  const proj = createTestProject(debrief);
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'ex-run-target-'));
  runExtract(proj, target);
  let metrics;
  try { metrics = JSON.parse(fs.readFileSync(path.join(target, 'metrics.json'), 'utf8')); } catch { /* metrics may be missing if extract failed */ }
  const unfilled = metrics && metrics._unfilled_fields;
  assert(Array.isArray(unfilled) && unfilled.includes('actors_spawned_total'),
    'T4: missing spawn-line -> _unfilled_fields includes "actors_spawned_total"');
  cleanup(proj, target);
}

// T5: --strict flag exits non-zero (code 2) when any null/unfilled remains
{
  const debrief = '# DEBRIEF\n\n| Sub-agent spawns total | 5 |\n\n## CRITICAL\n### CRITICAL-1: y\n';
  const proj = createTestProject(debrief);
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'ex-run-target-'));
  const r = runExtract(proj, target, ['--strict']);
  // Even with the spawn line found, several fields are null (contract_verifier_exercise_rate etc.)
  // --strict should exit 2.
  assert(r.status === 2, 'T5: --strict exits 2 when null fields remain (got ' + r.status + ')');
  cleanup(proj, target);
}

// T6: --strict flag exits 0 when no nulls remain (synthetic: all known nulls filled via env)
//     Not feasible to test here without flag-driven backfill; skip with explicit "deferred"
{
  process.stdout.write('  SKIP T6: --strict success path needs flag-driven backfill harness; deferred to integration test\n');
}

// T7: null fields list contains all expected unfilled candidates per v2.8.5-treatment evidence
{
  const debrief = '# DEBRIEF\n\n| Sub-agent spawns total | 3 |\n\n## CRITICAL\n### CRITICAL-1: z\n';
  const proj = createTestProject(debrief);
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'ex-run-target-'));
  runExtract(proj, target);
  let metrics;
  try { metrics = JSON.parse(fs.readFileSync(path.join(target, 'metrics.json'), 'utf8')); } catch { /* metrics may be missing if extract failed */ }
  const unfilled = (metrics && metrics._unfilled_fields) || [];
  const expectedUnfilled = [
    'contract_verifier_exercise_rate',
    'hook_runtime_gaps',
    'forge_cite_rate',
    'synthid_drift_events',
  ];
  const allListed = expectedUnfilled.every((f) => unfilled.includes(f));
  assert(allListed, 'T7: known-null tier_1 fields appear in _unfilled_fields (got: ' + JSON.stringify(unfilled).slice(0, 200) + ')');
  cleanup(proj, target);
}

process.stdout.write('\n=== Summary ===\n');
process.stdout.write('  Passed: ' + passed + '\n');
process.stdout.write('  Failed: ' + failed + '\n');

if (failed > 0) process.exit(1);
