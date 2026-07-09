#!/usr/bin/env node

// tests/unit/runtime/identity/registry-bulkhead-lost-updates.test.js
//
// Regression: in BULKHEAD mode the cold-path mutators cmdPrune (apply) and
// cmdUnretire took the _metadata.json lock, then writeStore() -> the whole-store
// _writeStorePartitioned rewrote EVERY persona's volume from a lock-free
// snapshot. Meanwhile the hot path (cmdRecord) writes under a per-persona lock.
// Disjoint locks -> a concurrent verdict on persona B could be silently
// clobbered by prune/unretire's stale-snapshot rewrite of B's volume.
//
// The race is a TOCTOU, but its ROOT is deterministic and testable: the cold
// path rewrote personas it never touched. The fix routes cold-path mutations
// through the per-persona lock + volume (readPersona/writePersona) and only
// writes personas it actually changed. This test proves the isolation: a
// mutation on persona A leaves an UNRELATED persona B's volume byte-for-byte
// untouched (so a concurrent write to B cannot be lost). A distinctive sentinel
// on B (version:999 + _sentinel) survives under the fix; the old whole-store
// rewrite reset every volume to version:1 and dropped extra fields.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Bulkhead is active iff <CLAUDE_LIBRARY_ROOT>/.partition-complete exists.
// Set the root + sentinel BEFORE requiring the registry (call-time path
// resolution reads the env, but set early to be safe).
const LIB_ROOT = path.join(os.tmpdir(), 'registry-bulkhead-' + crypto.randomBytes(6).toString('hex'));
fs.mkdirSync(LIB_ROOT, { recursive: true });
fs.writeFileSync(path.join(LIB_ROOT, '.partition-complete'), '');
process.env.CLAUDE_LIBRARY_ROOT = LIB_ROOT;
delete process.env.AGENT_IDENTITY_STORE; // ensure NOT legacy mode

const REPO = path.join(__dirname, '..', '..', '..', '..');
const registry = require(path.join(REPO, 'packages', 'runtime', 'orchestration', 'identity', 'registry'));

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// Suppress the commands' result lines + backfill reconciliation warnings (we
// assert on store state, not stdout/stderr).
function quiet(fn) {
  const origLog = console.log;
  const origErr = console.error;
  console.log = () => {};
  console.error = () => {};
  try { return fn(); } finally { console.log = origLog; console.error = origErr; }
}

function seedIdentity(overrides = {}) {
  return {
    persona: overrides.persona,
    name: overrides.name,
    retired: false,
    verdicts: { pass: 0, partial: 0, fail: 0 },
    specializations: [],
    traits: { skillFocus: null, kbFocus: [], taskDomain: null },
    ...overrides,
  };
}

// Seed persona B with a DISTINCTIVE sentinel the old whole-store rewrite would
// destroy (it re-stamped every volume as {identities, version:1}).
function seedSentinelPersona(persona) {
  registry.writePersona(persona, {
    identities: { watcher: seedIdentity({ persona, name: 'watcher' }) },
    version: 999,
    _sentinel: 'untouched',
  });
}
function readSentinel(persona) {
  return registry.readPersona(persona);
}

test('sanity: bulkhead mode is active', () => {
  assert.strictEqual(registry._isBulkheadActive(), true, 'expected bulkhead active (sentinel present)');
});

test('cmdUnretire: unretires the target AND leaves an unrelated persona byte-untouched', () => {
  registry.writePersona('04-architect', {
    identities: { mira: seedIdentity({ persona: '04-architect', name: 'mira', retired: true, retiredReason: 'x' }) },
    version: 1,
  });
  seedSentinelPersona('01-hacker');

  quiet(() => registry.cmdUnretire({ identity: '04-architect.mira' }));

  // Target unretired.
  const a = registry.readPersona('04-architect');
  assert.strictEqual(a.identities.mira.retired, false, 'mira should be unretired');
  // Unrelated persona untouched — the old code rewrote it to version:1, dropping _sentinel.
  const b = readSentinel('01-hacker');
  assert.strictEqual(b.version, 999, `cross-persona clobber: 01-hacker volume was rewritten (version=${b.version})`);
  assert.strictEqual(b._sentinel, 'untouched', 'cross-persona clobber: _sentinel field was dropped');
});

test('cmdPrune (apply): retires a prunable identity AND leaves an unrelated persona untouched', () => {
  // A genuinely prunable identity: 4 verdicts, all fail (passRate 0 < 0.5, total 4 >= 3).
  registry.writePersona('13-node-backend', {
    identities: {
      bob: seedIdentity({
        persona: '13-node-backend', name: 'bob',
        verdicts: { pass: 0, partial: 0, fail: 4 },
        // history length must match sum(verdicts) or _backfillSchema warns + reconciles.
        quality_factors_history: [{ verdict: 'fail' }, { verdict: 'fail' }, { verdict: 'fail' }, { verdict: 'fail' }],
      }),
    },
    version: 1,
  });
  // A skip-eligible identity on an unrelated persona carrying the sentinel.
  seedSentinelPersona('02-confused-user');

  quiet(() => registry.cmdPrune({ auto: true, 'retire-min-verdicts': 3, 'retire-pass-rate-max': 0.5 }));

  // The prunable identity was retired via the new per-persona path (functional).
  const c = registry.readPersona('13-node-backend');
  assert.strictEqual(c.identities.bob.retired, true, 'bob should be retired by prune --auto');
  // The unrelated, skip-eligible persona's volume was never rewritten.
  const b = readSentinel('02-confused-user');
  assert.strictEqual(b.version, 999, `cross-persona clobber: 02-confused-user volume was rewritten (version=${b.version})`);
  assert.strictEqual(b._sentinel, 'untouched', 'cross-persona clobber: _sentinel field was dropped by prune');
});

try {
  process.stdout.write(`\nregistry-bulkhead-lost-updates.test.js: ${passed} passed, ${failed} failed\n`);
} finally {
  fs.rmSync(LIB_ROOT, { recursive: true, force: true });
}
process.exit(failed === 0 ? 0 : 1);
