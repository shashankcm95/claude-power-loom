'use strict';

// doctor/probes/partition-sentinel.js — v2.9.0 Phase C.1 (FIX-I4)
//
// Checks whether the per-persona agent-patterns partition sentinel is
// present in the library substrate. The partition shifted in v2.1.1
// (Component H FULL) to 16-file per-persona shape; the sentinel marks
// completed migration. Missing sentinel + multi-persona writes = lock
// contention surface (caught by Test 111 in install.sh).
//
// MVP scope: presence-check only. Substantive content validation is
// out of scope (would re-implement library-migrate logic).

const fs = require('fs');
const path = require('path');
const os = require('os');
const libraryPaths = require('../../../../kernel/_lib/library-paths');

function run(_args) {
  if (process.env.AGENT_TEAM_DOCTOR_TEST === '1') {
    return { status: 'pass', details: { mode: 'test-fixture', notes: 'Test-mode synthetic check.' } };
  }
  // Canonical sentinel path: same source registry.js / pattern-recorder.js read
  // (libraryPaths.partitionSentinelPath() = <library-root>/.partition-complete).
  const sentinel = libraryPaths.partitionSentinelPath();
  const consolidated = path.join(os.homedir(), '.claude', 'agent-patterns.json');
  const sentinelExists = fs.existsSync(sentinel);
  const consolidatedExists = fs.existsSync(consolidated);
  if (sentinelExists) {
    return { status: 'pass', details: { sentinel: 'present', sentinel_path: sentinel } };
  }
  if (consolidatedExists) {
    // Library substrate exists but partition migration hasn't completed.
    // WARN, not FAIL — the substrate falls back to consolidated.json safely
    // (Test 113 covers this path).
    return {
      status: 'warn',
      details: {
        sentinel: 'absent',
        consolidated: 'present',
        notes: 'Partition migration not yet run; consolidated.json fallback in effect (Test 113 path). Run library-migrate to enable per-persona bulkhead.',
      },
    };
  }
  return {
    status: 'warn',
    details: { sentinel: 'absent', consolidated: 'absent', notes: 'No agent-patterns substrate detected; first-run is normal.' },
  };
}

module.exports = { name: 'partition-sentinel', run };
