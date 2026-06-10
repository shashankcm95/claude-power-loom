#!/usr/bin/env node

// scripts/validate-doc-paths.js
//
// Doc-path integrity gate. Scans the skill + command DOCS
// (packages/skills/commands/*.md + packages/skills/library/*/SKILL.md) for
// filesystem paths they CITE that no longer exist in the repo, and fails
// (exit 1) if any are found.
//
// WHY THIS EXISTS: the v4 workspace restructure (#158) moved files into
// `packages/...`, but skill/command docs are MARKDOWN — a doc that says
// "Read `swarm/super-agent.md`" is a string, not a `require`, so it does NOT
// throw MODULE_NOT_FOUND at migration time. Code refs broke loudly and were
// fixed (the migration-rot audit found 0 dead modules); doc refs broke
// SILENTLY and survived. This is the missing gate: it makes a stale doc-path
// a loud CI failure instead of a latent bug that only surfaces when the skill
// is actually run.
//
// CONSERVATIVE BY DESIGN (minimize false positives):
//   - Only path TOKENS rooted at a known repo top-level segment (swarm,
//     packages, scripts, agents, skills, docs, tests, bin, examples) or a
//     `~/Documents/claude-toolkit/`-prefixed / `../`-relative form are checked.
//   - A token with a PLACEHOLDER segment (`<x>` / `{x}` / `*` / `$x` / `...`)
//     is reduced to its longest placeholder-free PREFIX (the directory), and
//     that prefix is checked — so `swarm/personas-contracts/{NN}.json` flags
//     the dead `swarm/personas-contracts/` dir, while
//     `packages/skills/library/<name>/SKILL.md` checks the live
//     `packages/skills/library/` prefix and passes.
//   - `~/.claude/...` runtime paths are NOT checked (they are install-time,
//     not repo, paths).
//
// Usage:
//   node scripts/validate-doc-paths.js [--json]
//   exit 0 = clean; exit 1 = stale path(s) found.

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const TOOLKIT_PREFIX = '~/Documents/claude-toolkit/';
// The repo top-level segments a cited path may be rooted at.
const ROOTS = ['swarm', 'packages', 'scripts', 'agents', 'skills', 'docs', 'tests', 'bin', 'examples'];
// A path token: optional toolkit/relative prefix, then a ROOT segment, then path chars
// (including placeholder chars, which are stripped to a prefix later).
const PATH_RE = new RegExp(
  '(?:~/Documents/claude-toolkit/|(?:\\.\\./)+|\\./)?' // toolkit-prefix | one-or-more ../ | ./
  + '(?:' + ROOTS.join('|') + ')'
  + '/[A-Za-z0-9._/{}<>*$-]+',
  'g'
);
const PLACEHOLDER_RE = /[<>{}*$]|\.\.\.|…|YYYY/; // <x>/{x}/glob/ellipsis + YYYY date-template segments
// RUNTIME-GENERATED, gitignored paths a doc may legitimately cite (orchestration
// writes them at run time, e.g. swarm/run-state/<run-id>/). They are intentionally
// ABSENT from the repo / a clean CI checkout, so non-existence is NOT a staleness
// signal — exempt them. (Without this the gate passes locally, where the dir
// exists from prior runs, but FAILS in CI on a clean checkout.)
const EXEMPT_PREFIXES = ['swarm/run-state'];

/**
 * The longest leading path segment run that contains NO placeholder. Used so a
 * cited path with a `{NN}`/`<name>` segment still checks its concrete directory.
 * @param {string} p
 * @returns {string} the placeholder-free prefix (may equal p; may be '')
 */
function placeholderFreePrefix(p) {
  const segs = p.split('/');
  const keep = [];
  for (const s of segs) {
    if (PLACEHOLDER_RE.test(s)) break;
    keep.push(s);
  }
  return keep.join('/');
}

/**
 * Resolve a cited path token to an absolute repo path, or null if it is not a
 * repo-rooted path we can check (e.g. a `~/.claude/...` runtime path).
 * @param {string} token the raw cited path
 * @param {string} docDir absolute dir of the doc citing it (for `../` resolution)
 * @returns {string|null}
 */
function resolveToRepo(token, docDir) {
  let abs;
  if (token.startsWith(TOOLKIT_PREFIX)) abs = path.join(REPO_ROOT, token.slice(TOOLKIT_PREFIX.length));
  else if (token.startsWith('../') || token.startsWith('./')) abs = path.resolve(docDir, token);
  else if (ROOTS.includes(token.split('/')[0])) abs = path.join(REPO_ROOT, token); // bare repo-rooted token
  else return null;
  // Path-traversal / reproducibility guard (Gemini review #276): a `../`-bearing or
  // toolkit-prefixed token must not ESCAPE REPO_ROOT — else fs.existsSync would probe
  // arbitrary HOST paths (out-of-repo, non-reproducible across machines/CI). An escaping
  // token resolves to null (not checked), same as a `~/.claude/...` runtime path.
  const rel = path.relative(REPO_ROOT, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return abs;
}

/**
 * Find stale (cited-but-missing) path references in one doc.
 * @param {string} file absolute path to the doc
 * @returns {Array<{path:string, prefixChecked:string, line:number}>}
 */
const FILE_EXT_RE = /\.(md|js|json|sh|ts|mjs|cjs|yml|yaml)$/;
const CMD_BEFORE_RE = /\b(node|Read|cat|bash|sh|ls|grep|cd|source|run|open|edit|Write|import|require)\s+\S*$/i;
const URL_BEFORE_RE = /(https?:\/\/|[a-z0-9][a-z0-9.-]*\.(com|org|io|dev|net|ai)\/)\S*$/i;

/**
 * Is this match a genuine PATH reference (vs prose like "agents/skills" or a URL
 * fragment like "code.claude.com/docs/en/...")? A real ref is in a code span, a
 * markdown link, after a shell command word, OR carries a file extension.
 */
function isPathContext(before, token) {
  if (URL_BEFORE_RE.test(before)) return false;               // URL fragment, not a repo path
  const inCodeSpan = ((before.match(/`/g) || []).length % 2) === 1; // odd backticks -> inside `...`
  const afterLink = /\]\(\s*$/.test(before);                  // markdown link target ](...
  const afterCmd = CMD_BEFORE_RE.test(before);
  const hasExt = FILE_EXT_RE.test(token);
  return inCodeSpan || afterLink || afterCmd || hasExt;
}

/**
 * Find stale (cited-but-missing) path references in one doc.
 * @param {string} file absolute path to the doc
 * @returns {Array<{path:string, prefixChecked:string, line:number}>}
 */
function findStaleInFile(file) {
  let content;
  try { content = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const docDir = path.dirname(file);
  const lines = content.split('\n');
  const stale = [];
  const seen = new Set();
  lines.forEach((lineText, i) => {
    let m;
    PATH_RE.lastIndex = 0;
    while ((m = PATH_RE.exec(lineText)) !== null) {
      const before = lineText.slice(0, m.index);
      const token = m[0].replace(/[).,:;`'"]+$/, ''); // trim trailing markdown/punctuation
      if (before.endsWith('/usr/')) continue;          // `/usr/bin/...` system path (e.g. a #!/usr/bin/env shebang), not a repo path
      if (!isPathContext(before, token)) continue;    // skip prose + URL fragments
      const prefix = placeholderFreePrefix(token);
      if (!prefix || prefix.split('/').length < 2) continue; // need at least root/child
      const abs = resolveToRepo(prefix, docDir);
      if (!abs) continue;
      const rel = path.relative(REPO_ROOT, abs);
      if (EXEMPT_PREFIXES.some((p) => rel === p || rel.startsWith(p + '/'))) continue; // runtime/gitignored
      if (seen.has(abs)) continue;
      seen.add(abs);
      if (!fs.existsSync(abs)) stale.push({ path: token, prefixChecked: prefix, line: i + 1 });
    }
  });
  return stale;
}

/** Recursively collect *.md under a directory (returns [] if the dir is absent). */
function collectMarkdownTree(dir) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collectMarkdownTree(p));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

/**
 * Collect the docs to scan: the slash-command docs, each library skill's
 * SKILL.md, AND the agent-team `kb/` + `patterns/` convention trees — the
 * latter were a blind spot (#282 follow-up): they hold prescriptive,
 * copy-pasteable path references (e.g. spawn/challenger contract-verifier
 * commands) that rotted in the v4 restructure without any gate catching them.
 */
function collectDocs() {
  const out = [];
  const cmdDir = path.join(REPO_ROOT, 'packages/skills/commands');
  if (fs.existsSync(cmdDir)) {
    for (const f of fs.readdirSync(cmdDir)) if (f.endsWith('.md')) out.push(path.join(cmdDir, f));
  }
  const libDir = path.join(REPO_ROOT, 'packages/skills/library');
  if (fs.existsSync(libDir)) {
    for (const d of fs.readdirSync(libDir)) {
      const sk = path.join(libDir, d, 'SKILL.md');
      if (fs.existsSync(sk)) out.push(sk);
    }
  }
  const agentTeam = path.join(REPO_ROOT, 'packages/skills/library/agent-team');
  out.push(...collectMarkdownTree(path.join(agentTeam, 'kb')));
  out.push(...collectMarkdownTree(path.join(agentTeam, 'patterns')));
  return out;
}

// KNOWN-DEBT allowlist: files whose stale refs are TRACKED but do NOT fail the
// gate yet (so the gate can block NEW rot immediately while pre-existing debt is
// paid down separately). Each entry needs a reason + a follow-up.
// Currently EMPTY — the sole entry (agent-team/SKILL.md, ~86 changelog refs)
// was paid down 2026-06-09 by trimming the historical changelog (history lives
// in git + the library session-snapshots).
const KNOWN_DEBT = new Set([]);

function main() {
  const json = process.argv.includes('--json');
  const docs = collectDocs();
  const report = [];
  for (const file of docs) {
    const stale = findStaleInFile(file);
    if (stale.length) report.push({ file: path.relative(REPO_ROOT, file), stale, debt: KNOWN_DEBT.has(path.relative(REPO_ROOT, file)) });
  }
  const blocking = report.filter((r) => !r.debt);
  const debt = report.filter((r) => r.debt);
  const blockingCount = blocking.reduce((n, r) => n + r.stale.length, 0);
  const debtCount = debt.reduce((n, r) => n + r.stale.length, 0);
  if (json) {
    process.stdout.write(JSON.stringify({ scanned: docs.length, blocking_stale: blockingCount, known_debt_stale: debtCount, report }, null, 2) + '\n');
  } else {
    if (blockingCount === 0) process.stdout.write(`doc-path: clean (${docs.length} docs; 0 blocking stale refs)\n`);
    else {
      process.stdout.write(`doc-path: ${blockingCount} stale path reference(s) in ${blocking.length} doc(s):\n`);
      for (const r of blocking) for (const s of r.stale) process.stdout.write(`  ${r.file}:${s.line}  ${s.path}` + (s.prefixChecked !== s.path ? `  (dir ${s.prefixChecked} missing)` : '') + '\n');
    }
    if (debtCount) process.stdout.write(`doc-path: ${debtCount} KNOWN-DEBT ref(s) in ${debt.length} allowlisted doc(s) (tracked; not blocking): ${debt.map((r) => r.file).join(', ')}\n`);
  }
  process.exit(blockingCount === 0 ? 0 : 1);
}

if (require.main === module) main();

module.exports = { placeholderFreePrefix, resolveToRepo, findStaleInFile, collectDocs, REPO_ROOT };
