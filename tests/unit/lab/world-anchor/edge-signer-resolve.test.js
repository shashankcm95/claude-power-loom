#!/usr/bin/env node
'use strict';

// tests/unit/lab/world-anchor/edge-signer-resolve.test.js
//
// PR-B B1 - the edge signer-routing resolver (SHADOW). Verifies: the STRICT-arm / LENIENT-detect POLARITY
// (a typo NEVER arms; scope hacker CRITICAL 1), fail-SAFE-to-unsigned (never refuse), the misconfig
// observability (XOR presence / typo'd arm), the unknown-mode emit (template parity, no silent swallow), and
// the LAZY require of the kernel egress launcher on the common unarmed path. Lab convention: run via
// `node <file>` (node:assert + a light test() runner), ASCII, env save/restore + stderr capture.

const assert = require('assert');

const { defaultEdgeSignerLauncher, resolveEdgeSignerLaunch, isEdgeUidSepArmed } = require('../../../../packages/lab/world-anchor/edge-signer-resolve');
const LAUNCH_MOD = require.resolve('../../../../packages/kernel/egress/loom-edge-launch');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; process.stdout.write(`  PASS ${name}\n`); }
  catch (e) { failed += 1; process.stdout.write(`  FAIL ${name}: ${(e && e.message) || e}\n`); }
}

const EDGE_ENV = ['LOOM_EDGE_USER', 'LOOM_EDGE_WRAPPER', 'LOOM_EDGE_REQUIRE_UID_SEP'];
function withEnv(vars, fn) {
  const saved = {};
  for (const k of EDGE_ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  for (const [k, v] of Object.entries(vars)) { if (v !== undefined) process.env[k] = v; }
  try { return fn(); }
  finally { for (const k of EDGE_ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}
function captureStderr(fn) {
  const orig = process.stderr.write.bind(process.stderr);
  let buf = '';
  process.stderr.write = (s) => { buf += String(s); return true; };
  try { fn(); } finally { process.stderr.write = orig; }
  return buf;
}
const PRESENT = { LOOM_EDGE_USER: 'loom-edge-signer', LOOM_EDGE_WRAPPER: '/usr/local/bin/loom-edge-sign' };

// === 1. ARM polarity (STRICT normalizeBool): only a valid-truthy flag ARMS cross-uid (presence held) ===
for (const v of ['1', 'true', 'yes', 'on', 'TRUE', ' on ']) {
  test(`arm '${v}' (valid-truthy) + presence -> cross-uid`, () => {
    withEnv({ ...PRESENT, LOOM_EDGE_REQUIRE_UID_SEP: v }, () => {
      assert.strictEqual(defaultEdgeSignerLauncher().mode, 'cross-uid');
    });
  });
}
for (const v of [undefined, '', '0', 'false', 'no', 'off', 'ture', 'enabled', '2']) {
  test(`arm ${JSON.stringify(v)} (NOT valid-truthy) + presence -> direct (a typo NEVER arms = fail-safe unsigned)`, () => {
    withEnv({ ...PRESENT, LOOM_EDGE_REQUIRE_UID_SEP: v }, () => {
      assert.strictEqual(defaultEdgeSignerLauncher().mode, 'direct');
    });
  });
}

// === 2. presence + staged matrix ===
test('both present + armed -> cross-uid with the edgeUser/wrapperPath', () => {
  withEnv({ ...PRESENT, LOOM_EDGE_REQUIRE_UID_SEP: '1' }, () => {
    const r = defaultEdgeSignerLauncher();
    assert.strictEqual(r.mode, 'cross-uid');
    assert.strictEqual(r.edgeUser, 'loom-edge-signer');
    assert.strictEqual(r.wrapperPath, '/usr/local/bin/loom-edge-sign');
  });
});
test('USER only (XOR presence) -> direct + misconfig', () => {
  withEnv({ LOOM_EDGE_USER: 'loom-edge-signer', LOOM_EDGE_REQUIRE_UID_SEP: '1' }, () => {
    const r = defaultEdgeSignerLauncher();
    assert.strictEqual(r.mode, 'direct');
    assert.strictEqual(r.misconfig, true);
  });
});
test('WRAPPER only (XOR presence) -> direct + misconfig', () => {
  withEnv({ LOOM_EDGE_WRAPPER: '/usr/local/bin/loom-edge-sign', LOOM_EDGE_REQUIRE_UID_SEP: '1' }, () => {
    const r = defaultEdgeSignerLauncher();
    assert.strictEqual(r.mode, 'direct');
    assert.strictEqual(r.misconfig, true);
  });
});
test('none + unarmed -> direct, NO misconfig (clean SHADOW)', () => {
  withEnv({}, () => { assert.strictEqual(defaultEdgeSignerLauncher().misconfig, undefined); });
});
test('both present + arm UNSET -> direct, NO misconfig (intended STAGED state)', () => {
  withEnv({ ...PRESENT }, () => { assert.strictEqual(defaultEdgeSignerLauncher().misconfig, undefined); });
});
test('both present + arm explicit-off -> direct, NO misconfig (staged, decided silent)', () => {
  withEnv({ ...PRESENT, LOOM_EDGE_REQUIRE_UID_SEP: 'false' }, () => {
    assert.strictEqual(defaultEdgeSignerLauncher().misconfig, undefined);
  });
});
test("arm typo (no presence) -> direct + misconfig (intent-to-arm, mistyped)", () => {
  withEnv({ LOOM_EDGE_REQUIRE_UID_SEP: 'ture' }, () => {
    assert.strictEqual(defaultEdgeSignerLauncher().misconfig, true);
  });
});

// === 3. resolve: an injected cross-uid launcher builds a real signer FUNCTION (test-only seam) ===
test('resolve: injected cross-uid -> a real signer function is built', () => {
  const r = resolveEdgeSignerLaunch({ edgeLauncherFn: () => ({ mode: 'cross-uid', edgeUser: 'loom-edge-signer', wrapperPath: '/usr/local/bin/loom-edge-sign' }) });
  assert.strictEqual(r.mode, 'cross-uid');
  assert.strictEqual(typeof r.signer, 'function');
});

// === 4. production-engaged default -> signer undefined (output-identical to today) + SILENT ===
test('resolve default (production-engaged) -> direct/undefined', () => {
  withEnv({}, () => {
    const r = resolveEdgeSignerLaunch();
    assert.strictEqual(r.mode, 'direct');
    assert.strictEqual(r.signer, undefined);
  });
});
test('resolve clean path emits NOTHING (no alert spam on the common SHADOW path)', () => {
  const err = captureStderr(() => withEnv({}, () => resolveEdgeSignerLaunch()));
  assert.strictEqual(err, '');
});

// === 5. fail-SAFE + OBSERVABLE: throw / unknown-mode / build-failed / misconfig all -> direct/undefined + emit ===
test('resolve: launcher THROWS -> direct/undefined + edge-signer-resolver-threw', () => {
  let r;
  const err = captureStderr(() => { r = resolveEdgeSignerLaunch({ edgeLauncherFn: () => { throw new Error('boom'); } }); });
  assert.strictEqual(r.signer, undefined);
  assert.ok(err.includes('edge-signer-resolver-threw'), err);
});
test('resolve: unknown launcher mode -> direct/undefined + edge-signer-unknown-mode (no silent swallow)', () => {
  let r;
  const err = captureStderr(() => { r = resolveEdgeSignerLaunch({ edgeLauncherFn: () => ({ mode: 'weird' }) }); });
  assert.strictEqual(r.mode, 'direct');
  assert.strictEqual(r.signer, undefined);
  assert.ok(err.includes('edge-signer-unknown-mode'), err);
});
test('resolve: cross-uid with INVALID edgeUser -> edge-signer-build-failed + fail-safe direct (non-vacuous)', () => {
  let r;
  const err = captureStderr(() => { r = resolveEdgeSignerLaunch({ edgeLauncherFn: () => ({ mode: 'cross-uid', edgeUser: '-rm', wrapperPath: '/usr/local/bin/loom-edge-sign' }) }); });
  assert.strictEqual(r.mode, 'direct');
  assert.strictEqual(r.signer, undefined);
  assert.ok(err.includes('edge-signer-build-failed'), err);
});
test('resolve: misconfig (XOR presence) -> direct/undefined + edge-signer-misconfigured', () => {
  let r;
  const err = captureStderr(() => { r = withEnv({ LOOM_EDGE_USER: 'loom-edge-signer' }, () => resolveEdgeSignerLaunch()); });
  assert.strictEqual(r.signer, undefined);
  assert.ok(err.includes('edge-signer-misconfigured'), err);
});

// === 6. lazy-require: the common unarmed path NEVER loads kernel/egress/loom-edge-launch ===
test('lazy-require: unarmed resolve does NOT load the kernel egress launcher', () => {
  delete require.cache[LAUNCH_MOD];                       // clean slate (a prior cross-uid test may have loaded it)
  withEnv({}, () => { resolveEdgeSignerLaunch(); });      // unarmed -> direct -> no lazy require
  assert.strictEqual(require.cache[LAUNCH_MOD], undefined, 'kernel egress launcher must NOT load on the unarmed path');
});

// === 7. isEdgeUidSepArmed: STRICT parse of the B1 signing-arm flag (A-W1 preflight predicate) ===
// The recall CLI + the observe-merge mint arm read this and INJECT signingArmed into custody-arming, so the
// coherence gate never makes lab/_lib import back into world-anchor/ (Q2-A no-cycle). Same STRICT polarity as
// the cross-uid arm: only a valid-truthy ARMS; a typo is dark.
for (const v of ['1', 'true', 'yes', 'on', 'TRUE', ' on ']) {
  test(`isEdgeUidSepArmed '${v}' (valid-truthy) -> true`, () => {
    withEnv({ LOOM_EDGE_REQUIRE_UID_SEP: v }, () => assert.strictEqual(isEdgeUidSepArmed(), true));
  });
}
for (const v of [undefined, '', '0', 'false', 'no', 'off', 'ture', 'enabled', '2', 'y']) {
  test(`isEdgeUidSepArmed ${JSON.stringify(v)} -> false (STRICT dark; a typo never arms)`, () => {
    withEnv({ LOOM_EDGE_REQUIRE_UID_SEP: v }, () => assert.strictEqual(isEdgeUidSepArmed(), false));
  });
}

process.stdout.write(`\n=== edge-signer-resolve: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
