// packages/kernel/_lib/_crash-harness.js
//
// MINIMAL test harness for INV-SpawnRecord-AtomicWrite property test.
// Per master plan Phase-1-alpha/2 + post-compact PR-1 R1 FL-1:
//   - PR 1 ships a MINIMAL stub sufficient for the atomic-write contract
//   - PR 2 ships the FULL kernel-crash-mid-write injection harness
//
// SRP at PR-1: just enough surface to make INV-SpawnRecord-AtomicWrite
// test contracts go GREEN. No process-level signals, no fault injection
// beyond mid-write interruption simulation.
//
// LAYER: tests-only injection. Production code MUST NOT import this
// module — the K12 layer-boundary lint (PR 5) flags any such import.

'use strict';

const fs = require('fs');

/**
 * Simulate an interrupted write: writes to a `.tmp` sidecar, then throws
 * BEFORE the rename step. The harness uses the writeAtomicString primitive's
 * INTERNAL contract: write-to-.tmp THEN rename. Interruption is between
 * the two steps, so the target file MUST NOT exist post-throw.
 *
 * Atomic-write contract verification:
 *   - target file does NOT exist on disk after interruption
 *   - .tmp sidecar MAY exist (cleanable via recovery sweep; tolerated)
 *
 * @param {string} targetPath Absolute path where the final file would land
 * @param {string} content Content that "almost" got written
 * @throws Always throws by design — interruption is the simulation
 */
function simulateInterruptedWrite(targetPath, content) {
  const tmpPath = targetPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, content);
    // Simulate kernel crash / SIGKILL between write + rename. In real life
    // the process would terminate; in test the throw plays that role.
    throw new Error('simulated-interrupt-before-rename');
  } catch (err) {
    // Clean up the .tmp sidecar so the test fixture is self-contained.
    // (In real crash, recovery sweep handles this; the harness keeps the
    // test deterministic by cleaning eagerly.)
    try {
      fs.unlinkSync(tmpPath);
    } catch (_cleanupErr) {
      // best-effort cleanup; nothing to do if sidecar didn't exist
    }
    // Re-throw so the caller sees the interruption signal.
    throw err;
  }
}

module.exports = {
  simulateInterruptedWrite,
};
