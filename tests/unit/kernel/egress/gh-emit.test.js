'use strict';

// tests/unit/kernel/egress/gh-emit.test.js — ③.2.5c the gh-REST emission MECHANISM.
// The live network is NEVER touched: a mock `runGh` (deps.runGh) returns canned gh-api JSON and records every
// call, so the sequence + the argv discipline + the self-check + the reconstruction + dedup + rollback are all
// unit-provable offline. runGh's OWN fail-closed contract is exercised against a guaranteed-local gh failure.

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const G = require(path.join(REPO, 'packages', 'kernel', 'egress', 'gh-emit.js'));
const { computeEmissionHash } = require(path.join(REPO, 'packages', 'kernel', 'egress', 'approval.js'));

let passed = 0; let failed = 0; let skipped = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

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

const GOOD_REPO = 'owner/repo';
const GOOD_ISSUE = 42;
function draftFor(diff) { return { repo: GOOD_REPO, issueRef: GOOD_ISSUE, diff, title: 't', touched_paths: [] }; }
function hashFor(diff) { return computeEmissionHash(draftFor(diff)); }

// A configurable mock gh: records calls, dispatches on the endpoint (args[1]) + method, and can trigger a
// ref-already-exists 422 or a pulls failure. Returns raw JSON stdout (what runGh would return).
function makeGh({ repo = GOOD_REPO, defaultBranch = 'main', refExists = false, failPulls = false, existingPulls } = {}) {
  const calls = [];
  function method(args) { const i = args.indexOf('--method'); return i >= 0 ? args[i + 1] : 'GET'; }
  function gh(args, o) {
    calls.push({ args: args.slice(), input: o && o.input, method: method(args) });
    const ep = args[1] || '';
    const m = method(args);
    if (ep === `repos/${repo}`) return JSON.stringify({ default_branch: defaultBranch });
    if (/\/git\/ref\/heads\//.test(ep)) return JSON.stringify({ object: { sha: 'a'.repeat(40) } });
    if (/\/git\/commits\/[0-9a-f]+$/.test(ep)) return JSON.stringify({ tree: { sha: 'b'.repeat(40) } });
    if (/\/git\/trees$/.test(ep) && m === 'POST') return JSON.stringify({ sha: 'c'.repeat(40) });
    if (/\/git\/commits$/.test(ep) && m === 'POST') return JSON.stringify({ sha: 'd'.repeat(40) });
    if (/\/git\/refs$/.test(ep) && m === 'POST') {
      if (refExists) { const e = new Error('422'); e.stderr = 'gh: Reference already exists (HTTP 422)'; throw e; }
      return JSON.stringify({ ref: 'refs/heads/x' });
    }
    if (/\/pulls\?head=/.test(ep)) return JSON.stringify(existingPulls || [{ html_url: 'https://github.com/o/r/pull/7', number: 7 }]);
    if (/\/pulls$/.test(ep) && m === 'POST') {
      if (failPulls) { const e = new Error('500'); e.stderr = 'gh: server error (HTTP 500)'; throw e; }
      return JSON.stringify({ html_url: 'https://github.com/o/r/pull/9', number: 9 });
    }
    if (/\/git\/refs\/heads\//.test(ep) && m === 'DELETE') return '';
    throw new Error(`mock-gh: unhandled ${m} ${ep}`);
  }
  gh.calls = calls;
  return gh;
}

function endpointsOf(gh) { return gh.calls.map((c) => `${c.method} ${c.args[1]}`); }
function writeCalls(gh) { return gh.calls.filter((c) => c.method === 'POST' || c.method === 'DELETE'); }

// === happy path + sequence ===

test('happy: a new-file diff => DRAFT PR; the tree->commit->ref->pull sequence in order', () => {
  const gh = makeGh();
  const diff = NEWFILE_DIFF;
  const r = G.ghEmit({ draft: draftFor(diff), approvalHash: hashFor(diff), env: {} }, { runGh: gh });
  assert.deepStrictEqual(r, { pr_url: 'https://github.com/o/r/pull/9', number: 9, branch: `loom/issue-42-${hashFor(diff).slice(0, 12)}` });
  const eps = endpointsOf(gh);
  assert.deepStrictEqual(eps, [
    'GET repos/owner/repo',
    'GET repos/owner/repo/git/ref/heads/main',
    'GET repos/owner/repo/git/commits/' + 'a'.repeat(40),
    'POST repos/owner/repo/git/trees',
    'POST repos/owner/repo/git/commits',
    'POST repos/owner/repo/git/refs',
    'POST repos/owner/repo/pulls',
  ], 'exact tree->commit->ref->pull order');
});

// === CRITICAL-1: transport discipline (--input -, never -f/-F) ===

test('CRITICAL-1: every WRITE uses `--input -`; NO `-f`/`-F`/`--field`/`--raw-field` anywhere (the @file-read exfil channel)', () => {
  const gh = makeGh();
  const diff = NEWFILE_DIFF;
  G.ghEmit({ draft: draftFor(diff), approvalHash: hashFor(diff), env: {} }, { runGh: gh });
  for (const c of gh.calls) {
    for (const bad of ['-f', '-F', '--field', '--raw-field']) {
      assert.ok(!c.args.includes(bad), `no ${bad} in ${c.args.join(' ')}`);
    }
  }
  // every POST body rides on stdin via `--input -` (DELETE has no body).
  for (const c of writeCalls(gh).filter((w) => w.method === 'POST')) {
    const i = c.args.indexOf('--input');
    assert.ok(i >= 0 && c.args[i + 1] === '-', `POST uses --input - : ${c.args.join(' ')}`);
    assert.strictEqual(typeof c.input, 'string', 'the JSON body is delivered on stdin');
  }
});

// === CRITICAL-2: the REAL self-check ===

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

// === VALIDATE HIGH (code-reviewer): the env guard — env=undefined would inherit process.env (killswitch bypass) ===

test('VALIDATE-HIGH env-guard: ghEmit with NO env => refuse (would inherit process.env + ambient GH_TOKEN), zero network', () => {
  const gh = makeGh();
  assert.throws(() => G.ghEmit({ draft: draftFor(NEWFILE_DIFF), approvalHash: hashFor(NEWFILE_DIFF) }, { runGh: gh }), /sanitized env|required/);
  for (const badEnv of [null, undefined, [], 'x', 5]) {
    assert.throws(() => G.ghEmit({ draft: draftFor(NEWFILE_DIFF), approvalHash: hashFor(NEWFILE_DIFF), env: badEnv }, { runGh: gh }), /sanitized env|required/);
  }
  assert.strictEqual(gh.calls.length, 0, 'the env guard refuses BEFORE any network');
});

// === VALIDATE HIGH (hacker live-probe): content-fidelity — a multi-hunk new-file must NOT silently truncate ===

test('VALIDATE-HIGH fidelity: a multi-hunk new-file stanza => fail-closed (unconsumed content), NOT a silent drop', () => {
  // header says +1,2 then a SECOND @@ hunk follows — the old parser collected 2 lines + silently skipped the rest.
  const multi = [
    'diff --git a/x.md b/x.md', 'new file mode 100644', '--- /dev/null', '+++ b/x.md',
    '@@ -0,0 +1,2 @@', '+line a', '+line b',
    '@@ -0,0 +3,1 @@', '+line c DROPPED',
    '',
  ].join('\n');
  assert.throws(() => G.reconstructPostImages(multi), /unconsumed content|cannot-reconstruct/);
  const gh = makeGh();
  assert.throws(() => G.ghEmit({ draft: draftFor(multi), approvalHash: hashFor(multi), env: {} }, { runGh: gh }), /unconsumed content|cannot-reconstruct/);
  assert.strictEqual(gh.calls.length, 0, 'the fidelity check refuses before any network');
});

test('VALIDATE fold: a `new file mode` stanza with a non -0,0 hunk old-side => fail-closed (malformed/Byzantine)', () => {
  const bad = 'diff --git a/x b/x\nnew file mode 100644\n--- /dev/null\n+++ b/x\n@@ -5,3 +1,1 @@\n+x\n';
  assert.throws(() => G.reconstructPostImages(bad), /-0,0|cannot-reconstruct/);
});

test('VALIDATE LOW: ghEmit self-defends its own diff-size bound (kernel module, independent of the upstream cap)', () => {
  const gh = makeGh();
  const huge = `diff --git a/big.md b/big.md\nnew file mode 100644\n--- /dev/null\n+++ b/big.md\n@@ -0,0 +1,1 @@\n+${'A'.repeat(6 * 1024 * 1024)}\n`;
  assert.throws(() => G.ghEmit({ draft: draftFor(huge), approvalHash: hashFor(huge), env: {} }, { runGh: gh }), /size bound/);
  assert.strictEqual(gh.calls.length, 0);
});

// === HIGH-4: positional reconstruction ===

test('HIGH-4: a `+`-leading body line is PRESERVED (positional, not a startsWith(+++) drop); trailing newline added', () => {
  const files = G.reconstructPostImages(NEWFILE_DIFF);
  assert.strictEqual(files.length, 1);
  assert.strictEqual(files[0].path, 'loom-dogfood.md');
  assert.strictEqual(files[0].mode, '100644');
  assert.strictEqual(files[0].content, '# Dogfood\na normal line\n++ a body line that starts with a plus\n');
});

test('HIGH-4: a `\\ No newline at end of file` marker => NO trailing newline', () => {
  const diff = [
    'diff --git a/x.txt b/x.txt', 'new file mode 100644', '--- /dev/null', '+++ b/x.txt',
    '@@ -0,0 +1,1 @@', '+no trailing nl', '\\ No newline at end of file', '',
  ].join('\n');
  assert.strictEqual(G.reconstructPostImages(diff)[0].content, 'no trailing nl');
});

test('HIGH-4: a MODIFY-hunk diff (no `new file mode`) => cannot-reconstruct-postimage (fail-closed)', () => {
  const modify = 'diff --git a/src/foo.py b/src/foo.py\n--- a/src/foo.py\n+++ b/src/foo.py\n@@ -1 +1 @@\n-old\n+new\n';
  assert.throws(() => G.reconstructPostImages(modify), /cannot-reconstruct-postimage/);
});

test('HIGH-4: a DIVERGENT stanza path (diff --git b/safe.md vs +++ b/EVIL.md) => refuse', () => {
  const diff = 'diff --git a/safe.md b/safe.md\nnew file mode 100644\n--- /dev/null\n+++ b/EVIL.md\n@@ -0,0 +1,1 @@\n+x\n';
  assert.throws(() => G.reconstructPostImages(diff), /diverges|cannot-reconstruct/);
});

test('HIGH-4: a hunk-count mismatch (header +2, body 1) => refuse', () => {
  const diff = 'diff --git a/x b/x\nnew file mode 100644\n--- /dev/null\n+++ b/x\n@@ -0,0 +1,2 @@\n+only one\n';
  assert.throws(() => G.reconstructPostImages(diff), /count mismatch|cannot-reconstruct/);
});

test('HIGH-4: ghEmit re-validates the reconstructed path — an egress-denied (.github) path => refuse, zero network past recon', () => {
  const gh = makeGh();
  const diff = 'diff --git a/.github/workflows/x.yml b/.github/workflows/x.yml\nnew file mode 100644\n--- /dev/null\n+++ b/.github/workflows/x.yml\n@@ -0,0 +1,1 @@\n+evil\n';
  assert.throws(() => G.ghEmit({ draft: draftFor(diff), approvalHash: hashFor(diff), env: {} }, { runGh: gh }), /egress-denied/);
  assert.strictEqual(gh.calls.length, 0, 'refused before any network');
});

// === HIGH-3: kernel-constant envelope + draft:true hard constant ===

test('HIGH-3 + draft-const: the PR body/title/commit-message carry ONLY issueRef + the hash; draft:true', () => {
  const gh = makeGh();
  const diff = NEWFILE_DIFF; const h = hashFor(diff);
  G.ghEmit({ draft: draftFor(diff), approvalHash: h, env: {} }, { runGh: gh });
  const pull = JSON.parse(gh.calls.find((c) => /\/pulls$/.test(c.args[1]) && c.method === 'POST').input);
  assert.strictEqual(pull.draft, true, 'draft:true is a hard constant');
  assert.strictEqual(pull.title, `loom: candidate for issue #${GOOD_ISSUE}`);
  assert.ok(pull.body.includes(h) && pull.body.includes(`#${GOOD_ISSUE}`), 'body interpolates only the hash + issueRef');
  const commit = JSON.parse(gh.calls.find((c) => /\/git\/commits$/.test(c.args[1]) && c.method === 'POST').input);
  assert.ok(commit.message.includes(h) && commit.message.includes(`#${GOOD_ISSUE}`), 'commit message: hash + issueRef only');
  // the tree body carries the reconstructed inline content (no blob sha) for base_tree-preserves-unlisted.
  const tree = JSON.parse(gh.calls.find((c) => /\/git\/trees$/.test(c.args[1]) && c.method === 'POST').input);
  assert.strictEqual(typeof tree.base_tree, 'string');
  assert.strictEqual(tree.tree[0].content, '# Dogfood\na normal line\n++ a body line that starts with a plus\n');
  assert.strictEqual(tree.tree[0].sha, undefined, 'inline content, never a pre-created blob sha');
});

// === HIGH-1 / MEDIUM-5: dedup-on-key ===

test('HIGH-1: a 422 "Reference already exists" + an OPEN PR on THAT branch => dedup-reconcile (deduped:true), NO duplicate', () => {
  const diff = NEWFILE_DIFF; const branch = `loom/issue-42-${hashFor(diff).slice(0, 12)}`;
  const gh = makeGh({ refExists: true, existingPulls: [{ html_url: 'https://github.com/o/r/pull/7', number: 7, head: { ref: branch }, draft: true }] });
  const r = G.ghEmit({ draft: draftFor(diff), approvalHash: hashFor(diff), env: {} }, { runGh: gh });
  assert.deepStrictEqual(r, { pr_url: 'https://github.com/o/r/pull/7', number: 7, branch, deduped: true });
  assert.ok(endpointsOf(gh).some((e) => /pulls\?head=/.test(e)), 'the dedup GET pulls?head fired');
  assert.ok(!endpointsOf(gh).some((e) => e === 'POST repos/owner/repo/pulls'), 'NO second create-PR');
});

test('HIGH-1 fold (laundering): ref exists but NO open loom PR => fail-CLOSED (ref-exists-no-open-pr), no PR created, no DELETE', () => {
  const gh = makeGh({ refExists: true, existingPulls: [] });   // an actor pre-created the branch; no loom PR points at it
  const diff = NEWFILE_DIFF;
  assert.throws(() => G.ghEmit({ draft: draftFor(diff), approvalHash: hashFor(diff), env: {} }, { runGh: gh }), /ref-exists-no-open-pr|pre-existing branch/);
  assert.ok(!endpointsOf(gh).some((e) => e === 'POST repos/owner/repo/pulls'), 'never auto-creates a PR on a foreign ref');
  assert.ok(!gh.calls.some((c) => c.method === 'DELETE'), 'no DELETE — we did NOT reserve this ref (must not delete a foreign branch)');
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
    // an unknown gh subcommand exits non-zero LOCALLY (usage error) — no network. fail-OPEN would return null.
    G.runGh(['loom-no-such-subcommand-xyz'], { env: { PATH: process.env.PATH }, timeoutMs: 8000 });
  } catch (e) { threw = true; assert.ok(typeof e.stderr === 'string', 'the error carries stderr'); }
  assert.ok(threw, 'runGh THROWS on a non-zero exit (fail-closed, NOT a swallowed null)');
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== gh-emit.test.js: ${passed} passed, ${failed} failed, ${skipped} skipped ===\n`);
  if (failed > 0) process.exit(1);
})();
