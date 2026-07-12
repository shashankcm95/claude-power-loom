#!/usr/bin/env node

// tests/integration/recall-inject-boundary.integration.js
//
// INTEGRATION (Track A / phase-close 3c): the A1 recall-inject boundary end-to-end, driving the REAL
// world-anchored-recall CLI as a SUBPROCESS. Distinct from the unit tier
// (`tests/unit/lab/persona-experiment/recall-inject-boundary.test.js` + `live-draft-recall-wire.test.js`),
// which inject an `execFn`/`spawnArgsFn` MOCK and so never spawn the real CLI. This test STRUCTURALLY covers
// what the unit tier cannot:
//   (a) it spawns the REAL `world-anchored-recall-cli.js` via the boundary's default `execFn` (real
//       `execFileSync`) - exercising the shebang, `require.main === module`, real `process.argv`, the SINGLE
//       stdout JSON write the boundary's `JSON.parse` consumes, and the process exit code.
//   (b) it asserts the REAL CLI-to-boundary JSON contract: the CLI emits exactly one `{instincts, ranked,
//       shadow_empty, diagnostics}` object, and the boundary parses it + renders the SHADOW-empty wire as ''
//       (byte-inert bare prompt), NOT as a fail-closed refusal.
//
// SHADOW note (the honest coverage bound): on every dev/CI box the retriever's admission is frozen-empty
// (`world-anchored-recall.js`: no live-source injection seam; every node weighs 0), so the real subprocess
// returns `instincts: []` UNCONDITIONALLY. The NON-EMPTY recall -> fenced-block path (a real admitted lesson
// rendered into the actor prompt) is exercised by the unit tier (injected instincts) and is a NAMED
// operator-armed residual on the real path (it closes only on a DEPLOYED + ATTESTED cross-uid broker - never
// in-process, never Claude). This test proves the real WIRE (spawn + JSON contract + byte-inert empty +
// fail-closed-observable), which is the in-process-buildable half.
//
// The two seams stubbed are EXACTLY the two operator-arming artifacts (never the exec): `launchFn` -> 'present'
// stands in for a deployed cross-uid launcher (so the test never stats /etc/loom via the default resolver), and
// `spawnArgsFn` -> a direct `node <cli>` command stands in for the operator's `sudo -n -u <uid> <wrapper>`
// builder. The subprocess is REAL; only the deploy artifacts are stubbed.
//
// CI contract: run by the `integration-tests` job as `node "$f"`. A failed `assert.*` throws -> uncaught ->
// non-zero exit. NO top-level try/catch that swallows an assertion.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Isolate the lab stores to a throwaway base BEFORE the subprocess reads them (the recall CLI captures
// LOOM_LAB_STATE_DIR at its own module load; the boundary's default execFn omits `env`, so the child inherits
// this process.env - set it here and the empty isolated store is what the real CLI reads).
const STATE_BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-a1-labstate-'));
process.env.LOOM_LAB_STATE_DIR = STATE_BASE;
// STRICT enable: without it the boundary returns '' at the flag gate BEFORE any spawn, so the real-subprocess
// wire would never be exercised. (The CLI itself never reads this flag.)
process.env.LOOM_RECALL_INJECT = '1';

// tests/integration is 2 levels under the repo root - resolve from __dirname, never cwd (clean-checkout safe).
const REPO = path.join(__dirname, '..', '..');
const { retrieveRecallBlock, RECALL_CLI } = require(
  path.join(REPO, 'packages', 'lab', 'persona-experiment', 'recall-inject-boundary.js'),
);

let passed = 0;
function check(name, fn) { fn(); passed += 1; }

// The two operator-arming seams, stubbed (never the exec): a deployed 'present' launcher, and a direct
// same-uid `node <cli>` command standing in for the operator's cross-uid wrapper builder.
const presentLaunch = () => ({ mode: 'present', actorUser: 'test-actor', wrapperPath: '/nonexistent/wrapper' });
const directNodeSpawn = ({ cliPath, limit }) => ({ command: 'node', args: [cliPath, '--limit', String(limit)] });

// --- (a) the REAL CLI subprocess honors the single-object JSON contract the boundary parses ---
check('the real `node world-anchored-recall-cli.js` subprocess emits one SHADOW-empty JSON object', () => {
  const raw = execFileSync('node', [RECALL_CLI, '--limit', '8'], {
    env: { ...process.env, LOOM_LAB_STATE_DIR: STATE_BASE }, encoding: 'utf8',
  });
  const parsed = JSON.parse(raw);                       // MUST be exactly one object (the boundary's JSON.parse contract)
  assert.strictEqual(parsed.shadow_empty, true, 'an empty/un-armed store is SHADOW-empty');
  assert.deepStrictEqual(parsed.instincts, [], 'no admitted instincts in SHADOW (frozen-empty LIVE_SOURCES)');
  assert.strictEqual(parsed.diagnostics.error, false, 'a clean read, not a fail-closed degrade');
});

// --- (b) the boundary, driven through the REAL exec, renders the SHADOW-empty wire as byte-inert '' ---
check('the boundary drives the REAL subprocess + returns empty (byte-inert) with NO reason-bearing alert', () => {
  const emits = [];
  const block = retrieveRecallBlock({
    limit: 8,
    deps: {
      launchFn: presentLaunch,
      spawnArgsFn: directNodeSpawn,
      // execFn intentionally DEFAULTED -> the real child_process.execFileSync spawns the real CLI.
      emitFn: (reason, detail) => emits.push({ reason, detail }),
    },
  });
  assert.strictEqual(block, '', 'SHADOW-empty instincts -> a bare prompt, never an empty fenced frame');
  assert.strictEqual(emits.length, 0, 'the happy real-subprocess path is BENIGN: no egress alert (empty != fail-closed)');
});

// --- the fail-closed path is OBSERVABLE on a REAL failing exec (non-vacuous: inject the failure, watch it fire) ---
check('a REAL failing subprocess fails closed to empty AND emits recall-inject-spawn-failed', () => {
  const emits = [];
  const block = retrieveRecallBlock({
    limit: 8,
    deps: {
      launchFn: presentLaunch,
      // A REAL subprocess that exits non-zero QUIETLY (no stderr stack in CI logs) - exercises the boundary's
      // real-exec fail-closed catch without spawning a missing-module dump. execFileSync throws on status != 0.
      spawnArgsFn: () => ({ command: 'node', args: ['-e', 'process.exit(3)'] }),
      emitFn: (reason, detail) => emits.push({ reason, detail }),
    },
  });
  assert.strictEqual(block, '', 'a spawn failure fails closed to a bare prompt');
  assert.ok(
    emits.some((e) => e.reason === 'recall-inject-spawn-failed'),
    'the fail-closed reject is OBSERVABLE: a real exec failure emits recall-inject-spawn-failed',
  );
});

// best-effort cleanup (the OS reaps tmp anyway)
try { fs.rmSync(STATE_BASE, { recursive: true, force: true }); } catch { /* best-effort */ }

// A failed assert already throws uncaught -> non-zero exit; this floor catches a FUTURE edit that silently
// drops a check() (a coverage shrink) rather than green a shrunk suite.
assert.ok(passed >= 3, `anti-vacuity floor: expected >=3 checks, ran ${passed} (did an edit drop a check()?)`);
console.log(`${path.basename(__filename)}: ${passed} passed`);
