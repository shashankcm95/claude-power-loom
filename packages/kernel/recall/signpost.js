// packages/kernel/recall/signpost.js
//
// W0.1 - the auto-generated repo/code SIGNPOST (v3.5 Memory Manage-Layer, Wave 0;
// the #225 "CLAUDE.md-as-table-of-contents" vision, USER-chosen).
//
// A concern/layer -> source-location map, derived ENTIRELY from the repo's own
// structure: the layer + subgroup come from each file's path (packages/<layer>/<sub>/),
// and the one-line purpose comes from the file's own header comment. So it is
// auto-generated + DRIFT-FREE (the --check CI mode regenerates and diffs; a stale
// hand-maintained index misroutes, which is worse than none - RFC §6). Read-side /
// navigation only; shadow-safe (no kernel gate, no hooks.json ref).
//
// The header convention across the repo is INCONSISTENT (a path-echo first line, OR
// the purpose on line 1, OR a @loom-layer marker before the purpose), so
// extractPurpose is robust to all three.

'use strict';

const fs = require('fs');
const path = require('path');

// Dependency order (kernel < runtime < lab), then the support packages. Unknown
// layers sort last, alphabetically.
const LAYER_ORDER = ['kernel', 'runtime', 'lab', 'skills', 'specs'];
const MAX_PURPOSE_LEN = 160;
const DEFAULT_OUT = 'docs/SIGNPOST.md';

/**
 * Extract a one-line purpose from a source file's header comment, robust to the
 * three header conventions in the repo. Returns '' if no header comment precedes
 * the first code line.
 *
 * @param {string} source full file text
 * @param {string} relPath the file's repo-relative path (to detect a path-echo line)
 * @returns {string}
 */
function extractPurpose(source, relPath) {
  if (typeof source !== 'string') return '';
  const baseName = typeof relPath === 'string' ? relPath.split('/').pop() : '';
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('#!')) continue; // shebang
    if (line === "'use strict';" || line === '"use strict";') continue;

    let text = null;
    if (line.startsWith('//')) text = line.slice(2).trim();
    else if (line.startsWith('/*')) text = line.slice(2).replace(/\*+\/\s*$/, '').trim();
    else if (line.startsWith('*')) text = line.slice(1).replace(/\*+\/\s*$/, '').trim();
    else break; // a non-comment code line before any purpose -> no header purpose

    if (text === '' || text === '*/') continue; // blank comment line
    if (text.startsWith('@loom-layer')) continue; // layer marker, not the purpose
    // path-echo line (the file naming itself)?
    if (relPath && (text === relPath || text.endsWith('/' + baseName) || text === baseName)) continue;
    if (/^packages\/.+\.js$/.test(text)) continue; // generic path-echo

    return truncatePurpose(text);
  }
  return '';
}

function truncatePurpose(text) {
  let out = String(text);
  const dot = out.indexOf('. ');
  if (dot >= 0 && dot < MAX_PURPOSE_LEN) out = out.slice(0, dot + 1); // first sentence
  if (out.length > MAX_PURPOSE_LEN) out = out.slice(0, MAX_PURPOSE_LEN - 3).trimEnd() + '...';
  return out.trim();
}

/**
 * Classify a repo-relative path into { layer, subgroup, file } from its location.
 * A file directly under a layer (packages/<layer>/x.js) gets subgroup '(root)'.
 *
 * @param {string} relPath e.g. 'packages/kernel/_lib/provenance-walk.js'
 * @returns {{layer: string, subgroup: string, file: string}}
 */
function classifyPath(relPath) {
  const parts = String(relPath).split('/');
  const file = parts[parts.length - 1];
  const layer = parts[1] || '(unknown)';
  const subgroup = parts.length <= 3 ? '(root)' : parts[2];
  return { layer, subgroup, file };
}

function layerRank(layer) {
  const i = LAYER_ORDER.indexOf(layer);
  return i === -1 ? LAYER_ORDER.length : i;
}

/**
 * Group entries [{path, purpose}] by layer -> subgroup, deterministically sorted
 * (layers in dependency order, subgroups + files alphabetical).
 *
 * @param {Array<{path: string, purpose?: string}>} entries
 * @returns {Array<{layer: string, subgroups: Array<{subgroup: string, files: Array<{file: string, path: string, purpose: string}>}>}>}
 */
function buildIndex(entries) {
  const byLayer = new Map();
  if (Array.isArray(entries)) {
    for (const e of entries) {
      if (!e || typeof e.path !== 'string') continue;
      const { layer, subgroup, file } = classifyPath(e.path);
      if (!byLayer.has(layer)) byLayer.set(layer, new Map());
      const subs = byLayer.get(layer);
      if (!subs.has(subgroup)) subs.set(subgroup, []);
      subs.get(subgroup).push({ file, path: e.path, purpose: e.purpose || '' });
    }
  }
  const layers = [...byLayer.keys()].sort((a, b) => layerRank(a) - layerRank(b) || a.localeCompare(b));
  return layers.map((layer) => {
    const subs = byLayer.get(layer);
    const subgroups = [...subs.keys()]
      .sort((a, b) => a.localeCompare(b))
      .map((subgroup) => ({
        subgroup,
        files: subs.get(subgroup).slice().sort((a, b) => a.file.localeCompare(b.file)),
      }));
    return { layer, subgroups };
  });
}

/**
 * Render the grouped index as a deterministic, markdownlint-safe markdown doc.
 * Every path is backticked (the markdown-emphasis discipline: '_lib' underscores).
 *
 * @param {ReturnType<typeof buildIndex>} index
 * @returns {string}
 */
function renderMarkdown(index) {
  const lines = [];
  lines.push('<!-- markdownlint-disable -->');
  lines.push('<!-- DO NOT EDIT - generated by scripts/generate-signpost.js (W0.1). Re-run to refresh. -->');
  lines.push('');
  lines.push('# Power Loom Signpost - concern to location');
  lines.push('');
  lines.push(
    'Auto-generated map of where things live, derived from the repo structure + each ' +
      'file header-comment purpose. Layer order = kernel < runtime < lab (dependency order).'
  );
  lines.push('');
  for (const layer of index) {
    lines.push('## ' + layer.layer + '/');
    lines.push('');
    for (const sg of layer.subgroups) {
      const heading = sg.subgroup === '(root)' ? layer.layer + '/' : layer.layer + '/' + sg.subgroup + '/';
      lines.push('### `' + heading + '`');
      lines.push('');
      for (const f of sg.files) {
        const purpose = f.purpose ? ' - ' + f.purpose : '';
        lines.push('- `' + f.path + '`' + purpose);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

/**
 * Pure: turn [{path, source}] into the rendered signpost markdown. The --check
 * determinism contract rests on this being a pure function of the file set.
 *
 * @param {Array<{path: string, source: string}>} files
 * @returns {string}
 */
function generateMarkdownFromFiles(files) {
  const entries = (Array.isArray(files) ? files : []).map((f) => ({
    path: f.path,
    purpose: extractPurpose(f.source, f.path),
  }));
  return renderMarkdown(buildIndex(entries));
}

/**
 * I/O: walk packages/ for non-test .js files, returning [{path (rel), source}]
 * sorted by path (deterministic). Skips node_modules + *.test.js.
 *
 * @param {string} root repo root
 * @returns {Array<{path: string, source: string}>}
 */
function scanFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules') continue;
        walk(full);
      } else if (ent.isFile() && ent.name.endsWith('.js') && !ent.name.endsWith('.test.js')) {
        const rel = path.relative(root, full).split(path.sep).join('/');
        let source = '';
        try {
          source = fs.readFileSync(full, 'utf8');
        } catch {
          source = '';
        }
        out.push({ path: rel, source });
      }
    }
  };
  walk(path.join(root, 'packages'));
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/**
 * Generate (or --check) the signpost. Returns {ok, generated, drift?, written?}.
 *
 * @param {{root?: string, outPath?: string, write?: boolean, check?: boolean}} [opts]
 */
function generateSignpost(opts = {}) {
  const root = opts.root || process.cwd();
  const out = opts.outPath || path.join(root, DEFAULT_OUT);
  const md = generateMarkdownFromFiles(scanFiles(root));
  if (opts.check) {
    let existing = null;
    try {
      existing = fs.readFileSync(out, 'utf8');
    } catch {
      existing = null;
    }
    const ok = existing !== null && existing === md;
    return { ok, generated: md, drift: !ok };
  }
  if (opts.write) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, md);
    return { ok: true, generated: md, written: out };
  }
  return { ok: true, generated: md };
}

/**
 * CLI entry: `node scripts/generate-signpost.js [--check]`. --check exits 1 on
 * drift/missing; default regenerates the doc + exits 0.
 */
function runCli(argv = process.argv) {
  const isCheck = argv.includes('--check');
  const root = process.cwd();
  if (isCheck) {
    const res = generateSignpost({ root, check: true });
    if (!res.ok) {
      process.stderr.write(
        '[SIGNPOST-DRIFT] ' + DEFAULT_OUT + ' is stale or missing. Run: node scripts/generate-signpost.js\n'
      );
      process.exit(1);
    }
    process.stdout.write('signpost: up to date\n');
    process.exit(0);
  }
  const res = generateSignpost({ root, write: true });
  process.stdout.write('signpost: wrote ' + res.written + '\n');
  process.exit(0);
}

module.exports = {
  extractPurpose,
  classifyPath,
  buildIndex,
  renderMarkdown,
  generateMarkdownFromFiles,
  scanFiles,
  generateSignpost,
  runCli,
  LAYER_ORDER,
  DEFAULT_OUT,
};

if (require.main === module) runCli();
