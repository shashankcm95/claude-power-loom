#!/usr/bin/env node

'use strict';

// lint-gate-prepush.js — the git-native pre-push lint gate (v1, toolkit-only).
//
// WHAT: invoked by `.git/hooks/pre-push` (installed by `install.sh --git-hooks`
// from the version-controlled `.githooks/pre-push` shim). Git hands the shim the
// pushed refs on stdin (one line `<localref> <localsha> <remoteref> <remotesha>`
// per ref); the shim execs this Node module. This module derives the changed-file
// set from the pushed range, runs the toolkit's own reviewed linters on it, and
// exits non-zero (blocking the push) on a lint failure.
//
// HONEST FRAMING (do NOT over-claim): this is FAST-FEEDBACK, not a security
// boundary. CI eslint/markdownlint is the real gate; this only moves a lint
// failure from "minutes later on a PR" to "the moment you push," reducing the
// `drift:lint-gate-not-run-pre-push` churn. `git push --no-verify` is the native
// escape (a PostToolUse:Bash observer logs its use so over-use resurfaces to
// /self-improve). It enforces against FORGETTING, not EVASION.
//
// TWO VERIFY findings are pinned here (see tests/unit/kernel/lint-gate-prepush.test.js):
//   - CR-1 (CRITICAL): a git range/merge-base ERROR full-lints (fail-toward-running),
//     NEVER collapses to an empty changed-set = silent approve. "diff succeeded, 0
//     files" (skip) is distinguished from "diff errored" (full).
//   - H-A (HIGH): at the DECISION layer each changed file is bound to ITS OWN
//     ref-line's local sha (never a unioned list against one surviving loop-sha).
//     This binding is COMPUTED + unit-tested — but it is NOT yet enforced through to
//     the lint (see the working-tree residual below): the sha is not consumed by the
//     linters in v1. Honest scope: the SET derivation is per-ref-correct; the lint
//     content is the working tree.
//
// NAMED RESIDUALS (v1 — this is FAST-FEEDBACK, not a security boundary; CI backstops):
//   - WORKING-TREE, NOT PUSHED-SHA. The linters run against the WORKING-TREE content
//     of the changed, still-existing paths — NOT the pushed blob at its ref-sha
//     (linters need real repo paths for config resolution). For the common
//     single-branch HEAD push, working tree == pushed sha, so they coincide. The
//     divergence is the exotic non-HEAD/multi-ref push, where a blob different from
//     the working tree can reach the remote UNLINTED locally (a fast-feedback gap,
//     NOT a security bypass — the dev can --no-verify anyway, and CI lints the pushed
//     result). Consuming the (path,sha) binding via `git show <sha>:<path>` is the
//     deferred close; the binding is already computed so a future pass can adopt it.
//   - The lint-relevant globs are `.js` (eslint) + `.md` (markdownlint + yaml
//     frontmatter). `.sh`/`.json`/`.ts`/`.yml` changes slip the LOCAL gate (CI catches
//     them) — the M-A residual.
//   - DEFERRED: a generic `install.sh --git-hooks <repo>` template (a repo-authored
//     lint command revives the v1 RCE-on-push surface — needs its own trust-gate).
//
// Design anchors: plan packages/specs/plans/2026-07-03-lint-gate-prepush-hook.md §10;
// ADR-0001 (fail-open discipline — the §G-D divergence is argued in the plan).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { log } = require('../hooks/_lib/_log.js');

const logger = log('lint-gate-prepush');

// An all-zeros object id (any hash length: sha1 = 40, sha256 = 64). Git uses it
// for the "other side does not exist" sentinel: local-zeros = a delete, remote-
// zeros = a new branch.
const ZERO_RE = /^0+$/;
const DEFAULT_MAIN_REF = 'main';

// Bounded subprocess timeouts — a git-native pre-push hook has NO harness cap, so a
// stalled `npx`/linter/git must not hang the push forever. On timeout spawnSync sets
// `error` (ETIMEDOUT): a linter timeout -> unavailable (fail-open + NOTE); a git
// timeout -> throw -> full-lint (CR-1, fail-toward-running).
const LINT_TIMEOUT_MS = 120_000;
const GIT_TIMEOUT_MS = 30_000;

// Directory prefixes the toolkit's own reviewed lint commands exclude
// (mirrors CI: eslint `--ignore-pattern bench/runs/**`; markdownlint
// `#node_modules #swarm #packages/specs`). Applied to the SCOPED file lists so
// the local gate matches CI scope and never fails on explicitly-ignored files.
const ESLINT_EXCLUDE = ['node_modules/', 'bench/runs/'];
const MARKDOWNLINT_EXCLUDE = ['node_modules/', 'swarm/', 'packages/specs/'];

const NO_VERIFY_NOTE =
  'Fix the lint errors above, or (if this is intentional WIP) re-run with `git push --no-verify`. '
  + 'The gate is fast-feedback, not a security boundary — CI still lints on the PR.';

// ---------------------------------------------------------------------------
// Pure decision core (unit-tested; no I/O — the `git` dependency is injected).
// ---------------------------------------------------------------------------

/** Parse one pre-push stdin ref-line into its 4 fields, or null if malformed. */
function parseRefLine(line) {
  if (typeof line !== 'string') return null;
  const parts = line.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 4) return null; // exactly 4; a line with extra fields is malformed
  const [localRef, localSha, remoteRef, remoteSha] = parts;
  return { localRef, localSha, remoteRef, remoteSha };
}

/** Classify a parsed ref-line into an action. Order matters: delete, then tag,
 *  then new-branch, then a normal range. */
function classifyRef(parsed, { mainRef = DEFAULT_MAIN_REF } = {}) {
  const { localRef, localSha, remoteSha } = parsed;
  if (ZERO_RE.test(localSha)) return { kind: 'skip', reason: 'delete' };
  if (localRef.startsWith('refs/tags/')) return { kind: 'skip', reason: 'tag' };
  if (ZERO_RE.test(remoteSha)) return { kind: 'new-branch', localSha, mainRef };
  return { kind: 'range', remoteSha, localSha };
}

function short(sha) { return String(sha).slice(0, 7); }

/** Resolve one range's changed files into the accumulator, binding each file to
 *  `toSha` (H-A). A git error routes to full-lint via markFull (CR-1). */
function collectRange(git, fromSha, toSha, files, errors, markFull) {
  let changed;
  try {
    changed = git.diffNames(fromSha, toSha);
  } catch (e) {
    errors.push(`diff ${short(fromSha)}..${short(toSha)} failed: ${e.message}`);
    markFull();
    return;
  }
  for (const p of changed) files.push({ path: p, sha: toSha });
}

/**
 * Decide what to lint from the pushed refs.
 * @returns {{mode:'skip'|'scoped'|'full', files:{path,sha}[], errors:string[], skipped:{ref,reason}[]}}
 */
function decideLintScope({ stdinText, git, mainRef = DEFAULT_MAIN_REF }) {
  const lines = String(stdinText || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const files = [];
  const errors = [];
  const skipped = [];
  let full = false;
  const markFull = () => { full = true; };

  for (const line of lines) {
    const parsed = parseRefLine(line);
    if (!parsed) {
      errors.push(`malformed ref-line (cannot scope): ${line.slice(0, 60)}`);
      full = true;
      continue;
    }
    const action = classifyRef(parsed, { mainRef });
    if (action.kind === 'skip') {
      skipped.push({ ref: parsed.localRef, reason: action.reason });
      continue;
    }
    if (action.kind === 'new-branch') {
      let base;
      try {
        base = git.mergeBase(action.localSha, mainRef);
      } catch (e) {
        errors.push(`merge-base(${short(action.localSha)}, ${mainRef}) failed: ${e.message}`);
        full = true;
        continue;
      }
      if (!base) {
        errors.push(`no merge-base for ${short(action.localSha)} against ${mainRef}`);
        full = true;
        continue;
      }
      collectRange(git, base, action.localSha, files, errors, markFull);
      continue;
    }
    collectRange(git, action.remoteSha, action.localSha, files, errors, markFull);
  }

  if (full) return { mode: 'full', files: [], errors, skipped };
  if (files.length > 0) return { mode: 'scoped', files, errors, skipped };
  return { mode: 'skip', files: [], errors, skipped };
}

/** Group changed files by the linter that owns their extension (deduped). */
function planLint(files) {
  const eslint = new Set();
  const markdownlint = new Set();
  for (const f of files) {
    const ext = path.extname(f.path);
    if (ext === '.js') eslint.add(f.path);
    else if (ext === '.md') markdownlint.add(f.path);
  }
  const md = [...markdownlint];
  return { eslint: [...eslint], markdownlint: md, yaml: md };
}

// ---------------------------------------------------------------------------
// I/O shell (integration-tested against a real bare remote; not unit-mocked).
// ---------------------------------------------------------------------------

function realGit(repoRoot) {
  const run = (args) => {
    const res = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: GIT_TIMEOUT_MS });
    if (res.error) throw res.error;
    if (res.status !== 0) throw new Error((res.stderr || `git ${args[0]} exited ${res.status}`).trim().slice(0, 200));
    return res.stdout;
  };
  return {
    diffNames(from, to) {
      return run(['diff', '--name-only', `${from}..${to}`]).split('\n').map((l) => l.trim()).filter(Boolean);
    },
    mergeBase(sha, ref) {
      return run(['merge-base', sha, ref]).trim();
    },
  };
}

function notExcluded(prefixes) {
  return (p) => !prefixes.some((pre) => p === pre || p.startsWith(pre));
}

/** Run one linter subprocess; on non-zero (or spawn error) push a failure with
 *  the captured output. Returns nothing (accumulates into `failures`). */
function runLinter(spawn, repoRoot, name, cmd, args, failures) {
  const res = spawn(cmd, args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: LINT_TIMEOUT_MS });
  if (res.error) {
    // Spawn itself failed (e.g. npx/tool unavailable) — a hook-internal error,
    // NOT a lint failure. Fail-OPEN (do not block the push, G-D), but make the
    // skip OBSERVABLE (security.md: a fail-open decision must not be silent) so
    // the developer knows this linter did not run and CI is the only net.
    logger('linter_unavailable', { name, error: res.error.message });
    process.stderr.write(`[lint-gate] ${name} unavailable (${res.error.code || res.error.message}) -- SKIPPED locally (CI still lints).\n`);
    return;
  }
  if (res.status !== 0) {
    const out = `${res.stdout || ''}${res.stderr || ''}`.trim();
    failures.push({ name, output: out.slice(0, 4000) });
  }
}

function runEslint(spawn, repoRoot, files, mode, failures) {
  const base = ['--yes', 'eslint@9'];
  const ignore = ['--ignore-pattern', 'bench/runs/**'];
  if (mode === 'full') {
    runLinter(spawn, repoRoot, 'eslint', 'npx', [...base, '.', ...ignore], failures);
    return;
  }
  const scoped = files.filter(notExcluded(ESLINT_EXCLUDE));
  if (scoped.length === 0) return;
  runLinter(spawn, repoRoot, 'eslint', 'npx', [...base, ...scoped, ...ignore], failures);
}

function runMarkdownlint(spawn, repoRoot, files, mode, failures) {
  if (mode === 'full') {
    const globs = ['**/*.md', '#node_modules', '#swarm', '#packages/specs'];
    runLinter(spawn, repoRoot, 'markdownlint', 'npx', ['--yes', 'markdownlint-cli2', ...globs], failures);
    return;
  }
  const scoped = files.filter(notExcluded(MARKDOWNLINT_EXCLUDE));
  if (scoped.length === 0) return;
  runLinter(spawn, repoRoot, 'markdownlint', 'npx', ['--yes', 'markdownlint-cli2', ...scoped], failures);
}

/** Extract the YAML frontmatter block (between the first two `---` lines) from a
 *  file's text, or null if there is none. */
function extractFrontmatter(text) {
  const lines = String(text).split(/\r?\n/); // tolerate CRLF-committed .md files
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end === -1) return null;
  return lines.slice(1, end).join('\n');
}

/** yaml-lint the frontmatter of the changed .md files (mirrors smoke Test 83,
 *  scoped). Materializes frontmatter blocks into a temp dir with try/finally
 *  cleanup, then runs `npx yaml-lint` once across them. */
function runYaml(spawn, repoRoot, files, mode, failures) {
  let mdFiles = files.filter(notExcluded(MARKDOWNLINT_EXCLUDE));
  if (mode === 'full') {
    const res = spawn('git', ['ls-files', '*.md'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: GIT_TIMEOUT_MS });
    if (res.error || res.status !== 0) {
      logger('yaml_enumerate_failed', {});
      process.stderr.write('[lint-gate] yaml frontmatter enumeration failed -- SKIPPED locally (CI still lints).\n');
      return;
    }
    mdFiles = res.stdout.split('\n').map((l) => l.trim()).filter(Boolean).filter(notExcluded(MARKDOWNLINT_EXCLUDE));
  }
  if (mdFiles.length === 0) return;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-prepush-yaml-'));
  try {
    let n = 0;
    for (const rel of mdFiles) {
      let text;
      try { text = fs.readFileSync(path.join(repoRoot, rel), 'utf8'); } catch { continue; }
      const fm = extractFrontmatter(text);
      if (fm === null) continue;
      n += 1;
      fs.writeFileSync(path.join(tmp, `fm-${n}.yaml`), fm);
    }
    if (n === 0) return;
    // Pass an explicit file list (NOT a shell glob) so no `shell: true` is needed
    // — robust to a temp path containing spaces/shell metacharacters.
    const yamlFiles = fs.readdirSync(tmp).filter((f) => f.endsWith('.yaml')).map((f) => path.join(tmp, f));
    if (yamlFiles.length === 0) return;
    const res = spawn('npx', ['--yes', 'yaml-lint', ...yamlFiles], {
      cwd: repoRoot, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: LINT_TIMEOUT_MS,
    });
    if (res.error) {
      logger('linter_unavailable', { name: 'yaml-lint', error: res.error.message });
      process.stderr.write(`[lint-gate] yaml-lint unavailable (${res.error.code || res.error.message}) -- SKIPPED locally (CI still lints).\n`);
      return;
    }
    if (res.status !== 0) {
      failures.push({ name: 'yaml-lint (frontmatter)', output: `${res.stdout || ''}${res.stderr || ''}`.trim().slice(0, 4000) });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function runLint({ mode, plan, repoRoot, spawn = spawnSync }) {
  const failures = [];
  if (mode === 'skip') return { ok: true, failures };
  runEslint(spawn, repoRoot, plan.eslint, mode, failures);
  runMarkdownlint(spawn, repoRoot, plan.markdownlint, mode, failures);
  runYaml(spawn, repoRoot, plan.yaml, mode, failures);
  return { ok: failures.length === 0, failures };
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

/** Resolve the base branch for a new-branch merge-base from the remote's default
 *  branch (origin/HEAD, e.g. `origin/main`); fall back to the literal default so
 *  a repo whose default is `trunk`/`master` (or one with origin/HEAD unset) does
 *  not error on every new-branch push. */
function resolveMainRef(repoRoot) {
  try {
    const res = spawnSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: repoRoot, encoding: 'utf8', timeout: GIT_TIMEOUT_MS });
    if (res.status === 0) {
      const ref = res.stdout.trim();
      if (ref) return ref;
    }
  } catch { /* fall through to the default */ }
  return DEFAULT_MAIN_REF;
}

/** Drop changed paths that no longer exist in the working tree. A pure-delete
 *  commit lists the removed file in the diff, but its content is gone — linting
 *  it would false-block the push (a deleted file cannot be linted). */
function filterExisting(files, repoRoot, existsFn) {
  const exists = existsFn || ((p) => fs.existsSync(p));
  return files.filter((f) => exists(path.join(repoRoot, f.path)));
}

function main() {
  try {
    const topRes = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: GIT_TIMEOUT_MS });
    const root = (topRes.status === 0 && topRes.stdout.trim()) || process.cwd();
    const stdinText = readStdin();
    const decision = decideLintScope({ stdinText, git: realGit(root), mainRef: resolveMainRef(root) });

    if (decision.mode === 'skip') {
      logger('approve', { mode: 'skip', skipped: decision.skipped });
      process.exit(0);
    }

    // Lint only changed files that STILL EXIST in the working tree (a delete is
    // in the diff but gone from disk). The linters consume the working tree, so a
    // gone file cannot be linted; this also prevents a pure-delete false-block.
    const toLint = decision.mode === 'full' ? decision.files : filterExisting(decision.files, root);

    // Consume the (path,sha) binding: if any linted file's pushed sha differs from the
    // checked-out HEAD, the working-tree lint may not reflect that ref's pushed content
    // (the non-HEAD/multi-ref residual). Surface it honestly rather than silently.
    const headRes = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: GIT_TIMEOUT_MS });
    const head = headRes.status === 0 ? headRes.stdout.trim() : null;
    if (head && toLint.some((f) => f.sha !== head)) {
      process.stderr.write(
        '[lint-gate] NOTE: a pushed ref differs from HEAD -- linting the WORKING TREE, which may not '
        + 'match the exact pushed content on that ref (CI lints the pushed result).\n'
      );
    }

    const plan = planLint(toLint);
    logger('linting', { mode: decision.mode, files: toLint.length, errors: decision.errors });
    const result = runLint({ mode: decision.mode, plan, repoRoot: root });

    if (result.ok) {
      logger('approve', { mode: decision.mode, linted: toLint.length });
      process.exit(0);
    }

    logger('block', { mode: decision.mode, failures: result.failures.map((f) => f.name) });
    for (const f of result.failures) {
      process.stderr.write(`\n[lint-gate] ${f.name} failed:\n${f.output}\n`);
    }
    process.stderr.write(`\n[lint-gate] Blocking push (${result.failures.length} linter(s) failed). ${NO_VERIFY_NOTE}\n`);
    process.exit(1);
  } catch (err) {
    // Fail-OPEN on any hook-internal error (G-D / ADR-0001): a lint gate that
    // bricked pushes on its own bug would be worse than the drift it closes.
    logger('error_fail_open', { error: err && err.message });
    process.stderr.write(`[lint-gate] internal error, allowing push (fail-open): ${err && err.message}\n`);
    process.exit(0);
  }
}

module.exports = {
  ZERO_RE,
  parseRefLine,
  classifyRef,
  decideLintScope,
  planLint,
  filterExisting,
  extractFrontmatter,
  runLint,
};

if (require.main === module) main();
