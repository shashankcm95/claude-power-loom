'use strict';

// kernel-algorithms-audit.js — the A4-binding gate (v3.2 K11; ENFORCING since Wave 3).
//
// A4 (v6-substrate-synthesis.md:387): "kernel scope SHALL include algorithmic
// logic. Deterministic operations live in kernel code WITH UNIT TESTS — NOT
// prose discipline or embedded pseudocode for LLM execution." A4 becomes binding
// in v3.2 where the K11 algorithm library ships.
//
// SCOPE: this gate enforces structural integrity of DECLARED algorithms (hard
// errors), an unregistered-*.js scan, and — since the Wave-3 flip
// (manifest.enforcement="error") — the planned[] watchlist as HARD errors
// (no-park-and-forget). It does NOT detect deterministic logic an author never
// declares (prose-scanning was rejected as a false-positive trap). The Wave-0→2
// WARN-first phase is historical; the live manifest is enforcing + drained.
//
// It binds on an explicit, author-maintained LEDGER
// (packages/kernel/algorithms/manifest.json) + structural integrity. It does NOT
// heuristically scan prose for "algorithm-shaped paragraphs" — that is a
// false-positive trap (legitimate prose is full of conditionals), rejected at
// design time (plan 2026-06-03-v3.2-wave0-k11-a4-gate.md). The detection rule is
// precise and deterministic: a manifest entry either resolves or it doesn't.
//
// ENFORCEMENT (manifest.enforcement): "warn" (Wave 0–2, historical) routed planned[]
// subjects to stderr warnings; "error" (the Wave-3 flip, CURRENT) routes them to
// hard errors. The flip was a DATA change, not a code edit — both modes are
// implemented below. Structural integrity is ERROR in both modes (false-positive-
// free; the manifest is authored clean).
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
  // Strip comments BEFORE matching (GH #229): a declared name appearing ONLY inside
  // a comment in the export block (e.g. `// fooFn exported below`) must NOT count as
  // exported — the bare regex would otherwise false-pass on it.
  const noComments = String(src)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')  // block comments
    .replace(/\/\/[^\n]*/g, ' ');       // line comments
  const m = /module\.exports\s*=\s*\{([\s\S]*?)\}/.exec(noComments);
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
      // The export block MUST be a FLAT identifier list (the README convention):
      // whitespace, commas, and identifier chars only. ANYTHING else — a nested `{`,
      // a `key: value`, a string/template value — means the non-greedy exportBlock
      // can't be trusted to have parsed the real top-level exports (it truncates at the
      // first `}`, hiding or mis-reading names = false-pass). Reject non-flat blocks
      // outright rather than mis-parse them (GH #229; closes the nested-literal AND the
      // string/template-value false-positive the bare comment-strip would mishandle).
      if (block !== null && !/^[\s,A-Za-z0-9_$]*$/.test(block)) {
        errs.push(finding('algorithm-export-nonflat',
          `algorithm "${algo.id}" module.exports is not a FLAT identifier list (nested object, key:value, or string/template value detected) — the convention requires \`module.exports = { a, b, c }\``,
          { id: algo.id, fix: 'Flatten the export object to a comma-separated identifier list; move computed/nested values out of the export literal (or upgrade exportBlock to a real parse and relax the convention together).' }));
      }
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

// ---------- unregistered-file scan (flag-unless-allowlisted) ----------

// Non-algorithm files legitimately allowed alongside the registered *.js algorithms.
const NON_ALGORITHM_ALLOWLIST = new Set(['manifest.json', 'README.md']);

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
  // FLAG-UNLESS-ALLOWLISTED + TYPE-CHECK (GH #229): the prior `!name.endsWith('.js') →
  // skip` silently allowed .mjs/.cjs, subdirectory names, and symlinks to evade the
  // "no unregistered code" gate. Now: skip dotfiles + the known non-algorithm files;
  // reject by TYPE any symlink or subdirectory (the lstat is what closes a `.js`-NAMED
  // symlink — a name-only check would treat it as the registered algorithm and read its
  // target); then require a registered, regular-file *.js. NOTE: a symlink's *target*
  // escape (where it points) still needs the ContainerAdapter fs-sandbox — out of scope.
  for (const name of entries) {
    if (name.startsWith('.')) continue;              // dotfiles (.DS_Store, .gitkeep, …)
    if (NON_ALGORITHM_ALLOWLIST.has(name)) continue; // manifest.json / README.md
    let st = null;
    try { st = deps.lstatSync(path.join(dir, name)); } catch { st = null; }
    if (st && typeof st.isSymbolicLink === 'function' && st.isSymbolicLink()) {
      errs.push(finding('algorithm-unregistered',
        `symlink not allowed in ${ALGORITHMS_DIR_REL}: ${name} (algorithms must be real, flat .js files — a symlink target is unverifiable here)`,
        { file: name, fix: `Replace ${name} with the real .js file, or remove it.` }));
      continue;
    }
    if (st && typeof st.isDirectory === 'function' && st.isDirectory()) {
      errs.push(finding('algorithm-unregistered',
        `unexpected subdirectory in ${ALGORITHMS_DIR_REL}: ${name} (algorithms must be flat .js files — no subdirectories)`,
        { file: name, fix: `Flatten ${name} into registered .js algorithms, or move it out of the algorithms dir.` }));
      continue;
    }
    if (registered.has(name)) continue;              // a registered, regular-file algorithm
    errs.push(finding('algorithm-unregistered',
      `unregistered entry in ${ALGORITHMS_DIR_REL}: ${name} — only registered .js algorithms (+ manifest.json/README.md) are allowed; algorithms must be flat .js files (no subdirectories, .mjs/.cjs, or symlinks)`,
      { file: name, fix: `Register ${name} in manifest.json (with a unit test), move it to kernel/_lib if it is not an algorithm, or remove it.` }));
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
    lstatSync: fs.lstatSync,  // GH #229: type-detection (symlink/dir) in checkUnregistered
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
      `A4 watchlist: ${manifest.planned.length} pending — ${summary} (warn mode; set enforcement:"error" to make these hard errors)`,
      { count: manifest.planned.length }));
  }

  return { errors, warnings };
}

module.exports = { auditAlgorithmLibrary };
