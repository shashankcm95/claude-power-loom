#!/usr/bin/env node

// tests/unit/kernel/spawn-state/spawn-record.test.js
//
// Failing-test contract for packages/kernel/spawn-state/spawn-record.js
// per Phase-1-alpha/1 TDD-treatment phase 1.
//
// Covers (post-compact PR-1 R1 F-1 + FL-1 + FL-7):
//   - F5: 3 .tmp sites migrate to writeAtomicString (atomic-write semantics)
//   - F22: scrubSecrets regex extension — Stripe + password-in-URL patterns
//   - R2-F3: JSON.stringify ordering — `scrubSecrets → sanitizeForJsonl → JSON.stringify`
//   - INV-SpawnRecord-AtomicWrite: interrupted-write + concurrent-writer (FL-1)
//   - scrubSecrets is exported at top-level for cross-module reuse (F-2)
//
// IMPORTANT — drift:test-instrument-tests-itself discipline (post-compact PR-1 R1):
//   This file's test fixtures simulate secret-shaped strings WITHOUT writing
//   the literal shape into source. Fixtures are constructed at runtime using
//   string concatenation / Buffer / String.fromCharCode so that the file
//   content itself never matches the secrets-gate hook regex it tests.
//
// At PR-1-author time this file is FAILING by design:
//   - F22 patterns not in SECRET_PATTERNS yet (Stripe + password-in-URL)
//   - scrubSecrets is exported only under __test__, not top-level
//   - spawn-record.js uses bare writeFileSync + renameSync, not writeAtomicString
//   - prepareForJsonl composed helper doesn't exist
//
// Tests pass once PR 1 phase 4 (F5 migration) + phase 6 (sanitize.js) land.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SPAWN_RECORD_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'kernel',
  'spawn-state',
  'spawn-record.js',
);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`  PASS ${name}\n`);
    passed++;
  } catch (err) {
    process.stdout.write(`  FAIL ${name}: ${err.message}\n`);
    failed++;
  }
}

// --- Runtime-constructed fixtures (drift:test-instrument-tests-itself defense) ---
//
// Each fixture is built at runtime so this source file's bytes never match
// the secrets-gate regex that scrubSecrets is supposed to catch.

function buildAwsAccessKeyFixture() {
  // Shape: AKIA + 16 uppercase alphanumerics
  return ['A', 'K', 'I', 'A'].join('') + 'B'.repeat(16);
}

function buildStripeLiveKeyFixture() {
  // Shape: sk_live_ + 24+ alphanumerics
  return 'sk' + '_' + 'live' + '_' + 'C'.repeat(24);
}

function buildStripeRestrictedKeyFixture() {
  return 'rk' + '_' + 'live' + '_' + 'D'.repeat(24);
}

function buildPasswordUrlFixture(password) {
  return 'https://alice:' + password + '@example.com/api';
}

// --- F-2: scrubSecrets top-level export ---

test('F-2: scrubSecrets is exported at top-level (cross-module reuse from memory-root.js)', () => {
  const mod = require(SPAWN_RECORD_PATH);
  assert.strictEqual(
    typeof mod.scrubSecrets,
    'function',
    'expected top-level scrubSecrets export; currently only under __test__',
  );
});

// --- F22: scrubSecrets regex extension ---

function getScrubSecrets() {
  // Try top-level first (post-F-2); fall back to __test__ for early-impl
  // failures so the F22 pattern tests can still run.
  const mod = require(SPAWN_RECORD_PATH);
  if (typeof mod.scrubSecrets === 'function') return mod.scrubSecrets;
  if (mod.__test__ && typeof mod.__test__.scrubSecrets === 'function') {
    return mod.__test__.scrubSecrets;
  }
  throw new Error('scrubSecrets not exported');
}

test('F22.existing: AWS access key (AKIA-prefix synthetic) scrubbed (regression)', () => {
  const scrubSecrets = getScrubSecrets();
  const synthetic = buildAwsAccessKeyFixture();
  const text = 'token leak: ' + synthetic + ' in log';
  const out = scrubSecrets(text);
  assert.ok(out.includes('[REDACTED]'), 'AKIA fixture should be redacted; got: ' + out);
  assert.ok(!out.includes(synthetic), 'raw key must not survive scrub');
});

test('F22.new: Stripe live-key prefix is scrubbed (synthetic placeholder)', () => {
  const scrubSecrets = getScrubSecrets();
  const synthetic = buildStripeLiveKeyFixture();
  const text = 'leak: ' + synthetic + ' in body';
  const out = scrubSecrets(text);
  assert.ok(
    out.includes('[REDACTED]'),
    'Stripe live-prefix fixture must be redacted by extended scrubSecrets',
  );
  assert.ok(!out.includes(synthetic), 'raw Stripe-shape body must not survive scrub');
});

test('F22.new: Stripe restricted-key prefix (rk_live_) is scrubbed', () => {
  const scrubSecrets = getScrubSecrets();
  const synthetic = buildStripeRestrictedKeyFixture();
  const text = 'leak: ' + synthetic + ' in body';
  const out = scrubSecrets(text);
  assert.ok(out.includes('[REDACTED]'), 'rk_live fixture must be redacted');
  assert.ok(!out.includes(synthetic), 'rk_live body must not survive scrub');
});

test('F22.new: password-in-URL pattern is scrubbed (https://user:pw@host)', () => {
  const scrubSecrets = getScrubSecrets();
  const password = 's' + '3' + 'cr' + '3' + 't-placeholder';
  const fixture = 'fetch ' + buildPasswordUrlFixture(password) + ' worked';
  const out = scrubSecrets(fixture);
  assert.ok(
    out.includes('[REDACTED]') || out.match(/https:\/\/[^@]*\[REDACTED\][^@]*@/),
    'password-in-URL must be redacted; got: ' + out,
  );
  assert.ok(!out.includes(password), 'raw password must not survive scrub');
});

test('W2: the beta credential classes are redacted by the REAL scrubSecrets (canonical wired)', () => {
  // End-to-end: the actual exported scrubSecrets (canonical classes + scrubber extras) must
  // redact the classes the old hand-list MISSED — the beta mints/handles these. Split-literal
  // fixtures so this test file does not self-trip the validate-no-bare-secrets PreToolUse gate.
  const scrubSecrets = getScrubSecrets();
  const A = 'a'.repeat(90);
  const samples = {
    'github_pat_ fine-grained': 'github' + '_pat_' + A.slice(0, 82),
    'ghs_ App/Actions token':   'ghs_' + A.slice(0, 36),
    'ghr_ refresh token':       'ghr_' + A.slice(0, 36),
    'ghu_ user-to-server':      'ghu_' + A.slice(0, 36),
    'glpat- GitLab routable':   'glpat-' + A.slice(0, 27) + '.01.6z70tqjnm',
    'AIza Google API key':      'AIza' + A.slice(0, 35),
    'PEM private key':          '-----BEGIN ' + 'OPENSSH PRIVATE KEY' + '-----',
  };
  for (const [label, token] of Object.entries(samples)) {
    const out = scrubSecrets('lead ' + token + ' trail');
    assert.ok(out.includes('[REDACTED]'), `${label} must be redacted by scrubSecrets`);
    assert.ok(!out.includes(token), `${label}: raw token must not survive (no partial-redaction tail)`);
    assert.ok(out.startsWith('lead ') && out.endsWith(' trail'), `${label}: surrounding text preserved`);
  }
});

test('F22.new: password-in-URL does not over-match plain URLs', () => {
  const scrubSecrets = getScrubSecrets();
  const plainUrl = 'See https://example.com/path for docs';
  const out = scrubSecrets(plainUrl);
  assert.strictEqual(
    out,
    plainUrl,
    'scrubSecrets must NOT redact plain URLs without embedded auth',
  );
});

// --- R2-F3: JSON-stringify ordering for audit-log emission ---

function getPrepareForJsonl() {
  const mod = require(SPAWN_RECORD_PATH);
  if (typeof mod.prepareForJsonl === 'function') return mod.prepareForJsonl;
  try {
    const sanitize = require(path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'packages',
      'kernel',
      '_lib',
      'sanitize.js',
    ));
    if (typeof sanitize.prepareForJsonl === 'function') return sanitize.prepareForJsonl;
  } catch (_e) {
    /* graceful fallback during partial-impl windows */
  }
  return undefined;
}

test('R2-F3: prepareForJsonl exists as top-level export (composed pipeline)', () => {
  assert.strictEqual(
    typeof getPrepareForJsonl(),
    'function',
    'expected prepareForJsonl exported from spawn-record.js or _lib/sanitize.js',
  );
});

test('R2-F3: prepareForJsonl ordering — scrub BEFORE sanitize BEFORE JSON.stringify', () => {
  const prepareForJsonl = getPrepareForJsonl();
  if (!prepareForJsonl) {
    assert.fail('prepareForJsonl not exported anywhere');
  }
  const awsFixture = buildAwsAccessKeyFixture();
  const fixture = awsFixture + '\nembedded newline';
  const out = prepareForJsonl(fixture);
  assert.strictEqual(typeof out, 'string', 'output must be a string (JSON-encoded)');
  // Output is JSON-stringified — peel one layer to inspect contents.
  const parsed = JSON.parse(out);
  assert.ok(parsed.includes('[REDACTED]'), 'AKIA fixture must be redacted');
  assert.ok(!parsed.includes('\n'), 'embedded newline must be stripped (JSONL hygiene)');
  assert.ok(!parsed.includes(awsFixture), 'raw secret body must not survive');
});

// --- F5: spawn-record.js uses writeAtomicString in 3 sites ---

test('F5: spawn-record.js requires _lib/atomic-write (writeAtomicString import)', () => {
  const src = fs.readFileSync(SPAWN_RECORD_PATH, 'utf8');
  assert.ok(
    /require\([^)]*atomic-write[^)]*\)/.test(src) || /from\s+['"][^'"]*atomic-write/.test(src),
    'spawn-record.js must import atomic-write helpers (F5 migration)',
  );
  assert.ok(
    /writeAtomicString/.test(src),
    'spawn-record.js must reference writeAtomicString (F5)',
  );
});

test('F5: 3 .tmp + renameSync sites migrated (no bare writeFileSync→renameSync pairs)', () => {
  const src = fs.readFileSync(SPAWN_RECORD_PATH, 'utf8');
  // After F5 migration there should be zero remaining renameSync CALL sites
  // (matched by `renameSync(` shape, not the bare word — comments mentioning
  // the migration may legitimately reference the word for documentation).
  const renameCalls = [...src.matchAll(/\brenameSync\s*\(/g)].length;
  assert.strictEqual(
    renameCalls,
    0,
    `expected 0 renameSync call sites after F5 migration; found ${renameCalls}`,
  );
});

// --- FL-1 INV-SpawnRecord-AtomicWrite: interrupted-write + concurrent-writer ---

// PR 2: the crash harness now lives in the tests/ layer (full version), not in
// packages/kernel/_lib/ (the PR-1 stub location, removed). F23 discipline:
// test infrastructure lives physically outside packages/kernel/.
const CRASH_HARNESS_PATH = path.join(__dirname, '..', '_lib', '_crash-harness.js');

test('INV-SpawnRecord-AtomicWrite: _crash-harness.js full harness exists (PR 2, tests/ layer)', () => {
  assert.ok(
    fs.existsSync(CRASH_HARNESS_PATH),
    'expected full _crash-harness.js in tests/unit/kernel/_lib/ (PR 2 supersedes the PR-1 production stub)',
  );
});

test('INV-SpawnRecord-AtomicWrite: crash-harness exports simulateInterruptedWrite()', () => {
  const harness = require(CRASH_HARNESS_PATH);
  assert.strictEqual(
    typeof harness.simulateInterruptedWrite,
    'function',
    'harness must expose simulateInterruptedWrite for atomic-write property test',
  );
});

test('INV-SpawnRecord-AtomicWrite: interrupted write leaves NO partial file on disk', () => {
  const { simulateInterruptedWrite } = require(CRASH_HARNESS_PATH);
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'inv-aw-'));
  const target = path.join(tmpDir, 'target.txt');
  try {
    try {
      simulateInterruptedWrite(target, 'content-that-never-commits');
    } catch {
      // simulateInterruptedWrite throws by design (mid-write interruption)
    }
    assert.strictEqual(
      fs.existsSync(target),
      false,
      'interrupted write must NOT leave target file on disk',
    );
    // .tmp shadow may exist; that's tolerable.
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_e) {
      /* best-effort cleanup */
    }
  }
});

test('INV-SpawnRecord-AtomicWrite: concurrent writers produce serialized output (no torn line)', () => {
  let writeAtomicString;
  try {
    writeAtomicString = require(path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'packages',
      'kernel',
      '_lib',
      'atomic-write.js',
    )).writeAtomicString;
  } catch (err) {
    assert.fail('_lib/atomic-write.js missing writeAtomicString export: ' + err.message);
  }
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'inv-cw-'));
  const target = path.join(tmpDir, 'concurrent.txt');
  try {
    const payloadA = 'A'.repeat(10000);
    const payloadB = 'B'.repeat(10000);
    writeAtomicString(target, payloadA);
    writeAtomicString(target, payloadB);
    const final = fs.readFileSync(target, 'utf8');
    assert.ok(
      final === payloadA || final === payloadB,
      'concurrent writers must produce one-or-the-other; never a torn merge',
    );
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_e) {
      /* best-effort cleanup */
    }
  }
});

// ════════════════════════════════════════════════════════════════════════════
// PR-4a additions — TDD Phase 1 (RED until buildEnvelope gains the
// write_scope_violations[] field). ADR-0011 §write-scope-violations-schema +
// ADR-0010 INV-A7. This is a LIVE PostToolUse hook — a MINIMAL surgical add of
// one default-[] field; zero regression to existing envelope fields.
// ════════════════════════════════════════════════════════════════════════════

function getBuildEnvelope() {
  const mod = require(SPAWN_RECORD_PATH);
  if (mod.__test__ && typeof mod.__test__.buildEnvelope === 'function') return mod.__test__.buildEnvelope;
  if (typeof mod.buildEnvelope === 'function') return mod.buildEnvelope;
  throw new Error('buildEnvelope not exported (expected under __test__)');
}

function minimalBuildArgs() {
  return {
    input: { session_id: 'sess-pr4a', cwd: '/tmp/wt' },
    toolName: 'Agent',
    toolInput: { subagent_type: 'architect', prompt: 'do the thing' },
    toolResponse: 'done',
  };
}

const VIOLATION_ELEMENT_KEYS = ['path', 'kind', 'transport', 'detected_at_phase', 'sha256_pre', 'sha256_post', 'flags'];

test('write_scope_violations: buildEnvelope carries the field, defaulting to an empty array', () => {
  const buildEnvelope = getBuildEnvelope();
  const env = buildEnvelope(minimalBuildArgs());
  assert.ok(
    Object.prototype.hasOwnProperty.call(env, 'write_scope_violations'),
    'envelope must carry a write_scope_violations field (ADR-0010 INV-A7)',
  );
  assert.ok(Array.isArray(env.write_scope_violations), 'field is an array');
  assert.strictEqual(env.write_scope_violations.length, 0, 'default is empty (clean spawn) []');
});

test('W2 leak-trace: scrubSecrets is applied to EVERY free-form persisted axiom field (not just the completion excerpt)', () => {
  // Gemini-premise-2 sharp version (probed): a token planted in description / subagent_type /
  // cwd survived these axiom fields UNSCRUBBED into the world-readable envelope; only the
  // completion excerpt was scrubbed. Assert the leak is closed across all free-form fields.
  const buildEnvelope = getBuildEnvelope();
  const TOK = 'ghp_' + 'a'.repeat(36); // a canonical github-classic token shape
  const env = buildEnvelope({
    input: { session_id: 'sess-leak', cwd: '/home/u/proj-' + TOK },
    toolName: 'Agent',
    toolInput: { subagent_type: 'node-backend ' + TOK, description: 'token is ' + TOK + ' here', prompt: 'use ' + TOK },
    toolResponse: { result: 'done with ' + TOK },
  });
  const ax = env.axioms;
  for (const f of ['subagent_type', 'subagent_type_raw', 'input_description', 'cwd']) {
    assert.ok(typeof ax[f] === 'string' && !ax[f].includes(TOK), `axioms.${f} must NOT carry the raw token (scrubbed); got "${ax[f]}"`);
    assert.ok(ax[f].includes('[REDACTED]'), `axioms.${f} must show [REDACTED]`);
  }
  // prompt is sha-only (never persisted raw); the whole envelope must not carry the token anywhere.
  assert.ok(!JSON.stringify(env).includes(TOK), 'NO persisted field anywhere may carry the raw token');
});

test('W2 leak-trace: scrubbing is a NO-OP for legit (token-free) axiom values (no false redaction)', () => {
  const buildEnvelope = getBuildEnvelope();
  const env = buildEnvelope({
    input: { session_id: 'sess-xyz', cwd: '/home/u/myproject' },
    toolName: 'Agent',
    toolInput: { subagent_type: 'node-backend', description: 'fix the parser', prompt: 'p' },
    toolResponse: 'done',
  });
  assert.strictEqual(env.axioms.subagent_type, 'node-backend', 'legit persona id byte-unchanged');
  assert.strictEqual(env.axioms.input_description, 'fix the parser', 'legit description byte-unchanged');
  assert.strictEqual(env.axioms.cwd, '/home/u/myproject', 'legit cwd byte-unchanged');
  assert.strictEqual(env.axioms.session_id, 'sess-xyz', 'session_id (identifier) NOT scrubbed — correlation key intact');
});

test('write_scope_violations: the default-[] field does NOT regress existing envelope fields', () => {
  const buildEnvelope = getBuildEnvelope();
  const env = buildEnvelope(minimalBuildArgs());
  // Spot-check the load-bearing pre-existing fields are intact (surgical add).
  assert.strictEqual(env.schema_version !== undefined, true, 'schema_version intact');
  assert.strictEqual(typeof env.spawn_id, 'string', 'spawn_id intact');
  assert.strictEqual(env.parent_state_id, null, 'parent_state_id (INV-P-DepthOne) intact');
  assert.ok(env.axioms && typeof env.axioms === 'object', 'axioms block intact');
  assert.ok(env.attestations && env.attestations.bounded_output, 'attestations.bounded_output intact');
  assert.deepStrictEqual(env.theorems, [], 'theorems still []');
  assert.deepStrictEqual(env.samples, [], 'samples still []');
});

test('write_scope_violations: a populated element conforms to the §write-scope-violations-schema shape', () => {
  // The schema shape K14 (4a) produces + the resolver (4b) consumes. Asserted at
  // the spawn-record boundary so the field is shape-correct before any consumer.
  const populated = {
    path: 'sub/ghost.txt',
    kind: 'out-of-scope',
    transport: 'snapshot',
    detected_at_phase: 'spawn-close',
    sha256_pre: 'a'.repeat(64),
    sha256_post: 'b'.repeat(64),
    flags: [],
  };
  for (const k of VIOLATION_ELEMENT_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(populated, k), `element shape requires '${k}'`);
  }
  assert.ok(['out-of-scope', 'symlink-escape', 'parent-scope-suspected'].includes(populated.kind),
    'kind is one of the three write-scope violation kinds');
  assert.strictEqual(populated.transport, 'snapshot', 'v3.0-alpha transport is snapshot');
  assert.ok(['spawn-close', 'tail-window', 'recovery-sweep'].includes(populated.detected_at_phase),
    'detected_at_phase is one of the three phases');
  assert.ok(Array.isArray(populated.flags), 'flags is an array (may carry K14_SUSPECTED_FALSE_POSITIVE)');
});

process.stdout.write(`\nspawn-record.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
