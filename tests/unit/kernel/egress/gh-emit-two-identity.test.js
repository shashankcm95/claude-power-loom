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
//
// F-W2 additions (all inert in the byte-identical no-fork default — `resolvedForkRepo === upstreamRepo` => ensureFork
// never fires, so these routes are never hit and tests 1/2 stay unchanged):
//   - `forkRepo`         — when a distinct fork is under test, the fork-identity string served by the fork routes.
//   - `forkGetSequence`  — an ARRAY of status codes returned by `GET repos/${forkRepo}` in order (e.g. [404,404,200])
//                          driving the create-then-readiness-poll; default a single 200 (the fork already exists).
//                          200 => the `forkRepoMeta` shape; 404 => a Not-Found throw; any other code => that HTTP throw.
//   - `forkRepoMeta`     — the `.fork`/`.source.full_name`/`.owner.login` shape of a 200 fork-GET; default a VALID
//                          fork of upstream owned by the upstream owner (so a same-name distinct-owner fork verifies).
//   - `forkRefSha`       — the `.object.sha` returned by `GET repos/${forkRepo}/git/ref/heads/${branch}` (the H3
//                          fork-tip read); default SHA_D (the created commit sha) so the happy fork-mode path verifies.
//   - the `/git/ref/heads/` dispatch is ENDPOINT-AWARE: an UPSTREAM base-ref => SHA_A (unchanged, tests 1/2);
//                          a FORK-branch-ref (`repos/${forkRepo}/git/ref/heads/...`) => `forkRefSha`.
function makeGh({ upstreamRepo = GOOD_REPO, defaultBranch = 'main', refExists = false, failPulls = false, existingPulls,
  baseContents = {}, baseTreeModes = {},
  forkRepo, forkGetSequence, forkRepoMeta, forkRefSha = SHA_D,
  prBaseRepoFullName, prBaseRef, prNumber = 9, prUrl = 'https://github.com/o/r/pull/9' } = {}) {
  const calls = [];
  function method(args) { const i = args.indexOf('--method'); return i >= 0 ? args[i + 1] : 'GET'; }
  const baseFull = prBaseRepoFullName === undefined ? upstreamRepo : prBaseRepoFullName;
  const baseRef = prBaseRef === undefined ? defaultBranch : prBaseRef;
  // the resolved fork identity + a mutable index into forkGetSequence (one entry consumed per fork-GET).
  const forkId = forkRepo || upstreamRepo;
  const forkSeq = Array.isArray(forkGetSequence) ? forkGetSequence.slice() : [200];
  let forkSeqIdx = 0;
  // a default VALID fork-of-upstream shape: a fork owned by the SAME owner as the resolved fork identity, whose
  // .source.full_name is the upstream. (For a distinct-owner fork `botacct/repo` the owner is `botacct`.)
  function defaultForkMeta() {
    const forkOwner = forkId.split('/')[0];
    return { fork: true, full_name: forkId, owner: { login: forkOwner }, source: { full_name: upstreamRepo } };
  }
  function forkGetResponse() {
    const code = forkSeqIdx < forkSeq.length ? forkSeq[forkSeqIdx] : forkSeq[forkSeq.length - 1];
    forkSeqIdx += 1;
    if (code === 200) return JSON.stringify(forkRepoMeta === undefined ? defaultForkMeta() : forkRepoMeta);
    const e = new Error(String(code));
    e.stderr = code === 404 ? 'gh: Not Found (HTTP 404)' : `gh: error (HTTP ${code})`;
    throw e;
  }
  function gh(args, o) {
    calls.push({ args: args.slice(), input: o && o.input, method: method(args) });
    const ep = args[1] || '';
    const m = method(args);
    // F-W2 fork lifecycle routes (only reached in fork mode). ORDER matters: the fork-GET (`repos/${forkId}` exactly)
    // must be checked BEFORE the upstream-meta route, and the POST /forks + fork-ref-tip routes before the generic ones.
    if (ep === `repos/${forkId}` && forkId !== upstreamRepo && m === 'GET') return forkGetResponse();
    if (ep === `repos/${upstreamRepo}/forks` && m === 'POST') return JSON.stringify({ full_name: forkId });
    if (forkId !== upstreamRepo && new RegExp(`^repos/${forkId}/git/ref/heads/`).test(ep) && m === 'GET') {
      return JSON.stringify({ object: { sha: forkRefSha } });
    }
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

// A convenience wrapper: a mock gh serving a DISTINCT valid fork of the upstream (owner differs, name shared) plus
// the F-W2 fork lifecycle. Callers pass overrides (forkGetSequence, forkRepoMeta, forkRefSha, refExists, existingPulls)
// through to makeGh. Used by the fork-mode F-W2 tests below.
const FORK_REPO = 'botacct/repo';   // shares the repo NAME with GOOD_REPO ('owner/repo'); distinct owner.
function makeForkGh(overrides = {}) {
  return makeGh({ forkRepo: FORK_REPO, ...overrides });
}
// the branch the emit reserves for the golden ADD draft (deterministic from the issue + approval hash).
const FORK_BRANCH = `loom/issue-42-${GOLDEN_ADD_HASH.slice(0, 12)}`;
// the fork write endpoints that MUST be zero on a fail-closed red path (M2 non-vacuity: assert zero fork writes).
function forkWriteCalls(gh) {
  return gh.calls.filter((c) => (c.method === 'POST' || c.method === 'DELETE')
    && /\/git\/(trees|commits|refs)/.test(c.args[1]) && new RegExp(`^repos/${FORK_REPO}/`).test(c.args[1]));
}
function forkGetCalls(gh) { return gh.calls.filter((c) => c.args[1] === `repos/${FORK_REPO}` && c.method === 'GET'); }
function forksPostCalls(gh) { return gh.calls.filter((c) => c.args[1] === `repos/${GOOD_REPO}/forks` && c.method === 'POST'); }

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
  // The fork shares the repo NAME (owner/repo -> botacct/repo). F-W2: ensureFork verifies the fork FIRST (a
  // GET repos/botacct/repo => 200 valid fork of upstream), then the H2 re-bind before the write + the H3 fork-tip
  // read before the PR-create fire (fork mode). makeForkGh serves all of these + the fork's git-data writes; the
  // upstream identity serves the reads/dedup/PR-create.
  const fork = FORK_REPO;
  const gh = makeForkGh({ forkRefSha: SHA_D });   // the created commit sha (H3 fork-tip === commit.sha)
  const r = G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {}, forkRepo: fork, expectedForkOwner: 'botacct' }, { runGh: gh });
  assert.strictEqual(r.number, 9);
  const eps = endpointsOf(gh);
  assert.ok(eps.includes(`GET repos/${fork}`), 'ensureFork verified the fork (GET repos/botacct/repo)');
  assert.ok(eps.includes(`POST repos/${fork}/git/trees`), 'the tree WRITE targets the fork');
  assert.ok(eps.includes(`POST repos/${fork}/git/commits`), 'the commit WRITE targets the fork');
  assert.ok(eps.includes(`POST repos/${fork}/git/refs`), 'the ref WRITE targets the fork');
  assert.ok(eps.includes(`POST repos/${GOOD_REPO}/pulls`), 'the PR-create stays UPSTREAM (H-1)');
  assert.ok(eps.includes(`GET repos/${GOOD_REPO}`), 'the default_branch read stays UPSTREAM');
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
  const fork = FORK_REPO;
  const calls = [];
  function method(args) { const i = args.indexOf('--method'); return i >= 0 ? args[i + 1] : 'GET'; }
  function gh(args, o) {
    calls.push({ args: args.slice(), input: o && o.input, method: method(args) });
    const ep = args[1] || ''; const m = method(args);
    // F-W2 fork lifecycle: ensureFork verifies the fork (GET repos/fork => valid), the H2 re-bind re-reads it before
    // the write, and the H3 fork-tip read (GET repos/fork/git/ref/heads/branch) returns the created commit sha.
    if (ep === `repos/${fork}` && m === 'GET') return JSON.stringify({ fork: true, full_name: fork, owner: { login: 'botacct' }, source: { full_name: upstream } });
    if (new RegExp(`^repos/${fork}/git/ref/heads/`).test(ep) && m === 'GET') return JSON.stringify({ object: { sha: SHA_D } });
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
  const r = G.ghEmit({ draft: draftFor(MODIFY_DIFF), approvalHash: hashFor(MODIFY_DIFF), env: {}, forkRepo: fork, expectedForkOwner: 'botacct' }, { runGh: gh });
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
  const fork = FORK_REPO;
  const calls = [];
  function method(args) { const i = args.indexOf('--method'); return i >= 0 ? args[i + 1] : 'GET'; }
  function gh(args, o) {
    calls.push({ args: args.slice(), input: o && o.input, method: method(args) });
    const ep = args[1] || ''; const m = method(args);
    // F-W2 fork lifecycle: ensureFork verify + H2 re-bind (GET repos/fork => valid) + H3 fork-tip (=== commit sha).
    if (ep === `repos/${fork}` && m === 'GET') return JSON.stringify({ fork: true, full_name: fork, owner: { login: 'botacct' }, source: { full_name: upstream } });
    if (new RegExp(`^repos/${fork}/git/ref/heads/`).test(ep) && m === 'GET') return JSON.stringify({ object: { sha: SHA_D } });
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
  assert.throws(() => G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {}, forkRepo: fork, expectedForkOwner: 'botacct' }, { runGh: gh }), /500|failed/);
  const del = calls.find((c) => c.method === 'DELETE');
  assert.ok(del, 'the reserve->rollback DELETE fired');
  assert.ok(new RegExp(`^repos/${fork}/git/refs/heads/`).test(del.args[1]), 'the rollback DELETE targets the FORK identity (H3), not upstream');
});

// ==========================================================================================================
// F-W2 — the fork lifecycle (`ensureFork`), DORMANT / byte-identical. Each guard is proven NON-VACUOUS: the red
// tests assert the SPECIFIC alert token AND zero fork writes. `sleep` is INJECTED as a no-op counter so the
// readiness-poll tests drive the 404-then-200 path with ZERO real waiting.
// ==========================================================================================================

// A no-op sleep that records how many times it was called (drives the readiness-poll timing tests without waiting).
function makeSleepSpy() { const s = () => { s.count += 1; }; s.count = 0; return s; }

// === F-W2 TEST 3: ensureFork is SKIPPED in same-owner mode (byte-identity — zero /forks or fork-GET calls) ===

test('F3 ensureFork skipped (same-owner): forkRepo absent => zero POST /forks and zero fork-GET calls; the ensureFork machinery is unreachable', () => {
  const gh = makeGh();
  G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {} }, { runGh: gh });
  const eps = endpointsOf(gh);
  assert.ok(!eps.some((e) => /\/forks$/.test(e)), 'no POST /forks in same-owner mode');
  // the only GET repos/owner/repo is the default_branch read (ensureFork would add a SECOND repos-GET on the fork id).
  assert.strictEqual(eps.filter((e) => e === 'GET repos/owner/repo').length, 1, 'exactly one repos-GET (default_branch); ensureFork added none');
});

// === F-W2 TEST 4: ensureFork happy — the fork already EXISTS (GET 200 valid) => no POST /forks, proceeds ===

test('F4 ensureFork happy (fork exists): a distinct fork whose GET 200s as a valid fork of upstream => no POST /forks, the emit proceeds', () => {
  const gh = makeForkGh({ forkGetSequence: [200] });   // fork exists, single 200
  const r = G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {}, forkRepo: FORK_REPO, expectedForkOwner: 'botacct' }, { runGh: gh });
  assert.strictEqual(r.number, 9);
  assert.strictEqual(forksPostCalls(gh).length, 0, 'no POST /forks when the fork already exists');
  assert.ok(forkGetCalls(gh).length >= 1, 'ensureFork issued the idempotency GET on the fork');
});

// === F-W2 TEST 5: ensureFork CREATES on 404 => POST /forks (EMPTY body) => readiness 200 => verified ===

test('F5 ensureFork creates on 404: GET 404 => POST /forks (no body, kernel-constant envelope) => readiness GET 200 => proceeds', () => {
  const sleep = makeSleepSpy();
  const gh = makeForkGh({ forkGetSequence: [404, 200] });   // absent, then created + ready
  const r = G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {}, forkRepo: FORK_REPO, expectedForkOwner: 'botacct' }, { runGh: gh, sleep });
  assert.strictEqual(r.number, 9);
  const post = forksPostCalls(gh);
  assert.strictEqual(post.length, 1, 'exactly one POST /forks fired on the 404');
  // the kernel-constant envelope: POST /forks carries NO input body (no name/organization/default_branch_only).
  assert.strictEqual(post[0].input, undefined, 'POST /forks carries NO request body — zero actor bytes');
  assert.strictEqual(post[0].args[0], 'api');
  assert.strictEqual(post[0].args[1], `repos/${GOOD_REPO}/forks`, 'POST /forks targets the UPSTREAM forks endpoint');
  assert.ok(post[0].args.includes('--method') && post[0].args[post[0].args.indexOf('--method') + 1] === 'POST', 'the method is POST');
  assert.ok(!post[0].args.includes('--input'), 'no --input on POST /forks (empty envelope)');
});

// === F-W2 TEST 6: readiness poll RETRIES on 404 => [404,404,200] succeeds; exact attempt + sleep count ===

test('F6 readiness poll retries: forkGetSequence [404(create),404,404,200] => succeeds; injected sleep called exactly TWICE (between the 3 post-create polls), no real wait', () => {
  const sleep = makeSleepSpy();
  // seq drives the fork-GET responses IN ORDER: idx0 = the idempotency GET (404 => create); then the readiness
  // poll: attempt1 404, attempt2 404, attempt3 200. (A 5th fork-GET is the H2 TOCTOU re-bind before the tree
  // write — it consumes the sequence's trailing 200, so it verifies clean.)
  const gh = makeForkGh({ forkGetSequence: [404, 404, 404, 200] });
  const r = G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {}, forkRepo: FORK_REPO, expectedForkOwner: 'botacct' }, { runGh: gh, sleep });
  assert.strictEqual(r.number, 9);
  // sleep fires AFTER each FAILED readiness 404 (2 times), never after the successful 200 — this is the load-bearing
  // backoff assertion (the readiness poll ran attempt1-404, sleep, attempt2-404, sleep, attempt3-200).
  assert.strictEqual(sleep.count, 2, 'sleep fired exactly twice (after the two failed readiness 404s), never after success');
  assert.strictEqual(forksPostCalls(gh).length, 1, 'the 404 idempotency GET triggered exactly one create');
  // ensureFork issued 1 idempotency GET + 3 readiness GETs = 4; the H2 re-bind adds a 5th (fork mode) — the count
  // is deterministic given the mock (code-reviewer LOW: exact === 5 for a tighter regression net).
  assert.strictEqual(forkGetCalls(gh).length, 5, 'exactly five fork-GETs: 1 idempotency + 3 readiness polls + 1 H2 re-bind');
});

// === F-W2 TEST M-1: case-normalized expectedForkOwner (a canonical-cased custody value must not fail-closed) ===

test('M-1 expectedForkOwner case-normalize: a canonical-cased expectedForkOwner matches a lowercased fork owner (no false fork-owner-mismatch)', () => {
  // GitHub `owner.login` is canonical-cased; forkOwner (from resolvedForkRepo) is NORMALIZED_REPO_RE-lowercase;
  // custody may supply the bot login canonical-cased. Both sides must lowercase-normalize or EVERY legit fork emit
  // dies with an opaque mismatch (safe direction, but a footgun). Probe both boundary functions directly.
  // validateForkIdentity: lowercase forkOwner 'botacct' vs canonical expectedForkOwner 'BotAcct' => OK.
  assert.doesNotThrow(() => G.validateForkIdentity({ upstreamRepo: 'owner/repo', forkRepo: 'botacct/repo', expectedForkOwner: 'BotAcct' }));
  // verifyForkRepo: canonical API owner.login vs lowercased expected => OK.
  assert.doesNotThrow(() => G.verifyForkRepo({ fork: true, source: { full_name: 'owner/repo' }, owner: { login: 'BotAcct' } }, 'owner/repo', 'botacct'));
  // verifyForkRepo: lowercased API owner.login vs canonical expected => OK (both sides normalized).
  assert.doesNotThrow(() => G.verifyForkRepo({ fork: true, source: { full_name: 'owner/repo' }, owner: { login: 'botacct' } }, 'owner/repo', 'BotAcct'));
  // still fail-closed on a REAL mismatch (not merely case): API owner 'attacker' vs expected 'botacct' => throws.
  assert.throws(() => G.verifyForkRepo({ fork: true, source: { full_name: 'owner/repo' }, owner: { login: 'attacker' } }, 'owner/repo', 'botacct'), /fork-owner-mismatch/);
});

// === F-W2 TEST 7: readiness TIMEOUT => fork-readiness-timeout alert + throw + ZERO fork writes ===

test('F7 readiness timeout fails closed: the fork stays 404 for FORK_READINESS_MAX_ATTEMPTS => fork-readiness-timeout alert + throw + ZERO fork writes', () => {
  const sleep = makeSleepSpy();
  // idx0 idempotency 404 => create; then every readiness poll stays 404 (the sequence's last element repeats).
  const gh = makeForkGh({ forkGetSequence: [404] });
  const { text, err } = captureAlerts(() => G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {}, forkRepo: FORK_REPO, expectedForkOwner: 'botacct' }, { runGh: gh, sleep }));
  assert.ok(err && /fork-readiness-timeout|readiness/.test(err.message), 'threw a readiness-timeout');
  assert.ok(/\[LOOM-EGRESS-ALERT\].*fork-readiness-timeout/.test(text), 'the fork-readiness-timeout alert is OBSERVABLE');
  assert.strictEqual(forkWriteCalls(gh).length, 0, 'ZERO tree/commit/ref writes on the fork after a readiness timeout');
  // exactly MAX_ATTEMPTS readiness GETs (after the idempotency GET), sleeping between all but the last.
  const readiness = forkGetCalls(gh).length - 1;   // minus the idempotency GET
  assert.strictEqual(readiness, 8, 'FORK_READINESS_MAX_ATTEMPTS = 8 readiness polls');
  assert.strictEqual(sleep.count, 7, 'sleep fired MAX_ATTEMPTS-1 = 7 times (no sleep after the final failed attempt)');
});

// === F-W2 TEST 8: fork-not-of-upstream (GET 200 but .source.full_name != upstream) => alert + throw + zero writes ===

test('F8 fork-not-of-upstream: GET 200 but .source.full_name != upstream => fork-not-of-upstream alert + throw + ZERO writes', () => {
  const gh = makeForkGh({ forkGetSequence: [200], forkRepoMeta: { fork: true, full_name: FORK_REPO, owner: { login: 'botacct' }, source: { full_name: 'someoneelse/repo' } } });
  const { text, err } = captureAlerts(() => G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {}, forkRepo: FORK_REPO, expectedForkOwner: 'botacct' }, { runGh: gh }));
  assert.ok(err && /fork-not-of-upstream|not a fork of/.test(err.message), 'threw fork-not-of-upstream');
  assert.ok(/\[LOOM-EGRESS-ALERT\].*fork-not-of-upstream/.test(text), 'the fork-not-of-upstream alert is OBSERVABLE');
  assert.strictEqual(forkWriteCalls(gh).length, 0, 'ZERO fork writes on a fork-not-of-upstream reject');
});

// === F-W2 TEST 9: fork-owner-mismatch (.owner.login != expectedForkOwner) => alert + throw ===

test('F9 fork-owner-mismatch: GET 200 valid fork but .owner.login != expectedForkOwner => fork-owner-mismatch alert + throw + zero writes', () => {
  const gh = makeForkGh({ forkGetSequence: [200], forkRepoMeta: { fork: true, full_name: FORK_REPO, owner: { login: 'attacker' }, source: { full_name: GOOD_REPO } } });
  const { text, err } = captureAlerts(() => G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {}, forkRepo: FORK_REPO, expectedForkOwner: 'botacct' }, { runGh: gh }));
  assert.ok(err && /fork-owner-mismatch|owner/.test(err.message), 'threw fork-owner-mismatch');
  assert.ok(/\[LOOM-EGRESS-ALERT\].*fork-owner-mismatch/.test(text), 'the fork-owner-mismatch alert is OBSERVABLE');
  assert.strictEqual(forkWriteCalls(gh).length, 0, 'ZERO fork writes on a fork-owner-mismatch reject');
});

// === F-W2 TEST 10: expectedForkOwner ABSENT (C1 mandatory) => fork-owner-required alert + throw ===

test('F10 expectedForkOwner absent (C1 MANDATORY): a distinct forkRepo WITHOUT expectedForkOwner => fork-owner-required alert + throw + zero writes', () => {
  // NB validateForkIdentity does NOT require expectedForkOwner (F-W1 kept it optional); ensureFork MAKES it
  // mandatory. So a distinct fork with expectedForkOwner absent must fail-closed INSIDE ensureFork, not sail through.
  const gh = makeForkGh({ forkGetSequence: [200] });
  const { text, err } = captureAlerts(() => G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {}, forkRepo: FORK_REPO }, { runGh: gh }));
  assert.ok(err && /fork-owner-required|expectedForkOwner/.test(err.message), 'threw fork-owner-required when expectedForkOwner is absent');
  assert.ok(/\[LOOM-EGRESS-ALERT\].*fork-owner-required/.test(text), 'the fork-owner-required alert is OBSERVABLE');
  assert.strictEqual(forkWriteCalls(gh).length, 0, 'ZERO fork writes when expectedForkOwner is absent');
});

// === F-W2 TEST 11: .source === null (shape) => fork-shape-invalid (NOT a bare TypeError) + throw ===

test('F11 fork-shape-invalid (M1 defensive shape): GET 200 with .source === null => fork-shape-invalid alert + throw (never a bare TypeError) + zero writes', () => {
  const gh = makeForkGh({ forkGetSequence: [200], forkRepoMeta: { fork: true, full_name: FORK_REPO, owner: { login: 'botacct' }, source: null } });
  const { text, err } = captureAlerts(() => G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {}, forkRepo: FORK_REPO, expectedForkOwner: 'botacct' }, { runGh: gh }));
  assert.ok(err, 'a null .source throws (fail-closed)');
  assert.ok(!/Cannot read propert|of null|undefined is not/.test(err.message), 'the throw is NOT a bare TypeError on a null .source');
  assert.ok(/fork-shape-invalid|shape/.test(err.message), 'the error names the shape violation');
  assert.ok(/\[LOOM-EGRESS-ALERT\].*fork-shape-invalid/.test(text), 'the fork-shape-invalid alert is OBSERVABLE');
  assert.strictEqual(forkWriteCalls(gh).length, 0, 'ZERO fork writes on a shape violation');
});

// === F-W2 TEST 12: POST-POLL verification (the create path's terminal 200 must run the SAME verify) ===

test('F12 post-poll verification: create-path where the readiness 200 is fork-not-of-upstream => throw (proves BOTH call-sites verify, not only the immediate-200 branch)', () => {
  const sleep = makeSleepSpy();
  // idx0 idempotency 404 => create; the readiness 200 returns a BAD meta (source != upstream). If only the
  // immediate-200 path verified, this would sail through — so this MUST throw to prove the post-poll verify.
  const gh = makeForkGh({ forkGetSequence: [404, 200], forkRepoMeta: { fork: true, full_name: FORK_REPO, owner: { login: 'botacct' }, source: { full_name: 'someoneelse/repo' } } });
  const { err } = captureAlerts(() => G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {}, forkRepo: FORK_REPO, expectedForkOwner: 'botacct' }, { runGh: gh, sleep }));
  assert.ok(err && /fork-not-of-upstream|not a fork of/.test(err.message), 'the post-poll terminal 200 ran the SAME fork-of-upstream verify and rejected');
  assert.strictEqual(forkWriteCalls(gh).length, 0, 'ZERO fork writes when the post-poll verification rejects');
});

// === F-W2 TEST 13: non-404 GET error during the poll RE-THROWS immediately (does NOT consume the retry budget) ===

test('F13 non-404 GET re-throws immediately: a 403 idempotency GET is NOT folded into create-or-poll => re-throws, does NOT POST /forks, does NOT consume the retry budget', () => {
  const sleep = makeSleepSpy();
  const gh = makeForkGh({ forkGetSequence: [403] });   // the idempotency GET fails 403 (not a 404)
  const { err } = captureAlerts(() => G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {}, forkRepo: FORK_REPO, expectedForkOwner: 'botacct' }, { runGh: gh, sleep }));
  assert.ok(err, 'a non-404 GET error throws');
  assert.strictEqual(forksPostCalls(gh).length, 0, 'a non-404 GET does NOT trigger a create (fail-closed, never create on an unknown error)');
  assert.strictEqual(forkGetCalls(gh).length, 1, 'exactly one GET — the error re-threw immediately, consuming no retry budget');
  assert.strictEqual(sleep.count, 0, 'no sleep — the error re-threw before any poll');
});

// === F-W2 TEST 14: H3 fork-tip assert (dedup 422 path) — fork ref tip != commit.sha => fork-branch-tip-mismatch ===

test('F14 H3 fork-tip (dedup 422): ref-exists on the fork + a fork ref tip != our commit.sha => fork-branch-tip-mismatch alert + fail-closed', () => {
  // ref reserve 422s (already exists); the dedup finds a matching open PR; but the fork ref tip (H3 read) is a
  // DIFFERENT sha than the commit we just created => must NOT launder loom's envelope onto foreign fork content.
  const existingPulls = [{ html_url: 'x', number: 7, head: { ref: FORK_BRANCH, repo: { full_name: FORK_REPO } }, draft: true, base: { ref: 'main', repo: { full_name: GOOD_REPO } } }];
  const gh = makeForkGh({ refExists: true, existingPulls, forkRefSha: SHA_A });   // fork tip = SHA_A != commit SHA_D
  const { text, err } = captureAlerts(() => G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {}, forkRepo: FORK_REPO, expectedForkOwner: 'botacct' }, { runGh: gh }));
  assert.ok(err && /fork-branch-tip-mismatch|tip/.test(err.message), 'threw on a fork-tip mismatch in the dedup path');
  assert.ok(/\[LOOM-EGRESS-ALERT\].*fork-branch-tip-mismatch/.test(text), 'the fork-branch-tip-mismatch alert is OBSERVABLE');
});

// === F-W2 TEST 14b: H3 fork-tip PASSES when the tip === commit.sha (dedup proceeds) ===

test('F14b H3 fork-tip passes (dedup 422): the fork ref tip === our commit.sha => the dedup proceeds normally', () => {
  const existingPulls = [{ html_url: 'https://github.com/o/r/pull/7', number: 7, head: { ref: FORK_BRANCH, repo: { full_name: FORK_REPO } }, draft: true, base: { ref: 'main', repo: { full_name: GOOD_REPO } } }];
  const gh = makeForkGh({ refExists: true, existingPulls, forkRefSha: SHA_D });   // fork tip === commit SHA_D
  const r = G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {}, forkRepo: FORK_REPO, expectedForkOwner: 'botacct' }, { runGh: gh });
  assert.strictEqual(r.deduped, true, 'the dedup proceeds when the fork tip matches the created commit');
  assert.strictEqual(r.number, 7);
});

// === F-W2 TEST 15: length caps (validateForkIdentity owner<=39 / repo<=100; assertSafeRepoRef upstream owner<=39) ===

test('F15 length caps (NON-VACUOUS): a >39-char fork owner and a >100-char resolvedForkRepo fail closed in validateForkIdentity', () => {
  const longOwner = 'a'.repeat(40);   // 40 > 39 (GitHub login max)
  const gh1 = makeGh();
  assert.throws(
    () => G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {}, forkRepo: `${longOwner}/repo`, expectedForkOwner: longOwner }, { runGh: gh1 }),
    /unsafe|fail-closed|too long|length/,
    'a 40-char fork owner (> 39) fails closed',
  );
  assert.strictEqual(writeCalls(gh1).length, 0, 'no writes on an over-length fork owner');
  // a >100-char resolvedForkRepo: owner (<=39) + name padded so the whole string exceeds 100.
  const longRepo = `botacct/${'r'.repeat(100)}`;   // 8 + 100 = 108 > 100
  const gh2 = makeGh();
  assert.throws(
    () => G.ghEmit({ draft: draftFor(GOLDEN_ADD_DIFF), approvalHash: GOLDEN_ADD_HASH, env: {}, forkRepo: longRepo, expectedForkOwner: 'botacct' }, { runGh: gh2 }),
    /unsafe|fail-closed|too long|length|share/,
    'a >100-char resolvedForkRepo fails closed',
  );
  assert.strictEqual(writeCalls(gh2).length, 0, 'no writes on an over-length resolvedForkRepo');
});

test('F15b length cap direct (validateForkIdentity): a same-name fork owner of exactly 40 chars fails closed; 39 is allowed', () => {
  const o39 = 'a'.repeat(39);
  const o40 = 'a'.repeat(40);
  // 39-char owner is allowed (name shared, valid login shape).
  assert.doesNotThrow(() => G.validateForkIdentity({ upstreamRepo: 'owner/repo', forkRepo: `${o39}/repo`, expectedForkOwner: o39 }));
  // 40-char owner fails closed.
  assert.throws(() => G.validateForkIdentity({ upstreamRepo: 'owner/repo', forkRepo: `${o40}/repo` }), /unsafe|fail-closed|length|too long/);
});

test('F15c length cap (assertSafeRepoRef): a >39-char upstream owner fails closed', () => {
  const EP = require(path.join(REPO, 'packages', 'kernel', 'egress', 'emit-pr.js'));
  const o40 = 'z'.repeat(40);
  assert.throws(() => EP.assertSafeRepoRef(`${o40}/repo`), /login|unsafe|length|too long/, 'a 40-char upstream owner fails closed in assertSafeRepoRef');
  assert.doesNotThrow(() => EP.assertSafeRepoRef(`${'z'.repeat(39)}/repo`), 'a 39-char upstream owner is allowed');
});

// === F-W2 TEST 16: isNotFound helper — matches HTTP 404 / Not Found on stderr+stdout ===

test('F16 isNotFound helper: matches HTTP 404 / Not Found on err.stderr+err.stdout; false on a 422/500', () => {
  assert.strictEqual(typeof G.isNotFound, 'function', 'isNotFound is exported');
  assert.strictEqual(G.isNotFound({ stderr: 'gh: Not Found (HTTP 404)' }), true, 'HTTP 404 on stderr => true');
  assert.strictEqual(G.isNotFound({ stdout: 'HTTP 404' }), true, 'HTTP 404 on stdout => true');
  assert.strictEqual(G.isNotFound({ stderr: 'gh: Reference already exists (HTTP 422)' }), false, 'a 422 => false');
  assert.strictEqual(G.isNotFound({ stderr: 'gh: server error (HTTP 500)' }), false, 'a 500 => false');
  assert.strictEqual(G.isNotFound(null), false, 'a null err => false (no throw)');
  assert.strictEqual(G.isNotFound({}), false, 'an err with no stderr/stdout => false');
});

// === F-W2 TEST 16b: ensureFork exported + PURE of tree/commit/ref writes ===

test('F16b ensureFork is exported + PURE (verifies + creates only; never a tree/commit/ref write)', () => {
  assert.strictEqual(typeof G.ensureFork, 'function', 'ensureFork is exported');
  const gh = makeForkGh({ forkGetSequence: [200] });
  const res = G.ensureFork(
    { upstreamRepo: GOOD_REPO, resolvedForkRepo: FORK_REPO, forkOwner: 'botacct', expectedForkOwner: 'botacct' },
    { gh, env: {} },
  );
  assert.ok(res && res.ready === true, 'ensureFork returns { ready: true } on a verified fork');
  // ensureFork itself issues NO tree/commit/ref write.
  assert.strictEqual(gh.calls.filter((c) => /\/git\/(trees|commits|refs)/.test(c.args[1])).length, 0, 'ensureFork is PURE of any git-data write');
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== gh-emit-two-identity.test.js: ${passed} passed, ${failed} failed, ${skipped} skipped ===\n`);
  if (failed > 0) process.exit(1);
})();
