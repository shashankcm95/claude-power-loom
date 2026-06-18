#!/usr/bin/env node

// tests/unit/runtime/orchestration/doctor/probes/partition-sentinel.test.js
//
// Regression for bug `partition-sentinel-path`: the probe used to hard-code
// ~/.claude/library/sections/agents/stacks/identities/.partition-complete,
// but the canonical sentinel the runtime actually writes/reads is
// libraryPaths.partitionSentinelPath() = <library-root>/.partition-complete
// (the same source registry.js / pattern-recorder.js consult). The old path
// made the probe report `absent` even when bulkhead mode was active.
//
// We isolate the library root via CLAUDE_LIBRARY_ROOT (Component O override)
// and create a sentinel at the CANONICAL path. The probe must report `pass`
// and surface that exact path. Against the old hard-coded path this asserts
// FAIL (the canonical sentinel lives nowhere near the old location).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
const PROBE = path.join(
  REPO_ROOT,
  'packages/runtime/orchestration/doctor/probes/partition-sentinel.js',
);
const LIBRARY_PATHS = path.join(REPO_ROOT, 'packages/kernel/_lib/library-paths.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    process.stdout.write(`  PASS ${name}\n`);
    passed++;
  } catch (e) {
    process.stdout.write(`  FAIL ${name}: ${e.message}\n`);
    failed++;
  }
}

/** Run the probe under a controlled env (fresh require cache per call). */
function runProbe(libraryRoot) {
  const prevRoot = process.env.CLAUDE_LIBRARY_ROOT;
  const prevTest = process.env.AGENT_TEAM_DOCTOR_TEST;
  process.env.CLAUDE_LIBRARY_ROOT = libraryRoot;
  delete process.env.AGENT_TEAM_DOCTOR_TEST; // avoid the synthetic test-fixture early-return
  delete require.cache[require.resolve(PROBE)];
  delete require.cache[require.resolve(LIBRARY_PATHS)];
  try {
    const probe = require(PROBE);
    return probe.run({});
  } finally {
    if (prevRoot === undefined) delete process.env.CLAUDE_LIBRARY_ROOT;
    else process.env.CLAUDE_LIBRARY_ROOT = prevRoot;
    if (prevTest === undefined) delete process.env.AGENT_TEAM_DOCTOR_TEST;
    else process.env.AGENT_TEAM_DOCTOR_TEST = prevTest;
    delete require.cache[require.resolve(PROBE)];
    delete require.cache[require.resolve(LIBRARY_PATHS)];
  }
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'partition-sentinel-test-'));
try {
  const libRoot = path.join(tmpRoot, 'library');
  fs.mkdirSync(libRoot, { recursive: true });

  test('passes when sentinel exists at the canonical partitionSentinelPath()', () => {
    const libraryPaths = require(LIBRARY_PATHS);
    const prevRoot = process.env.CLAUDE_LIBRARY_ROOT;
    process.env.CLAUDE_LIBRARY_ROOT = libRoot;
    delete require.cache[require.resolve(LIBRARY_PATHS)];
    const canonical = require(LIBRARY_PATHS).partitionSentinelPath();
    if (prevRoot === undefined) delete process.env.CLAUDE_LIBRARY_ROOT;
    else process.env.CLAUDE_LIBRARY_ROOT = prevRoot;
    delete require.cache[require.resolve(LIBRARY_PATHS)];

    // Sanity: the canonical path is <library-root>/.partition-complete, NOT
    // the old hard-coded sections/agents/stacks/identities location.
    assert.strictEqual(canonical, path.join(libRoot, '.partition-complete'));
    assert.ok(!canonical.includes(path.join('stacks', 'identities')),
      'canonical sentinel must not live under stacks/identities');

    fs.writeFileSync(canonical, 'run_id: test\n');

    const result = runProbe(libRoot);
    assert.strictEqual(result.status, 'pass', `expected pass, got ${result.status}`);
    assert.strictEqual(result.details.sentinel, 'present');
    assert.strictEqual(result.details.sentinel_path, canonical);
    void libraryPaths;
  });

  test('does not pass for the OLD hard-coded sections/agents/stacks/identities path', () => {
    // Create a sentinel ONLY at the legacy hard-coded location. The fixed probe
    // reads the canonical path, so this must NOT flip the probe to `pass`.
    const legacy = path.join(
      libRoot, 'sections', 'agents', 'stacks', 'identities', '.partition-complete',
    );
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, 'run_id: legacy\n');

    // Remove the canonical sentinel created by the previous test so only the
    // legacy one is present.
    const canonical = path.join(libRoot, '.partition-complete');
    if (fs.existsSync(canonical)) fs.rmSync(canonical);

    const result = runProbe(libRoot);
    assert.notStrictEqual(result.status, 'pass',
      'legacy-only sentinel must not satisfy the canonical-path probe');
  });
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

process.stdout.write(`\npartition-sentinel.test: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
