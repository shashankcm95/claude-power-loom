'use strict';

// v3.9 W4 — the two closing gates: wording-audit (no "learns/trains/improves over time"
// near a metric; no proposed field asserted as pre-existing) + EC7 Path-2-darkness
// (ZERO recordVerdict/reputation/circuit-breaker from any bootcamp module).

const assert = require('assert');
const path = require('path');
const {
  auditWording, auditPath2Darkness, bootcampSources, CAUSAL_EDGE_ALLOWLIST,
} = require('../../../../packages/lab/attribution/bootcamp-gates');

let passed = 0;
function test(name, fn) { fn(); passed += 1; }

// ---- wording-audit ----
test('auditWording: flags a learning CLAIM near a bootcamp metric', () => {
  const v = auditWording('Over runs the plugin learns to resolve issues, lifting pass@k.');
  assert.ok(v.some((x) => x.kind === 'learning-claim'), 'a learning claim must be flagged');
});

test('auditWording: flags "improves over time" near a metric', () => {
  const v = auditWording('The friction map improves over time as the model is retrained.');
  assert.ok(v.some((x) => x.kind === 'learning-claim'));
});

test('auditWording: PASSES the bootcamp’s own legitimate anti-training prose (allow-list)', () => {
  // calibration-issue.js:34 actual line + the corpus "training" contamination/cutoff domain
  assert.deepStrictEqual(auditWording('retrieval-flavored (worked_example_ref), NEVER learned_weight (no training, OQ-NS-6).'), []);
  assert.deepStrictEqual(auditWording('contamination_tier clean REQUIRES resolved_at > model training cutoff (Jan-2026).'), []);
  assert.deepStrictEqual(auditWording('a training-represented repo regurgitates the accepted fix from memorization.'), []);
});

test('auditWording: field-assertion clause flags a proposed field called pre-existing', () => {
  const v = auditWording('The worked_example_ref field is already present in the RFC node schema.');
  assert.ok(v.some((x) => x.kind === 'field-asserted-existing'), 'a NET-NEW field asserted as pre-existing must be flagged');
});

test('auditWording: clean technical prose passes', () => {
  assert.deepStrictEqual(auditWording('The populator builds a stochastic_sample node per leg-B-gated worked example.'), []);
});

// ---- EC7 Path-2-darkness ----
test('auditPath2Darkness: flags a literal require of reputation', () => {
  const v = auditPath2Darkness([{ file: 'x.js', text: "const r = require('../reputation/project');" }]);
  assert.ok(v.some((x) => x.kind === 'path2-import'));
});

test('auditPath2Darkness: flags a literal require of circuit-breaker + a recordVerdict call', () => {
  assert.ok(auditPath2Darkness([{ file: 'x.js', text: "require('../circuit-breaker/project')" }]).length > 0);
  assert.ok(auditPath2Darkness([{ file: 'x.js', text: 'store.recordVerdict({subject});' }]).some((x) => x.kind === 'path2-call'));
});

test('auditPath2Darkness: flags a DYNAMIC require (fail-closed; the obfuscation bypass)', () => {
  const v = auditPath2Darkness([{ file: 'x.js', text: "const r = require(['rep','utation'].join('/'));" }]);
  assert.ok(v.some((x) => x.kind === 'dynamic-require'), 'a string-built require is unanalyzable -> fail-closed flag');
});

test('auditPath2Darkness: catches a MULTI-LINE require (VALIDATE-hacker M1 — the fail-open)', () => {
  const v = auditPath2Darkness([{ file: 'x.js', text: "const r = require(\n  '../reputation/project'\n);" }]);
  assert.ok(v.some((x) => x.kind === 'path2-import'), 'a require split across lines must still be caught');
});

test('auditPath2Darkness: catches a dynamic ESM import() of a Path-2 module', () => {
  const v = auditPath2Darkness([{ file: 'x.js', text: "await import('../circuit-breaker/project');" }]);
  assert.ok(v.some((x) => x.kind === 'path2-import'), 'import() of a Path-2 module must be caught');
});

test('auditPath2Darkness: catches a require on a block-comment-close-then-code line (the comment-skip fail-open)', () => {
  const v = auditPath2Darkness([{ file: 'x.js', text: "/* doc */ const r = require('../reputation/x');" }]);
  assert.ok(v.some((x) => x.kind === 'path2-import'), 'code after a block-comment close must still be scanned');
});

test('auditPath2Darkness: does NOT flag the tiebreaker substring, a comment mention, or a string literal', () => {
  assert.deepStrictEqual(auditPath2Darkness([{ file: 'x.js', text: '// Sort by recorded_at with a STABLE index tiebreaker' }]), []);
  assert.deepStrictEqual(auditPath2Darkness([{ file: 'x.js', text: '// this module never calls recordVerdict() or reputation' }]), []);
  assert.deepStrictEqual(auditPath2Darkness([{ file: 'x.js', text: '/* a block comment mentioning require("../reputation/x") */' }]), []);
  assert.deepStrictEqual(auditPath2Darkness([{ file: 'x.js', text: "const url = 'https://example.com/reputation/api';" }]), [], 'a path inside a STRING (not a require) is not an import');
});

test('auditWording: span-scoped allow — a REAL claim co-located with an allow token is NOT laundered', () => {
  // VALIDATE-hacker M3: a line-level allow let "learns over time ... (no training)" through.
  const v = auditWording('The plugin learns over time, lifting pass@k (no training needed).');
  assert.ok(v.some((x) => x.kind === 'learning-claim' && /learn/i.test(x.match)), 'the learns-over-time claim must fire despite the no-training allow token');
});

test('auditWording: catches adapts/evolves near a metric (the missed vocabulary)', () => {
  assert.ok(auditWording('The recall coverage adapts over runs.').some((x) => x.kind === 'learning-claim'));
  assert.ok(auditWording('The friction model evolves as runs accrue.').some((x) => x.kind === 'learning-claim'));
});

test('auditPath2Darkness: clean bootcamp code passes', () => {
  assert.deepStrictEqual(auditPath2Darkness([{ file: 'x.js', text: "const { splitRecord } = require('../issue-corpus/corpus');" }]), []);
});

// ---- meta: coverage is fail-closed by construction (not a hand list) ----
test('bootcampSources: covers EVERY .js under attribution/ + issue-corpus/ + the 4 causal-edge bootcamp files', () => {
  const repo = path.resolve(__dirname, '../../../..');
  const srcs = bootcampSources({ repoRoot: repo });
  const files = srcs.map((s) => s.file);
  // the W4 modules are covered by DEFAULT (dropped into attribution/, scanned wholesale)
  assert.ok(files.some((f) => f.endsWith('attribution/recall-graph.js')));
  assert.ok(files.some((f) => f.endsWith('attribution/bootcamp-gates.js')));
  assert.ok(files.some((f) => f.endsWith('issue-corpus/corpus.js')));
  // the 4 causal-edge bootcamp files are included
  for (const f of ['calibration-issue.js', 'calibration-issue-run.js', 'trajectory-friction.js', 'trajectory-friction-run.js']) {
    assert.ok(files.some((x) => x.endsWith(`causal-edge/${f}`)), `causal-edge/${f} must be scanned`);
  }
  // a PRE-bootcamp causal-edge file is allow-listed OUT (not scanned by the EC7 gate)
  assert.ok(!files.some((x) => x.endsWith('causal-edge/store.js')), 'the v3.3 store.js (tiebreaker) is allow-listed out');
  assert.ok(CAUSAL_EDGE_ALLOWLIST.has('store.js'));
  // coverage is RECURSIVE (VALIDATE-honesty H2): _spike/ dogfoods ARE scanned for Path-2
  assert.ok(files.some((f) => f.includes(`${path.sep}_spike${path.sep}`)), '_spike/ files must be in the EC7 scan set');
});

test('the LIVE bootcamp tree is Path-2-DARK (the real EC7 assertion)', () => {
  const repo = path.resolve(__dirname, '../../../..');
  const srcs = bootcampSources({ repoRoot: repo });
  const v = auditPath2Darkness(srcs);
  assert.deepStrictEqual(v, [], `EC7: a bootcamp module reaches Path-2: ${JSON.stringify(v)}`);
});

console.log(`bootcamp-gates.test.js: ${passed} passed`);
