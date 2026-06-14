#!/usr/bin/env node

// scripts/validate-release-surface.js
//
// Release-version surface integrity gate. The plugin's user-facing version is
// repeated across FOUR files; they must agree, and at a phase close they must
// name the phase being shipped. This validator makes a drifted or un-bumped
// surface a deterministic FAIL instead of a "still says 3.8" surprise weeks later.
//
// WHY THIS EXISTS: the version surface went stale at the v3.7 and v3.8 phase
// boundaries (the phase changed shipped code but the release commit that bumps
// the surface was missed at close and only added in a follow-up), and the v3.9
// boundary surfaced the same class from the user side ("I updated but it still
// says 3.8"). MEMORY states the intended invariant -- "a phase-close = sign-off
// + EMPIRICAL TRIPLE + RELEASE-SURFACE bump" -- but nothing enforced it. This is
// that enforcement: deterministic, two modes, fail-closed on the version number.
//
// THE RELEASE-VERSION SURFACE (the bump-together set; the v3.8.0 release commit
// 30d642e is the canonical template):
//   1. .claude-plugin/plugin.json   "version": "X.Y.Z"            (HARD)
//   2. README.md plugin badge       plugin_X.Y.Z-orange          (HARD)
//   3. README.md substrate badge    badge/substrate-vX.Y(...)    (HARD; descriptor ignored)
//   4. README.md status prose       now at **vX.Y.Z**            (SOFT; reword-tolerant)
//   5. CHANGELOG.md top entry        ## [X.Y.Z]                   (HARD; tolerates a leading [Unreleased])
//   6. docs/ARCHITECTURE.md          merged tree as of **vX.Y**   (HARD; minimal anchor)
//
// WHAT IS *NOT* A VERSION SURFACE (so a future reader does not "discover" a gap):
//   - docs/SIGNPOST.md carries per-module phase stamps but is owned by Test 121
//     (generate-signpost --check); double-owning it here would blur the boundary.
//   - .claude-plugin/marketplace.json has NO version field (name/source/tags only).
//   - docs/ROADMAP.md carries phase markers but is the RECORD surface, not a
//     release-version surface.
//
// FAIL-CLOSED on the NUMBER, REWORD-TOLERANT on the PROSE: a HARD surface whose
// version token is not found is a FAIL (a swallowed/absent match must not read as
// GREEN -- the W4 lesson). A SOFT surface (the status prose, the most reword-prone)
// only WARNS if its phrasing changed -- but if it IS present and DISAGREES it is
// still caught by the consistency check. We fail on the checked value, never on the
// descriptive wording around it.
//
// Modes:
//   --check               consistency only (phase-independent): all surfaces agree
//                         on MAJOR.MINOR. The always-on pre-push / CI drift gate
//                         (Test 124). Catches a PARTIAL bump (plugin.json moved,
//                         README forgotten) on every push.
//   --phase <id>          consistency AND the common MAJOR.MINOR == the phase being
//                         closed (id like v3.9 / 3.9 / 3.9.0). The /phase-close
//                         gating step. Catches "closed v3.N but the surface still
//                         reads 3.(N-1)".
//   --allow-unbumped      with --phase: the rare docs/process-only phase that ships
//                         no user-relevant change -- assert consistency but SKIP the
//                         phase-equality requirement (the explicit human override).
//   --json                machine-readable output.
//
// Exit 0 = clean; exit 1 = drift / mismatch / missing hard token / usage error.

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

// Each surface captures MAJOR (group 1) + MINOR (group 2). `hard:false` => a
// missing match warns instead of failing (reword-tolerant prose). A present-but-
// disagreeing value is caught by the consistency check regardless of `hard`.
const SURFACES = [
  { name: 'plugin.json:version', file: '.claude-plugin/plugin.json', re: /"version":\s*"(\d+)\.(\d+)\.\d+/, hard: true },
  { name: 'README:plugin-badge', file: 'README.md', re: /plugin_(\d+)\.(\d+)\.\d+-orange/, hard: true },
  { name: 'README:substrate-badge', file: 'README.md', re: /badge\/substrate-v(\d+)\.(\d+)/, hard: true },
  { name: 'README:now-at-prose', file: 'README.md', re: /now at \*\*v(\d+)\.(\d+)\.\d+\*\*/, hard: false },
  // First `## [X.Y.Z]` heading; a leading `## [Unreleased]` does not match the
  // semver shape, so it is skipped (the architect-flagged Keep-a-Changelog case).
  { name: 'CHANGELOG:top-entry', file: 'CHANGELOG.md', re: /^##\s*\[(\d+)\.(\d+)\.\d+\]/m, hard: true },
  { name: 'ARCHITECTURE:watermark', file: 'docs/ARCHITECTURE.md', re: /as of \*\*v(\d+)\.(\d+)/, hard: true },
];

/**
 * Read one surface and extract its MAJOR.MINOR via the surface regex.
 * @param {{name:string,file:string,re:RegExp,hard:boolean}} surface
 * @param {string} repoRoot
 * @returns {{name:string,file:string,hard:boolean,version:string|null,error:string|null}}
 */
function extractSurface(surface, repoRoot) {
  const abs = path.join(repoRoot, surface.file);
  let content;
  try {
    content = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    return { name: surface.name, file: surface.file, hard: surface.hard, version: null, error: `read-failed: ${e.code || e.message}` };
  }
  const m = content.match(surface.re);
  if (!m) return { name: surface.name, file: surface.file, hard: surface.hard, version: null, error: 'token-not-found' };
  return { name: surface.name, file: surface.file, hard: surface.hard, version: `${m[1]}.${m[2]}`, error: null };
}

/** Normalize a phase id (v3.9 | 3.9 | 3.9.0 | v3.9.0) to MAJOR.MINOR ('3.9'), or null. */
function normalizePhase(phase) {
  if (phase == null) return null;
  const m = String(phase).match(/v?(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}` : null;
}

/**
 * Evaluate the surfaces. Pure over the extracted-surface array.
 * @param {Array} surfaces output of SURFACES.map(extractSurface)
 * @param {{phase?:string|null, allowUnbumped?:boolean}} opts
 * @returns {{ok:boolean, common:string|null, errors:string[], warnings:string[], surfaces:Array}}
 */
function evaluate(surfaces, opts = {}) {
  const { phase = null, allowUnbumped = false } = opts;
  const errors = [];
  const warnings = [];

  // 1. HARD surfaces must be found; SOFT surfaces only warn when absent.
  for (const s of surfaces) {
    if (s.error) {
      const msg = `${s.name} (${s.file}): ${s.error}`;
      if (s.hard) errors.push(msg);
      else warnings.push(`${msg} [soft -- reword-tolerant]`);
    }
  }

  // The phase target, computed up-front so the consistency error can name it too.
  const want = phase != null ? normalizePhase(phase) : null;
  if (phase != null && !want) errors.push(`unparseable --phase '${phase}' (expected vX.Y / X.Y / X.Y.Z)`);

  // 2. Cross-surface consistency over every FOUND version (incl. soft surfaces:
  //    missing is tolerated, but present-and-wrong is not).
  const found = surfaces.filter((s) => s.version);
  const distinct = [...new Set(found.map((s) => s.version))];
  if (distinct.length > 1) {
    const detail = found.map((s) => `${s.name}=${s.version}`).join(', ');
    // When closing a phase, name the TARGET so the fix is unambiguous (the VALIDATE
    // SHOULD: a disagree+--phase failure otherwise never tells you to aim at 3.N).
    errors.push(want
      ? `surfaces disagree on version: ${detail} -- bump ALL surfaces to ${want}.x (closing phase ${want})`
      : `surfaces disagree on version: ${detail}`);
  }
  const common = distinct.length === 1 ? distinct[0] : null;

  // 3. Phase-equality (only when the surfaces ARE internally consistent).
  if (want && common && common !== want && !allowUnbumped) {
    errors.push(
      `release surface reads ${common} but closing phase ${want}: bump the release surface `
      + '(.claude-plugin/plugin.json + README badges + CHANGELOG top + docs/ARCHITECTURE.md watermark) '
      + `to ${want}.x, OR pass --allow-unbumped if this phase ships nothing user-relevant`
    );
  }

  return { ok: errors.length === 0, common, errors, warnings, surfaces };
}

/** Convenience: read + evaluate against a repo root. */
function checkReleaseSurface(repoRoot, opts = {}) {
  const extracted = SURFACES.map((s) => extractSurface(s, repoRoot));
  return evaluate(extracted, opts);
}

function parseArgs(argv) {
  const json = argv.includes('--json');
  const allowUnbumped = argv.includes('--allow-unbumped');
  const pIdx = argv.indexOf('--phase');
  let phase = null;
  let phaseError = null;
  if (pIdx >= 0) {
    const next = argv[pIdx + 1];
    if (next == null || next.startsWith('--')) phaseError = 'the --phase flag requires a value (e.g. --phase v3.9)';
    else phase = next;
  }
  // --allow-unbumped only means anything in --phase mode; misuse must fail loud, not
  // silently run as --check and ignore the flag (the VALIDATE NIT — keep it fail-closed).
  if (!phaseError && allowUnbumped && phase == null) phaseError = '--allow-unbumped requires --phase';
  return { json, allowUnbumped, phase, phaseError };
}

function main() {
  const { json, allowUnbumped, phase, phaseError } = parseArgs(process.argv.slice(2));
  if (phaseError) {
    process.stderr.write(`release-surface: ${phaseError}\n`);
    process.exit(1);
  }
  const result = checkReleaseSurface(REPO_ROOT, { phase, allowUnbumped });
  if (json) {
    process.stdout.write(JSON.stringify({ mode: phase ? 'phase' : 'check', phase: phase || null, ...result }, null, 2) + '\n');
  } else {
    const modeLabel = phase ? `--phase ${phase}` : '--check';
    if (result.ok) {
      const v = result.common || 'unknown';
      process.stdout.write(`release-surface: clean (${modeLabel}; all surfaces at v${v})\n`);
      for (const w of result.warnings) process.stdout.write(`  warn: ${w}\n`);
    } else {
      process.stdout.write(`release-surface: ${result.errors.length} issue(s) (${modeLabel}):\n`);
      for (const e of result.errors) process.stdout.write(`  FAIL: ${e}\n`);
      for (const w of result.warnings) process.stdout.write(`  warn: ${w}\n`);
    }
  }
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) main();

module.exports = { SURFACES, extractSurface, normalizePhase, evaluate, checkReleaseSurface, parseArgs, REPO_ROOT };
