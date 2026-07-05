#!/usr/bin/env node

'use strict';

// The `memory` CLI -- block-addressable retrieval + budget/demotion for the operating-memory system
// (the deferred helper from 2026-06-25-tiered-memory-demotion-design.md, built per
// 2026-07-05-memory-restructure-design.md). PURE-ish: the only I/O is reading/writing the memory `.md`
// files + a per-file `<file>.heat.json` LRU sidecar. No deps beyond the kernel path guard -- the
// structured-linked file store is a consensus-valid, human-auditable retrieval modality (token-level).
//
// BLOCK MODEL: a memory file is a preamble + a sequence of BLOCKS delimited by headings at a chosen level
// (default H3 `###`, the scar-block level; `--level 2` for topic files). A block runs from its heading to
// the next heading of the SAME-or-SHALLOWER level (or EOF). Each block has a stable ANCHOR derived from its
// heading: the full github-style slug AND a short leading-token anchor (e.g. `### SCAR-33 -- title` ->
// {fullSlug: 'scar-33-title', shortAnchor: 'scar-33'}); `recall` matches either, so `[[scars-toolkit#scar-33]]`
// resolves the exact block. Retrieval bumps the block's heat (last_ref + refs) so the router can keep an
// LRU hot-cache of the N most-recently-referenced blocks and cold-fetch the rest on a miss.
//
// SAFETY (hardened per the 2026-07-05 review boards):
//   * WITHIN-ROOT CONTAINMENT -- every path (the file arg AND the DERIVED heat-sidecar) is gated through the
//     kernel's symlink-resolving checkWithinRoot plus a final-component symlink refusal; recall cannot READ
//     and demote/heat cannot WRITE outside the memory root (rejects `..`, absolute-outside, symlink-escape,
//     and a symlinked sidecar). A bare slug must be a single safe segment. RESIDUAL (documented, not closed):
//     a pure check->use timing race by a local writer ALREADY inside the root -- who can corrupt memory
//     directly anyway -- is out of scope for this single-user curation CLI.
//   * ATOMIC MOVE -- `demote` stages BOTH new file contents, then writes each via temp-file + fsync + atomic
//     rename, rolling the dest back on a src fault. It never loses a block and never duplicates one SILENTLY;
//     a rare DOUBLE fault is reported loudly for manual reconcile. `check` is read-only.
//   * COLLISION GUARD + POINTER SECTION -- `demote` refuses a duplicate anchor in dest (recall-shadow), and
//     leaves its pointer in a dedicated `## Demoted` section so a later demote cannot absorb it into a
//     sibling block. Fenced code blocks (0-3 space indent) with heading-shaped lines are NOT mis-split.

const fs = require('fs');
const path = require('path');
const { checkWithinRoot, isSafePathSegment } = require('../packages/kernel/_lib/path-canonicalize');

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
  const lead = String(headingText).split(/\s+[\u2014\u2013]\s+|\s+-\s+|:\s+/)[0];
  return slugify(lead);
}

/** Logical line count: equals `wc -l` for a newline-terminated file; one MORE than `wc -l` with no final newline. */
function countLines(text) {
  const s = String(text == null ? '' : text);
  if (s === '') return 0;
  return s.replace(/\n$/, '').split('\n').length;
}

/**
 * Parse a markdown file into { preamble, blocks }. A block is delimited by an ATX heading at `level`
 * (e.g. 3 for `###`); it ends at the next heading of level <= `level` (a same/shallower heading) or EOF.
 * FENCE-AWARE: a heading-shaped line inside a ``` / ~~~ fenced code block is literal content, not a
 * boundary. PURE. Each block: { anchor (fullSlug), shortAnchor, title, level, headingLine, lines[],
 * startLine (1-based), endLine, bytes, body }.
 * @param {string} text
 * @param {{level?: number}} opts
 * @returns {{ preamble: string, blocks: Array }}
 */
function parseBlocks(text, { level = 3 } = {}) {
  const lines = String(text == null ? '' : text).split('\n');
  const headingRe = /^(#{1,6})\s+(.*\S)\s*$/;
  const fenceRe = /^ {0,3}(`{3,}|~{3,})/; // CommonMark: a fence has 0-3 leading spaces (4+ is indented code)
  const blocks = [];
  let preambleEnd = lines.length;
  let cur = null;
  let fence = null; // the open fence marker char ('`' or '~'), or null when outside a fence
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fenceM = fenceRe.exec(line);
    if (fenceM) {
      const marker = fenceM[1][0];
      if (fence === null) fence = marker; // open
      else if (fence === marker) fence = null; // close on a matching fence
      if (cur) cur.lines.push(line); // a fence line is content, never a heading
      continue;
    }
    if (fence !== null) { if (cur) cur.lines.push(line); continue; } // inside a fence: literal
    const m = headingRe.exec(line);
    const hLevel = m ? m[1].length : 0;
    if (m && hLevel <= level && hLevel >= 1) {
      // close the current block at a same-or-shallower heading; open a new one only AT the split level.
      if (cur) { cur.endLine = i; blocks.push(cur); cur = null; }
      if (hLevel === level) {
        if (blocks.length === 0 && preambleEnd === lines.length) preambleEnd = i;
        cur = { title: m[2], level: hLevel, headingLine: line, startLine: i + 1, lines: [line] };
      }
      continue;
    }
    if (cur) cur.lines.push(line);
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

/** shortAnchors that appear on MORE THAN ONE block in `text` (a recall-shadowing hazard). */
function findDuplicateAnchors(text, { level = 3 } = {}) {
  const { blocks } = parseBlocks(text, { level });
  const counts = new Map();
  for (const b of blocks) counts.set(b.shortAnchor, (counts.get(b.shortAnchor) || 0) + 1);
  return [...counts.entries()].filter(([, n]) => n > 1).map(([a]) => a);
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
// Filesystem safety primitives.
// --------------------------------------------------------------------------

/** Run a best-effort cleanup fn, swallowing any error (returns undefined on failure). */
function safe(fn) { try { return fn(); } catch { return undefined; } }

/**
 * True iff `p` is within `root` AND (if it already exists) is NOT a symlink. A not-yet-existing path is
 * allowed (the create case). This is stricter than checkWithinRoot alone: it also refuses a symlinked
 * FINAL component, closing a pre-planted-symlink escape. NOTE (honest residual): this is a check-time
 * lstat, so a pure check->use timing race (a local process swapping the file for a symlink in the
 * microsecond window) is NOT closed here -- but such a racer already has write access to the user's own
 * memory dir and could corrupt it directly, so the residual is accepted for this single-user curation CLI.
 */
function withinRootPlain(p, root) {
  if (!checkWithinRoot(p, root).ok) return false;
  try { if (fs.lstatSync(p).isSymbolicLink()) return false; }
  catch (e) { if (e.code !== 'ENOENT') return false; }
  return true;
}

let tmpCounter = 0;

/**
 * Crash-safe write: stage to a same-dir temp file (`wx` = fail if it exists), fsync, then atomic rename
 * over the target. On any fault the temp is removed and the ORIGINAL target is left untouched (rename is
 * the last, atomic step). Renaming over the final component also defeats symlink-write-through.
 */
function atomicWrite(absPath, content, { mode = 0o644 } = {}) {
  const tmp = `${absPath}.tmp.${process.pid}.${tmpCounter += 1}`;
  let fd;
  try {
    try { fd = fs.openSync(tmp, 'wx', mode); }
    catch (openErr) {
      if (openErr.code !== 'EEXIST') throw openErr;
      safe(() => fs.unlinkSync(tmp)); // clear a stale temp from a prior crash (unlink removes a symlink itself, never its target); wx still won't follow
      fd = fs.openSync(tmp, 'wx', mode);
    }
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, absPath);
  } catch (err) {
    if (fd !== undefined) safe(() => fs.closeSync(fd));
    safe(() => fs.unlinkSync(tmp));
    throw err;
  }
}

// --------------------------------------------------------------------------
// Heat sidecar (the LRU signal). `<file>.heat.json` = { "<anchor>": { last_ref, refs } }.
// --------------------------------------------------------------------------

function heatPath(file) { return file + HEAT_SUFFIX; }

function readHeat(file) {
  try { const j = JSON.parse(fs.readFileSync(heatPath(file), 'utf8')); return (j && typeof j === 'object' && !Array.isArray(j)) ? j : {}; }
  catch { return {}; }
}

/**
 * Write the heat sidecar, REFUSING a symlinked sidecar (a derived path is itself an unvalidated path:
 * `<file>.heat.json` planted as a symlink would otherwise let a heat write clobber a file outside root).
 * The refusal is observable on stderr (fail-closed + visible). Returns true on write, false on refusal.
 */
function writeHeatSafe(file, obj) {
  const hp = heatPath(file);
  try { if (fs.lstatSync(hp).isSymbolicLink()) { process.stderr.write(`[memory] refused symlinked heat sidecar (not writing): ${hp}\n`); return false; } }
  catch (e) { if (e.code !== 'ENOENT') { process.stderr.write(`[memory] heat sidecar lstat failed (${e.code}); not writing: ${hp}\n`); return false; } }
  fs.writeFileSync(hp, `${JSON.stringify(obj, null, 2)}\n`, { mode: 0o600 });
  return true;
}

/** Bump an anchor's heat (immutable: writes a NEW map). `now` is injectable for deterministic tests. */
function bumpHeat(file, anchor, { now } = {}) {
  const heat = readHeat(file);
  const key = slugify(anchor);
  const ts = new Date(typeof now === 'number' ? now : Date.now()).toISOString();
  const next = { ...heat, [key]: { last_ref: ts, refs: ((heat[key] && heat[key].refs) || 0) + 1 } };
  writeHeatSafe(file, next);
  return next;
}

/** Drop an anchor's heat key (orphan hygiene: the block left this file). Best-effort, immutable. */
function dropHeat(file, anchor) {
  const heat = readHeat(file);
  const key = slugify(anchor);
  if (!Object.prototype.hasOwnProperty.call(heat, key)) return heat;
  const next = Object.fromEntries(Object.entries(heat).filter(([k]) => k !== key));
  writeHeatSafe(file, next);
  return next;
}

/**
 * The LRU hot-set: the N anchors with the most-recent last_ref (ties broken by refs). Returns anchors[].
 * If `liveAnchors` (a Set) is given, orphan keys that no longer resolve to a block are filtered out so the
 * cache never surfaces a dead pointer.
 */
function hotSet(file, n = 5, { liveAnchors = null } = {}) {
  const heat = readHeat(file);
  return Object.keys(heat)
    .filter((k) => !liveAnchors || liveAnchors.has(k))
    .map((k) => ({ anchor: k, last_ref: heat[k].last_ref || '', refs: heat[k].refs || 0 }))
    .sort((a, b) => (b.last_ref < a.last_ref ? -1 : b.last_ref > a.last_ref ? 1 : b.refs - a.refs))
    .slice(0, n)
    .map((e) => e.anchor);
}

// --------------------------------------------------------------------------
// Demote-candidate ranking (in `check`) = importance-class THEN byte-size. Importance is the PROTECTOR:
// an invariant-class section is never a demote candidate regardless of staleness. (recency + relevance
// are modeled by the heat sidecar for the LRU hot-cache; `check` itself ranks on importance + bytes only.)
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
// File resolution (within-root contained) + the commands.
// --------------------------------------------------------------------------

/** The memory root (live env read so tests can scope it per-run). */
function memDir() {
  if (process.env.LOOM_MEMORY_DIR) return process.env.LOOM_MEMORY_DIR;
  // Derive the Claude Code project memory dir from THIS repo's absolute path ('/' -> '-', the project-dir
  // convention), so it is correct for any contributor's checkout instead of a hardcoded personal path.
  // LOOM_MEMORY_DIR always overrides (tests + explicit use).
  const repoRoot = path.resolve(__dirname, '..');
  const projectHash = repoRoot.replace(/\//g, '-');
  return path.join(process.env.HOME || '', '.claude', 'projects', projectHash, 'memory');
}

/**
 * Resolve a file arg to an absolute path WITHIN the memory root, or null if it does not resolve / would
 * escape the root. A bare slug (`scars-toolkit`) -> `<root>/scars-toolkit.md` (the slug must be a single
 * safe segment). An absolute/relative path is accepted only if it (symlink-resolved) stays within root.
 */
function resolveFile(f, { create = false, root = memDir() } = {}) {
  if (!f || typeof f !== 'string') return null;
  let p;
  if (path.isAbsolute(f)) {
    p = f;
  } else if (fs.existsSync(f)) {
    p = path.resolve(f);
  } else {
    const slug = f.endsWith('.md') ? f : `${f}.md`;
    if (!isSafePathSegment(slug)) return null; // blocks '../x', 'a/b', nul-byte slugs BEFORE the join
    p = path.join(root, slug);
  }
  if (!withinRootPlain(p, root)) return null; // CWE-22: reject traversal / absolute-outside / symlink (final component)
  if (fs.existsSync(p) || create) return p;
  return null;
}

function cmdRecall(args, deps = {}) {
  const { file, anchor } = parsePointer(args._[0] || `${args.file || ''}#${args.anchor || ''}`);
  const abs = resolveFile(file);
  if (!abs) return fail(`recall: file not found or outside memory root: ${file}`);
  const level = Number(args.level) || 3;
  const block = resolveBlock(fs.readFileSync(abs, 'utf8'), anchor, { level });
  if (!block) return fail(`recall: no block '#${anchor}' in ${path.basename(abs)} (try 'memory blocks ${file}')`);
  if (!args['no-bump']) bumpHeat(abs, block.shortAnchor || block.anchor, { now: deps.now });
  process.stdout.write(block.body.replace(/\n+$/, '') + '\n');
  return 0;
}

function cmdBlocks(args) {
  const abs = resolveFile(args._[0] || args.file);
  if (!abs) return fail('blocks: file not found or outside memory root');
  const level = Number(args.level) || 3;
  const text = fs.readFileSync(abs, 'utf8');
  if (args['check-unique']) {
    const dups = findDuplicateAnchors(text, { level });
    if (dups.length) {
      process.stdout.write(`${path.basename(abs)}: DUPLICATE anchors (recall-shadowing): ${dups.map((a) => `#${a}`).join(', ')}\n`);
      return 2;
    }
    process.stdout.write(`${path.basename(abs)}: all H${level} anchors unique\n`);
    return 0;
  }
  const { blocks } = parseBlocks(text, { level });
  process.stdout.write(`${path.basename(abs)}: ${blocks.length} blocks (H${level})\n`);
  for (const b of blocks) process.stdout.write(`  [#${b.shortAnchor}] L${b.startLine}-${b.endLine} ${b.bytes}B  ${b.title.slice(0, 70)}\n`);
  return 0;
}

function cmdHeat(args, deps = {}) {
  const abs = resolveFile(args._[0] || args.file);
  if (!abs) return fail('heat: file not found or outside memory root');
  if (args.bump) { bumpHeat(abs, args.bump, { now: deps.now }); process.stdout.write(`bumped #${slugify(args.bump)}\n`); return 0; }
  const n = Number(args.top) || 5;
  const level = Number(args.level) || 3;
  const live = new Set(parseBlocks(fs.readFileSync(abs, 'utf8'), { level }).blocks.map((b) => b.shortAnchor));
  const hot = hotSet(abs, n, { liveAnchors: live });
  process.stdout.write(`hot-set (LRU top-${n}) of ${path.basename(abs)}:\n`);
  hot.forEach((a, i) => process.stdout.write(`  ${i + 1}. #${a}\n`));
  return 0;
}

function cmdCheck(args) {
  const abs = resolveFile(args._[0] || args.file);
  if (!abs) return fail('check: file not found or outside memory root');
  const text = fs.readFileSync(abs, 'utf8');
  const bytes = Buffer.byteLength(text, 'utf8');
  const lineCount = countLines(text);
  const maxLines = Number(args['max-lines']) || DEFAULT_MAX_LINES;
  const maxBytes = Number(args['max-bytes']) || DEFAULT_MAX_BYTES;
  const overLines = lineCount - maxLines;
  const overBytes = bytes - maxBytes;
  const ok = overLines <= 0 && overBytes <= 0;
  process.stdout.write(`${path.basename(abs)}: ${lineCount} lines / ${(bytes / 1024).toFixed(1)}KB (ceiling ${maxLines} lines / ${(maxBytes / 1024).toFixed(1)}KB) -> ${ok ? 'OK' : 'OVER'}\n`);
  if (!ok) {
    // rank the LOWEST-score H2 sections as demote candidates (invariant-protected excluded).
    const { blocks } = parseBlocks(text, { level: 2 });
    const cand = blocks
      .map((b) => ({ b, imp: importanceOf(b.title) }))
      .filter((x) => !x.imp.protected)
      .sort((a, b) => a.imp.weight - b.imp.weight || b.b.bytes - a.b.bytes);
    process.stdout.write(`  over by ${overLines > 0 ? overLines + ' lines' : ''}${overLines > 0 && overBytes > 0 ? ' / ' : ''}${overBytes > 0 ? (overBytes / 1024).toFixed(1) + 'KB' : ''}\n`);
    process.stdout.write('  demote candidates (lowest importance first; invariant sections protected):\n');
    for (const c of cand.slice(0, 6)) {
      process.stdout.write(`    [${c.imp.cls}] ${c.b.bytes}B  ## ${c.b.title.slice(0, 60)}\n`);
      process.stdout.write(`        -> memory demote --file ${path.basename(abs)} --anchor ${c.b.shortAnchor} --level 2 --to <topic-file>\n`);
    }
  }
  return ok ? 0 : 2;
}

const DEMOTED_HEADING = '## Demoted (pointers to relocated blocks)';

/**
 * Append a demote pointer to `srcText` under a DEDICATED `## Demoted` section (created if absent). The
 * pointer must NOT be spliced in-place where the block was: a plain line there is absorbed by parseBlocks
 * into the PRECEDING block's body, so a later demote of that sibling would carry the foreign pointer into
 * a third file. A dedicated shallower-heading section is a hard boundary no same-or-deeper block can absorb.
 */
function appendDemotePointer(srcText, block, destBase) {
  const pointer = `- [#${block.shortAnchor}] ${block.title.slice(0, 60)} -> [[${destBase}#${block.shortAnchor}]]`;
  const lines = srcText.split('\n');
  const hIdx = lines.findIndex((l) => l === DEMOTED_HEADING);
  if (hIdx !== -1) return [...lines.slice(0, hIdx + 1), pointer, ...lines.slice(hIdx + 1)].join('\n');
  return `${srcText.replace(/\n*$/, '')}\n\n${DEMOTED_HEADING}\n${pointer}\n`;
}

function cmdDemote(args) {
  const srcAbs = resolveFile(args.file || args.from);
  const destAbs = resolveFile(args.to, { create: true });
  if (!srcAbs || !destAbs) return fail('demote: --file and --to required, and both must resolve within the memory root (dest may be new)');
  if (path.basename(destAbs) === 'MEMORY.md' && !args.force) {
    return fail('demote: refusing to demote INTO MEMORY.md (demote moves content OUT of the hot index) -- pass --force to override');
  }
  const destDir = path.dirname(destAbs);
  if (!fs.existsSync(destDir)) return fail(`demote: dest directory does not exist: ${destDir}`);
  const level = Number(args.level) || 3;
  const text = fs.readFileSync(srcAbs, 'utf8');
  const want = slugify(args.anchor);
  const block = parseBlocks(text, { level }).blocks.find((b) => b.anchor === want || b.shortAnchor === want);
  if (!block) return fail(`demote: no block '#${args.anchor}' in ${path.basename(srcAbs)} at H${level} (try --level 2, or 'memory blocks ${path.basename(srcAbs)}')`);
  const destExisted = fs.existsSync(destAbs);
  const destText = destExisted ? fs.readFileSync(destAbs, 'utf8') : '';
  // collision guard: appending a duplicate anchor would make this block unreachable via recall (first-match wins).
  if (resolveBlock(destText, block.shortAnchor, { level })) {
    return fail(`demote: dest ${path.basename(destAbs)} already has #${block.shortAnchor} -- rename/renumber before moving (would be unreachable via recall)`);
  }
  // stage BOTH new contents in memory before any write.
  const body = block.body.replace(/\n*$/, '');
  const newDest = destExisted && destText.trim() ? `${destText.replace(/\n*$/, '')}\n\n${body}\n` : `${body}\n`;
  const srcLines = text.split('\n');
  srcLines.splice(block.startLine - 1, block.endLine - block.startLine + 1); // remove the block cleanly
  const newSrc = appendDemotePointer(srcLines.join('\n'), block, path.basename(destAbs, '.md'));
  // two-phase atomic write: never lose (src rewritten only AFTER dest commits) and never duplicate SILENTLY.
  // A src fault rolls the dest back to its prior state / removes a new dest; a rare DOUBLE fault is reported
  // loudly for manual reconcile (the honest residual -- true two-file atomicity needs a journal we do not keep).
  try {
    atomicWrite(destAbs, newDest);
  } catch (destErr) {
    return fail(`demote: dest write failed (no change made): ${destErr.message}`);
  }
  try {
    atomicWrite(srcAbs, newSrc);
  } catch (err) {
    try {
      if (destExisted) atomicWrite(destAbs, destText); else fs.unlinkSync(destAbs);
    } catch (rollbackErr) {
      return fail(`demote: src write FAILED and dest rollback FAILED -- reconcile from backup. src=${srcAbs} dest=${destAbs}; err=${err.message}; rollback=${rollbackErr.message}`);
    }
    return fail(`demote: src write failed, rolled back dest (no change made): ${err.message}`);
  }
  dropHeat(srcAbs, block.shortAnchor); // the block left src; drop its stale heat key.
  process.stdout.write(`demoted #${block.shortAnchor} (${block.bytes}B) ${path.basename(srcAbs)} -> ${path.basename(destAbs)}; pointer in '## Demoted', dest atomic\n`);
  return 0;
}

// substantive = a line worth auditing for preservation. Filter by SHAPE, not length, so terse-but-real
// lines (e.g. 'K3 dropped', a bare anchor ref) are still audited; only blanks, pointers, headings, and
// pure-structural rows (hr / table separators) are excluded.
function substantiveLines(text) {
  return String(text == null ? '' : text).split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= 3) // keep terse tokens; drop blanks + 1-2 char noise
    .filter((l) => !/^-\s*\[#/.test(l)) // demote pointer lines
    .filter((l) => !/^#{1,6}\s/.test(l)) // ATX headings
    .filter((l) => !/^[-=_*]{3,}$/.test(l)) // horizontal rules / setext underlines
    .filter((l) => !/^\|[-:| ]+\|?$/.test(l)); // markdown table separators
}

/**
 * The Phase-1 preservation gate (the concrete "diff-audit" the migration's data-safety promise rests on):
 * every substantive line of the pre-migration source (optionally scoped to a `--section`) must appear as a
 * WHOLE trimmed LINE somewhere in the `--against` after-set. Whole-line (NOT substring), so a line embedded
 * inside an unrelated longer line does NOT count as preserved. GUARANTEES: no substantive whole line
 * silently vanished. Does NOT: distinguish a reworded restatement from a drop (a reworded line is surfaced
 * for review), nor check semantics. Any unaccounted line exits 2.
 */
function cmdVerifyPreserved(args) {
  const backupAbs = resolveFile(args.backup);
  if (!backupAbs) return fail('verify-preserved: --backup not found or outside memory root');
  const against = String(args.against || '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((f) => resolveFile(f)).filter(Boolean);
  if (!against.length) return fail('verify-preserved: --against <f1,f2,...> required (files the moved prose now lives in, all within the memory root)');
  let backup = fs.readFileSync(backupAbs, 'utf8');
  if (args.section) {
    const blk = resolveBlock(backup, args.section, { level: 2 })
      || parseBlocks(backup, { level: 2 }).blocks.find((b) => b.title.toLowerCase().includes(String(args.section).toLowerCase()));
    if (blk) backup = blk.body;
  }
  const haystack = new Set(
    against.flatMap((f) => fs.readFileSync(f, 'utf8').split('\n')).map((l) => l.trim()),
  );
  const lines = substantiveLines(backup);
  const missing = lines.filter((l) => !haystack.has(l)); // WHOLE-LINE match (a substring of a longer line does NOT count)
  const preserved = lines.length - missing.length;
  process.stdout.write(`verify-preserved: ${preserved}/${lines.length} substantive lines from ${path.basename(backupAbs)}${args.section ? ` [${args.section}]` : ''} present as a whole line in the after-set\n`);
  if (missing.length) {
    process.stdout.write(`  ${missing.length} line(s) NOT found as a whole line -- review each (a reworded restatement is surfaced here by design; a silent drop is NOT OK):\n`);
    for (const m of missing.slice(0, 40)) process.stdout.write(`    - ${m.slice(0, 120)}\n`);
  }
  return missing.length ? 2 : 0;
}

// --------------------------------------------------------------------------
// argv + dispatch.
// --------------------------------------------------------------------------

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

const COMMANDS = {
  recall: cmdRecall, blocks: cmdBlocks, heat: cmdHeat, check: cmdCheck, demote: cmdDemote,
  'verify-preserved': cmdVerifyPreserved,
};

function main(argv) {
  const [cmd, ...rest] = argv;
  const handler = COMMANDS[cmd];
  if (!handler) {
    process.stderr.write('Usage: memory <recall|blocks|heat|check|demote|verify-preserved> ...\n'
      + "  recall '[[file#anchor]]'             resolve + print a block (bumps its heat)\n"
      + '  blocks <file> [--level N] [--check-unique]  list blocks / assert unique anchors\n'
      + '  heat <file> [--top N|--bump A]       show the LRU hot-set / bump an anchor\n'
      + '  check <file> [--max-lines N]         budget report + demote candidates (with the exact demote cmd)\n'
      + '  demote --file S --anchor A --to D [--level N]   MOVE a block (atomic; leaves a pointer; never deletes)\n'
      + '  verify-preserved --backup B --against f1,f2 [--section H]   audit that every line survived the move\n');
    return cmd ? 1 : 0;
  }
  return handler(parseArgv(rest));
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = {
  slugify, shortAnchorOf, countLines, parseBlocks, resolveBlock, findDuplicateAnchors, parsePointer,
  safe, withinRootPlain, atomicWrite, readHeat, writeHeatSafe, bumpHeat, dropHeat, hotSet, importanceOf,
  substantiveLines, appendDemotePointer, DEMOTED_HEADING, memDir, resolveFile,
  cmdRecall, cmdBlocks, cmdHeat, cmdCheck, cmdDemote, cmdVerifyPreserved, main,
  DEFAULT_MAX_LINES, DEFAULT_MAX_BYTES,
};
