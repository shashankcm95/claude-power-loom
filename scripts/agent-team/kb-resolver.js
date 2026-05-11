#!/usr/bin/env node

// kb-resolver — content-addressed knowledge base resolver for agent-team.
// Implements the Shared Knowledge Base + Content-Addressed References patterns
// (skills/agent-team/patterns/{shared-knowledge-base, content-addressed-refs}.md).
//
// Storage:
//   ~/Documents/claude-toolkit/skills/agent-team/kb/
//     ├── manifest.json              — kb_id → {path, version, hash, tags}
//     └── <topic>/<doc>.md           — KB docs with frontmatter
//
// Snapshots:
//   ~/Documents/claude-toolkit/swarm/run-state/<run-id>/kb-snapshot.json
//
// Override locations via env vars:
//   HETS_KB_DIR              — KB root (default: ~/Documents/claude-toolkit/skills/agent-team/kb)
//   HETS_RUN_STATE_DIR       — run-state root (default: ~/Documents/claude-toolkit/swarm/run-state)
//
// Subcommands:
//   cat <kb_id>              — print doc body (full content; Tier 3)
//   cat-summary <kb_id>      — print only `## Summary` section (Tier 1; cheap inline)
//   cat-quick-ref <kb_id>    — print `## Summary` + `## Quick Reference` sections (Tier 2)
//   hash <kb_id>             — print SHA-256 of body
//   list [--tag X]           — list registered KB docs
//   resolve kb:<id>[@<h>]    — resolve a ref string; verify hash if pinned
//   scan                     — walk kb/ tree, refresh manifest
//   snapshot <run-id>        — freeze manifest to run-state
//   register <kb_id>         — register a single file (alt to scan)
//
// H.8.0 — tier-aware loading. Pattern docs in kb/architecture/ have a
// 3-tier structure: Summary (5-line dense bullets) / Quick Reference
// (30-50 line mid-density) / Full content (comprehensive prose). The
// new subcommands extract specific tiers so kb_scope injection can use
// the right size for each task. Per `_NOTES.md` measurement: tier-aware
// retrieval saves ~91% on average injection size (frequency-weighted).
//
// Graceful fallback: if a doc has no `## Quick Reference` section,
// `cat-quick-ref` falls back to just the `## Summary` section. If a
// doc has no `## Summary` section, both tier subcommands fall back to
// full body content (for backwards compat with older kb docs).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { withLock } = require('./_lib/lock'); // H.3.2 (CS-1 code-reviewer X-3)
// H.9.8: migrated 2 sites (writeManifestAtomic Class A1 lock-wrapped +
// cmdSnapshot Class A2 standalone CLI) from inline atomic-write pattern.
const { writeAtomic } = require('./_lib/atomic-write');
// H.8.7 (chaos H4): shared frontmatter parser. Replaced inline parseFrontmatter
// (see git history at H.8.6) — kb-resolver and adr.js previously had divergent
// implementations with different bugs; single canonical source closes drift.
const { parseFrontmatter } = require('./_lib/frontmatter');

// H.7.14 — `KB_BASE` second fallback now uses shared `findToolkitRoot()` helper
// (from `_lib/toolkit-root.js`) instead of hardcoded `~/Documents/claude-toolkit/`.
// Env override (HETS_KB_DIR) preserved as primary fallback.
const { findToolkitRoot } = require('./_lib/toolkit-root');
const KB_BASE = process.env.HETS_KB_DIR ||
  path.join(findToolkitRoot(), 'skills', 'agent-team', 'kb');
const MANIFEST_PATH = path.join(KB_BASE, 'manifest.json');
// H.5.5 (CS-2/CS-3 theo HIGH): single-source RUN_STATE_BASE via _lib/runState.
const { runStateDir } = require('./_lib/runState');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    } else {
      args._.push(argv[i]);
    }
  }
  return args;
}

// H.8.7 (chaos H4): parseFrontmatter extracted to ./_lib/frontmatter.js
// (see require at top of file). The previous inline implementation supported
// only inline arrays and stripped null literals as plain strings; the canonical
// parser supports block-lists, null → JS null, and digit-bearing keys.

function shaHashBody(body) {
  return crypto.createHash('sha256').update(body, 'utf8').digest('hex');
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return { version: 1, entries: {} };
  try { return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')); }
  catch (e) {
    console.error(`Corrupt manifest at ${MANIFEST_PATH}: ${e.message}. Refusing to advance.`);
    process.exit(2);
  }
}

// H.3.2 (CS-1 code-reviewer X-3): withLock wraps the read-modify-write
// to prevent two concurrent `scan` invocations from clobbering each other.
const MANIFEST_LOCK = MANIFEST_PATH + '.lock';
function writeManifestAtomic(manifest) {
  // H.9.8: defensive mkdirSync preserved per HT.2.3 HIGH-A2
  // (KB_BASE === path.dirname(MANIFEST_PATH); helper covers but explicit
  // decision-to-not-delete avoids future drift-note surfacing).
  fs.mkdirSync(KB_BASE, { recursive: true });
  withLock(MANIFEST_LOCK, () => {
    writeAtomic(MANIFEST_PATH, manifest);
  });
}

// H.3.2 (CS-1 hacker.zoe CRIT-3 + code-reviewer H-4):
// Path-traversal fix. `kbId` containing `..` would join to a path outside
// KB_BASE; `kb-resolver cat ../../etc/secrets` reads outside the KB. Boundary
// check via `path.resolve` ensures the resolved file lives under KB_BASE.
//
// H.3.6 (CS-2 hacker.ren CRIT-2): the lexical check above is symlink-blind.
// A symlink at `KB_BASE/escape -> /etc` lexically lives under KB_BASE, so
// `path.resolve(KB_BASE, "escape")` returns `KB_BASE/escape`; the check
// passes; the file read goes to /etc. Fix: after lexical check, follow
// symlinks via fs.realpathSync and re-verify the canonical path lives under
// realpath(KB_BASE). Lexical check is kept as the cheap first-pass defense
// for paths that don't exist (realpath throws on ENOENT).
function findDocPath(kbId) {
  const candidate = path.resolve(KB_BASE, kbId + '.md');
  const baseResolved = path.resolve(KB_BASE);
  // Lexical first-pass — refuses `..`-traversal even on missing files.
  // Trailing path.sep guard prevents `KB_BASE_extra` from matching `KB_BASE` as a prefix.
  if (!candidate.startsWith(baseResolved + path.sep) && candidate !== baseResolved) {
    return null;
  }
  if (!fs.existsSync(candidate)) return null;
  // Symlink-aware second-pass: canonicalize both sides and re-check boundary.
  let realCandidate, realBase;
  try {
    realCandidate = fs.realpathSync(candidate);
    realBase = fs.realpathSync(baseResolved);
  } catch {
    // realpath failed (broken symlink, race-deleted, perms) → refuse.
    return null;
  }
  if (!realCandidate.startsWith(realBase + path.sep) && realCandidate !== realBase) {
    return null;
  }
  return candidate;
}

function loadDoc(kbId) {
  const docPath = findDocPath(kbId);
  if (!docPath) return null;
  const text = fs.readFileSync(docPath, 'utf8');
  return parseFrontmatter(text);
}

function cmdCat(args) {
  const kbId = args._[0];
  if (!kbId) { console.error('Usage: cat <kb_id>'); process.exit(1); }
  const doc = loadDoc(kbId);
  if (!doc) { console.error(`Not found: ${kbId}`); process.exit(1); }
  process.stdout.write(doc.body);
  if (!doc.body.endsWith('\n')) process.stdout.write('\n');
}

/**
 * Extract a contiguous range of H2 sections from a doc body.
 *
 * Sections are bounded by `^## ` markers OUTSIDE fenced code blocks.
 * Returns body content from the START marker through the line BEFORE
 * the END marker (exclusive). The START section is included; the END
 * section is not.
 *
 * H.8.7 fixes (chaos H1 + M2):
 * - Fence-aware: lines starting with ``` toggle inFence state; section
 *   boundaries inside fences are ignored. Previously, ``` ## Heading ```
 *   inside a code block would falsely truncate the surrounding section.
 * - Start-name precision: the start regex now requires the heading name
 *   to be followed by end-of-string or whitespace + end-of-string only.
 *   Previously, `## Summary` would falsely match `## Summary of Findings`
 *   because of the `\b` word-boundary; now it matches `## Summary` and
 *   `## Summary  ` (trailing whitespace) but NOT `## Summary of X`.
 *
 * Example: extractSections(body, 'Summary', 'Intent') returns text from
 * `## Summary` through the line before `## Intent`.
 *
 * @param {string} body - Doc body (post-frontmatter)
 * @param {string} startName - H2 heading name marking start (without `## `)
 * @param {string} endName - H2 heading name marking end (without `## `); pass null to extract through next H2 of any name
 * @returns {string|null} Extracted section text, or null if startName not found
 */
// HT.1.11: memoize section-heading regex by name. Each call to extractSections
// previously recompiled startRe + endRe; called per cmdCatSummary / cmdCatQuickRef
// invocation. Keyspace is small (~5 unique section names: Summary, Quick Reference,
// etc.). Memoization eliminates per-call compile after first invocation. Behavior
// unchanged. Tier 3 cohort with validate-plan-schema + validate-kb-doc + verify-plan-gate.
const _sectionRegexCache = new Map();
function _getSectionRe(name) {
  if (!_sectionRegexCache.has(name)) {
    const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    _sectionRegexCache.set(name, new RegExp(`^## ${escapeRegExp(name)}\\s*$`));
  }
  return _sectionRegexCache.get(name);
}

function extractSections(body, startName, endName) {
  const lines = body.split('\n');
  // H.8.7 M2: precise start match — name followed by EOL or trailing whitespace
  // only. NOT prefix-match (which `\b` allowed for `Summary of Findings`).
  const startRe = _getSectionRe(startName);
  // End is an open boundary (any H2 if endName null) or precise (named end).
  const endRe = endName ? _getSectionRe(endName) : /^## /;
  // H.8.7 H1: track fence state so ``` blocks don't yield false section
  // boundaries. A line starting with ``` toggles the state; only `^## `
  // outside fences counts.
  let inFence = false;
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (startRe.test(lines[i])) { startIdx = i; break; }
  }
  if (startIdx === -1) return null;
  // Reset fence-state tracking for the end-search (in case the START
  // section contains its own fenced block; we re-scan from startIdx+1
  // tracking fences fresh).
  inFence = false;
  // Recheck whether the start line itself was inside a fence by walking
  // from line 0 to startIdx and tracking; but since startIdx was matched
  // OUTSIDE a fence above, it's by definition outside one. We track from
  // scratch starting at startIdx+1.
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (endRe.test(lines[i])) { endIdx = i; break; }
  }
  return lines.slice(startIdx, endIdx).join('\n').trimEnd() + '\n';
}

function cmdCatSummary(args) {
  const kbId = args._[0];
  if (!kbId) { console.error('Usage: cat-summary <kb_id>'); process.exit(1); }
  const doc = loadDoc(kbId);
  if (!doc) { console.error(`Not found: ${kbId}`); process.exit(1); }
  // Try Summary → next H2; fall back to full body if no Summary section
  const summary = extractSections(doc.body, 'Summary', null);
  if (summary === null) {
    process.stderr.write(`Warning: ${kbId} has no '## Summary' section; returning full body.\n`);
    process.stdout.write(doc.body);
    if (!doc.body.endsWith('\n')) process.stdout.write('\n');
    return;
  }
  process.stdout.write(summary);
}

function cmdCatQuickRef(args) {
  const kbId = args._[0];
  if (!kbId) { console.error('Usage: cat-quick-ref <kb_id>'); process.exit(1); }
  const doc = loadDoc(kbId);
  if (!doc) { console.error(`Not found: ${kbId}`); process.exit(1); }
  // Strategy: if Quick Reference exists, return Summary through end of Quick Reference.
  // Otherwise, fall back to just Summary (which is what cat-summary returns).
  const quickRef = extractSections(doc.body, 'Quick Reference', null);
  if (quickRef !== null) {
    // Quick Reference exists — emit Summary + Quick Reference together.
    // Find Summary; Summary should come before Quick Reference.
    const summary = extractSections(doc.body, 'Summary', 'Quick Reference');
    if (summary !== null) {
      process.stdout.write(summary);
      process.stdout.write(quickRef);
      return;
    }
    // No Summary but Quick Reference exists — unusual; emit just Quick Reference.
    process.stdout.write(quickRef);
    return;
  }
  // No Quick Reference — fall back to Summary only.
  const summary = extractSections(doc.body, 'Summary', null);
  if (summary !== null) {
    process.stderr.write(`Note: ${kbId} has no '## Quick Reference' section; returning Summary only.\n`);
    process.stdout.write(summary);
    return;
  }
  // No Summary either — final fallback to full body.
  process.stderr.write(`Warning: ${kbId} has no '## Summary' or '## Quick Reference' sections; returning full body.\n`);
  process.stdout.write(doc.body);
  if (!doc.body.endsWith('\n')) process.stdout.write('\n');
}

function cmdHash(args) {
  const kbId = args._[0];
  if (!kbId) { console.error('Usage: hash <kb_id>'); process.exit(1); }
  const doc = loadDoc(kbId);
  if (!doc) { console.error(`Not found: ${kbId}`); process.exit(1); }
  const hash = shaHashBody(doc.body);
  console.log(JSON.stringify({ kb_id: kbId, hash, shortHash: hash.slice(0, 8) }, null, 2));
}

function cmdList(args) {
  const manifest = loadManifest();
  const tag = args.tag;
  const out = {};
  for (const [id, entry] of Object.entries(manifest.entries)) {
    if (tag && !(entry.tags || []).includes(tag)) continue;
    out[id] = { version: entry.version, shortHash: entry.shortHash, tags: entry.tags };
  }
  console.log(JSON.stringify({ count: Object.keys(out).length, entries: out }, null, 2));
}

function cmdResolve(args) {
  const ref = args._[0];
  if (!ref || !ref.startsWith('kb:')) {
    console.error('Usage: resolve kb:<id>[@<short-hash>]');
    process.exit(1);
  }
  const refBody = ref.slice(3);
  const [kbId, requestedHash] = refBody.split('@');
  const doc = loadDoc(kbId);
  if (!doc) {
    console.log(JSON.stringify({ ref, status: 'not_found', kb_id: kbId }, null, 2));
    process.exit(1);
  }
  const actualHash = shaHashBody(doc.body);
  if (requestedHash && !actualHash.startsWith(requestedHash)) {
    console.log(JSON.stringify({
      ref,
      status: 'hash_mismatch',
      requested: requestedHash,
      actual: actualHash.slice(0, 8),
    }, null, 2));
    process.exit(2);
  }
  console.log(JSON.stringify({
    ref,
    status: 'ok',
    kb_id: kbId,
    hash: actualHash,
    shortHash: actualHash.slice(0, 8),
    bodyBytes: doc.body.length,
  }, null, 2));
  console.log('---BODY---');
  process.stdout.write(doc.body);
  if (!doc.body.endsWith('\n')) process.stdout.write('\n');
}

function walkKb(dir, base, out) {
  if (!fs.existsSync(dir)) return;
  for (const item of fs.readdirSync(dir)) {
    if (item.startsWith('.') || item === 'manifest.json' || item === 'README.md') continue;
    const itemPath = path.join(dir, item);
    const stat = fs.statSync(itemPath);
    if (stat.isDirectory()) {
      walkKb(itemPath, base ? `${base}/${item}` : item, out);
    } else if (item.endsWith('.md')) {
      const text = fs.readFileSync(itemPath, 'utf8');
      const parsed = parseFrontmatter(text);
      const baseName = item.replace(/\.md$/, '');
      const expectedId = base ? `${base}/${baseName}` : baseName;
      const declaredId = parsed.frontmatter.kb_id;
      if (declaredId && declaredId !== expectedId) {
        console.error(`Warning: ${itemPath} declares kb_id "${declaredId}" but path implies "${expectedId}"`);
      }
      const id = declaredId || expectedId;
      const hash = shaHashBody(parsed.body);
      out[id] = {
        path: base ? `${base}/${item}` : item,
        version: parseInt(parsed.frontmatter.version || '1', 10),
        hash,
        shortHash: hash.slice(0, 8),
        tags: parsed.frontmatter.tags || [],
        lastUpdated: new Date().toISOString(),
      };
    }
  }
}

function cmdScan() {
  const manifest = loadManifest();
  const newEntries = {};
  walkKb(KB_BASE, '', newEntries);
  manifest.entries = newEntries;
  writeManifestAtomic(manifest);
  console.log(JSON.stringify({
    action: 'scan',
    docCount: Object.keys(newEntries).length,
    docs: Object.keys(newEntries).sort(),
  }, null, 2));
}

function cmdSnapshot(args) {
  const runId = args._[0];
  if (!runId) { console.error('Usage: snapshot <run-id>'); process.exit(1); }
  const manifest = loadManifest();
  const snapshotPath = path.join(runStateDir(runId), 'kb-snapshot.json');
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  const snapshot = {
    snapshotAt: new Date().toISOString(),
    runId,
    entries: Object.fromEntries(
      Object.entries(manifest.entries).map(([id, e]) => [id, {
        path: e.path,
        version: e.version,
        hash: e.hash,
        shortHash: e.shortHash,
      }])
    ),
  };
  // H.9.8: migrated to writeAtomic; Class A2 standalone CLI (no envelope;
  // helper auto-mkdir covers parent dir).
  writeAtomic(snapshotPath, snapshot);
  console.log(JSON.stringify({
    action: 'snapshot',
    runId,
    snapshotPath,
    entryCount: Object.keys(snapshot.entries).length,
  }, null, 2));
}

function cmdRegister(args) {
  const kbId = args._[0];
  if (!kbId) { console.error('Usage: register <kb_id>'); process.exit(1); }
  const doc = loadDoc(kbId);
  if (!doc) {
    console.error(`File not found at expected path: ${path.join(KB_BASE, kbId + '.md')}`);
    process.exit(1);
  }
  const manifest = loadManifest();
  const hash = shaHashBody(doc.body);
  const declaredId = doc.frontmatter.kb_id;
  if (declaredId && declaredId !== kbId) {
    console.error(`Frontmatter kb_id "${declaredId}" mismatches expected "${kbId}". Refusing to register.`);
    process.exit(1);
  }
  manifest.entries[kbId] = {
    path: kbId + '.md',
    version: parseInt(doc.frontmatter.version || '1', 10),
    hash,
    shortHash: hash.slice(0, 8),
    tags: doc.frontmatter.tags || [],
    lastUpdated: new Date().toISOString(),
  };
  writeManifestAtomic(manifest);
  console.log(JSON.stringify({
    action: 'register',
    kb_id: kbId,
    hash,
    shortHash: hash.slice(0, 8),
  }, null, 2));
}

const cmd = process.argv[2];
const args = parseArgs(process.argv.slice(3));

switch (cmd) {
  case 'cat': cmdCat(args); break;
  case 'cat-summary': cmdCatSummary(args); break;
  case 'cat-quick-ref': cmdCatQuickRef(args); break;
  case 'hash': cmdHash(args); break;
  case 'list': cmdList(args); break;
  case 'resolve': cmdResolve(args); break;
  case 'scan': cmdScan(); break;
  case 'snapshot': cmdSnapshot(args); break;
  case 'register': cmdRegister(args); break;
  default:
    console.error('Usage: kb-resolver.js {cat|cat-summary|cat-quick-ref|hash|list|resolve|scan|snapshot|register} [args]');
    console.error('  cat <kb_id>             — print doc body (Tier 3 — full)');
    console.error('  cat-summary <kb_id>     — print Summary section only (Tier 1 — cheap)');
    console.error('  cat-quick-ref <kb_id>   — print Summary + Quick Reference (Tier 2 — mid)');
    console.error('  hash <kb_id>            — print SHA-256 of body');
    console.error('  list [--tag X]          — list registered KB docs');
    console.error('  resolve kb:<id>[@<h>]   — resolve a ref string');
    console.error('  scan                    — walk kb/ tree, refresh manifest');
    console.error('  snapshot <run-id>       — freeze manifest to run-state');
    console.error('  register <kb_id>        — register a single file (alt to scan)');
    console.error('Env: HETS_KB_DIR, HETS_RUN_STATE_DIR override defaults.');
    process.exit(1);
}
