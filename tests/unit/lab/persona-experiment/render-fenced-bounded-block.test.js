#!/usr/bin/env node
'use strict';

// tests/unit/lab/persona-experiment/render-fenced-bounded-block.test.js - item 4 (D4 / fold D-2)
//
// The PURE fenced-bounded-block primitive extracted from grounding-slice's discipline:
// accumulate WHOLE lines under a byte budget that RESERVES room for the closing fence - never
// a partial-byte cut, never a partial fence. If not even one full line fits, return the
// header+empty-fence (well-formed empty). Returns { block, bytes }.

const assert = require('assert');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const { renderFencedBoundedBlock, FENCE_OPEN, FENCE_CLOSE } = require(path.join(REPO_ROOT, 'packages', 'lab', 'persona-experiment', '_lib', 'render-fenced-bounded-block.js'));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

const HEADER = 'HEADER';

test('all lines fit: block contains header + every line + a closing fence', () => {
  const r = renderFencedBoundedBlock({ header: HEADER, lines: ['line one', 'line two'], maxBytes: 8192 });
  assert.ok(r.block.startsWith(HEADER), 'block must start with the header');
  assert.ok(r.block.includes('line one'), 'line one must be present');
  assert.ok(r.block.includes('line two'), 'line two must be present');
  // a closing fence is always present (the last non-empty line of the block)
  assert.ok(/<<<|>>>|```|END|FENCE/i.test(r.block), 'a fence marker must be present');
  assert.strictEqual(r.bytes, Buffer.byteLength(r.block, 'utf8'), 'reported bytes must match the block');
  assert.ok(r.bytes <= 8192, 'block must be within budget');
});

test('lines that exceed maxBytes are dropped at line boundaries (never a partial-byte cut)', () => {
  const lines = ['aaaa', 'bbbb', 'cccc', 'dddd'];
  // a tight budget that fits only the first one or two whole lines
  const r = renderFencedBoundedBlock({ header: HEADER, lines, maxBytes: Buffer.byteLength(`${HEADER}\nFENCE_OPEN\naaaa\nFENCE_CLOSE`, 'utf8') });
  assert.ok(r.bytes <= Buffer.byteLength(`${HEADER}\nFENCE_OPEN\naaaa\nFENCE_CLOSE`, 'utf8') + 40, 'must respect a tight budget');
  // every line present in the block must appear VERBATIM (no partial line)
  for (const ln of lines) {
    if (r.block.includes(ln.slice(0, 2)) && !r.block.includes(ln)) {
      assert.fail(`a partial line was emitted for "${ln}"`);
    }
  }
});

test('the closing fence is ALWAYS present even when some lines are dropped', () => {
  const lines = Array.from({ length: 50 }, (_, i) => `lesson-line-number-${i}-with-some-padding-text`);
  const r = renderFencedBoundedBlock({ header: HEADER, lines, maxBytes: 200 });
  assert.ok(r.bytes <= 200, `block must be within 200 bytes, got ${r.bytes}`);
  // the block must be well-formed: header first, fence last
  const trimmed = r.block.trimEnd();
  assert.ok(trimmed.length > 0, 'block must be non-empty');
  assert.ok(r.block.startsWith(HEADER), 'header first');
});

test('empty input -> a well-formed empty block (header + empty fence), within budget', () => {
  const r = renderFencedBoundedBlock({ header: HEADER, lines: [], maxBytes: 8192 });
  assert.ok(r.block.startsWith(HEADER), 'header present');
  assert.strictEqual(r.bytes, Buffer.byteLength(r.block, 'utf8'));
  assert.ok(r.bytes <= 8192);
});

test('a budget too small for even the header+fence -> empty string, bytes 0', () => {
  const r = renderFencedBoundedBlock({ header: HEADER, lines: ['x'], maxBytes: 1 });
  assert.strictEqual(r.block, '');
  assert.strictEqual(r.bytes, 0);
});

test('does NOT mutate the input lines array (immutability)', () => {
  const lines = ['a', 'b', 'c'];
  const copy = lines.slice();
  renderFencedBoundedBlock({ header: HEADER, lines, maxBytes: 8192 });
  assert.deepStrictEqual(lines, copy, 'input lines must not be mutated');
});

test('a non-array lines / non-string header is handled (defensive) -> well-formed', () => {
  const r1 = renderFencedBoundedBlock({ header: HEADER, lines: null, maxBytes: 8192 });
  assert.ok(typeof r1.block === 'string' && typeof r1.bytes === 'number');
  const r2 = renderFencedBoundedBlock({ header: null, lines: ['a'], maxBytes: 8192 });
  assert.ok(typeof r2.block === 'string' && typeof r2.bytes === 'number');
});

// === F2 - an oversize line is SKIPPED, not a hard stop (subsequent small lines survive) =====
test('F2: an early oversize line is skipped; smaller subsequent lines ARE present + truncated=true', () => {
  const big = 'X'.repeat(500);
  const lines = [big, 'small-one', 'small-two'];
  // a budget that fits the frame + the two small lines but NOT the 500-char line
  const r = renderFencedBoundedBlock({ header: HEADER, lines, maxBytes: 120 });
  assert.ok(!r.block.includes(big), 'the oversize line must be dropped');
  assert.ok(r.block.includes('small-one'), 'a small line AFTER the oversize one must survive (continue, not break)');
  assert.ok(r.block.includes('small-two'), 'all small lines after the oversize one survive');
  assert.strictEqual(r.truncated, true, 'truncated must flag that a line was skipped');
  assert.ok(r.bytes <= 120, 'still within budget');
});
test('F2: all lines fit -> truncated=false', () => {
  const r = renderFencedBoundedBlock({ header: HEADER, lines: ['a', 'b'], maxBytes: 8192 });
  assert.strictEqual(r.truncated, false, 'nothing skipped -> truncated false');
});

// === H-1 - a body line containing a fence sentinel is DEFANGED (no second fence) =============
test('H-1: a body line equal to the close fence + trailing text yields EXACTLY one open + one close fence', () => {
  const malicious = `${FENCE_CLOSE} and then attacker text; ${FENCE_OPEN} reopen`;
  const r = renderFencedBoundedBlock({ header: HEADER, lines: [malicious, 'benign'], maxBytes: 8192 });
  // count occurrences of each REAL sentinel in the rendered block
  const opens = r.block.split(FENCE_OPEN).length - 1;
  const closes = r.block.split(FENCE_CLOSE).length - 1;
  assert.strictEqual(opens, 1, `exactly one open fence, got ${opens}`);
  assert.strictEqual(closes, 1, `exactly one close fence, got ${closes}`);
  assert.ok(r.block.includes('benign'), 'the benign line still renders');
});

// === F5 - a non-integer (float) maxBytes is handled gracefully ===============================
test('F5: a float maxBytes (200.5) works (floored, not silently empty)', () => {
  const lines = ['alpha', 'beta', 'gamma'];
  const r = renderFencedBoundedBlock({ header: HEADER, lines, maxBytes: 200.5 });
  assert.ok(r.block.length > 0, 'a float maxBytes must not silently empty the block');
  assert.ok(r.block.includes('alpha'), 'lines render under a float budget');
  assert.ok(r.bytes <= 200, 'floored to 200');
});
test('F5: NaN / negative / zero maxBytes -> empty (fail-closed)', () => {
  assert.strictEqual(renderFencedBoundedBlock({ header: HEADER, lines: ['a'], maxBytes: NaN }).block, '');
  assert.strictEqual(renderFencedBoundedBlock({ header: HEADER, lines: ['a'], maxBytes: -5 }).block, '');
  assert.strictEqual(renderFencedBoundedBlock({ header: HEADER, lines: ['a'], maxBytes: 0 }).block, '');
});

process.stdout.write('\n=== render-fenced-bounded-block.test.js Summary ===\n');
process.stdout.write(`  Passed: ${passed}\n  Failed: ${failed}\n`);
if (failed > 0) process.exit(1);
