#!/usr/bin/env node
'use strict';

// tests/unit/lab/persona-experiment/persona-prompt-materializer.test.js - item 4 (D4, D6, D8)
//
// materialize(persona) -> { block, bytes } | null. Re-validates via canonicalPersonaKey against
// materializablePersonas (fold L1, HARD), resolves the numbered brief basename, reads the brief
// .md + contract .json as DATA from a __dirname-relative CONSTANT path (NEVER interpolating raw
// input into a path - CWE-22), extracts ## Identity + the VERBATIM ## Mindset prose + the
// output_schema.required + skill names, and bounds the block with renderFencedBoundedBlock under
// a module-private MATERIALIZE_MAX_BYTES (NO opts override on the public signature - fold H2).
// ALL reads + JSON.parse + section-extraction in ONE try/catch -> null on ANY failure (fold M2).

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const MAT_PATH = path.join(REPO_ROOT, 'packages', 'lab', 'persona-experiment', 'persona-prompt-materializer.js');
const { materialize, _materializeWithDeps } = require(MAT_PATH);
const MODULE_SRC = fs.readFileSync(MAT_PATH, 'utf8');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// --- happy path: node-backend + security-auditor both materialize verbatim instinct prose ---
test('materialize(node-backend) is non-null, contains a verbatim Mindset instinct phrase, under the cap', () => {
  const r = materialize('node-backend');
  assert.ok(r && typeof r.block === 'string', 'must return a block');
  // a VERBATIM phrase from the node-backend ## Mindset (instinct PROSE, not just the name)
  assert.ok(r.block.includes('Event-loop-protection'), 'must include the verbatim instinct name');
  assert.ok(r.block.includes('block the single thread'), 'must include verbatim instinct PROSE, not just the name (fold H1)');
  assert.ok(r.bytes <= 8000, `block must be under the cap, got ${r.bytes}`);
  assert.strictEqual(r.bytes, Buffer.byteLength(r.block, 'utf8'));
});
test('materialize(security-auditor) maps via the alias and contains a verbatim Mindset phrase', () => {
  const r = materialize('security-auditor');
  assert.ok(r && typeof r.block === 'string', 'must return a block (alias -> 12-security-engineer)');
  assert.ok(r.block.includes('Threat-model-first'), 'must include the verbatim instinct name from 12-security-engineer');
  assert.ok(r.block.includes('STRIDE') || r.block.includes('attack-tree'), 'must include verbatim instinct prose');
  assert.ok(r.bytes <= 8000);
});
test('the materialized block names the output schema required fields and the skills', () => {
  const r = materialize('node-backend');
  assert.ok(r.block.includes('findings') && r.block.includes('file_citations'), 'output_schema.required must be present');
  assert.ok(r.block.includes('node-backend-development'), 'the required skill name must be present');
  assert.ok(/PERSONA ACTIVATION/i.test(r.block), 'the block must be a labeled advisory activation section');
});

// --- Track A W2: the two persona pins (persona_def_ref = definition-version identity; context_commons_ref
//     = the received-block digest). Both 64-hex, deterministic, content-dependent, canonical-structure. ---
const HEX64 = /^[0-9a-f]{64}$/;
test('materialize returns persona_def_ref + context_commons_ref: both 64-hex, deterministic, and DISTINCT', () => {
  const a = materialize('node-backend');
  const b = materialize('node-backend');
  assert.ok(HEX64.test(a.persona_def_ref), 'persona_def_ref is a 64-hex content-address');
  assert.ok(HEX64.test(a.context_commons_ref), 'context_commons_ref is a 64-hex content-address');
  assert.strictEqual(a.persona_def_ref, b.persona_def_ref, 'persona_def_ref is deterministic for identical inputs');
  assert.strictEqual(a.context_commons_ref, b.context_commons_ref, 'context_commons_ref is deterministic');
  assert.notStrictEqual(a.persona_def_ref, a.context_commons_ref, 'the definition ref and the received-block ref hash different things');
});
test('persona_def_ref DIFFERS across personas (it binds the brief + contract bytes)', () => {
  const nb = materialize('node-backend');
  const sa = materialize('security-auditor');
  assert.notStrictEqual(nb.persona_def_ref, sa.persona_def_ref, 'a different persona definition -> a different ref');
  assert.notStrictEqual(nb.context_commons_ref, sa.context_commons_ref, 'a different rendered block -> a different received ref');
});
test('persona_def_ref uses a canonical STRUCTURE, not a raw concat (a brief/contract boundary shift changes it)', () => {
  // VERIFY architect L1 / hacker M2: sha256(brief || contract) collides across a boundary shift; the
  // structured sha256(canonicalJsonSerialize([brief, contract])) does not. Move a char from the brief tail
  // into the contract via the deps seam; the ref MUST change (a bare concat would keep it identical).
  const mindset = '\n## Mindset\n1. **F** - body.\n';
  const mk = (briefTail, contractName) => _materializeWithDeps('node-backend', {
    readFileFn: (p) => (String(p).endsWith('.json')
      ? JSON.stringify({ persona: contractName, skills: { required: ['x'] }, interface: { output_schema: { required: ['findings'] } } })
      : `## Identity\nid${briefTail}${mindset}`),
  });
  const a = mk('AB', '13-node-backend');
  const b = mk('A', 'B13-node-backend');   // one char moved brief->contract; a flat concat would collide
  assert.ok(a && b, 'both materialize');
  assert.notStrictEqual(a.persona_def_ref, b.persona_def_ref, 'a boundary shift must change the structured ref');
});

// --- non-builder / unknown -> null ---
test('materialize(optimizer) -> null (not a builder)', () => {
  assert.strictEqual(materialize('optimizer'), null);
});
test('materialize(unknown) -> null', () => {
  assert.strictEqual(materialize('definitely-not-a-real-persona'), null);
});

// --- CWE-22 path traversal: RED-then-green NON-VACUOUS ---
test('materialize(../evil) -> null (path traversal rejected at the canonical-key gate)', () => {
  assert.strictEqual(materialize('../evil'), null);
});
test('materialize(13-../../etc/passwd) -> null (no separator survives validation)', () => {
  assert.strictEqual(materialize('13-../../etc/passwd'), null);
  assert.strictEqual(materialize('13-../../../etc'), null);
});
test('materialize with whitespace / empty / non-string -> null', () => {
  assert.strictEqual(materialize(' '), null);
  assert.strictEqual(materialize(''), null);
  assert.strictEqual(materialize(null), null);
  assert.strictEqual(materialize(13), null);
});

// --- the public signature exposes NO maxBytes param (fold H2) ---
test('the public materialize signature exposes NO maxBytes override (security.md non-bypassable cap)', () => {
  // arity is exactly 1 (persona). A second arg must not be a public byte-cap override.
  assert.strictEqual(materialize.length, 1, 'materialize must take exactly one public param');
  // and the cap is a module-private const, not read off opts in the public path
  assert.ok(/const\s+MATERIALIZE_MAX_BYTES\s*=/.test(MODULE_SRC), 'MATERIALIZE_MAX_BYTES must be a module-private const');
});

// --- fold M2: a malformed contract JSON -> null (via the deps seam) ---
test('a malformed contract JSON -> null (the whole compose fails closed)', () => {
  const r = _materializeWithDeps('node-backend', {
    readFileFn: (p) => {
      if (String(p).endsWith('.json')) return '{ this is not valid json ';
      return '# Persona\n## Identity\nx\n## Mindset\n1. **Foo** - bar.\n## Next\n';
    },
  });
  assert.strictEqual(r, null, 'a malformed contract must fail closed to null (fold M2)');
});
test('a missing ## Mindset section -> null (fold M2)', () => {
  const r = _materializeWithDeps('node-backend', {
    readFileFn: (p) => {
      if (String(p).endsWith('.json')) return JSON.stringify({ persona: '13-node-backend', skills: { required: ['x'] }, interface: { output_schema: { required: ['findings'] } } });
      return '# Persona\n## Identity\nonly identity, no mindset here\n## Focus\n';
    },
  });
  assert.strictEqual(r, null, 'a brief missing ## Mindset must fail closed (fold M2)');
});
test('a read that throws (ENOENT/EACCES) -> null (fold M2)', () => {
  const r = _materializeWithDeps('node-backend', {
    readFileFn: () => { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; },
  });
  assert.strictEqual(r, null, 'an unreadable source must fail closed to null');
});

// --- the deps path still confines to the validated NN-name (no raw input in a path) ---
test('the deps seam still rejects a non-builder before any read (no path built from raw input)', () => {
  let read = false;
  const r = _materializeWithDeps('../evil', { readFileFn: () => { read = true; return 'x'; } });
  assert.strictEqual(r, null);
  assert.strictEqual(read, false, 'a rejected persona must never reach a file read (path never built from raw input)');
});

// --- static: no packages/runtime require (lab->runtime import ban) ---
test('persona-prompt-materializer.js does NOT require anything from packages/runtime', () => {
  assert.ok(!/require\(['"][^'"]*packages\/runtime/.test(MODULE_SRC), 'must not require from packages/runtime');
  assert.ok(!/require\(['"]\.\.\/\.\.\/runtime/.test(MODULE_SRC), 'must not require a relative runtime path');
});

// === honesty-F1 - the LAST named instinct (the TAIL) survives + truncated===false ===========
// A future brief growth that pushes the tail past the cap must go RED here, not silently drop the
// last instinct. Read the real ## Mindset, take the LAST `**Name**` + a verbatim slice after it.
const PERSONAS_DIR = path.join(REPO_ROOT, 'packages', 'runtime', 'personas');
function mindsetSection(briefBase) {
  const md = fs.readFileSync(path.join(PERSONAS_DIR, `${briefBase}.md`), 'utf8');
  const lines = md.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) { if (lines[i].trim() === '## Mindset') { start = i + 1; break; } }
  const body = [];
  for (let i = start; i < lines.length; i += 1) { if (/^##\s/.test(lines[i])) break; body.push(lines[i]); }
  return body.join('\n');
}
function lastInstinctName(briefBase) {
  const section = mindsetSection(briefBase);
  const names = [...section.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1]);
  return names.length > 0 ? names[names.length - 1] : null;
}
for (const [persona, briefBase] of [['node-backend', '13-node-backend'], ['security-auditor', '12-security-engineer']]) {
  test(`honesty-F1: the LAST instinct of ${briefBase} survives in materialize(${persona}) + truncated===false`, () => {
    const r = materialize(persona);
    assert.ok(r && typeof r.block === 'string', 'must materialize');
    const lastName = lastInstinctName(briefBase);
    assert.ok(lastName && lastName.length > 0, 'the brief must have at least one named instinct');
    assert.ok(r.block.includes(`**${lastName}**`), `the LAST instinct "${lastName}" verbatim prose must survive (no silent tail-drop)`);
    assert.strictEqual(r.truncated, false, `materialize(${persona}) must NOT truncate (cap has headroom; a future growth that truncates goes RED here)`);
  });
}

// === honesty-F2 - L1 builder-allowlist gate is load-bearing (not redundant with shape guards) =
test('honesty-F2: materialize(architect) -> null (resolves to a brief but is NOT a builder; L1 rejects)', () => {
  // 'architect' is a real agentType with a brief (04-architect) but is NOT in BUILDER_PERSONAS, so
  // it is NOT in materializablePersonas(); the L1 canonicalPersonaKey-against-materializable gate is
  // the ONLY thing that rejects it (the shape guards would pass 'architect'). This proves L1 is
  // load-bearing, not redundant.
  assert.strictEqual(materialize('architect'), null);
  assert.strictEqual(materialize('code-reviewer'), null);
  assert.strictEqual(materialize('hacker'), null);
});

process.stdout.write('\n=== persona-prompt-materializer.test.js Summary ===\n');
process.stdout.write(`  Passed: ${passed}\n  Failed: ${failed}\n`);
if (failed > 0) process.exit(1);
