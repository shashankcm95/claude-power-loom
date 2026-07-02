'use strict';

// tests/unit/kernel/egress/gh-emit.test.js — ③.2.5c the gh-REST emission MECHANISM + #405 the modify-diff applier.
// The live network is NEVER touched: a mock `runGh` (deps.runGh) returns canned gh-api JSON (incl. a contents?ref=
// base-content responder) and records every call, so the sequence + the argv discipline + the self-check + the
// EXACT positional reconstruction (parse + apply) + dedup + rollback are all unit-provable offline. runGh's OWN
// fail-closed contract is exercised against a guaranteed-local gh failure.

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const G = require(path.join(REPO, 'packages', 'kernel', 'egress', 'gh-emit.js'));
const { computeEmissionHash } = require(path.join(REPO, 'packages', 'kernel', 'egress', 'approval.js'));

let passed = 0; let failed = 0; let skipped = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function b64(s) { return Buffer.from(s, 'utf8').toString('base64'); }

// A new-file-add diff whose 3rd body line ITSELF starts with `+` (the HIGH-4 case a `startsWith('+++')` test would drop).
const NEWFILE_DIFF = [
  'diff --git a/loom-dogfood.md b/loom-dogfood.md',
  'new file mode 100644',
  'index 0000000..1111111',
  '--- /dev/null',
  '+++ b/loom-dogfood.md',
  '@@ -0,0 +1,3 @@',
  '+# Dogfood',
  '+a normal line',
  '+++ a body line that starts with a plus',
  '',
].join('\n');

// A clean MODIFY diff (#405 probe 1): change line 2, append line 4. base "line1\nline2\nline3\n".
const MODIFY_BASE = 'line1\nline2\nline3\n';
const MODIFY_DIFF = [
  'diff --git a/f.txt b/f.txt',
  'index 1111111..2222222 100644',
  '--- a/f.txt',
  '+++ b/f.txt',
  '@@ -1,3 +1,4 @@',
  ' line1',
  '-line2',
  '+LINE-TWO-CHANGED',
  ' line3',
  '+line4-added',
  '',
].join('\n');
const MODIFY_EXPECTED = 'line1\nLINE-TWO-CHANGED\nline3\nline4-added\n';

const GOOD_REPO = 'owner/repo';
const GOOD_ISSUE = 42;
function draftFor(diff) { return { repo: GOOD_REPO, issueRef: GOOD_ISSUE, diff, title: 't', touched_paths: [] }; }
function hashFor(diff) { return computeEmissionHash(draftFor(diff)); }

// PURE-applier helpers (no mock): parse a single-stanza diff and apply it to `base`.
function singleStanza(diff) { const s = G.parseDiffStanzas(diff); assert.strictEqual(s.length, 1, 'one stanza'); return s[0]; }
function applyDiff(diff, base) { return G.applyHunks(base, singleStanza(diff).hunks); }
function applyAdd(diff) { const st = singleStanza(diff); assert.strictEqual(st.type, 'add'); return G.applyHunks('', st.hunks); }

// A configurable mock gh: records calls, dispatches on the endpoint (args[1]) + method, can trigger a
// ref-already-exists 422 / a pulls failure, and serves base content for `contents?ref=` (the #405 modify fetch).
function makeGh({ repo = GOOD_REPO, defaultBranch = 'main', refExists = false, failPulls = false, existingPulls,
  baseContents = {}, encNoneFor = [], binaryFor = [], baseTreeModes = {}, treeTruncated = false } = {}) {
  const calls = [];
  function method(args) { const i = args.indexOf('--method'); return i >= 0 ? args[i + 1] : 'GET'; }
  function gh(args, o) {
    calls.push({ args: args.slice(), input: o && o.input, method: method(args) });
    const ep = args[1] || '';
    const m = method(args);
    if (ep === `repos/${repo}`) return JSON.stringify({ default_branch: defaultBranch });
    if (/\/contents\//.test(ep)) {
      const mm = ep.match(/\/contents\/(.+?)\?ref=/);
      const p = mm ? mm[1] : null;
      if (encNoneFor.includes(p)) return JSON.stringify({ encoding: 'none', content: '', size: 2 * 1024 * 1024 });
      if (binaryFor.includes(p)) return JSON.stringify({ encoding: 'base64', content: Buffer.from([0x41, 0x00, 0x42]).toString('base64'), size: 3 });
      if (Object.prototype.hasOwnProperty.call(baseContents, p)) {
        return JSON.stringify({ encoding: 'base64', content: b64(baseContents[p]), size: Buffer.byteLength(baseContents[p], 'utf8') });
      }
      const e = new Error('404'); e.stderr = 'gh: Not Found (HTTP 404)'; throw e;
    }
    if (/\/git\/ref\/heads\//.test(ep)) return JSON.stringify({ object: { sha: 'a'.repeat(40) } });
    if (/\/git\/commits\/[0-9a-f]+$/.test(ep)) return JSON.stringify({ tree: { sha: 'b'.repeat(40) } });
    if (/\/git\/trees\/[0-9a-f]+\?recursive=1$/.test(ep) && m === 'GET') {     // #405 base-mode resolution
      if (treeTruncated) return JSON.stringify({ truncated: true, tree: [] });
      const allPaths = new Set([...Object.keys(baseContents), ...Object.keys(baseTreeModes)]);
      const tree = [...allPaths].map((p) => ({ path: p, mode: (baseTreeModes[p] || '100644'), type: 'blob' }));
      return JSON.stringify({ truncated: false, tree });
    }
    if (/\/git\/trees$/.test(ep) && m === 'POST') return JSON.stringify({ sha: 'c'.repeat(40) });
    if (/\/git\/commits$/.test(ep) && m === 'POST') return JSON.stringify({ sha: 'd'.repeat(40) });
    if (/\/git\/refs$/.test(ep) && m === 'POST') {
      if (refExists) { const e = new Error('422'); e.stderr = 'gh: Reference already exists (HTTP 422)'; throw e; }
      return JSON.stringify({ ref: 'refs/heads/x' });
    }
    // F-W1: the dedup + post-create backstop read pr.base.{ref,repo.full_name}. The shared default carries a
    // base pointing at THIS repo + default branch so the tightened dedup predicate + the backstop see a matching
    // (same-owner) base; the mismatch-case tests override `existingPulls`.
    if (/\/pulls\?head=/.test(ep)) return JSON.stringify(existingPulls || [{ html_url: 'https://github.com/o/r/pull/7', number: 7, base: { ref: defaultBranch, repo: { full_name: repo } } }]);
    if (/\/pulls$/.test(ep) && m === 'POST') {
      if (failPulls) { const e = new Error('500'); e.stderr = 'gh: server error (HTTP 500)'; throw e; }
      return JSON.stringify({ html_url: 'https://github.com/o/r/pull/9', number: 9, base: { ref: defaultBranch, repo: { full_name: repo } } });
    }
    if (/\/git\/refs\/heads\//.test(ep) && m === 'DELETE') return '';
    throw new Error(`mock-gh: unhandled ${m} ${ep}`);
  }
  gh.calls = calls;
  return gh;
}

function endpointsOf(gh) { return gh.calls.map((c) => `${c.method} ${c.args[1]}`); }
function writeCalls(gh) { return gh.calls.filter((c) => c.method === 'POST' || c.method === 'DELETE'); }
function treeBodyOf(gh) { return JSON.parse(gh.calls.find((c) => /\/git\/trees$/.test(c.args[1]) && c.method === 'POST').input); }

// === happy paths + sequence ===

test('happy ADD: a new-file diff => DRAFT PR; the tree->commit->ref->pull sequence in order', () => {
  const gh = makeGh();
  const diff = NEWFILE_DIFF;
  const r = G.ghEmit({ draft: draftFor(diff), approvalHash: hashFor(diff), env: {} }, { runGh: gh });
  assert.deepStrictEqual(r, { pr_url: 'https://github.com/o/r/pull/9', number: 9, branch: `loom/issue-42-${hashFor(diff).slice(0, 12)}`, base_sha: 'a'.repeat(40) });
  assert.deepStrictEqual(endpointsOf(gh), [
    'GET repos/owner/repo',
    'GET repos/owner/repo/git/ref/heads/main',
    'GET repos/owner/repo/git/commits/' + 'a'.repeat(40),
    'POST repos/owner/repo/git/trees',
    'POST repos/owner/repo/git/commits',
    'POST repos/owner/repo/git/refs',
    'POST repos/owner/repo/pulls',
  ], 'an ADD needs no contents fetch — exact tree->commit->ref->pull order');
});

test('#405 probe 1 happy MODIFY: a modify diff => base fetched at the base commit, hunks applied, full post-image emitted', () => {
  const gh = makeGh({ baseContents: { 'f.txt': MODIFY_BASE } });
  const diff = MODIFY_DIFF;
  const r = G.ghEmit({ draft: draftFor(diff), approvalHash: hashFor(diff), env: {} }, { runGh: gh });
  assert.strictEqual(r.number, 9);
  assert.deepStrictEqual(endpointsOf(gh), [
    'GET repos/owner/repo',
    'GET repos/owner/repo/git/ref/heads/main',
    'GET repos/owner/repo/git/commits/' + 'a'.repeat(40),
    'GET repos/owner/repo/git/trees/' + 'b'.repeat(40) + '?recursive=1',   // <- #405 base-mode resolution (once)
    'GET repos/owner/repo/contents/f.txt?ref=' + 'a'.repeat(40),           // <- the base fetch at the resolved base commit
    'POST repos/owner/repo/git/trees',
    'POST repos/owner/repo/git/commits',
    'POST repos/owner/repo/git/refs',
    'POST repos/owner/repo/pulls',
  ], 'a MODIFY resolves base modes once, then one contents fetch, before the tree POST');
  const tree = treeBodyOf(gh);
  assert.strictEqual(tree.tree[0].path, 'f.txt');
  assert.strictEqual(tree.tree[0].content, MODIFY_EXPECTED, 'the emitted content === base + hunks applied');
  assert.strictEqual(tree.tree[0].sha, undefined, 'inline content, never a pre-created blob sha');
});

test('#405 probe 1 (pure): parse + apply reconstructs the exact post-image', () => {
  assert.strictEqual(applyDiff(MODIFY_DIFF, MODIFY_BASE), MODIFY_EXPECTED);
});

// === CRITICAL-1: transport discipline (--input -, never -f/-F) — now spanning the contents fetch too ===

test('CRITICAL-1: every WRITE uses `--input -`; NO `-f`/`-F`/`--field`/`--raw-field` anywhere (incl. the contents fetch)', () => {
  const gh = makeGh({ baseContents: { 'f.txt': MODIFY_BASE } });
  G.ghEmit({ draft: draftFor(MODIFY_DIFF), approvalHash: hashFor(MODIFY_DIFF), env: {} }, { runGh: gh });
  for (const c of gh.calls) {
    for (const bad of ['-f', '-F', '--field', '--raw-field']) {
      assert.ok(!c.args.includes(bad), `no ${bad} in ${c.args.join(' ')}`);
    }
  }
  for (const c of writeCalls(gh).filter((w) => w.method === 'POST')) {
    const i = c.args.indexOf('--input');
    assert.ok(i >= 0 && c.args[i + 1] === '-', `POST uses --input - : ${c.args.join(' ')}`);
    assert.strictEqual(typeof c.input, 'string', 'the JSON body is delivered on stdin');
  }
});

test('#405 probe 12: the contents fetch uses the SAME validated stanza.pathB (no re-parse) + is a plain GET (no body)', () => {
  const gh = makeGh({ baseContents: { 'f.txt': MODIFY_BASE } });
  G.ghEmit({ draft: draftFor(MODIFY_DIFF), approvalHash: hashFor(MODIFY_DIFF), env: {} }, { runGh: gh });
  const fetch = gh.calls.find((c) => /\/contents\//.test(c.args[1]));
  assert.strictEqual(fetch.args[1], `repos/owner/repo/contents/f.txt?ref=${'a'.repeat(40)}`, 'exact pathB + base sha');
  assert.strictEqual(fetch.method, 'GET');
  assert.strictEqual(fetch.input, undefined, 'a GET carries no stdin body');
});

// === CRITICAL-2: the REAL self-check (pre-network) ===

test('CRITICAL-2: a draft whose computeEmissionHash != approvalHash => refuse, ZERO network calls', () => {
  const gh = makeGh();
  assert.throws(
    () => G.ghEmit({ draft: draftFor(NEWFILE_DIFF), approvalHash: 'f'.repeat(64), env: {} }, { runGh: gh }),
    /Forward-Contract violation/,
  );
  assert.strictEqual(gh.calls.length, 0, 'the self-check refuses BEFORE any gh call');
});

test('CRITICAL-2: a missing/short approvalHash => refuse, zero network', () => {
  const gh = makeGh();
  assert.throws(() => G.ghEmit({ draft: draftFor(NEWFILE_DIFF), approvalHash: 'abc', env: {} }, { runGh: gh }), /approvalHash/);
  assert.strictEqual(gh.calls.length, 0);
});

// === VALIDATE HIGH: the env guard — env=undefined would inherit process.env (killswitch bypass) ===

test('VALIDATE-HIGH env-guard: ghEmit with NO env (or a non-object) => refuse, zero network', () => {
  const gh = makeGh();
  assert.throws(() => G.ghEmit({ draft: draftFor(NEWFILE_DIFF), approvalHash: hashFor(NEWFILE_DIFF) }, { runGh: gh }), /sanitized env|required/);
  for (const badEnv of [null, undefined, [], 'x', 5]) {
    assert.throws(() => G.ghEmit({ draft: draftFor(NEWFILE_DIFF), approvalHash: hashFor(NEWFILE_DIFF), env: badEnv }, { runGh: gh }), /sanitized env|required/);
  }
  assert.strictEqual(gh.calls.length, 0, 'the env guard refuses BEFORE any network');
});

// === #405 probe 11: new-file adds still reconstruct (no regression of the ③.2.5c hardening) ===

test('#405 probe 11 / HIGH-4: a `+`-leading body line is PRESERVED (positional); trailing newline added', () => {
  const content = applyAdd(NEWFILE_DIFF);
  assert.strictEqual(content, '# Dogfood\na normal line\n++ a body line that starts with a plus\n');
});

test('#405 probe 11: a new-file add still emits the full post-image through ghEmit (empty base, no contents fetch)', () => {
  const gh = makeGh();
  G.ghEmit({ draft: draftFor(NEWFILE_DIFF), approvalHash: hashFor(NEWFILE_DIFF), env: {} }, { runGh: gh });
  assert.ok(!endpointsOf(gh).some((e) => /\/contents\//.test(e)), 'an ADD never fetches base content');
  assert.strictEqual(treeBodyOf(gh).tree[0].content, '# Dogfood\na normal line\n++ a body line that starts with a plus\n');
});

test('HIGH-4: a `\\ No newline at end of file` marker on a new-file => NO trailing newline', () => {
  const diff = [
    'diff --git a/x.txt b/x.txt', 'new file mode 100644', '--- /dev/null', '+++ b/x.txt',
    '@@ -0,0 +1,1 @@', '+no trailing nl', '\\ No newline at end of file', '',
  ].join('\n');
  assert.strictEqual(applyAdd(diff), 'no trailing nl');
});

// === #405 probe 2: a moved base => refuse, zero bytes leave ===

test('#405 probe 2: a moved base (a removed/context line differs from live) => refuse; NO tree POST', () => {
  const gh = makeGh({ baseContents: { 'f.txt': 'line1\nDIFFERENT\nline3\n' } });
  assert.throws(() => G.ghEmit({ draft: draftFor(MODIFY_DIFF), approvalHash: hashFor(MODIFY_DIFF), env: {} }, { runGh: gh }),
    /moved base|cannot-apply-hunk/);
  assert.ok(!endpointsOf(gh).some((e) => e === 'POST repos/owner/repo/git/trees'), 'zero bytes leave on a moved base (no tree POST)');
});

test('#405 probe 2 (pure): a moved base => applyHunks refuses', () => {
  assert.throws(() => applyDiff(MODIFY_DIFF, 'line1\nDIFFERENT\nline3\n'), /moved base|cannot-apply-hunk/);
});

// === #405 probe 3: cross-hunk positional integrity (the VERIFY CRITICAL) ===

test('#405 probe 3a: out-of-order / overlapping hunks (descending oldStart) => refuse', () => {
  const diff = [
    'diff --git a/g.txt b/g.txt', '--- a/g.txt', '+++ b/g.txt',
    '@@ -5,1 +5,1 @@', '-five', '+FIVE',
    '@@ -2,1 +2,1 @@', '-two', '+TWO', '',
  ].join('\n');
  assert.throws(() => applyDiff(diff, 'one\ntwo\nthree\nfour\nfive\n'), /ascending|overlap|cannot-apply-hunk/);
});

test('#405 probe 3b: a hunk whose newStart LIES about its position => refuse (running-offset invariant)', () => {
  const diff = [
    'diff --git a/g.txt b/g.txt', '--- a/g.txt', '+++ b/g.txt',
    '@@ -1,1 +1,1 @@', '-one', '+ONE',
    '@@ -3,1 +9,1 @@', '-three', '+THREE', '',
  ].join('\n');
  assert.throws(() => applyDiff(diff, 'one\ntwo\nthree\n'), /newStart|cannot-apply-hunk/);
});

// === #405 probe 4: a hunk-body count that lies about the header => parse refuses ===

test('#405 probe 4: a hunk body count != the @@ header count => parse refuses', () => {
  const diff = ['diff --git a/g.txt b/g.txt', '--- a/g.txt', '+++ b/g.txt', '@@ -1,3 +1,1 @@', ' one', '+x', ''].join('\n');
  assert.throws(() => G.parseDiffStanzas(diff), /count mismatch|fail-closed/);
});

// === #405 probe 5: per-side `\ No newline` semantics ===

test('#405 probe 5a: a `+` line marked no-newline (new side loses its trailing NL)', () => {
  const diff = ['diff --git a/g.txt b/g.txt', '--- a/g.txt', '+++ b/g.txt',
    '@@ -1,2 +1,2 @@', ' a', '-b', '+B', '\\ No newline at end of file', ''].join('\n');
  assert.strictEqual(applyDiff(diff, 'a\nb\n'), 'a\nB');
});

test('#405 probe 5b: a `-` line marked no-newline (old side) — the NEW side adds the trailing NL', () => {
  const diff = ['diff --git a/g.txt b/g.txt', '--- a/g.txt', '+++ b/g.txt',
    '@@ -1,2 +1,2 @@', ' a', '-b', '\\ No newline at end of file', '+b', ''].join('\n');
  assert.strictEqual(applyDiff(diff, 'a\nb'), 'a\nb\n');
});

test('#405 probe 5c: a duplicate `\\ No newline` marker on one line => parse refuses', () => {
  const diff = ['diff --git a/g.txt b/g.txt', '--- a/g.txt', '+++ b/g.txt',
    '@@ -1,1 +1,1 @@', '-b', '\\ No newline at end of file', '\\ No newline at end of file', '+B', ''].join('\n');
  assert.throws(() => G.parseDiffStanzas(diff), /duplicate.*No newline|fail-closed/);
});

// === #405 probe 6: a blank context line (truly empty '') advances base ===

test('#405 probe 6: a blank (empty) context line inside a hunk is treated as context (advances base)', () => {
  const diff = 'diff --git a/g.txt b/g.txt\n--- a/g.txt\n+++ b/g.txt\n@@ -1,3 +1,3 @@\n a\n\n-b\n+B\n';
  assert.strictEqual(applyDiff(diff, 'a\n\nb\n'), 'a\n\nB\n');
});

// === #405 probe 7: binary / non-base64 / encoding:none base => refuse ===

test('#405 probe 7a: a base file > 1MB (contents API encoding:"none") => refuse, no tree POST', () => {
  const diff = 'diff --git a/big2.txt b/big2.txt\n--- a/big2.txt\n+++ b/big2.txt\n@@ -1,1 +1,1 @@\n-x\n+y\n';
  const gh = makeGh({ encNoneFor: ['big2.txt'] });
  assert.throws(() => G.ghEmit({ draft: draftFor(diff), approvalHash: hashFor(diff), env: {} }, { runGh: gh }), /not base64|encoding:none|fail-closed/);
  assert.ok(!endpointsOf(gh).some((e) => e === 'POST repos/owner/repo/git/trees'), 'no tree POST on an unavailable base');
});

test('#405 probe 7b: a binary base (a NUL byte) => refuse, no tree POST', () => {
  const diff = 'diff --git a/bin.txt b/bin.txt\n--- a/bin.txt\n+++ b/bin.txt\n@@ -1,1 +1,1 @@\n-x\n+y\n';
  const gh = makeGh({ binaryFor: ['bin.txt'] });
  assert.throws(() => G.ghEmit({ draft: draftFor(diff), approvalHash: hashFor(diff), env: {} }, { runGh: gh }), /binary|fail-closed/);
  assert.ok(!endpointsOf(gh).some((e) => e === 'POST repos/owner/repo/git/trees'), 'no tree POST on a binary base');
});

// === #405 probe 8: amplification size caps ===

test('#405 probe 8a: a base > MAX_BASE_BYTES => refuse, no tree POST', () => {
  const diff = 'diff --git a/big.txt b/big.txt\n--- a/big.txt\n+++ b/big.txt\n@@ -1,1 +1,1 @@\n-x\n+y\n';
  const gh = makeGh({ baseContents: { 'big.txt': 'A'.repeat(1 * 1024 * 1024 + 1) } });   // 1MB + 1 > MAX_BASE_BYTES
  assert.throws(() => G.ghEmit({ draft: draftFor(diff), approvalHash: hashFor(diff), env: {} }, { runGh: gh }), /MAX_BASE_BYTES|fail-closed/);
  assert.ok(!endpointsOf(gh).some((e) => e === 'POST repos/owner/repo/git/trees'), 'no tree POST on an oversize base');
});

test('#405 probe 8b: a produced post-image > MAX_POST_IMAGE_BYTES (a huge added line) => refuse, ZERO network', () => {
  const big = 'A'.repeat(3 * 1024 * 1024);   // 3MB add: under MAX_DIFF (5MB) but over MAX_POST_IMAGE (2MB)
  const diff = `diff --git a/big.md b/big.md\nnew file mode 100644\n--- /dev/null\n+++ b/big.md\n@@ -0,0 +1,1 @@\n+${big}\n`;
  const gh = makeGh();
  assert.throws(() => G.ghEmit({ draft: draftFor(diff), approvalHash: hashFor(diff), env: {} }, { runGh: gh }), /MAX_POST_IMAGE_BYTES|fail-closed/);
  assert.strictEqual(gh.calls.length, 0, 'an ADD post-image cap refuses BEFORE any network');
});

test('VALIDATE LOW: ghEmit self-defends its own diff-size bound (independent of the upstream cap)', () => {
  const gh = makeGh();
  const huge = `diff --git a/big.md b/big.md\nnew file mode 100644\n--- /dev/null\n+++ b/big.md\n@@ -0,0 +1,1 @@\n+${'A'.repeat(6 * 1024 * 1024)}\n`;
  assert.throws(() => G.ghEmit({ draft: draftFor(huge), approvalHash: hashFor(huge), env: {} }, { runGh: gh }), /size bound/);
  assert.strictEqual(gh.calls.length, 0);
});

// === #405 probe 9: a scrub-touched old-side line won't match the live base => refuse (the honest-scope fail-closed) ===

test('#405 probe 9: a `[REDACTED]`-bearing old-side (context) line != the live base => refuse, NO tree POST', () => {
  // the live base holds the real secret; the SCRUBBED diff carries a [REDACTED] context line => a faithful apply
  // is impossible (emitting [REDACTED] would CORRUPT the file), so the applier REFUSES (safe egress philosophy).
  const diff = ['diff --git a/c.txt b/c.txt', '--- a/c.txt', '+++ b/c.txt',
    '@@ -1,3 +1,3 @@', ' config', ' API_KEY=[REDACTED]', '-footer', '+FOOTER', ''].join('\n');
  const gh = makeGh({ baseContents: { 'c.txt': 'config\nAPI_KEY=sk-realrealrealsecret\nfooter\n' } });
  assert.throws(() => G.ghEmit({ draft: draftFor(diff), approvalHash: hashFor(diff), env: {} }, { runGh: gh }), /context mismatch|moved base|cannot-apply-hunk/);
  assert.ok(!endpointsOf(gh).some((e) => e === 'POST repos/owner/repo/git/trees'), 'a scrub-touched old-side never emits a corrupting post-image');
});

// === #405 probe 10 / M1: a path bearing a contents-URL-unsafe char => refuse at parse ===

test('#405 probe 10: a path with a non-allowlisted char (? # % & space @) => parse refuses (positive path allowlist)', () => {
  for (const bad of ['a?b.txt', 'a#b.txt', 'a%2e.txt', 'a&b.txt', 'a b.txt', 'a@b.txt']) {
    const diff = `diff --git a/${bad} b/${bad}\n--- a/${bad}\n+++ b/${bad}\n@@ -1,1 +1,1 @@\n-x\n+y\n`;
    assert.throws(() => G.parseDiffStanzas(diff), /not a safe relative path|fail-closed/);
  }
});

// === #405 VALIDATE-board folds (architect + code-reviewer + hacker live-probe + honesty) ===

test('#405 VALIDATE-hacker C1 (CRITICAL): a `new file mode 120000` (symlink) ADD => parse refuses (mode allowlist)', () => {
  const sym = 'diff --git a/link b/link\nnew file mode 120000\n--- /dev/null\n+++ b/link\n@@ -0,0 +1,1 @@\n+../../../../etc/passwd\n';
  assert.throws(() => G.parseDiffStanzas(sym), /not an allowed file mode|symlink|fail-closed/);
  const gli = 'diff --git a/sub b/sub\nnew file mode 160000\n--- /dev/null\n+++ b/sub\n@@ -0,0 +1,1 @@\n+deadbeef\n';
  assert.throws(() => G.parseDiffStanzas(gli), /not an allowed file mode|gitlink|fail-closed/);
  // and end-to-end through ghEmit: ZERO network (the parse refuses before any gh call)
  const gh = makeGh();
  assert.throws(() => G.ghEmit({ draft: draftFor(sym), approvalHash: hashFor(sym), env: {} }, { runGh: gh }), /allowed file mode|symlink|fail-closed/);
  assert.strictEqual(gh.calls.length, 0, 'a symlink-mode add never reaches the network');
});

test('#405: a 100755 (executable) new-file add is ALLOWED and emits mode 100755', () => {
  const exe = 'diff --git a/run.sh b/run.sh\nnew file mode 100755\n--- /dev/null\n+++ b/run.sh\n@@ -0,0 +1,1 @@\n+#!/bin/sh\n';
  const gh = makeGh();
  G.ghEmit({ draft: draftFor(exe), approvalHash: hashFor(exe), env: {} }, { runGh: gh });
  assert.strictEqual(treeBodyOf(gh).tree[0].mode, '100755', 'an executable add preserves 100755');
});

test('#405 (code-reviewer MED): a mode-change stanza (old mode / new mode) => parse refuses (never emit a wrong explicit mode)', () => {
  const diff = ['diff --git a/s.sh b/s.sh', 'old mode 100644', 'new mode 100755', '--- a/s.sh', '+++ b/s.sh',
    '@@ -1,1 +1,1 @@', '-echo old', '+echo new', ''].join('\n');
  assert.throws(() => G.parseDiffStanzas(diff), /mode-change|fail-closed/);
});

test('#405 (architect MED — whitelist): a binary-patch header => parse refuses', () => {
  const diff = ['diff --git a/img.png b/img.png', 'index 1..2 100644', 'GIT binary patch', 'literal 4', '', ''].join('\n');
  assert.throws(() => G.parseDiffStanzas(diff), /binary|fail-closed/);
});

test('#405 (architect MED — whitelist): an UNRECOGNIZED header line => parse refuses (the parser is a whitelist)', () => {
  const diff = ['diff --git a/x.txt b/x.txt', 'totally-bogus-header-line: evil', '--- a/x.txt', '+++ b/x.txt',
    '@@ -1,1 +1,1 @@', '-a', '+A', ''].join('\n');
  assert.throws(() => G.parseDiffStanzas(diff), /unrecognized header line|fail-closed/);
});

test('#405 VALIDATE-hacker M2: an env carrying a key OUTSIDE buildEmitEnv output (GITHUB_TOKEN / GIT_CONFIG_COUNT / a stray) => refuse, zero network', () => {
  for (const badKey of ['GITHUB_TOKEN', 'GIT_ASKPASS', 'GIT_CONFIG_COUNT', 'SHLVL', 'PWD']) {
    const gh = makeGh();
    const env = { PATH: '/usr/bin', [badKey]: 'x' };
    assert.throws(() => G.ghEmit({ draft: draftFor(NEWFILE_DIFF), approvalHash: hashFor(NEWFILE_DIFF), env }, { runGh: gh }), /not a buildEmitEnv-sanitized env|killswitch/);
    assert.strictEqual(gh.calls.length, 0, `env with ${badKey} refuses before any network`);
  }
});

test('#405 REGRESSION (first live broker-signed dogfood, Rule-2a-corollary): a REAL buildEmitEnv() env PASSES the sanitization gate — NOT refused on its own GIT_CONFIG_NOSYSTEM/GIT_CONFIG_GLOBAL', () => {
  // the mock `env:{}` tests never exercised the real sanitizer; the v1 `startsWith('GIT_CONFIG')` denylist
  // refused buildEmitEnv's OWN hardening keys -> emitPR could never emit live. Use the REAL buildEmitEnv output.
  const { buildEmitEnv } = require(path.join(REPO, 'packages', 'kernel', 'egress', 'emit-pr.js'));
  const ghcfg = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-ghcfg-'));   // assertIsolatedGhConfigDir requires an EMPTY dir
  try {
    const env = buildEmitEnv({ token: 'x'.repeat(40), ghConfigDir: ghcfg });
    assert.ok('GIT_CONFIG_NOSYSTEM' in env && 'GIT_CONFIG_GLOBAL' in env, 'buildEmitEnv really sets the GIT_CONFIG_* hardening keys (the trap)');
    const gh = makeGh();
    const r = G.ghEmit({ draft: draftFor(NEWFILE_DIFF), approvalHash: hashFor(NEWFILE_DIFF), env }, { runGh: gh });
    assert.ok(r && r.number, 'a real buildEmitEnv env completes the emit — the env gate did NOT false-refuse its own hardening keys');
  } finally { fs.rmSync(ghcfg, { recursive: true, force: true }); }
});

test('#405 (architect MED — attribution): a hunk whose context/removed line extends PAST base EOF => distinct refuse reason', () => {
  const diff = 'diff --git a/e.txt b/e.txt\n--- a/e.txt\n+++ b/e.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n';
  assert.throws(() => applyDiff(diff, 'a\n'), /past base EOF/);
});

test('#405 VALIDATE-architect F5 / hacker H1: the resolved baseCommitSha is bound into the commit message AND the PR body (attestable base,diff pair)', () => {
  const gh = makeGh({ baseContents: { 'f.txt': MODIFY_BASE } });
  G.ghEmit({ draft: draftFor(MODIFY_DIFF), approvalHash: hashFor(MODIFY_DIFF), env: {} }, { runGh: gh });
  const baseSha = 'a'.repeat(40);
  const commit = JSON.parse(gh.calls.find((c) => /\/git\/commits$/.test(c.args[1]) && c.method === 'POST').input);
  assert.ok(commit.message.includes(`base-commit: ${baseSha}`), 'commit message binds the base sha');
  const pull = JSON.parse(gh.calls.find((c) => /\/pulls$/.test(c.args[1]) && c.method === 'POST').input);
  assert.ok(pull.body.includes(`base-commit: ${baseSha}`), 'PR body binds the base sha');
});

test('#405 probe 5d (code-reviewer LOW): a `\\ No newline` marker as the FIRST hunk line (no preceding line) => parse refuses', () => {
  const diff = ['diff --git a/g.txt b/g.txt', '--- a/g.txt', '+++ b/g.txt',
    '@@ -1,1 +1,1 @@', '\\ No newline at end of file', '-b', '+B', ''].join('\n');
  assert.throws(() => G.parseDiffStanzas(diff), /no preceding|fail-closed/);
});

test('#405 (code-reviewer LOW): applyHunks([]) on the exported util => throws (no silent base passthrough)', () => {
  assert.throws(() => G.applyHunks('whatever\n', []), /no hunks|fail-closed/);
});

// === #405 VALIDATE-hacker H2 + CodeRabbit Major: MODIFY preserves the base file mode (no silent 755->644 flip) ===

test('#405 H2: a MODIFY of an EXECUTABLE (100755) base preserves mode 100755 in the emitted tree (base-tree mode map)', () => {
  const gh = makeGh({ baseContents: { 'f.txt': MODIFY_BASE }, baseTreeModes: { 'f.txt': '100755' } });
  G.ghEmit({ draft: draftFor(MODIFY_DIFF), approvalHash: hashFor(MODIFY_DIFF), env: {} }, { runGh: gh });
  assert.strictEqual(treeBodyOf(gh).tree[0].mode, '100755', 'the executable bit survives the content modify');
  // and a regular (100644) base stays 100644
  const gh2 = makeGh({ baseContents: { 'f.txt': MODIFY_BASE } });   // default tree mode 100644
  G.ghEmit({ draft: draftFor(MODIFY_DIFF), approvalHash: hashFor(MODIFY_DIFF), env: {} }, { runGh: gh2 });
  assert.strictEqual(treeBodyOf(gh2).tree[0].mode, '100644');
});

test('#405 H2: a MODIFY whose base path is a SYMLINK (120000) at HEAD => refuse, NO tree POST (not a regular file)', () => {
  const gh = makeGh({ baseContents: { 'f.txt': MODIFY_BASE }, baseTreeModes: { 'f.txt': '120000' } });
  assert.throws(() => G.ghEmit({ draft: draftFor(MODIFY_DIFF), approvalHash: hashFor(MODIFY_DIFF), env: {} }, { runGh: gh }), /not a regular file|base-mode|fail-closed/);
  assert.ok(!endpointsOf(gh).some((e) => e === 'POST repos/owner/repo/git/trees'), 'no tree POST on a non-regular base mode');
  // the base-mode check fires BEFORE the content fetch (no contents GET for the refused path)
  assert.ok(!endpointsOf(gh).some((e) => /\/contents\//.test(e)), 'refuses before fetching content of a non-regular base');
});

test('#405 H2: a TRUNCATED base tree (huge repo) => refuse (cannot guarantee base modes), NO tree POST', () => {
  const gh = makeGh({ baseContents: { 'f.txt': MODIFY_BASE }, treeTruncated: true });
  assert.throws(() => G.ghEmit({ draft: draftFor(MODIFY_DIFF), approvalHash: hashFor(MODIFY_DIFF), env: {} }, { runGh: gh }), /truncated|base tree|fail-closed/);
  assert.ok(!endpointsOf(gh).some((e) => e === 'POST repos/owner/repo/git/trees'), 'no tree POST on a truncated base tree');
});

// === rename/copy/delete are DEFERRED (fail-closed) ===

test('#405: a rename / copy / delete stanza => parse refuses (deferred)', () => {
  const ren = ['diff --git a/old.txt b/new.txt', 'similarity index 100%', 'rename from old.txt', 'rename to new.txt', ''].join('\n');
  assert.throws(() => G.parseDiffStanzas(ren), /rename\/copy|fail-closed/);
  const del = ['diff --git a/gone.txt b/gone.txt', 'deleted file mode 100644', '--- a/gone.txt', '+++ /dev/null', '@@ -1,1 +0,0 @@', '-x', ''].join('\n');
  assert.throws(() => G.parseDiffStanzas(del), /delete|fail-closed/);
});

// === path divergence + new-file shape (HIGH-4 + the documented -0,0 shape) ===

test('HIGH-4: a DIVERGENT stanza path (diff --git b/safe.md vs +++ b/EVIL.md) => parse refuses', () => {
  const diff = 'diff --git a/safe.md b/safe.md\nnew file mode 100644\n--- /dev/null\n+++ b/EVIL.md\n@@ -0,0 +1,1 @@\n+x\n';
  assert.throws(() => G.parseDiffStanzas(diff), /!=|diverge|fail-closed/);
});

test('VALIDATE fold: a `new file mode` stanza with a non -0,0 hunk old-side => parse refuses (byzantine)', () => {
  const bad = 'diff --git a/x b/x\nnew file mode 100644\n--- /dev/null\n+++ b/x\n@@ -5,3 +1,1 @@\n+x\n';
  assert.throws(() => G.parseDiffStanzas(bad), /-0,0|fail-closed/);
});

test('VALIDATE-HIGH fidelity: a multi-hunk new-file (both -0,0) => fail-closed via the non-ascending invariant, NOT a silent drop', () => {
  const multi = [
    'diff --git a/x.md b/x.md', 'new file mode 100644', '--- /dev/null', '+++ b/x.md',
    '@@ -0,0 +1,2 @@', '+line a', '+line b',
    '@@ -0,0 +3,1 @@', '+line c',
    '',
  ].join('\n');
  // both hunks claim oldStart 0 => the strictly-ascending invariant refuses (a new file is single-hunk by construction).
  const gh = makeGh();
  assert.throws(() => G.ghEmit({ draft: draftFor(multi), approvalHash: hashFor(multi), env: {} }, { runGh: gh }), /ascending|overlap|cannot-apply-hunk/);
  assert.strictEqual(gh.calls.length, 0, 'refuses before any network — never truncates');
});

test('HIGH-4: ghEmit re-validates the stanza path — an egress-denied (.github) path => refuse, ZERO network', () => {
  const gh = makeGh();
  const diff = 'diff --git a/.github/workflows/x.yml b/.github/workflows/x.yml\nnew file mode 100644\n--- /dev/null\n+++ b/.github/workflows/x.yml\n@@ -0,0 +1,1 @@\n+evil\n';
  assert.throws(() => G.ghEmit({ draft: draftFor(diff), approvalHash: hashFor(diff), env: {} }, { runGh: gh }), /egress-denied/);
  assert.strictEqual(gh.calls.length, 0, 'refused before any network');
});

// === HIGH-3: kernel-constant envelope + draft:true hard constant (via the modify path) ===

test('HIGH-3 + draft-const: the PR body/title/commit-message carry ONLY issueRef + the hash; draft:true', () => {
  const gh = makeGh({ baseContents: { 'f.txt': MODIFY_BASE } });
  const diff = MODIFY_DIFF; const h = hashFor(diff);
  G.ghEmit({ draft: draftFor(diff), approvalHash: h, env: {} }, { runGh: gh });
  const pull = JSON.parse(gh.calls.find((c) => /\/pulls$/.test(c.args[1]) && c.method === 'POST').input);
  assert.strictEqual(pull.draft, true, 'draft:true is a hard constant');
  assert.strictEqual(pull.title, `loom: candidate for issue #${GOOD_ISSUE}`);
  assert.ok(pull.body.includes(h) && pull.body.includes(`#${GOOD_ISSUE}`), 'body interpolates only the hash + issueRef');
  const commit = JSON.parse(gh.calls.find((c) => /\/git\/commits$/.test(c.args[1]) && c.method === 'POST').input);
  assert.ok(commit.message.includes(h) && commit.message.includes(`#${GOOD_ISSUE}`), 'commit message: hash + issueRef only');
  const tree = treeBodyOf(gh);
  assert.strictEqual(typeof tree.base_tree, 'string');
});

// === HIGH-1 / MEDIUM-5: dedup-on-key ===

test('HIGH-1: a 422 "Reference already exists" + an OPEN PR on THAT branch => dedup-reconcile (deduped:true), NO duplicate', () => {
  const diff = NEWFILE_DIFF; const branch = `loom/issue-42-${hashFor(diff).slice(0, 12)}`;
  const gh = makeGh({ refExists: true, existingPulls: [{ html_url: 'https://github.com/o/r/pull/7', number: 7, head: { ref: branch, repo: { full_name: GOOD_REPO } }, draft: true, base: { ref: 'main', repo: { full_name: GOOD_REPO } } }] });
  const r = G.ghEmit({ draft: draftFor(diff), approvalHash: hashFor(diff), env: {} }, { runGh: gh });
  assert.deepStrictEqual(r, { pr_url: 'https://github.com/o/r/pull/7', number: 7, branch, deduped: true, base_sha: 'a'.repeat(40) });
  assert.ok(endpointsOf(gh).some((e) => /pulls\?head=/.test(e)), 'the dedup GET pulls?head fired');
  assert.ok(!endpointsOf(gh).some((e) => e === 'POST repos/owner/repo/pulls'), 'NO second create-PR');
});

test('HIGH-1 fold (laundering): ref exists but NO open loom PR => fail-CLOSED (ref-exists-no-open-pr), no PR, no DELETE', () => {
  const gh = makeGh({ refExists: true, existingPulls: [] });
  const diff = NEWFILE_DIFF;
  assert.throws(() => G.ghEmit({ draft: draftFor(diff), approvalHash: hashFor(diff), env: {} }, { runGh: gh }), /ref-exists-no-open-pr|pre-existing branch/);
  assert.ok(!endpointsOf(gh).some((e) => e === 'POST repos/owner/repo/pulls'), 'never auto-creates a PR on a foreign ref');
  assert.ok(!gh.calls.some((c) => c.method === 'DELETE'), 'no DELETE — we did NOT reserve this ref');
});

test('LOW fold (dedup head-ref): an OPEN PR with a DIFFERENT head.ref is NOT trusted as deduped => fail-closed', () => {
  const gh = makeGh({ refExists: true, existingPulls: [{ html_url: 'x', number: 999, head: { ref: 'totally-different-branch' }, draft: true }] });
  assert.throws(() => G.ghEmit({ draft: draftFor(NEWFILE_DIFF), approvalHash: hashFor(NEWFILE_DIFF), env: {} }, { runGh: gh }), /pre-existing branch|no open loom/);
});

// === reserve->rollback ===

test('reserve->rollback: a pulls POST failure AFTER the ref was created => the orphan ref is DELETEd; ghEmit throws', () => {
  const gh = makeGh({ failPulls: true });
  const diff = NEWFILE_DIFF;
  assert.throws(() => G.ghEmit({ draft: draftFor(diff), approvalHash: hashFor(diff), env: {} }, { runGh: gh }), /500|failed/);
  assert.ok(gh.calls.some((c) => c.method === 'DELETE' && /\/git\/refs\/heads\//.test(c.args[1])), 'the reserve->rollback DELETE fired');
});

// === MEDIUM-3: default_branch validation ===

test('MEDIUM-3: an unsafe API default_branch (traversal / colon) => refuse before tree create', () => {
  for (const bad of ['..', 'a/../b', 'owner:branch', '']) {
    const gh = makeGh({ defaultBranch: bad });
    assert.throws(() => G.ghEmit({ draft: draftFor(NEWFILE_DIFF), approvalHash: hashFor(NEWFILE_DIFF), env: {} }, { runGh: gh }), /default_branch/);
    assert.ok(!endpointsOf(gh).some((e) => /git\/trees/.test(e)), 'no tree create on an unsafe base');
  }
});

// === runGh fail-CLOSED contract (real gh, guaranteed-local failure, no network) ===

test('runGh is FAIL-CLOSED: a non-zero gh exit THROWS (not null) and carries stderr', () => {
  const ghPath = require('child_process').spawnSync('command', ['-v', 'gh'], { shell: '/bin/bash', encoding: 'utf8' });
  if (ghPath.status !== 0) { skipped += 1; process.stdout.write('  SKIP (gh absent) runGh fail-closed\n'); return; }
  let threw = false;
  try {
    G.runGh(['loom-no-such-subcommand-xyz'], { env: { PATH: process.env.PATH }, timeoutMs: 8000 });
  } catch (e) { threw = true; assert.ok(typeof e.stderr === 'string', 'the error carries stderr'); }
  assert.ok(threw, 'runGh THROWS on a non-zero exit (fail-closed, NOT a swallowed null)');
});

// === CRLF + multi-hunk modify (faithful reconstruction across the new-side shift) ===

test('#405: a CRLF base is reconstructed faithfully (\\r preserved as line content)', () => {
  const diff = ['diff --git a/w.txt b/w.txt', '--- a/w.txt', '+++ b/w.txt',
    '@@ -1,2 +1,2 @@', ' a\r', '-b\r', '+B\r', ''].join('\n');
  assert.strictEqual(applyDiff(diff, 'a\r\nb\r\n'), 'a\r\nB\r\n');
});

test('#405: a 2-hunk modify with a net new-side shift reconstructs exactly', () => {
  const base = 'l1\nl2\nl3\nl4\nl5\n';
  const diff = ['diff --git a/m.txt b/m.txt', '--- a/m.txt', '+++ b/m.txt',
    '@@ -1,2 +1,3 @@', ' l1', '-l2', '+L2', '+inserted',
    '@@ -4,2 +5,2 @@', ' l4', '-l5', '+L5', ''].join('\n');
  // l3 is the inter-hunk gap (carried verbatim from base between the two changed regions).
  assert.strictEqual(applyDiff(diff, base), 'l1\nL2\ninserted\nl3\nl4\nL5\n');
});

// === gap-map item 1 (PR-1): base_sha returned on BOTH success sites (threaded to the join-key) ===

test('item1: ghEmit returns base_sha on the NORMAL (create-PR) success path', () => {
  const gh = makeGh();   // resolves git/ref/heads/main -> sha 'a'*40
  const r = G.ghEmit({ draft: draftFor(NEWFILE_DIFF), approvalHash: hashFor(NEWFILE_DIFF), env: {} }, { runGh: gh });
  assert.strictEqual(r.base_sha, 'a'.repeat(40), 'the base commit sha is surfaced on the normal return');
  assert.ok(/^[a-f0-9]{40}$/.test(r.base_sha), 'a HEX40 base_sha');
});

test('item1: ghEmit returns base_sha on the DEDUP (422-reconcile) success path too', () => {
  const branch = `loom/issue-42-${hashFor(NEWFILE_DIFF).slice(0, 12)}`;
  const gh = makeGh({ refExists: true, existingPulls: [{ html_url: 'https://github.com/o/r/pull/7', number: 7, head: { ref: branch, repo: { full_name: GOOD_REPO } }, draft: true, base: { ref: 'main', repo: { full_name: GOOD_REPO } } }] });
  const r = G.ghEmit({ draft: draftFor(NEWFILE_DIFF), approvalHash: hashFor(NEWFILE_DIFF), env: {} }, { runGh: gh });
  assert.strictEqual(r.deduped, true);
  assert.strictEqual(r.base_sha, 'a'.repeat(40), 'the dedup return also carries base_sha (additive on both sites)');
});

// === F-W2b — the moved-base emit gate (requestedBaseSha != live base => fail-closed + observable) ===

// capture the emitEgressAlert stderr line for the observability assertion (mirrors the two-identity helper).
function captureAlerts(fn) {
  const orig = process.stderr.write.bind(process.stderr);
  const lines = [];
  process.stderr.write = (chunk, ...rest) => { lines.push(String(chunk)); return typeof rest[rest.length - 1] === 'function' ? rest[rest.length - 1]() : true; };
  try { fn(); } catch (e) { lines._err = e; } finally { process.stderr.write = orig; }
  return { text: lines.join(''), err: lines._err };
}

const LIVE_BASE = 'a'.repeat(40);   // the mock gh resolves git/ref/heads/main -> this sha

test('F-W2b: a requestedBaseSha != the LIVE base => moved-base alert + throw, ZERO tree/commit/ref/pull writes (NON-VACUOUS)', () => {
  const gh = makeGh();
  const moved = 'b'.repeat(40);   // the approver intended base 'b'*40; the live upstream base is 'a'*40 -> moved
  const { err } = captureAlerts(() => G.ghEmit({ draft: draftFor(NEWFILE_DIFF), approvalHash: hashFor(NEWFILE_DIFF), env: {}, requestedBaseSha: moved }, { runGh: gh }));
  assert.ok(err, 'a moved base throws');
  assert.ok(/upstream base moved|moved-base|fail-closed/.test(err.message), `the throw names the moved-base refusal (got ${err && err.message})`);
  // fail-CLOSED before ANY write: no tree/commit/ref POST, no pull POST, no ref DELETE.
  assert.strictEqual(writeCalls(gh).length, 0, 'zero write calls on a moved base (the gate sits before the first tree POST)');
});

test('F-W2b: the moved-base refusal emits an observable moved-base alert (fail-closed must be observable)', () => {
  const gh = makeGh();
  const { text } = captureAlerts(() => G.ghEmit({ draft: draftFor(NEWFILE_DIFF), approvalHash: hashFor(NEWFILE_DIFF), env: {}, requestedBaseSha: 'c'.repeat(40) }, { runGh: gh }));
  assert.ok(/moved-base/.test(text), `the reject path emits a moved-base alert (got ${JSON.stringify(text.slice(0, 200))})`);
});

test('F-W2b: a requestedBaseSha === the LIVE base => proceeds normally (writes fire, PR created)', () => {
  const gh = makeGh();
  const r = G.ghEmit({ draft: draftFor(NEWFILE_DIFF), approvalHash: hashFor(NEWFILE_DIFF), env: {}, requestedBaseSha: LIVE_BASE }, { runGh: gh });
  assert.strictEqual(r.number, 9, 'a matching base proceeds to a real PR');
  assert.strictEqual(r.base_sha, LIVE_BASE);
  assert.ok(writeCalls(gh).length >= 4, 'the tree/commit/ref/pull writes fired on a matching base');
});

test('F-W2b: an EMPTY (dormant "") requestedBaseSha is byte-identical to omitting it (the golden-bytes acceptance gate)', () => {
  const diff = NEWFILE_DIFF;
  // baseline: no requestedBaseSha arg at all
  const ghOmit = makeGh();
  const rOmit = G.ghEmit({ draft: draftFor(diff), approvalHash: hashFor(diff), env: {} }, { runGh: ghOmit });
  // the dormant '' sentinel explicitly passed
  const ghEmpty = makeGh();
  const rEmpty = G.ghEmit({ draft: draftFor(diff), approvalHash: hashFor(diff), env: {}, requestedBaseSha: '' }, { runGh: ghEmpty });
  // IDENTICAL return, IDENTICAL argv sequence, IDENTICAL POST bodies, IDENTICAL call count (D10 mechanism).
  assert.deepStrictEqual(rEmpty, rOmit, 'the return is identical for "" vs omitted');
  assert.deepStrictEqual(endpointsOf(ghEmpty), endpointsOf(ghOmit), 'the argv/endpoint sequence is identical');
  assert.strictEqual(ghEmpty.calls.length, ghOmit.calls.length, 'the gh call COUNT is identical');
  const bodiesOmit = ghOmit.calls.map((c) => c.input);
  const bodiesEmpty = ghEmpty.calls.map((c) => c.input);
  assert.deepStrictEqual(bodiesEmpty, bodiesOmit, 'every POST body (tree/commit/ref/pull) is byte-identical');
});

test('F-W2b: a matching base MODIFY emit is byte-identical to omitting requestedBaseSha (dormant over the modify path too)', () => {
  const diff = MODIFY_DIFF;
  const ghOmit = makeGh({ baseContents: { 'f.txt': MODIFY_BASE } });
  G.ghEmit({ draft: draftFor(diff), approvalHash: hashFor(diff), env: {} }, { runGh: ghOmit });
  const ghMatch = makeGh({ baseContents: { 'f.txt': MODIFY_BASE } });
  G.ghEmit({ draft: draftFor(diff), approvalHash: hashFor(diff), env: {}, requestedBaseSha: LIVE_BASE }, { runGh: ghMatch });
  assert.deepStrictEqual(endpointsOf(ghMatch), endpointsOf(ghOmit), 'a matching-base modify emits the identical sequence');
  assert.deepStrictEqual(ghMatch.calls.map((c) => c.input), ghOmit.calls.map((c) => c.input), 'the modify POST bodies are byte-identical');
});

test('F-W2b: a requestedBaseSha is a NAMED ghEmit arg — a value planted in draft is IGNORED (the C2 #273 trap; mirror forkRepo)', () => {
  // draft is hash-bound; a requestedBaseSha in it would be an unsigned, co-forgeable steering field. ghEmit reads
  // the base sha ONLY from the named arg (the sig-covered verified-body value). A moved sha in draft must NOT gate.
  const gh = makeGh();
  const draftWithBase = Object.assign(draftFor(NEWFILE_DIFF), { requestedBaseSha: 'b'.repeat(40) });   // planted, must be ignored
  const r = G.ghEmit({ draft: draftWithBase, approvalHash: hashFor(NEWFILE_DIFF), env: {} }, { runGh: gh });   // no NAMED arg
  assert.strictEqual(r.number, 9, 'a draft-planted base sha does NOT gate (only the named arg steers the moved-base check)');
  assert.ok(writeCalls(gh).length >= 4, 'the emit proceeded (the planted draft field is inert)');
});

test('F-W2b (VALIDATE fold): a NON-STRING/malformed requestedBaseSha fails LOUD at the ghEmit consumer boundary (a null/0 must NOT silently skip the gate)', () => {
  // The coercion maps only undefined->''; a null/0/false is falsy, so without the isSafeBaseSha consumer guard it
  // would SKIP the moved-base check (the unsafe direction) instead of refusing. Symmetric with the mint side
  // (approvalSigBasis/recordApproval/broker-bind all THROW on a non-string). Unreachable live, but fail-closed +
  // observable + NON-VACUOUS (each malformed input fires the guard; zero writes).
  for (const bad of [null, 0, false, 123, 'NOTHEX', 'a'.repeat(39)]) {
    const gh = makeGh();
    const { err } = captureAlerts(() => G.ghEmit({ draft: draftFor(NEWFILE_DIFF), approvalHash: hashFor(NEWFILE_DIFF), env: {}, requestedBaseSha: bad }, { runGh: gh }));
    assert.ok(err && /requestedBaseSha must be|requested-base-malformed|fail-closed/.test(err.message), `a non-conforming requestedBaseSha (${JSON.stringify(bad)}) fails loud (got ${err && err.message})`);
    assert.strictEqual(writeCalls(gh).length, 0, `zero writes on a malformed requestedBaseSha (${JSON.stringify(bad)})`);
  }
});

test('F-W2b/D5: the live base is tightened to the full BASE_SHA_RE domain — a short (non-full-hex) live base fails LOUD', () => {
  // gh-emit.js:736 tightens from /^[0-9a-f]{7,64}$/ to BASE_SHA_RE (40|64). GitHub returns a full 40-hex today, so
  // the real path is byte-identical; a truncated/abbreviated live base (a mock/regression) must throw base-sha-malformed,
  // never a silent false-reject or a compare across an inconsistent domain.
  const gh = makeGh();
  const realGh = gh;
  const shortBaseGh = (args, o) => {
    const ep = args[1] || '';
    if (/\/git\/ref\/heads\//.test(ep)) return JSON.stringify({ object: { sha: 'abc1234' } });   // a 7-hex abbreviated sha
    return realGh(args, o);
  };
  shortBaseGh.calls = gh.calls;
  const { err } = captureAlerts(() => G.ghEmit({ draft: draftFor(NEWFILE_DIFF), approvalHash: hashFor(NEWFILE_DIFF), env: {} }, { runGh: shortBaseGh }));
  assert.ok(err, 'a non-full-hex live base throws');
  assert.ok(/base commit sha|base-sha-malformed|fail-closed/.test(err.message), `the throw names the malformed base (got ${err && err.message})`);
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== gh-emit.test.js: ${passed} passed, ${failed} failed, ${skipped} skipped ===\n`);
  if (failed > 0) process.exit(1);
})();
