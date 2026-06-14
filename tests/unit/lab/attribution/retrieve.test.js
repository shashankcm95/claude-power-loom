#!/usr/bin/env node

// tests/unit/lab/attribution/retrieve.test.js
//
// The #78 minimal lexical retriever: repo HARD-gate + Jaccard over slug tokens (query title
// vs node issue_id title-slug). Tests the PRIMITIVES (slugify/stem/jaccard/repo-gate) AND the
// load-bearing DISCRIMINATION claim (VERIFY F3): for the real more-itertools target title, the
// source sibling must out-score a set of distractors (so "retrieval" is not top-1-of-1). All
// slugs derive mechanically from REAL upstream titles (VERIFY F2) — no hand-tuned tokens.

'use strict';

const assert = require('assert');
const { slugTokens, slugifyTitle, jaccard, normRepo, scoreNode, retrieve } = require('../../../../packages/lab/attribution/_spike/retrieve.js');

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; } catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

// ---- primitives ----
test('slugTokens: drops stopwords + short tokens, stems trailing -s', () => {
  const t = slugTokens('Fix empty ranges in numeric_range');
  assert.ok(!t.has('fix') && !t.has('in'), 'stopwords dropped');
  assert.ok(t.has('range') && !t.has('ranges'), 'ranges stemmed to range');
  assert.ok(t.has('empty') && t.has('numeric'), 'topic tokens kept');
});
test('jaccard: intersection over union', () => {
  assert.strictEqual(jaccard(new Set(['a', 'b']), new Set(['a', 'b'])), 1);
  assert.strictEqual(jaccard(new Set(['a', 'b']), new Set(['b', 'c'])), 1 / 3);
  assert.strictEqual(jaccard(new Set(), new Set()), 0);
});
test('normRepo: strips github URL prefix / .git / trailing slash', () => {
  assert.strictEqual(normRepo('https://github.com/more-itertools/more-itertools'), 'more-itertools/more-itertools');
  assert.strictEqual(normRepo('more-itertools/more-itertools.git/'), 'more-itertools/more-itertools');
});

// ---- a node shaped like a recall-graph worked-example node ----
function mkNode(repo, title) {
  return { worked_example_ref: { repo, issue_id: `mit__${slugifyTitle(title)}` } };
}
const REPO = 'https://github.com/more-itertools/more-itertools';

// The REAL pair (titles verbatim from the upstream commits edb3346 / a51da82).
const TARGET_TITLE = 'Fix numeric_range slicing with negative step returning empty range';
const SOURCE = mkNode(REPO, 'Fix empty ranges in numeric_range.__reversed__');

// Distractors: real more-itertools commit titles + 2 realistic-shaped (an incidental-token sharer
// and a different-repo). Slugs are mechanically derived — NOT tuned (VERIFY F3).
const DISTRACTORS = [
  mkNode(REPO, 'Add subfactorial()'),
  mkNode(REPO, 'Add seekable.__getitem__ to access the internal cache'),
  mkNode(REPO, 'Fix broken test for powerset of sets'),
  mkNode(REPO, 'Switch from itemgetter to compress'),
  mkNode(REPO, 'Reversed is more general than seq[-1]'),                         // shares 'reversed' w/ SOURCE, not the target
  mkNode(REPO, 'windowed drops the final window when the iterable is empty'),    // incidental: shares 'empty' only
  mkNode('https://github.com/octo/widget', 'Resizing the panel below 200px throws a RangeError in computeLayout'), // different repo
];

test('repo gate: a different-repo node scores 0 regardless of token overlap', () => {
  const diffRepo = mkNode('https://github.com/octo/widget', 'numeric_range empty range reversed slicing'); // max tokens, wrong repo
  assert.strictEqual(scoreNode({ repo: REPO, title: TARGET_TITLE }, diffRepo).score, 0);
  assert.strictEqual(scoreNode({ repo: REPO, title: TARGET_TITLE }, diffRepo).repoMatch, false);
});

test('DISCRIMINATION (F3): the source sibling out-scores every distractor for the real target title', () => {
  const { top, ranked } = retrieve({ repo: REPO, title: TARGET_TITLE }, [...DISTRACTORS, SOURCE]);
  assert.ok(top, 'a top match exists');
  assert.strictEqual(top.node, SOURCE, 'the top-ranked node is the numeric_range source, not a distractor');
  const sourceScore = ranked.find((r) => r.node === SOURCE).score;
  for (const r of ranked) {
    if (r.node === SOURCE) continue;
    assert.ok(sourceScore > r.score, `source (${sourceScore.toFixed(3)}) must beat distractor (${r.score.toFixed(3)})`);
  }
  // the incidental-token distractor ('empty') scores >0 but well under the source (margin is real).
  const windowed = ranked.find((r) => /windowed/.test(r.node.worked_example_ref.issue_id));
  assert.ok(windowed.score > 0, 'the empty-sharing distractor scores >0 (shares a token)');
  assert.ok(sourceScore >= 2 * windowed.score, `source margin over the incidental sharer is clear (${sourceScore.toFixed(3)} vs ${windowed.score.toFixed(3)})`);
});

process.stdout.write(`\nretrieve.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
