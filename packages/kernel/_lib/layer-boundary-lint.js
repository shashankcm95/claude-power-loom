'use strict';

// packages/kernel/_lib/layer-boundary-lint.js
//
// @loom-layer: kernel
//
// K12 — Layer-boundary ADVISORY lint (v3.0-alpha, Phase-1-alpha PR 5 — final sub-PR).
//
// v6 spec anchor §2.4 (v5.1 DOWNGRADE from mandatory): the codebase is intended
// acyclic via the _lib/ extraction pattern (kb:architecture/crosscut/
// acyclic-dependencies — "a DAG can be topologically sorted"; the kernel _lib/
// sinks have high fan-in, zero outward fan). K12 is convention + advisory
// (~50-120 LoC), NOT a blocking gate. The upgrade-to-mandatory trigger is OQ-19
// (>=3 cross-layer drift events across v3.1-v3.3) — at which point the ONLY change
// is deleting `continue-on-error` from the CI job; this script already exits
// non-zero on findings, so no rework here (mechanism/policy separation — the script
// reports ground truth, the CI job sets severity).
//
// HONESTY NOTE (RFC 2026-07-10): the earlier "6 months produced ZERO observed
// cross-layer drift / acyclic-by-construction" framing was a FALSE NEGATIVE — the
// original IMPORT_RE saw only static RELATIVE requires, so it was blind to the one
// real kernel->runtime edge (a dynamically-composed absolute require in
// contract-verifier). That edge is now relocated (Option A) AND the detector was
// extended to SEE the common dynamic-absolute shapes (below). So the 0-on-main
// baseline is much better earned than before: the detector now CAN fail on the shape
// that actually occurred (proven by the dynamic-detection test) rather than being
// structurally blind to it. It is NOT a completeness claim — the blind spot was
// NARROWED, not closed (see KNOWN LIMITATIONS). And "acyclic" here scopes to the
// REQUIRE graph only: two live kernel->runtime PROCESS edges remain by design
// (contract-verifier spawns pattern-recorder; validate-adr-drift execFileSyncs
// adr.js), a separate, lower-severity coupling class the lint intentionally does not
// count.
//
// WHAT IT CHECKS (a "finding" counts toward the 0-on-main baseline):
//   1. inner-imports-outer — an INNER layer importing an OUTER layer violates the
//      Dependency Rule (kb:architecture/crosscut/dependency-rule — "source code
//      dependencies can only point inward; nothing in an inner circle can know
//      anything about an outer circle"). RANK kernel<runtime<lab<adapter;
//      src<dst = bad. OUTER->INNER (runtime->kernel) and SAME-layer imports are
//      LEGAL (no finding). Covers BOTH static relative requires (IMPORT_RE) AND
//      dynamically-composed absolute requires (DYN_ASSIGN_RE / DYN_INLINE_RE) —
//      RFC 2026-07-10. A subprocess build of a cross-layer path (spawn /
//      execFileSync) is a process boundary, NOT an import, and is not flagged.
//   2. prod-imports-tests — F23 defense-layer (b): any production file (under
//      packages/** but NOT inside a tests/ dir) importing a tests/ path. This
//      guards validateTestRecord (tests/unit/kernel/_lib/_test-validate.js) from
//      being pulled into a production code path. Must currently be ZERO.
//
// LAYER IDENTITY is PATH-PRIMARY (filesystem truth), per the §337-vs-§339 design-
// tension resolution: ZERO source files carry the `@loom-layer` marker on main
// (the only occurrences are spec prose), so counting missing-marker as a finding
// would emit ~95 findings and break the 0-on-main baseline. The marker is an
// OPTIONAL future cross-check only (a path/marker contradiction would be at most
// a non-counting NOTE); PR 5 OMITS marker parsing entirely (YAGNI — no file has a
// marker to cross-check, and mass-annotation is v3.1+ out-of-scope). Layer =
// packages/<kernel|runtime|lab|adapters>.
//
// SECURITY/SCOPE: stdlib only (fs, path) — no deps, no shell, no require.resolve,
// no fs.realpath. Fixed repo root via path.resolve(__dirname,'..','..','..'); NO
// untrusted path concatenation (CWE-22-safe). The directory walk SKIPS symlinks
// (no follow — defeats walk-loops + symlink escape, mirroring path-canonicalize.js
// fail-closed posture) and excludes node_modules, .git, swarm. The
// import-detection regex is BOUNDED (specifier <=512 chars, single char-class
// star, no nested quantifier — ReDoS-safe). Matches inside `//` line comments
// and `/* */` block-comment bodies are skipped via a suppress-only heuristic
// (isCommentedMatch) so a commented-out or doc-comment import never becomes a
// spurious advisory finding — this only ever REMOVES findings, so the 0-on-main
// baseline is preserved (verified: 12 commented edges suppressed, 0 real imports
// dropped across the workspace). ADR-0006: no lint suppressions.
//
// OUT OF SCOPE (v3.1+): mass @loom-layer annotation; the pre-commit hook (§345);
// the spawn-state.advisory_findings[] runtime emission (§344). The CI advisory job
// is wired by the orchestrator, not by this module.

const fs = require('fs');
const path = require('path');

// STAGE 0 — fixed repo root. File lives at packages/kernel/_lib/ → 3 levels up is
// the repo root. No env / argv path input, so the CWE-22 untrusted-concatenation
// surface is zero — the walk root is a constant.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// Directory basenames hard-skipped at every level of the walk. Covers
// swarm/run-state (per scope), the VCS + dependency trees, and archive dirs.
const SKIP_DIRS = new Set(['node_modules', '.git', 'swarm', '_archive']);

// Source file extensions the lint inspects for import edges.
const SOURCE_EXTS = new Set(['.js', '.mjs', '.cjs']);

// Belt-and-suspenders recursion ceiling (mirrors path-canonicalize.js's numeric
// guard). Unreachable on any real tree; defends against a pathological depth.
const MAX_WALK_DEPTH = 50;

// Inward depth ranking. Lower rank = more INNER. A finding requires
// RANK[src] < RANK[dst] (importer strictly more inner than its target).
const LAYER_RANK = Object.freeze({ kernel: 0, runtime: 1, lab: 2, adapter: 3 });

// segments[1] under `packages/` → layer name. 'adapters' (plural dir) maps to the
// 'adapter' layer; the dir need not exist yet (v3.5+) — forward-compat.
const DIR_TO_LAYER = Object.freeze({
  kernel: 'kernel', runtime: 'runtime', lab: 'lab', adapters: 'adapter',
});

// Bounded import-specifier extractor. Matches require('...') and `from '...'`
// (static ESM) for RELATIVE specifiers ONLY (group 2 anchored to start with '.').
// Bare/scoped/absolute specifiers can never resolve to a sibling-layer source
// file, so they are deliberately not captured. ReDoS-safe: one char-class star
// with a fixed {0,512} upper bound, no nested quantifier, the class excludes the
// quote + newline so it cannot run away across lines.
const IMPORT_RE = /(?:require\(\s*|from\s+)(['"])(\.[^'"\n]{0,512})\1/g;

// --- Dynamic cross-layer require detection (RFC 2026-07-10) -------------------
// IMPORT_RE above sees only static RELATIVE string-literal specifiers. A file that
// reaches another layer via a DYNAMICALLY-composed ABSOLUTE path was invisible,
// which made the 0-on-main baseline a false negative (the one real kernel->runtime
// import was a require of path-dot-join(findToolkitRoot(), 'packages', 'runtime', ...)).
// These two bounded heuristics restore detection with no AST and no new dependency:
//   Form 1 (assign-then-require): const IDENT = path.join|resolve(...,'packages',
//     '<layer>',...) with an uncommented require(IDENT) within REQUIRE_WINDOW chars.
//   Form 2 (inline): require(path.join|resolve(...,'packages','<layer>',...)).
// The <layer> may be split ('packages','runtime') or combined ('packages/runtime'),
// and the call may span multiple lines. The captured <layer> literal is the dst
// layer; the SAME LAYER_RANK[src] < LAYER_RANK[dst] gate as the static path decides a
// finding. A subprocess build of the same path (child_process.spawn / execFileSync)
// is NOT a require and is deliberately NOT flagged: a process boundary is a
// control-flow edge, not a source-import edge (a distinct, lower-severity coupling
// class; RFC scope-guard). ReDoS-safe: bounded lazy spans ({0,200}?) terminated by a
// literal, single char-classes, no nested quantifiers.
//
// KNOWN LIMITATIONS (this is an ADVISORY tripwire for ACCIDENTAL cross-layer drift in
// ordinary code shapes, NOT a security boundary — a determined author can evade any
// non-AST detector). Not covered, by design (would need data-flow / AST, YAGNI here):
// a COMPUTED layer name (path.join(root,'packages',layerVar)); a layer assembled by
// STRING CONCATENATION ('run'+'time'); a path returned by a HELPER function; a require
// whose confirming call is >REQUIRE_WINDOW chars from the path assignment. These are
// disclosed rather than silently missed; the honest posture is "covers the shapes that
// occur in ordinary code", not "sees every possible cross-layer require".
// A cross-layer path segment, in either the split form ('packages', 'runtime') or
// the combined form ('packages/runtime'). Group 1 is the dst layer.
const _PKG_LAYER = "['\"]packages(?:['\"]\\s*,\\s*['\"]|/)(kernel|runtime|lab|adapters)";
// [^;]{0,200}? (not [^;\\n]) so a MULTI-LINE path.join(...) call is still seen; the
// bound + the ; exclusion keep the span inside a single statement's arguments.
const DYN_ASSIGN_RE = new RegExp(
  `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*path\\.(?:join|resolve)\\(\\s*[^;]{0,200}?${_PKG_LAYER}`,
  'g',
);
const DYN_INLINE_RE = new RegExp(
  `require\\(\\s*path\\.(?:join|resolve)\\(\\s*[^;]{0,200}?${_PKG_LAYER}`,
  'g',
);
// Forward window (chars after the assignment) within which the built identifier must
// be require'd for Form 1 to count it — bounds the assign-then-require confirmation so
// an unrelated same-named identifier require'd far away in the file cannot satisfy it.
const REQUIRE_WINDOW = 300;

/**
 * Recursively enumerate source files (.js/.mjs/.cjs) under `root`, skipping
 * SKIP_DIRS and symlinks. Fail-soft: an unreadable/vanished dir is skipped, never
 * thrown (an advisory tool must not crash the CI step on a permission quirk).
 *
 * @param {string} root absolute directory to walk.
 * @returns {string[]} absolute file paths.
 */
function enumerateSourceFiles(root) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > MAX_WALK_DEPTH) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // EACCES / ENOENT mid-walk → skip this subtree.
    }
    for (const ent of entries) {
      if (ent.isSymbolicLink()) continue; // never follow — loop + escape guard.
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) walk(abs, depth + 1);
      } else if (ent.isFile() && SOURCE_EXTS.has(path.extname(ent.name))) {
        out.push(abs);
      }
    }
  };
  walk(root, 0);
  return out;
}

/**
 * Path-primary layer identity. `packages/<layer>/...` → layer name, else null
 * (unclassified — never a finding). Operates on the path STRING, so a target
 * specifier missing its extension still maps (the `packages/<layer>` segments are
 * present regardless of extension).
 *
 * @param {string} absPath absolute file path.
 * @param {string} root repo root.
 * @returns {('kernel'|'runtime'|'lab'|'adapter'|null)}
 */
function layerOfPath(absPath, root) {
  const rel = path.relative(root, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null; // outside the tree.
  const segments = rel.split(path.sep);
  if (segments[0] !== 'packages') return null;
  return DIR_TO_LAYER[segments[1]] || null;
}

/**
 * True iff any path segment equals `tests` (the lexical marker of a tests/ tree).
 * Extension-insensitive — works on a resolved specifier with or without `.js`.
 *
 * @param {string} absPath
 * @returns {boolean}
 */
function isTestsPath(absPath) {
  return absPath.split(path.sep).includes('tests');
}

/**
 * True iff `absPath` is a PRODUCTION file: under `packages/**` AND not inside a
 * tests/ dir. Used as the source-side gate for the prod-imports-tests finding.
 *
 * Segment-ANYWHERE membership (vs layerOfPath's position-anchored
 * segments[0]==='packages') is intentional and safe here: the only paths
 * reaching this predicate are the walk's own enumerated source files, and the
 * walk already hard-skips node_modules (the only place a non-canonical
 * `.../packages/...` segment could appear). It therefore cannot misclassify a
 * dependency's vendored `packages` dir as production.
 *
 * @param {string} absPath
 * @returns {boolean}
 */
function isProductionFile(absPath) {
  return absPath.split(path.sep).includes('packages') && !isTestsPath(absPath);
}

/**
 * True iff the IMPORT_RE match at `matchIndex` falls inside a comment. A non-AST,
 * suppress-only heuristic (KISS — full AST parsing is YAGNI for an advisory
 * tool): the match is treated as commented when its line's trimmed start is a
 * double-slash line comment or a leading asterisk (a JSDoc / block-comment body
 * line), OR the text preceding the match on its line already contains a
 * double-slash (a trailing line comment after real code).
 *
 * This NEVER adds a finding — it only suppresses matches that are commented-out
 * imports or doc-comment examples (verified zero real-import false-negatives
 * across the workspace), so the 0-on-main baseline is preserved by construction
 * while the forward-looking false-positive surface (a future kernel doc-comment
 * that quotes a cross-layer require example) is closed.
 *
 * @param {string} fileText
 * @param {number} matchIndex IMPORT_RE match offset into fileText.
 * @returns {boolean}
 */
const LINE_COMMENT = '//';
function isCommentedMatch(fileText, matchIndex) {
  const lineStart = fileText.lastIndexOf('\n', matchIndex - 1) + 1;
  const before = fileText.slice(lineStart, matchIndex);
  if (before.includes(LINE_COMMENT)) return true; // leading OR trailing comment.
  const nl = fileText.indexOf('\n', matchIndex);
  const line = fileText.slice(lineStart, nl === -1 ? fileText.length : nl);
  const trimmed = line.trimStart();
  // Leading '//' line comment, or a '*' block-comment body line.
  return trimmed.startsWith(LINE_COMMENT) || trimmed.startsWith('*');
}

/**
 * Extract relative import specifiers from file text via the bounded IMPORT_RE,
 * skipping matches inside line/block comments (see isCommentedMatch). Returns
 * capture group 2 (the specifier string) for every non-commented match.
 *
 * @param {string} fileText
 * @returns {string[]}
 */
function extractImportSpecifiers(fileText) {
  const specs = [];
  IMPORT_RE.lastIndex = 0; // reset shared global-flag regex state per call.
  let m;
  while ((m = IMPORT_RE.exec(fileText)) !== null) {
    if (isCommentedMatch(fileText, m.index)) continue;
    specs.push(m[2]);
  }
  return specs;
}

/**
 * True iff `ident` is passed to an uncommented `require(<ident>)` somewhere in
 * `fileText`. Confirms that a dynamically-built path is actually IMPORTED, vs fed
 * to a subprocess builder (spawn / execFileSync) — which is not a source edge.
 *
 * @param {string} fileText
 * @param {string} ident identifier (captured by [A-Za-z_$][\w$]*; only `$` is
 *   regex-special, so it is escaped before interpolation).
 * @param {number} [fromIndex] start of the search range (default 0).
 * @param {number} [toIndex] end of the search range (default end of file).
 * @returns {boolean}
 */
function isRequiredIdentifier(fileText, ident, fromIndex, toIndex) {
  const safeIdent = ident.replace(/\$/g, '\\$'); // `$` is a regex anchor, not a literal.
  const re = new RegExp(`require\\(\\s*${safeIdent}\\s*\\)`, 'g');
  re.lastIndex = fromIndex || 0;
  const end = toIndex == null ? fileText.length : toIndex;
  let m;
  while ((m = re.exec(fileText)) !== null) {
    if (m.index >= end) break;
    if (!isCommentedMatch(fileText, m.index)) return true;
  }
  return false;
}

/**
 * Extract the dst layer names reached by a DYNAMICALLY-composed absolute
 * cross-layer require (DYN_ASSIGN_RE + DYN_INLINE_RE; see the header note near
 * IMPORT_RE). Returns layer names only — the caller applies the inner<outer rank
 * gate. Comment matches are suppressed via isCommentedMatch, so this only ever
 * ADDS a real dynamic edge, never a doc-comment example.
 *
 * @param {string} fileText
 * @returns {string[]} dst layer names (may repeat).
 */
function extractDynamicCrossLayerTargets(fileText) {
  const dstLayers = [];
  DYN_ASSIGN_RE.lastIndex = 0;
  let m;
  while ((m = DYN_ASSIGN_RE.exec(fileText)) !== null) {
    if (isCommentedMatch(fileText, m.index)) continue;
    const dst = DIR_TO_LAYER[m[2]];
    // Confirm the built path is REQUIRE'd (not fed to a subprocess) within a bounded
    // FORWARD window — the real shape is assign-then-require on the next lines.
    const from = m.index;
    const to = m.index + m[0].length + REQUIRE_WINDOW;
    if (dst && isRequiredIdentifier(fileText, m[1], from, to)) dstLayers.push(dst);
  }
  DYN_INLINE_RE.lastIndex = 0;
  while ((m = DYN_INLINE_RE.exec(fileText)) !== null) {
    if (isCommentedMatch(fileText, m.index)) continue;
    const dst = DIR_TO_LAYER[m[1]];
    if (dst) dstLayers.push(dst);
  }
  return dstLayers;
}

/**
 * Read + classify one file's import edges into Findings. Pure path-string
 * resolution (path.resolve) — no fs.realpath / require.resolve (no disk touch, no
 * symlink follow, no module execution). Fail-soft on an unreadable file.
 *
 * @param {string} absPath absolute file path.
 * @param {string} root repo root.
 * @returns {Array<object>} findings for this file.
 */
function analyzeFile(absPath, root) {
  let text;
  try {
    text = fs.readFileSync(absPath, 'utf8');
  } catch {
    return []; // unreadable mid-scan → no findings (fail-soft).
  }
  const relFile = path.relative(root, absPath);
  const srcLayer = layerOfPath(absPath, root);
  const isProd = isProductionFile(absPath);
  const findings = [];
  for (const spec of extractImportSpecifiers(text)) {
    const targetAbs = path.resolve(path.dirname(absPath), spec);
    if (isProd && isTestsPath(targetAbs)) {
      findings.push({
        kind: 'prod-imports-tests',
        file: relFile, specifier: spec, targetRel: path.relative(root, targetAbs),
      });
    }
    const dstLayer = layerOfPath(targetAbs, root);
    if (srcLayer && dstLayer && LAYER_RANK[srcLayer] < LAYER_RANK[dstLayer]) {
      findings.push({
        kind: 'inner-imports-outer',
        file: relFile, specifier: spec, srcLayer, dstLayer,
      });
    }
  }
  // Dynamically-composed absolute cross-layer require edges — the class the static
  // IMPORT_RE cannot see (RFC 2026-07-10). Same inner<outer rank gate.
  if (srcLayer) {
    for (const dstLayer of extractDynamicCrossLayerTargets(text)) {
      if (LAYER_RANK[srcLayer] < LAYER_RANK[dstLayer]) {
        findings.push({
          kind: 'inner-imports-outer',
          file: relFile,
          specifier: `(dynamic require -> packages/${dstLayer}/...)`,
          srcLayer, dstLayer,
        });
      }
    }
  }
  return findings;
}

/**
 * Run the lint over the whole workspace. Aggregates findings across all source
 * files. `notes` is the forward-compat seam for the §337 missing-marker advisory
 * tier (OQ-19); PR 5 ships it EMPTY (YAGNI) — it NEVER feeds the exit code.
 *
 * @param {string} [root] repo root (defaults to REPO_ROOT).
 * @returns {{findings: Array<object>, notes: Array<object>}}
 */
function lint(root = REPO_ROOT) {
  // Sort the file list so the findings order is byte-identical across OSes
  // (readdir yields inode/insertion order — ext4 vs HFS+ differ); CI advisory
  // logs from different runners then diff cleanly. Pure presentation — does not
  // affect findings.length or the exit code.
  const findings = enumerateSourceFiles(root)
    .sort()
    .flatMap((abs) => analyzeFile(abs, root));
  return { findings, notes: [] };
}

/**
 * Format one finding as a stable, grep-friendly single line.
 *
 * @param {object} f
 * @returns {string}
 */
function formatFinding(f) {
  const detail = f.kind === 'prod-imports-tests'
    ? `tests-path=${f.targetRel}`
    : `${f.srcLayer}->${f.dstLayer}`;
  return `[layer-lint] ${f.kind} ${f.file} -> ${f.specifier} (${detail})`;
}

// CLI runner — guarded so importing the module (e.g. from a test) never calls
// process.exit (a bare top-level exit would kill the test runner). The script
// exits 1 on any finding (ground truth); the CI job's `continue-on-error: true`
// is the entire non-blocking ADVISORY mechanism (OQ-19 upgrade = delete that one
// line; this exit logic is already correct).
if (require.main === module) {
  const { findings } = lint();
  for (const f of findings) {
    process.stdout.write(`${formatFinding(f)}\n`);
  }
  process.stdout.write(`[layer-lint] ${findings.length} finding(s)\n`);
  process.exit(findings.length > 0 ? 1 : 0);
}

module.exports = {
  lint,
  enumerateSourceFiles,
  layerOfPath,
  isTestsPath,
  isProductionFile,
  extractImportSpecifiers,
  analyzeFile,
  formatFinding,
  LAYER_RANK,
};
