#!/usr/bin/env node

// @loom-layer: lab
//
// v3.9 W4 — the bootcamp's two closing GATES (RFC §3.4 wording-audit + §7 EC7).
// The pure predicates (auditWording / auditPath2Darkness) take TEXT/sources and are
// CI-tested; the thin CLI (require.main) reads the bootcamp tree and exits non-zero
// on a violation. Imports nothing but node stdlib for the CLI glob.
//
//  - WORDING-AUDIT (retrieval-not-weights): flag a LEARNING-CLAIM about the system
//    near a bootcamp metric, with an ALLOW-LIST so the bootcamp's OWN legitimate
//    anti-training prose ("no training", "learned_weight" [the NEGATED token], the
//    "training" contamination-tier / cutoff domain) does NOT cry wolf (VERIFY-hacker
//    H-MED-1 — an alarm that false-fires gets disabled). Plus a FALSIFIABLE clause:
//    a NET-NEW W4 field asserted as pre-existing.
//  - EC7 PATH-2-DARKNESS: ZERO recordVerdict / reputation / circuit-breaker from any
//    bootcamp module. FAIL-CLOSED BY COVERAGE (VERIFY-hacker H-HIGH-3): the CLI scans
//    attribution/ + issue-corpus/ WHOLESALE (a NEW bootcamp module is covered by
//    default) + the explicit causal-edge bootcamp files (a legacy-mixed dir). It
//    matches Path-2 imports/calls WHOLE-WORD (substring `tiebreaker` never matches)
//    AND flags any DYNAMIC require (a string-built module name is unanalyzable).

'use strict';

const fs = require('fs');
const path = require('path');

// --------------------------------------------------------------------------
// Wording-audit
// --------------------------------------------------------------------------

// A learning CLAIM about the system (the plugin/model learns/adapts/evolves/improves over runs).
const LEARNING_CLAIM = /\b(learns?|learning|trains?|trained|retrained|adapts?|evolves?|improves?\s+over\s+(?:time|runs)|gets?\s+better\s+over\s+(?:time|runs))\b/gi;
// Bootcamp metric tokens — a learning claim is only a violation when co-located with one.
const METRIC_TOKEN = /\b(pass@k|pass-at-k|friction|recall|calibrat|judge_agreement|behavioral|reference_divergence|worked_example|trajectory)\b/i;
// Allow-list contexts: the bootcamp's own legitimate uses of train/learn/adapt tokens. Each
// must MATCH THE OFFENDING TOKEN'S SPAN (not the whole line — VALIDATE-hacker M3: a
// line-level allow laundered a real "learns over time ... (no training)" claim).
const ALLOWED_CONTEXTS = [
  /no\s+training/gi,
  /learned_weight/gi,                                            // the NEGATED token (never learned_weight)
  /training[- ](?:cutoff|represented|set|data)/gi,
  /training-vs-reliable/gi,
  /(?:model|reliable[- ]knowledge|data)\s+training/gi,
];
const PROPOSED_W4_FIELDS = ['provenance', 'worked_example_ref', 'friction_map', 'judge_agreement', 'contaminated', 'friction_signature_ref'];
const ASSERTED_EXISTING = /\b(already|pre-existing|preexisting|existing|present in the)\b/i;

// The [start,end) spans on a line covered by an allow-context, so a learning-claim match
// is suppressed ONLY when its OWN span overlaps one (span-scoped, not line-scoped).
function allowSpans(line) {
  const spans = [];
  for (const re of ALLOWED_CONTEXTS) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    let m;
    while ((m = g.exec(line)) !== null) { spans.push([m.index, m.index + m[0].length]); if (m.index === g.lastIndex) g.lastIndex += 1; }
  }
  return spans;
}
function overlapsAny(start, end, spans) { return spans.some(([s, e]) => start < e && end > s); }

function auditWording(text, { proposedFields = PROPOSED_W4_FIELDS } = {}) {
  const violations = [];
  // hasMetric is file-scoped (lenient — a claim near a metric anywhere in a small module
  // is suspicious); the per-line check tightens it. Acceptable false-positive surface for
  // the ~200-line bootcamp modules (VALIDATE-reviewer LOW — documented, not widened).
  const hasMetric = METRIC_TOKEN.test(String(text || ''));
  const lines = String(text || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const spans = allowSpans(line);
    LEARNING_CLAIM.lastIndex = 0;
    let m;
    while ((m = LEARNING_CLAIM.exec(line)) !== null) {
      const start = m.index; const end = m.index + m[0].length;
      if (m.index === LEARNING_CLAIM.lastIndex) LEARNING_CLAIM.lastIndex += 1; // zero-width guard
      if (overlapsAny(start, end, spans)) continue;              // span-scoped allow (M3)
      if (hasMetric || METRIC_TOKEN.test(line)) violations.push({ kind: 'learning-claim', match: m[0], line: i + 1 });
    }
    // field-asserted-existing: a proposed NET-NEW field called already/pre-existing on the same line
    for (const f of proposedFields) {
      if (new RegExp(`\\b${f}\\b`).test(line) && ASSERTED_EXISTING.test(line)) {
        violations.push({ kind: 'field-asserted-existing', match: f, line: i + 1 });
      }
    }
  }
  return violations;
}

// --------------------------------------------------------------------------
// EC7 Path-2-darkness
// --------------------------------------------------------------------------

// require/import of a Path-2 module — `\s*` spans NEWLINES so a MULTI-LINE require is caught
// (VALIDATE-hacker M1); `import(...)` is matched alongside `require(...)` (the ESM dynamic
// form); the captured path is segment-tested so `tiebreaker` never matches. Whole-text /g.
const PATH2_IMPORT = /\b(?:require|import)\s*\(\s*['"`]([^'"`]*)['"`]/g;
const PATH2_SEGMENT = /(^|\/)(reputation|circuit-breaker|verdict-attestation)(\/|$)/;
// A Path-2 CALL (the function-call form; a bare prose mention without `(` never matches).
const PATH2_CALL = /\b(recordVerdict|projectReputation|projectBreaker|listVerdicts)\s*\(/g;
// A DYNAMIC require/import — the first non-space char after `(` is not a quote/backtick
// (and not `)`); a string-built module name is unanalyzable -> fail-closed flag.
const DYNAMIC_IMPORT = /\b(?:require|import)\s*\(\s*([^'"`\s)])/g;

// Blank out comments (line + block) but PRESERVE string literals + newlines, so the
// regexes see only real code: kills the `*/`-then-code false-NEGATIVE and the
// comment-mention false-POSITIVE at once (VALIDATE-hacker M1 + reviewer LOW). A naive
// char-walker tracking string/comment state — good enough for our own first-party source.
function stripComments(text) {
  const s = String(text || '');
  let out = '';
  let i = 0;
  let state = 'code';                                            // code | line | block | sq | dq | tq
  while (i < s.length) {
    const c = s[i]; const n = s[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && n === '*') { state = 'block'; out += '  '; i += 2; continue; }
      if (c === "'") { state = 'sq'; out += c; i += 1; continue; }
      if (c === '"') { state = 'dq'; out += c; i += 1; continue; }
      if (c === '`') { state = 'tq'; out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }
    if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } else out += (c === '\t' ? '\t' : ' '); i += 1; continue; }
    if (state === 'block') { if (c === '*' && n === '/') { state = 'code'; out += '  '; i += 2; } else { out += (c === '\n' ? '\n' : ' '); i += 1; } continue; }
    // inside a string: copy verbatim; a backslash escapes the next char; the matching quote ends it
    if (c === '\\') { out += c + (n || ''); i += 2; continue; }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tq' && c === '`')) { state = 'code'; }
    out += c; i += 1;
  }
  return out;
}

function lineOf(text, idx) { return text.slice(0, idx).split('\n').length; }

function auditPath2Darkness(sources) {
  const list = Array.isArray(sources) ? sources : [];
  const violations = [];
  for (const src of list) {
    const file = src && src.file;
    const code = stripComments((src && src.text) || '');         // comments blanked; strings + newlines preserved
    let m;
    PATH2_IMPORT.lastIndex = 0;
    while ((m = PATH2_IMPORT.exec(code)) !== null) {
      if (PATH2_SEGMENT.test(m[1])) violations.push({ kind: 'path2-import', file, line: lineOf(code, m.index), match: m[1] });
    }
    DYNAMIC_IMPORT.lastIndex = 0;
    while ((m = DYNAMIC_IMPORT.exec(code)) !== null) {
      violations.push({ kind: 'dynamic-require', file, line: lineOf(code, m.index), match: m[0].trim() });
    }
    PATH2_CALL.lastIndex = 0;
    while ((m = PATH2_CALL.exec(code)) !== null) {
      violations.push({ kind: 'path2-call', file, line: lineOf(code, m.index), match: m[1] });
    }
  }
  return violations;
}

// --------------------------------------------------------------------------
// bootcampSources — the fail-closed coverage set (dir-glob minus allow-list). NOT a
// hand-maintained closed file list: attribution/ + issue-corpus/ are scanned
// WHOLESALE (a new module is covered by default); causal-edge/ is a legacy-mixed dir
// so the 4 bootcamp files are included via an allow-list of the PRE-bootcamp files.
// --------------------------------------------------------------------------

const BOOTCAMP_DIRS = Object.freeze(['packages/lab/attribution', 'packages/lab/issue-corpus']);
const CAUSAL_EDGE_DIR = 'packages/lab/causal-edge';
// the PRE-bootcamp (v3.3-v3.8b) causal-edge .js files — allow-listed OUT of the EC7 scan.
const CAUSAL_EDGE_ALLOWLIST = new Set([
  'calibration.js', 'calibration-cli.js', 'calibration-run.js', 'cli.js', 'enums.js',
  'faithfulness.js', 'manage-ops.js', 'projections.js', 'store.js', 'walker.js',
]);

// RECURSIVE (VALIDATE-honesty H2): a non-recursive scan silently skipped `_spike/`, where
// the impure real-leg dogfoods live + import the runner — exactly where a future Path-2
// leak could hide. Recursion makes "fail-closed by coverage" literally true. FAIL-CLOSED on
// a read error (CodeRabbit Major): an ABSENT dir is clean-empty (`[]`), but a present-but-
// UNREADABLE dir (EACCES etc.) THROWS — a swallowed error would skip coverage + report a
// false GREEN (the record-scan.js:101 ENOENT-tolerant-else-throw precedent).
function listJs(absDir) {
  let entries;
  try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
  catch (e) { if (e && e.code === 'ENOENT') return []; throw e; }
  const out = [];
  for (const e of entries) {
    const abs = path.join(absDir, e.name);
    if (e.isDirectory()) out.push(...listJs(abs));
    else if (e.isFile() && e.name.endsWith('.js')) out.push(abs);
  }
  return out;
}

function readSource(file) {
  // ENOENT (a mid-scan race) -> empty; any other read error (EACCES) THROWS fail-closed —
  // an unreadable file silently scanned as '' would mask a Path-2 leak (CodeRabbit Major).
  try { return fs.readFileSync(file, 'utf8'); }
  catch (e) { if (e && e.code === 'ENOENT') return ''; throw e; }
}

function bootcampSources({ repoRoot = process.cwd() } = {}) {
  const files = [];
  for (const d of BOOTCAMP_DIRS) files.push(...listJs(path.join(repoRoot, d)));         // wholesale
  const causalEdge = path.join(repoRoot, CAUSAL_EDGE_DIR);
  for (const abs of listJs(causalEdge)) {
    const rel = path.relative(causalEdge, abs);
    // The allowlist excludes ONLY the PRE-bootcamp TOP-LEVEL causal-edge modules. A NESTED
    // file (e.g. `_spike/store.js`) whose basename collides with an allowlisted name must
    // STILL be scanned — a basename-only check would silently bypass it (CodeRabbit Major).
    const isTopLevel = !rel.includes(path.sep);
    if (isTopLevel && CAUSAL_EDGE_ALLOWLIST.has(rel)) continue;
    files.push(abs);
  }
  return files.map((file) => ({ file, text: readSource(file) }));
}

// --------------------------------------------------------------------------
// CLI — run both gates over the live bootcamp tree; exit non-zero on a violation.
// --------------------------------------------------------------------------

// A file the WORDING audit must skip (the Path-2 audit still covers it): (a) the gate's
// OWN source — it DEFINES the learn/train pattern literals (the eslint-config self-exempt
// pattern); (b) `_spike/` test harnesses — their assertion prose legitimately quotes the
// forbidden tokens; the wording-audit targets shipped SUBSTRATE prose, not scaffolding.
function isWordingExempt(file) {
  return path.basename(file) === 'bootcamp-gates.js' || String(file).includes(`${path.sep}_spike${path.sep}`);
}

function runCli(repoRoot) {
  const srcs = bootcampSources({ repoRoot });
  const path2 = auditPath2Darkness(srcs);                        // EC7 covers EVERY file incl. spikes + this gate
  const wording = [];
  for (const s of srcs) {
    if (isWordingExempt(s.file)) continue;
    for (const v of auditWording(s.text)) wording.push({ ...v, file: s.file });
  }
  const all = [...path2, ...wording];
  if (all.length === 0) { process.stdout.write(`bootcamp-gates: GREEN — ${srcs.length} files, 0 violations (Path-2 dark, no wording drift)\n`); return 0; }
  process.stdout.write(`bootcamp-gates: FAIL — ${all.length} violation(s):\n`);
  for (const v of all) process.stdout.write(`  [${v.kind}] ${v.file || ''}:${v.line || '?'} ${v.match || ''}\n`);
  return 1;
}

if (require.main === module) {
  process.exit(runCli(process.argv[2] || process.cwd()));
}

module.exports = {
  auditWording, auditPath2Darkness, bootcampSources, runCli, isWordingExempt, stripComments,
  BOOTCAMP_DIRS, CAUSAL_EDGE_ALLOWLIST,
};
