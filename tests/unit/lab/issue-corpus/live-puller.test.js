#!/usr/bin/env node

// tests/unit/lab/issue-corpus/live-puller.test.js
//
// ③.2.2a — the read-only good-first-issue live puller (the RED set). Locks: the CRITICAL owner/repo
// slug guard (VERIFY H1 — the puller's OWN gh-api call runs on an attacker-named slug), the per-item
// validate-and-DROP loop (VERIFY H3 — one poison item never aborts the pull), the exact-set license
// gate, the PR-capable + unassigned filter, the problem_statement bound (VERIFY M1), the canonical
// github.com repo-URL construction (VERIFY F2 — never trust the raw repository_url), and the public
// record validity. PURE + DETERMINISTIC where possible; the gh layer is an INJECTED mock (no network).

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const P = require(path.join(REPO, 'packages', 'lab', 'issue-corpus', 'live-puller.js'));
const {
  assertSafeOwnerRepo, parseRepoSlug, isLicenseCompatible, isPrCapable, isUnassigned,
  boundProblemStatement, buildPublicRecord, pullLiveCorpus, MAX_PROBLEM_BYTES, LICENSE_ALLOWLIST,
  assertReadOnlyGhArgs, ghApiReadArgs, buildSearchArgs, fetchOneIssueRecord,
} = P;
const { validatePublicRecord } = require(path.join(REPO, 'packages', 'lab', 'issue-corpus', 'corpus.js'));
const { parseRecordRef } = require(path.join(REPO, 'packages', 'lab', 'persona-experiment', 'live-draft-run.js'));

let passed = 0; let failed = 0;
// Collect every test's promise so the summary awaits ACTUAL completion, not a timer tick (CodeRabbit
// #390): some tests are async (the pullLiveCorpus cases), so process.exit must fire on Promise.all of
// the whole set — never on a setImmediate guess that could miss a slow/late failure.
const pending = [];
function test(name, fn) {
  pending.push(
    Promise.resolve()
      .then(fn)
      .then(() => { process.stdout.write(`  PASS ${name}\n`); passed++; })
      .catch((err) => { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }),
  );
}

// ── (a) assertSafeOwnerRepo — the CRITICAL net-new surface (VERIFY H1) ──
test('a1. a clean owner/repo slug parses to {owner, repo}', () => {
  assert.deepStrictEqual(assertSafeOwnerRepo('psf/requests'), { owner: 'psf', repo: 'requests' });
  assert.deepStrictEqual(assertSafeOwnerRepo('Owner-1/repo.js_x'), { owner: 'Owner-1', repo: 'repo.js_x' });
});
test('a2. path-traversal / extra-segment slugs are REJECTED', () => {
  for (const bad of ['../../user/repos', 'a/b/c', 'psf/requests/../x', 'owner/', '/repo', '..%2f..']) {
    assert.throws(() => assertSafeOwnerRepo(bad), /owner.?repo|slug/i, bad);
  }
});
test('a3. a leading "-" in either segment is REJECTED (arg-injection — e.g. -X/DELETE)', () => {
  assert.throws(() => assertSafeOwnerRepo('-X/DELETE'), /slug|owner/i);
  assert.throws(() => assertSafeOwnerRepo('owner/-rf'), /slug|repo/i);
});
test('a4. query / whitespace / control chars are REJECTED', () => {
  for (const bad of ['psf/requests?per_page=100', 'psf /requests', 'psf/requests\n', 'psf/re\x00po']) {
    assert.throws(() => assertSafeOwnerRepo(bad), /slug|owner.?repo/i, JSON.stringify(bad));
  }
});
test('a5. "."-only / ".."-only segments are REJECTED', () => {
  assert.throws(() => assertSafeOwnerRepo('./x'), /slug|owner/i);
  assert.throws(() => assertSafeOwnerRepo('x/..'), /slug|repo/i);
  assert.throws(() => assertSafeOwnerRepo('../x'), /slug|owner/i);
});
test('a6. non-string / empty is REJECTED', () => {
  assert.throws(() => assertSafeOwnerRepo(''), /slug|required/i);
  assert.throws(() => assertSafeOwnerRepo(null), /slug|required/i);
});

// ── (b) parseRepoSlug — extract owner/repo from the untrusted repository_url ──
test('b1. a github api repository_url parses to a guarded slug', () => {
  assert.strictEqual(parseRepoSlug('https://api.github.com/repos/psf/requests'), 'psf/requests');
});
test('b2. a non-github / traversal repository_url is rejected (never trusted verbatim)', () => {
  assert.throws(() => parseRepoSlug('https://evil.com/repos/a/b'), /repos|host|slug/i);
  assert.throws(() => parseRepoSlug('https://api.github.com/repos/../../x'), /slug|owner.?repo/i);
});

// ── (c) license gate — exact-set, NOT .includes (VERIFY N1) ──
test('c1. permissive SPDX ids are compatible', () => {
  for (const ok of ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'Unlicense']) {
    assert.strictEqual(isLicenseCompatible(ok), true, ok);
  }
});
test('c2. copyleft / null / NOASSERTION / case-variant / SPDX-expression are INCOMPATIBLE', () => {
  for (const no of ['GPL-3.0', 'AGPL-3.0', null, undefined, 'NOASSERTION', 'mit', 'Apache-2.0 AND GPL-3.0', 'MIT-but-actually-GPL']) {
    assert.strictEqual(isLicenseCompatible(no), false, JSON.stringify(no));
  }
});
test('c3. LICENSE_ALLOWLIST is an exact-set (membership, not substring)', () => {
  assert.ok(LICENSE_ALLOWLIST.has('MIT') && !LICENSE_ALLOWLIST.has('GPL-3.0'));
});

// ── (d) PR-capable + unassigned filter (VERIFY F4) ──
function goodMeta(over) {
  return Object.assign({ archived: false, disabled: false, allow_forking: true, is_template: false }, over || {});
}
test('d1. an open, forkable, non-template, non-archived repo is PR-capable', () => {
  assert.strictEqual(isPrCapable(goodMeta()), true);
});
test('d2. archived / disabled / no-forking / template repos are NOT PR-capable', () => {
  assert.strictEqual(isPrCapable(goodMeta({ archived: true })), false);
  assert.strictEqual(isPrCapable(goodMeta({ disabled: true })), false);
  assert.strictEqual(isPrCapable(goodMeta({ allow_forking: false })), false);
  assert.strictEqual(isPrCapable(goodMeta({ is_template: true })), false);
});
test('d3. an unassigned issue passes; an assigned one is rejected', () => {
  assert.strictEqual(isUnassigned({ assignees: [] }), true);
  assert.strictEqual(isUnassigned({ assignee: null, assignees: [] }), true);
  assert.strictEqual(isUnassigned({ assignees: [{ login: 'x' }] }), false);
  assert.strictEqual(isUnassigned({ assignee: { login: 'x' }, assignees: [] }), false);
});

// ── (e) problem_statement bound (VERIFY M1) ──
test('e1. a 5 MiB body is TRUNCATED to <= MAX_PROBLEM_BYTES (not dropped)', () => {
  const big = 'x'.repeat(5 * 1024 * 1024);
  const out = boundProblemStatement('title', big);
  assert.ok(Buffer.byteLength(out, 'utf8') <= MAX_PROBLEM_BYTES, 'within cap');
  assert.ok(out.startsWith('title'), 'keeps the title');
});
test('e2. C0 control chars (NUL / ANSI ESC) are stripped; tab/newline survive', () => {
  const out = boundProblemStatement('ti\x00tle', 'bo\x1b]0;pwn\x07dy\twith\nnl');
  // char-code check (no control-char regex literal — ADR-0006 / no-control-regex): no C0/DEL except \t,\n
  const hasBadControl = [...out].some((c) => { const x = c.charCodeAt(0); return (x < 32 && x !== 9 && x !== 10) || x === 127; });
  assert.ok(!hasBadControl, 'no NUL/ESC/BEL or other C0/DEL controls');
  assert.ok(out.includes('\t') && out.includes('\n'), 'tab + newline preserved');
});
test('e3. an empty title+body yields an empty string (caller drops via validatePublicRecord)', () => {
  assert.strictEqual(boundProblemStatement('', ''), '');
});
test('e4. a multibyte char straddling the byte cap stays <= MAX_PROBLEM_BYTES (VALIDATE F1)', () => {
  // place a 4-byte emoji so only its FIRST byte falls inside the cap window -> U+FFFD would push +2 over.
  const out = boundProblemStatement('x'.repeat(MAX_PROBLEM_BYTES - 1) + '\u{1F600}', '');
  assert.ok(Buffer.byteLength(out, 'utf8') <= MAX_PROBLEM_BYTES, 'over cap: ' + Buffer.byteLength(out, 'utf8'));
});

// ── (f) buildPublicRecord — canonical github.com URL, never the raw url (VERIFY F2) ──
test('f1. build constructs the full https github.com repo URL + a valid public record', () => {
  const rec = buildPublicRecord({ owner: 'psf', repo: 'requests', number: 42, title: 'Bug', body: 'b', base_sha: 'a'.repeat(40) });
  assert.strictEqual(rec.repo, 'https://github.com/psf/requests');
  assert.match(rec.id, /psf__requests-issue-42/);
  assert.strictEqual(validatePublicRecord(rec), true);
});
test('f2. a non-positive / non-integer issue number is rejected', () => {
  assert.throws(() => buildPublicRecord({ owner: 'a', repo: 'b', number: 0, title: 't', body: '', base_sha: 'a'.repeat(40) }), /number/i);
  assert.throws(() => buildPublicRecord({ owner: 'a', repo: 'b', number: 1.5, title: 't', body: '', base_sha: 'a'.repeat(40) }), /number/i);
});

// ── (g) pullLiveCorpus end-to-end with an INJECTED gh runner (EC2.1c — NO network) ──
// The mock runner dispatches by endpoint substring; it records every endpoint it was asked for so a
// test can assert the enrichment path is shape-safe (no traversal/flag leaked into the gh argv).
function mockRunner(fixtures, seen) {
  return function ghRunner(args) {
    if (Array.isArray(seen)) seen.push(args.join(' '));
    const endpoint = args.find((a) => /search\/issues|^repos\//.test(a)) || args.join(' ');
    if (/search\/issues/.test(args.join(' '))) return JSON.stringify(fixtures.search);
    const repoMeta = endpoint.match(/^repos\/([^/]+)\/([^/]+)$/);
    if (repoMeta) {
      const key = `${repoMeta[1]}/${repoMeta[2]}`;
      if (!fixtures.repos[key]) throw new Error(`gh: 404 ${key}`);
      return JSON.stringify(fixtures.repos[key]);
    }
    const head = endpoint.match(/^repos\/([^/]+)\/([^/]+)\/commits\/HEAD$/);
    if (head) {
      const key = `${head[1]}/${head[2]}`;
      return JSON.stringify({ sha: (fixtures.shas && fixtures.shas[key]) || 'b'.repeat(40) });
    }
    throw new Error('mock: unrecognized gh call ' + args.join(' '));
  };
}
function searchItem(over) {
  return Object.assign({
    number: 7, title: 'Fix the thing', body: 'It breaks.', state: 'open',
    repository_url: 'https://api.github.com/repos/octo/widget', assignees: [], html_url: 'https://github.com/octo/widget/issues/7',
  }, over || {});
}
function permissiveRepo(over) {
  return Object.assign({ license: { spdx_id: 'MIT' }, archived: false, disabled: false, allow_forking: true, is_template: false, default_branch: 'main' }, over || {});
}

test('g1. EC2.1c — a full pull runs with the injected runner (no network) + returns eligible records', async () => {
  const fixtures = { search: { total_count: 1, items: [searchItem()] }, repos: { 'octo/widget': permissiveRepo() }, shas: { 'octo/widget': 'c'.repeat(40) } };
  const { records, stats } = await pullLiveCorpus({ ghRunner: mockRunner(fixtures), limit: 10 });
  assert.strictEqual(records.length, 1);
  assert.strictEqual(records[0].repo, 'https://github.com/octo/widget');
  assert.strictEqual(records[0].base_sha, 'c'.repeat(40));
  assert.strictEqual(validatePublicRecord(records[0]), true);
  assert.strictEqual(stats.eligible, 1);
});

test('g2. EC2.1f — one poison item among good ones drops ONLY itself (per-item isolation)', async () => {
  const items = [
    searchItem({ number: 1, repository_url: 'https://api.github.com/repos/octo/good1' }),
    searchItem({ number: 2, repository_url: 'https://api.github.com/repos/../../evil' }), // slug traversal -> drop
    searchItem({ number: 3, repository_url: 'https://api.github.com/repos/octo/good2' }),
  ];
  const fixtures = {
    search: { total_count: 3, items },
    repos: { 'octo/good1': permissiveRepo(), 'octo/good2': permissiveRepo() },
  };
  const { records, stats } = await pullLiveCorpus({ ghRunner: mockRunner(fixtures), limit: 10 });
  assert.strictEqual(records.length, 2, 'the two good items survive');
  assert.deepStrictEqual(records.map((r) => r.repo).sort(), ['https://github.com/octo/good1', 'https://github.com/octo/good2']);
  assert.strictEqual(stats.dropped, 1);
});

test('g3. EC2.1a — assigned / archived / GPL / disabled items are filtered out', async () => {
  const items = [
    searchItem({ number: 1, repository_url: 'https://api.github.com/repos/o/assigned', assignees: [{ login: 'z' }] }),
    searchItem({ number: 2, repository_url: 'https://api.github.com/repos/o/archived' }),
    searchItem({ number: 3, repository_url: 'https://api.github.com/repos/o/gpl' }),
    searchItem({ number: 4, repository_url: 'https://api.github.com/repos/o/keep' }),
  ];
  const fixtures = {
    search: { total_count: 4, items },
    repos: {
      'o/assigned': permissiveRepo(), 'o/archived': permissiveRepo({ archived: true }),
      'o/gpl': permissiveRepo({ license: { spdx_id: 'GPL-3.0' } }), 'o/keep': permissiveRepo(),
    },
  };
  const { records } = await pullLiveCorpus({ ghRunner: mockRunner(fixtures), limit: 10 });
  assert.strictEqual(records.length, 1);
  assert.strictEqual(records[0].repo, 'https://github.com/o/keep');
});

test('g4. EC2.1g — the enrichment gh call is shape-safe: every endpoint matches repos/<owner>/<repo>[/commits/HEAD]', async () => {
  const seen = [];
  const fixtures = { search: { total_count: 1, items: [searchItem()] }, repos: { 'octo/widget': permissiveRepo() } };
  await pullLiveCorpus({ ghRunner: mockRunner(fixtures, seen), limit: 10 });
  const apiCalls = seen.filter((s) => /(^|\s)repos\//.test(s));
  for (const call of apiCalls) {
    const ep = call.split(' ').find((a) => a.startsWith('repos/'));
    assert.match(ep, /^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/commits\/HEAD)?$/, 'shape-safe endpoint: ' + ep);
  }
});

test('g5. EC2.1h — a missing / non-40-hex .sha drops the item (untrusted gh field, never coerced)', async () => {
  const fixtures = {
    search: { total_count: 2, items: [
      searchItem({ number: 1, repository_url: 'https://api.github.com/repos/o/badsha' }),
      searchItem({ number: 2, repository_url: 'https://api.github.com/repos/o/ok' }),
    ] },
    repos: { 'o/badsha': permissiveRepo(), 'o/ok': permissiveRepo() },
    shas: { 'o/badsha': 'HEAD', 'o/ok': 'd'.repeat(40) },
  };
  const { records } = await pullLiveCorpus({ ghRunner: mockRunner(fixtures), limit: 10 });
  assert.strictEqual(records.length, 1);
  assert.strictEqual(records[0].repo, 'https://github.com/o/ok');
});

test('g6. EC2.1h — the record.repo is github.com even when the raw repository_url points elsewhere (no raw-URL trust)', async () => {
  // The slug is parsed from repository_url, but record.repo is CONSTRUCTED as github.com/<owner>/<repo>.
  const fixtures = { search: { total_count: 1, items: [searchItem({ repository_url: 'https://api.github.com/repos/octo/widget' })] }, repos: { 'octo/widget': permissiveRepo() } };
  const { records } = await pullLiveCorpus({ ghRunner: mockRunner(fixtures), limit: 10 });
  assert.ok(records[0].repo.startsWith('https://github.com/'), 'host is github.com by construction');
});

// ── (h) EC2.1d — the read-only/no-emission boundary as an EXECUTING gate (VALIDATE H2 + the GET-gate) ──
test('h1. EC2.1d — the module has no fs-write / egress-import call-site, and the gh spawn is GET-gated', () => {
  const src = fs.readFileSync(path.join(REPO, 'packages', 'lab', 'issue-corpus', 'live-puller.js'), 'utf8');
  const forbidden = [/\bfs\.write/i, /\bwriteFileSync\b/i, /require\(['"][^'"]*egress/i];
  const hits = forbidden.filter((re) => re.test(src)).map((re) => re.source);
  assert.deepStrictEqual(hits, [], 'forbidden write/emission call-sites: ' + hits.join(', '));
  // the ONLY subprocess sink is execFileSync('gh', ...) and it is gated by assertReadOnlyGhArgs (GET-only).
  // (a bare /exec\(/ would false-match RegExp.prototype.exec — a regex method, not a subprocess call.)
  assert.ok(/execFileSync\('gh'/.test(src), 'gh read path present');
  assert.ok(!/\bspawn\s*\(|\bspawnSync\s*\(|\bexecSync\s*\(/.test(src), 'no other subprocess sink (spawn/spawnSync/execSync call)');
  // the gh args pass through assertReadOnlyGhArgs (the call form, with the args param) — h2 proves it refuses writes.
  assert.ok(/assertReadOnlyGhArgs\(args\)\s*;/.test(src), 'the gh spawn is GET-gated by assertReadOnlyGhArgs(args)');
});
test('h2. assertReadOnlyGhArgs — the bounded GET-gate accepts the real reads, refuses EVERY write-form', () => {
  // accepts: the three read shapes the puller actually issues.
  assert.strictEqual(assertReadOnlyGhArgs(buildSearchArgs({ label: 'good first issue', language: 'python', limit: 5 })), true);
  assert.strictEqual(assertReadOnlyGhArgs(ghApiReadArgs('octo', 'widget')), true);
  assert.strictEqual(assertReadOnlyGhArgs(ghApiReadArgs('octo', 'widget', '/commits/HEAD')), true);
  // refuses every write-form the VALIDATE-hacker enumerated (incl. gh's -f auto-POST + glued + long forms):
  const writes = [
    ['api', 'repos/o/r'],                                  // no -X GET pin -> -f would auto-POST
    ['api', '-f', 'title=t', 'repos/o/r/pulls'],           // -f auto-POST (no -X GET)
    ['api', '-X', 'POST', 'repos/o/r/pulls'],              // explicit POST (argv)
    ['api', '-XPOST', 'repos/o/r/pulls'],                  // glued -XPOST
    ['api', '--method', 'PATCH', 'repos/o/r'],             // --method PATCH
    ['api', '--method=DELETE', 'repos/o/r'],               // --method=DELETE
    ['api', '-X', 'GET', '-X', 'POST', 'repos/o/r'],       // GET then POST (contradictory -> refused)
    ['pr', 'create', '--title', 't'],                      // not `gh api` at all
    ['release', 'create', 'v1'],                            // a write subcommand
  ];
  for (const w of writes) assert.throws(() => assertReadOnlyGhArgs(w), /gh-readonly/, JSON.stringify(w));
});
test('h3. defaultGhRunner INVOKES the gate: a write arg throws (gh-readonly) BEFORE any spawn', () => {
  // proves the gate is wired into the spawn path (not merely defined) — the throw is from
  // assertReadOnlyGhArgs, which runs before the lazy require('child_process'), so no gh is ever spawned
  // (this passes even with no `gh` on PATH). This is the runtime answer to "invocation, not symbol presence".
  assert.throws(() => P.defaultGhRunner(['api', '-X', 'POST', 'repos/o/r/pulls']), /gh-readonly/);
  assert.throws(() => P.defaultGhRunner(['pr', 'create', '--title', 't']), /gh-readonly/);
  assert.throws(() => P.defaultGhRunner(['api', '-f', 'title=t', 'repos/o/r/pulls']), /gh-readonly/); // -f auto-POST, no -X GET
});

// ── (i) fetchOneIssueRecord — the single-issue populator (VERIFY architect: slug-guard-FIRST, number
//        boundary before the GET, PR-refusal, license/PR-capable HARD-refuse, /issues/N endpoint, the
//        -issue-N END-anchor, TYPED value-redacted gh errors) ──
function issueMock(fixtures, seen) {
  return function ghRunner(args) {
    if (Array.isArray(seen)) seen.push(args.join(' '));
    const ep = args.find((a) => a.startsWith('repos/')) || '';
    const iss = ep.match(/^repos\/([^/]+)\/([^/]+)\/issues\/(\d+)$/);
    if (iss) {
      const key = `${iss[1]}/${iss[2]}#${iss[3]}`;
      if (!fixtures.issues || !fixtures.issues[key]) throw new Error(`gh: 404 issue ${key}`);
      return JSON.stringify(fixtures.issues[key]);
    }
    const head = ep.match(/^repos\/([^/]+)\/([^/]+)\/commits\/HEAD$/);
    if (head) return JSON.stringify({ sha: (fixtures.shas && fixtures.shas[`${head[1]}/${head[2]}`]) || 'c'.repeat(40) });
    const meta = ep.match(/^repos\/([^/]+)\/([^/]+)$/);
    if (meta) {
      const key = `${meta[1]}/${meta[2]}`;
      if (!fixtures.repos || !fixtures.repos[key]) throw new Error(`gh: 404 ${key}`);
      return JSON.stringify(fixtures.repos[key]);
    }
    throw new Error(`issueMock: unrecognized gh call ${args.join(' ')}`);
  };
}
function issueObj(over) { return Object.assign({ number: 7, title: 'Guard the thing', body: 'It emits 0/0/0.', state: 'open' }, over || {}); }

test('i1. happy path — a targeted issue -> a valid PUBLIC record (exactly 4 fields, github.com url, pinned sha)', () => {
  const fx = { issues: { 'octo/widget#7': issueObj() }, repos: { 'octo/widget': permissiveRepo() }, shas: { 'octo/widget': 'a'.repeat(40) } };
  const rec = fetchOneIssueRecord({ owner: 'octo', repo: 'widget', number: 7, ghRunner: issueMock(fx) });
  assert.deepStrictEqual(Object.keys(rec).sort(), ['base_sha', 'id', 'problem_statement', 'repo']);
  assert.strictEqual(rec.id, 'octo__widget-issue-7');
  assert.strictEqual(rec.repo, 'https://github.com/octo/widget');
  assert.strictEqual(rec.base_sha, 'a'.repeat(40));
  assert.match(rec.problem_statement, /Guard the thing/);
  assert.strictEqual(validatePublicRecord(rec), true);
});

test('i2. the record id -issue-N is END-anchored — a repo literally named *-issue-* is safe (parseRecordRef)', () => {
  const fx = { issues: { 'octo/foo-issue-99#7': issueObj() }, repos: { 'octo/foo-issue-99': permissiveRepo() }, shas: { 'octo/foo-issue-99': 'a'.repeat(40) } };
  const rec = fetchOneIssueRecord({ owner: 'octo', repo: 'foo-issue-99', number: 7, ghRunner: issueMock(fx) });
  assert.strictEqual(rec.id, 'octo__foo-issue-99-issue-7');
  assert.strictEqual(parseRecordRef(rec).issueRef, 7);   // extracts 7 (the END-anchor), never 99
});

test('i3. a bad issue number is REFUSED BEFORE any gh call (0 / negative / float / NaN / >MAX_SAFE / string)', () => {
  const boom = () => { throw new Error('gh MUST NOT be called for a bad number'); };
  for (const n of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1, '7']) {
    assert.throws(() => fetchOneIssueRecord({ owner: 'o', repo: 'r', number: n, ghRunner: boom }), /positive safe integer/i, JSON.stringify(n));
  }
});

test('i4. an unsafe owner/repo is REFUSED BEFORE any gh call (slug guard runs first)', () => {
  const boom = () => { throw new Error('gh MUST NOT be called for a bad slug'); };
  for (const [o, r] of [['a/b', 'c'], ['o', 'r/../x'], ['-X', 'r'], ['o', '-rf'], ['o', 'r?x']]) {
    assert.throws(() => fetchOneIssueRecord({ owner: o, repo: r, number: 7, ghRunner: boom }), /slug|owner|repo/i, `${o}/${r}`);
  }
});

test('i5. a PR-number (the issues endpoint returns PRs) is REFUSED', () => {
  const fx = { issues: { 'octo/widget#7': issueObj({ pull_request: { url: 'x' } }) }, repos: { 'octo/widget': permissiveRepo() }, shas: { 'octo/widget': 'a'.repeat(40) } };
  assert.throws(() => fetchOneIssueRecord({ owner: 'octo', repo: 'widget', number: 7, ghRunner: issueMock(fx) }), /pull request/i);
});

test('i6. a non-permissive license is HARD-REFUSED (fail-closed on null too)', () => {
  const gpl = { issues: { 'o/r#7': issueObj() }, repos: { 'o/r': permissiveRepo({ license: { spdx_id: 'GPL-3.0' } }) }, shas: { 'o/r': 'a'.repeat(40) } };
  assert.throws(() => fetchOneIssueRecord({ owner: 'o', repo: 'r', number: 7, ghRunner: issueMock(gpl) }), /license/i);
  const noLic = { issues: { 'o/r#7': issueObj() }, repos: { 'o/r': permissiveRepo({ license: null }) }, shas: { 'o/r': 'a'.repeat(40) } };
  assert.throws(() => fetchOneIssueRecord({ owner: 'o', repo: 'r', number: 7, ghRunner: issueMock(noLic) }), /license/i);
});

test('i7. a non-PR-capable repo (archived) is HARD-REFUSED', () => {
  const fx = { issues: { 'o/r#7': issueObj() }, repos: { 'o/r': permissiveRepo({ archived: true }) }, shas: { 'o/r': 'a'.repeat(40) } };
  assert.throws(() => fetchOneIssueRecord({ owner: 'o', repo: 'r', number: 7, ghRunner: issueMock(fx) }), /PR-capable|archived/i);
});

test('i8. a non-40-hex .sha is REFUSED (untrusted gh field, never coerced)', () => {
  const fx = { issues: { 'o/r#7': issueObj() }, repos: { 'o/r': permissiveRepo() }, shas: { 'o/r': 'HEAD' } };
  assert.throws(() => fetchOneIssueRecord({ owner: 'o', repo: 'r', number: 7, ghRunner: issueMock(fx) }), /sha|hex|40/i);
});

test('i9. a gh failure is rethrown TYPED + value-redacted (raw stderr / token context never leaks)', () => {
  const boom = () => { throw new Error('gh: 403 rate limit; Authorization: token ghp_SECRETLEAK...'); };
  try { fetchOneIssueRecord({ owner: 'o', repo: 'r', number: 7, ghRunner: boom }); assert.fail('should throw'); }
  catch (e) { assert.match(e.message, /issue-fetch.*failed/i); assert.doesNotMatch(e.message, /ghp_SECRETLEAK/); }
});

// ── (j) ENDPOINT_RE shared-constant regression — the widening allows /issues/<1-15 digits> but stays a
//        CLOSED set; the puller's own forms (bare + /commits/HEAD) remain the only other reachable shapes ──
test('j1. ghApiReadArgs accepts the bare + /commits/HEAD + /issues/<1-15 digits> forms', () => {
  for (const suf of ['', '/commits/HEAD', '/issues/27', '/issues/1', '/issues/123456789012345']) {
    assert.doesNotThrow(() => ghApiReadArgs('o', 'r', suf), JSON.stringify(suf));
  }
});
test('j2. ghApiReadArgs REJECTS a non-digit / traversal / 16-digit / cross-form / other-endpoint suffix', () => {
  for (const suf of ['/issues/2a', '/issues/../x', '/issues/', '/issues/1234567890123456', '/commits/HEAD/issues/5', '/pulls/1', '/issues/7/comments']) {
    assert.throws(() => ghApiReadArgs('o', 'r', suf), /gh-endpoint/, JSON.stringify(suf));
  }
});

// summary — awaits ALL tests' actual completion (Promise.all), then exits on the real pass/fail count.
Promise.all(pending).then(() => {
  process.stdout.write(`\nlive-puller.test.js (③.2.2a): ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
});
