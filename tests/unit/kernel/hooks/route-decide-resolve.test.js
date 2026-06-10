#!/usr/bin/env node

// tests/unit/kernel/hooks/route-decide-resolve.test.js
//
// B1 (2026-06-10 chip): the route-decide hook must resolve route-decide.js via a
// __dirname-relative candidate FIRST (so it works under a pure plugin install where
// ~/.claude/packages/ does not exist), then the legacy homedir mirror. Prior code
// hardcoded ONLY the homedir path -> inert on a clean plugin install.
//
// The hook now guards main() behind `require.main === module`, so requiring it for
// the test does NOT read stdin / run the hook.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const HOOK = path.join(REPO, 'packages', 'kernel', 'hooks', 'pre', 'route-decide-on-agent-spawn.js');
const { resolveRouteDecidePath } = require(HOOK);

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

test('resolveRouteDecidePath returns a non-null path in-repo (the gate is NOT inert)', () => {
  const got = resolveRouteDecidePath();
  assert.ok(got, 'expected a resolved path, got ' + got);
  assert.ok(fs.existsSync(got), 'resolved path must exist');
});

test('resolves to the __dirname-relative candidate (packages/kernel/algorithms), NOT the homedir mirror', () => {
  const got = resolveRouteDecidePath();
  const expected = path.join(REPO, 'packages', 'kernel', 'algorithms', 'route-decide.js');
  assert.ok(fs.existsSync(expected), 'precondition: the in-repo route-decide.js exists');
  assert.strictEqual(
    fs.realpathSync(got),
    fs.realpathSync(expected),
    'must resolve the __dirname-relative copy (../../algorithms/route-decide.js), proving candidate ordering'
  );
});

process.stdout.write(`\nroute-decide-resolve.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
