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
// ③.2.5a — an in-process keypair + test signFn (the cross-uid broker is PR-2); the gate pins KP.publicKeyPem via custody.
const { generateEdgeKeypair, signRecordId } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'edge-attestation.js'));
const KP = generateEdgeKeypair();
const SIGN = (h, body) => signRecordId(h, { privateKeyPem: KP.privateKeyPem }, body);
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

// === ③.2.3 EC6 — the CHOKEPOINT module stays subprocess-free: the gh subprocess lives in the DELEGATE ===
// ③.2.5c armed the seam, but the subprocess lives in gh-emit.js — emit-pr.js itself STILL imports no
// child_process (it delegates via a lazy require). Keeping the gate module spawn-free is the ongoing invariant:
// the chokepoint reasons about policy; only the dedicated seam touches the network.
test('③.2.3 EC6: emit-pr.js source imports NO child_process directly (the gh subprocess lives in the gh-emit delegate)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', '..', '..', 'packages', 'kernel', 'egress', 'emit-pr.js'), 'utf8');
  assert.ok(!/require\(\s*['"]child_process['"]\s*\)/.test(src), 'emit-pr.js must not import child_process directly (the live seam is gh-emit.js)');
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

test('EC1b.5 armedEmit is WIRED to the gh-REST seam + fails-closed on a missing custody env (③.2.5c; no accidental no-arg emit)', () => {
  // ③.2.5c flipped armedEmit from the `egress-not-armed` throw to a real delegation. It now builds the sanitized
  // env (buildEmitEnv REQUIRES a ghConfigDir) then delegates to gh-emit. With no ghConfigDir it fails-closed at
  // buildEmitEnv — zero network, no accidental no-arg emit. The live network path is unit-tested in gh-emit.test.js
  // (injected mock runGh). The outer-catch fail-closed (any armedEmit throw => ok:false) is proven by EC1b.5b.
  assert.throws(() => E.armedEmit(), /ghConfigDir/);
  assert.throws(() => E.armedEmit({ draft: {}, token: FAKE_CUSTODY, approvalHash: 'x' }), /ghConfigDir/);
});

test('F-W2 H1 arming gate: armedEmit REFUSES a populated forkRepo (object-sharing-unprobed) + threads the F-W1 default (undefined) to ghEmit', () => {
  // armedEmit lazily `require('./gh-emit').ghEmit`; intercept the cached export to capture what (if anything) is forwarded.
  const ghMod = require(path.join(REPO, 'packages', 'kernel', 'egress', 'gh-emit.js'));
  const realGhEmit = ghMod.ghEmit;
  const cfg = scratch('loom-ghcfg-');   // an EMPTY dir so buildEmitEnv passes
  let seen = null;
  ghMod.ghEmit = (args) => { seen = args; return { pr_url: 'u', number: 1, branch: 'b', base_sha: 'a'.repeat(40) }; };
  try {
    // H1: a populated forkRepo is fail-closed-forbidden until F-W4 records the object-sharing probe
    // (OBJECT_SHARING_PROBE_RECORDED === false). The gate throws BEFORE delegating to ghEmit — no live fork write.
    assert.throws(
      () => E.armedEmit({ draft: { repo: 'owner/repo', issueRef: 42, diff: 'd' }, token: FAKE_CUSTODY, ghConfigDir: cfg, approvalHash: 'h', forkRepo: 'botacct/repo', expectedForkOwner: 'botacct' }),
      /object-sharing-unprobed|recorded object-sharing probe/,
    );
    assert.strictEqual(seen, null, 'the H1 gate refused BEFORE delegating to ghEmit (no live fork write reached the seam)');
    // the F-W1 default (no fork args) is NOT gated => threads undefined to ghEmit (byte-identical same-owner).
    E.armedEmit({ draft: { repo: 'owner/repo', issueRef: 42, diff: 'd' }, token: FAKE_CUSTODY, ghConfigDir: cfg, approvalHash: 'h' });
    assert.strictEqual(seen.forkRepo, undefined, 'the F-W1 default leaves forkRepo undefined (ungated — threads through)');
    assert.strictEqual(seen.expectedForkOwner, undefined, 'the F-W1 default leaves expectedForkOwner undefined');
    assert.ok(seen.env && typeof seen.env === 'object', 'the sanitized env is still built + forwarded on the default path');
    // F-W2b leg-(b) (VALIDATE honesty LOW) — a POPULATED requestedBaseSha (no forkRepo => H1 does not fire) threads
    // through the REAL armedEmit into the ghEmit args (the inner emit-pr.js -> ghEmit forward — otherwise the
    // production emitPR->armedEmit->ghEmit chain's middle leg was inspection-verified only; a dropped forward here
    // would be caught only by the un-exercised live-network path).
    seen = null;
    E.armedEmit({ draft: { repo: 'owner/repo', issueRef: 42, diff: 'd' }, token: FAKE_CUSTODY, ghConfigDir: cfg, approvalHash: 'h', requestedBaseSha: 'a'.repeat(40) });
    assert.strictEqual(seen.requestedBaseSha, 'a'.repeat(40), 'a populated requestedBaseSha threads through the REAL armedEmit -> ghEmit (D2 leg-b)');
  } finally { ghMod.ghEmit = realGhEmit; fs.rmSync(cfg, { recursive: true, force: true }); }
});

// An "armed" custody (killswitch OFF + token + LIVE disposition + an empty approvals dir). The 4th AND — a
// per-emission approval — is minted per-test via recordApproval so we prove BOTH the awaiting + the approved paths.
function armedCustody(dir) {
  fs.writeFileSync(path.join(dir, 'killswitch'), 'ARMED');
  fs.writeFileSync(path.join(dir, 'token'), FAKE_CUSTODY);
  fs.writeFileSync(path.join(dir, 'disposition'), JSON.stringify({ mode: 'live', draft: false }));
  fs.writeFileSync(path.join(dir, 'verify.pem'), KP.publicKeyPem);       // ③.2.5a — the custody-pinned broker verify key
  fs.mkdirSync(path.join(dir, 'approvals'));
  return {
    killswitchPath: path.join(dir, 'killswitch'), custodyTokenPath: path.join(dir, 'token'),
    custodyDispositionPath: path.join(dir, 'disposition'), custodyApprovalsDir: path.join(dir, 'approvals'),
    custodyVerifyKeyPath: path.join(dir, 'verify.pem'),
    lockPath: path.join(dir, 'lock'), now: 1000, ttlMs: 1000000, selfUid: SELF_UID,
  };
}
// The minimal axiom emitPR hashes for goodData() (GOOD_DIFF has no secrets => scrubbed == raw); SIGNED (③.2.5a).
function mintApprovalFor(opts) {
  return S.recordApproval(opts.custodyApprovalsDir, { repo: 'owner/repo', issueRef: 42, diff: GOOD_DIFF }, { now: opts.now, nonce: 'n-test', selfUid: SELF_UID, signFn: SIGN });
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

test('EC1b.5a2 armed + a VALID signed approval but NO custody verify-key => awaiting-approval (③.2.5a fail-closed; F2)', () => {
  const dir = scratch('loom-custody-');
  try {
    withKillswitchEnvCleared(() => {
      const opts = armedCustody(dir);
      mintApprovalFor(opts);                                              // a genuinely signed approval exists
      // ...but the verify key is unresolvable -> the gate cannot establish provenance -> awaiting-approval.
      for (const bad of [undefined, path.join(dir, 'no-such.pem')]) {
        const r = E.emitPR(goodData(), Object.assign({}, opts, { custodyVerifyKeyPath: bad }));
        assert.strictEqual(r.ok, true); assert.strictEqual(r.emitted, false);
        assert.strictEqual(r.reason, 'awaiting-approval', `absent/missing verify key (${bad}) => awaiting-approval`);
      }
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('EC1b.5a3 armed + an UNSIGNED or WRONG-KEY approval planted in custody => awaiting-approval (the sig gates at the emit chokepoint; honesty-H1)', () => {
  const dir = scratch('loom-custody-');
  try {
    withKillswitchEnvCleared(() => {
      const opts = armedCustody(dir);
      const approvalHash = E.emitPR(goodData(), opts).approvalHash;       // the awaiting result surfaces the hash
      const file = path.join(opts.custodyApprovalsDir, approvalHash + '.approved');
      const emission = { repo: 'owner/repo', issueRef: 42, diff: GOOD_DIFF };
      // (a) an UNSIGNED ③.2.4-shape approval
      fs.writeFileSync(file, JSON.stringify({ hash: approvalHash, emission, approvedAt: opts.now, nonce: 'n' }), { flag: 'wx' });
      assert.strictEqual(E.emitPR(goodData(), opts).reason, 'awaiting-approval', 'unsigned approval does NOT pass the gate');
      fs.unlinkSync(file);
      // (b) a WRONG-KEY signed approval (signed by an attacker key the custody pin does not trust)
      const attacker = generateEdgeKeypair();
      const basis = require(path.join(REPO, 'packages', 'kernel', 'egress', 'approval.js')).approvalSigBasis({ hash: approvalHash, approvedAt: opts.now, nonce: 'n', key_id: 'v0' });
      const sig = signRecordId(basis, { privateKeyPem: attacker.privateKeyPem });
      fs.writeFileSync(file, JSON.stringify({ hash: approvalHash, emission, approvedAt: opts.now, nonce: 'n', sig, key_id: 'v0' }), { flag: 'wx' });
      assert.strictEqual(E.emitPR(goodData(), opts).reason, 'awaiting-approval', 'a wrong-key sig does NOT pass the gate');
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('EC1b.5b armed + a VALID approval but a THROWING seam => fail-closed; cap+ledger+approval UNCHANGED (I2 reservation-fold)', () => {
  const dir = scratch('loom-custody-');
  try {
    withKillswitchEnvCleared(() => {
      const opts = Object.assign(armedCustody(dir), { custodyCapStatePath: path.join(dir, 'cap.json'), custodyEtiquetteLedgerPath: path.join(dir, 'ledger') });
      const { hash } = mintApprovalFor(opts);
      // ③.2.5c — the seam is now ARMED (the real armedEmit fail-closed on a missing env is EC1b.5; the live
      // network path is gh-emit.test.js). HERE we prove the I2 reservation-fold is seam-IMPLEMENTATION-INDEPENDENT:
      // ANY seam throw => the outer catch => fail-closed with cap+ledger UNWRITTEN and the approval UN-consumed.
      const r = E.emitPR(goodData(), Object.assign({}, opts, { armedEmitFn: () => { throw new Error('seam-blew-up'); } }));
      assert.strictEqual(r.ok, false, 'a throwing seam fails closed even with a valid approval');
      assert.strictEqual(r.emitted, false);
      assert.ok(/seam-blew-up/.test(r.reason), `the seam error surfaces as the reason (got ${r.reason})`);
      // emit-then-record: a throwing emit leaves the cap + ledger UNWRITTEN and the approval UN-consumed.
      assert.strictEqual(fs.existsSync(opts.custodyCapStatePath), false, 'cap state never written (reservation fold)');
      assert.strictEqual(fs.existsSync(opts.custodyEtiquetteLedgerPath), false, 'ledger never written');
      assert.strictEqual(S.readVerifiedApproval(opts.custodyApprovalsDir, hash, { now: opts.now, ttlMs: opts.ttlMs, selfUid: SELF_UID, verifyKeyPem: KP.publicKeyPem }).ok, true, 'approval NOT consumed by a failed emit');
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
      let emitCalls = 0; let seen = null;
      const r = E.emitPR(goodData(), Object.assign({}, opts, { armedEmitFn: (a) => { emitCalls += 1; seen = a; return { pr_url: 'https://example/pr/1' }; } }));
      assert.strictEqual(emitCalls, 1, 'armedEmitFn invoked exactly once');
      // ③.2.5c CRITICAL-2 — the gate THREADS its independently-computed approvalHash into the seam (so gh-emit's
      // self-check has a value to cross-check against; re-hashing the same draft would be a tautology).
      assert.ok(seen && /^[a-f0-9]{64}$/.test(seen.approvalHash), 'the seam receives a 64-hex approvalHash');
      assert.strictEqual(seen.approvalHash, r.approvalHash, 'the threaded approvalHash === the surfaced one');
      assert.ok(seen.draft && seen.draft.diff && typeof seen.token === 'string', 'the seam receives the draft + token');
      assert.strictEqual(r.ok, true); assert.strictEqual(r.emitted, true, 'valid approval + succeeding emit => emitted');
      assert.deepStrictEqual(r.pr, { pr_url: 'https://example/pr/1' });
      assert.strictEqual(fs.existsSync(opts.custodyCapStatePath), true, 'cap recorded AFTER the successful emit');
      assert.strictEqual(fs.existsSync(opts.custodyEtiquetteLedgerPath), true, 'ledger recorded AFTER the successful emit');
      assert.strictEqual(S.readVerifiedApproval(opts.custodyApprovalsDir, hash, { now: opts.now, ttlMs: opts.ttlMs, selfUid: SELF_UID, verifyKeyPem: KP.publicKeyPem }).ok, false, 'approval consumed (one-shot)');
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// === F-W4 M2 — expectedForkOwner from a custody file (Q-M2=c) — the resolveExpectedForkOwner reader + dormant thread ===
// (the deny-list for `custodyForkOwnerPath` is covered by EC1b.3 above, which iterates E.DISPOSITION_KEYS.)

test('F-W4 M2 reader: non-string / absent / unreadable / empty => STRICT undefined, never null (the P1a dormancy contract)', () => {
  const dir = scratch('loom-fw4m2-');
  try {
    // non-string path = the prod-dormant case (opts.custodyForkOwnerPath is undefined)
    assert.strictEqual(E.resolveExpectedForkOwner({}), undefined, 'no path => undefined');
    assert.strictEqual(E.resolveExpectedForkOwner({ custodyForkOwnerPath: 123 }), undefined, 'non-string path => undefined');
    // absent file
    assert.strictEqual(E.resolveExpectedForkOwner({ custodyForkOwnerPath: path.join(dir, 'nope') }), undefined, 'absent => undefined');
    // unreadable: a directory as the path => readFileSync throws EISDIR => caught => undefined
    assert.strictEqual(E.resolveExpectedForkOwner({ custodyForkOwnerPath: dir }), undefined, 'unreadable (dir) => undefined');
    // empty + whitespace-only
    const empty = path.join(dir, 'empty'); fs.writeFileSync(empty, '');
    const ws = path.join(dir, 'ws'); fs.writeFileSync(ws, '   \n\t ');
    assert.strictEqual(E.resolveExpectedForkOwner({ custodyForkOwnerPath: empty }), undefined, 'empty => undefined');
    assert.strictEqual(E.resolveExpectedForkOwner({ custodyForkOwnerPath: ws }), undefined, 'whitespace-only => undefined');
    // P1a REGRESSION (load-bearing): the return is the PRIMITIVE undefined, NOT null. validateForkIdentity:500 gates
    // on `!== undefined`, and null !== undefined is TRUE => a null return would brick the dormant (non-fork) prod path.
    assert.notStrictEqual(E.resolveExpectedForkOwner({ custodyForkOwnerPath: empty }), null, 'absent branch returns undefined, NOT null');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('F-W4 M2 reader: a VALID login => the trimmed value (casing preserved; digit-only + 39-char boundary accepted)', () => {
  const dir = scratch('loom-fw4m2-');
  try {
    const f = path.join(dir, 'owner');
    fs.writeFileSync(f, 'LoomBot\n');
    assert.strictEqual(E.resolveExpectedForkOwner({ custodyForkOwnerPath: f }), 'LoomBot', 'casing preserved, trailing newline trimmed');
    fs.writeFileSync(f, '0');            // GitHub permits a digit-only owner (see OWNER_RE comment)
    assert.strictEqual(E.resolveExpectedForkOwner({ custodyForkOwnerPath: f }), '0');
    fs.writeFileSync(f, 'a-b');          // single internal hyphen ok
    assert.strictEqual(E.resolveExpectedForkOwner({ custodyForkOwnerPath: f }), 'a-b');
    fs.writeFileSync(f, 'a'.repeat(39)); // exactly the 39-char login max => valid
    assert.strictEqual(E.resolveExpectedForkOwner({ custodyForkOwnerPath: f }), 'a'.repeat(39), '39 chars is the inclusive boundary');
    fs.writeFileSync(f, '\uFEFFLoomBot'); // a LEADING BOM: U+FEFF IS ECMAScript WhiteSpace, so .trim() strips it =>
    assert.strictEqual(E.resolveExpectedForkOwner({ custodyForkOwnerPath: f }), 'LoomBot', 'a leading BOM is trimmed to the clean login (tolerant of an editor artifact; safe — the trimmed value has no BOM to inject)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('F-W4 M2 reader: PRESENT-but-malformed => STRICT undefined + OBSERVABLE fork-owner-custody-invalid alert (incl. 40-char valid-shape [M1] + BOM)', () => {
  const dir = scratch('loom-fw4m2-');
  try {
    const f = path.join(dir, 'owner');
    // owner/repo (slash), bad char, leading/trailing hyphen, space, consecutive hyphens, dot, a 40-char valid-SHAPE
    // login (OWNER_RE is length-blind — hacker M1), an EMBEDDED-BOM login (a MID-string U+FEFF survives .trim() and
    // fails OWNER_RE — the fail-closed case; a LEADING BOM is instead stripped by .trim() to a clean login, see the
    // valid-login test — the code-reviewer F5 "trim doesn't strip a BOM" claim was empirically wrong), an argv-injection attempt.
    const bad = ['owner/repo', 'bad*char', '-lead', 'trail-', 'a b', 'a--b', 'o.w', 'a'.repeat(40), 'Loom\uFEFFBot', 'attacker:x&state=all'];
    for (const v of bad) {
      fs.writeFileSync(f, v);
      const { value, alerts } = captureAlerts(() => E.resolveExpectedForkOwner({ custodyForkOwnerPath: f }));
      assert.strictEqual(value, undefined, `malformed ${JSON.stringify(v)} => undefined`);
      assert.notStrictEqual(value, null, `malformed ${JSON.stringify(v)} => undefined NOT null (P1a on the malformed branch — hacker M3)`);
      assert.ok(/fork-owner-custody-invalid/.test(alerts), `malformed ${JSON.stringify(v)} => the exact custody-invalid alert fires`);
    }
    // PIN the no-raw-value-echo contract (VC-W2a M2 lesson): a distinctive hostile value must NOT appear in the alert.
    fs.writeFileSync(f, 'EVILINJECTMARKER*x');
    const { alerts } = captureAlerts(() => E.resolveExpectedForkOwner({ custodyForkOwnerPath: f }));
    assert.ok(!alerts.includes('EVILINJECTMARKER'), 'the alert carries the path + length only, never the raw malformed value');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('F-W4 M2 reader: a MULTI-MB all-alnum custody file => undefined + alert, NEVER a thrown RangeError (VALIDATE-hacker M1: the length cap MUST precede OWNER_RE)', () => {
  const dir = scratch('loom-fw4m2-');
  try {
    const f = path.join(dir, 'owner');
    // 12 MB of 'a' — over the ~8.4 MB threshold at which OWNER_RE's `(?:-?[A-Za-z0-9])*` stack-overflows. With the
    // length-cap-first order the regex never runs on it (short-circuit), so the reader returns undefined, never throws.
    fs.writeFileSync(f, Buffer.alloc(12 * 1024 * 1024, 0x61));
    let threw = null; let value;
    const { alerts } = captureAlerts(() => { try { value = E.resolveExpectedForkOwner({ custodyForkOwnerPath: f }); } catch (e) { threw = e; } });
    assert.strictEqual(threw, null, 'the reader must NOT throw (the cap short-circuits before OWNER_RE sees the huge string — the never-throws contract)');
    assert.strictEqual(value, undefined, 'an over-length file => undefined');
    assert.ok(/fork-owner-custody-invalid/.test(alerts), 'the over-length reject stays observable');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('F-W4 M2 DORMANCY: emitPR with NO custodyForkOwnerPath threads expectedForkOwner===undefined (key PRESENT + undefined; byte-identical, no throw)', () => {
  const dir = scratch('loom-custody-');
  try {
    withKillswitchEnvCleared(() => {
      const opts = armedCustody(dir);
      mintApprovalFor(opts);
      let seen = null;
      const r = E.emitPR(goodData(), Object.assign({}, opts, { armedEmitFn: (a) => { seen = a; return { pr_url: 'x' }; } }));
      assert.strictEqual(r.emitted, true, 'the dormant thread does not break a normal emit');
      assert.ok('expectedForkOwner' in seen, 'the seam arg CARRIES the key (explicit-undefined is identical to omission only under destructuring — architect F2)');
      assert.strictEqual(seen.expectedForkOwner, undefined, 'no custody file => undefined => validateForkIdentity:500 skipped => non-fork path unaffected');
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('F-W4 M2 ARMED-THREAD: emitPR WITH a valid custodyForkOwnerPath threads that login as expectedForkOwner', () => {
  const dir = scratch('loom-custody-');
  try {
    withKillswitchEnvCleared(() => {
      const opts = armedCustody(dir);
      mintApprovalFor(opts);
      const ownerFile = path.join(dir, 'fork-owner'); fs.writeFileSync(ownerFile, 'loombot\n');
      let seen = null;
      E.emitPR(goodData(), Object.assign({}, opts, { custodyForkOwnerPath: ownerFile, armedEmitFn: (a) => { seen = a; return { pr_url: 'x' }; } }));
      assert.strictEqual(seen.expectedForkOwner, 'loombot', 'the custody login reaches the seam (arming supplies BOTH this + forkRepo)');
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

test('EC1b.5e partial-commit residual: a SUCCEEDING emit whose recordEmit then throws => ok:false + approval NOT consumed (③.2.5c: the DUPLICATE-PR risk is closed by dedup; the bookkeeping drift is the bounded residual)', () => {
  const dir = scratch('loom-custody-');
  try {
    withKillswitchEnvCleared(() => {
      // a cap path in a NON-existent subdir => recordEmit's writeAtomic ENOENT-throws AFTER the (injected) emit succeeded.
      const opts = Object.assign(armedCustody(dir), { custodyCapStatePath: path.join(dir, 'no-such-subdir', 'cap.json') });
      const { hash } = mintApprovalFor(opts);
      const r = E.emitPR(goodData(), Object.assign({}, opts, { armedEmitFn: () => ({ pr_url: 'https://example/pr/9' }) }));
      // The post-network record ordering is UNCHANGED (emit-then-record): a record throw still surfaces as ok:false
      // and leaves the approval un-consumed. ③.2.5c does NOT change THIS path — instead it makes a RETRY safe at the
      // gh-emit layer: the branch name is deterministic from approvalHash, so a re-emit of the SAME approved content
      // hits a 422 "Reference already exists" and (a) DEDUP-RECONCILES to the matching OPEN loom PR if one exists, or
      // (b) FAILS CLOSED (ref-exists-no-open-pr) rather than auto-creating on a pre-existing branch. So the
      // DUPLICATE-OPEN-PR harm is closed; the residual is (i) the cap/ledger bookkeeping drift on a post-network
      // record failure and (ii) an orphan tree+commit object created before the ref step on each retry — both bounded
      // by the per-window cap + the human gate (NOT a duplicate PR).
      assert.strictEqual(r.ok, false, 'a post-emit record throw surfaces as ok:false (the bookkeeping residual)');
      assert.strictEqual(S.readVerifiedApproval(opts.custodyApprovalsDir, hash, { now: opts.now, ttlMs: opts.ttlMs, selfUid: SELF_UID, verifyKeyPem: KP.publicKeyPem }).ok, true, 'the approval is NOT consumed when the post-emit record throws (a retry 422-dedups to the existing PR)');
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('EC1b.5 killswitch default-ON: absent custody => killswitch on => token null (capability removed)', () => {
  assert.strictEqual(E.isKillswitchOn({}), true, 'no killswitchPath => ON (fail-closed)');
  assert.strictEqual(E.resolveToken({ killswitchOn: true, custodyTokenPath: '/whatever' }), null, 'killswitch on => no token');
});

// === VC-W1b — the DORMANT post-emit injected-verifier SEAM (QUALITY, not TRUST; fail-open, discard-the-verdict) ===
// A verifier is injected as opts.verifyFn (like armedEmitFn, K12 lab-agnostic); prod injects none => byte-identical.
// The seam sits AFTER a successful, non-deduped emit (the additive join-key position): it grades a candidate that
// actually SHIPPED, on the emitted pr.base_sha. Advisory: it NEVER alters/blocks/reverts the emit; a throw/rejection
// is swallowed; the verdict is discarded (reads nothing back). Inputs are the SCRUBBED/normalized draft.* + pr.base_sha.

// A live+approved emit whose mock armedEmitFn returns a non-deduped pr with a known base_sha; extraOpts injects verifyFn.
function liveApprovedEmit(dir, extraOpts) {
  const opts = armedCustody(dir);
  mintApprovalFor(opts);
  const base = 'b'.repeat(40);
  const armedEmitFn = () => ({ pr_url: 'https://example/pr/1', number: 7, branch: 'loom/x', base_sha: base });
  const r = E.emitPR(goodData(), Object.assign({}, opts, { armedEmitFn }, extraOpts || {}));
  return { r, base };
}

test('VC-W1b dormant: a live+approved emit with NO verifyFn emits normally (the seam is skipped => byte-identical)', () => {
  const dir = scratch('loom-custody-');
  try { withKillswitchEnvCleared(() => {
    const { r } = liveApprovedEmit(dir);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.emitted, true, 'no verifyFn => the emit proceeds unchanged');
  }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('VC-W1b seam fires POST-emit: an injected verifyFn is called ONCE with {repo, issueRef, base_sha=pr.base_sha, candidate_patch=draft.diff, approvalHash}', () => {
  const dir = scratch('loom-custody-');
  try { withKillswitchEnvCleared(() => {
    let seen = null; let calls = 0;
    const { r, base } = liveApprovedEmit(dir, { verifyFn: (v) => { calls += 1; seen = v; } });
    assert.strictEqual(r.emitted, true);
    assert.strictEqual(calls, 1, 'verifyFn called EXACTLY once on a shipped, non-deduped emit');
    assert.strictEqual(seen.repo, 'owner/repo', 'repo === the normalized draft.repo');
    assert.strictEqual(seen.issueRef, 42, 'issueRef === the draft issueRef');
    assert.strictEqual(seen.base_sha, base, 'base_sha === the EMITTED pr.base_sha (the base the PR opened against)');
    assert.strictEqual(seen.candidate_patch, r.draft.diff, 'candidate_patch === the SCRUBBED draft.diff (never raw data)');
    assert.strictEqual(seen.approvalHash, r.approvalHash, 'approvalHash === the candidate identity (the sidecar join)');
  }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('VC-W1b fail-open (sync throw): a verifyFn that throws synchronously => the emit STILL succeeds, no throw escapes', () => {
  const dir = scratch('loom-custody-');
  try { withKillswitchEnvCleared(() => {
    const { r } = liveApprovedEmit(dir, { verifyFn: () => { throw new Error('verify-blew-up'); } });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.emitted, true, 'a QUALITY verify throw NEVER blocks a human-approved emit');
  }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('VC-W1b fail-open (async): the seam passes a REJECTION handler to a thenable verifyFn result (an async rejection is swallowed, never unhandled)', () => {
  const dir = scratch('loom-custody-');
  try { withKillswitchEnvCleared(() => {
    let onRejectedIsFn = null;
    const thenable = { then: (_onF, onR) => { onRejectedIsFn = typeof onR === 'function'; } };
    const { r } = liveApprovedEmit(dir, { verifyFn: () => thenable });
    assert.strictEqual(r.emitted, true, 'a thenable-returning verifyFn does not block the emit');
    assert.strictEqual(onRejectedIsFn, true, 'the seam calls .then(onF, onRejected) => the async rejection is swallowed');
  }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('VC-W1b non-altering + discard: a verifyFn returning a poison verdict is IGNORED (the emit result + pr unchanged; the verdict never leaks)', () => {
  const dir = scratch('loom-custody-');
  try { withKillswitchEnvCleared(() => {
    const poison = { passed: false, result_class: 'HIJACK' };
    const { r } = liveApprovedEmit(dir, { verifyFn: () => poison });
    assert.strictEqual(r.emitted, true);
    assert.strictEqual(r.pr && r.pr.pr_url, 'https://example/pr/1', 'the emit result pr is the ARMED emit pr, never the verify verdict');
    assert.ok(!('verify' in r) && !('verdict' in r), 'the verify verdict is DISCARDED — never on the emit result (the seam reads nothing back)');
  }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('VC-W1b only-on-shipped: verifyFn is NOT called on the awaiting-approval path (no emit => no candidate to verify)', () => {
  const dir = scratch('loom-custody-');
  try { withKillswitchEnvCleared(() => {
    let calls = 0;
    const opts = armedCustody(dir);   // NO approval minted => awaiting-approval
    const r = E.emitPR(goodData(), Object.assign({}, opts, { armedEmitFn: () => ({ pr_url: 'x' }), verifyFn: () => { calls += 1; } }));
    assert.strictEqual(r.emitted, false);
    assert.strictEqual(r.reason, 'awaiting-approval');
    assert.strictEqual(calls, 0, 'no emit => verifyFn NOT called');
  }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('VC-W1b only-on-shipped: verifyFn is NOT called when the emit DEDUPED (pr.deduped => the candidate was verified on the original emit)', () => {
  const dir = scratch('loom-custody-');
  try { withKillswitchEnvCleared(() => {
    let calls = 0;
    const opts = armedCustody(dir); mintApprovalFor(opts);
    const r = E.emitPR(goodData(), Object.assign({}, opts, { armedEmitFn: () => ({ pr_url: 'x', number: 7, deduped: true, base_sha: 'c'.repeat(40) }), verifyFn: () => { calls += 1; } }));
    assert.strictEqual(r.emitted, true);
    assert.strictEqual(calls, 0, 'a deduped emit does NOT re-verify (mirrors the join-key !pr.deduped guard)');
  }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('VC-W1b scrubbed-not-raw (hacker M3): verifyFn gets the SCRUBBED draft.diff, never the raw data.diff (no secret leak into the new sink)', () => {
  const dir = scratch('loom-custody-');
  try { withKillswitchEnvCleared(() => {
    const secret = `github_pat_${'a'.repeat(82)}`;
    const rawDiff = `diff --git a/c.py b/c.py\n--- a/c.py\n+++ b/c.py\n@@ -0,0 +1 @@\n+token = "${secret}"\n`;
    const opts = armedCustody(dir);
    const pending = E.emitPR(goodData({ diff: rawDiff }), opts);   // awaiting => surfaces the scrubbed draft
    assert.strictEqual(pending.emitted, false);
    assert.notStrictEqual(pending.draft.diff, rawDiff, 'scrub changed the bytes (the secret was redacted)');
    // mint the approval for the SCRUBBED draft (the minimal-set axiom hashes the scrubbed diff).
    S.recordApproval(opts.custodyApprovalsDir, { repo: 'owner/repo', issueRef: 42, diff: pending.draft.diff }, { now: opts.now, nonce: 'n-test', selfUid: SELF_UID, signFn: SIGN });
    let seen = null;
    const r = E.emitPR(goodData({ diff: rawDiff }), Object.assign({}, opts, { armedEmitFn: () => ({ pr_url: 'x', number: 7, base_sha: 'b'.repeat(40) }), verifyFn: (v) => { seen = v; } }));
    assert.strictEqual(r.emitted, true, 'the (scrubbed) candidate emits');
    assert.strictEqual(seen.candidate_patch, r.draft.diff, 'candidate_patch === the SCRUBBED draft.diff');
    assert.notStrictEqual(seen.candidate_patch, rawDiff, 'candidate_patch is NEVER the raw data.diff');
    assert.ok(!seen.candidate_patch.includes(secret), 'the redacted secret NEVER reaches the verify sink');
  }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('VC-W1b deny-list (hacker L2 + M1): a verifyFn planted in untrusted DATA is fail-closed rejected in ALL spellings (camel/snake/kebab + casings)', () => {
  // the seam reads ONLY opts.verifyFn, so a data-key never reaches it — but the deny-list PROMISES "no policy-shaped
  // key in data", so every spelling must be rejected (hyphen/underscore are distinct own-keys after case-folding).
  for (const k of ['verifyFn', 'verify_fn', 'verify-fn', 'VerifyFn', 'VERIFYFN']) {
    assert.throws(() => E.assertDataIsPolicyFree(goodData({ [k]: () => {} })), /policy key/, `data.${k} is deny-listed`);
    assert.strictEqual(E.emitPR(goodData({ [k]: () => {} })).ok, false, `a poisoned-data ${k} => fail-closed reject`);
  }
});

test('VC-W1b fail-open (async RUNTIME): a REAL rejected-promise verifyFn => emit succeeds + ZERO unhandledRejection events (the swallow is load-bearing)', async () => {
  const dir = scratch('loom-custody-');
  const seen = [];
  const onUnhandled = () => { seen.push(1); };
  process.on('unhandledRejection', onUnhandled);
  try {
    const r = withKillswitchEnvCleared(() => liveApprovedEmit(dir, { verifyFn: () => Promise.reject(new Error('async-verify-fail')) }).r);
    assert.strictEqual(r.emitted, true, 'a real async rejection NEVER blocks the emit');
    await new Promise((res) => setImmediate(res));
    await new Promise((res) => setImmediate(res));
    assert.strictEqual(seen.length, 0, 'the .then(() => {}, () => {}) swallow => ZERO unhandled rejections for a real rejected promise');
  } finally { process.removeListener('unhandledRejection', onUnhandled); fs.rmSync(dir, { recursive: true, force: true }); }
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
  // gap-map item 2, PR-2: gh-verify.js (the merge observer's gh-verifier) spawns `gh api -X GET` for a
  // READ-ONLY merge check using ambient read auth — same class as live-puller.js. It carries the same
  // POSITIVE assertReadOnlyGhArgs GET-gate, emits nothing, and never reads the egress token or git-pushes.
  const READONLY_GH_ALLOW = [
    path.join('packages', 'lab', 'issue-corpus', 'live-puller.js'),
    path.join('packages', 'lab', 'world-anchor', 'gh-verify.js'),
  ];
  // ③.2.5c: gh-emit.js is emit-pr's DEDICATED write-egress DELEGATE — armedEmit (lazily) calls ghEmit ONLY after
  // the full gate (live + token + killswitch-off + signed approval). It is NOT an independent egress path: it
  // receives the sanitized env (with GH_TOKEN already injected by buildEmitEnv) as a PARAMETER, so it is exempt
  // from the GH_SPAWN cap but STILL barred from reading an ambient token (TOKEN_READ) and from git-push.
  const CHOKEPOINT_DELEGATE_ALLOW = [path.join('packages', 'kernel', 'egress', 'gh-emit.js')];
  // require the call form `assertReadOnlyGhArgs(args);` (CodeRabbit #390 Major) — NOT a bare symbol match,
  // which would also accept the function DECLARATION `function assertReadOnlyGhArgs(args) {` and pass the
  // exemption even if the runtime invocation were removed. The lab suite additionally proves defaultGhRunner
  // INVOKES it (live-puller.test.js h3 — a write arg throws before any spawn).
  const GET_GATE = /assertReadOnlyGhArgs\s*\(\s*args\s*\)\s*;/;
  // VALIDATE-hacker M-1: the GET-gate is a POSITIVE check (the gate MUST be present), so it must match the
  // RUNTIME CALL, never a commented-out token. Strip block + line comments before testing GET_GATE, else a
  // `// assertReadOnlyGhArgs(args);` line would satisfy the gate after the real call was removed. We strip
  // comments ONLY (not string literals): a naive string-strip over-consumes JS regex literals and regressed
  // live-puller.js's real gate; the string-literal-satisfies case is contrived and not worth a fragile regex.
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
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
        if (!GET_GATE.test(stripComments(src))) offenders.push(`${rel} (missing assertReadOnlyGhArgs GET-gate)`);
        if (GIT_PUSH.test(src) || TOKEN_READ.test(src)) offenders.push(rel);
        continue;
      }
      if (CHOKEPOINT_DELEGATE_ALLOW.includes(rel)) {
        // the write-egress delegate: exempt from GH_SPAWN; STILL barred from git-push + ambient token reads.
        if (GIT_PUSH.test(src) || TOKEN_READ.test(src)) offenders.push(`${rel} (delegate must not git-push or read an ambient token)`);
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

// === OQ-3 W2 — the lesson_commitment shape gate + the NON-VACUOUS approval round-trip (fold F3/F4) ===

test('OQ-3: lesson_commitment is NOT a disposition key (it is emission-adjacent data, passes assertDataIsPolicyFree)', () => {
  assert.ok(!E.DISPOSITION_KEYS.includes('lesson_commitment'), 'lesson_commitment must NOT be in DISPOSITION_KEYS');
  // a 64-hex commitment in data is ACCEPTED (does not trip the policy-key reject) on the dry-run path.
  const r = E.emitPR(goodData({ lesson_commitment: 'a'.repeat(64) }));
  assert.strictEqual(r.ok, true, r.reason);
});

test('OQ-3: assertSafeLessonCommitment — absent -> ""; 64-hex accepted; non-hex/65-hex/UPPERCASE shape-rejected', () => {
  assert.strictEqual(E.assertSafeLessonCommitment(undefined), '', 'absent/undefined is the only no-lesson coercion');
  assert.throws(() => E.assertSafeLessonCommitment(null), /lesson_commitment/, 'explicit null is rejected (a malformed actor value, not laundered to "")');
  assert.strictEqual(E.assertSafeLessonCommitment(''), '', 'explicit "" stays ""');
  assert.strictEqual(E.assertSafeLessonCommitment('a'.repeat(64)), 'a'.repeat(64), '64-hex accepted');
  for (const bad of ['not-hex', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 5, {}]) {
    assert.throws(() => E.assertSafeLessonCommitment(bad), /lesson_commitment/, `${JSON.stringify(bad)} rejected`);
  }
});

test('OQ-3: a non-hex lesson_commitment in data is shape-rejected end-to-end (fail-closed)', () => {
  const r = E.emitPR(goodData({ lesson_commitment: 'A'.repeat(64) }));   // UPPERCASE -> rejected
  assert.strictEqual(r.ok, false);
  assert.ok(/lesson_commitment/.test(r.reason), `the UPPERCASE commitment is rejected (got ${r.reason})`);
});

// A SIGNED approval minted with a specific lesson_commitment (mirrors mintApprovalFor; the gate pins KP.publicKeyPem).
function mintApprovalWithLesson(opts, lessonCommitment) {
  return S.recordApproval(opts.custodyApprovalsDir, { repo: 'owner/repo', issueRef: 42, diff: GOOD_DIFF },
    { now: opts.now, nonce: 'n-test', selfUid: SELF_UID, signFn: SIGN, lesson_commitment: lessonCommitment });
}

test('OQ-3 NON-VACUOUS: a REAL approval bound to commitment X + data.lesson_commitment=X => emitted:true; =Y => awaiting-approval + approvalReason surfaced', () => {
  const dir = scratch('loom-custody-');
  const X = 'a1'.repeat(32);   // a 64-hex commitment
  const Y = 'b2'.repeat(32);
  try {
    withKillswitchEnvCleared(() => {
      const opts = armedCustody(dir);
      mintApprovalWithLesson(opts, X);                                    // a genuinely signed approval binding X
      // (a) the MATCHING commitment + an injected succeeding seam => a real emit.
      let seen = null;
      const okR = E.emitPR(goodData({ lesson_commitment: X }), Object.assign({}, opts, { armedEmitFn: (a) => { seen = a; return { pr_url: 'https://example/pr/1', number: 1, base_sha: 'abc' }; } }));
      assert.strictEqual(okR.emitted, true, 'matching commitment => emitted (got ' + okR.reason + '/' + okR.approvalReason + ')');
      assert.ok(seen, 'the armed seam was reached');
      // (b) the SAME approval but a SWAPPED data commitment => the gate refuses (no emit) + surfaces the mismatch.
      mintApprovalWithLesson(opts, X);                                    // re-mint (the prior was one-shot consumed)
      let seamCalls = 0;
      const noR = E.emitPR(goodData({ lesson_commitment: Y }), Object.assign({}, opts, { armedEmitFn: () => { seamCalls += 1; return { pr_url: 'x', number: 2 }; } }));
      assert.strictEqual(noR.emitted, false, 'a swapped commitment does NOT emit');
      assert.strictEqual(noR.reason, 'awaiting-approval', 'the outer reason is unchanged');
      assert.strictEqual(noR.approvalReason, 'lesson-commitment-mismatch', 'fold F3: the underlying mismatch is surfaced for debugging');
      assert.strictEqual(seamCalls, 0, 'the seam was NEVER reached on a swapped commitment (fail-closed before emit)');
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// === F-W2b — the requestedBaseSha threads from the VERIFIED approval body through armedEmit -> ghEmit (D2) ===

// mint an approval carrying a populated requestedBaseSha (signed over the 6-field basis by recordApproval).
function mintApprovalWithBase(opts, baseSha) {
  return S.recordApproval(opts.custodyApprovalsDir, { repo: 'owner/repo', issueRef: 42, diff: GOOD_DIFF },
    { now: opts.now, nonce: 'n-test', selfUid: SELF_UID, signFn: SIGN, requestedBaseSha: baseSha });
}

test('F-W2b (D2): emitPR reads appr.body.requestedBaseSha and passes it THROUGH armedEmit -> ghEmit (END-TO-END, the live-path assertion)', () => {
  const dir = scratch('loom-custody-');
  const BASE = 'a'.repeat(40);
  try {
    withKillswitchEnvCleared(() => {
      const opts = armedCustody(dir);
      mintApprovalWithBase(opts, BASE);                                   // a REAL signed approval binding BASE
      let seen = null;
      // the PRODUCTION emitPR -> armedEmitFn call must forward the verified body's requestedBaseSha (fold D2c). If
      // the :534 call omits it, this stub receives undefined and the gate is silently DEAD on the only live path.
      const r = E.emitPR(goodData(), Object.assign({}, opts, { armedEmitFn: (a) => { seen = a; return { pr_url: 'https://example/pr/1', number: 1, base_sha: BASE }; } }));
      assert.strictEqual(r.emitted, true, 'the emit fired (got ' + r.reason + '/' + r.approvalReason + ')');
      assert.ok(seen, 'the armed seam was reached');
      assert.strictEqual(seen.requestedBaseSha, BASE, 'emitPR forwarded the verified body requestedBaseSha to armedEmit (the D2 dead-guard)');
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('F-W2b (D2): a no-base ("") approval threads "" (the dormant default, byte-identical live path)', () => {
  const dir = scratch('loom-custody-');
  try {
    withKillswitchEnvCleared(() => {
      const opts = armedCustody(dir);
      mintApprovalFor(opts);                                             // a no-base ('') approval
      let seen = null;
      E.emitPR(goodData(), Object.assign({}, opts, { armedEmitFn: (a) => { seen = a; return { pr_url: 'x', number: 1, base_sha: 'b'.repeat(40) }; } }));
      assert.strictEqual(seen.requestedBaseSha, '', 'the dormant "" sentinel is threaded (no moved-base gate fires downstream)');
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('F-W2b (D8): the base-sha/identity vocabulary is in the data deny-list (actor cannot inject requestedBaseSha via data)', () => {
  for (const k of ['requestedBaseSha', 'requested_base_sha', 'requested-base-sha', 'baseSha', 'base_sha', 'base-sha']) {
    assert.ok(E.DISPOSITION_KEYS.includes(k), `${k} must be a declared disposition key`);
    const r = E.emitPR(goodData({ [k]: 'a'.repeat(40) }));
    assert.strictEqual(r.ok, false, `data.${k} rejected end-to-end`);
    assert.ok(/policy key/.test(r.reason), `data.${k} names the policy-key rejection (got ${r.reason})`);
  }
  // casing variants collapse via the case-fold in assertDataIsPolicyFree.
  for (const k of ['REQUESTEDBASESHA', 'RequestedBaseSha', 'BASESHA', 'Base_Sha']) {
    assert.throws(() => E.assertDataIsPolicyFree(goodData({ [k]: 'x' })), /policy key/, `data.${k} rejected (case-folded)`);
  }
});

// === ③.2.4 — the per-emission approval gate riders (H5 normalize-once + H7 deny-list completeness) ===

test('③.2.4 H7 + ③.2.5a: the full approval + signing vocabulary is in the data deny-list (actor cannot inject approval/custody/verify-key keys)', () => {
  for (const k of ['approval', 'approvalHash', 'approved', 'emission', 'approvedAt', 'nonce', 'custodyApprovalsDir', 'custodyApprovalsPath', 'ttlMs', 'selfUid', 'armedEmitFn',
    'sig', 'key_id', 'keyId', 'signFn', 'verifyKeyPem', 'verifyKey', 'publicKeyPem', 'custodyVerifyKeyPath']) {
    assert.ok(E.DISPOSITION_KEYS.includes(k), `${k} must be a declared disposition key`);
    const r = E.emitPR(goodData({ [k]: 'x' }));
    assert.strictEqual(r.ok, false, `data.${k} rejected end-to-end`);
    assert.ok(/policy key/.test(r.reason), `data.${k} names the policy-key rejection (got ${r.reason})`);
  }
});

test('F-W1 (M-1): the fork/identity vocabulary is in the data deny-list (actor cannot inject a fork/head/base repo)', () => {
  for (const k of ['forkRepo', 'fork_repo', 'fork-repo', 'forkOwner', 'fork_owner', 'upstreamRepo', 'upstream_repo',
    'expectedForkOwner', 'expected_fork_owner', 'forkName', 'headRepo', 'head_repo', 'baseRepo', 'base_repo',
    'sourceRepo', 'source_repo']) {
    assert.ok(E.DISPOSITION_KEYS.includes(k), `${k} must be a declared disposition key`);
    const r = E.emitPR(goodData({ [k]: 'attacker/evil' }));
    assert.strictEqual(r.ok, false, `data.${k} rejected end-to-end`);
    assert.ok(/policy key/.test(r.reason), `data.${k} names the policy-key rejection (got ${r.reason})`);
  }
  // casing variants collapse via the case-fold at :204 (assertDataIsPolicyFree lowercases every own key).
  for (const k of ['FORKREPO', 'ForkRepo', 'FORKOWNER', 'ExpectedForkOwner']) {
    assert.throws(() => E.assertDataIsPolicyFree(goodData({ [k]: 'x' })), /policy key/, `data.${k} rejected (case-folded)`);
  }
});

test('F-W1: OWNER_RE is exported (gh-emit imports it to re-validate a distinct forkOwner at the sink — C-1)', () => {
  assert.ok(E.OWNER_RE instanceof RegExp, 'OWNER_RE is an exported RegExp');
  assert.ok(E.OWNER_RE.test('botacct') && E.OWNER_RE.test('0'), 'a valid login (incl. digit-only) matches');
  assert.ok(!E.OWNER_RE.test('-evil') && !E.OWNER_RE.test('o.w') && !E.OWNER_RE.test('a_b') && !E.OWNER_RE.test('a--b'),
    'leading-hyphen / dotted / underscored / double-hyphen owners are rejected');
});

test('③.2.4 H5: draft.repo is the NORMALIZED canonical (a .git / case input collapses to owner/repo)', () => {
  for (const input of ['Owner/Repo', 'Owner/Repo.git', 'owner/repo']) {
    const r = E.emitPR(goodData({ repo: input }));
    assert.strictEqual(r.ok, true, `${input} ok`);
    assert.strictEqual(r.draft.repo, 'owner/repo', `${input} -> the ONE canonical repo the axiom + the ③.2.5 target read`);
    assert.ok(/^[a-f0-9]{64}$/.test(r.approvalHash), 'approvalHash surfaced on the dry-run path too');
  }
});

// === #412 — isEmitArmed: the single "is a live emit currently possible" predicate the host-actor guard reads ===
// armed IFF the killswitch is DISARMED (an ARM file == 'ARMED') AND the disposition resolves to live. Fail-safe:
// any missing/unset/unreadable input => false. (LOOM_BETA_KILLSWITCH force-on must always win => false.)
function armedCustodyDir() {
  const dir = scratch('loom-armed-');
  fs.writeFileSync(path.join(dir, 'killswitch'), 'ARMED');                               // disarmed (emit possible)
  fs.writeFileSync(path.join(dir, 'disposition'), JSON.stringify({ mode: 'live', draft: false }));
  return dir;
}
test('#412 isEmitArmed: true ONLY when killswitch disarmed AND disposition live', () => {
  const save = process.env.LOOM_BETA_KILLSWITCH; delete process.env.LOOM_BETA_KILLSWITCH;
  const dir = armedCustodyDir();
  try {
    const ksp = path.join(dir, 'killswitch'); const dp = path.join(dir, 'disposition');
    assert.strictEqual(E.isEmitArmed({ killswitchPath: ksp, custodyDispositionPath: dp }), true, 'disarmed + live => armed');
    // killswitch ON (ARM file not the literal token) => not armed
    fs.writeFileSync(path.join(dir, 'ks-off'), 'DISARMED-typo');
    assert.strictEqual(E.isEmitArmed({ killswitchPath: path.join(dir, 'ks-off'), custodyDispositionPath: dp }), false, 'killswitch on => not armed');
    // disposition dry-run => not armed (even with the killswitch disarmed)
    fs.writeFileSync(path.join(dir, 'disp-dry'), JSON.stringify({ mode: 'dry-run' }));
    assert.strictEqual(E.isEmitArmed({ killswitchPath: ksp, custodyDispositionPath: path.join(dir, 'disp-dry') }), false, 'dry-run => not armed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); if (save !== undefined) process.env.LOOM_BETA_KILLSWITCH = save; }
});
test('#412 isEmitArmed: fail-safe false on missing/unset inputs AND when LOOM_BETA_KILLSWITCH forces on', () => {
  const dir = armedCustodyDir();
  const save = process.env.LOOM_BETA_KILLSWITCH; delete process.env.LOOM_BETA_KILLSWITCH;
  try {
    const ksp = path.join(dir, 'killswitch'); const dp = path.join(dir, 'disposition');
    assert.strictEqual(E.isEmitArmed({}), false, 'no paths => fail-safe false');
    assert.strictEqual(E.isEmitArmed({ killswitchPath: ksp }), false, 'no disposition path => false');
    assert.strictEqual(E.isEmitArmed({ killswitchPath: path.join(dir, 'nope'), custodyDispositionPath: dp }), false, 'unreadable killswitch => killswitch-on => false');
    process.env.LOOM_BETA_KILLSWITCH = '1';                                              // force-on always wins
    assert.strictEqual(E.isEmitArmed({ killswitchPath: ksp, custodyDispositionPath: dp }), false, 'env force-on => never armed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); if (save === undefined) delete process.env.LOOM_BETA_KILLSWITCH; else process.env.LOOM_BETA_KILLSWITCH = save; }
});
test('#412 isEmitArmed: ARMED+trailing-newline still disarms; {mode:live,draft:true} is armed (draft flag is not a gate input)', () => {
  const save = process.env.LOOM_BETA_KILLSWITCH; delete process.env.LOOM_BETA_KILLSWITCH;
  const dir = scratch('loom-armed-edge-');
  try {
    fs.writeFileSync(path.join(dir, 'ks-nl'), 'ARMED\n');                                // isKillswitchOn .trim()s -> disarmed
    fs.writeFileSync(path.join(dir, 'disp-draft'), JSON.stringify({ mode: 'live', draft: true }));
    assert.strictEqual(E.isEmitArmed({ killswitchPath: path.join(dir, 'ks-nl'), custodyDispositionPath: path.join(dir, 'disp-draft') }), true,
      'a trailing newline is trimmed (disarmed) and draft:true is the PR-draft flag, NOT a gate condition => armed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); if (save !== undefined) process.env.LOOM_BETA_KILLSWITCH = save; }
});
test('#412 RESIDUAL (acknowledged, NOT closed): emitPR has NO actor-containment gate — a uid-501-minted approval still emits', () => {
  // The #412 guard closes the ACTOR's broker-reachability (it cannot run while armed); it does NOT — and is not
  // claimed to — gate a uid-501 ORCHESTRATION that drives emitPR directly with a 501-minted approval. That is the
  // documented host-compromise residual (the literal uid-611 separation is deferred). This test pins the scope-of-
  // claim: emitPR itself emits on a valid (501-minted) approval regardless of any actor-spawn state.
  const dir = scratch('loom-custody-');
  try {
    withKillswitchEnvCleared(() => {
      const opts = armedCustody(dir);
      mintApprovalFor(opts);                                                             // a uid-501 (this-process) mint
      const r = E.emitPR(goodData(), Object.assign({}, opts, { armedEmitFn: () => ({ pr_url: 'x' }) }));
      assert.strictEqual(r.emitted, true, 'emitPR has no actor-gate — a 501-minted approval emits (the acknowledged residual)');
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ==========================================================================
// gap-map item 1 (PR-1): the kernel egress JOIN-KEY is written at emit-success (additive, non-reverting)
// ==========================================================================

const JK = require(path.join(REPO, 'packages', 'kernel', 'egress', 'join-key-store.js'));

// Capture stderr egress-alerts for the duration of `fn`; returns the joined alert text.
function captureAlerts(fn) {
  const orig = process.stderr.write;
  let buf = '';
  process.stderr.write = (chunk) => { buf += String(chunk); return true; };
  try { return { value: fn(), alerts: buf }; } finally { process.stderr.write = orig; }
}
// A succeeding seam returning a realistic gh-emit result (gh PR-URL + HEX40 base_sha).
function fakePr(over) {
  return Object.assign({ pr_url: 'https://github.com/owner/repo/pull/7', number: 7, branch: 'loom/issue-42-abc', base_sha: 'b'.repeat(40) }, over || {});
}
function jkFilesIn(dir) { return fs.readdirSync(dir).filter((n) => n.endsWith('.json')); }

test('item1: emitPR writes the join-key ONLY on emitted:true (a succeeding seam + custodyJoinKeyDir)', () => {
  const dir = scratch('loom-custody-');
  const jkDir = scratch('loom-jk-');
  try {
    withKillswitchEnvCleared(() => {
      const opts = armedCustody(dir);
      mintApprovalFor(opts);
      const r = E.emitPR(goodData(), Object.assign({}, opts, {
        custodyJoinKeyDir: jkDir,
        armedEmitFn: () => fakePr(),
      }));
      assert.strictEqual(r.emitted, true, 'emitted on the full armed path');
      assert.strictEqual(jkFilesIn(jkDir).length, 1, 'exactly one join-key file written');
      // the join-key seals approval_hash + pr identity + base_sha.
      const res = JK.resolveJoinKeyForPr({ repo: 'owner/repo', pr_number: 7, pr_url: 'https://github.com/owner/repo/pull/7' }, { dir: jkDir, selfUid: SELF_UID });
      assert.strictEqual(res.ok, true, 'the join-key joins on the gh PR identity');
      const body = JK.loadJoinKey(res.id, { dir: jkDir, selfUid: SELF_UID });
      assert.strictEqual(body.approval_hash, r.approvalHash, 'sealed to the approval content-address');
      assert.strictEqual(body.base_sha, 'b'.repeat(40), 'seals the gh base_sha');
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(jkDir, { recursive: true, force: true }); }
});

test('item1: NO join-key on awaiting-approval / refused / cap / etiquette (never on a non-emit path)', () => {
  const jkDir = scratch('loom-jk-');
  try {
    withKillswitchEnvCleared(() => {
      // (a) awaiting-approval — armed but no approval minted.
      const d1 = scratch('loom-custody-');
      try {
        const opts = armedCustody(d1);
        const r = E.emitPR(goodData(), Object.assign({}, opts, { custodyJoinKeyDir: jkDir }));
        assert.strictEqual(r.reason, 'awaiting-approval');
        assert.strictEqual(jkFilesIn(jkDir).length, 0, 'no join-key on awaiting-approval');
      } finally { fs.rmSync(d1, { recursive: true, force: true }); }
      // (b) a refused (dry-run, non-live) emit.
      const r2 = E.emitPR(goodData(), { custodyJoinKeyDir: jkDir, lockPath: path.join(jkDir, 'lock') });
      assert.strictEqual(r2.emitted, false, 'no token/disposition => not emitted');
      assert.strictEqual(jkFilesIn(jkDir).length, 0, 'no join-key on a non-live emit');
    });
  } finally { fs.rmSync(jkDir, { recursive: true, force: true }); }
});

test('item1: NOT written on pr.deduped===true (a prior emit already wrote it; no second file, no null-base_sha)', () => {
  const dir = scratch('loom-custody-');
  const jkDir = scratch('loom-jk-');
  try {
    withKillswitchEnvCleared(() => {
      const opts = armedCustody(dir);
      mintApprovalFor(opts);
      // the seam reports a 422-reconcile dedup — re-resolved base may be wrong, so the write is skipped.
      const r = E.emitPR(goodData(), Object.assign({}, opts, {
        custodyJoinKeyDir: jkDir,
        armedEmitFn: () => fakePr({ deduped: true }),
      }));
      assert.strictEqual(r.emitted, true, 'a dedup is still a successful emit');
      assert.strictEqual(jkFilesIn(jkDir).length, 0, 'NO join-key written on a deduped emit (first write authoritative)');
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(jkDir, { recursive: true, force: true }); }
});

test('item1: additive-failure isolation — a THROWING writeJoinKey path (e.g. an unwritable dir) still returns emitted:true + emits the alert', () => {
  const dir = scratch('loom-custody-');
  try {
    withKillswitchEnvCleared(() => {
      const opts = armedCustody(dir);
      mintApprovalFor(opts);
      // point custodyJoinKeyDir at a FILE (not a dir) so ensureStoreDir fails-closed; writeJoinKey returns
      // {ok:false} (store-dir) — the emit must NOT revert, and the write site emits its own alert via the
      // store's observable refuse. (The write-failed alert is store-internal; the emission still succeeds.)
      const badDir = path.join(dir, 'a-file'); fs.writeFileSync(badDir, 'x');
      const { value: r, alerts } = captureAlerts(() => E.emitPR(goodData(), Object.assign({}, opts, {
        custodyJoinKeyDir: badDir,
        armedEmitFn: () => fakePr(),
      })));
      assert.strictEqual(r.ok, true); assert.strictEqual(r.emitted, true, 'the join-key failure NEVER reverts the emission');
      // #1: a NON-throwing writeJoinKey refusal ({ok:false}) must surface the write-site signal — without
      // this assertion the test would pass even if the alert never fired (the fail-silent gap). The store
      // ALSO self-emits its own store-dir alert (defense-in-depth); both are acceptable.
      assert.ok(/egress-join-key-write-failed/.test(alerts), 'the non-throwing write refusal is observable at the write site');
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('item1: additive-failure isolation — a disposition-shaped joinKeyMeta throws in assertRecordedClaim but emission still emitted:true + alert', () => {
  const dir = scratch('loom-custody-');
  const jkDir = scratch('loom-jk-');
  try {
    withKillswitchEnvCleared(() => {
      const opts = armedCustody(dir);
      mintApprovalFor(opts);
      const { value: r, alerts } = captureAlerts(() => E.emitPR(goodData(), Object.assign({}, opts, {
        custodyJoinKeyDir: jkDir,
        joinKeyMeta: { token: 'sneaky' },   // a disposition-shaped key in the metadata
        armedEmitFn: () => fakePr(),
      })));
      assert.strictEqual(r.emitted, true, 'a poisoned joinKeyMeta NEVER reverts the emission');
      assert.ok(/egress-join-key-write-failed/.test(alerts), 'the write-site failure is observable');
      assert.strictEqual(jkFilesIn(jkDir).length, 0, 'no join-key written (the metadata gate threw before the write)');
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(jkDir, { recursive: true, force: true }); }
});

test('item1: a clean joinKeyMeta.built_by is RECORDED into the join-key (recorded-claim, not authority)', () => {
  const dir = scratch('loom-custody-');
  const jkDir = scratch('loom-jk-');
  try {
    withKillswitchEnvCleared(() => {
      const opts = armedCustody(dir);
      mintApprovalFor(opts);
      const r = E.emitPR(goodData(), Object.assign({}, opts, {
        custodyJoinKeyDir: jkDir,
        joinKeyMeta: { built_by: '13-node-backend.river' },
        armedEmitFn: () => fakePr(),
      }));
      const res = JK.resolveJoinKeyForPr({ repo: 'owner/repo', pr_number: 7, pr_url: 'https://github.com/owner/repo/pull/7' }, { dir: jkDir, selfUid: SELF_UID });
      const body = JK.loadJoinKey(res.id, { dir: jkDir, selfUid: SELF_UID });
      assert.strictEqual(body.built_by, '13-node-backend.river', 'the recorded-claim built_by is sealed');
      assert.strictEqual(r.emitted, true);
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(jkDir, { recursive: true, force: true }); }
});

test('item1: no custodyJoinKeyDir => no join-key write attempted (opt-in only)', () => {
  const dir = scratch('loom-custody-');
  try {
    withKillswitchEnvCleared(() => {
      const opts = armedCustody(dir);
      mintApprovalFor(opts);
      const r = E.emitPR(goodData(), Object.assign({}, opts, { armedEmitFn: () => fakePr() }));
      assert.strictEqual(r.emitted, true, 'emit succeeds with no join-key dir (the feature is opt-in)');
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// === assertRecordedClaim — the metadata gate (non-vacuous) ===

test('item1: assertRecordedClaim — absent => {}; a plain object with built_by => {built_by}; everything else throws', () => {
  assert.deepStrictEqual(E.assertRecordedClaim(undefined), {}, 'absent => {}');
  assert.deepStrictEqual(E.assertRecordedClaim({}), {}, 'empty object => {} (no built_by)');
  assert.deepStrictEqual(E.assertRecordedClaim({ built_by: 'ok' }), { built_by: 'ok' }, 'only built_by is forwarded');
  // an array is not a plain object.
  assert.throws(() => E.assertRecordedClaim([]), /plain object|array/i, 'an array throws');
  assert.throws(() => E.assertRecordedClaim('x'), /plain object/i, 'a string throws');
  // a disposition / prototype-pollution-shaped key throws (the #273 exact-set lesson).
  assert.throws(() => E.assertRecordedClaim({ token: 'x' }), /policy key/i, 'a disposition key throws');
  assert.throws(() => E.assertRecordedClaim({ approvalHash: 'x' }), /policy key/i, 'an approval key throws');
  assert.throws(() => E.assertRecordedClaim(JSON.parse('{"__proto__":{"x":1}}')), /policy key/i, 'a __proto__ key throws');
  // a malformed built_by throws (bounded plain string).
  assert.throws(() => E.assertRecordedClaim({ built_by: 123 }), /built_by/i, 'a non-string built_by throws');
  assert.throws(() => E.assertRecordedClaim({ built_by: 'x'.repeat(257) }), /built_by/i, 'an over-long built_by throws');
  assert.throws(() => E.assertRecordedClaim({ built_by: 'a\nb' }), /built_by/i, 'a control-char built_by throws');
});

// === the data deny-list rejects custodyJoinKeyDir / joinKeyMeta as untrusted data keys (VERIFY Q6b) ===

test('item1: custodyJoinKeyDir / joinKeyMeta are on the data deny-list (an actor cannot inject them via data)', () => {
  for (const k of ['custodyJoinKeyDir', 'joinKeyMeta']) {
    assert.ok(E.DISPOSITION_KEYS.includes(k), `${k} must be a declared disposition key`);
    const r = E.emitPR(goodData({ [k]: 'x' }));
    assert.strictEqual(r.ok, false, `data.${k} rejected end-to-end`);
    assert.ok(/policy key/.test(r.reason), `data.${k} names the policy-key rejection (got ${r.reason})`);
  }
});

// === OQ-3 W3 — the join-key SEALS lesson_commitment + RECORDS the broker-sig bundle from appr.body (RFC §5.4) ===

test('OQ-3 W3: the armed round-trip writes a join-key carrying lesson_commitment + the bundle copied from appr.body', () => {
  const dir = scratch('loom-custody-');
  const jkDir = scratch('loom-jk-');
  const X = 'a1'.repeat(32);   // a 64-hex lesson_commitment
  try {
    withKillswitchEnvCleared(() => {
      const opts = armedCustody(dir);
      mintApprovalWithLesson(opts, X);                                    // a genuinely signed approval binding X
      const r = E.emitPR(goodData({ lesson_commitment: X }), Object.assign({}, opts, {
        custodyJoinKeyDir: jkDir,
        armedEmitFn: () => fakePr(),
      }));
      assert.strictEqual(r.emitted, true, `emitted on the matching commitment (got ${r.reason}/${r.approvalReason})`);
      assert.strictEqual(jkFilesIn(jkDir).length, 1, 'exactly one join-key file');
      const res = JK.resolveJoinKeyForPr({ repo: 'owner/repo', pr_number: 7, pr_url: 'https://github.com/owner/repo/pull/7' }, { dir: jkDir, selfUid: SELF_UID });
      assert.strictEqual(res.ok, true, 'the join-key joins on the gh PR identity (lesson_commitment in the id basis is transparent to the join)');
      const body = JK.loadJoinKey(res.id, { dir: jkDir, selfUid: SELF_UID });
      assert.ok(body, 'the join-key loads (verify-on-read with the SEALED lesson_commitment + the recorded bundle)');
      // the SEALED commitment === the data value the human/broker approved
      assert.strictEqual(body.lesson_commitment, X, 'the join-key SEALS the approved lesson_commitment');
      // the bundle is copied from appr.body (the verified approval): key_id default 'v0', nonce 'n-test', approvedAt=now
      assert.strictEqual(body.key_id, 'v0', 'key_id copied from appr.body (recordApproval default)');
      assert.strictEqual(body.nonce, 'n-test', 'nonce copied from appr.body');
      assert.strictEqual(body.approvedAt, opts.now, 'approvedAt copied from appr.body (= the mint-time now)');
      assert.ok(typeof body.broker_sig === 'string' && body.broker_sig.length > 0, 'broker_sig copied from appr.body.sig');
      // the broker_sig is a canonical-base64 64-byte ed25519 sig (the signRecordId output shape).
      assert.strictEqual(Buffer.from(body.broker_sig, 'base64').length, 64, 'broker_sig is a 64-byte ed25519 sig');
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(jkDir, { recursive: true, force: true }); }
});

test('OQ-3 W3 no-lesson emit: an approval bound to "" + no data lesson_commitment writes a join-key with lesson_commitment:""', () => {
  const dir = scratch('loom-custody-');
  const jkDir = scratch('loom-jk-');
  try {
    withKillswitchEnvCleared(() => {
      const opts = armedCustody(dir);
      mintApprovalFor(opts);                                              // signs lesson_commitment:'' (no-lesson default)
      const r = E.emitPR(goodData(), Object.assign({}, opts, { custodyJoinKeyDir: jkDir, armedEmitFn: () => fakePr() }));
      assert.strictEqual(r.emitted, true, 'a no-lesson emit succeeds');
      const res = JK.resolveJoinKeyForPr({ repo: 'owner/repo', pr_number: 7, pr_url: 'https://github.com/owner/repo/pull/7' }, { dir: jkDir, selfUid: SELF_UID });
      const body = JK.loadJoinKey(res.id, { dir: jkDir, selfUid: SELF_UID });
      assert.strictEqual(body.lesson_commitment, '', 'the no-lesson sentinel is sealed into the join-key');
      assert.ok(typeof body.broker_sig === 'string' && body.broker_sig.length > 0, 'the bundle still rides (broker_sig present)');
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(jkDir, { recursive: true, force: true }); }
});

test('OQ-3 W3 fold F4: a join-key bundle with key_id:undefined => writeJoinKey bad-key-id => observable, non-reverting', () => {
  // recordApproval defaults keyId='v0', so in the LIVE emit path appr.body.key_id is always a non-empty string
  // (the body-hash + sig gates already reject a tampered approval). F4 is the DEFENSE-IN-DEPTH store gate: if a
  // malformed bundle (key_id missing) ever reaches writeJoinKey, it fail-closes with bad-key-id - and at the emit
  // call site that surfaces via the existing observable, NON-REVERTING jk.ok===false branch (never throws the
  // emission). We prove the store gate directly (the non-vacuous F4 proof; the emit path cannot produce it).
  const jkDir = scratch('loom-jk-');
  try {
    const realSig = signRecordId('a'.repeat(64), { privateKeyPem: KP.privateKeyPem });   // a real canonical 64-byte ed25519 sig
    const bundleNoKeyId = {
      repo: 'owner/repo', issueRef: 42, pr_number: 7, pr_url: 'https://github.com/owner/repo/pull/7',
      approval_hash: 'a'.repeat(64), base_sha: 'b'.repeat(40), emitted_at: '2026-06-28T00:00:00.000Z',
      lesson_commitment: '', approvedAt: 1000, nonce: 'n-test', key_id: undefined, broker_sig: realSig,
    };
    const { value: jk, alerts } = captureAlerts(() => JK.writeJoinKey(bundleNoKeyId, { dir: jkDir, selfUid: SELF_UID }));
    assert.strictEqual(jk.ok, false, 'a missing key_id is rejected');
    assert.strictEqual(jk.reason, 'bad-key-id', 'fold F4: a bundle with key_id:undefined fail-closes with bad-key-id');
    assert.ok(/bad-key-id/.test(alerts), 'the bad-key-id refuse is observable');
    assert.strictEqual(jkFilesIn(jkDir).length, 0, 'nothing is written on the malformed bundle');
  } finally { fs.rmSync(jkDir, { recursive: true, force: true }); }
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== emit-pr.test.js: ${passed} passed, ${failed} failed, ${skipped} skipped ===\n`);
  if (failed > 0) process.exit(1);
})();
