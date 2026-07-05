#!/usr/bin/env node

'use strict';

// The `memory` CLI — block-addressable retrieval + budget/demotion for the operating-memory system
// (the deferred helper from 2026-06-25-tiered-memory-demotion-design.md, built per
// 2026-07-05-memory-restructure-design.md). PURE-ish: the only I/O is reading/writing the memory `.md`
// files + a per-file `<file>.heat.json` LRU sidecar. No deps, no vector DB — the structured-linked file
// store is a consensus-valid, human-auditable retrieval modality (token-level).
//
// BLOCK MODEL: a memory file is a preamble + a sequence of BLOCKS delimited by headings at a chosen level
// (default H3 `###`, the scar-block level; `--level 2` for topic files). A block runs from its heading to
// the next heading of the SAME-or-SHALLOWER level (or EOF). Each block has a stable ANCHOR derived from its
// heading: the full github-style slug AND a short leading-token anchor (e.g. `### SCAR-33 — title` ->
// {fullSlug: 'scar-33-title', shortAnchor: 'scar-33'}); `recall` matches either, so `[[scars-toolkit#scar-33]]`
// resolves the exact block. Retrieval bumps the block's heat (last_ref + refs) so the router can keep an
// LRU hot-cache of the N most-recently-referenced blocks and cold-fetch the rest on a miss.
//
// SAFETY: `demote` MOVES a block (append to dest, leave a one-line pointer in src) — never deletes. `check`
// is read-only. Every write is byte-explicit; the caller reviews.

const fs = require('fs');
const path = require('path');

// The hot-index ceiling (Claude Code official memory guidance: keep the always-loaded index under ~200
// lines; longer files reduce adherence). Bytes is a proxy for the harness read-limit.
const DEFAULT_MAX_LINES = 200;
const DEFAULT_MAX_BYTES = 18 * 1024;
const HEAT_SUFFIX = '.heat.json';

// --------------------------------------------------------------------------
// Pure helpers.
// --------------------------------------------------------------------------

/** github-style slug: lowercase, drop non-alnum-space-hyphen, spaces->hyphen, collapse hyphens. */
function slugify(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9 _-]+/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** The short anchor = the slug of the heading's LEADING token (before an em-dash / en-dash / ' - ' / ':'). */
function shortAnchorOf(headingText) {
  const lead = String(headingText).split(/\s+[—–]\s+|\s+-\s+|:\s+/)[0];
  return slugify(lead);
}

/**
 * Parse a markdown file into { preamble, blocks }. A block is delimited by an ATX heading at `level`
 * (e.g. 3 for `###`); it ends at the next heading of level <= `level` (a same/shallower heading) or EOF.
 * PURE. Each block: { anchor (fullSlug), shortAnchor, title, level, headingLine, lines[], startLine (1-based), endLine, bytes }.
 * @param {string} text
 * @param {{level?: number}} opts
 * @returns {{ preamble: string, blocks: Array }}
 */
function parseBlocks(text, { level = 3 } = {}) {
  const lines = String(text == null ? '' : text).split('\n');
  const headingRe = /^(#{1,6})\s+(.*\S)\s*$/;
  const blocks = [];
  let preambleEnd = lines.length;
  let cur = null;
  for (let i = 0; i < lines.length; i += 1) {
    const m = headingRe.exec(lines[i]);
    const hLevel = m ? m[1].length : 0;
    if (m && hLevel <= level && hLevel >= 1) {
      // close the current block at a same-or-shallower heading; open a new one only AT the split level.
      if (cur) { cur.endLine = i; blocks.push(cur); cur = null; }
      if (hLevel === level) {
        if (blocks.length === 0 && preambleEnd === lines.length) preambleEnd = i;
        cur = { title: m[2], level: hLevel, headingLine: lines[i], startLine: i + 1, lines: [lines[i]] };
      }
      // a shallower heading (## / #) BETWEEN split-level blocks closes the section; it belongs to preamble
      // context only if before the first block (handled above via preambleEnd).
      continue;
    }
    if (cur) cur.lines.push(lines[i]);
  }
  if (cur) { cur.endLine = lines.length; blocks.push(cur); }
  for (const b of blocks) {
    b.anchor = slugify(b.title);
    b.shortAnchor = shortAnchorOf(b.title);
    b.body = b.lines.join('\n');
    b.bytes = Buffer.byteLength(b.body, 'utf8');
    if (b.endLine === undefined) b.endLine = b.startLine + b.lines.length - 1;
  }
  const preamble = lines.slice(0, preambleEnd === lines.length && blocks.length === 0 ? lines.length : preambleEnd).join('\n');
  return { preamble, blocks };
}

/** Resolve the block in `text` whose fullSlug OR shortAnchor === the requested anchor (case-insensitive). */
function resolveBlock(text, anchor, { level = 3 } = {}) {
  const want = slugify(anchor);
  const { blocks } = parseBlocks(text, { level });
  return blocks.find((b) => b.anchor === want || b.shortAnchor === want) || null;
}

/** Parse a `[[file#anchor]]` or `file#anchor` or `file anchor` pointer into { file, anchor }. */
function parsePointer(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(/^\[\[/, '').replace(/\]\]$/, '');
  const hash = s.indexOf('#');
  if (hash >= 0) return { file: s.slice(0, hash).trim(), anchor: s.slice(hash + 1).trim() };
  const sp = s.split(/\s+/);
  return { file: sp[0], anchor: sp.slice(1).join(' ') };
}

// --------------------------------------------------------------------------
// Heat sidecar (the LRU signal). `<file>.heat.json` = { "<anchor>": { last_ref, refs } }.
// --------------------------------------------------------------------------

function heatPath(file) { return file + HEAT_SUFFIX; }

function readHeat(file) {
  try { const j = JSON.parse(fs.readFileSync(heatPath(file), 'utf8')); return (j && typeof j === 'object' && !Array.isArray(j)) ? j : {}; }
  catch { return {}; }
}

/** Bump an anchor's heat. `now` is injectable (deterministic tests). Returns the updated map (also written). */
function bumpHeat(file, anchor, { now } = {}) {
  const heat = readHeat(file);
  const key = slugify(anchor);
  const ts = new Date(typeof now === 'number' ? now : Date.now()).toISOString();
  heat[key] = { last_ref: ts, refs: ((heat[key] && heat[key].refs) || 0) + 1 };
  fs.writeFileSync(heatPath(file), `${JSON.stringify(heat, null, 2)}\n`, { mode: 0o600 });
  return heat;
}

/** The LRU hot-set: the N anchors with the most-recent last_ref (ties broken by refs). Returns anchors[]. */
function hotSet(file, n = 5) {
  const heat = readHeat(file);
  return Object.keys(heat)
    .map((k) => ({ anchor: k, last_ref: heat[k].last_ref || '', refs: heat[k].refs || 0 }))
    .sort((a, b) => (b.last_ref < a.last_ref ? -1 : b.last_ref > a.last_ref ? 1 : b.refs - a.refs))
    .slice(0, n)
    .map((e) => e.anchor);
}

// --------------------------------------------------------------------------
// Scoring (recency + importance + relevance) — for `check`'s demote-candidates. Importance is the
// PROTECTOR: an invariant-class block is never a demote candidate regardless of staleness.
// --------------------------------------------------------------------------

// Section-name -> importance class (higher = more protected). Matches the MEMORY.md section convention.
function importanceOf(sectionTitle) {
  const t = String(sectionTitle || '').toLowerCase();
  if (/canonical|load-bearing|invariant|live process/.test(t)) return { cls: 'invariant', weight: 3, protected: true };
  if (/current status|start here|workstream|status/.test(t)) return { cls: 'project', weight: 2, protected: false };
  if (/historical|deferred|archive|closed/.test(t)) return { cls: 'historical', weight: 0, protected: false };
  return { cls: 'reference', weight: 1, protected: false };
}

// --------------------------------------------------------------------------
// Commands.
// --------------------------------------------------------------------------

function cmdRecall(args, deps = {}) {
  const { file, anchor } = parsePointer(args._[0] || `${args.file || ''}#${args.anchor || ''}`);
  const abs = resolveFile(file);
  if (!abs) return fail(`recall: file not found: ${file}`);
  const level = Number(args.level) || 3;
  const block = resolveBlock(fs.readFileSync(abs, 'utf8'), anchor, { level });
  if (!block) return fail(`recall: no block '#${anchor}' in ${path.basename(abs)} (try 'memory blocks ${file}')`);
  if (!args['no-bump']) bumpHeat(abs, block.shortAnchor || block.anchor, { now: deps.now });
  process.stdout.write(block.body.replace(/\n+$/, '') + '\n');
  return 0;
}

function cmdBlocks(args) {
  const abs = resolveFile(args._[0] || args.file);
  if (!abs) return fail('blocks: file not found');
  const level = Number(args.level) || 3;
  const { blocks } = parseBlocks(fs.readFileSync(abs, 'utf8'), { level });
  process.stdout.write(`${path.basename(abs)}: ${blocks.length} blocks (H${level})\n`);
  for (const b of blocks) process.stdout.write(`  [#${b.shortAnchor}] L${b.startLine}-${b.endLine} ${b.bytes}B  ${b.title.slice(0, 70)}\n`);
  return 0;
}

function cmdHeat(args, deps = {}) {
  const abs = resolveFile(args._[0] || args.file);
  if (!abs) return fail('heat: file not found');
  if (args.bump) { bumpHeat(abs, args.bump, { now: deps.now }); process.stdout.write(`bumped #${slugify(args.bump)}\n`); return 0; }
  const n = Number(args.top) || 5;
  const hot = hotSet(abs, n);
  process.stdout.write(`hot-set (LRU top-${n}) of ${path.basename(abs)}:\n`);
  hot.forEach((a, i) => process.stdout.write(`  ${i + 1}. #${a}\n`));
  return 0;
}

function cmdCheck(args) {
  const abs = resolveFile(args._[0] || args.file);
  if (!abs) return fail('check: file not found');
  const text = fs.readFileSync(abs, 'utf8');
  const bytes = Buffer.byteLength(text, 'utf8');
  const lineCount = text.split('\n').length;
  const maxLines = Number(args['max-lines']) || DEFAULT_MAX_LINES;
  const maxBytes = Number(args['max-bytes']) || DEFAULT_MAX_BYTES;
  const overLines = lineCount - maxLines;
  const overBytes = bytes - maxBytes;
  const ok = overLines <= 0 && overBytes <= 0;
  process.stdout.write(`${path.basename(abs)}: ${lineCount} lines / ${(bytes / 1024).toFixed(1)}KB (ceiling ${maxLines} lines / ${(maxBytes / 1024).toFixed(1)}KB) -> ${ok ? 'OK' : 'OVER'}\n`);
  if (!ok) {
    // rank the LOWEST-score H2 sections/blocks as demote candidates (invariant-protected excluded).
    const { blocks } = parseBlocks(text, { level: 2 });
    const cand = blocks
      .map((b) => ({ b, imp: importanceOf(b.title) }))
      .filter((x) => !x.imp.protected)
      .sort((a, b) => a.imp.weight - b.imp.weight || b.b.bytes - a.b.bytes);
    process.stdout.write(`  over by ${overLines > 0 ? overLines + ' lines' : ''}${overLines > 0 && overBytes > 0 ? ' / ' : ''}${overBytes > 0 ? (overBytes / 1024).toFixed(1) + 'KB' : ''}\n`);
    process.stdout.write('  demote candidates (lowest importance first; invariant sections protected):\n');
    for (const c of cand.slice(0, 6)) process.stdout.write(`    [${c.imp.cls}] ${c.b.bytes}B  ## ${c.b.title.slice(0, 60)}\n`);
  }
  return ok ? 0 : 2;
}

function cmdDemote(args) {
  const srcAbs = resolveFile(args.file || args.from);
  const destAbs = resolveFile(args.to, { create: true });
  if (!srcAbs || !destAbs) return fail('demote: --file and --to are required (dest may be new)');
  const level = Number(args.level) || 3;
  const text = fs.readFileSync(srcAbs, 'utf8');
  const { blocks } = parseBlocks(text, { level });
  const block = blocks.find((b) => b.anchor === slugify(args.anchor) || b.shortAnchor === slugify(args.anchor));
  if (!block) return fail(`demote: no block '#${args.anchor}' in ${path.basename(srcAbs)}`);
  // append verbatim to dest
  const destText = fs.existsSync(destAbs) ? fs.readFileSync(destAbs, 'utf8') : '';
  fs.writeFileSync(destAbs, `${destText.replace(/\n*$/, '')}\n\n${block.body.replace(/\n*$/, '')}\n`);
  // replace the block in src with a one-line pointer (demote-never-delete: the verbatim is in dest)
  const srcLines = text.split('\n');
  const pointer = `- [#${block.shortAnchor}] ${block.title.slice(0, 60)} -> [[${path.basename(destAbs, '.md')}#${block.shortAnchor}]]`;
  srcLines.splice(block.startLine - 1, block.endLine - block.startLine + 1, pointer);
  fs.writeFileSync(srcAbs, srcLines.join('\n'));
  process.stdout.write(`demoted #${block.shortAnchor} (${block.bytes}B) ${path.basename(srcAbs)} -> ${path.basename(destAbs)}; pointer left\n`);
  return 0;
}

// --------------------------------------------------------------------------
// File resolution + argv + dispatch.
// --------------------------------------------------------------------------

const MEM_DIR = process.env.LOOM_MEMORY_DIR
  || path.join(process.env.HOME || '', '.claude', 'projects', '-Users-shashankchandrashekarmurigappa-Documents-claude-toolkit', 'memory');

/** Resolve a file arg: an absolute/relative path, or a bare slug -> MEM_DIR/<slug>.md. */
function resolveFile(f, { create = false } = {}) {
  if (!f) return null;
  let p = f;
  if (!path.isAbsolute(p)) {
    if (fs.existsSync(p)) p = path.resolve(p);
    else { const inMem = path.join(MEM_DIR, p.endsWith('.md') ? p : `${p}.md`); p = inMem; }
  }
  if (fs.existsSync(p) || create) return p;
  return null;
}

function fail(msg) { process.stderr.write(`${msg}\n`); return 1; }

/** Minimal argv parser: `--flag val`, `--bool`, positionals in `_`. */
function parseArgv(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i += 1; }
    } else out._.push(a);
  }
  return out;
}

const COMMANDS = { recall: cmdRecall, blocks: cmdBlocks, heat: cmdHeat, check: cmdCheck, demote: cmdDemote };

function main(argv) {
  const [cmd, ...rest] = argv;
  const handler = COMMANDS[cmd];
  if (!handler) {
    process.stderr.write('Usage: memory <recall|blocks|heat|check|demote> ...\n'
      + "  recall '[[file#anchor]]'        resolve + print a block (bumps its heat)\n"
      + '  blocks <file> [--level N]       list a file\'s blocks (anchors + sizes)\n'
      + '  heat <file> [--top N|--bump A]  show the LRU hot-set / bump an anchor\n'
      + '  check <file> [--max-lines N]    budget report + demote candidates\n'
      + '  demote --file S --anchor A --to D   MOVE a block (leaves a pointer; never deletes)\n');
    return cmd ? 1 : 0;
  }
  return handler(parseArgv(rest));
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = {
  slugify, shortAnchorOf, parseBlocks, resolveBlock, parsePointer,
  readHeat, bumpHeat, hotSet, importanceOf,
  cmdRecall, cmdBlocks, cmdHeat, cmdCheck, cmdDemote, main,
  DEFAULT_MAX_LINES, DEFAULT_MAX_BYTES,
};
