#!/usr/bin/env node
'use strict';

// tests/unit/lab/persona-experiment/canonical-persona-key.test.js — 3.1-W3a
//
// C2 read-side normalization (fork 1). Both the bare agentType `node-backend` and the
// numbered roster form `13-node-backend` MUST canonicalize to ONE bare key, so a slice
// over a persona's experience never returns a disjoint subgraph. Unknown / unvalidatable
// / non-string input -> null (NEVER a silent wrong-key, never a guess — the laundering
// lever the hacker lens probes).
//
// K12: the module derives the known-bare set from agents/*.md (no packages/runtime import);
// these tests inject a FIXED set so the assertions are deterministic regardless of the
// live agents/ tree, plus one default-set smoke that proves the glob path works.

const assert = require('assert');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const { canonicalPersonaKey } = require(path.join(REPO_ROOT, 'packages', 'lab', 'persona-experiment', 'canonical-persona-key.js'));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

const KNOWN = ['node-backend', 'architect', 'code-reviewer', 'hacker'];

// --- both shapes collapse to the SAME bare key ---
test('bare agentType resolves to itself', () => {
  assert.strictEqual(canonicalPersonaKey('node-backend', { knownPersonas: KNOWN }), 'node-backend');
});
test('numbered roster form strips the prefix to the bare key', () => {
  assert.strictEqual(canonicalPersonaKey('13-node-backend', { knownPersonas: KNOWN }), 'node-backend');
});
test('bare and numbered forms collapse to ONE key (the C2 fragmentation fix)', () => {
  const a = canonicalPersonaKey('node-backend', { knownPersonas: KNOWN });
  const b = canonicalPersonaKey('13-node-backend', { knownPersonas: KNOWN });
  assert.strictEqual(a, b);
  assert.strictEqual(a, 'node-backend');
});
test('a multi-digit numbered prefix strips correctly', () => {
  assert.strictEqual(canonicalPersonaKey('999-architect', { knownPersonas: KNOWN }), 'architect');
});

// --- unknown / unvalidatable -> null (NEVER a silent wrong-key) ---
test('an unknown bare persona resolves to null (not a guess)', () => {
  assert.strictEqual(canonicalPersonaKey('python-backend', { knownPersonas: KNOWN }), null);
});
test('an unknown numbered persona resolves to null after the strip fails validation', () => {
  assert.strictEqual(canonicalPersonaKey('77-python-backend', { knownPersonas: KNOWN }), null);
});
test('a non-string input resolves to null', () => {
  assert.strictEqual(canonicalPersonaKey(13, { knownPersonas: KNOWN }), null);
  assert.strictEqual(canonicalPersonaKey(null, { knownPersonas: KNOWN }), null);
  assert.strictEqual(canonicalPersonaKey(undefined, { knownPersonas: KNOWN }), null);
  assert.strictEqual(canonicalPersonaKey({ role: 'node-backend' }, { knownPersonas: KNOWN }), null);
  assert.strictEqual(canonicalPersonaKey(['node-backend'], { knownPersonas: KNOWN }), null);
});
test('an empty / whitespace string resolves to null', () => {
  assert.strictEqual(canonicalPersonaKey('', { knownPersonas: KNOWN }), null);
  assert.strictEqual(canonicalPersonaKey('   ', { knownPersonas: KNOWN }), null);
});

// --- laundering-lever defense (the hacker-lens probe codified) ---
test('a crafted string cannot fold two identities into one key', () => {
  // "node-backend-architect" must NOT validate as either node-backend or architect.
  assert.strictEqual(canonicalPersonaKey('node-backend-architect', { knownPersonas: KNOWN }), null);
});
test('a numbered prefix on an unknown bare does NOT launder into a known key', () => {
  // only the EXACT bare result validated against the set is accepted.
  assert.strictEqual(canonicalPersonaKey('13-node-backendX', { knownPersonas: KNOWN }), null);
});
test('only a leading ^\\d+- prefix is stripped (an interior digit run is left intact)', () => {
  // "node-13-backend" is not a known persona and is not a numbered prefix -> null.
  assert.strictEqual(canonicalPersonaKey('node-13-backend', { knownPersonas: KNOWN }), null);
});
test('a bare-with-trailing-prefix-only string (e.g. "13-") resolves to null', () => {
  assert.strictEqual(canonicalPersonaKey('13-', { knownPersonas: KNOWN }), null);
});
test('a path-traversal-shaped input resolves to null (no separator survives validation)', () => {
  assert.strictEqual(canonicalPersonaKey('../node-backend', { knownPersonas: KNOWN }), null);
  assert.strictEqual(canonicalPersonaKey('13-../architect', { knownPersonas: KNOWN }), null);
});

// --- the default knownPersonas glob (real agents/*.md) ---
test('the default known-persona set is globbed from agents/*.md (node-backend present)', () => {
  // No injected set -> the module must glob the real agents/ tree. node-backend exists.
  assert.strictEqual(canonicalPersonaKey('node-backend'), 'node-backend');
  assert.strictEqual(canonicalPersonaKey('13-node-backend'), 'node-backend');
});
test('the default set rejects a persona with no agents/*.md', () => {
  assert.strictEqual(canonicalPersonaKey('definitely-not-a-real-persona'), null);
});

// --- an empty knownPersonas set rejects everything (no silent accept-all) ---
test('an empty knownPersonas set resolves everything to null', () => {
  assert.strictEqual(canonicalPersonaKey('node-backend', { knownPersonas: [] }), null);
});

process.stdout.write('\n=== canonical-persona-key.test.js Summary ===\n');
process.stdout.write(`  Passed: ${passed}\n  Failed: ${failed}\n`);
if (failed > 0) process.exit(1);
