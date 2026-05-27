// tests/unit/kernel/_lib/_test-harness.js
//
// Test harness for v6 K2 reservation PR property tests.
//
// v6 spec anchors:
//   Round-3d C3+C4 (per persona-Tess T1+T2): "property-test harness +
//   clock-injection infra" — covers synthetic-WAL fixture builder (INV-A9),
//   injectable-clock + injectable-fs-watch (INV-28 wallclock-bounded test
//   flakiness mitigation), kernel-crash injection (INV-26).
//   §6.5 Round-3d additions — "+500-1000 LoC / +10-15h" budget line item.
//
// What this harness provides:
//   - InjectableClock: deterministic time-mocking for INV-28 tests
//   - synthesizeWAL: build a valid JSONL WAL with proper sha256 chain
//   - tmpDir: scoped temp directory cleanup per test
//   - crashInjector: simulate kernel-crash at a specific write phase

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const {
  canonicalJsonSerialize,
  computeTransactionId,
  computeGenesisHash,
} = require('../../../../packages/kernel/_lib/transaction-record');

/**
 * Create an InjectableClock for deterministic time-mocking.
 *
 * Per Round-3d C4 (per persona-Tess T2): "design the property test from day-1
 * around an injectable clock-and-watch-event source (dependency-injection
 * over Date.now + fs.watch event emitter). Without this design from day-1,
 * every CI run risks INV-28 flake."
 *
 * Usage:
 *   const clock = createInjectableClock({ start: '2026-01-01T00:00:00Z' });
 *   clock.advance(3000);  // forward 3000ms
 *   const now = clock.now(); // Date object
 */
function createInjectableClock(opts = {}) {
  let current = new Date(opts.start || '2026-01-01T00:00:00.000Z').getTime();
  return {
    now() {
      return new Date(current);
    },
    nowMs() {
      return current;
    },
    advance(ms) {
      current += ms;
    },
    setTo(ts) {
      current = typeof ts === 'number' ? ts : new Date(ts).getTime();
    },
  };
}

/**
 * Create a scoped temp directory that auto-cleans on test teardown.
 *
 * Usage:
 *   const tmp = createTmpDir('k2-test');
 *   // ... use tmp.path ...
 *   tmp.cleanup();
 */
function createTmpDir(prefix = 'k2-test') {
  const base = path.join(os.tmpdir(), prefix + '-' + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(base, { recursive: true });
  return {
    path: base,
    cleanup() {
      try {
        fs.rmSync(base, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    },
  };
}

/**
 * Synthesize a chain-of-N transaction records with proper sha256 linking.
 *
 * Each record's `prev_state_hash` points to the previous record's
 * `post_state_hash`. The first record's `prev_state_hash` is the genesis
 * sentinel for (schema_version, scope).
 *
 * @param {Object} opts
 * @param {number} opts.count Number of records to generate
 * @param {string} [opts.schemaVersion='v6.0']
 * @param {'per-user'|'per-project'} [opts.scope='per-user']
 * @param {string} [opts.writerPersonaId='04-architect.theo']
 * @param {'PENDING'|'COMMITTED'|'ABORTED'} [opts.commitOutcome='COMMITTED']
 * @returns {Array<Object>} Array of valid transaction records
 */
function synthesizeChain(opts = {}) {
  const count = opts.count || 1;
  const schemaVersion = opts.schemaVersion || 'v6.0';
  const scope = opts.scope || 'per-user';
  const writerPersonaId = opts.writerPersonaId || '04-architect.theo';
  const commitOutcome = opts.commitOutcome || 'COMMITTED';
  const baseTimestamp = new Date(opts.startAt || '2026-01-01T00:00:00.000Z').getTime();

  const records = [];
  let prevStateHash = computeGenesisHash(schemaVersion, scope);

  for (let i = 0; i < count; i++) {
    const recordTimestamp = new Date(baseTimestamp + i * 1000).toISOString();
    const postStateHash = crypto
      .createHash('sha256')
      .update('post-' + i + '-' + prevStateHash)
      .digest('hex');

    // Pre-compute a content hash for evidence_refs.
    const evidenceRef = crypto.createHash('sha256').update('evidence-' + i).digest('hex');

    const recordWithoutId = {
      prev_state_hash: prevStateHash,
      post_state_hash: postStateHash,
      writer_persona_id: writerPersonaId,
      writer_spawn_id: 'sp-' + recordTimestamp + '-test-' + String(i).padStart(4, '0'),
      parent_state_id: i === 0 ? null : records[i - 1].writer_spawn_id,
      operation_class: 'APPEND',
      affected_records: ['test-record-' + i],
      evidence_refs: i === 0 ? ['GENESIS_EVIDENCE:' + schemaVersion + ':' + scope] : [evidenceRef],
      schema_version: schemaVersion,
      policy_version: 'a'.repeat(64),
      intent_recorded_at: recordTimestamp,
      committed_at: commitOutcome === 'COMMITTED' ? recordTimestamp : null,
      commit_outcome: commitOutcome,
      abort_reason: null,
      idempotency_key: crypto.createHash('sha256').update('idem-' + i).digest('hex'),
      references_transaction_id: null,
      abort_detail: null,
    };

    const transactionId = computeTransactionId(recordWithoutId);
    records.push({ transaction_id: transactionId, ...recordWithoutId });
    prevStateHash = postStateHash;
  }

  return records;
}

/**
 * Write an array of records to a JSONL WAL file at the given path.
 * Each record on its own line (per §5.1 WAL format).
 */
function writeWAL(walPath, records) {
  fs.mkdirSync(path.dirname(walPath), { recursive: true });
  const lines = records.map((r) => JSON.stringify(r)).join('\n') + (records.length > 0 ? '\n' : '');
  fs.writeFileSync(walPath, lines);
}

/**
 * Append a single record to an existing JSONL WAL (per §5.1 append-only).
 */
function appendWAL(walPath, record) {
  fs.appendFileSync(walPath, JSON.stringify(record) + '\n');
}

/**
 * Read all records from a JSONL WAL.
 */
function readWAL(walPath) {
  if (!fs.existsSync(walPath)) return [];
  const raw = fs.readFileSync(walPath, 'utf8');
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

/**
 * Snapshot metadata about a WAL file for INV-19 (WAL append-only) tests.
 */
function walSnapshot(walPath) {
  if (!fs.existsSync(walPath)) {
    return { exists: false, lineCount: 0, byteLength: 0, mtimeMs: 0 };
  }
  const stat = fs.statSync(walPath);
  const lines = readWAL(walPath);
  return {
    exists: true,
    lineCount: lines.length,
    byteLength: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

module.exports = {
  createInjectableClock,
  createTmpDir,
  synthesizeChain,
  writeWAL,
  appendWAL,
  readWAL,
  walSnapshot,
  canonicalJsonSerialize,
};
