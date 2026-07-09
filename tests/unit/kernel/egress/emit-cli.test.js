'use strict';

// emit-cli — the operator armed-emit runner. Unit + a real-emitPR integration (no network).
// The CLI's job: assemble untrusted `data` from the draft, custody `opts` from argv, call emitPR,
// interpret the return FAIL-CLOSED. VERIFY board (arch + hacker + code-reviewer) folded here.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, parseArgv, buildData, buildOpts, formatResult } = require('../../../../packages/kernel/egress/emit-cli');
const { computeEmissionHash } = require('../../../../packages/kernel/egress/approval');

let passed = 0;
function test(name, fn) { fn(); passed += 1; }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-emitcli-')); }

const DIFF = [
  'diff --git a/packages/lab/x.js b/packages/lab/x.js',
  'index 0000000..1111111 100644',
  '--- a/packages/lab/x.js',
  '+++ b/packages/lab/x.js',
  '@@ -1,1 +1,1 @@',
  '-const a = 1;',
  '+const a = 2;',
  '',
].join('\n');

// the 7 required custody flags for a live attempt (dummy paths; overridden per test)
function coreFlags(over = {}) {
  return [
    '--draft', over.draft || '/d.json',
    '--approvals-dir', over.appr || '/appr',
    '--killswitch', over.ks || '/ks',
    '--disposition', over.disp || '/disp',
    '--token', over.tok || '/tok',
    '--verify-key', over.vk || '/vk',
    '--gh-config-dir', over.gh || '/gh',
  ];
}

// ---- buildData: the S1 #273 exact-key pick -------------------------------------------------------

test('buildData: exact key-set {repo,issueRef,diff} even when the draft carries extra + policy keys (S1)', () => {
  const data = buildData({ repo: 'o/r', issueRef: 7, diff: DIFF, title: 'x', token: 'evil', killswitchPath: '/evil', foo: 1 });
  assert.deepStrictEqual(Object.keys(data).sort(), ['diff', 'issueRef', 'repo'], 'exact-set: no extra/policy key rides into data');
  assert.strictEqual(data.token, undefined);
  assert.strictEqual(data.killswitchPath, undefined);
  assert.strictEqual(data.diff, DIFF, 'diff passed VERBATIM (emitPR scrubs internally; a pre-scrub would break the forward-contract)');
});

test('buildData: a non-object draft throws (fail-closed, not a silent empty data)', () => {
  assert.throws(() => buildData(null), /draft must be a JSON object/);
  assert.throws(() => buildData([1, 2]), /draft must be a JSON object/);
});

test('S1 opts-half: a draft carrying custody keys leaves opts sourced ONLY from argv (spy on the real run wire)', () => {
  let seen = null;
  const draftWithCustody = () => ({ repo: 'o/r', issueRef: 1, diff: DIFF, token: 'evil', killswitchPath: '/evil-ks', custodyTokenPath: '/evil-tok' });
  run(coreFlags({ tok: '/real-token', ks: '/real-ks' }), { emitFn: (data, opts) => { seen = { data, opts }; return { ok: true, emitted: true, pr: { pr_url: 'x' } }; }, readDraftFile: draftWithCustody });
  assert.strictEqual(seen.opts.custodyTokenPath, '/real-token', 'the token opt is the FLAG value, never the draft-smuggled one');
  assert.strictEqual(seen.opts.killswitchPath, '/real-ks');
  assert.ok(!Object.values(seen.opts).includes('evil'), 'no draft-smuggled custody value reached opts');
  assert.ok(!Object.values(seen.opts).includes('/evil-ks'));
  assert.deepStrictEqual(Object.keys(seen.data).sort(), ['diff', 'issueRef', 'repo'], 'data stays the exact allow-set');
});

// ---- buildOpts: custody-from-flags-only + S4 fork dormancy ---------------------------------------

test('buildOpts: maps flags to the literal emitPR opts keys; never a fork-owner path (S4); ttl Number-coerced', () => {
  const opts = buildOpts({
    approvalsDir: '/a', killswitchPath: '/k', dispositionPath: '/d', tokenPath: '/t',
    verifyKeyPath: '/v', ghConfigDir: '/g', etiquetteLedgerPath: '/e', lockPath: '/l', ttlMs: '5000',
  });
  assert.strictEqual(opts.custodyApprovalsDir, '/a');
  assert.strictEqual(opts.killswitchPath, '/k');
  assert.strictEqual(opts.custodyDispositionPath, '/d');
  assert.strictEqual(opts.custodyTokenPath, '/t');
  assert.strictEqual(opts.custodyVerifyKeyPath, '/v');
  assert.strictEqual(opts.ghConfigDir, '/g');
  assert.strictEqual(opts.custodyEtiquetteLedgerPath, '/e');
  assert.strictEqual(opts.lockPath, '/l');
  assert.strictEqual(opts.ttlMs, 5000);
  assert.strictEqual(typeof opts.ttlMs, 'number', 'ttl coerced to a number, never a string');
  assert.ok(!('custodyForkOwnerPath' in opts), 'S4: the same-owner emit-CLI never sets a fork-owner path');
});

// ---- parseArgv: usage / injection guards --------------------------------------------------------

test('parseArgv: a value starting with "-" is rejected (flag-injection guard)', () => {
  const p = parseArgv(['--token', '--killswitch']);
  assert.strictEqual(p.ok, false);
  assert.ok(/requires a value/.test(p.error));
});

test('parseArgv: an unknown argument is rejected', () => {
  const p = parseArgv(['--wat', 'x']);
  assert.strictEqual(p.ok, false);
  assert.ok(/unknown/.test(p.error));
});

test('parseArgv: a repeated custody flag is rejected (no silent last-win)', () => {
  const p = parseArgv(['--token', '/a', '--token', '/b']);
  assert.strictEqual(p.ok, false);
  assert.ok(/more than once/.test(p.error));
});

// ---- formatResult: the H3 fail-closed control structure -----------------------------------------

test('formatResult: ONLY ok===true && emitted===true exits 0; every other/unknown shape exits 1 (H3)', () => {
  assert.strictEqual(formatResult({ ok: true, emitted: true, pr: { pr_url: 'x' } }).exitCode, 0, 'the one success path');
  assert.strictEqual(formatResult({ ok: true, emitted: false }).exitCode, 1);
  assert.strictEqual(formatResult({ ok: true }).exitCode, 1);
  assert.strictEqual(formatResult({ weird: true }).exitCode, 1, 'an unknown future shape fails closed');
  assert.strictEqual(formatResult(undefined).exitCode, 1);
  assert.strictEqual(formatResult({ ok: true, emitted: 'true', pr: { pr_url: 'x' } }).exitCode, 1, 'a truthy non-boolean emitted must NOT pass (strict ===)');
  // exit 0 also REQUIRES a real pr_url (M1) and a SYNCHRONOUS result (M2):
  assert.strictEqual(formatResult({ ok: true, emitted: true }).exitCode, 1, 'emitted:true with no pr -> fail-closed (no false "opened")');
  assert.strictEqual(formatResult({ ok: true, emitted: true, pr: {} }).exitCode, 1, 'emitted:true with no pr_url -> fail-closed');
  assert.strictEqual(formatResult(Promise.resolve({ ok: true, emitted: true, pr: { pr_url: 'x' } })).exitCode, 1, 'a thenable return is refused loudly, never a success');
  assert.ok(/Promise/.test(formatResult(Promise.resolve({})).stderr), 'the thenable refusal is an explicit diagnostic, not a silent not-armed');
});

test('formatResult: a deduped emit is reported distinctly from a fresh open (M2)', () => {
  const fresh = formatResult({ ok: true, emitted: true, pr: { pr_url: 'https://x/pr/1' } });
  assert.strictEqual(fresh.exitCode, 0);
  assert.ok(/opened/i.test(fresh.stdout) && !/dedup/i.test(fresh.stdout));
  const dd = formatResult({ ok: true, emitted: true, pr: { pr_url: 'https://x/pr/1', deduped: true } });
  assert.strictEqual(dd.exitCode, 0);
  assert.ok(/dedup/i.test(dd.stdout), 'a prior PR must not be misreported as a fresh open');
});

// ---- run(): return interpretation (injected emitFn) ---------------------------------------------

const okDraft = () => ({ repo: 'o/r', issueRef: 1, diff: DIFF });

test('run: emitted:true -> exit 0 + "opened PR" + url on stdout', () => {
  const r = run(coreFlags(), { emitFn: () => ({ ok: true, emitted: true, pr: { pr_url: 'https://x/pr/1' } }), readDraftFile: okDraft });
  assert.strictEqual(r.exitCode, 0);
  assert.ok(r.stdout.includes('https://x/pr/1'));
});

test('run: awaiting-approval -> exit 1 + approvalReason on stderr (observable, S3)', () => {
  const r = run(coreFlags(), { emitFn: () => ({ ok: true, emitted: false, reason: 'awaiting-approval', approvalReason: 'sig-invalid' }), readDraftFile: okDraft });
  assert.strictEqual(r.exitCode, 1);
  assert.ok(r.stderr.includes('sig-invalid'));
});

test('run: not-live emitted:false -> exit 1 + prints res.approvalHash (TOP-LEVEL, not draft.approvalHash) (F1)', () => {
  // non-vacuous: the hash is top-level and the draft object does NOT carry it, so a res.draft.approvalHash
  // reader would print undefined and this assertion would fail.
  const r = run(coreFlags(), { emitFn: () => ({ ok: true, emitted: false, disposition: { mode: 'draft' }, draft: { repo: 'o/r' }, approvalHash: 'abcd1234ef' }), readDraftFile: okDraft });
  assert.strictEqual(r.exitCode, 1);
  assert.ok(r.stderr.includes('abcd1234ef'), 'the operator must see the hash to approve; it lives at the top level of the return');
});

test('run: ok:false -> exit 1 + reason', () => {
  const r = run(coreFlags(), { emitFn: () => ({ ok: false, emitted: false, reason: 'lock-unavailable:busy' }), readDraftFile: okDraft });
  assert.strictEqual(r.exitCode, 1);
  assert.ok(r.stderr.includes('lock-unavailable:busy'));
});

test('run: a missing required custody flag -> exit 2 (usage), distinct from a runtime refusal (exit 1)', () => {
  const r = run(['--approvals-dir', '/a', '--killswitch', '/k', '--disposition', '/d', '--token', '/t', '--verify-key', '/v', '--gh-config-dir', '/g'], {
    emitFn: () => { throw new Error('emitFn must not be called on a usage error'); },
  });
  assert.strictEqual(r.exitCode, 2, 'missing --draft is a usage error (2), not a runtime failure (1)');
  assert.ok(/draft/.test(r.stderr));
});

test('run: --ttl-ms must be a positive integer -> abc / 0 / 1.5 all exit 2 (usage)', () => {
  for (const bad of ['abc', '0', '1.5']) {
    const r = run(coreFlags().concat(['--ttl-ms', bad]), { emitFn: () => { throw new Error('emitFn must not run on a usage error'); }, readDraftFile: okDraft });
    assert.strictEqual(r.exitCode, 2, `--ttl-ms ${bad} is a usage error`);
    assert.ok(/ttl/.test(r.stderr));
  }
});

test('run: a malformed (non-JSON) draft file -> exit 1 + a clean reason, never a raw stack trace (S2)', () => {
  const dir = tmp();
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, '{not json');
  const r = run(coreFlags({ draft: bad }));   // real readDraftFile -> JSON.parse throws inside the pipeline try
  assert.strictEqual(r.exitCode, 1);
  assert.ok(r.stderr.startsWith('emit-cli:'), 'a clean, prefixed reason');
  assert.ok(/not valid JSON/.test(r.stderr), 'a stable JSON-error reason, not V8 parser wording');
  assert.ok(!/\n\s+at /.test(r.stderr), 'no stack-trace frames in the reason (a raw throw would carry them)');
});

// ---- INTEGRATION: real emitPR, no network (Rule-2a real-path) ------------------------------------

test('run: real emitPR with a valid-JSON draft MISSING repo/issueRef/diff -> exit 1 + a clean validator reason, no stack (real-path S2)', () => {
  const dir = tmp();
  const draft = path.join(dir, 'draft.json');
  fs.writeFileSync(draft, JSON.stringify({ unrelated: true }));   // valid JSON, but no repo/issueRef/diff
  const r = run([
    '--draft', draft,
    '--approvals-dir', path.join(dir, 'appr'),
    '--killswitch', path.join(dir, 'no-ks'),
    '--disposition', path.join(dir, 'no-disp'),
    '--token', path.join(dir, 'no-tok'),
    '--verify-key', path.join(dir, 'no-vk'),
    '--gh-config-dir', path.join(dir, 'gh'),
    '--lock', path.join(dir, 'lock'),
  ]);   // real emitPR -> its own validator throws -> caught -> clean {ok:false}
  assert.strictEqual(r.exitCode, 1);
  assert.ok(r.stderr.startsWith('emit-cli:'));
  assert.ok(!/\n\s+at /.test(r.stderr), 'the validator message surfaces cleanly, not as a stack trace');
});

test('run: real emitPR with the killswitch ABSENT -> emitted:false, exit 1, and the printed hash equals computeEmissionHash (F1 non-vacuous on the real path)', () => {
  const dir = tmp();
  const draft = path.join(dir, 'draft.json');
  const repo = 'shashankcm95/claude-power-loom';
  const issueRef = 536;
  fs.writeFileSync(draft, JSON.stringify({ repo, issueRef, diff: DIFF }));
  const r = run([
    '--draft', draft,
    '--approvals-dir', path.join(dir, 'appr'),
    '--killswitch', path.join(dir, 'no-killswitch'),   // absent -> killswitch ON -> gate never arms
    '--disposition', path.join(dir, 'no-disp'),
    '--token', path.join(dir, 'no-token'),
    '--verify-key', path.join(dir, 'no-vk'),
    '--gh-config-dir', path.join(dir, 'gh'),
    '--lock', path.join(dir, 'lock'),                  // isolated lock (no cross-test collision)
  ]);   // NO injected emitFn -> the REAL emitPR runs (no network reached: the gate short-circuits pre-armedEmit)
  assert.strictEqual(r.exitCode, 1, 'a not-armed emit must exit 1, never a false 0');
  assert.ok(/not emitted/i.test(r.stderr));
  const expected = computeEmissionHash({ repo, issueRef, diff: DIFF });
  assert.ok(r.stderr.includes(expected), 'the real top-level approvalHash is surfaced so the operator knows what to approve');
});

console.log(`emit-cli.test.js: ${passed} passed`);
