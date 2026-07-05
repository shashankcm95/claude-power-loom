#!/usr/bin/env node

// tests/unit/scripts/memory-cli.test.js
//
// The `memory` CLI (scripts/memory.js) — block-addressable retrieval + LRU heat + budget/demote for the
// operating-memory system. Locks the block model (parse/resolve/anchor), the [[file#anchor]] pointer parse,
// the LRU hot-set ordering, importance-protection, and the demote-never-delete MOVE (verbatim to dest +
// a pointer in src). Isolated via tmp files.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..');
const M = require(path.join(REPO, 'scripts', 'memory.js'));

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}
function tmp(pfx) { return fs.mkdtempSync(path.join(os.tmpdir(), pfx)); }

const SCARS = [
  '# Scars (toolkit)', '', 'intro preamble line', '',
  '### SCAR-33 — CodeRabbit false-green', 'rate-limited green check.', 'second line.', '',
  '### SCAR-34 — test-fn hoisting collision', 'a late function shadows an earlier one.', '',
  '### SCAR-35 — lab-test opts.dir isolate', 'pin the store dir per test.', '',
].join('\n');

// ── slug + anchors ──
test('s1. slugify + shortAnchorOf', () => {
  assert.strictEqual(M.slugify('SCAR-33 — CodeRabbit false-green'), 'scar-33-coderabbit-false-green');
  assert.strictEqual(M.shortAnchorOf('SCAR-33 — CodeRabbit false-green'), 'scar-33');
  assert.strictEqual(M.shortAnchorOf('charter'), 'charter');
  assert.strictEqual(M.shortAnchorOf('W1 MERGED: the thing'), 'w1-merged');
});

// ── parseBlocks ──
test('s2. parseBlocks splits H3 blocks, keeps preamble, computes anchors + bytes', () => {
  const { preamble, blocks } = M.parseBlocks(SCARS, { level: 3 });
  assert.ok(/intro preamble/.test(preamble), 'preamble captured');
  assert.strictEqual(blocks.length, 3);
  assert.deepStrictEqual(blocks.map((b) => b.shortAnchor), ['scar-33', 'scar-34', 'scar-35']);
  assert.ok(blocks[0].body.includes('second line.'), 'block body captured');
  assert.ok(blocks[0].bytes > 0);
  assert.strictEqual(blocks[0].startLine, 5, 'startLine is 1-based to the heading');
});
test('s3. a shallower (H2) heading closes an H3 block; preamble stops at the first H3', () => {
  const t = '## Section A\ntext\n### B1 — x\nb1 body\n## Section B\nmore\n### B2 — y\nb2 body\n';
  const { blocks } = M.parseBlocks(t, { level: 3 });
  assert.deepStrictEqual(blocks.map((b) => b.shortAnchor), ['b1', 'b2']);
  assert.ok(!blocks[0].body.includes('Section B'), 'H2 closes the H3 block (no bleed)');
});
test('s4. --level 2 parses topic-file H2 blocks', () => {
  const t = '# Index\np\n## Canonical\nc body\n## Load-bearing\nlb body\n';
  const { blocks } = M.parseBlocks(t, { level: 2 });
  assert.deepStrictEqual(blocks.map((b) => b.shortAnchor), ['canonical', 'load-bearing']);
});

// ── resolveBlock (the exact-pointer cold-fetch) ──
test('s5. resolveBlock matches short anchor AND full slug (case-insensitive)', () => {
  assert.strictEqual(M.resolveBlock(SCARS, 'scar-34', { level: 3 }).title, 'SCAR-34 — test-fn hoisting collision');
  assert.strictEqual(M.resolveBlock(SCARS, 'SCAR-34', { level: 3 }).shortAnchor, 'scar-34');
  assert.strictEqual(M.resolveBlock(SCARS, 'scar-33-coderabbit-false-green', { level: 3 }).shortAnchor, 'scar-33');
  assert.strictEqual(M.resolveBlock(SCARS, 'scar-99', { level: 3 }), null, 'a miss returns null');
});

// ── parsePointer ──
test('s6. parsePointer handles [[file#anchor]] / file#anchor / file anchor', () => {
  assert.deepStrictEqual(M.parsePointer('[[scars-toolkit#scar-33]]'), { file: 'scars-toolkit', anchor: 'scar-33' });
  assert.deepStrictEqual(M.parsePointer('scars-toolkit#scar-33'), { file: 'scars-toolkit', anchor: 'scar-33' });
  assert.deepStrictEqual(M.parsePointer('scars-toolkit scar-33'), { file: 'scars-toolkit', anchor: 'scar-33' });
});

// ── heat / LRU ──
test('s7. bumpHeat + hotSet order by recency (LRU), ties by refs', () => {
  const dir = tmp('mem-heat-'); const f = path.join(dir, 'scars.md');
  fs.writeFileSync(f, SCARS);
  M.bumpHeat(f, 'scar-33', { now: 1000 });
  M.bumpHeat(f, 'scar-34', { now: 2000 });
  M.bumpHeat(f, 'scar-33', { now: 3000 });   // scar-33 now most-recent AND 2 refs
  const hot = M.hotSet(f, 2);
  assert.deepStrictEqual(hot, ['scar-33', 'scar-34'], 'most-recent first');
  const heat = M.readHeat(f);
  assert.strictEqual(heat['scar-33'].refs, 2);
});
test('s8. hotSet caps at N (the bounded hot-cache)', () => {
  const dir = tmp('mem-heat2-'); const f = path.join(dir, 'scars.md');
  fs.writeFileSync(f, SCARS);
  for (let i = 0; i < 10; i += 1) M.bumpHeat(f, `scar-${i}`, { now: 1000 + i });
  assert.strictEqual(M.hotSet(f, 5).length, 5, 'bounded to 5');
  assert.strictEqual(M.hotSet(f, 5)[0], 'scar-9', 'newest first');
});

// ── importance protection ──
test('s9. importanceOf protects invariant sections, ranks historical lowest', () => {
  assert.strictEqual(M.importanceOf('Load-bearing invariants').protected, true);
  assert.strictEqual(M.importanceOf('Canonical (do not re-litigate)').protected, true);
  assert.strictEqual(M.importanceOf('Live process rules').protected, true);
  assert.strictEqual(M.importanceOf('Current status — START HERE').cls, 'project');
  assert.strictEqual(M.importanceOf('Still planned (deferred)').cls, 'historical');
});

// ── demote: MOVE (verbatim to dest + pointer in src, never delete) ──
test('s10. cmdDemote moves a block to dest and leaves a one-line pointer in src', () => {
  const dir = tmp('mem-dem-');
  const src = path.join(dir, 'scars.md'); fs.writeFileSync(src, SCARS);
  const dest = path.join(dir, 'scars-archive.md');
  const rc = M.cmdDemote({ file: src, to: dest, anchor: 'scar-34', level: 3 });
  assert.strictEqual(rc, 0);
  const destText = fs.readFileSync(dest, 'utf8');
  assert.ok(destText.includes('a late function shadows an earlier one.'), 'verbatim block in dest');
  const srcText = fs.readFileSync(src, 'utf8');
  assert.ok(!srcText.includes('a late function shadows an earlier one.'), 'block body gone from src');
  assert.ok(/\[#scar-34\].*scars-archive#scar-34/.test(srcText), 'a one-line pointer left in src');
  // the OTHER blocks survive (no collateral loss)
  assert.ok(srcText.includes('rate-limited green check.') && srcText.includes('pin the store dir per test.'), 'siblings intact');
});

// ── check: budget report + demote candidates (invariant protected) ──
test('s11. cmdCheck reports OVER + excludes protected sections from demote candidates', () => {
  const dir = tmp('mem-chk-'); const f = path.join(dir, 'big.md');
  const body = ['# Index', '', '## Canonical', 'x'.repeat(500), '## Still planned', 'y'.repeat(500), '## Live process rules', 'z'.repeat(500)].join('\n');
  fs.writeFileSync(f, body);
  // force OVER via a tiny byte ceiling
  const rc = M.cmdCheck({ _: [f], 'max-bytes': '100', 'max-lines': '2' });
  assert.strictEqual(rc, 2, 'exit 2 on OVER');
});

process.stdout.write(`\nmemory-cli: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
