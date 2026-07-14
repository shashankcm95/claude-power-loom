#!/usr/bin/env node

// tests/unit/lab/world-anchor/export-bank-pair.test.js
//
// A3-on-v1: the toolkit->Embers export seam. buildBankPair assembles a `bank`-ready (node, meta) pair
// from a verified world_anchored node + operator/join inputs. The node is the frozen 7-key body emitted
// VERBATIM (Embers re-parses + re-derives its two seals); the meta is the v1 minimal shape Embers `bank`
// requires: { minter:{persona_id, human_root}, prUrl, repoSlug }.
//
// This is the behavioral SPEC, written FIRST (TDD). Every assertion is a guarantee buildBankPair must
// provide. SECURITY posture (v1): persona_id + human_root are SELF-ASSERTED operator labels; the pair
// proves INTEGRITY + WELL-FORMEDNESS + node<->PR consistency, NOT provenance (integrity != provenance,
// #273). The export is the LAST line that enforces node/pr well-formedness (the attestation read path is
// field-shape-blind), so the strict-full-shape prUrl + the exact-set node checks are load-bearing.

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');

// export-bank-pair requires live-recall-store, which reads LOOM_LAB_STATE_DIR at module load. Pin it to a
// throwaway before require so a stray store touch can never hit the real ~/.claude/lab-state (the core is
// pure/no-I/O, but the transitive require captures the env at load).
const fs = require('fs');
const os = require('os');
process.env.LOOM_LAB_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-test-labstate-'));

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { buildBankPair, MAX_LABEL } = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'export-bank-pair.js'));
const { canonicalJsonSerialize } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'canonical-json.js'));

let passed = 0;
function test(name, fn) { fn(); passed += 1; }
const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');

// FROZEN byte-parity vector: the Embers dogfood sealed node (embers/docs/samples/ember-v2-dogfood/node.json,
// copied verbatim). verifyNodeBody accepting it + buildBankPair emitting it means the toolkit's canonical-json
// + seal derivation agree with Embers' byte-for-byte (both sides are copies of packages/kernel/_lib/
// canonical-json.js). If either serializer drifts, this vector fails HERE - the "shared test vector before the
// first real bank" the ember/v2 contract requires (ember-v2-contract.md:59-64). Update BOTH sides in lockstep.
const EMBERS_DOGFOOD_NODE = Object.freeze({
  anchor_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  provenance: 'world_anchored',
  merge_sha: 'b3f2c1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  lesson_signature: 'trigger:api-contract-drift|gotcha:silent-null-coerce|corrective:validate-at-boundary',
  lesson_body: 'When an upstream API field goes optional, a bare x.field silently coerces null downstream; validate at the boundary and fail closed with a typed error instead of threading undefined.',
  node_id: 'c411ae69b5648dd3f6168f9da1219022667893dfeaa5ce8a5c90d998dda15ddf',
  content_hash: 'c78a9684afeadaa6b95304abb455d93ca1d678ad5b4c4d304b82eab9c3b9f9a0',
});
// The operator/join inputs consistent with the dogfood meta.json (prUrl /pull/128, repoSlug acme/widgets).
const OK_INPUT = Object.freeze({
  node: EMBERS_DOGFOOD_NODE,
  prUrl: 'https://github.com/acme/widgets/pull/128',
  repo: 'acme/widgets',
  prNumber: 128,
  personaId: 'node-backend',
  humanRoot: 'root-operator-0',
});
function withNode(over) { return { ...OK_INPUT, node: { ...EMBERS_DOGFOOD_NODE, ...over } }; }
// Recompute the full-body content_hash over a mutated body (the launder attempt the exact-set must beat).
function reseal(body) {
  const basis = {};
  for (const k of Object.keys(body)) { if (k !== 'content_hash') basis[k] = body[k]; }
  return { ...body, content_hash: sha256hex(canonicalJsonSerialize(basis)) };
}

// ---- byte-parity vector (the cross-repo regression guard) ----

test('byte-parity: the frozen Embers dogfood node is accepted verbatim (seals re-derive on the toolkit side)', () => {
  const res = buildBankPair(OK_INPUT);
  assert.strictEqual(res.ok, true, 'the frozen vector builds a pair');
  assert.deepStrictEqual(res.node, EMBERS_DOGFOOD_NODE, 'the node is emitted VERBATIM (7 keys, exact values)');
  // GAP-B (Wave 2b) SHARED cross-repo vector: these two literals are pinned IDENTICALLY on the Embers side in
  // embers/test/unit/schema/content-address.test.js (the 'shared cross-repo vector ...' test), against a node
  // body inlined byte-for-byte from EMBERS_DOGFOOD_NODE above. One node, one pair of frozen literals, asserted
  // in BOTH repos -> a one-sided hasher/serializer drift trips HERE or THERE (never leaves both green while a
  // real bank self-DoSes). Update BOTH sides in lockstep if the vector is ever re-captured.
  assert.strictEqual(res.node.node_id, 'c411ae69b5648dd3f6168f9da1219022667893dfeaa5ce8a5c90d998dda15ddf');
  assert.strictEqual(res.node.content_hash, 'c78a9684afeadaa6b95304abb455d93ca1d678ad5b4c4d304b82eab9c3b9f9a0');
});

// ---- meta shape (exact-set + casing + no auth field) ----

test('meta shape: {minter:{persona_id,human_root}, prUrl, repoSlug, mergeSnapshot}', () => {
  const { meta } = buildBankPair(OK_INPUT);
  assert.deepStrictEqual(Object.keys(meta).sort(), ['mergeSnapshot', 'minter', 'prUrl', 'repoSlug'], 'exactly 4 top-level keys');
  assert.deepStrictEqual(Object.keys(meta.minter).sort(), ['human_root', 'persona_id'], 'minter is exactly 2 snake_case keys');
  assert.strictEqual(meta.minter.persona_id, 'node-backend');
  assert.strictEqual(meta.minter.human_root, 'root-operator-0');
  assert.strictEqual(meta.prUrl, 'https://github.com/acme/widgets/pull/128');
  assert.strictEqual(meta.repoSlug, 'acme/widgets');
});

// GAP-A (Wave 2a): mergeSnapshot carries ONLY the merge signal the verified node proves. `merged:true` flips
// the Embers mint-gate FAIL(not-merged) -> WEAK; merge_sha is the node's own sealed value (never a new claim).
test('GAP-A: meta.mergeSnapshot = {merged:true, merge_sha} from the node, no fabricated richer signal', () => {
  const { meta } = buildBankPair(OK_INPUT);
  assert.deepStrictEqual(Object.keys(meta.mergeSnapshot).sort(), ['merge_sha', 'merged'], 'exactly merged + merge_sha (no fabricated merger/reviewer signal)');
  assert.strictEqual(meta.mergeSnapshot.merged, true, 'a verified world_anchored node is minted only post-merge');
  assert.strictEqual(meta.mergeSnapshot.merge_sha, EMBERS_DOGFOOD_NODE.merge_sha, 'merge_sha is the node own sealed value, not a re-claim');
});

test('meta carries NO authentication-implying field (integrity != provenance)', () => {
  const { meta } = buildBankPair(OK_INPUT);
  for (const forbidden of ['verified', 'authenticated_by', 'signature', 'sig', 'weight', 'trusted', 'provenance']) {
    assert.ok(!(forbidden in meta), `meta must not carry '${forbidden}'`);
    assert.ok(!(forbidden in meta.minter), `minter must not carry '${forbidden}'`);
  }
});

// ---- node integrity (verify-on-emit; a tampered node can never launder) ----

test('fail-closed: an in-place basis edit (lesson_body) breaks the node_id seal', () => {
  // lesson_body is IN the node_id basis, so a bare edit diverges node_id before content_hash is checked
  const res = buildBankPair(withNode({ lesson_body: 'a laundered lesson' }));
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'node-node-id');
});

test('fail-closed: the full-body content_hash seal catches a basis edit with a RECOMPUTED node_id', () => {
  // the meaningful #273 launder: an attacker edits lesson_body AND fixes the identity seal (node_id), but
  // leaves the full-body content_hash stale -> only the second seal catches it
  const store = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'live-recall-store.js'));
  const b = { ...EMBERS_DOGFOOD_NODE, lesson_body: 'a laundered lesson' };
  b.node_id = store.deriveLiveNodeId(b);         // fix the identity seal
  // b.content_hash left stale (still the original)
  const res = buildBankPair({ ...OK_INPUT, node: b });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'node-content-hash');
});

test('fail-closed: an injected 8th key is rejected by exact-set BEFORE the seal (H3)', () => {
  // even RESEALED over the 8-key body, the exact-set reject fires first - a seals-only check would pass this
  const laundered = reseal({ ...EMBERS_DOGFOOD_NODE, weight: 1, authenticated: true });
  const res = buildBankPair({ ...OK_INPUT, node: laundered });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'node-unexpected-field', 'exact-set beats a resealed extra-key launder');
});

test('fail-closed: a non-world_anchored provenance is rejected', () => {
  const res = buildBankPair({ ...OK_INPUT, node: reseal({ ...EMBERS_DOGFOOD_NODE, provenance: 'live' }) });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'node-provenance');
});

test('fail-closed: a null / non-object node is rejected', () => {
  assert.strictEqual(buildBankPair({ ...OK_INPUT, node: null }).ok, false);
  assert.strictEqual(buildBankPair({ ...OK_INPUT, node: null }).reason, 'node-not-an-object');
});

test('fail-closed: a hostile THROWING getter node returns {ok:false}, never throws (CodeRabbit F1)', () => {
  const hostile = {};
  Object.defineProperty(hostile, 'anchor_id', { enumerable: true, get() { throw new Error('boom'); } });
  let res;
  assert.doesNotThrow(() => { res = buildBankPair({ ...OK_INPUT, node: hostile }); }, 'the snapshot spread must not escape');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'node-not-an-object');
});

test('fail-closed: a node that INHERITS its basis fields (owns only node_id/content_hash) is rejected (CodeRabbit F2)', () => {
  // buildBankPair snapshots {...node}, which copies only OWN keys -> the inherited basis (incl. provenance)
  // is stripped, so provenance-missing fails first. Either way FAIL-CLOSED. (The own-key gate itself is tested
  // directly against verifyNodeBody in live-recall-store.test.js, where no snapshot intervenes.)
  const proto = { anchor_id: 'a'.repeat(64), provenance: 'world_anchored', merge_sha: 'd91785ea', lesson_signature: 'lesson:a|b|c', lesson_body: 'inherited body' };
  const crafted = Object.create(proto);
  crafted.node_id = 'a'.repeat(64);
  crafted.content_hash = 'b'.repeat(64);
  const res = buildBankPair({ ...OK_INPUT, node: crafted });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'node-provenance', 'the snapshot strips inheritance -> provenance vanishes -> fail-closed');
});

// ---- operator labels (bounded, non-empty, control-char-free) ----

for (const [field, key] of [['personaId', 'bad-persona-id'], ['humanRoot', 'bad-human-root']]) {
  test(`fail-closed: empty ${field} is rejected (${key})`, () => {
    const res = buildBankPair({ ...OK_INPUT, [field]: '' });
    assert.strictEqual(res.ok, false); assert.strictEqual(res.reason, key);
  });
  test(`fail-closed: oversize ${field} is rejected (${key})`, () => {
    const res = buildBankPair({ ...OK_INPUT, [field]: 'x'.repeat(MAX_LABEL + 1) });
    assert.strictEqual(res.ok, false); assert.strictEqual(res.reason, key);
  });
  test(`fail-closed: a control-char (C1 escape) ${field} is rejected (${key})`, () => {
    const res = buildBankPair({ ...OK_INPUT, [field]: `evil\u009bmalicious` });
    assert.strictEqual(res.ok, false); assert.strictEqual(res.reason, key);
  });
}

// ---- prUrl STRICT full-shape (NOT Embers' loose prefix) + node<->PR cross-check ----

test('fail-closed: a loose github prefix (no /pull/N) is rejected - strict full shape', () => {
  const res = buildBankPair({ ...OK_INPUT, prUrl: 'https://github.com/acme/widgets' });
  assert.strictEqual(res.ok, false); assert.strictEqual(res.reason, 'bad-pr-url');
});

test('fail-closed: a non-github host is rejected', () => {
  const res = buildBankPair({ ...OK_INPUT, prUrl: 'https://evil.com/acme/widgets/pull/128' });
  assert.strictEqual(res.ok, false); assert.strictEqual(res.reason, 'bad-pr-url');
});

test('fail-closed: a trailing-segment PR url is rejected (anchored $)', () => {
  const res = buildBankPair({ ...OK_INPUT, prUrl: 'https://github.com/acme/widgets/pull/128/files' });
  assert.strictEqual(res.ok, false); assert.strictEqual(res.reason, 'bad-pr-url');
});

test('fail-closed: repo that disagrees with the prUrl owner/repo is rejected', () => {
  const res = buildBankPair({ ...OK_INPUT, repo: 'evil/repo' });
  assert.strictEqual(res.ok, false); assert.strictEqual(res.reason, 'repo-pr-url-mismatch');
});

test('fail-closed: prNumber that disagrees with the prUrl /pull/N is rejected', () => {
  const res = buildBankPair({ ...OK_INPUT, prNumber: 999 });
  assert.strictEqual(res.ok, false); assert.strictEqual(res.reason, 'pr-number-mismatch');
});

for (const bad of ['singlesegment', 'too/many/segments', 'owner/', '/repo']) {
  test(`fail-closed: a non-2-segment repo (${JSON.stringify(bad)}) is rejected with EXACT bad-repo`, () => {
    // deterministic: isTwoSegmentSlug (step 4) fires before the repo<->prUrl cross-check (step 5)
    const res = buildBankPair({ ...OK_INPUT, repo: bad });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'bad-repo');
  });
}

// ---- Trojan-Source / invisible-codepoint labels egress to an EXTERNAL commons: reject them here ----

for (const [cp, name] of [[String.fromCharCode(0x202e), 'RLO bidi-override'], [String.fromCharCode(0x2066), 'bidi isolate'], [String.fromCharCode(0x2028), 'line separator'], [String.fromCharCode(0x200b), 'zero-width space'], [String.fromCharCode(0xfeff), 'BOM'], [String.fromCharCode(0x00a0), 'nbsp'], [String.fromCharCode(0x00ad), 'soft-hyphen']]) {
  test(`fail-closed: a ${name} (U+${cp.charCodeAt(0).toString(16)}) in persona_id is rejected`, () => {
    const res = buildBankPair({ ...OK_INPUT, personaId: `node${cp}backend` });
    assert.strictEqual(res.ok, false); assert.strictEqual(res.reason, 'bad-persona-id');
  });
  test(`fail-closed: a ${name} in human_root is rejected`, () => {
    const res = buildBankPair({ ...OK_INPUT, humanRoot: `root${cp}0` });
    assert.strictEqual(res.ok, false); assert.strictEqual(res.reason, 'bad-human-root');
  });
}

// ---- a non-trimmed pr_url would silently diverge meta.prUrl from the sealed value: reject ----

for (const padded of [' https://github.com/acme/widgets/pull/128', 'https://github.com/acme/widgets/pull/128 ', 'https://github.com/acme/widgets/pull/128\t', '\nhttps://github.com/acme/widgets/pull/128']) {
  test(`fail-closed: a whitespace-padded pr_url (${JSON.stringify(padded)}) is rejected`, () => {
    const res = buildBankPair({ ...OK_INPUT, prUrl: padded });
    assert.strictEqual(res.ok, false); assert.strictEqual(res.reason, 'bad-pr-url');
  });
}

// ---- round-trip (Embers will JSON.parse + re-derive) ----

test('round-trip: the emitted node survives JSON.stringify -> parse with seals intact', () => {
  const { node } = buildBankPair(OK_INPUT);
  const reparsed = JSON.parse(JSON.stringify(node));
  const store = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'live-recall-store.js'));
  assert.strictEqual(store.verifyNodeBody(reparsed), null, 'seals re-derive after a serialize round-trip (Embers accepts)');
});

console.log(`${path.basename(__filename)}: ${passed} passed`);
