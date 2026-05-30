// packages/kernel/enforcement/k10-escape-hatch.js
//
// K10 — operator escape hatches + F10 combined-bypass detection (v3.0-alpha, PR 2).
//
// v6 spec anchors:
//   §6.1.1 K10 — "LOOM_DISABLE_WORKTREE escape hatch (operator-set env var)".
//   A7 "Override: LOOM_ALLOW_OUT_OF_SCOPE_WRITES=1 audit-logged escape hatch".
//   F10 (eli-H1, CWE-284) — combining LOOM_DISABLE_WORKTREE=1 +
//     LOOM_ALLOW_OUT_OF_SCOPE_WRITES=1 is an EFFECTIVE kernel bypass (worktree
//     isolation off AND out-of-scope writes permitted). Detect + audit-log the
//     combined bypass at spawn-init; LOOM_CI_DENY_COMBINED_BYPASS=1 denies it
//     in CI (the CI smoke job sets the deny var).
//
// v3.0-alpha threat model = local-trust (single user). The escape hatches are
// operator conveniences, not adversary-facing controls. The COMBINED bypass is
// the one case worth flagging loudly (HIGH severity) because it disables both
// halves of Pillar 1's filesystem-delta-as-truth guarantee at once.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

/** Truthy env semantics: '1' | 'true' | 'yes' (case-insensitive). */
function isTruthyEnv(v) {
  return v === '1' || v === 'true' || v === 'yes' || v === 'TRUE' || v === 'YES';
}

/**
 * Pure decision over the escape-hatch env vars. No I/O.
 *
 * @param {Object} [env=process.env]
 * @returns {{
 *   worktreeDisabled: boolean,
 *   outOfScopeAllowed: boolean,
 *   denyCombinedInCi: boolean,
 *   combinedBypass: boolean,
 *   action: 'allow'|'allow-with-audit'|'deny',
 *   severity: 'CRITICAL'|'HIGH'|'MEDIUM'|null
 * }}
 */
function evaluateEscapeHatches(env) {
  const e = env || process.env;
  const worktreeDisabled = isTruthyEnv(e.LOOM_DISABLE_WORKTREE);
  const outOfScopeAllowed = isTruthyEnv(e.LOOM_ALLOW_OUT_OF_SCOPE_WRITES);
  const denyCombinedInCi = isTruthyEnv(e.LOOM_CI_DENY_COMBINED_BYPASS);
  const combinedBypass = worktreeDisabled && outOfScopeAllowed; // F10 / CWE-284

  let action;
  let severity;
  if (combinedBypass && denyCombinedInCi) {
    action = 'deny';
    severity = 'CRITICAL';
  } else if (combinedBypass) {
    action = 'allow-with-audit';
    severity = 'HIGH';
  } else if (worktreeDisabled || outOfScopeAllowed) {
    action = 'allow-with-audit';
    severity = 'MEDIUM';
  } else {
    action = 'allow';
    severity = null;
  }

  return {
    worktreeDisabled,
    outOfScopeAllowed,
    denyCombinedInCi,
    combinedBypass,
    action,
    severity,
  };
}

function auditLogPath() {
  return path.join(os.homedir(), '.claude', 'checkpoints', 'k10-escape-hatch-log.jsonl');
}

/**
 * Emit a Class-4 audit record for a non-trivial escape-hatch decision.
 * No-op when action === 'allow' (nothing to record). Fail-soft per ADR-0001.
 *
 * F23 discipline: the log path is injectable by FUNCTION ARGUMENT (opts.logPath),
 * never an env var — so tests redirect the audit without env mutation.
 *
 * @param {ReturnType<typeof evaluateEscapeHatches>} decision
 * @param {Object} [opts]
 * @param {string} [opts.logPath]
 * @param {Object} [opts.extra] extra fields to merge into the record
 * @returns {boolean} true if a record was written
 */
function emitEscapeHatchAudit(decision, opts) {
  if (!decision || decision.action === 'allow') return false;
  const logPath = (opts && opts.logPath) || auditLogPath();
  try {
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      class: 4,
      kind: 'k10-escape-hatch',
      action: decision.action,
      severity: decision.severity,
      worktree_disabled: decision.worktreeDisabled,
      out_of_scope_allowed: decision.outOfScopeAllowed,
      combined_bypass: decision.combinedBypass,
      ...(opts && opts.extra ? opts.extra : {}),
    });
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, entry + '\n');
    return true;
  } catch {
    return false; // audit-log failure is non-blocking (ADR-0001).
  }
}

module.exports = {
  isTruthyEnv,
  evaluateEscapeHatches,
  emitEscapeHatchAudit,
  _auditLogPath: auditLogPath,
};
