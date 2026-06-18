#!/usr/bin/env node

// tests/unit/lab/negative-attestation/record-from-decompose.test.js
//
// E1 ingest (Wave 0 capture half): a decompose-run OUTBOX → negative attestations. Proves the
// runtime→lab DATA contract (the outbox JSON) round-trips into the E1 store, with provenance
// (persona/task/leaf id) attributed from the outbox itself.
//
// ENV-BEFORE-REQUIRE: both runState (HETS_RUN_STATE_DIR) and store (LOOM_LAB_STATE_DIR) capture
// their roots at module-load — set both BEFORE the requires.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = path.join(os.tmpdir(), 'e1-ingest-' + crypto.randomBytes(6).toString('hex'));
const RUN_STATE = path.join(TMP, 'run-state');
const LAB_STATE = path.join(TMP, 'lab-state');
process.env.HETS_RUN_STATE_DIR = RUN_STATE; // BEFORE requires
process.env.LOOM_LAB_STATE_DIR = LAB_STATE;
// Shrink the outbox byte cap so the oversize-read test can exercise it without a 16MB fixture
// (ENV-BEFORE-REQUIRE: record-from-decompose.js reads MAX_OUTBOX_BYTES at module-load). Kept above
// the test-5b DoS fixture's size (~736KB) so that legitimate case still reads.
process.env.LOOM_LAB_MAX_OUTBOX_BYTES = String(2 * 1024 * 1024);
fs.mkdirSync(TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const { recordFromDecompose } = require(path.join(REPO_ROOT, 'packages', 'lab', 'negative-attestation', 'record-from-decompose.js'));
const { listAttestations } = require(path.join(REPO_ROOT, 'packages', 'lab', 'negative-attestation', 'store.js'));
const { runStateDir } = require(path.join(REPO_ROOT, 'packages', 'kernel', '_lib', 'runState.js'));
const { buildFailureSignature } = require(path.join(REPO_ROOT, 'packages', 'runtime', 'verify', 'failure-signature.js'));

function sig(criterion) {
  return buildFailureSignature({
    failed_criterion_id: criterion,
    discipline: 'spec-driven',
    verifier_kind: 'structural',
    detection_phase: 'pre-spawn-leaf-check',
    human_message: `leaf rejected by ${criterion}`,
  });
}

// Write a fake decompose-run outbox (the exact shape decompose-run.js:runCli emits).
function writeOutbox(runId, payload) {
  const dir = runStateDir(runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'decompose-result.json'), JSON.stringify(payload, null, 2));
}

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fs.rmSync(path.join(LAB_STATE, 'negative-attestations', 'ledger.jsonl'), { force: true }); } catch { /* none yet */ }
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// ── 1. The headline ingest: an outbox with 2 rejects → 2 attestations, persona+leaf attributed.
test('ingest: outbox rejected[] → attestations with persona + leaf-ref attributed from the outbox', () => {
  writeOutbox('run-ingest', {
    run_id: 'run-ingest', persona: 'code-reviewer', task: 'pr-review',
    admitted: ['leaf-ok'],
    rejected: [
      { id: 'leaf-a', failure_signature: sig('interface-clean') },
      { id: 'leaf-b', failure_signature: sig('validation-supported') },
    ],
    all_rejected: false,
  });
  const summary = recordFromDecompose({ runId: 'run-ingest' });
  assert.strictEqual(summary.recorded, 2, 'both rejects recorded');
  assert.strictEqual(summary.deduped, 0);
  assert.strictEqual(summary.persona, 'code-reviewer');

  const live = listAttestations();
  assert.strictEqual(live.length, 2);
  assert.ok(live.every((r) => r.identity.subagent_type === 'code-reviewer'), 'persona attributed from outbox');
  assert.ok(live.every((r) => r.identity.task_signature === 'pr-review'), 'task attributed from outbox');
  assert.deepStrictEqual(live.map((r) => r.run_id), ['run-ingest', 'run-ingest']);
  // leaf id became the leaf_ref component of attestation_id (distinct ids → 2 distinct attestations)
  assert.strictEqual(new Set(live.map((r) => r.attestation_id)).size, 2, 'distinct leaves → distinct attestations');
});

// ── 2. Re-ingest is idempotent (replay): running the SAME outbox twice records once, dedups the rest.
test('re-ingesting the same outbox is idempotent (replay-dedup, no double-count)', () => {
  writeOutbox('run-replay', {
    run_id: 'run-replay', persona: 'code-reviewer', task: 't',
    admitted: [], rejected: [{ id: 'L', failure_signature: sig('cost-justified') }], all_rejected: true,
  });
  const first = recordFromDecompose({ runId: 'run-replay' });
  const second = recordFromDecompose({ runId: 'run-replay' });
  assert.strictEqual(first.recorded, 1);
  assert.strictEqual(second.recorded, 0, 'replay records nothing new');
  assert.strictEqual(second.deduped, 1, 'replay is deduped');
  assert.strictEqual(listAttestations().length, 1, 'one attestation, not two');
});

// ── 3. all-admitted outbox (no rejects) → records nothing, cleanly.
test('an all-admitted outbox (no rejected[]) records nothing and does not error', () => {
  writeOutbox('run-clean', {
    run_id: 'run-clean', persona: 'code-reviewer', task: 't', admitted: ['a', 'b'], rejected: [], all_rejected: false,
  });
  const summary = recordFromDecompose({ runId: 'run-clean' });
  assert.strictEqual(summary.recorded, 0);
  assert.strictEqual(summary.rejectedCount, 0);
  assert.strictEqual(listAttestations().length, 0);
});

// ── 4. Error paths: a missing outbox + a persona-less outbox both throw (the CLI converts to exit 1).
test('error paths: missing outbox throws; a persona-less outbox throws (cannot attribute)', () => {
  assert.throws(() => recordFromDecompose({ runId: 'no-such-run' }), /ENOENT|no such file/i);
  writeOutbox('run-nopersona', { run_id: 'run-nopersona', rejected: [{ id: 'x', failure_signature: sig('resource-bounded') }] });
  assert.throws(() => recordFromDecompose({ runId: 'run-nopersona' }), /no persona/i);
  assert.throws(() => recordFromDecompose({}), /runId/);
  // a corrupt (non-JSON) outbox throws the parse error (the CLI converts it to a clean exit 1)
  fs.mkdirSync(runStateDir('run-corrupt'), { recursive: true });
  fs.writeFileSync(path.join(runStateDir('run-corrupt'), 'decompose-result.json'), 'not-json{{{');
  assert.throws(() => recordFromDecompose({ runId: 'run-corrupt' }), /JSON|Unexpected/i);
});

// ── 4b. C1 (hacker VALIDATE — CRITICAL): the ingest SELF-DEFENDS against a path-traversal runId.
//        An attacker invoking `record-from-decompose --run-id ../../secret` directly must NOT be able
//        to read an arbitrary file into a forged attestation. The runId is guarded as a safe path
//        segment PRE-join, so the traversal is rejected before any readFileSync.
test('C1: a path-traversal runId is rejected at the ingest boundary (no arbitrary file read)', () => {
  assert.throws(() => recordFromDecompose({ runId: '../../../../etc/passwd' }), /safe path segment/i);
  assert.throws(() => recordFromDecompose({ runId: 'a/b' }), /safe path segment/i);
  assert.throws(() => recordFromDecompose({ runId: '..' }), /safe path segment/i);
});

// ── 5. Malformed rejected entries are skipped (fail-soft), not fatal.
test('a malformed rejected entry is skipped (fail-soft), valid siblings still record', () => {
  writeOutbox('run-malformed', {
    run_id: 'run-malformed', persona: 'code-reviewer', task: 't',
    admitted: [],
    rejected: [
      { id: 'good', failure_signature: sig('discipline-gate') },
      { id: 'bad-no-sig' },                 // missing failure_signature → skipped
      null,                                  // junk → skipped
    ],
    all_rejected: true,
  });
  const summary = recordFromDecompose({ runId: 'run-malformed' });
  assert.strictEqual(summary.recorded, 1, 'only the well-formed reject recorded');
  assert.strictEqual(summary.skipped, 2, 'two malformed entries skipped');
});

// ── 5b. ★ DoS guard (hacker VALIDATE — the HIGH): a non-flat failure_signature (a nested object/array
//        value — a hand-crafted-outbox depth/width bomb) is skipped at the ingest boundary, BEFORE the
//        recursive serializers (canonicalJsonSerialize + the verbatim writeLedger) ever see it. One
//        hostile leaf must never fail the whole run's ingest — the flat siblings still record (never-drop
//        for the good leaves). Shape-based rejection → deterministic, no reliance on actually overflowing.
test('★ a non-flat (nested) failure_signature is skipped at the ingest boundary; flat siblings still record', () => {
  let deep = {}; let cur = deep;
  for (let i = 0; i < 200; i++) { cur.n = {}; cur = cur.n; } // a nested-object value
  writeOutbox('run-dos', {
    run_id: 'run-dos', persona: 'code-reviewer', task: 't',
    admitted: [],
    rejected: [
      { id: 'good-1', failure_signature: sig('cost-justified') },
      { id: 'deep-bomb', failure_signature: { ...sig('interface-clean'), nested: deep } },        // non-flat → skipped
      { id: 'wide-bomb', failure_signature: { ...sig('resource-bounded'), arr: new Array(50000).fill(1) } }, // non-flat → skipped
      { id: 'good-2', failure_signature: sig('discipline-gate') },
    ],
    all_rejected: true,
  });
  let summary;
  assert.doesNotThrow(() => { summary = recordFromDecompose({ runId: 'run-dos' }); }, 'one hostile leaf must not abort the whole batch');
  assert.strictEqual(summary.recorded, 2, 'both FLAT siblings recorded (good-1, good-2)');
  assert.strictEqual(summary.skipped, 2, 'the deep + wide non-flat signatures skipped');
  assert.strictEqual(listAttestations().length, 2, 'only the well-formed witnesses landed');
});

// ── 6. ★ outbox byte-cap (the unbounded-read fix): a decompose-result.json larger than the
//        MAX_OUTBOX_BYTES cap is REFUSED before fs.readFileSync materializes it as a string — so a
//        hand-crafted / flooded outbox can't spike RSS or hit V8's ~512MB single-string ceiling. The
//        cap is shrunk to 2KB for this test (env, set at the top); a small in-bounds outbox still reads.
test('★ outbox byte-cap: an oversized decompose-result.json is refused before the readFileSync', () => {
  // an outbox padded past the 2MB test cap (a long task string inflates the file > cap)
  writeOutbox('run-huge', {
    run_id: 'run-huge', persona: 'code-reviewer', task: 'x'.repeat(3 * 1024 * 1024),
    admitted: [], rejected: [{ id: 'L', failure_signature: sig('cost-justified') }], all_rejected: true,
  });
  assert.throws(() => recordFromDecompose({ runId: 'run-huge' }), /read cap|exceeding/i, 'oversize outbox refused');
  assert.strictEqual(listAttestations().length, 0, 'nothing recorded from the refused outbox');
  // a small in-bounds outbox still reads + records normally (the cap is not over-tight)
  writeOutbox('run-small', {
    run_id: 'run-small', persona: 'code-reviewer', task: 't',
    admitted: [], rejected: [{ id: 'L', failure_signature: sig('cost-justified') }], all_rejected: true,
  });
  const summary = recordFromDecompose({ runId: 'run-small' });
  assert.strictEqual(summary.recorded, 1, 'an in-bounds outbox reads + records normally');
});

process.stdout.write(`\nrecord-from-decompose.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
