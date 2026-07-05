#!/usr/bin/env node

// tests/unit/lab/issue-corpus/terminal-block.test.js
//
// Gap-7 Part-B — the submit-time terminal-block classifier. Locks the ANCHORED endpoint match (VERIFY
// architect+hacker HIGH): a 403/404 on the EXACT PR-create endpoint (repos/o/r/pulls, bare) is TERMINAL; a
// 403/404 on the pre-create dedup GET (repos/o/r/pulls?head=...) is UNCLASSIFIED (the drift-canary), NEVER
// terminal; a 403/404 on a mid-emit git step is SILENT; a dry ok:true result is never a block. PURE.

'use strict';

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { classifyEmitTerminalBlock, PR_CREATION_RESTRICTED } = require(path.join(REPO, 'packages', 'lab', 'issue-corpus', 'terminal-block.js'));

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// A helper: the reason string emitPR surfaces for a gh-subprocess failure on <endpoint> with <status>.
const runGhReason = (endpoint, status) => `runGh: gh api ${endpoint} failed (HTTP ${status})`;

// ── terminal: a 403/404 on the EXACT PR-create endpoint ──
test('t1. 403 on the bare create endpoint (POST repos/o/r/pulls) is TERMINAL', () => {
  const r = classifyEmitTerminalBlock({ ok: false, emitted: false, reason: runGhReason('repos/schmug/colophon/pulls', '403') });
  assert.deepStrictEqual(r, { terminal: true, block_reason: PR_CREATION_RESTRICTED, unclassified: false });
});
test('t2. 404 on the bare create endpoint is TERMINAL (the observed colophon status; repo already GET-verified upstream)', () => {
  const r = classifyEmitTerminalBlock({ ok: false, emitted: false, reason: runGhReason('repos/o/r/pulls', '404') });
  assert.strictEqual(r.terminal, true);
  assert.strictEqual(r.block_reason, PR_CREATION_RESTRICTED);
});

// ── the false-positive the anchored match closes: the dedup GET is NOT terminal (VERIFY HIGH) ──
test('t3. 403 on the pre-create dedup GET (pulls?head=...) is UNCLASSIFIED, NOT terminal (the drift-canary case)', () => {
  const r = classifyEmitTerminalBlock({ ok: false, emitted: false, reason: runGhReason('repos/o/r/pulls?head=loombot:loom/issue-5-abc&state=open', '403') });
  assert.deepStrictEqual(r, { terminal: false, block_reason: null, unclassified: true });
});
test('t4. 404 on the dedup GET is UNCLASSIFIED, NOT terminal', () => {
  const r = classifyEmitTerminalBlock({ ok: false, emitted: false, reason: runGhReason('repos/o/r/pulls?head=x:y&state=open', '404') });
  assert.strictEqual(r.terminal, false);
  assert.strictEqual(r.unclassified, true);
});

// ── mid-emit git steps: a 403/404 there is a mid-emit failure, SILENT (not the pulls family) ──
test('t5. 403 on git/ref/heads is NOT terminal and NOT unclassified (silent)', () => {
  const r = classifyEmitTerminalBlock({ ok: false, emitted: false, reason: runGhReason('repos/o/r/git/ref/heads/main', '403') });
  assert.deepStrictEqual(r, { terminal: false, block_reason: null, unclassified: false });
});
test('t6. 403 on git/trees (POST) is NOT terminal and NOT unclassified (silent)', () => {
  const r = classifyEmitTerminalBlock({ ok: false, emitted: false, reason: runGhReason('repos/o/r/git/trees', '403') });
  assert.deepStrictEqual(r, { terminal: false, block_reason: null, unclassified: false });
});
test('t7. 403 on contents/<path> is NOT terminal (silent)', () => {
  const r = classifyEmitTerminalBlock({ ok: false, emitted: false, reason: runGhReason('repos/o/r/contents/src/x.py?ref=abc', '403') });
  assert.strictEqual(r.terminal, false);
  assert.strictEqual(r.unclassified, false);
});

// ── a PR sub-resource (rollback PATCH pulls/N) must NOT anchor-match the create ──
test('t8. 403 on pulls/<number> (the rollback PATCH sub-resource) is SILENT, NOT terminal (not the create, not the ?query family)', () => {
  const r = classifyEmitTerminalBlock({ ok: false, emitted: false, reason: runGhReason('repos/o/r/pulls/42', '403') });
  // pulls/42 has a sub-resource (not the bare create) and no `?query` (not the dedup-GET family) → silent.
  assert.deepStrictEqual(r, { terminal: false, block_reason: null, unclassified: false });
});

// ── non-block statuses + non-gh reasons → not a block, silent ──
test('t9. a 5xx gh failure on the create endpoint is NOT terminal (transient, not a permission block)', () => {
  const r = classifyEmitTerminalBlock({ ok: false, emitted: false, reason: runGhReason('repos/o/r/pulls', '500') });
  assert.deepStrictEqual(r, { terminal: false, block_reason: null, unclassified: false });
});
test('t10. a 422 (already-exists dedup path) is NOT terminal', () => {
  const r = classifyEmitTerminalBlock({ ok: false, emitted: false, reason: runGhReason('repos/o/r/pulls', '422') });
  assert.strictEqual(r.terminal, false);
});
test('t11. an ordinary emit failure (awaiting-approval / cap-exceeded / lock) is NOT terminal (no runGh shape)', () => {
  for (const reason of ['awaiting-approval', 'cap-exceeded', 'etiquette-already-emitted', 'lock-unavailable:busy', 'emit-error']) {
    const r = classifyEmitTerminalBlock({ ok: false, emitted: false, reason });
    assert.deepStrictEqual(r, { terminal: false, block_reason: null, unclassified: false }, `reason=${reason}`);
  }
});

// ── tri-state safety: a dry ok:true result / malformed input is NEVER a block (the byte-inert guard) ──
test('t12. a dry ok:true emitted:false result (the shipped SHADOW path) is NEVER a block', () => {
  const r = classifyEmitTerminalBlock({ ok: true, emitted: false, disposition: { mode: 'dry-run' } });
  assert.deepStrictEqual(r, { terminal: false, block_reason: null, unclassified: false });
});
test('t13. null / undefined / non-object / missing-reason inputs are NEVER a block (never throws)', () => {
  for (const bad of [null, undefined, 42, 'x', {}, { ok: false }, { ok: false, reason: 123 }]) {
    const r = classifyEmitTerminalBlock(bad);
    assert.deepStrictEqual(r, { terminal: false, block_reason: null, unclassified: false }, `input=${JSON.stringify(bad)}`);
  }
});
test('t14. a spoofed reason that merely CONTAINS the runGh phrase mid-string does not match (anchored at start)', () => {
  const r = classifyEmitTerminalBlock({ ok: false, emitted: false, reason: 'solve-threw: runGh: gh api repos/o/r/pulls failed (HTTP 403)' });
  assert.strictEqual(r.terminal, false);
});

process.stdout.write(`\nterminal-block: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
