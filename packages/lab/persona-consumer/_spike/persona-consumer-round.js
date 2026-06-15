#!/usr/bin/env node

// @loom-layer: lab
//
// v3.10-W1 — the persona-consumer ROUND harness (a SPIKE, OUT of CI as a standalone; exercised by
// tests/unit/lab/persona-consumer/round.test.js, which SPAWNS it as a CHILD PROCESS with the env
// seams pre-set). It runs ONE full round on the REAL kernel+runtime+lab stack:
//
//   registry identity (real assign CLI) -> built_by adapter -> real populateRecallGraph + writeNode
//   (kernel _lib) -> mock hardening signal (isolated store) -> recalibratePersonaReputation.
//
// WHY A CHILD PROCESS (VERIFY-hacker CRITICAL — the ENV-BEFORE-REQUIRE trap): every lab store +
// the identity registry pin their state dir as a module-load `const`. Setting the env AFTER require
// writes to the REAL lane. So the spawner sets HOME + LOOM_LAB_STATE_DIR + HETS_IDENTITY_STORE +
// LOOM_SPAWN_STATE_DIR BEFORE this process starts; this file's requires then resolve to the temp base.
//
// The built_by ADAPTER (VERIFY-honesty CRITICAL): cmdAssign emits {persona,name,...} with NO
// role/roster_name/actor_kind; built_by REQUIRES them. The IDENTITY is real; the TAG is a declared
// projection: persona '99-test-probe' (NN- roster key, illegal as a role token) -> role 'test-probe'
// (NN- stripped, token-legal), roster_name = the assigned name, actor_kind 'agent_spawn'.
//
// Emits a JSON result on stdout. `--check` exits non-zero on any self-assertion failure.

'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const AGENT_ID_CLI = path.join(REPO, 'packages', 'runtime', 'orchestration', 'agent-identity.js');

// env is already set (spawner) -> these requires resolve their dirs to the temp base.
const registry = require(path.join(REPO, 'packages', 'runtime', 'orchestration', 'identity', 'registry.js'));
const { populateRecallGraph } = require(path.join(REPO, 'packages', 'lab', 'attribution', 'recall-graph.js'));
const nodeStore = require(path.join(REPO, 'packages', 'lab', 'attribution', 'recall-graph-store.js'));
const signalStore = require(path.join(REPO, 'packages', 'lab', 'persona-consumer', 'hardening-signal-store.js'));
const { recalibratePersonaReputation } = require(path.join(REPO, 'packages', 'lab', 'persona-consumer', 'recalibrate.js'));

const TEST_PERSONA = '99-test-probe';          // a roster KEY (NN- convention; illegal as a role token)
const NOW = '2026-06-15T00:00:00.000Z';

// The declared adapter: assign output (persona, name) -> a token-legal built_by tag.
function builtByFromAssign(persona, name) {
  return { role: persona.replace(/^\d+-/, ''), roster_name: name, actor_kind: 'agent_spawn' };
}

function seedRoster(names) {
  const store = registry.readStore();
  store.rosters = { ...store.rosters, [TEST_PERSONA]: names };
  store.nextIndex = { ...store.nextIndex, [TEST_PERSONA]: 0 };
  registry.writeStore(store);
}

function assign() { // the REAL runtime path (CLI), parsed from stdout JSON
  const out = execFileSync('node', [AGENT_ID_CLI, 'assign', '--persona', TEST_PERSONA], {
    env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out);
}

// E6 (VALIDATE-honesty MED): exercise the REAL prune->retire pipeline (NOT a hand-set flag). With
// --retire-min-verdicts 0 a 0-verdict identity meets the retire threshold, so cmdPrune --auto retires
// the only assigned identity (t1; t2 is roster-only, not yet an identity). Uses withLock internally.
function pruneRetireAll() {
  execFileSync('node', [AGENT_ID_CLI, 'prune', '--auto', '--retire-min-verdicts', '0'], {
    env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function eligibleAttempt(builtBy, seed) {
  return {
    id: `probe__${seed}`, recall_eligible: true, built_by: builtBy, resolution_friction: null,
    reference: {
      issue_id: `probe__${seed}`, repo: 'probe/repo', problem_statement_digest: `dg-${seed}`,
      candidate_patch_ref: `cafe${seed}`, behavioral_verdict: 'BEHAVIORAL_PASS',
      reference_divergence: 0.2, contamination_tier: 'clean-pending-probe',
    },
  };
}

function run() {
  // 1) real runtime identity (roster seeded, then the real assign CLI)
  seedRoster(['t1', 't2']);
  const a1 = assign();
  const builtBy = builtByFromAssign(a1.persona, a1.name);

  // 2) real recall-graph node (kernel _lib content-address + atomic-write), built_by the real identity
  const pop = populateRecallGraph([eligibleAttempt(builtBy, '1')]);
  const node = pop.nodes[0];
  const wn = nodeStore.writeNode(node);
  // VALIDATE-hacker HIGH: a node_id collision is reported ONLY by writeNode's return (the persisted
  // node keeps one built_by + no flag), so capture it from the PRODUCER side and feed the consumer's
  // guard. Solo W1 has no collision (one persona + clean disposal); this threads the seam W2 needs.
  const collisionNodeIds = wn.persona_collision ? [node.node_id] : [];

  // 3) mock hardening signal about that node (isolated lane)
  const ws = signalStore.writeSignal({ node_id: node.node_id, outcome: 'support', source: 'mock', recorded_at: NOW });

  // 4) recalibrate over the REAL persisted stores
  const rep = recalibratePersonaReputation(nodeStore.listNodes(), signalStore.listSignals(), { now: NOW, collisionNodeIds });
  const key = `${builtBy.role}.${builtBy.roster_name}`;

  // 5) E6 — retire the assigned identity via the REAL prune pipeline; a re-assign must NOT return it
  pruneRetireAll();
  const a2 = assign();

  return {
    ok: true,
    assigned: a1.name,
    built_by: builtBy,
    node_id: node.node_id,
    node_written: wn.ok === true,
    signal_written: ws.ok === true,
    recalibrated_persona: key,
    posterior: rep.per_persona[key] ? rep.per_persona[key].posterior : null,
    e6_reassign_excluded_retired: a2.name !== a1.name,
    e6_reassigned: a2.name,
    store_dirs: { nodes: nodeStore.DEFAULT_DIR, signals: signalStore.DEFAULT_DIR, identities: registry.STORE_PATH },
  };
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  let result;
  try { result = run(); } catch (e) { process.stdout.write(JSON.stringify({ ok: false, error: e.message }) + '\n'); process.exit(1); }
  process.stdout.write(JSON.stringify(result) + '\n');
  if (check) {
    const good = result.node_written && result.signal_written && result.posterior === 2 / 3 && result.e6_reassign_excluded_retired;
    process.exit(good ? 0 : 1);
  }
}

module.exports = { run, builtByFromAssign };
