'use strict';

// tests/unit/kernel/egress/emit-pr.test.js — ③.2.1b PR-egress kernel (PR-A: the custody GATE).
// The live emission is ABSENT this wave (armedEmit throws), so these prove the gate is fail-closed by
// construction without ever touching the network. (Fake credential values are COMPUTED, never literal
// *_TOKEN assignments — the secrets gate.)

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const E = require(path.join(REPO, 'packages', 'kernel', 'egress', 'emit-pr.js'));
const S = require(path.join(REPO, 'packages', 'kernel', 'egress', 'approval-store.js'));   // ③.2.4 — mint approvals
const SELF_UID = typeof process.getuid === 'function' ? process.getuid() : null;

// Computed fake credentials (never a literal *_TOKEN = '...' assignment).
const FAKE_AMBIENT = ['AMBIENT', 'no', 'leak'].join('-');
const FAKE_CUSTODY = ['custody', 'fake', 'value'].join('-');

let passed = 0; let failed = 0; let skipped = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function scratch(p) { return fs.mkdtempSync(path.join(os.tmpdir(), p)); }
const GOOD_DIFF = 'diff --git a/src/foo.py b/src/foo.py\n--- a/src/foo.py\n+++ b/src/foo.py\n@@ -1 +1 @@\n-old\n+new\n';
function goodData(over) { return Object.assign({ repo: 'owner/repo', issueRef: 42, diff: GOOD_DIFF }, over || {}); }

// === EC1b.1 — env-sanitization IS the killswitch ===

test('EC1b.1 buildEmitEnv: from-scratch allowlist drops GH_*/GITHUB_TOKEN; pins the hardening', () => {
  const cfg = scratch('loom-ghcfg-');
  const save = { GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN, GH_HOST: process.env.GH_HOST };
  process.env.GH_TOKEN = FAKE_AMBIENT;          // pollute the parent env to prove nothing ambient leaks
  process.env.GITHUB_TOKEN = FAKE_AMBIENT;
  process.env.GH_HOST = 'evil.example';
  try {
    const env = E.buildEmitEnv({ token: null, ghConfigDir: cfg });
    assert.strictEqual(env.GH_TOKEN, undefined, 'ambient GH_TOKEN is NOT copied (killswitch: no token)');
    assert.strictEqual(env.GITHUB_TOKEN, undefined, 'ambient GITHUB_TOKEN is dropped');
    assert.strictEqual(env.GH_HOST, undefined, 'ambient GH_* is dropped (from-scratch allowlist)');
    assert.strictEqual(env.GH_CONFIG_DIR, cfg, 'GH_CONFIG_DIR -> the empty custody dir');
    assert.strictEqual(env.GIT_TERMINAL_PROMPT, '0');
    assert.strictEqual(env.GIT_CONFIG_GLOBAL, '/dev/null');
    assert.strictEqual(env.GIT_CONFIG_NOSYSTEM, '1');
    assert.strictEqual(env.GIT_ALLOW_PROTOCOL, 'https');
  } finally { for (const k of Object.keys(save)) { if (save[k] === undefined) delete process.env[k]; else process.env[k] = save[k]; } fs.rmSync(cfg, { recursive: true, force: true }); }
});

test('EC1b.1 buildEmitEnv: a token is injected ONLY when explicitly provided (the sole credential path)', () => {
  const cfg = scratch('loom-ghcfg-');
  try {
    assert.strictEqual(E.buildEmitEnv({ token: FAKE_CUSTODY, ghConfigDir: cfg }).GH_TOKEN, FAKE_CUSTODY);
    assert.strictEqual(E.buildEmitEnv({ token: null, ghConfigDir: cfg }).GH_TOKEN, undefined);
    assert.throws(() => E.buildEmitEnv({ token: FAKE_CUSTODY }), /ghConfigDir/, 'a ghConfigDir is required');
  } finally { fs.rmSync(cfg, { recursive: true, force: true }); }
});

test('EC1b.1 buildEmitEnv: a POPULATED ghConfigDir is fail-closed (isolation invariant — CodeRabbit #388)', () => {
  const cfg = scratch('loom-ghcfg-');
  fs.writeFileSync(path.join(cfg, 'hosts.yml'), 'github.com:\n  oauth_token: REDACTED\n'); // ambient gh auth state
  try {
    assert.throws(() => E.buildEmitEnv({ token: null, ghConfigDir: cfg }), /EMPTY\/isolated/, 'a populated gh config dir reintroduces ambient auth -> rejected');
    assert.throws(() => E.assertIsolatedGhConfigDir(cfg), /EMPTY\/isolated/);
  } finally { fs.rmSync(cfg, { recursive: true, force: true }); }
  // an absent dir is allowed (gh creates it fresh + empty => isolated)
  assert.doesNotThrow(() => E.assertIsolatedGhConfigDir(path.join(os.tmpdir(), `loom-absent-${process.pid}-${Date.now()}`)));
});

test('EC1b.1 [LIVE] gh auth status in the sanitized env reports NOT-authenticated even when the host is authed', () => {
  const ghPath = spawnSync('command', ['-v', 'gh'], { shell: '/bin/bash', encoding: 'utf8' });
  if (ghPath.status !== 0) { skipped += 1; process.stdout.write('  SKIP (gh absent) EC1b.1 live\n'); return; }
  const hostAuthed = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8', timeout: 15000 });
  const hostOut = (hostAuthed.stdout || '') + (hostAuthed.stderr || '');
  if (!/Logged in to/i.test(hostOut)) { skipped += 1; process.stdout.write('  SKIP (host not gh-authed — inconclusive, not a leak) EC1b.1 live\n'); return; }
  const cfg = scratch('loom-ghcfg-');
  try {
    const env = E.buildEmitEnv({ token: null, ghConfigDir: cfg });
    const r = spawnSync('gh', ['auth', 'status'], { env, encoding: 'utf8', timeout: 15000 });
    const out = (r.stdout || '') + (r.stderr || '');
    assert.ok(/not logged|no accounts|not authenticat/i.test(out), `sanitized env must report not-authenticated (got: ${out.slice(0, 120)})`);
  } finally { fs.rmSync(cfg, { recursive: true, force: true }); }
});

// === EC1b.3 — disposition deny-by-default (untrusted data carries no policy) ===

test('EC1b.3 assertDataIsPolicyFree: EVERY disposition-shaped key in data is fail-closed rejected', () => {
  for (const k of E.DISPOSITION_KEYS) {
    assert.throws(() => E.assertDataIsPolicyFree(goodData({ [k]: 'x' })), new RegExp(`policy key '${k}'`), `data.${k} must be rejected`);
  }
  assert.doesNotThrow(() => E.assertDataIsPolicyFree(goodData()), 'clean data passes');
});

test('EC1b.3 emitPR: a poisoned-data disposition key => ok:false (reject), never a silent flip', () => {
  const r = E.emitPR(goodData({ live: true }));
  assert.strictEqual(r.ok, false, 'poisoned data is rejected');
  assert.strictEqual(r.emitted, false);
  assert.ok(/policy key/.test(r.reason), `reason names the policy-key rejection (got ${r.reason})`);
});

// === EC1b.4 — input-shape + egress-time path-scope; fail-closed everywhere ===

test('EC1b.4 input-shape: a non-owner/repo, flag-injection, host, or traversal repo is rejected', () => {
  for (const bad of ['not-a-repo', 'owner/repo/extra', '-x/y', 'a/b:c', 'a/../b', 'https://github.com/a/b', '']) {
    assert.throws(() => E.assertSafeRepoRef(bad), /repo/, `repo ${JSON.stringify(bad)} rejected`);
  }
  assert.doesNotThrow(() => E.assertSafeRepoRef('owner/repo'));
  for (const bad of ['abc', '0', '-3', '#x', null]) assert.throws(() => E.assertSafeIssueRef(bad), /issueRef/);
  assert.doesNotThrow(() => E.assertSafeIssueRef(7));
  assert.doesNotThrow(() => E.assertSafeIssueRef('#7'));
});

// === ③.2.3 H1 — owner-vs-repo-typed slug validation (close the dot-segment foot-guns w/o over-reject) ===
test('③.2.3 H1: assertSafeRepoRef accepts legit owner/repo incl. a dot-led REPO name (owner/.github)', () => {
  for (const good of ['owner/repo', 'owner/.github', 'owner/react.dev', 'o-w-ner/re.po', 'owner/_repo', 'octocat/Hello-World']) {
    assert.doesNotThrow(() => E.assertSafeRepoRef(good), `expected ACCEPT: ${good}`);
  }
});
test('③.2.3 H1: assertSafeRepoRef REJECTS a dotted/dot-only OWNER, a .-only/trailing-./leading-- REPO, and traversal', () => {
  for (const bad of ['.github/x', './r', 'o/.', 'o.w/r', 'o_w/r', 'o--w/r', 'owner/..', 'owner/x.', 'owner/-x', '-o/r', 'o..o/r']) {
    assert.throws(() => E.assertSafeRepoRef(bad), /repo|owner/, `expected REJECT: ${bad}`);
  }
});

// === ③.2.3 H2 — assertSafeIssueRef magnitude bound (a precision-lost 20-digit number is a wrong target) ===
test('③.2.3 H2: assertSafeIssueRef rejects a non-safe-integer (20-digit) issue, bare AND #-prefixed', () => {
  assert.throws(() => E.assertSafeIssueRef('99999999999999999999'), /issueRef/);
  assert.throws(() => E.assertSafeIssueRef('#99999999999999999999'), /issueRef/);
  assert.doesNotThrow(() => E.assertSafeIssueRef(7));
  assert.doesNotThrow(() => E.assertSafeIssueRef('#7'));
  assert.doesNotThrow(() => E.assertSafeIssueRef(String(Number.MAX_SAFE_INTEGER)));
  assert.throws(() => E.assertSafeIssueRef(String(Number.MAX_SAFE_INTEGER + 1)), /issueRef/);
});

// === ③.2.3 EC6 — this wave adds NO egress: armedEmit still throws + emit-pr.js imports no child_process ===
test('③.2.3 EC6: emit-pr.js source imports NO child_process (no egress subprocess added this wave)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', '..', '..', 'packages', 'kernel', 'egress', 'emit-pr.js'), 'utf8');
  assert.ok(!/require\(\s*['"]child_process['"]\s*\)/.test(src), 'emit-pr.js must not import child_process (the live seam stays unimplemented)');
});

test('EC1b.4 egress path-scope: a diff touching .github / .git* / CI / traversal is rejected', () => {
  const deny = [
    'diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml\n+++ b/.github/workflows/ci.yml\n',
    'diff --git a/.gitattributes b/.gitattributes\n+++ b/.gitattributes\n',
    'diff --git a/.gitmodules b/.gitmodules\n+++ b/.gitmodules\n',
    'diff --git a/Jenkinsfile b/Jenkinsfile\n+++ b/Jenkinsfile\n',
  ];
  for (const d of deny) assert.throws(() => E.assertEgressSafeDiff(d), /egress-denied|unparseable/, 'denied diff rejected');
  assert.throws(() => E.assertEgressSafeDiff(''), /non-empty/);
  assert.deepStrictEqual(E.assertEgressSafeDiff(GOOD_DIFF), ['src/foo.py']);
});

test('EC1b.4 egress path-scope: CASE-INSENSITIVE + quote + control-char bypasses are denied (VALIDATE-hacker)', () => {
  // case-insensitive: .GITHUB / .GIT / .GitHub must be denied (the case-sensitive bypass).
  for (const p of ['.GITHUB/workflows/x.yml', '.GitHub/workflows/x.yml', '.GIT/config', '.Git/config', '.GITMODULES']) {
    assert.strictEqual(E.isEgressDeniedPath(p), true, `${p} must be denied (case-insensitive)`);
  }
  // a c-quoting bypass: `b/".github/..."` parses to a leading-quote path -> the quote-reject denies it.
  assert.strictEqual(E.isEgressDeniedPath('".github/workflows/x.yml'), true, 'a quote-bearing path is denied');
  // a NUL/control char in a path is denied.
  assert.strictEqual(E.isEgressDeniedPath('src/foo\x00.py'), true, 'a control-char path is denied');
  // end-to-end through emitPR:
  assert.strictEqual(E.emitPR(goodData({ diff: 'diff --git a/.GITHUB/x.yml b/.GITHUB/x.yml\n+++ b/.GITHUB/x.yml\n' })).ok, false, '.GITHUB diff is fail-closed end-to-end');
});

test('EC1b.4 a diff over MAX_DIFF_BYTES is fail-closed (memory-amplification bound)', () => {
  const huge = `diff --git a/src/big.txt b/src/big.txt\n+++ b/src/big.txt\n+${'x'.repeat(6 * 1024 * 1024)}\n`;
  assert.throws(() => E.assertEgressSafeDiff(huge), /exceeds .* bytes/);
  assert.strictEqual(E.emitPR(goodData({ diff: huge })).ok, false);
});

test('EC1b.3 disposition deny-list is CASE-FOLDED: casing variants + prototype own-keys are rejected', () => {
  for (const k of ['Live', 'LIVE', 'Mode', 'MODE', 'DRY_RUN', 'DryRun', 'Token', 'Armed', 'constructor', 'CONSTRUCTOR']) {
    assert.throws(() => E.assertDataIsPolicyFree(goodData({ [k]: 'x' })), /policy key/, `data.${k} rejected (case-folded)`);
  }
  // __proto__ as an OWN enumerable key only arrives via JSON.parse (a literal sets the prototype); reject it.
  const jsonProto = JSON.parse('{"__proto__":"x","repo":"owner/repo","issueRef":1,"diff":"d"}');
  assert.throws(() => E.assertDataIsPolicyFree(jsonProto), /policy key/, 'a JSON-parsed __proto__ own-key is rejected');
});

test('EC1b.4 repo validator rejects a dash-leading SECOND segment (argv-flag injection shape)', () => {
  for (const bad of ['owner/--upload-file', 'owner/-X', 'x/--help', '-flag/repo']) {
    assert.throws(() => E.assertSafeRepoRef(bad), /repo/, `${bad} rejected`);
  }
  assert.doesNotThrow(() => E.assertSafeRepoRef('owner/repo-name'));
});

test('EC1b.4 emitPR: a clean dry-run input builds the DRAFT artifact, emits NOTHING', () => {
  const r = E.emitPR(goodData());
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.emitted, false, 'this wave NEVER emits');
  assert.strictEqual(r.disposition.mode, 'dry-run');
  assert.strictEqual(r.draft.repo, 'owner/repo');
  assert.deepStrictEqual(r.draft.touched_paths, ['src/foo.py']);
});

test('EC1b.4 emitPR: a .github diff is fail-closed (ok:false, emitted:false)', () => {
  const r = E.emitPR(goodData({ diff: 'diff --git a/.github/workflows/x.yml b/.github/workflows/x.yml\n+++ b/.github/workflows/x.yml\n' }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.emitted, false);
});

// === EC1b.5 — the live seam (③.2.4 gate: live AND token AND killswitch-off AND a per-emission approval) ===

test('EC1b.5 armedEmit() THROWS not-armed (no live network code this wave; retargeted ③.2.5)', () => {
  assert.throws(() => E.armedEmit(), /egress-not-armed/);                 // match the STABLE prefix, not the version
});

// An "armed" custody (killswitch OFF + token + LIVE disposition + an empty approvals dir). The 4th AND — a
// per-emission approval — is minted per-test via recordApproval so we prove BOTH the awaiting + the approved paths.
function armedCustody(dir) {
  fs.writeFileSync(path.join(dir, 'killswitch'), 'ARMED');
  fs.writeFileSync(path.join(dir, 'token'), FAKE_CUSTODY);
  fs.writeFileSync(path.join(dir, 'disposition'), JSON.stringify({ mode: 'live', draft: false }));
  fs.mkdirSync(path.join(dir, 'approvals'));
  return {
    killswitchPath: path.join(dir, 'killswitch'), custodyTokenPath: path.join(dir, 'token'),
    custodyDispositionPath: path.join(dir, 'disposition'), custodyApprovalsDir: path.join(dir, 'approvals'),
    lockPath: path.join(dir, 'lock'), now: 1000, ttlMs: 1000000, selfUid: SELF_UID,
  };
}
// The minimal axiom emitPR hashes for goodData() (GOOD_DIFF has no secrets => scrubbed == raw).
function mintApprovalFor(opts) {
  return S.recordApproval(opts.custodyApprovalsDir, { repo: 'owner/repo', issueRef: 42, diff: GOOD_DIFF }, { now: opts.now, nonce: 'n-test', selfUid: SELF_UID });
}
function withKillswitchEnvCleared(fn) {
  const save = process.env.LOOM_BETA_KILLSWITCH; delete process.env.LOOM_BETA_KILLSWITCH;
  try { return fn(); } finally { if (save === undefined) delete process.env.LOOM_BETA_KILLSWITCH; else process.env.LOOM_BETA_KILLSWITCH = save; }
}

test('EC1b.5a armed but NO approval => awaiting-approval (ok:true, emitted:false, approvalHash surfaced)', () => {
  const dir = scratch('loom-custody-');
  try {
    withKillswitchEnvCleared(() => {
      const r = E.emitPR(goodData(), armedCustody(dir));
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.emitted, false, 'no approval => no emit');
      assert.strictEqual(r.reason, 'awaiting-approval');
      assert.ok(/^[a-f0-9]{64}$/.test(r.approvalHash), 'the approvalHash is surfaced for the human to approve');
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('EC1b.5b armed + a VALID approval => reaches the throwing armedEmit => fail-closed; cap+ledger+approval UNCHANGED (I2)', () => {
  const dir = scratch('loom-custody-');
  try {
    withKillswitchEnvCleared(() => {
      const opts = Object.assign(armedCustody(dir), { custodyCapStatePath: path.join(dir, 'cap.json'), custodyEtiquetteLedgerPath: path.join(dir, 'ledger') });
      const { hash } = mintApprovalFor(opts);
      const r = E.emitPR(goodData(), opts);                               // default armedEmit THROWS this wave
      assert.strictEqual(r.ok, false, 'the not-armed seam fails closed even with a valid approval');
      assert.strictEqual(r.emitted, false);
      assert.ok(/not-armed/.test(r.reason), `reason is the seam (got ${r.reason})`);
      // emit-then-record: a throwing emit leaves the cap + ledger UNWRITTEN and the approval UN-consumed.
      assert.strictEqual(fs.existsSync(opts.custodyCapStatePath), false, 'cap state never written (reservation fold)');
      assert.strictEqual(fs.existsSync(opts.custodyEtiquetteLedgerPath), false, 'ledger never written');
      assert.strictEqual(S.readVerifiedApproval(opts.custodyApprovalsDir, hash, { now: opts.now, ttlMs: opts.ttlMs, selfUid: SELF_UID }).ok, true, 'approval NOT consumed by a failed emit');
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('EC1b.5c armed + valid approval + an injected SUCCEEDING armedEmitFn => emitted:true; cap+ledger RECORDED + approval CONSUMED', () => {
  const dir = scratch('loom-custody-');
  try {
    withKillswitchEnvCleared(() => {
      const opts = Object.assign(armedCustody(dir), { custodyCapStatePath: path.join(dir, 'cap.json'), custodyEtiquetteLedgerPath: path.join(dir, 'ledger') });
      const { hash } = mintApprovalFor(opts);
      // NB the emit-then-record ORDERING (record AFTER emit) is proven by EC1b.5b/5b2 (the throwing path), not
      // here — a succeeding emit records + consumes under either order. This proves the on-SUCCESS state only.
      let emitCalls = 0;
      const r = E.emitPR(goodData(), Object.assign({}, opts, { armedEmitFn: () => { emitCalls += 1; return { pr_url: 'https://example/pr/1' }; } }));
      assert.strictEqual(emitCalls, 1, 'armedEmitFn invoked exactly once');
      assert.strictEqual(r.ok, true); assert.strictEqual(r.emitted, true, 'valid approval + succeeding emit => emitted');
      assert.deepStrictEqual(r.pr, { pr_url: 'https://example/pr/1' });
      assert.strictEqual(fs.existsSync(opts.custodyCapStatePath), true, 'cap recorded AFTER the successful emit');
      assert.strictEqual(fs.existsSync(opts.custodyEtiquetteLedgerPath), true, 'ledger recorded AFTER the successful emit');
      assert.strictEqual(S.readVerifiedApproval(opts.custodyApprovalsDir, hash, { now: opts.now, ttlMs: opts.ttlMs, selfUid: SELF_UID }).ok, false, 'approval consumed (one-shot)');
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('EC1b.5d a CONSUMED approval does not re-fire; a TTL-expired approval => awaiting-approval (H4 one-shot + TTL)', () => {
  const dir = scratch('loom-custody-');
  try {
    withKillswitchEnvCleared(() => {
      const opts = armedCustody(dir);                                     // no cap/ledger => the approval is the sole gate
      mintApprovalFor(opts);
      E.emitPR(goodData(), Object.assign({}, opts, { armedEmitFn: () => ({ pr_url: 'x' }) }));   // consumes it
      const r2 = E.emitPR(goodData(), Object.assign({}, opts, { armedEmitFn: () => ({ pr_url: 'x' }) }));
      assert.strictEqual(r2.reason, 'awaiting-approval', 'a consumed one-shot approval does not re-fire');
      mintApprovalFor(opts);                                             // fresh approval, but now PAST its TTL
      const r3 = E.emitPR(goodData(), Object.assign({}, opts, { now: opts.now + 9999999, ttlMs: 1000, armedEmitFn: () => ({ pr_url: 'x' }) }));
      assert.strictEqual(r3.reason, 'awaiting-approval', 'a stale (TTL-expired) approval does not fire');
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('EC1b.5b2 a throwing emit leaves PRE-EXISTING cap/ledger state byte-UNCHANGED (the strongest reservation-fold guard; honesty H3)', () => {
  const dir = scratch('loom-custody-');
  try {
    withKillswitchEnvCleared(() => {
      const opts = Object.assign(armedCustody(dir), { custodyCapStatePath: path.join(dir, 'cap.json'), custodyEtiquetteLedgerPath: path.join(dir, 'ledger') });
      mintApprovalFor(opts);
      fs.writeFileSync(opts.custodyCapStatePath, JSON.stringify({ windowStart: opts.now, count: 2 }));   // pre-seeded under cap
      fs.writeFileSync(opts.custodyEtiquetteLedgerPath, 'other/repo#1\n');                                // an unrelated prior key
      const r = E.emitPR(goodData(), opts);                                                              // default armedEmit THROWS
      assert.strictEqual(r.ok, false, 'the seam fails closed');
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(opts.custodyCapStatePath, 'utf8')), { windowStart: opts.now, count: 2 }, 'cap counter NOT incremented by a throwing emit');
      assert.strictEqual(fs.readFileSync(opts.custodyEtiquetteLedgerPath, 'utf8'), 'other/repo#1\n', 'ledger byte-unchanged by a throwing emit');
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('EC1b.5e partial-commit residual: a SUCCEEDING emit whose recordEmit then throws => ok:false + approval NOT consumed (Forward-Contract #6 — INERT this wave)', () => {
  const dir = scratch('loom-custody-');
  try {
    withKillswitchEnvCleared(() => {
      // a cap path in a NON-existent subdir => recordEmit's writeAtomic ENOENT-throws AFTER the (injected) emit succeeded.
      const opts = Object.assign(armedCustody(dir), { custodyCapStatePath: path.join(dir, 'no-such-subdir', 'cap.json') });
      const { hash } = mintApprovalFor(opts);
      const r = E.emitPR(goodData(), Object.assign({}, opts, { armedEmitFn: () => ({ pr_url: 'https://example/pr/9' }) }));
      // documents the known reserve->rollback gap deferred to ③.2.5: the emit "happened" but the result reads ok:false.
      assert.strictEqual(r.ok, false, 'a post-emit record throw surfaces as ok:false (the documented partial-commit lie)');
      assert.strictEqual(S.readVerifiedApproval(opts.custodyApprovalsDir, hash, { now: opts.now, ttlMs: opts.ttlMs, selfUid: SELF_UID }).ok, true, 'the approval is NOT consumed when the post-emit record throws (③.2.5 reserve->rollback closes this)');
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('EC1b.5 killswitch default-ON: absent custody => killswitch on => token null (capability removed)', () => {
  assert.strictEqual(E.isKillswitchOn({}), true, 'no killswitchPath => ON (fail-closed)');
  assert.strictEqual(E.resolveToken({ killswitchOn: true, custodyTokenPath: '/whatever' }), null, 'killswitch on => no token');
});

// === EC1b.2 — sole-chokepoint: (a) the lint + (b) the custody env-isolation control ===

test('EC1b.2a sole-chokepoint LINT: no PRODUCTION module outside emit-pr.js spawns gh/git-push or reads the token', () => {
  // The lint catches the KNOWN subprocess/token forms (broadened per VALIDATE-hacker: spawn/exec/execSync
  // + bracket-env). The CUSTODY env-isolation test (EC1b.2b) is the AUTHORITATIVE fail-closed control for
  // the actor/clone boundary the lint structurally cannot see (a fetch/Octokit/indirection path).
  const SPIKE_ALLOW = /(^|\/)_spike(\/|$)/;
  const SELF = path.join('kernel', 'egress', 'emit-pr.js');
  const GH_SPAWN = /(?:spawn|spawnSync|exec|execSync|execFile|execFileSync)\(\s*['"`]gh['"` ]/;
  const GIT_PUSH = /['"]git['"]\s*,\s*\[\s*['"]push['"]/;
  const TOKEN_READ = /process\.env\s*(?:\.\s*|\[\s*['"`])(GH_TOKEN|GITHUB_TOKEN)\b/;    // dot AND bracket reads (CodeRabbit #388)
  const CAP = [GH_SPAWN, GIT_PUSH, TOKEN_READ];
  // ③.2.2a: the read-only live puller (lab/issue-corpus/live-puller.js) legitimately spawns `gh api`
  // for READ-only GitHub search/metadata using AMBIENT read auth — it emits nothing and never reads the
  // egress token. The chokepoint invariant is therefore "emit-pr.js is the sole WRITE-egress gh-spawner +
  // sole token-reader", NOT "the sole gh-spawner". A named read-only consumer is exempt from the gh-SPAWN
  // cap ONLY IF it proves it is GET-only by a POSITIVE runtime gate. We do NOT enumerate gh's write surface
  // here (the syntactic-gate-extension anti-pattern — gh AUTO-POSTs on `-f`/`-F`, accepts glued `-XPOST`,
  // and has `release/issue/gist create` etc.; a denylist would forever miss forms). Instead the exempted
  // module MUST carry an `assertReadOnlyGhArgs` gate (it refuses any non-`-X GET` before spawning), and is
  // STILL barred from git-push + token reads. (The AUTHORITATIVE token-custody control, EC1b.2b, is
  // unaffected — the puller never touches process.env GH_TOKEN/GITHUB_TOKEN.)
  const READONLY_GH_ALLOW = [path.join('packages', 'lab', 'issue-corpus', 'live-puller.js')];
  // require the call form `assertReadOnlyGhArgs(args);` (CodeRabbit #390 Major) — NOT a bare symbol match,
  // which would also accept the function DECLARATION `function assertReadOnlyGhArgs(args) {` and pass the
  // exemption even if the runtime invocation were removed. The lab suite additionally proves defaultGhRunner
  // INVOKES it (live-puller.test.js h3 — a write arg throws before any spawn).
  const GET_GATE = /assertReadOnlyGhArgs\s*\(\s*args\s*\)\s*;/;
  // regression (CodeRabbit #388): the token pattern must catch BOTH the dot AND the bracket read.
  assert.ok(TOKEN_READ.test('const t = process.env.GH_TOKEN;'), 'token-CAP catches dot-notation');
  assert.ok(TOKEN_READ.test("const t = process.env['GITHUB_TOKEN'];"), 'token-CAP catches bracket-notation');
  assert.ok(!TOKEN_READ.test('process.env.PATH'), 'token-CAP does not over-match a non-token env read');
  const offenders = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) { if (ent.name !== 'node_modules') walk(abs); continue; }
      if (!ent.name.endsWith('.js') || ent.name.endsWith('.test.js')) continue;
      const rel = path.relative(REPO, abs);
      if (rel.endsWith(SELF) || SPIKE_ALLOW.test(rel)) continue;        // emitPR itself + dev spikes
      const src = fs.readFileSync(abs, 'utf8');
      if (READONLY_GH_ALLOW.includes(rel)) {
        // exempt from GH_SPAWN ONLY with the positive GET-gate; still barred from git-push + token reads.
        if (!GET_GATE.test(src)) offenders.push(`${rel} (missing assertReadOnlyGhArgs GET-gate)`);
        if (GIT_PUSH.test(src) || TOKEN_READ.test(src)) offenders.push(rel);
        continue;
      }
      if (CAP.some((re) => re.test(src))) offenders.push(rel);
    }
  };
  for (const layer of ['kernel', 'runtime', 'lab']) walk(path.join(REPO, 'packages', layer));
  assert.deepStrictEqual(offenders, [], `gh/git-push/token capability outside emitPR: ${offenders.join(', ')}`);
});

test('EC1b.2b custody env-isolation: emitPR never writes the token into process.env (the fail-closed control)', () => {
  const before = { GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN };
  E.emitPR(goodData());
  assert.strictEqual(process.env.GH_TOKEN, before.GH_TOKEN, 'GH_TOKEN unchanged by emitPR');
  assert.strictEqual(process.env.GITHUB_TOKEN, before.GITHUB_TOKEN, 'GITHUB_TOKEN unchanged by emitPR');
});

// === serialization ===

test('serialization: a lock-unavailable acquisition REFUSES the emit (fail-closed), never admits', () => {
  const dir = scratch('loom-lock-');
  const lockPath = path.join(dir, 'lock');
  try {
    fs.mkdirSync(lockPath);                                            // a dir at lockPath => the lockfile cannot be created
    const r = E.emitPR(goodData(), { lockPath });
    assert.strictEqual(r.ok, false, 'lock-unavailable => refuse');
    assert.ok(/lock-unavailable/.test(r.reason), `reason names the lock refusal (got ${r.reason})`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// === ③.2.1b PR-B — scrub wiring + cap + etiquette via emitPR ===

const PRB_PAT = `github_pat_${'a'.repeat(82)}`;

test('EC1bB.2 emitPR: draft.diff is the SCRUBBED diff (a secret in the input does not survive into the artifact)', () => {
  const r = E.emitPR(goodData({ diff: `diff --git a/c.py b/c.py\n+++ b/c.py\n+token = "${PRB_PAT}"\n` }));
  assert.strictEqual(r.ok, true);
  assert.ok(!r.draft.diff.includes(PRB_PAT), 'the secret is redacted in draft.diff');
  assert.ok(/\[REDACTED/.test(r.draft.diff), 'a redaction marker is present');
});

test('EC1bB.2 emitPR: a secret in a FILENAME is redacted in draft.touched_paths (whole-body scrub)', () => {
  const diff = `diff --git a/src/${PRB_PAT}.py b/src/${PRB_PAT}.py\n+++ b/src/${PRB_PAT}.py\n+x = 1\n`;
  const r = E.emitPR(goodData({ diff }));
  assert.strictEqual(r.ok, true, 'a secret-in-filename diff still passes (the path is not .github/.git)');
  assert.ok(r.draft.touched_paths.every((p) => !p.includes(PRB_PAT)), 'the secret filename is redacted in touched_paths');
});

test('EC1bB.3 emitPR: an over-cap emit is fail-closed (custody cap state; injected clock)', () => {
  const dir = scratch('loom-cap-'); const capPath = path.join(dir, 'cap.json');
  try {
    fs.writeFileSync(capPath, JSON.stringify({ windowStart: 1000, count: 5 }));   // at cap
    const r = E.emitPR(goodData(), { custodyCapStatePath: capPath, perWindowCap: 5, windowMs: 24 * 3600 * 1000, now: 1000, lockPath: path.join(dir, 'lock') });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'cap-exceeded');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('EC1bB.4 emitPR: a 2nd CANONICAL (repo,issue) emit is fail-closed (custody ledger)', () => {
  const dir = scratch('loom-led-'); const ledger = path.join(dir, 'ledger');
  try {
    fs.writeFileSync(ledger, 'owner/repo#42\n');                                   // already emitted
    const r = E.emitPR(goodData({ repo: 'Owner/Repo.git', issueRef: '#42' }), { custodyEtiquetteLedgerPath: ledger, lockPath: path.join(dir, 'lock') });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'etiquette-already-emitted');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('EC1bB.3/4 emitPR: a poisoned data policy key (cap/window/ledger/now) is fail-closed REJECTED', () => {
  for (const k of ['perWindowCap', 'windowMs', 'ledger', 'cap', 'now', 'backpressure']) {
    const r = E.emitPR(goodData({ [k]: 'x' }));
    assert.strictEqual(r.ok, false, `data.${k} rejected`);
    assert.ok(/policy key/.test(r.reason), `data.${k} names the policy-key rejection (got ${r.reason})`);
  }
});

// === ③.2.4 — the per-emission approval gate riders (H5 normalize-once + H7 deny-list completeness) ===

test('③.2.4 H7: the full approval vocabulary is in the data deny-list (actor cannot inject approval/custody keys)', () => {
  for (const k of ['approval', 'approvalHash', 'approved', 'emission', 'approvedAt', 'nonce', 'custodyApprovalsDir', 'custodyApprovalsPath', 'ttlMs', 'selfUid', 'armedEmitFn']) {
    assert.ok(E.DISPOSITION_KEYS.includes(k), `${k} must be a declared disposition key`);
    const r = E.emitPR(goodData({ [k]: 'x' }));
    assert.strictEqual(r.ok, false, `data.${k} rejected end-to-end`);
    assert.ok(/policy key/.test(r.reason), `data.${k} names the policy-key rejection (got ${r.reason})`);
  }
});

test('③.2.4 H5: draft.repo is the NORMALIZED canonical (a .git / case input collapses to owner/repo)', () => {
  for (const input of ['Owner/Repo', 'Owner/Repo.git', 'owner/repo']) {
    const r = E.emitPR(goodData({ repo: input }));
    assert.strictEqual(r.ok, true, `${input} ok`);
    assert.strictEqual(r.draft.repo, 'owner/repo', `${input} -> the ONE canonical repo the axiom + the ③.2.5 target read`);
    assert.ok(/^[a-f0-9]{64}$/.test(r.approvalHash), 'approvalHash surfaced on the dry-run path too');
  }
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== emit-pr.test.js: ${passed} passed, ${failed} failed, ${skipped} skipped ===\n`);
  if (failed > 0) process.exit(1);
})();
