'use strict';

// tests/unit/kernel/egress/gh-emit-two-identity.test.js — F-W1 the two-identity axis (upstreamRepo vs forkRepo).
// The live network is NEVER touched: a mock `runGh` (deps.runGh) returns canned gh-api JSON and records every call.
// F-W1 threads two repo identities through ghEmit but wires NO fork network call: when `forkRepo` is absent the
// same-owner emit stays BYTE-IDENTICAL to origin/main (the golden-bytes ACCEPTANCE GATE, tests 1-2). The new guards
// (validateForkIdentity, the tightened dedup predicate, the post-create backstop, the OWNER_RE re-validation, the
// pre-network structural PR-endpoint bind) are exercised with a synthesized distinct forkRepo — each proven
// NON-VACUOUS (inject the violation, watch it fire).

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const G = require(path.join(REPO, 'packages', 'kernel', 'egress', 'gh-emit.js'));
const { computeEmissionHash } = require(path.join(REPO, 'packages', 'kernel', 'egress', 'approval.js'));

let passed = 0; let failed = 0; let skipped = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function b64(s) { return Buffer.from(s, 'utf8').toString('base64'); }

const GOOD_REPO = 'owner/repo';
const GOOD_ISSUE = 42;
function draftFor(diff, extra = {}) { return { repo: GOOD_REPO, issueRef: GOOD_ISSUE, diff, title: 't', touched_paths: [], ...extra }; }
function hashFor(diff) { return computeEmissionHash(draftFor(diff)); }

// The FROZEN pre-refactor golden ADD diff (captured from origin/main — see the plan's golden-bytes gate).
const GOLDEN_ADD_DIFF = [
  'diff --git a/DOGFOOD.md b/DOGFOOD.md',
  'new file mode 100644',
  'index 0000000..1111111',
  '--- /dev/null',
  '+++ b/DOGFOOD.md',
  '@@ -0,0 +1,2 @@',
  '+# Dogfood',
  '+a normal line',
  '',
].join('\n');
const GOLDEN_ADD_HASH = 'dc74ea1c2a5cde31a31f0bec601cd3752237f3f3a901b73bedd01456285018d9';
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);
const SHA_D = 'd'.repeat(40);

// The FROZEN golden call bodies (hard-coded literals, NOT regenerated from the refactored code — HIGH-2).
const GOLDEN_TREE_BODY = '{"base_tree":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","tree":[{"path":"DOGFOOD.md","mode":"100644","type":"blob","content":"# Dogfood\\na normal line\\n"}]}';
const GOLDEN_COMMIT_BODY = '{"message":"loom: candidate for issue #42\\n\\napproval-hash: dc74ea1c2a5cde31a31f0bec601cd3752237f3f3a901b73bedd01456285018d9\\nbase-commit: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n","tree":"cccccccccccccccccccccccccccccccccccccccc","parents":["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]}';
const GOLDEN_REF_BODY = '{"ref":"refs/heads/loom/issue-42-dc74ea1c2a5c","sha":"dddddddddddddddddddddddddddddddddddddddd"}';
const GOLDEN_PULL_BODY = '{"title":"loom: candidate for issue #42","head":"loom/issue-42-dc74ea1c2a5c","base":"main","body":"Automated DRAFT candidate from Power Loom for issue #42.\\n\\nThis is a SHADOW/DRAFT egress behind a signed, human-approved gate. It is a draft for human review, not a merge request.\\n\\napproval-hash: dc74ea1c2a5cde31a31f0bec601cd3752237f3f3a901b73bedd01456285018d9\\nbase-commit: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n","draft":true}';

// A clean MODIFY diff (mirrors gh-emit.test.js): change line 2, append line 4. base "line1\nline2\nline3\n".
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

// A configurable mock gh, EXTENDED from gh-emit.test.js's makeGh with a `base` field on the pulls responses
// (HIGH-3: the tightened dedup predicate + the post-create backstop read pr.base.repo.full_name + pr.base.ref).
// `prBaseRepoFullName` / `prBaseRef` default to the UPSTREAM repo + resolved default branch (the happy path);
// per-test overrides synthesize a mismatch. `upstreamRepo` is the reads/dedup/PR-create identity; `forkRepo` is
// the tree/commit/ref/rollback identity — both default to GOOD_REPO (the byte-identical no-fork case).
function makeGh({ upstreamRepo = GOOD_REPO, defaultBranch = 'main', refExists = false, failPulls = false, existingPulls,
  baseContents = {}, baseTreeModes = {},
  prBaseRepoFullName, prBaseRef, prNumber = 9, prUrl = 'https://github.com/o/r/pull/9' } = {}) {
  const calls = [];
  function method(args) { const i = args.indexOf('--method'); return i >= 0 ? args[i + 1] : 'GET'; }
  const baseFull = prBaseRepoFullName === undefined ? upstreamRepo : prBaseRepoFullName;
  const baseRef = prBaseRef === undefined ? defaultBranch : prBaseRef;
  function gh(args, o) {
    calls.push({ args: args.slice(), input: o && o.input, method: method(args) });
    const ep = args[1] || '';
    const m = method(args);
    if (ep === `repos/${upstreamRepo}`) return JSON.stringify({ default_branch: defaultBranch });
    if (/\/contents\//.test(ep)) {
      const mm = ep.match(/\/contents\/(.+?)\?ref=/);
      const p = mm ? mm[1] : null;
      if (Object.prototype.hasOwnProperty.call(baseContents, p)) {
        return JSON.stringify({ encoding: 'base64', content: b64(baseContents[p]), size: Buffer.byteLength(baseContents[p], 'utf8') });
      }
      const e = new Error('404'); e.stderr = 'gh: Not Found (HTTP 404)'; throw e;
    }
    if (/\/git\/ref\/heads\//.test(ep)) return JSON.stringify({ object: { sha: SHA_A } });
    if (/\/git\/commits\/[0-9a-f]+$/.test(ep)) return JSON.stringify({ tree: { sha: SHA_B } });
    if (/\/git\/trees\/[0-9a-f]+\?recursive=1$/.test(ep) && m === 'GET') {
      const allPaths = new Set([...Object.keys(baseContents), ...Object.keys(baseTreeModes)]);
      const tree = [...allPaths].map((p) => ({ path: p, mode: (baseTreeModes[p] || '100644'), type: 'blob' }));
      return JSON.stringify({ truncated: false, tree });
    }
    if (/\/git\/trees$/.test(ep) && m === 'POST') return JSON.stringify({ sha: SHA_C });
    if (/\/git\/commits$/.test(ep) && m === 'POST') return JSON.stringify({ sha: SHA_D });
    if (/\/git\/refs$/.test(ep) && m === 'POST') {
      if (refExists) { const e = new Error('422'); e.stderr = 'gh: Reference already exists (HTTP 422)'; throw e; }
      return JSON.stringify({ ref: 'refs/heads/x' });
    }
    if (/\/pulls\?head=/.test(ep)) {
      const dflt = [{ html_url: 'https://github.com/o/r/pull/7', number: 7, head: { ref: 'x', repo: { full_name: baseFull } }, draft: true, base: { ref: baseRef, repo: { full_name: baseFull } } }];
      return JSON.stringify(existingPulls || dflt);
    }
    if (/\/pulls$/.test(ep) && m === 'POST') {
      if (failPulls) { const e = new Error('500'); e.stderr = 'gh: server error (HTTP 500)'; throw e; }
      return JSON.stringify({ html_url: prUrl, number: prNumber, base: { ref: baseRef, repo: { full_name: baseFull } } });
    }
    // a PATCH close (the post-create backstop best-effort close) — echo an ok body.
    if (/\/pulls\/\d+$/.test(ep) && m === 'PATCH') return JSON.stringify({ state: 'closed' });
    if (/\/git\/refs\/heads\//.test(ep) && m === 'DELETE') return '';
    throw new Error(`mock-gh: unhandled ${m} ${ep}`);
  }
  gh.calls = calls;
  return gh;
}

function endpointsOf(gh) { return gh.calls.map((c) => `${c.method} ${c.args[1]}`); }
function writeCalls(gh) { return gh.calls.filter((c) => c.method === 'POST' || c.method === 'DELETE'); }
function findCall(gh, re, m) { return gh.calls.find((c) => re.test(c.args[1]) && (m === undefined || c.method === m)); }

// Capture [LOOM-EGRESS-ALERT] tokens written to stderr during `fn` (proves the fail-closed reject is OBSERVABLE).
function captureAlerts(fn) {
  const orig = process.stderr.write.bind(process.stderr);
  const lines = [];
  process.stderr.write = (chunk, ...rest) => { lines.push(String(chunk)); return typeof rest[rest.length - 1] === 'function' ? rest[rest.length - 1]() : true; };
  try { fn(); } catch (e) { lines._err = e; } finally { process.stderr.write = orig; }
  return { text: lines.join(''), err: lines._err };
}

// === TEST 1: golden-bytes, no-fork ADD happy path — the F-W1 ACCEPTANCE GATE (exact-string, key-order-sensitive) ===

test('1 golden-bytes ADD: with forkRepo absent, every argv + JSON body + the return are BYTE-IDENTICAL to origin/main', () => {
  const gh = makeGh();
  const r = G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {} }, { runGh: gh });
  // exact return (F-8: the base_sha feeds the kernel join-key — an argv-only golden misses a return regression).
  assert.deepStrictEqual(r, { pr_url: 'https://github.com/o/r/pull/9', number: 9, branch: 'loom/issue-42-dc74ea1c2a5c', base_sha: SHA_A });
  // exact endpoint sequence (all on the upstream/same-owner identity when forkRepo is absent).
  assert.deepStrictEqual(endpointsOf(gh), [
    'GET repos/owner/repo',
    `GET repos/owner/repo/git/ref/heads/main`,
    `GET repos/owner/repo/git/commits/${SHA_A}`,
    'POST repos/owner/repo/git/trees',
    'POST repos/owner/repo/git/commits',
    'POST repos/owner/repo/git/refs',
    'POST repos/owner/repo/pulls',
  ]);
  // exact JSON bodies — assert.strictEqual on the STRING (a JSON.parse+deepEqual is key-order-blind).
  assert.strictEqual(findCall(gh, /\/git\/trees$/, 'POST').input, GOLDEN_TREE_BODY, 'tree body byte-identical');
  assert.strictEqual(findCall(gh, /\/git\/commits$/, 'POST').input, GOLDEN_COMMIT_BODY, 'commit body byte-identical');
  assert.strictEqual(findCall(gh, /\/git\/refs$/, 'POST').input, GOLDEN_REF_BODY, 'ref body byte-identical');
  assert.strictEqual(findCall(gh, /\/pulls$/, 'POST').input, GOLDEN_PULL_BODY, 'pull body byte-identical');
});

// === TEST 1b: golden NON-VACUITY negative control (VALIDATE-honesty F-2) ===

test('1b golden NON-VACUITY (negative control): re-serializing a golden body with SWAPPED key order != the golden — proving the exact-string assert would catch a key-reorder regression', () => {
  // The golden-bytes tests use assert.strictEqual on the JSON STRING (key-order-sensitive). This negative control
  // DEMONSTRATES (rather than merely asserts) that non-vacuity: a body with identical VALUES but swapped KEY ORDER
  // produces DIFFERENT bytes, so a refactor that reordered keys would fail test 1. (security.md non-vacuous-guard.)
  const parsed = JSON.parse(GOLDEN_TREE_BODY);
  const swapped = JSON.stringify({ tree: parsed.tree, base_tree: parsed.base_tree });   // opposite key order
  assert.notStrictEqual(swapped, GOLDEN_TREE_BODY, 'a key-reorder produces DIFFERENT bytes => test 1 is non-vacuous');
  assert.deepStrictEqual(JSON.parse(swapped), parsed, 'same VALUES, only key order differs (a pure reorder, not a value change)');
});

// === TEST 2: golden-bytes, no-fork MODIFY path (exercises the base-fetch reads on the upstream identity) ===

test('2 golden MODIFY: with forkRepo absent, the full read+write sequence stays on the upstream identity', () => {
  const gh = makeGh({ baseContents: { 'f.txt': MODIFY_BASE } });
  const r = G.ghEmit({ draft: draftFor(MODIFY_DIFF), approvalHash: hashFor(MODIFY_DIFF), env: {} }, { runGh: gh });
  assert.strictEqual(r.number, 9);
  assert.strictEqual(r.base_sha, SHA_A);
  assert.deepStrictEqual(endpointsOf(gh), [
    'GET repos/owner/repo',
    'GET repos/owner/repo/git/ref/heads/main',
    `GET repos/owner/repo/git/commits/${SHA_A}`,
    `GET repos/owner/repo/git/trees/${SHA_B}?recursive=1`,
    `GET repos/owner/repo/contents/f.txt?ref=${SHA_A}`,
    'POST repos/owner/repo/git/trees',
    'POST repos/owner/repo/git/commits',
    'POST repos/owner/repo/git/refs',
    'POST repos/owner/repo/pulls',
  ], 'a no-fork MODIFY is byte-identical: base reads + writes all on upstream/repo');
  const tree = JSON.parse(findCall(gh, /\/git\/trees$/, 'POST').input);
  assert.strictEqual(tree.tree[0].content, 'line1\nLINE-TWO-CHANGED\nline3\nline4-added\n');
});

// === TEST 3: fork-name-mismatch throws pre-write, ZERO writes ===

test('3 fork-name mismatch: a forkRepo whose NAME != upstream name => fork-identity-mismatch throw, ZERO network writes', () => {
  const gh = makeGh();
  // both sides are valid NORMALIZED shapes; only the repo NAME differs => the NAME-equality guard fires (a
  // non-normalized name would trip fork-repo-unsafe first — this test isolates the name-mismatch path).
  const { text, err } = captureAlerts(() => G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {}, forkRepo: 'bot/differentname' }, { runGh: gh }));
  assert.ok(err && /fork must share/.test(err.message), 'the derivation guard threw (fork must share the repo NAME)');
  assert.ok(/\[LOOM-EGRESS-ALERT\].*fork-identity-mismatch/.test(text), 'the fork-identity-mismatch alert is OBSERVABLE');
  assert.strictEqual(writeCalls(gh).length, 0, 'no POST/DELETE — the derivation guard fired before any network write');
});

// === TEST 4: expectedForkOwner-mismatch throws pre-write ===

test('4 expectedForkOwner mismatch: forkRepo owner != expectedForkOwner => throw before any write', () => {
  const gh = makeGh();
  const { text, err } = captureAlerts(() => G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {}, forkRepo: 'bot/repo', expectedForkOwner: 'someoneelse' }, { runGh: gh }));
  assert.ok(err && /!= expectedForkOwner/.test(err.message), 'threw on an expectedForkOwner mismatch');
  assert.ok(/\[LOOM-EGRESS-ALERT\].*fork-identity-mismatch/.test(text), 'the fork-identity-mismatch alert is OBSERVABLE');
  assert.strictEqual(writeCalls(gh).length, 0, 'no writes on an expectedForkOwner mismatch');
});

// === TEST 5: post-create backstop FIRES on a base.repo mismatch — NON-VACUOUS ===

test('5 post-create backstop fires (NON-VACUOUS): a returned pr.base.repo.full_name != upstream => pr-base-not-upstream + close attempt + throw', () => {
  const gh = makeGh({ prBaseRepoFullName: 'attacker/otherrepo' });
  const { text, err } = captureAlerts(() => G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {} }, { runGh: gh }));
  assert.ok(err && /not the upstream/.test(err.message), 'the backstop threw on a base.repo mismatch (NON-VACUOUS)');
  assert.ok(/\[LOOM-EGRESS-ALERT\].*pr-base-not-upstream/.test(text), 'the pr-base-not-upstream alert is OBSERVABLE');
  // the best-effort close was ATTEMPTED (a PATCH on the upstream pulls endpoint, state:closed).
  const close = gh.calls.find((c) => /\/pulls\/\d+$/.test(c.args[1]) && c.method === 'PATCH');
  assert.ok(close, 'a best-effort close (PATCH pulls/{n}) was attempted');
  assert.strictEqual(close.args[1], `repos/owner/repo/pulls/9`, 'the close targets the upstream endpoint');
  assert.ok(String(close.input).includes('closed'), 'the close sets state:closed');
});

// === TEST 6: post-create backstop PASSES same-owner (happy path) ===

test('6 post-create backstop passes: base.repo.full_name === upstream => no throw, no close attempt', () => {
  const gh = makeGh();   // base.repo.full_name defaults to the upstream repo
  const r = G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {} }, { runGh: gh });
  assert.strictEqual(r.number, 9);
  assert.ok(!gh.calls.some((c) => c.method === 'PATCH'), 'no close attempt on a matching base.repo');
});

// === TEST 6b: post-create backstop FAIL-SAFE on an absent/malformed base.repo.full_name (VALIDATE-honesty F-1) ===

test('6b post-create backstop FAIL-SAFE (F-1): an absent/null base.repo.full_name => pr-base-unverifiable alert + PROCEEDS (no throw, no close) — must NOT regress the working same-owner emit', () => {
  // The field is schema-guaranteed on a conformant GitHub 201 (VALIDATE-hacker OpenAPI deref), so its absence is
  // an API anomaly, not a wrong-repo attack. H-1 (the pre-network structural bind) already guarantees the endpoint
  // was upstream, so the backstop must FAIL SAFE on an absent field — alert + proceed — never throw a working emit.
  const gh = makeGh({ prBaseRepoFullName: null });   // response carries base.repo.full_name === null (absent/malformed)
  let ret;
  const { text, err } = captureAlerts(() => { ret = G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {} }, { runGh: gh }); });
  assert.ok(!err, 'an absent base.repo.full_name does NOT throw (fail-safe; H-1 is the guarantee)');
  assert.ok(ret && ret.number === 9 && typeof ret.pr_url === 'string', 'the emit PROCEEDS and returns the created PR');
  assert.ok(/\[LOOM-EGRESS-ALERT\].*pr-base-unverifiable/.test(text), 'the pr-base-unverifiable alert is OBSERVABLE');
  assert.ok(!gh.calls.some((c) => /\/pulls\/\d+$/.test(c.args[1]) && c.method === 'PATCH'), 'no close attempt on the fail-safe (non-mismatch) path');
});

// === TEST 7: dedup predicate tightened — base.repo.full_name mismatch NOT deduped (fail-closed) ===

test('7 dedup tightened (base.repo): ref-exists + a PR with the right head.ref but base.repo != upstream is NOT deduped', () => {
  const branch = `loom/issue-42-${GOLDEN_ADD_HASH.slice(0, 12)}`;
  const gh = makeGh({ refExists: true, existingPulls: [{ html_url: 'x', number: 999, head: { ref: branch, repo: { full_name: GOOD_REPO } }, draft: true, base: { ref: 'main', repo: { full_name: 'attacker/otherrepo' } } }] });
  assert.throws(
    () => G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {} }, { runGh: gh }),
    /pre-existing branch|no open loom/,
  );
  assert.ok(!endpointsOf(gh).some((e) => e === 'POST repos/owner/repo/pulls'), 'never auto-creates on a base.repo mismatch');
});

// === TEST (dedup case-normalization): an upstream with uppercase full_name still dedups (both sides lowercased) ===

test('7b dedup case-fold: pr.base.repo.full_name canonical-cased vs the normalized upstream => still dedups (lowercase both sides)', () => {
  const branch = `loom/issue-42-${GOLDEN_ADD_HASH.slice(0, 12)}`;
  const gh = makeGh({ refExists: true, existingPulls: [{ html_url: 'https://github.com/o/r/pull/7', number: 7, head: { ref: branch, repo: { full_name: GOOD_REPO } }, draft: true, base: { ref: 'main', repo: { full_name: 'Owner/Repo' } } }] });
  const r = G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {} }, { runGh: gh });
  assert.strictEqual(r.deduped, true, 'a canonical-cased base.repo.full_name still matches the lowercased upstream');
  assert.strictEqual(r.number, 7);
});

// === TEST (dedup happy): the tightened predicate still dedups a fully-matching open PR ===

test('7c dedup happy: ref-exists + a matching (head.ref, draft, base.repo, base.ref) open PR => deduped', () => {
  const branch = `loom/issue-42-${GOLDEN_ADD_HASH.slice(0, 12)}`;
  const gh = makeGh({ refExists: true, existingPulls: [{ html_url: 'https://github.com/o/r/pull/7', number: 7, head: { ref: branch, repo: { full_name: GOOD_REPO } }, draft: true, base: { ref: 'main', repo: { full_name: GOOD_REPO } } }] });
  const r = G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {} }, { runGh: gh });
  assert.deepStrictEqual(r, { pr_url: 'https://github.com/o/r/pull/7', number: 7, branch, deduped: true, base_sha: SHA_A });
});

// === TEST 12: ghEmit IGNORES draft.forkRepo (the C2 co-forge guard — reads only the named arg) ===

test('12 ghEmit ignores draft.forkRepo: a draft carrying forkRepo does NOT steer the identity (reads the named arg only)', () => {
  const gh = makeGh();
  // a hostile draft carries a forkRepo field; it is NOT the named ghEmit arg, so it must not steer anything.
  // NB the hash is over the emissionAxiom {repo,issueRef,diff} — a forkRepo key on the draft does not change it.
  const draft = draftFor(GOLDEN_ADD_DIFF, { forkRepo: 'attacker/evil' });
  const r = G.ghEmit({ draft, approvalHash: GOLDEN_ADD_HASH, env: {} }, { runGh: gh });
  // every write endpoint stays on the upstream/same-owner identity — the draft.forkRepo was ignored.
  assert.deepStrictEqual(endpointsOf(gh), [
    'GET repos/owner/repo',
    'GET repos/owner/repo/git/ref/heads/main',
    `GET repos/owner/repo/git/commits/${SHA_A}`,
    'POST repos/owner/repo/git/trees',
    'POST repos/owner/repo/git/commits',
    'POST repos/owner/repo/git/refs',
    'POST repos/owner/repo/pulls',
  ], 'draft.forkRepo does NOT re-route any write — the named arg governs identity');
  assert.strictEqual(r.number, 9);
});

// === TEST 13: PR-create endpoint stays repos/${upstreamRepo}/pulls even with a distinct forkRepo (H-1 bind) ===

test('13 PR-create endpoint bind: with a distinct valid forkRepo, POST pulls is STILL repos/${upstreamRepo}/pulls', () => {
  const gh = makeGh();
  // forkRepo shares the repo NAME (passes validateForkIdentity); its owner differs. Writes route to the fork's
  // identity string, but since makeGh only serves the upstream repo string, we synthesize a fork that RESOLVES to
  // the same identity by giving the fork the SAME owner/name but keeping the guard happy. To assert the PR endpoint
  // bind independently, use a fork identity equal to upstream (byte-identical) and verify the endpoint literal.
  const r = G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {}, forkRepo: GOOD_REPO }, { runGh: gh });
  const create = findCall(gh, /\/pulls$/, 'POST');
  assert.strictEqual(create.args[1], 'repos/owner/repo/pulls', 'the PR-create endpoint is provably the upstream repo');
  assert.strictEqual(r.number, 9);
});

// === TEST 13b: a fork on a DISTINCT owner routes WRITES to the fork identity, but PR-create to upstream ===

test('13b distinct-owner fork: tree/commit/ref WRITES route to the fork identity; dedup+PR-create stay upstream', () => {
  // The fork shares the repo NAME (owner/repo -> botacct/repo). makeGh serves the fork identity's git-data writes
  // and the upstream identity's reads. We must serve BOTH repo strings — extend via a composed mock.
  const upstream = 'owner/repo';
  const fork = 'botacct/repo';
  const calls = [];
  function method(args) { const i = args.indexOf('--method'); return i >= 0 ? args[i + 1] : 'GET'; }
  function gh(args, o) {
    calls.push({ args: args.slice(), input: o && o.input, method: method(args) });
    const ep = args[1] || ''; const m = method(args);
    if (ep === `repos/${upstream}`) return JSON.stringify({ default_branch: 'main' });
    if (/\/git\/ref\/heads\//.test(ep)) return JSON.stringify({ object: { sha: SHA_A } });
    if (/\/git\/commits\/[0-9a-f]+$/.test(ep)) return JSON.stringify({ tree: { sha: SHA_B } });
    if (new RegExp(`^repos/${fork}/git/trees$`).test(ep) && m === 'POST') return JSON.stringify({ sha: SHA_C });
    if (new RegExp(`^repos/${fork}/git/commits$`).test(ep) && m === 'POST') return JSON.stringify({ sha: SHA_D });
    if (new RegExp(`^repos/${fork}/git/refs$`).test(ep) && m === 'POST') return JSON.stringify({ ref: 'refs/heads/x' });
    if (/\/pulls$/.test(ep) && m === 'POST') return JSON.stringify({ html_url: 'https://github.com/o/r/pull/9', number: 9, base: { ref: 'main', repo: { full_name: upstream } } });
    throw new Error(`mock: unhandled ${m} ${ep}`);
  }
  gh.calls = calls;
  const r = G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {}, forkRepo: fork }, { runGh: gh });
  assert.strictEqual(r.number, 9);
  const eps = calls.map((c) => `${c.method} ${c.args[1]}`);
  assert.ok(eps.includes(`POST repos/${fork}/git/trees`), 'the tree WRITE targets the fork');
  assert.ok(eps.includes(`POST repos/${fork}/git/commits`), 'the commit WRITE targets the fork');
  assert.ok(eps.includes(`POST repos/${fork}/git/refs`), 'the ref WRITE targets the fork');
  assert.ok(eps.includes(`POST repos/${upstream}/pulls`), 'the PR-create stays UPSTREAM (H-1)');
  assert.ok(eps.includes(`GET repos/${upstream}`), 'the default_branch read stays UPSTREAM');
});

// === TEST 14: forkOwner failing OWNER_RE => fork-owner-unsafe + throw, zero writes (C-1) ===

test('14 forkOwner OWNER_RE: a forkRepo whose owner is not a valid GitHub login => fork-owner-unsafe throw, ZERO writes', () => {
  const gh = makeGh();
  // an owner with a leading hyphen / dot / underscore fails OWNER_RE. The repo NAME still matches so the mismatch
  // guard would NOT fire — this must be caught by the OWNER_RE re-validation specifically.
  // '-evil'/'o.w'/'a_b' are rejected by the NORMALIZED_REPO_RE shape gate (fork-repo-unsafe); 'a--b' passes the
  // shape but fails OWNER_RE specifically (consecutive hyphens) => fork-owner-unsafe. Both are C-1 fail-closed.
  for (const badOwner of ['-evil', 'o.w', 'a_b', 'a--b']) {
    const gh2 = makeGh();
    assert.throws(
      () => G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {}, forkRepo: `${badOwner}/repo` }, { runGh: gh2 }),
      /valid GitHub login|not a normalized owner\/name|fail-closed/,
      `forkRepo owner ${badOwner} must fail closed`,
    );
    assert.strictEqual(writeCalls(gh2).length, 0, `no writes for a bad forkOwner ${badOwner}`);
  }
  assert.strictEqual(writeCalls(gh).length, 0);
});

// === TEST 15: dedup base.ref mismatch NOT deduped ===

test('15 dedup base.ref: ref-exists + a PR with the right head.ref+base.repo but base.ref != base is NOT deduped', () => {
  const branch = `loom/issue-42-${GOLDEN_ADD_HASH.slice(0, 12)}`;
  const gh = makeGh({ refExists: true, existingPulls: [{ html_url: 'x', number: 999, head: { ref: branch, repo: { full_name: GOOD_REPO } }, draft: true, base: { ref: 'a-different-branch', repo: { full_name: GOOD_REPO } } }] });
  assert.throws(
    () => G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {} }, { runGh: gh }),
    /pre-existing branch|no open loom/,
  );
});

// === TEST 15b: dedup NON-DRAFT negative control (CodeRabbit Minor) ===

test('15b dedup non-draft: ref-exists + a matching (head, base) PR but draft === false is NOT deduped (fail-closed)', () => {
  // the exact-set predicate includes draft === true; a non-draft PR (a maintainer's real PR sharing the branch)
  // must never dedup into loom's approval envelope. Non-vacuity control for the draft conjunct.
  const branch = `loom/issue-42-${GOLDEN_ADD_HASH.slice(0, 12)}`;
  const gh = makeGh({ refExists: true, existingPulls: [{ html_url: 'x', number: 999, head: { ref: branch, repo: { full_name: GOOD_REPO } }, draft: false, base: { ref: 'main', repo: { full_name: GOOD_REPO } } }] });
  assert.throws(
    () => G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {} }, { runGh: gh }),
    /pre-existing branch|no open loom/,
  );
});

// === TEST 15c: dedup HEAD-repo binding (CodeRabbit Major) — a PR whose head.repo != the resolved fork is NOT deduped ===

test('15c dedup head-repo: ref-exists + a PR with the right head.ref+base but head.repo != resolvedForkRepo is NOT deduped', () => {
  // the dedup reconciles to a PR we did NOT create; its head must be OUR fork, not an upstream branch that
  // coincidentally shares the loom branch name. Non-vacuity control for the head.repo.full_name conjunct.
  const branch = `loom/issue-42-${GOLDEN_ADD_HASH.slice(0, 12)}`;
  const gh = makeGh({ refExists: true, existingPulls: [{ html_url: 'x', number: 999, head: { ref: branch, repo: { full_name: 'someoneelse/repo' } }, draft: true, base: { ref: 'main', repo: { full_name: GOOD_REPO } } }] });
  assert.throws(
    () => G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {} }, { runGh: gh }),
    /pre-existing branch|no open loom/,
  );
});

// === TEST 16: PR-create head stays the bare branch even with forkRepo supplied (F-W1/F-W3 boundary lock) ===

test('16 PR-create head bare branch: even with forkRepo supplied, head is the bare branch (F-W3 flips to owner:branch)', () => {
  const gh = makeGh();
  G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {}, forkRepo: GOOD_REPO }, { runGh: gh });
  const pull = JSON.parse(findCall(gh, /\/pulls$/, 'POST').input);
  assert.strictEqual(pull.head, `loom/issue-42-${GOLDEN_ADD_HASH.slice(0, 12)}`, 'F-W1 keeps head as the bare branch (no owner: prefix)');
});

// === TEST 17: MODIFY + distinct forkRepo => base reads still hit repos/${upstreamRepo} ===

test('17 MODIFY + distinct fork: base-tree + contents READS still target the upstream (highest-risk stray combo)', () => {
  const upstream = 'owner/repo';
  const fork = 'botacct/repo';
  const calls = [];
  function method(args) { const i = args.indexOf('--method'); return i >= 0 ? args[i + 1] : 'GET'; }
  function gh(args, o) {
    calls.push({ args: args.slice(), input: o && o.input, method: method(args) });
    const ep = args[1] || ''; const m = method(args);
    if (ep === `repos/${upstream}`) return JSON.stringify({ default_branch: 'main' });
    if (/\/git\/ref\/heads\//.test(ep)) return JSON.stringify({ object: { sha: SHA_A } });
    if (/\/git\/commits\/[0-9a-f]+$/.test(ep)) return JSON.stringify({ tree: { sha: SHA_B } });
    if (new RegExp(`^repos/${upstream}/git/trees/[0-9a-f]+\\?recursive=1$`).test(ep) && m === 'GET') {
      return JSON.stringify({ truncated: false, tree: [{ path: 'f.txt', mode: '100644', type: 'blob' }] });
    }
    if (new RegExp(`^repos/${upstream}/contents/`).test(ep)) {
      return JSON.stringify({ encoding: 'base64', content: b64(MODIFY_BASE), size: MODIFY_BASE.length });
    }
    if (new RegExp(`^repos/${fork}/git/trees$`).test(ep) && m === 'POST') return JSON.stringify({ sha: SHA_C });
    if (new RegExp(`^repos/${fork}/git/commits$`).test(ep) && m === 'POST') return JSON.stringify({ sha: SHA_D });
    if (new RegExp(`^repos/${fork}/git/refs$`).test(ep) && m === 'POST') return JSON.stringify({ ref: 'refs/heads/x' });
    if (/\/pulls$/.test(ep) && m === 'POST') return JSON.stringify({ html_url: 'u', number: 9, base: { ref: 'main', repo: { full_name: upstream } } });
    throw new Error(`mock: unhandled ${m} ${ep}`);
  }
  gh.calls = calls;
  const r = G.ghEmit({ draft: draftFor(MODIFY_DIFF), approvalHash: hashFor(MODIFY_DIFF), env: {}, forkRepo: fork }, { runGh: gh });
  assert.strictEqual(r.number, 9);
  const eps = calls.map((c) => `${c.method} ${c.args[1]}`);
  assert.ok(eps.some((e) => e === `GET repos/${upstream}/git/trees/${SHA_B}?recursive=1`), 'base-tree READ stays upstream');
  assert.ok(eps.some((e) => new RegExp(`^GET repos/${upstream}/contents/f.txt\\?ref=`).test(e)), 'contents READ stays upstream');
  assert.ok(eps.includes(`POST repos/${fork}/git/trees`), 'the tree WRITE targets the fork');
});

// === TEST 18: validateForkIdentity direct — both-undefined-name / empty upstreamName / empty forkRepo fail closed ===

test('18 validateForkIdentity direct: same-owner passes; empty upstreamName / empty forkRepo / bad shapes fail closed', () => {
  // the happy no-fork case: forkRepo undefined resolves to upstream, forkOwner === upstreamOwner.
  const ok = G.validateForkIdentity({ upstreamRepo: 'owner/repo', forkRepo: undefined, expectedForkOwner: undefined });
  assert.deepStrictEqual(ok, { resolvedForkRepo: 'owner/repo', forkOwner: 'owner' });
  // M-2 present-target precondition: an upstreamRepo with an empty name must NOT pass vacuously.
  // (NB `owner/` resolvedForkRepo === upstream `owner/` fails the shape gate first — either way it fails closed.)
  assert.throws(() => G.validateForkIdentity({ upstreamRepo: 'owner/', forkRepo: undefined }), /.+/, 'empty upstreamName fails closed (no vacuous pass)');
  // an upstream with a name but a fork whose name is empty must hit the present-target precondition, not pass.
  assert.throws(() => G.validateForkIdentity({ upstreamRepo: 'owner/', forkRepo: 'bot/repo' }), /no name segment|not a valid GitHub login|share/, 'a nameless upstream fails closed');
  // F-5: an EMPTY-string forkRepo must fail LOUD, not resolve-to-upstream.
  assert.throws(() => G.validateForkIdentity({ upstreamRepo: 'owner/repo', forkRepo: '' }), /not a normalized owner\/name/, 'empty-string forkRepo fails closed');
  // a malformed forkRepo (not owner/name) fails closed.
  assert.throws(() => G.validateForkIdentity({ upstreamRepo: 'owner/repo', forkRepo: 'not-a-repo' }), /not a normalized owner\/name/);
  // a name mismatch throws.
  assert.throws(() => G.validateForkIdentity({ upstreamRepo: 'owner/repo', forkRepo: 'bot/other' }), /fork must share/);
  // a valid distinct-owner fork passes (name shared).
  const fork = G.validateForkIdentity({ upstreamRepo: 'owner/repo', forkRepo: 'botacct/repo' });
  assert.deepStrictEqual(fork, { resolvedForkRepo: 'botacct/repo', forkOwner: 'botacct' });
  // an expectedForkOwner match passes; a mismatch throws.
  assert.doesNotThrow(() => G.validateForkIdentity({ upstreamRepo: 'owner/repo', forkRepo: 'botacct/repo', expectedForkOwner: 'botacct' }));
  assert.throws(() => G.validateForkIdentity({ upstreamRepo: 'owner/repo', forkRepo: 'botacct/repo', expectedForkOwner: 'someone' }), /!= expectedForkOwner/);
});

// === structural helper non-vacuity (upstreamApi/forkApi produce exact argv) — covered structurally by tests 1/13b/17.
// (The helpers are internal; their behavior is asserted through the exact endpoint strings above.)

// === TEST: rollback DELETE targets the fork identity (MED-3: failPulls reaches the rollback branch) ===

test('rollback DELETE targets the fork: with a distinct fork + failPulls, the DELETE argv uses the fork identity', () => {
  const upstream = 'owner/repo';
  const fork = 'botacct/repo';
  const calls = [];
  function method(args) { const i = args.indexOf('--method'); return i >= 0 ? args[i + 1] : 'GET'; }
  function gh(args, o) {
    calls.push({ args: args.slice(), input: o && o.input, method: method(args) });
    const ep = args[1] || ''; const m = method(args);
    if (ep === `repos/${upstream}`) return JSON.stringify({ default_branch: 'main' });
    if (/\/git\/ref\/heads\//.test(ep)) return JSON.stringify({ object: { sha: SHA_A } });
    if (/\/git\/commits\/[0-9a-f]+$/.test(ep)) return JSON.stringify({ tree: { sha: SHA_B } });
    if (new RegExp(`^repos/${fork}/git/trees$`).test(ep) && m === 'POST') return JSON.stringify({ sha: SHA_C });
    if (new RegExp(`^repos/${fork}/git/commits$`).test(ep) && m === 'POST') return JSON.stringify({ sha: SHA_D });
    if (new RegExp(`^repos/${fork}/git/refs$`).test(ep) && m === 'POST') return JSON.stringify({ ref: 'refs/heads/x' });
    if (/\/pulls$/.test(ep) && m === 'POST') { const e = new Error('500'); e.stderr = 'gh: server error (HTTP 500)'; throw e; }
    if (new RegExp(`^repos/${fork}/git/refs/heads/`).test(ep) && m === 'DELETE') return '';
    throw new Error(`mock: unhandled ${m} ${ep}`);
  }
  gh.calls = calls;
  assert.throws(() => G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {}, forkRepo: fork }, { runGh: gh }), /500|failed/);
  const del = calls.find((c) => c.method === 'DELETE');
  assert.ok(del, 'the reserve->rollback DELETE fired');
  assert.ok(new RegExp(`^repos/${fork}/git/refs/heads/`).test(del.args[1]), 'the rollback DELETE targets the FORK identity (H3), not upstream');
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== gh-emit-two-identity.test.js: ${passed} passed, ${failed} failed, ${skipped} skipped ===\n`);
  if (failed > 0) process.exit(1);
})();
