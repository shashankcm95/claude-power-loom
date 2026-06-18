#!/usr/bin/env node
'use strict';

// tests/unit/lab/persona-experiment/arm-compose.test.js — 3.1-W3a
//
// composeArm — the per-arm prompt composer. The experiment's three arms differ by EXACTLY
// one delta each:
//   A (bare)     = task only
//   B (styled)   = archetype (agents/<persona>.md SOURCE body) + task
//   C (grounded) = archetype + the grounding-slice block + task
// The generic build-spawn-context toolkit prefix is EXCLUDED entirely (the experiment
// isolates [archetype, earned-slice] — toolkit ADRs are noise). MUST be deterministic and
// identical-except-the-delta across arms (no accidental ordering/whitespace confound).
//
// Oracle discipline (Rule-2a): the default loader reads a REAL agents/*.md archetype
// (node-backend) off disk; tests also inject a fixed loader seam so the composition is
// asserted deterministically + the missing-archetype error path is exercised.

const assert = require('assert');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const { composeArm, ARMS } = require(path.join(REPO_ROOT, 'packages', 'lab', 'persona-experiment', 'arm-compose.js'));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

const TASK = 'Fix the off-by-one in the pagination cursor.';
const ARCHETYPE = 'You are a senior Node backend developer. Validate at the edge.';
const SLICE = '- Validate the request body at ingress.\n- Never String-coerce wire data.';

// an injected loader seam: deterministic, no file I/O.
function fixedLoader(persona) {
  if (persona === 'node-backend') return ARCHETYPE;
  return null; // unknown persona -> no archetype
}

// --- the three arms ---
test('arm A (bare) is the task ONLY (no archetype, no grounding)', () => {
  const out = composeArm('A', { persona: 'node-backend', task: TASK, grounding: SLICE, loadArchetype: fixedLoader });
  assert.ok(out.includes(TASK), 'task must be present');
  assert.ok(!out.includes(ARCHETYPE), 'arm A must NOT include the archetype');
  assert.ok(!out.includes(SLICE), 'arm A must NOT include the grounding slice');
});

test('arm B (styled) is archetype + task (no grounding)', () => {
  const out = composeArm('B', { persona: 'node-backend', task: TASK, grounding: SLICE, loadArchetype: fixedLoader });
  assert.ok(out.includes(ARCHETYPE), 'arm B must include the archetype');
  assert.ok(out.includes(TASK), 'arm B must include the task');
  assert.ok(!out.includes(SLICE), 'arm B must NOT include the grounding slice');
});

test('arm C (grounded) is archetype + grounding + task', () => {
  const out = composeArm('C', { persona: 'node-backend', task: TASK, grounding: SLICE, loadArchetype: fixedLoader });
  assert.ok(out.includes(ARCHETYPE), 'arm C must include the archetype');
  assert.ok(out.includes(SLICE), 'arm C must include the grounding slice');
  assert.ok(out.includes(TASK), 'arm C must include the task');
});

// --- identical-except-the-delta (no confound) ---
test('B is A + the archetype delta (the task segment is byte-identical across arms)', () => {
  const a = composeArm('A', { persona: 'node-backend', task: TASK, grounding: SLICE, loadArchetype: fixedLoader });
  const b = composeArm('B', { persona: 'node-backend', task: TASK, grounding: SLICE, loadArchetype: fixedLoader });
  // the task segment present in A must appear verbatim (same surrounding whitespace) in B.
  assert.ok(b.endsWith(a), `B must end with the exact A composition\nA=${JSON.stringify(a)}\nB=${JSON.stringify(b)}`);
});

test('C is B + the grounding delta (B is a suffix-aligned subset of C minus the slice)', () => {
  const b = composeArm('B', { persona: 'node-backend', task: TASK, grounding: SLICE, loadArchetype: fixedLoader });
  const c = composeArm('C', { persona: 'node-backend', task: TASK, grounding: SLICE, loadArchetype: fixedLoader });
  // C must contain B's archetype block and B's task block; the only addition is the slice.
  assert.ok(c.includes(ARCHETYPE), 'C keeps B archetype');
  assert.ok(c.includes(TASK), 'C keeps the task');
  assert.ok(c.includes(SLICE), 'C adds the slice');
  // removing the slice block (slice + its trailing separator) from C yields EXACTLY B — proving
  // the only delta is the slice, with no ordering/whitespace confound.
  const cWithoutSlice = c.replace(SLICE + '\n\n', '');
  assert.strictEqual(cWithoutSlice, b, `C minus the slice must equal B\nB=${JSON.stringify(b)}\nC-=${JSON.stringify(cWithoutSlice)}`);
});

test('the task text is byte-identical in all 3 arms (the held-constant given)', () => {
  const a = composeArm('A', { persona: 'node-backend', task: TASK, grounding: SLICE, loadArchetype: fixedLoader });
  const b = composeArm('B', { persona: 'node-backend', task: TASK, grounding: SLICE, loadArchetype: fixedLoader });
  const c = composeArm('C', { persona: 'node-backend', task: TASK, grounding: SLICE, loadArchetype: fixedLoader });
  for (const out of [a, b, c]) assert.ok(out.includes(TASK));
});

// --- the generic toolkit prefix is EXCLUDED ---
test('NO generic build-spawn-context toolkit prefix leaks into any arm', () => {
  const c = composeArm('C', { persona: 'node-backend', task: TASK, grounding: SLICE, loadArchetype: fixedLoader });
  // markers the build-spawn-context prefix would carry (ADR/KB scaffolding) must be absent.
  assert.ok(!/build-spawn-context/i.test(c));
  assert.ok(!/ADR-00\d\d/.test(c), 'no ADR scaffolding from the generic prefix');
  assert.ok(!/kb_scope/i.test(c), 'no kb_scope scaffolding from the generic prefix');
});

// --- determinism ---
test('composition is DETERMINISTIC (two calls byte-identical)', () => {
  const a = composeArm('C', { persona: 'node-backend', task: TASK, grounding: SLICE, loadArchetype: fixedLoader });
  const b = composeArm('C', { persona: 'node-backend', task: TASK, grounding: SLICE, loadArchetype: fixedLoader });
  assert.strictEqual(a, b);
});

// --- empty grounding (arm C degrades to EXACTLY arm B) ---
test('arm C with an EMPTY grounding slice is BYTE-IDENTICAL to arm B (degrade-to-B contract)', () => {
  const cEmpty = composeArm('C', { persona: 'node-backend', task: TASK, grounding: '', loadArchetype: fixedLoader });
  const bArm = composeArm('B', { persona: 'node-backend', task: TASK, loadArchetype: fixedLoader });
  assert.ok(cEmpty.includes(ARCHETYPE) && cEmpty.includes(TASK));
  assert.strictEqual(cEmpty, bArm, 'arm C with empty grounding must be byte-identical to arm B (no dangling block/separator)');
});

// --- missing archetype -> explicit error (NOT a silent empty archetype) ---
test('a persona with no agents/<persona>.md THROWS for arm B (explicit, not silent-empty)', () => {
  assert.throws(
    () => composeArm('B', { persona: 'does-not-exist', task: TASK, loadArchetype: fixedLoader }),
    /archetype/i
  );
});

test('a persona with no agents/<persona>.md THROWS for arm C', () => {
  assert.throws(
    () => composeArm('C', { persona: 'does-not-exist', task: TASK, grounding: SLICE, loadArchetype: fixedLoader }),
    /archetype/i
  );
});

test('arm A does NOT require an archetype (bare arm never loads it)', () => {
  // even an unknown persona composes for arm A (task only).
  const out = composeArm('A', { persona: 'does-not-exist', task: TASK, loadArchetype: fixedLoader });
  assert.ok(out.includes(TASK));
});

// --- input validation ---
test('an unknown arm name THROWS', () => {
  assert.throws(() => composeArm('Z', { persona: 'node-backend', task: TASK, loadArchetype: fixedLoader }), /arm/i);
});
test('a missing task THROWS', () => {
  assert.throws(() => composeArm('A', { persona: 'node-backend', loadArchetype: fixedLoader }), /task/i);
});
test('ARMS exports the frozen arm set', () => {
  assert.ok(Array.isArray(ARMS) && ARMS.includes('A') && ARMS.includes('B') && ARMS.includes('C'));
  assert.ok(Object.isFrozen(ARMS));
});

// --- the DEFAULT loader reads the real agents/*.md off disk ---
test('the default loader reads the REAL agents/node-backend.md archetype (arm B)', () => {
  // no injected loader -> the module reads agents/node-backend.md SOURCE body.
  const out = composeArm('B', { persona: 'node-backend', task: TASK });
  assert.ok(out.includes(TASK));
  // the real node-backend.md body contains this signature phrase from its frontmatter/body.
  assert.ok(/node-backend|Node backend|async/i.test(out), 'expected the real archetype prose');
});

test('the default loader THROWS for a non-existent agents/*.md (arm B)', () => {
  assert.throws(() => composeArm('B', { persona: 'definitely-not-a-real-persona-xyz', task: TASK }), /archetype/i);
});

process.stdout.write('\n=== arm-compose.test.js Summary ===\n');
process.stdout.write(`  Passed: ${passed}\n  Failed: ${failed}\n`);
if (failed > 0) process.exit(1);
