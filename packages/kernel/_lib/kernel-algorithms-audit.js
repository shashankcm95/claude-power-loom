'use strict';

// kernel-algorithms-audit.js — the A4-binding gate (v3.2 Wave 0 / K11).
//
// A4 (v6-substrate-synthesis.md:387): "kernel scope SHALL include algorithmic
// logic. Deterministic operations live in kernel code WITH UNIT TESTS — NOT
// prose discipline or embedded pseudocode for LLM execution." A4 becomes binding
// in v3.2 where the K11 algorithm library ships.
//
// SCOPE (v3.2 Wave 0): this is the A4-binding SCAFFOLD, not full A4 enforcement.
// It enforces structural integrity of DECLARED algorithms now (hard errors) and
// WARNs on a tracked planned[] watchlist; it does NOT detect deterministic logic
// an author never declares. Full enforcement (the watchlist flipping to errors)
// is Wave 3.
//
// It binds on an explicit, author-maintained LEDGER
// (packages/kernel/algorithms/manifest.json) + structural integrity. It does NOT
// heuristically scan prose for "algorithm-shaped paragraphs" — that is a
// false-positive trap (legitimate prose is full of conditionals), rejected at
// design time (plan 2026-06-03-v3.2-wave0-k11-a4-gate.md). The detection rule is
// precise and deterministic: a manifest entry either resolves or it doesn't.
//
// WARN-FIRST (manifest.enforcement="warn"): the A4 "teeth" — planned[] subjects
// not yet kernelized — are stderr warnings at Wave 0. The Wave-3 flip is a DATA
// change (enforcement="error"), routing the watchlist into hard errors. Structural
// integrity is ERROR from day one (false-positive-free; the manifest is authored
// clean).
//
// Export checks use STATIC SOURCE ANALYSIS — the gate never require()s an
// algorithm module (closes module-scope side-effect / require-cache / DoS surface
// for future R9/R11 modules; code-reviewer F1). The convention (algorithms/
// README.md) mandates the `module.exports = { … }` object-literal form, module-
// scope purity, and CLI-only-under-`require.main === module`, so the static check
// is sufficient.
//
// Pure + injectable: no process.exit, no module-scope I/O. `deps`
// (existsSync/readFileSync/readdirSync) are injectable for fixture-free testing
// (Dependency Inversion). The contracts-validate `kernel-algorithm-a4-binding`
// validator is a thin adapter over this function (runtime→kernel; legal).

const fs = require('fs');
const path = require('path');
const { findToolkitRoot } = require('./toolkit-root');

const ALGORITHMS_DIR_REL = 'packages/kernel/algorithms';
const MANIFEST_REL = path.join(ALGORITHMS_DIR_REL, 'manifest.json');
const VALID_ENFORCEMENT = new Set(['warn', 'error']);

// The two arrays have DIFFERENT required-field sets (architect I-4): a `planned`
// entry is declared intent with no file/exports/test yet.
const ALGORITHM_REQUIRED_FIELDS = ['id', 'file', 'exports', 'test', 'kind', 'summary'];
const ALGORITHM_STRING_FIELDS = ['id', 'file', 'test', 'kind', 'summary']; // exports is an array
const PLANNED_REQUIRED_FIELDS = ['id', 'owner', 'wave', 'note'];
const PLANNED_STRING_FIELDS = ['id', 'owner', 'note']; // wave is a number

function finding(kind, message, extra) {
  return { kind, message, ...(extra || {}) };
}

// ---------- static export analysis ----------

// Extract the body of the FIRST `module.exports = { … }` object literal, or null
// if the module does not use the object-literal export form (a convention
// violation, surfaced as algorithm-export-missing).
//
// NON-GREEDY by design: it captures up to the first `}`. This assumes a FLAT
// export object (a comma-separated identifier list) — the form the README
// convention MANDATES ("export objects must be flat — no nested object literals
// as values"). A nested value like `module.exports = { fn, opts: { … } }` would
// truncate the block at the inner `}` and spuriously flag later names as missing;
// the flat-export convention is what guards against that (code-reviewer MEDIUM).
// If a future algorithm genuinely needs nested export values, upgrade this to a
// depth-counting brace scan AND relax the convention together.
function exportBlock(src) {
  const m = /module\.exports\s*=\s*\{([\s\S]*?)\}/.exec(src);
  return m ? m[1] : null;
}

function blockHasName(block, name) {
  const esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // identifier boundary that also respects `$` (lookarounds; Node ≥12)
  return new RegExp(`(?<![\\w$])${esc}(?![\\w$])`).test(block);
}

// ---------- schema ----------

function validateSchema(manifest) {
  const errs = [];
  const bad = (msg) => errs.push(finding('manifest-schema-invalid', msg, {
    fix: 'See packages/kernel/algorithms/README.md for the manifest schema.',
  }));

  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    bad('manifest must be a JSON object');
    return errs; // nothing else is trustworthy
  }
  if (typeof manifest.version !== 'number') bad('manifest.version must be a number');
  if (typeof manifest.enforcement !== 'string' || !VALID_ENFORCEMENT.has(manifest.enforcement)) {
    bad(`manifest.enforcement must be one of warn|error (got ${JSON.stringify(manifest.enforcement)})`);
  }
  if (!Array.isArray(manifest.algorithms)) bad('manifest.algorithms must be an array');
  if (!Array.isArray(manifest.planned)) bad('manifest.planned must be an array');

  if (Array.isArray(manifest.algorithms)) {
    manifest.algorithms.forEach((a, i) => {
      if (a === null || typeof a !== 'object' || Array.isArray(a)) { bad(`algorithms[${i}] must be an object`); return; }
      const id = a.id != null ? a.id : '?';
      for (const f of ALGORITHM_REQUIRED_FIELDS) {
        if (!(f in a)) { bad(`algorithms[${i}] (id=${id}) missing required field "${f}"`); continue; }
        // type-check string fields so a non-string never reaches path.join (which
        // throws an unhandled TypeError, breaking the {errors,warnings} contract).
        if (ALGORITHM_STRING_FIELDS.includes(f) && typeof a[f] !== 'string') {
          bad(`algorithms[${i}] (id=${id}).${f} must be a string (got ${typeof a[f]})`);
        }
      }
      if ('exports' in a) {
        if (!Array.isArray(a.exports)) bad(`algorithms[${i}] (id=${id}).exports must be an array`);
        else if (a.exports.length === 0) bad(`algorithms[${i}] (id=${id}).exports must declare at least one exported name`);
        else if (!a.exports.every((x) => typeof x === 'string')) bad(`algorithms[${i}] (id=${id}).exports must be an array of strings`);
      }
    });
  }
  if (Array.isArray(manifest.planned)) {
    manifest.planned.forEach((p, i) => {
      if (p === null || typeof p !== 'object' || Array.isArray(p)) { bad(`planned[${i}] must be an object`); return; }
      const id = p.id != null ? p.id : '?';
      for (const f of PLANNED_REQUIRED_FIELDS) {
        if (!(f in p)) { bad(`planned[${i}] (id=${id}) missing required field "${f}"`); continue; }
        if (PLANNED_STRING_FIELDS.includes(f) && typeof p[f] !== 'string') {
          bad(`planned[${i}] (id=${id}).${f} must be a string (got ${typeof p[f]})`);
        }
      }
      if ('wave' in p && typeof p.wave !== 'number') bad(`planned[${i}] (id=${id}).wave must be a number`);
    });
  }
  return errs;
}

// ---------- integrity (algorithms[] entries only) ----------

function checkAlgorithmIntegrity(algo, rootDir, deps) {
  const errs = [];
  const filePath = path.join(rootDir, ALGORITHMS_DIR_REL, algo.file);

  if (!deps.existsSync(filePath)) {
    errs.push(finding('algorithm-file-missing',
      `algorithm "${algo.id}" file not found: ${ALGORITHMS_DIR_REL}/${algo.file}`,
      { id: algo.id, fix: `Create ${algo.file} or fix the manifest path.` }));
  } else {
    let src = null;
    try {
      src = deps.readFileSync(filePath, 'utf8');
    } catch (e) {
      errs.push(finding('algorithm-source-unreadable',
        `algorithm "${algo.id}" source unreadable: ${e.message}`, { id: algo.id }));
    }
    if (src !== null) {
      const block = exportBlock(src);
      const missing = (Array.isArray(algo.exports) ? algo.exports : [])
        .filter((name) => !(block && blockHasName(block, name)));
      if (missing.length > 0) {
        errs.push(finding('algorithm-export-missing',
          `algorithm "${algo.id}" does not export [${missing.join(', ')}] via a module.exports = { … } object literal`,
          { id: algo.id, missing, fix: 'Export the declared names through a module.exports object literal (convention).' }));
      }
    }
  }

  const testPath = path.join(rootDir, algo.test);
  if (!deps.existsSync(testPath)) {
    errs.push(finding('algorithm-test-missing',
      `algorithm "${algo.id}" test not found: ${algo.test}`,
      { id: algo.id, fix: `Add a unit test at ${algo.test} (A4 requires deterministic kernel code to be unit-tested).` }));
  }
  return errs;
}

// ---------- unregistered-file scan (*.js allowlist) ----------

function checkUnregistered(manifest, rootDir, deps) {
  const errs = [];
  const dir = path.join(rootDir, ALGORITHMS_DIR_REL);
  let entries;
  try {
    entries = deps.readdirSync(dir);
  } catch (e) {
    // A directory-read failure is an ENVIRONMENT error, not a ledger-schema error
    // — give it its own kind so consumers filtering by kind don't conflate the two
    // (code-reviewer MEDIUM/SRP).
    errs.push(finding('algorithm-directory-unreadable',
      `algorithms directory unreadable at ${ALGORITHMS_DIR_REL}: ${e.message}`,
      { fix: `Ensure ${ALGORITHMS_DIR_REL} exists and is readable.` }));
    return errs;
  }
  const registered = new Set(manifest.algorithms.map((a) => a.file));
  for (const name of entries) {
    if (!name.endsWith('.js')) continue; // allowlist: skips manifest.json / README.md / dotfiles (F4)
    if (!registered.has(name)) {
      errs.push(finding('algorithm-unregistered',
        `unregistered algorithm file: ${ALGORITHMS_DIR_REL}/${name} (not in manifest.algorithms)`,
        { file: name, fix: `Register ${name} in manifest.json (with a unit test), or move it to kernel/_lib if it is not an algorithm.` }));
    }
  }
  return errs;
}

// ---------- the gate ----------

/**
 * Audit the kernel algorithm library against its manifest ledger.
 * @param {object} [opts]
 * @param {string} [opts.rootDir]    repo root (default: findToolkitRoot()).
 * @param {object} [opts.manifest]   manifest override (tests / Wave-3 flip experiments). When absent, reads packages/kernel/algorithms/manifest.json.
 * @param {object} [opts.deps]       { existsSync, readFileSync, readdirSync } override (default: node fs).
 * @returns {{errors: Array, warnings: Array}} findings sharing the { kind, message, ...meta } shape.
 */
function auditAlgorithmLibrary(opts) {
  const o = opts || {};
  const rootDir = o.rootDir || findToolkitRoot();
  const deps = {
    existsSync: fs.existsSync,
    readFileSync: fs.readFileSync,
    readdirSync: fs.readdirSync,
    ...(o.deps || {}),
  };
  const errors = [];
  const warnings = [];

  // 1. Load the manifest (override wins).
  let manifest = o.manifest;
  if (manifest === undefined) {
    const manifestPath = path.join(rootDir, MANIFEST_REL);
    let raw;
    try {
      raw = deps.readFileSync(manifestPath, 'utf8');
    } catch (e) {
      errors.push(finding('manifest-schema-invalid', `manifest unreadable at ${MANIFEST_REL}: ${e.message}`,
        { fix: 'Create packages/kernel/algorithms/manifest.json.' }));
      return { errors, warnings };
    }
    try {
      manifest = JSON.parse(raw);
    } catch (e) {
      errors.push(finding('manifest-schema-invalid', `manifest is not valid JSON: ${e.message}`,
        { fix: 'Fix the JSON syntax in manifest.json.' }));
      return { errors, warnings };
    }
  }

  // 2. Schema (fail-closed: a malformed ledger can't be trusted for integrity).
  const schemaErrors = validateSchema(manifest);
  if (schemaErrors.length > 0) {
    return { errors: schemaErrors, warnings };
  }

  // 3. Integrity over realized algorithms.
  for (const algo of manifest.algorithms) {
    errors.push(...checkAlgorithmIntegrity(algo, rootDir, deps));
  }

  // 4. Unregistered *.js files.
  errors.push(...checkUnregistered(manifest, rootDir, deps));

  // 5. A4 watchlist — planned[] entries. WARN at "warn"; ERROR at "error" (the flip).
  if (manifest.enforcement === 'error') {
    for (const p of manifest.planned) {
      errors.push(finding('planned-not-realized',
        `A4 subject ${p.id} (${p.owner}, wave ${p.wave}) is not yet a kernel algorithm: ${p.note}`,
        { id: p.id, fix: `Realize ${p.id} as a tested kernel algorithm and move it from planned[] to algorithms[].` }));
    }
  } else if (manifest.planned.length > 0) {
    const summary = manifest.planned.map((p) => `${p.id}/${p.owner}`).join(', ');
    warnings.push(finding('planned-not-realized',
      `A4 watchlist: ${manifest.planned.length} pending — ${summary} (kernelize in Wave 2; flip to enforcing in Wave 3)`,
      { count: manifest.planned.length }));
  }

  return { errors, warnings };
}

module.exports = { auditAlgorithmLibrary };
