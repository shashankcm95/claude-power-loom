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
} = P;
const { validatePublicRecord } = require(path.join(REPO, 'packages', 'lab', 'issue-corpus', 'corpus.js'));

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

// ── (h) EC2.1d — the read-only/no-emission boundary as an EXECUTING gate (VALIDATE H2) ──
// Static-scan the module source: it must contain no write/emission call-site and import no egress
// kernel. This converts the manual "lint/grep" attestation into a running check.
test('h1. EC2.1d — the module source has no git-push / gh-pr / fs-write / egress-import call-site', () => {
  const src = fs.readFileSync(path.join(REPO, 'packages', 'lab', 'issue-corpus', 'live-puller.js'), 'utf8');
  // precise call-site shapes (CodeRabbit #390: avoid over-broad patterns like /'pr'/ that false-fail CI).
  const forbidden = [
    /\bgit\b[\s'",\]]+push\b/i,                     // git push command/arg
    /\bgh\b[\s'",\]]+pr\b/i,                        // gh pr ...
    /['"]pr['"]\s*,\s*['"]create['"]/i,            // ['pr','create']
    /(?:-X|--method)['"]?\s*[,\s]+['"]?(?:POST|PUT|PATCH|DELETE)\b/i,  // a gh-api WRITE verb (-X/--method; single or argv form)
    /\bfs\.write/i, /\bwriteFileSync\b/i,           // fs writes
    /require\(['"][^'"]*egress/i,                   // egress import
  ];
  const hits = forbidden.filter((re) => re.test(src)).map((re) => re.source);
  assert.deepStrictEqual(hits, [], 'forbidden write/emission call-sites: ' + hits.join(', '));
  // the ONLY subprocess sink is the read-only execFileSync('gh', ...); no spawn / execSync.
  // (a bare /exec\(/ would false-match RegExp.prototype.exec — a regex method, not a subprocess call.)
  assert.ok(/execFileSync\('gh'/.test(src), 'gh read path present');
  assert.ok(!/\bspawn\b|\bexecSync\b/.test(src), 'no other subprocess sink (spawn/execSync)');
});

// summary — awaits ALL tests' actual completion (Promise.all), then exits on the real pass/fail count.
Promise.all(pending).then(() => {
  process.stdout.write(`\nlive-puller.test.js (③.2.2a): ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
});
