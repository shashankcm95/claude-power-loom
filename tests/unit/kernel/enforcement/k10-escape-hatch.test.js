#!/usr/bin/env node

// tests/unit/kernel/enforcement/k10-escape-hatch.test.js
// K10 escape hatches + F10 combined-bypass detection (PR 2).

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const {
  isTruthyEnv,
  evaluateEscapeHatches,
  emitEscapeHatchAudit,
} = require('../../../../packages/kernel/enforcement/k10-escape-hatch');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}
function tmpLog() {
  return path.join(os.tmpdir(), 'k10-' + crypto.randomBytes(6).toString('hex') + '.jsonl');
}

test('isTruthyEnv recognizes 1/true/yes, rejects others', () => {
  assert.strictEqual(isTruthyEnv('1'), true);
  assert.strictEqual(isTruthyEnv('true'), true);
  assert.strictEqual(isTruthyEnv('yes'), true);
  assert.strictEqual(isTruthyEnv('0'), false);
  assert.strictEqual(isTruthyEnv(undefined), false);
  assert.strictEqual(isTruthyEnv('maybe'), false);
});

test('no hatches set → allow, no severity', () => {
  const d = evaluateEscapeHatches({});
  assert.strictEqual(d.action, 'allow');
  assert.strictEqual(d.combinedBypass, false);
  assert.strictEqual(d.severity, null);
});

test('worktree-disabled only → allow-with-audit MEDIUM', () => {
  const d = evaluateEscapeHatches({ LOOM_DISABLE_WORKTREE: '1' });
  assert.strictEqual(d.action, 'allow-with-audit');
  assert.strictEqual(d.severity, 'MEDIUM');
  assert.strictEqual(d.combinedBypass, false);
});

test('out-of-scope-allowed only → allow-with-audit MEDIUM', () => {
  const d = evaluateEscapeHatches({ LOOM_ALLOW_OUT_OF_SCOPE_WRITES: 'true' });
  assert.strictEqual(d.action, 'allow-with-audit');
  assert.strictEqual(d.severity, 'MEDIUM');
});

test('F10: combined bypass → allow-with-audit HIGH + combinedBypass true (local-trust: spawn proceeds)', () => {
  const d = evaluateEscapeHatches({ LOOM_DISABLE_WORKTREE: '1', LOOM_ALLOW_OUT_OF_SCOPE_WRITES: '1' });
  assert.strictEqual(d.combinedBypass, true);
  assert.strictEqual(d.action, 'allow-with-audit');
  assert.strictEqual(d.severity, 'HIGH');
});

test('F10: combined bypass + CI deny → DENY CRITICAL', () => {
  const d = evaluateEscapeHatches({
    LOOM_DISABLE_WORKTREE: '1',
    LOOM_ALLOW_OUT_OF_SCOPE_WRITES: '1',
    LOOM_CI_DENY_COMBINED_BYPASS: '1',
  });
  assert.strictEqual(d.action, 'deny');
  assert.strictEqual(d.severity, 'CRITICAL');
});

test('CI deny without combined bypass does nothing (only the combination is denied)', () => {
  const d = evaluateEscapeHatches({ LOOM_DISABLE_WORKTREE: '1', LOOM_CI_DENY_COMBINED_BYPASS: '1' });
  assert.strictEqual(d.action, 'allow-with-audit'); // single hatch, not combined
  assert.strictEqual(d.severity, 'MEDIUM');
});

test('emitEscapeHatchAudit writes a record for a combined bypass', () => {
  const log = tmpLog();
  const d = evaluateEscapeHatches({ LOOM_DISABLE_WORKTREE: '1', LOOM_ALLOW_OUT_OF_SCOPE_WRITES: '1' });
  const wrote = emitEscapeHatchAudit(d, { logPath: log, extra: { spawn_id: 'sp-1' } });
  assert.strictEqual(wrote, true);
  const rec = JSON.parse(fs.readFileSync(log, 'utf8').trim());
  assert.strictEqual(rec.kind, 'k10-escape-hatch');
  assert.strictEqual(rec.severity, 'HIGH');
  assert.strictEqual(rec.combined_bypass, true);
  assert.strictEqual(rec.spawn_id, 'sp-1');
  assert.strictEqual(rec.class, 4);
  fs.rmSync(log, { force: true });
});

test('emitEscapeHatchAudit is a no-op when action is allow', () => {
  const log = tmpLog();
  const d = evaluateEscapeHatches({});
  const wrote = emitEscapeHatchAudit(d, { logPath: log });
  assert.strictEqual(wrote, false);
  assert.strictEqual(fs.existsSync(log), false);
});

// --- Dead-code consumption-status regression (kernel-deadcode unit) ---
// Pins the documented fact that the combined-bypass machinery
// (combinedBypass / denyCombinedInCi / outOfScopeAllowed / action:'deny') is
// COMPUTED-BUT-UNCONSUMED at the enforcement layer. The only production caller
// (worktree-allocator) branches on `worktreeDisabled` + audits `severity`; it
// NEVER blocks on the `deny` verdict. If a future wave wires the deny path into
// enforcement, this test will (correctly) fail and force a header/doc update.

test('only worktreeDisabled + severity are consumed; deny verdict is computed but NOT enforced by the allocator', () => {
  const { allocateWorktree } = require('../../../../packages/kernel/worktree/worktree-allocator');
  const log = tmpLog();
  let gitCalled = false;
  // The "deny" verdict: combined bypass + CI deny var set.
  const denyEnv = {
    LOOM_DISABLE_WORKTREE: '1',
    LOOM_ALLOW_OUT_OF_SCOPE_WRITES: '1',
    LOOM_CI_DENY_COMBINED_BYPASS: '1',
  };
  assert.strictEqual(evaluateEscapeHatches(denyEnv).action, 'deny', 'precondition: env yields the deny verdict');
  const res = allocateWorktree({
    repoRoot: '/tmp/does-not-matter',
    worktreePath: '/tmp/wt-does-not-matter',
    env: denyEnv,
    runGitFn: () => { gitCalled = true; return { ok: false, stderr: 'unreached' }; },
    auditLogPath: log,
  });
  // The allocator honored worktreeDisabled (escape-hatch-disabled) and did NOT
  // touch git — proving the spawn is NOT blocked by the unconsumed deny verdict.
  assert.strictEqual(res.mode, 'escape-hatch-disabled', 'deny verdict is unconsumed: allocator falls through worktreeDisabled, not a deny-block');
  assert.strictEqual(res.allocated, false);
  assert.strictEqual(gitCalled, false, 'git must not be invoked when worktree is disabled');
  fs.rmSync(log, { force: true });
});

process.stdout.write(`\nk10-escape-hatch.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
