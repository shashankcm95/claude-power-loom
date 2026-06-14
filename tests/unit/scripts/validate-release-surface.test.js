#!/usr/bin/env node

// tests/unit/scripts/validate-release-surface.test.js
//
// The release-version surface gate: the plugin version is repeated across 4 files
// (.claude-plugin/plugin.json + README badges/prose + CHANGELOG top + ARCHITECTURE
// watermark); they must agree, and at a phase close must name the phase. Core-logic
// tests for the pure evaluate(), the fail-closed/reword-tolerant extraction, the
// phase-equality + --allow-unbumped escape, arg parsing, AND a LIVE-repo regex
// pinning test (a fail-closed gate that fails-RED on a correct repo trains people
// to bypass it -- so the regexes are pinned against the actual current bytes).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const V = require('../../../scripts/validate-release-surface.js');
const { SURFACES, extractSurface, normalizePhase, evaluate, checkReleaseSurface, parseArgs, REPO_ROOT } = V;

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; } catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

// Build a synthetic extracted-surface array for the pure evaluate(). `versions`
// maps a surface name -> 'MAJOR.MINOR' | null (null => token-not-found).
function surfacesFrom(versions) {
  return SURFACES.map((s) => ({
    name: s.name,
    file: s.file,
    hard: s.hard,
    version: Object.prototype.hasOwnProperty.call(versions, s.name) ? versions[s.name] : '3.8',
    error: (Object.prototype.hasOwnProperty.call(versions, s.name) && versions[s.name] == null) ? 'token-not-found' : null,
  }));
}
const ALL_38 = () => surfacesFrom({});

// -- normalizePhase: accepts vX.Y / X.Y / X.Y.Z / vX.Y.Z; rejects junk.
test('normalizePhase: accepts the four id shapes, rejects junk', () => {
  assert.strictEqual(normalizePhase('v3.9'), '3.9');
  assert.strictEqual(normalizePhase('3.9'), '3.9');
  assert.strictEqual(normalizePhase('3.9.0'), '3.9');
  assert.strictEqual(normalizePhase('v3.9.0'), '3.9');
  assert.strictEqual(normalizePhase('v3.10'), '3.10');
  assert.strictEqual(normalizePhase('nonsense'), null);
  assert.strictEqual(normalizePhase(null), null);
});

// -- consistency: all-agree passes; a single disagreement fails and names it.
test('evaluate: all surfaces agree -> ok', () => {
  const r = evaluate(ALL_38(), {});
  assert.strictEqual(r.ok, true, r.errors.join('; '));
  assert.strictEqual(r.common, '3.8');
});
test('evaluate: one surface disagreeing -> FAIL (the partial-bump class)', () => {
  const r = evaluate(surfacesFrom({ 'plugin.json:version': '3.9' }), {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.common, null);
  assert.ok(r.errors.some((e) => /disagree/.test(e)), 'reports the disagreement');
});

// -- fail-closed on the NUMBER, reword-tolerant on the PROSE.
test('evaluate: a HARD surface with no token -> FAIL (fail-closed)', () => {
  const r = evaluate(surfacesFrom({ 'CHANGELOG:top-entry': null }), {});
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => /CHANGELOG:top-entry/.test(e) && /token-not-found/.test(e)));
});
test('evaluate: the SOFT prose surface missing -> WARN, not fail', () => {
  const r = evaluate(surfacesFrom({ 'README:now-at-prose': null }), {});
  assert.strictEqual(r.ok, true, 'a reworded prose line does not break the gate');
  assert.ok(r.warnings.some((w) => /now-at-prose/.test(w)));
});
test('evaluate: the SOFT surface present but WRONG is still caught by consistency', () => {
  const r = evaluate(surfacesFrom({ 'README:now-at-prose': '9.9' }), {});
  assert.strictEqual(r.ok, false, 'soft means missing-tolerated, NOT wrong-tolerated');
  assert.ok(r.errors.some((e) => /disagree/.test(e)));
});

// -- phase-equality + the --allow-unbumped escape (the /phase-close gate).
test('evaluate --phase: common == phase -> ok', () => {
  const r = evaluate(surfacesFrom({}), { phase: 'v3.8' });
  assert.strictEqual(r.ok, true, r.errors.join('; '));
});
test('evaluate --phase: surface lags the phase -> FAIL (closed v3.N, still reads N-1)', () => {
  const r = evaluate(ALL_38(), { phase: 'v3.9' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => /reads 3\.8 but closing phase 3\.9/.test(e)));
  assert.ok(r.errors.some((e) => /--allow-unbumped/.test(e)), 'the message names the escape hatch');
});
test('evaluate --phase --allow-unbumped: mismatch tolerated, consistency still enforced', () => {
  const ok = evaluate(ALL_38(), { phase: 'v3.9', allowUnbumped: true });
  assert.strictEqual(ok.ok, true, 'the explicit override skips the phase-equality requirement');
  // ...but a DRIFTED surface still fails even under --allow-unbumped:
  const drift = evaluate(surfacesFrom({ 'plugin.json:version': '3.7' }), { phase: 'v3.9', allowUnbumped: true });
  assert.strictEqual(drift.ok, false, 'allow-unbumped does not waive cross-surface consistency');
});
test('evaluate --phase: an unparseable phase id -> FAIL', () => {
  const r = evaluate(ALL_38(), { phase: 'banana' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => /unparseable/.test(e)));
});
test('evaluate: surfaces disagree WHILE closing a phase -> the error names the target (VALIDATE SHOULD)', () => {
  const r = evaluate(surfacesFrom({ 'plugin.json:version': '3.7' }), { phase: 'v3.9' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => /disagree/.test(e) && /3\.9\.x/.test(e)), 'the disagree error names the 3.9 target, not just "they disagree"');
});

// -- extractSurface: against temp fixtures (read-failed, token-not-found, hit).
test('extractSurface: a present token extracts MAJOR.MINOR', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relsurf-'));
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-plugin/plugin.json'), '{\n  "version": "4.2.1"\n}\n');
  const s = SURFACES.find((x) => x.name === 'plugin.json:version');
  const out = extractSurface(s, dir);
  assert.strictEqual(out.version, '4.2');
  assert.strictEqual(out.error, null);
  fs.rmSync(dir, { recursive: true, force: true });
});
test('extractSurface: a missing file -> read-failed (fail-closed), not a throw', () => {
  const s = SURFACES.find((x) => x.name === 'plugin.json:version');
  const out = extractSurface(s, path.join(os.tmpdir(), 'no-such-repo-xyz'));
  assert.strictEqual(out.version, null);
  assert.ok(/read-failed/.test(out.error));
});
test('extractSurface: CHANGELOG matcher skips a leading [Unreleased] heading', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relsurf-'));
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n## [3.9.0] - 2026-06-13 - title\n');
  const s = SURFACES.find((x) => x.name === 'CHANGELOG:top-entry');
  const out = extractSurface(s, dir);
  assert.strictEqual(out.version, '3.9', 'the first SEMVER heading wins, [Unreleased] is skipped');
  fs.rmSync(dir, { recursive: true, force: true });
});

// -- parseArgs.
test('parseArgs: flags + a --phase value', () => {
  assert.deepStrictEqual(parseArgs(['--check']), { json: false, allowUnbumped: false, phase: null, phaseError: null });
  assert.deepStrictEqual(parseArgs(['--phase', 'v3.9', '--json']), { json: true, allowUnbumped: false, phase: 'v3.9', phaseError: null });
  assert.strictEqual(parseArgs(['--phase', 'v3.9', '--allow-unbumped']).allowUnbumped, true);
});
test('parseArgs: --phase with no value (or a flag as value) -> phaseError', () => {
  assert.ok(parseArgs(['--phase']).phaseError);
  assert.ok(parseArgs(['--phase', '--json']).phaseError);
});
test('parseArgs: --allow-unbumped without --phase -> phaseError (no silent --check; VALIDATE NIT)', () => {
  assert.ok(parseArgs(['--allow-unbumped']).phaseError, 'misuse fails loud');
  assert.strictEqual(parseArgs(['--phase', 'v3.9', '--allow-unbumped']).phaseError, null, 'allowed WITH --phase');
});

// -- LIVE-repo regex pinning (architect #8): the gate must NOT fail-RED on a correct
// repo. Pin every HARD regex against the actual current bytes + assert internal
// consistency. Branch-independent: asserts the SHAPE (X.Y) + ok, never a literal version.
test('LIVE: every HARD surface extracts from the real repo + all surfaces are consistent', () => {
  const extracted = SURFACES.map((s) => extractSurface(s, REPO_ROOT));
  for (const s of extracted) {
    if (s.hard) assert.ok(s.version, `HARD surface ${s.name} did not extract from the live ${s.file} -- regex drift`);
  }
  const r = checkReleaseSurface(REPO_ROOT, {});
  assert.strictEqual(r.ok, true, `live repo surfaces are not internally consistent: ${r.errors.join('; ')}`);
  assert.ok(/^\d+\.\d+$/.test(r.common || ''), 'common version is a MAJOR.MINOR string');
});
test('LIVE: --phase against the repo\'s OWN current version passes', () => {
  const common = checkReleaseSurface(REPO_ROOT, {}).common;
  const r = checkReleaseSurface(REPO_ROOT, { phase: common });
  assert.strictEqual(r.ok, true, `closing the repo's own version ${common} should pass: ${r.errors.join('; ')}`);
});

process.stdout.write(`\nvalidate-release-surface.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
