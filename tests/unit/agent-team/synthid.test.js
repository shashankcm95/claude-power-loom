#!/usr/bin/env node

// tests/unit/agent-team/synthid.test.js
//
// v2.8.0 — TDD Phase 1: failing tests first for `_lib/synthid.js` helper.
//
// Architect-designed contract (Phase 2 already complete in thread):
// HETS-SynthId is a content-addressed agent identifier.
// Format: <persona>.<name>[~<contentHash>][/<lineagePath>]
//
// This file tests the PURE FUNCTIONS in _lib/synthid.js:
//   - computeContentHash({persona, contract, agentMd?, pluginVersion}) → 8 hex chars
//   - formatSynthId({persona, name, contentHash?, lineage?}) → string
//   - parseSynthId(synthIdString) → {persona, name, contentHash, lineage} | null
//
// Lineage encoding is shipped in v2.8.1 (architect-deferred); parser MUST
// tolerate lineage suffix for forward compat. Formatter accepts lineage arg
// but content-hash is the load-bearing field for v2.8.0.

'use strict';

const path = require('path');

const SYNTHID = path.resolve(__dirname, '../../../scripts/agent-team/_lib/synthid.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`  PASS ${name}\n`);
    passed++;
  } catch (err) {
    process.stdout.write(`  FAIL ${name}: ${err.message}\n`);
    failed++;
  }
}

// Require fresh module each test to avoid state pollution
function loadSynthid() {
  delete require.cache[SYNTHID];
  return require(SYNTHID);
}

// Architect-designed canonical contract for testing (matches 04-architect shape)
function makeContract(overrides = {}) {
  return {
    persona: '04-architect',
    role: 'actor',
    skills: {
      required: ['plan'],
      recommended: ['agent-team', 'review'],
      skill_status: { plan: 'available', 'agent-team': 'available' },
    },
    kb_scope: {
      default: ['kb:hets/spawn-conventions'],
    },
    budget: { tokens: 30000 },
    functional: [{ id: 'F1', check: 'foo' }],
    ...overrides,
  };
}

process.stdout.write('\n=== _lib/synthid.js (v2.8.0 Phase 1 contract) ===\n');

// ============================================================================
// Group 1: computeContentHash — pure deterministic hash
// ============================================================================

test('CH1: same inputs → same hash (deterministic)', () => {
  const { computeContentHash } = loadSynthid();
  const inputs = {
    persona: '04-architect',
    contract: makeContract(),
    pluginVersion: '2.8.0',
  };
  const h1 = computeContentHash(inputs);
  const h2 = computeContentHash(inputs);
  if (h1 !== h2) throw new Error(`deterministic violation: ${h1} !== ${h2}`);
});

test('CH2: hash is 8 hex chars', () => {
  const { computeContentHash } = loadSynthid();
  const h = computeContentHash({
    persona: '04-architect',
    contract: makeContract(),
    pluginVersion: '2.8.0',
  });
  if (!/^[0-9a-f]{8}$/.test(h)) {
    throw new Error(`expected 8 hex chars, got '${h}' (${h.length})`);
  }
});

test('CH3: different persona contract → different hash', () => {
  const { computeContentHash } = loadSynthid();
  const h1 = computeContentHash({
    persona: '04-architect',
    contract: makeContract({ role: 'actor' }),
    pluginVersion: '2.8.0',
  });
  const h2 = computeContentHash({
    persona: '04-architect',
    contract: makeContract({ role: 'reviewer' }),
    pluginVersion: '2.8.0',
  });
  if (h1 === h2) throw new Error(`hash collision on contract change: both ${h1}`);
});

test('CH4: different skills.required → different hash', () => {
  const { computeContentHash } = loadSynthid();
  const h1 = computeContentHash({
    persona: '04-architect',
    contract: makeContract({ skills: { required: ['plan'], recommended: [] } }),
    pluginVersion: '2.8.0',
  });
  const h2 = computeContentHash({
    persona: '04-architect',
    contract: makeContract({ skills: { required: ['plan', 'review'], recommended: [] } }),
    pluginVersion: '2.8.0',
  });
  if (h1 === h2) throw new Error('hash should change when skills.required changes');
});

test('CH5: different KB scope → different hash', () => {
  const { computeContentHash } = loadSynthid();
  const h1 = computeContentHash({
    persona: '04-architect',
    contract: makeContract({ kb_scope: { default: ['kb:hets/spawn-conventions'] } }),
    pluginVersion: '2.8.0',
  });
  const h2 = computeContentHash({
    persona: '04-architect',
    contract: makeContract({ kb_scope: { default: ['kb:hets/spawn-conventions', 'kb:architecture/crosscut/single-responsibility'] } }),
    pluginVersion: '2.8.0',
  });
  if (h1 === h2) throw new Error('hash should change when kb_scope.default changes');
});

test('CH6: skill_status field is EXCLUDED from hash (churn during bootstrap)', () => {
  const { computeContentHash } = loadSynthid();
  const h1 = computeContentHash({
    persona: '04-architect',
    contract: makeContract({ skills: { required: ['plan'], skill_status: { plan: 'not-yet-authored' } } }),
    pluginVersion: '2.8.0',
  });
  const h2 = computeContentHash({
    persona: '04-architect',
    contract: makeContract({ skills: { required: ['plan'], skill_status: { plan: 'available' } } }),
    pluginVersion: '2.8.0',
  });
  if (h1 !== h2) throw new Error(`skill_status churn bumped hash: ${h1} vs ${h2}`);
});

test('CH7: plugin patch version EXCLUDED (cosmetic ships)', () => {
  const { computeContentHash } = loadSynthid();
  const h1 = computeContentHash({
    persona: '04-architect',
    contract: makeContract(),
    pluginVersion: '2.8.0',
  });
  const h2 = computeContentHash({
    persona: '04-architect',
    contract: makeContract(),
    pluginVersion: '2.8.5',
  });
  if (h1 !== h2) throw new Error(`patch-version bumped hash (should be excluded): ${h1} vs ${h2}`);
});

test('CH8: plugin MINOR version included (functional changes)', () => {
  const { computeContentHash } = loadSynthid();
  const h1 = computeContentHash({
    persona: '04-architect',
    contract: makeContract(),
    pluginVersion: '2.8.0',
  });
  const h2 = computeContentHash({
    persona: '04-architect',
    contract: makeContract(),
    pluginVersion: '2.9.0',
  });
  if (h1 === h2) throw new Error('minor-version bump should change hash');
});

test('CH9: plugin MAJOR version included', () => {
  const { computeContentHash } = loadSynthid();
  const h1 = computeContentHash({
    persona: '04-architect',
    contract: makeContract(),
    pluginVersion: '2.8.0',
  });
  const h2 = computeContentHash({
    persona: '04-architect',
    contract: makeContract(),
    pluginVersion: '3.0.0',
  });
  if (h1 === h2) throw new Error('major-version bump should change hash');
});

test('CH10: agentMd content affects hash when provided', () => {
  const { computeContentHash } = loadSynthid();
  const h1 = computeContentHash({
    persona: '04-architect',
    contract: makeContract(),
    agentMd: '# Architect\n\nDoes thoughtful design.',
    pluginVersion: '2.8.0',
  });
  const h2 = computeContentHash({
    persona: '04-architect',
    contract: makeContract(),
    agentMd: '# Architect\n\nDoes EXTREMELY thoughtful design.',
    pluginVersion: '2.8.0',
  });
  if (h1 === h2) throw new Error('agentMd content change should bump hash');
});

test('CH11: agentMd absent → still produces valid hash (handled as null)', () => {
  const { computeContentHash } = loadSynthid();
  const h = computeContentHash({
    persona: '04-architect',
    contract: makeContract(),
    pluginVersion: '2.8.0',
    // no agentMd field
  });
  if (!/^[0-9a-f]{8}$/.test(h)) throw new Error(`expected valid hash, got '${h}'`);
});

test('CH12: skills.recommended order does NOT affect hash (sorted internally)', () => {
  const { computeContentHash } = loadSynthid();
  const h1 = computeContentHash({
    persona: '04-architect',
    contract: makeContract({ skills: { required: ['a', 'b'], recommended: ['x', 'y', 'z'] } }),
    pluginVersion: '2.8.0',
  });
  const h2 = computeContentHash({
    persona: '04-architect',
    contract: makeContract({ skills: { required: ['b', 'a'], recommended: ['z', 'y', 'x'] } }),
    pluginVersion: '2.8.0',
  });
  if (h1 !== h2) throw new Error(`sort-order should not affect hash: ${h1} vs ${h2}`);
});

// ============================================================================
// Group 2: formatSynthId — composes IDs from parts
// ============================================================================

test('FS1: bare name (no hash, no lineage) → persona.name', () => {
  const { formatSynthId } = loadSynthid();
  const id = formatSynthId({ persona: '04-architect', name: 'mira' });
  if (id !== '04-architect.mira') throw new Error(`expected '04-architect.mira', got '${id}'`);
});

test('FS2: with contentHash → persona.name~hash', () => {
  const { formatSynthId } = loadSynthid();
  const id = formatSynthId({ persona: '04-architect', name: 'mira', contentHash: 'a3f192c8' });
  if (id !== '04-architect.mira~a3f192c8') {
    throw new Error(`expected '04-architect.mira~a3f192c8', got '${id}'`);
  }
});

test('FS3: with lineage (v2.8.1 forward compat) → persona.name~hash/lineage', () => {
  const { formatSynthId } = loadSynthid();
  const id = formatSynthId({
    persona: '04-architect',
    name: 'mira',
    contentHash: 'a3f192c8',
    lineage: { runId: '01H8X9KQ', depth: 1, parent: 'foo', parentHash: 'bd60' },
  });
  // Expected: 04-architect.mira~a3f192c8/r:01H8X9KQ:d1:p=foo#bd60
  if (!id.includes('~a3f192c8/r:01H8X9KQ:d1:p=foo#bd60')) {
    throw new Error(`lineage suffix wrong, got '${id}'`);
  }
});

test('FS4: lineage at depth 0 → omits :d segment', () => {
  const { formatSynthId } = loadSynthid();
  const id = formatSynthId({
    persona: '04-architect',
    name: 'mira',
    contentHash: 'a3f192c8',
    lineage: { runId: '01H8X9KQ', depth: 0 },
  });
  if (id.includes(':d0')) throw new Error(`depth 0 should be omitted: '${id}'`);
  if (!id.includes('r:01H8X9KQ')) throw new Error(`runId missing: '${id}'`);
});

// ============================================================================
// Group 3: parseSynthId — round-trips + tolerates missing suffixes
// ============================================================================

test('PS1: bare `04-architect.mira` → parses cleanly', () => {
  const { parseSynthId } = loadSynthid();
  const r = parseSynthId('04-architect.mira');
  if (!r) throw new Error('expected non-null parse result');
  if (r.persona !== '04-architect') throw new Error(`persona='${r.persona}'`);
  if (r.name !== 'mira') throw new Error(`name='${r.name}'`);
  if (r.contentHash) throw new Error(`expected no contentHash, got '${r.contentHash}'`);
  if (r.lineage) throw new Error(`expected no lineage, got '${JSON.stringify(r.lineage)}'`);
});

test('PS2: `04-architect.mira~a3f192c8` → parses with hash', () => {
  const { parseSynthId } = loadSynthid();
  const r = parseSynthId('04-architect.mira~a3f192c8');
  if (!r) throw new Error('expected non-null parse result');
  if (r.contentHash !== 'a3f192c8') throw new Error(`contentHash='${r.contentHash}'`);
  if (r.lineage) throw new Error('expected no lineage');
});

test('PS3: full SynthId with lineage → parses all fields', () => {
  const { parseSynthId } = loadSynthid();
  const r = parseSynthId('04-architect.mira~a3f192c8/r:01H8X9KQ:d1:p=foo#bd60');
  if (!r) throw new Error('expected non-null parse result');
  if (r.contentHash !== 'a3f192c8') throw new Error(`contentHash='${r.contentHash}'`);
  if (!r.lineage) throw new Error('expected lineage object');
  if (r.lineage.runId !== '01H8X9KQ') throw new Error(`runId='${r.lineage.runId}'`);
  if (r.lineage.depth !== 1) throw new Error(`depth=${r.lineage.depth}`);
  if (r.lineage.parent !== 'foo') throw new Error(`parent='${r.lineage.parent}'`);
  if (r.lineage.parentHash !== 'bd60') throw new Error(`parentHash='${r.lineage.parentHash}'`);
});

test('PS4: SynthId with lineage but no depth (root) → depth: 0', () => {
  const { parseSynthId } = loadSynthid();
  const r = parseSynthId('04-architect.mira~a3f192c8/r:01H8X9KQ');
  if (!r) throw new Error('expected non-null parse result');
  if (!r.lineage) throw new Error('expected lineage object');
  if (r.lineage.depth !== 0) throw new Error(`expected depth=0 for root, got ${r.lineage.depth}`);
  if (r.lineage.runId !== '01H8X9KQ') throw new Error(`runId='${r.lineage.runId}'`);
});

test('PS5: garbage input → null', () => {
  const { parseSynthId } = loadSynthid();
  if (parseSynthId('') !== null) throw new Error('empty string should return null');
  if (parseSynthId('no-dot') !== null) throw new Error('no-dot should return null');
  if (parseSynthId(null) !== null) throw new Error('null should return null');
  if (parseSynthId(undefined) !== null) throw new Error('undefined should return null');
});

test('PS6: round-trip (format → parse → same parts)', () => {
  const { formatSynthId, parseSynthId } = loadSynthid();
  const id = formatSynthId({
    persona: '04-architect',
    name: 'mira',
    contentHash: 'a3f192c8',
    lineage: { runId: '01H8X9KQ', depth: 2, parent: 'nova', parentHash: '9d7e' },
  });
  const r = parseSynthId(id);
  if (r.persona !== '04-architect') throw new Error(`persona round-trip failed`);
  if (r.name !== 'mira') throw new Error(`name round-trip failed`);
  if (r.contentHash !== 'a3f192c8') throw new Error(`hash round-trip failed`);
  if (r.lineage.depth !== 2) throw new Error(`depth round-trip failed`);
  if (r.lineage.parent !== 'nova') throw new Error(`parent round-trip failed`);
});

// ============================================================================
// Group 4: invariants + integration with existing identity format
// ============================================================================

test('INV1: bare-name lookup still resolves (backwards compat)', () => {
  // Critical invariant: existing `04-architect.mira` strings must parse.
  // This is what the migration step relies on.
  const { parseSynthId } = loadSynthid();
  const r = parseSynthId('04-architect.mira');
  if (!r || r.persona !== '04-architect' || r.name !== 'mira') {
    throw new Error('bare-name lookup must work for backwards compat');
  }
});

test('INV2: persona with hyphens in middle parses correctly', () => {
  const { parseSynthId } = loadSynthid();
  // 02-confused-user has 2 hyphens; the dot separator is after the last segment
  const r = parseSynthId('02-confused-user.alex~deadbeef');
  if (!r) throw new Error('expected non-null parse');
  if (r.persona !== '02-confused-user') throw new Error(`persona='${r.persona}'`);
  if (r.name !== 'alex') throw new Error(`name='${r.name}'`);
});

test('INV3: parseSynthId is idempotent on already-bare input', () => {
  const { parseSynthId, formatSynthId } = loadSynthid();
  const id = formatSynthId({ persona: '04-architect', name: 'mira' });
  const reformatted = formatSynthId(parseSynthId(id));
  if (reformatted !== id) throw new Error(`idempotency failed: '${id}' → '${reformatted}'`);
});

// ============================================================================
// Group 5: validateSuffix (v2.8.0.x — contract-verifier integration)
// Pure function: parses identity, computes expected hash, returns status.
// Observability-only contract — caller decides what to do with mismatches.
// ============================================================================

test('VS1: match → status=match when suffix equals computed hash', () => {
  const { computeContentHash, formatSynthId, validateSuffix } = loadSynthid();
  const contract = makeContract();
  const pluginVersion = '2.8.0';
  const hash = computeContentHash({ persona: '04-architect', contract, pluginVersion });
  const identity = formatSynthId({ persona: '04-architect', name: 'mira', contentHash: hash });
  const r = validateSuffix({ identity, contract, pluginVersion });
  if (r.status !== 'match') throw new Error(`expected status=match, got ${r.status}`);
  if (r.suffix !== hash) throw new Error(`expected suffix=${hash}, got ${r.suffix}`);
  if (r.expectedHash !== hash) throw new Error(`expected expectedHash=${hash}, got ${r.expectedHash}`);
  if (r.warning) throw new Error(`match should NOT emit warning, got ${r.warning}`);
});

test('VS2: mismatch → status=mismatch + warning when suffix differs', () => {
  const { validateSuffix } = loadSynthid();
  const contract = makeContract();
  const identity = '04-architect.mira~deadbeef';
  const r = validateSuffix({ identity, contract, pluginVersion: '2.8.0' });
  if (r.status !== 'mismatch') throw new Error(`expected status=mismatch, got ${r.status}`);
  if (r.suffix !== 'deadbeef') throw new Error(`expected suffix=deadbeef, got ${r.suffix}`);
  if (typeof r.expectedHash !== 'string' || r.expectedHash.length !== 8) {
    throw new Error(`expected expectedHash to be 8-hex string, got ${r.expectedHash}`);
  }
  if (typeof r.warning !== 'string' || !r.warning.includes('deadbeef')) {
    throw new Error(`expected warning string mentioning deadbeef, got ${r.warning}`);
  }
});

test('VS3: bare label (no suffix) → status=no-suffix (no warning)', () => {
  const { validateSuffix } = loadSynthid();
  const contract = makeContract();
  const r = validateSuffix({ identity: '04-architect.mira', contract, pluginVersion: '2.8.0' });
  if (r.status !== 'no-suffix') throw new Error(`expected status=no-suffix, got ${r.status}`);
  if (r.warning) throw new Error(`bare label should NOT emit warning, got ${r.warning}`);
});

test('VS4: null/empty identity → status=no-identity', () => {
  const { validateSuffix } = loadSynthid();
  const contract = makeContract();
  const r1 = validateSuffix({ identity: null, contract, pluginVersion: '2.8.0' });
  if (r1.status !== 'no-identity') throw new Error(`null: expected no-identity, got ${r1.status}`);
  const r2 = validateSuffix({ identity: '', contract, pluginVersion: '2.8.0' });
  if (r2.status !== 'no-identity') throw new Error(`empty: expected no-identity, got ${r2.status}`);
});

test('VS5: unparseable identity → status=parse-error', () => {
  const { validateSuffix } = loadSynthid();
  const contract = makeContract();
  const r = validateSuffix({ identity: 'malformed/garbage///', contract, pluginVersion: '2.8.0' });
  if (r.status !== 'parse-error') throw new Error(`expected status=parse-error, got ${r.status}`);
});

test('VS6: suffix present but no contract → status=no-contract (preserves suffix)', () => {
  const { validateSuffix } = loadSynthid();
  const r = validateSuffix({ identity: '04-architect.mira~aaaa1111', contract: null, pluginVersion: '2.8.0' });
  if (r.status !== 'no-contract') throw new Error(`expected status=no-contract, got ${r.status}`);
  if (r.suffix !== 'aaaa1111') throw new Error(`expected suffix preserved, got ${r.suffix}`);
});

test('VS7: compute-error is caught and surfaces gracefully', () => {
  const { validateSuffix } = loadSynthid();
  // Missing pluginVersion → computeContentHash throws ("requires persona + contract + pluginVersion")
  const r = validateSuffix({
    identity: '04-architect.mira~aaaa1111',
    contract: makeContract(),
    pluginVersion: null,
  });
  if (r.status !== 'compute-error') throw new Error(`expected status=compute-error, got ${r.status}`);
  if (!r.error) throw new Error(`expected error message, got ${r.error}`);
});

process.stdout.write(`\n=== Summary ===\n`);
process.stdout.write(`  Passed: ${passed}\n`);
process.stdout.write(`  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
