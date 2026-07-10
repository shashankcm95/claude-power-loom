#!/usr/bin/env node

// tests/unit/kernel/_lib/persona-md-reader.test.js
//
// Coverage for the persona .md reader relocated kernel-side (RFC 2026-07-10,
// Option A — closing the one real kernel->runtime import edge). Behavior-invariant
// relocation of the former lifecycle-spawn.js `_readPersonaMd`.
//
// House test pattern: imperative assert + hand-rolled runner + exit code.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readPersonaMd } = require('../../../../packages/kernel/_lib/persona-md-reader');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// Helper: run fn with HETS_PERSONAS_DIR set to a fresh tmp dir, then restore.
function withPersonasDir(fn) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pmd-'));
  const prev = process.env.HETS_PERSONAS_DIR;
  try {
    process.env.HETS_PERSONAS_DIR = d;
    fn(d);
  } finally {
    if (prev === undefined) delete process.env.HETS_PERSONAS_DIR;
    else process.env.HETS_PERSONAS_DIR = prev;
    fs.rmSync(d, { recursive: true, force: true });
  }
}

test('reads a .md from the HETS_PERSONAS_DIR override', () => {
  withPersonasDir((d) => {
    fs.writeFileSync(path.join(d, 'demo.md'), 'DEMO-BODY');
    assert.strictEqual(readPersonaMd('demo'), 'DEMO-BODY');
  });
});

test('returns null for an absent persona (fail-soft → SynthId agent_md_hash falls back to null)', () => {
  withPersonasDir(() => {
    assert.strictEqual(readPersonaMd('no-such-persona-xyz'), null);
  });
});

test('env override is read per-call, not captured at module load', () => {
  // First call with dir A, then a second call with dir B in the same process must
  // see B (the reader reads process.env inside the function, not at require time).
  withPersonasDir((a) => {
    fs.writeFileSync(path.join(a, 'p.md'), 'A');
    assert.strictEqual(readPersonaMd('p'), 'A');
  });
  withPersonasDir((b) => {
    fs.writeFileSync(path.join(b, 'p.md'), 'B');
    assert.strictEqual(readPersonaMd('p'), 'B');
  });
});

test('rejects a traversal persona segment (no read outside the personas dir)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pmd-'));
  const prev = process.env.HETS_PERSONAS_DIR;
  try {
    // Plant a readable .md OUTSIDE the personas dir; a `../` persona must NOT reach it.
    fs.writeFileSync(path.join(d, 'secret.md'), 'TOP-SECRET');
    process.env.HETS_PERSONAS_DIR = path.join(d, 'personas');
    fs.mkdirSync(process.env.HETS_PERSONAS_DIR, { recursive: true });
    for (const evil of ['../secret', '..', '.', 'a/b', '/etc/passwd', '']) {
      assert.strictEqual(readPersonaMd(evil), null, `traversal not blocked for ${JSON.stringify(evil)}`);
    }
  } finally {
    if (prev === undefined) delete process.env.HETS_PERSONAS_DIR;
    else process.env.HETS_PERSONAS_DIR = prev;
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('never throws — returns null for non-string / edge inputs (fully fail-soft)', () => {
  for (const bad of [undefined, null, 42, {}, [], '', '   ']) {
    let r;
    assert.doesNotThrow(() => { r = readPersonaMd(bad); }, `threw for ${JSON.stringify(bad)}`);
    assert.strictEqual(r, null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('default location resolves under packages/runtime/personas (reads a real brief)', () => {
  const prev = process.env.HETS_PERSONAS_DIR;
  try {
    delete process.env.HETS_PERSONAS_DIR;
    const md = readPersonaMd('04-architect');
    assert.ok(typeof md === 'string' && md.length > 0, 'expected 04-architect.md content');
  } finally {
    if (prev !== undefined) process.env.HETS_PERSONAS_DIR = prev;
  }
});

process.stdout.write(`\npersona-md-reader.test: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
