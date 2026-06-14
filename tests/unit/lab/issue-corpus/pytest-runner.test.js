'use strict';

// v3.9.x — the PURE parts of the pytest test-runner adapter (the command builder +
// the embedded wrapper's invariants). The real sandboxed run is the impure spike.

const assert = require('assert');
const { buildPytestCommand, PYTEST_WRAPPER } = require('../../../../packages/lab/issue-corpus/pytest-runner');
const { LOOM_TEST_RESULT_PREFIX } = require('../../../../packages/lab/issue-corpus/container-adapter');

let passed = 0;
function test(name, fn) { fn(); passed += 1; }

test('buildPytestCommand: {command, argv:[-c, WRAPPER, ...ids], limits}', () => {
  const cmd = buildPytestCommand({ test_ids: ['tests/t.py::A::test_x', 'tests/t.py::A::test_y'], pythonBin: '/usr/bin/python3' });
  assert.strictEqual(cmd.command, '/usr/bin/python3');
  assert.strictEqual(cmd.argv[0], '-c');
  assert.strictEqual(cmd.argv[1], PYTEST_WRAPPER);
  assert.deepStrictEqual(cmd.argv.slice(2), ['tests/t.py::A::test_x', 'tests/t.py::A::test_y'], 'nodeids ride as argv tail');
  assert.ok(Number.isInteger(cmd.wallClockMs) && Number.isInteger(cmd.cpuSec) && Number.isInteger(cmd.maxPids));
});

test('buildPytestCommand: drops non-string / empty test_ids; tolerates a missing list', () => {
  const cmd = buildPytestCommand({ test_ids: ['ok', '', null, 42, undefined, 'ok2'] });
  assert.deepStrictEqual(cmd.argv.slice(2), ['ok', 'ok2']);
  assert.deepStrictEqual(buildPytestCommand({}).argv.slice(2), [], 'no test_ids -> empty tail, no throw');
});

test('the wrapper emits the SAME sentinel parseTestStatus parses (single-source prefix)', () => {
  assert.ok(PYTEST_WRAPPER.includes(LOOM_TEST_RESULT_PREFIX), 'wrapper prints the LOOM_TEST_RESULT sentinel');
  // the sandbox-hardening the real run needed: writable TMPDIR under .loom-out + dont_write_bytecode
  assert.ok(/dont_write_bytecode/.test(PYTEST_WRAPPER), 'no __pycache__ writes (sandbox is write-scoped)');
  assert.ok(/\.loom-out/.test(PYTEST_WRAPPER) && /TMPDIR/.test(PYTEST_WRAPPER), 'TMPDIR redirected into the write-allowed path');
  assert.ok(/--basetemp/.test(PYTEST_WRAPPER), 'pytest basetemp pinned writable');
  // honest "missing" (never a false pass) for an un-run nodeid
  assert.ok(/missing/.test(PYTEST_WRAPPER), 'an un-run test defaults to missing, not pass');
});

console.log(`pytest-runner.test.js: ${passed} passed`);
