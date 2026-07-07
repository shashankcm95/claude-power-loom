#!/usr/bin/env node

// tests/unit/scripts/memory-cli.test.js
//
// The `memory` CLI (scripts/memory.js) -- block-addressable retrieval + LRU heat + budget/demote for the
// operating-memory system. Locks the block model (parse/resolve/anchor), the [[file#anchor]] pointer parse,
// the LRU hot-set ordering, importance-protection, and the demote-never-delete MOVE. Also locks the
// 2026-07-05 review-board hardening: fence-aware parsing, within-root containment (traversal / absolute /
// symlink), the ATOMIC demote (a src-write fault rolls back the dest -- never lose, never duplicate), the
// collision guard, the wc-parity line count, the command-wrapper surface, and the verify-preserved gate.
// Isolated via tmp files + a per-test LOOM_MEMORY_DIR root.

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

// Run fn with process std streams captured (keeps expected-fail noise out; lets us assert on output).
function capture(fn) {
  const o = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  let out = ''; let err = '';
  process.stdout.write = (s) => { out += s; return true; };
  process.stderr.write = (s) => { err += s; return true; };
  try { const rc = fn(); return { rc, out, err }; }
  finally { process.stdout.write = o; process.stderr.write = e; }
}

const SCARS = [
  '# Scars (toolkit)', '', 'intro preamble line', '',
  '### SCAR-33 — CodeRabbit false-green', 'rate-limited green check.', 'second line.', '',
  '### SCAR-34 — test-fn hoisting collision', 'a late function shadows an earlier one.', '',
  '### SCAR-35 — lab-test opts.dir isolate', 'pin the store dir per test.', '',
].join('\n');

// -- slug + anchors --
test('s1. slugify + shortAnchorOf', () => {
  assert.strictEqual(M.slugify('SCAR-33 — CodeRabbit false-green'), 'scar-33-coderabbit-false-green');
  assert.strictEqual(M.shortAnchorOf('SCAR-33 — CodeRabbit false-green'), 'scar-33');
  assert.strictEqual(M.shortAnchorOf('charter'), 'charter');
  assert.strictEqual(M.shortAnchorOf('W1 MERGED: the thing'), 'w1-merged');
});

// -- parseBlocks --
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

// -- resolveBlock (the exact-pointer cold-fetch) --
test('s5. resolveBlock matches short anchor AND full slug (case-insensitive)', () => {
  assert.strictEqual(M.resolveBlock(SCARS, 'scar-34', { level: 3 }).title, 'SCAR-34 — test-fn hoisting collision');
  assert.strictEqual(M.resolveBlock(SCARS, 'SCAR-34', { level: 3 }).shortAnchor, 'scar-34');
  assert.strictEqual(M.resolveBlock(SCARS, 'scar-33-coderabbit-false-green', { level: 3 }).shortAnchor, 'scar-33');
  assert.strictEqual(M.resolveBlock(SCARS, 'scar-99', { level: 3 }), null, 'a miss returns null');
});

// -- parsePointer --
test('s6. parsePointer handles [[file#anchor]] / file#anchor / file anchor', () => {
  assert.deepStrictEqual(M.parsePointer('[[scars-toolkit#scar-33]]'), { file: 'scars-toolkit', anchor: 'scar-33' });
  assert.deepStrictEqual(M.parsePointer('scars-toolkit#scar-33'), { file: 'scars-toolkit', anchor: 'scar-33' });
  assert.deepStrictEqual(M.parsePointer('scars-toolkit scar-33'), { file: 'scars-toolkit', anchor: 'scar-33' });
});

// -- heat / LRU --
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

// -- importance protection --
test('s9. importanceOf protects invariant sections, ranks historical lowest', () => {
  assert.strictEqual(M.importanceOf('Load-bearing invariants').protected, true);
  assert.strictEqual(M.importanceOf('Canonical (do not re-litigate)').protected, true);
  assert.strictEqual(M.importanceOf('Live process rules').protected, true);
  assert.strictEqual(M.importanceOf('Current status — START HERE').cls, 'project');
  assert.strictEqual(M.importanceOf('Still planned (deferred)').cls, 'historical');
});

// -- demote: MOVE (verbatim to dest + pointer in src, never delete) --
test('s10. cmdDemote moves a block to dest and leaves a one-line pointer in src', () => {
  const dir = tmp('mem-dem-'); process.env.LOOM_MEMORY_DIR = dir;
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

// -- check: budget report + demote candidates (invariant protected) --
test('s11. cmdCheck reports OVER + lists ONLY unprotected sections as demote candidates', () => {
  const dir = tmp('mem-chk-'); process.env.LOOM_MEMORY_DIR = dir;
  const f = path.join(dir, 'big.md');
  const body = ['# Index', '', '## Canonical', 'x'.repeat(500), '## Still planned', 'y'.repeat(500), '## Live process rules', 'z'.repeat(500)].join('\n');
  fs.writeFileSync(f, body);
  const { rc, out } = capture(() => M.cmdCheck({ _: [f], 'max-bytes': '100', 'max-lines': '2' }));
  assert.strictEqual(rc, 2, 'exit 2 on OVER');
  assert.ok(/## Still planned/.test(out), 'the unprotected section IS a candidate');
  assert.ok(!/## Canonical/.test(out), 'the invariant Canonical section is NOT a candidate');
  assert.ok(!/## Live process rules/.test(out), 'the invariant Live-process section is NOT a candidate');
});

// == 2026-07-05 review-board hardening ==

// -- fence-aware parse (code-reviewer HIGH) --
test('s12. parseBlocks does not split on a heading-shaped line inside a fenced code block', () => {
  const fenced = [
    '### B1 - has code', 'intro',
    '```bash', '### not a heading (a shell comment)', 'echo hi', '```',
    'after the fence, still B1',
    '### B2 - second', 'b2 body',
  ].join('\n');
  const { blocks } = M.parseBlocks(fenced, { level: 3 });
  assert.strictEqual(blocks.length, 2, 'the fenced ### is not a block boundary');
  assert.deepStrictEqual(blocks.map((b) => b.shortAnchor), ['b1', 'b2']);
  assert.ok(blocks[0].body.includes('after the fence, still B1'), 'content after the fence stays in B1');
  assert.ok(blocks[0].body.includes('### not a heading'), 'the fenced heading-shape is preserved verbatim as content');
});

// -- within-root containment (hacker HIGH: traversal / absolute-outside / symlink-escape) --
test('s13. resolveFile contains to the memory root; traversal/absolute/symlink-escape all reject', () => {
  const root = tmp('mem-cont-');
  fs.writeFileSync(path.join(root, 'ok.md'), '### x - t\nbody\n');
  assert.strictEqual(M.resolveFile('ok', { root }), path.join(root, 'ok.md'), 'in-root slug resolves');
  assert.strictEqual(M.resolveFile('../evil', { root }), null, 'traversal slug rejected');
  assert.strictEqual(M.resolveFile('a/b', { root }), null, 'sub-path slug rejected');
  assert.strictEqual(M.resolveFile('/etc/hosts', { root }), null, 'absolute-outside rejected');
  const outside = tmp('mem-out-'); fs.writeFileSync(path.join(outside, 'secret.md'), 'SECRET\n');
  fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'link.md'));
  assert.strictEqual(M.resolveFile('link', { root }), null, 'a symlink escaping root is rejected');
});

// -- atomic demote (hacker CRITICAL: a src-write fault must roll the dest back) --
test('s14. demote is atomic: a src-write fault rolls back the dest (no duplicate, no loss)', () => {
  const root = tmp('mem-atom-');
  const a = path.join(root, 'a'); const b = path.join(root, 'b');
  fs.mkdirSync(a); fs.mkdirSync(b);
  const src = path.join(a, 'src.md'); const dest = path.join(b, 'dest.md');
  fs.writeFileSync(src, '### s1 - only\nbody line one\n');
  process.env.LOOM_MEMORY_DIR = root;
  fs.chmodSync(a, 0o555); // src dir read-only -> the src rewrite fails AFTER the dest is written
  let rc;
  try { rc = capture(() => M.cmdDemote({ file: src, to: dest, anchor: 's1', level: 3 })).rc; }
  finally { fs.chmodSync(a, 0o755); }
  assert.strictEqual(rc, 1, 'demote reports failure');
  assert.ok(!fs.existsSync(dest), 'the new dest was rolled back (removed) -> no duplicate');
  assert.ok(fs.readFileSync(src, 'utf8').includes('body line one'), 'the src block is intact -> no loss');
});

// -- collision guard (code-reviewer HIGH: a duplicate anchor in dest would shadow on recall) --
test('s15. demote refuses a colliding anchor in dest', () => {
  const root = tmp('mem-coll-'); process.env.LOOM_MEMORY_DIR = root;
  const src = path.join(root, 'src.md'); const dest = path.join(root, 'dest.md');
  fs.writeFileSync(src, '### SCAR-1 - new\nnew body here\n');
  fs.writeFileSync(dest, '### SCAR-1 - old\nold body here\n');
  const rc = capture(() => M.cmdDemote({ file: src, to: dest, anchor: 'scar-1', level: 3 })).rc;
  assert.strictEqual(rc, 1, 'collision refused');
  assert.ok(fs.readFileSync(src, 'utf8').includes('new body here'), 'src unchanged');
  assert.ok(!fs.readFileSync(dest, 'utf8').includes('new body here'), 'dest not appended');
});

// -- line count (code-reviewer MEDIUM: wc -l parity for newline-terminated; logical count otherwise) --
test('s16. countLines: wc -l for a newline-terminated file, logical line count when no final newline', () => {
  assert.strictEqual(M.countLines('a\nb\nc\n'), 3, 'newline-terminated: equals wc -l');
  assert.strictEqual(M.countLines('a\nb\nc'), 3, 'no final newline: logical count (one more than wc -l, which is 2)');
  assert.strictEqual(M.countLines(''), 0);
});

// -- command-wrapper coverage (code-reviewer MEDIUM: recall/blocks/heat were untested) --
test('s17. cmdRecall / cmdBlocks / cmdHeat resolve, format, and error cleanly', () => {
  const root = tmp('mem-cmd-'); process.env.LOOM_MEMORY_DIR = root;
  fs.writeFileSync(path.join(root, 'scars.md'), SCARS);
  const r1 = capture(() => M.cmdRecall({ _: ['[[scars#scar-34]]'], 'no-bump': true }));
  assert.strictEqual(r1.rc, 0); assert.ok(/hoisting collision/.test(r1.out), 'recall prints the block');
  const r2 = capture(() => M.cmdRecall({ _: ['[[scars#scar-99]]'] }));
  assert.strictEqual(r2.rc, 1, 'a missing anchor fails');
  const r3 = capture(() => M.cmdBlocks({ _: ['scars'] }));
  assert.strictEqual(r3.rc, 0); assert.ok(/3 blocks/.test(r3.out));
  const r4 = capture(() => M.cmdHeat({ _: ['scars'], bump: 'scar-33' }, { now: 1000 }));
  assert.strictEqual(r4.rc, 0);
  const r5 = capture(() => M.cmdHeat({ _: ['scars'], top: '2' }));
  assert.strictEqual(r5.rc, 0); assert.ok(/scar-33/.test(r5.out), 'hot-set lists the bumped anchor');
});

// -- verify-preserved gate (honesty-auditor + architect HIGH: the diff-audit made runnable) --
test('s18. verify-preserved audits every substantive line incl. TERSE ones; exits 2 (and names it) on a drop', () => {
  const root = tmp('mem-vp-'); process.env.LOOM_MEMORY_DIR = root;
  const l1 = 'the first important claim about gap seven intake';
  const terse = 'K3 dropped'; // 10 chars -- the old >12 filter skipped this silently; it must now be audited
  fs.writeFileSync(path.join(root, 'backup.md'), `## Current status\n${l1}\n${terse}\n`);
  fs.writeFileSync(path.join(root, 'full.md'), `episodic\n${l1}\nmore\n${terse}\n`);
  fs.writeFileSync(path.join(root, 'partial.md'), `episodic\n${l1}\n`); // drops the terse line
  const okr = capture(() => M.cmdVerifyPreserved({ backup: 'backup', against: 'full', section: 'Current status' }));
  assert.strictEqual(okr.rc, 0, 'all lines (incl. terse) preserved -> 0');
  const bad = capture(() => M.cmdVerifyPreserved({ backup: 'backup', against: 'partial', section: 'Current status' }));
  assert.strictEqual(bad.rc, 2, 'the dropped terse line -> exit 2');
  assert.ok(/K3 dropped/.test(bad.out), 'the terse missing line is surfaced (not silently skipped)');
});

// -- blocks --check-unique (hacker LOW / Phase-2 anchor-uniqueness) --
test('s19. blocks --check-unique flags duplicate anchors, passes on unique', () => {
  const root = tmp('mem-uniq-'); process.env.LOOM_MEMORY_DIR = root;
  fs.writeFileSync(path.join(root, 'dup.md'), '### SCAR-24 - a\nx\n### SCAR-24 - b\ny\n');
  fs.writeFileSync(path.join(root, 'uniq.md'), '### SCAR-1 - a\nx\n### SCAR-2 - b\ny\n');
  const d = capture(() => M.cmdBlocks({ _: ['dup'], 'check-unique': true }));
  assert.strictEqual(d.rc, 2); assert.ok(/scar-24/.test(d.out));
  const u = capture(() => M.cmdBlocks({ _: ['uniq'], 'check-unique': true }));
  assert.strictEqual(u.rc, 0);
});

// == VALIDATE-board follow-ups (2026-07-05, second board) ==

// -- sequential-demote pointer absorption (code-reviewer HIGH) --
test('s20. sequential demotes do NOT absorb a pointer into a sibling block (pointer goes to ## Demoted)', () => {
  const root = tmp('mem-seq-'); process.env.LOOM_MEMORY_DIR = root;
  const src = path.join(root, 'src.md');
  fs.writeFileSync(src, '### A - first\nbody a\n### B - middle\nbody b\n### C - last\nbody c\n');
  capture(() => M.cmdDemote({ file: src, to: path.join(root, 'dest-b.md'), anchor: 'b', level: 3 }));
  capture(() => M.cmdDemote({ file: src, to: path.join(root, 'dest-a.md'), anchor: 'a', level: 3 }));
  const destA = fs.readFileSync(path.join(root, 'dest-a.md'), 'utf8');
  assert.ok(!/\[#b\]/.test(destA), 'dest-a body does NOT carry the B pointer (no absorption)');
  assert.ok(/body a/.test(destA), 'dest-a holds the A body');
  const srcText = fs.readFileSync(src, 'utf8');
  assert.ok(/## Demoted/.test(srcText) && /\[#a\]/.test(srcText) && /\[#b\]/.test(srcText), 'both pointers live under ## Demoted');
});

// -- existing-dest rollback restore (honesty-auditor HIGH: s14 only covered the unlink branch) --
test('s21. demote rollback RESTORES an existing dest to its original bytes on a src fault', () => {
  const root = tmp('mem-rb-');
  const a = path.join(root, 'a'); const b = path.join(root, 'b');
  fs.mkdirSync(a); fs.mkdirSync(b);
  const src = path.join(a, 'src.md'); const dest = path.join(b, 'dest.md');
  fs.writeFileSync(src, '### s1 - only\nbody line one\n');
  const destOrig = '### existing - keep\nexisting body\n';
  fs.writeFileSync(dest, destOrig);
  process.env.LOOM_MEMORY_DIR = root;
  fs.chmodSync(a, 0o555); // src dir read-only -> src rewrite faults AFTER the dest is committed
  let rc;
  try { rc = capture(() => M.cmdDemote({ file: src, to: dest, anchor: 's1', level: 3 })).rc; }
  finally { fs.chmodSync(a, 0o755); }
  assert.strictEqual(rc, 1, 'demote reports failure');
  assert.strictEqual(fs.readFileSync(dest, 'utf8'), destOrig, 'existing dest restored to original bytes verbatim');
  assert.ok(fs.readFileSync(src, 'utf8').includes('body line one'), 'src intact -> no loss');
});

// -- heat orphan hygiene (honesty-auditor MEDIUM: dropHeat + liveAnchors were untested) --
test('s22. dropHeat removes a key; hotSet liveAnchors filters an orphaned pointer', () => {
  const dir = tmp('mem-drop-'); const f = path.join(dir, 'scars.md');
  fs.writeFileSync(f, SCARS);
  M.bumpHeat(f, 'scar-33', { now: 1000 });
  M.bumpHeat(f, 'scar-34', { now: 2000 });
  assert.deepStrictEqual(M.hotSet(f, 5).sort(), ['scar-33', 'scar-34']);
  M.dropHeat(f, 'scar-33');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(M.readHeat(f), 'scar-33'), false, 'dropHeat removed the key');
  M.bumpHeat(f, 'ghost-99', { now: 3000 }); // an orphan with no matching block
  assert.deepStrictEqual(M.hotSet(f, 5, { liveAnchors: new Set(['scar-34']) }), ['scar-34'], 'orphan ghost-99 filtered out');
});

// -- demote-into-MEMORY.md footgun guard (hacker LOW) --
test('s23. demote refuses to move INTO MEMORY.md without --force', () => {
  const root = tmp('mem-hot-'); process.env.LOOM_MEMORY_DIR = root;
  const src = path.join(root, 'src.md'); fs.writeFileSync(src, '### s1 - x\nbody\n');
  fs.writeFileSync(path.join(root, 'MEMORY.md'), '# Index\n');
  const r1 = capture(() => M.cmdDemote({ file: src, to: 'MEMORY', anchor: 's1', level: 3 }));
  assert.strictEqual(r1.rc, 1, 'refused without --force');
  const r2 = capture(() => M.cmdDemote({ file: src, to: 'MEMORY', anchor: 's1', level: 3, force: true }));
  assert.strictEqual(r2.rc, 0, '--force overrides');
});

// -- whole-line preservation match (code-reviewer LOW / honesty-auditor HIGH: substring false-positive) --
test('s24. verify-preserved requires a WHOLE-LINE match (a substring of a longer line does not count)', () => {
  const root = tmp('mem-wl-'); process.env.LOOM_MEMORY_DIR = root;
  const line = 'exact substantive claim line';
  fs.writeFileSync(path.join(root, 'backup.md'), `## Current status\n${line}\n`);
  fs.writeFileSync(path.join(root, 'embed.md'), `prefix ${line} suffix\n`); // substring only, not a whole line
  const bad = capture(() => M.cmdVerifyPreserved({ backup: 'backup', against: 'embed', section: 'Current status' }));
  assert.strictEqual(bad.rc, 2, 'a mere substring is NOT counted as preserved');
  fs.writeFileSync(path.join(root, 'whole.md'), `intro\n${line}\n`);
  const okr = capture(() => M.cmdVerifyPreserved({ backup: 'backup', against: 'whole', section: 'Current status' }));
  assert.strictEqual(okr.rc, 0, 'a real whole-line match IS preserved');
});

// -- CommonMark fence-length rule (CodeRabbit Minor on the hardening push) --
test('s25. a 4-backtick fence is NOT closed by a nested 3-backtick fence (CommonMark length rule)', () => {
  const t = [
    '### B1 - outer',
    '````markdown', // 4-backtick opener
    'a nested sample:',
    '```', // 3-backtick -- must NOT close the 4-backtick fence
    '### looks like a heading but is inside the fence',
    '```', // still inside
    '````', // 4-backtick -- THIS closes it
    'after the fence, still B1',
    '### B2 - second', 'b2 body',
  ].join('\n');
  const { blocks } = M.parseBlocks(t, { level: 3 });
  assert.strictEqual(blocks.length, 2, 'the nested 3-backtick fence did not split the block');
  assert.deepStrictEqual(blocks.map((b) => b.shortAnchor), ['b1', 'b2']);
  assert.ok(blocks[0].body.includes('after the fence, still B1'), 'content after the true close stays in B1');
});

// -- weight-aware scored hot-set (Phase 2 slice 1) --
// A tree with one H3 block under each importance-class H2 section. shortAnchors: inv-1/cur-1/hist-1/ref-1.
const MEMTREE = [
  '# Memory Index', '', 'preamble', '',
  '## Load-bearing invariants', '',
  '### INV-1 — kernel record store', 'inv body', '',
  '## Current status — START HERE', '',
  '### CUR-1 — active work', 'cur body', '',
  '## Still planned (deferred)', '',
  '### HIST-1 — someday maybe', 'hist body', '',
  '## Reference notes', '',
  '### REF-1 — a plain note', 'ref body', '',
].join('\n');
// NOTE: heat last_ref is an ISO string built from the injected `now` (epoch ms). Scored tests inject `now`
// NEAR the fixture epoch (~1970) so recency-decay does not underflow to 0 (a real Date.now() -> exp(-693)=0).
const isoAt = (ms) => new Date(ms).toISOString();

test('s26. blockImportances maps H3 blocks to the enclosing H2 importance; no-H2 -> reference', () => {
  const imp = M.blockImportances(MEMTREE, { level: 3 });
  assert.strictEqual(imp.get('inv-1').cls, 'invariant');
  assert.strictEqual(imp.get('inv-1').protected, true);
  assert.strictEqual(imp.get('cur-1').cls, 'project');
  assert.strictEqual(imp.get('hist-1').cls, 'historical');
  assert.strictEqual(imp.get('ref-1').cls, 'reference');
  // SCARS has an H1 + H3s but NO H2 sections -> every block falls through importanceOf('') to reference.
  assert.strictEqual(M.blockImportances(SCARS, { level: 3 }).get('scar-33').cls, 'reference');
});

test('s27. scoredHotSet pins invariant blocks (even at 0 heat) ADDITIVELY beyond n', () => {
  const entries = [
    { anchor: 'ref-1',  last_ref: isoAt(2000), refs: 5, weight: 1, protected: false },
    { anchor: 'inv-1',  last_ref: null,        refs: 0, weight: 3, protected: true },  // 0-heat invariant
    { anchor: 'hist-1', last_ref: isoAt(1500), refs: 2, weight: 0, protected: false }, // weight 0 -> score 0
  ];
  const hot = M.scoredHotSet(entries, 1, { now: 3000 });
  assert.strictEqual(hot[0], 'inv-1', 'pins come first, present even with zero heat');
  assert.ok(hot.includes('ref-1'), 'the single top-scored non-pin fills the n=1 scored tier');
  assert.ok(!hot.includes('hist-1'), 'weight-0 historical loses the n=1 budget to ref-1');
  assert.strictEqual(hot.length, 2, 'additive-beyond-n: |pins|(1) + min(n,|scored|)(1)');
});

test('s28. weight x refs lifts a block above a more-recent low-value one (catches a recency-only regression)', () => {
  // recency is ~tied here (both near-epoch); the point is that weight x refs decides -> a pure recency-only
  // ordering (the old hotSet) would put the more-recent ref-1 at hot[0] and FAIL this. Recency is genuinely
  // exercised by s31 (a multi-week gap); this test guards against reverting to recency-only.
  const entries = [
    { anchor: 'ref-1', last_ref: isoAt(2900), refs: 1, weight: 1, protected: false }, // more recent, low value
    { anchor: 'cur-1', last_ref: isoAt(2000), refs: 7, weight: 2, protected: false }, // older, higher w + refs
  ];
  const hot = M.scoredHotSet(entries, 5, { now: 3000 });
  assert.strictEqual(hot[0], 'cur-1', 'weight x log2(refs) lifts cur-1 above the more-recent ref-1');
});

test('s29. scoredHotSet only surfaces anchors present in entries (a demoted/absent block cannot resurrect)', () => {
  const entries = [
    { anchor: 'cur-1', last_ref: isoAt(2000), refs: 3, weight: 2, protected: false },
    { anchor: 'ref-1', last_ref: isoAt(2500), refs: 1, weight: 1, protected: false },
  ];
  const hot = M.scoredHotSet(entries, 5, { now: 3000 });
  assert.ok(!hot.includes('inv-1'), 'a block absent from entries never appears (no stale pin ghost)');
});

test('s30. cmdHeat --scored surfaces the scored+pinned hot-set (deterministic now; entries from fresh parse)', () => {
  const dir = tmp('mem-heat-scored-'); process.env.LOOM_MEMORY_DIR = dir;
  const f = path.join(dir, 'mem.md');
  fs.writeFileSync(f, MEMTREE);
  M.bumpHeat(f, 'ref-1', { now: 2000 });
  M.bumpHeat(f, 'cur-1', { now: 2500 });
  M.bumpHeat(f, 'cur-1', { now: 2900 });  // cur-1: 2 refs, w2 (project); inv-1 has NO heat but is invariant.
  const { rc, out } = capture(() => M.cmdHeat({ _: [f], scored: true, top: 2 }, { now: 3000 }));
  assert.strictEqual(rc, 0);
  assert.ok(/inv-1/.test(out), 'invariant pinned even with no heat');
  assert.ok(/cur-1/.test(out) && /ref-1/.test(out), 'heated blocks appear in the scored tier');
  assert.ok(!/hist-1/.test(out), 'weight-0 historical (no heat) is pushed out of the top-2 scored tier');
});

const DAY_MS = 24 * 60 * 60 * 1000;
test('s31. recency is LOAD-BEARING: a recent-weak block outranks an old-strong one (over a multi-week gap)', () => {
  // The one test where recency actually VARIES (ages 2d vs 50d over a 30-day tau), so a recency regression flips
  // the order. WITH recency: new-weak (~0.94*log2(4)=1.87) beats old-strong (~0.19*log2(16)=0.76). WITHOUT recency
  // (weight*refs only): old-strong (1*4=4) beats new-weak (1*2=2). So hot[0]==='new-weak' can ONLY hold if the
  // recency factor is genuinely scored -- deleting OR inverting it fails this test.
  const now = 60 * DAY_MS;
  const entries = [
    { anchor: 'old-strong', last_ref: isoAt(10 * DAY_MS), refs: 15, weight: 1, protected: false }, // 50d old, many refs
    { anchor: 'new-weak',   last_ref: isoAt(58 * DAY_MS), refs: 3,  weight: 1, protected: false }, //  2d old, few refs
  ];
  const hot = M.scoredHotSet(entries, 5, { now });
  assert.strictEqual(hot[0], 'new-weak', 'recency decay must lift the recent block above the older high-refs one');
  assert.ok(M.scoreOfEntry(entries[1], now) > M.scoreOfEntry(entries[0], now), 'and its score is genuinely higher');
});

test('s32. weight-0 (historical) is shed by its ZERO score, not the n budget (multiplicative, not sum)', () => {
  // hist-hot has huge heat but weight 0. n=1 with only 2 non-pins -> the budget alone would keep both; the
  // multiplicative zero is what sheds it. Under a SUM formula (weight + log2(1+refs)) hist-hot (0+log2(51)=5.67)
  // would OUTRANK ref-a (1+1=2) and take the single slot -> this asserts the MULTIPLICATIVE zeroing.
  const now = 10 * DAY_MS;
  const entries = [
    { anchor: 'hist-hot', last_ref: isoAt(10 * DAY_MS - 1000), refs: 50, weight: 0, protected: false }, // hot but w0
    { anchor: 'ref-a',    last_ref: isoAt(9 * DAY_MS),         refs: 1,  weight: 1, protected: false }, // modest, w1
  ];
  const hot = M.scoredHotSet(entries, 1, { now });
  assert.deepStrictEqual(hot, ['ref-a'], 'weight-0 is zeroed out despite huge heat (a sum formula would admit it)');
  assert.strictEqual(M.scoreOfEntry(entries[0], now), 0, 'weight-0 zeroes the score regardless of heat/refs');
});

test('s33. scoreOfEntry coerces refs (quoted-numeric scores like numeric; negative -> no NaN)', () => {
  const now = 3000;
  const q = M.scoreOfEntry({ last_ref: isoAt(2000), refs: '10', weight: 1 }, now);
  const num = M.scoreOfEntry({ last_ref: isoAt(2000), refs: 10, weight: 1 }, now);
  assert.strictEqual(q, num, 'a quoted "10" coerces to numeric 10 (not string-concat log2(110))');
  assert.ok(Number.isFinite(M.scoreOfEntry({ last_ref: null, refs: -1, weight: 3 }, now)), 'negative refs -> finite, never NaN');
});

process.stdout.write(`\nmemory-cli: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
