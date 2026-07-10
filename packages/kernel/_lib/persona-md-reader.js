'use strict';

// packages/kernel/_lib/persona-md-reader.js
//
// @loom-layer: kernel
//
// Persona .md reader — relocated kernel-side from
// runtime/orchestration/identity/lifecycle-spawn.js per RFC
// packages/specs/research/2026-07-10-layer-lint-vacuous-kernel-runtime-coupling.md
// (finding #19, Option A).
//
// WHY IT LIVES HERE: contract-verifier.js (kernel) needs a persona's .md content
// to feed the SynthId content-hash (`agent_md_hash`). The SynthId primitives
// (computeContentHash / validateSuffix / parseSynthId) already live kernel-side in
// _lib/synthid.js; only this 6-line reader was stranded runtime-side, which forced
// contract-verifier into a dynamically-composed absolute
// `require(path.join(findToolkitRoot(),'packages','runtime',...))` — the one real
// kernel->runtime IMPORT edge, and one the K12 layer-lint could not see (ADR-0008
// "kernel has zero workspace deps"). Relocating it makes the require-graph genuinely
// acyclic: contract-verifier imports this SAME-layer; lifecycle-spawn re-imports it
// INWARD (runtime->kernel, a legal edge). It reads a runtime DATA file by path (not a
// code import), which is an accepted data-location coupling, not a Dependency-Rule
// violation.
//
// Kept a PURE separate module (NOT folded into synthid.js) so synthid.js stays
// side-effect-free — no fs — preserving its testability (SRP; RFC open-question 3).

const fs = require('fs');
const path = require('path');
const { findToolkitRoot } = require('./toolkit-root');
const { isSafePathSegment } = require('./path-canonicalize.js');

/**
 * Read a persona's .md brief. Returns its text, or null if absent/unreadable
 * (the SynthId hash then falls back to `agent_md_hash: null`, preserving existing
 * SynthId values for personas without a .md file). Relocated from
 * lifecycle-spawn.js `_readPersonaMd`.
 *
 * Two HARDENING DELTAS vs the pre-relocation runtime version (kernel-side placement
 * warrants both; the read logic is otherwise identical):
 *   1. `persona` is gated by isSafePathSegment before it reaches path.join. The old
 *      code did `path.join(base, `${persona}.md`)` with no guard, so a `persona` of
 *      `../secret` traversed out of the personas dir and read any `.md`-suffixed file
 *      the process could reach (probe-confirmed). Real persona names (`04-architect`)
 *      are always safe segments; an unsafe one now returns null.
 *   2. The WHOLE body is fail-soft (try/catch), not just the readFileSync. The old
 *      caller wrapped the entire lookup in an outer try/catch; findToolkitRoot() can
 *      throw (e.g. HOME unset in a minimal container), which would otherwise now
 *      propagate and crash contract-verifier. Wrapping restores that envelope.
 *
 * `HETS_PERSONAS_DIR` overrides the default location (packages/runtime/personas).
 *
 * @param {string} persona persona name (no extension, no path separators).
 * @returns {string|null}
 */
function readPersonaMd(persona) {
  try {
    if (!isSafePathSegment(persona)) return null; // no traversal out of the personas dir.
    const personasBase = process.env.HETS_PERSONAS_DIR ||
      path.join(findToolkitRoot(), 'packages', 'runtime', 'personas');
    const fp = path.join(personasBase, `${persona}.md`);
    return fs.readFileSync(fp, 'utf8');
  } catch {
    return null; // ANY throw (absent file, or findToolkitRoot with HOME unset) -> null.
  }
}

module.exports = { readPersonaMd };
