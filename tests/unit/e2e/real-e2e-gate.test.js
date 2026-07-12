#!/usr/bin/env node

// tests/unit/e2e/real-e2e-gate.test.js
//
// Unit-tests the PURE `decideGate` extracted from the gated e2e (tests/e2e/real-e2e-actor-dogfood.e2e.js) so
// every skip/fail/run branch is deterministically proven WITHOUT a real `claude -p` run. The e2e's `main()`
// runs only under `require.main === module`, so requiring the file here just imports `decideGate`.
//
// The load-bearing branch: the sandbox condition SPLITS - 'no-sandbox-exec' (absent) is a clean SKIP (exit 2),
// but a present-but-unattested sandbox (containment broke on a capable host) is a FAIL (exit 1), never a
// silent skip.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The e2e's require chain loads recall-graph-store (LOOM_LAB_STATE_DIR capture at module load). decideGate is
// pure (no store I/O), but pin the env before require for hygiene.
process.env.LOOM_LAB_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-test-labstate-'));

const REPO = path.join(__dirname, '..', '..', '..');
const { decideGate } = require(path.join(REPO, 'tests', 'e2e', 'real-e2e-actor-dogfood.e2e.js'));

let passed = 0;
function check(name, fn) { fn(); passed += 1; }

const OK_ATTEST = { attested: true, reason: 'ok' };

check('gated-off (RUN_E2E !== 1) -> skip exit 2', () => {
  const g = decideGate({ runE2E: false, claudeResolved: true, attestResult: OK_ATTEST, networkReachable: true });
  assert.strictEqual(g.action, 'skip'); assert.strictEqual(g.code, 2);
  assert.ok(/RUN_E2E=1/.test(g.reason), 'the reason tells the operator to set RUN_E2E=1');
});

check('gated-off wins even with everything else absent (missing fields default to skip-safe)', () => {
  const g = decideGate({});
  assert.strictEqual(g.action, 'skip'); assert.strictEqual(g.code, 2);
});

check('claude binary absent -> skip exit 2', () => {
  const g = decideGate({ runE2E: true, claudeResolved: false, attestResult: OK_ATTEST, networkReachable: true });
  assert.strictEqual(g.action, 'skip'); assert.strictEqual(g.code, 2);
  assert.ok(/claude/i.test(g.reason));
});

check('no-sandbox-exec (containment ABSENT) -> clean skip exit 2', () => {
  const g = decideGate({ runE2E: true, claudeResolved: true, attestResult: { attested: false, reason: 'no-sandbox-exec' }, networkReachable: true });
  assert.strictEqual(g.action, 'skip'); assert.strictEqual(g.code, 2);
});

check('sandbox PRESENT but containment NOT attested -> FAIL exit 1 (the load-bearing split)', () => {
  const g = decideGate({ runE2E: true, claudeResolved: true, attestResult: { attested: false, reason: 'pcGreen=true wroteScoped=true homeBlocked=true netBlocked=false' }, networkReachable: true });
  assert.strictEqual(g.action, 'fail', 'a broken containment on a capable host must FAIL, not silently skip');
  assert.strictEqual(g.code, 1);
  assert.ok(/containment NOT attested/.test(g.reason));
});

check('all prerequisites present but network unreachable -> skip exit 2', () => {
  const g = decideGate({ runE2E: true, claudeResolved: true, attestResult: OK_ATTEST, networkReachable: false });
  assert.strictEqual(g.action, 'skip'); assert.strictEqual(g.code, 2);
  assert.ok(/network/i.test(g.reason));
});

check('everything present -> run exit 0', () => {
  const g = decideGate({ runE2E: true, claudeResolved: true, attestResult: OK_ATTEST, networkReachable: true });
  assert.strictEqual(g.action, 'run'); assert.strictEqual(g.code, 0);
});

check('the check ORDER: gated-off is reported before a (also-absent) sandbox', () => {
  // both runE2E false AND sandbox absent -> the gated-off reason wins (checked first)
  const g = decideGate({ runE2E: false, claudeResolved: false, attestResult: { attested: false, reason: 'no-sandbox-exec' } });
  assert.ok(/RUN_E2E=1/.test(g.reason), 'gated-off is the first-reported reason');
});

assert.ok(passed >= 8, `anti-vacuity floor: expected >=8 checks, ran ${passed}`);
console.log(`${path.basename(__filename)}: ${passed} passed`);
