// packages/kernel/_lib/memory-root.js
//
// Memory Root Pointer reader per v6 §5a.9 + Round-3d trust policy.
//
// v6 spec anchors:
//   §5a.9 — Memory Root Pointer Convention (canonical schema + scope precedence)
//   §3 A8 — Memory-as-Content-Addressed-State-Machine (pointer is DISCOVERY-ONLY; not canonical state)
//   §5a.5 — Recovery sweep precondition (pointer must be resolved BEFORE sweep)
//   §5a.8 — Pointer self-migration (Round-3d GP2: regular A9 two-phase, not "exception")
//   §6.13 INV-26-MRAtomicWrite (atomic write pattern)
//   §6.13 INV-27-PersonaIndexCanonicalOnly (canonical-records-only indexing)
//   ADR-0014 (Memory Root Pointer Convention rationale)
//   Round-3d G9 — per-project path discipline (reject `~/.claude/...` paths in per-project pointers)
//   Round-3d GPT-3.D — project pointer trust policy (owner/realpath/allowlist/fail-closed)
//
// This module is the v3.0-alpha "READER STUB" per §6.5 In-Scope. It implements:
//   - Pointer resolution + scope precedence (per-project overrides per-user)
//   - Schema validation + per-project path discipline (Round-3d G9)
//   - Trust policy (Round-3d GPT-3.D) — owner check + realpath CWD invariant + allowlist + fail-closed
//   - Bootstrap on missing/invalid (reconstruct from well-known defaults)
//   - Atomic write (INV-26-MRAtomicWrite) via shared `_lib/atomic-write.js`
//
// v3.0-alpha implementation work that lives ELSEWHERE (NOT this module):
//   - WAL append + recovery sweep (separate modules; this just resolves the WAL path)
//   - Two-phase commit pointer-migration execution (separate module; this just reads + writes)
//   - Causal-graph index population (causal-recall-rfc work)
//
// PR scope: ~130-205 LoC honest per Round-3d C1 K2 reservation envelope.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { writeAtomic } = require('./atomic-write');

const POINTER_SCHEMA_VERSION = 'v6.0';
const POINTER_SCHEMA_COMPAT_FLOOR = 'v5.4';

/**
 * Default per-user pointer path. `~` is expanded eagerly by the reader (never
 * stored as a literal `~` token in the resolved manifests).
 */
function defaultPerUserPath() {
  return path.join(os.homedir(), '.claude', 'loom', 'memory-root.json');
}

/**
 * Default per-project pointer path for a given working directory.
 */
function defaultPerProjectPath(cwd) {
  return path.join(cwd, '.claude', 'loom', 'memory-root.json');
}

/**
 * Default per-user manifest defaults (used by bootstrap reconstruction).
 */
function defaultPerUserManifests() {
  const home = os.homedir();
  return {
    causal_recall: path.join(home, '.claude', 'library', '_meta', 'causal-graph-per-user.json'),
    attestation_wal: path.join(home, '.claude', 'checkpoints', 'attestation-log.jsonl'),
    persona_memory_index: path.join(home, '.claude', 'library', '_meta', 'persona-blocks-index.json'),
    derived_views_cache: path.join(home, '.claude', 'library', '_meta', 'derived-views'),
  };
}

/**
 * Default per-project manifest defaults (Round-3d G9 path discipline: all paths
 * MUST resolve under project_context, NOT under ~/.claude/).
 */
function defaultPerProjectManifests(projectContext) {
  return {
    causal_recall: path.join(projectContext, '.loom', 'causal-graph-per-project.json'),
    attestation_wal: path.join(projectContext, '.loom', 'attestation-log.jsonl'),
    persona_memory_index: path.join(projectContext, '.loom', 'persona-blocks-index.json'),
    derived_views_cache: path.join(projectContext, '.loom', 'derived-views'),
  };
}

/**
 * Schema-validate a pointer (structural correctness only — fields exist with
 * right shape; trust policy + path-discipline are separate checks).
 *
 * @returns {{ valid: boolean, errors?: string[] }}
 */
function validatePointer(pointer) {
  const errors = [];
  if (!pointer || typeof pointer !== 'object') {
    return { valid: false, errors: ['pointer must be a non-null object'] };
  }
  if (typeof pointer.schema_version !== 'string') errors.push('missing schema_version');
  if (pointer.scope !== 'per-user' && pointer.scope !== 'per-project') {
    errors.push("scope must be 'per-user' or 'per-project'");
  }
  if (pointer.scope === 'per-project' && typeof pointer.project_context !== 'string') {
    errors.push('per-project pointer requires project_context (absolute path string)');
  }
  if (!pointer.manifests || typeof pointer.manifests !== 'object') {
    errors.push('missing manifests block');
  } else {
    const required = ['causal_recall', 'attestation_wal', 'persona_memory_index', 'derived_views_cache'];
    for (const key of required) {
      if (typeof pointer.manifests[key] !== 'string') {
        errors.push('manifests.' + key + ' must be a string');
      }
    }
  }
  if (typeof pointer.schema_compat_floor !== 'string') {
    errors.push('missing schema_compat_floor');
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/**
 * Round-3d G9 — per-project path discipline.
 *
 * When scope is per-project, all `manifests.*` paths MUST resolve under
 * `project_context`. Paths starting with `~/.claude/...` (which resolve to the
 * user-global database) defeat the sandboxing purpose of per-project scope and
 * are rejected as a CONFIGURATION ERROR.
 *
 * @returns {{ valid: boolean, errors?: string[] }}
 */
function checkPerProjectPathDiscipline(pointer) {
  if (pointer.scope !== 'per-project') return { valid: true };
  const errors = [];
  const projectContext = pointer.project_context;
  const homeDir = os.homedir();

  for (const [key, raw] of Object.entries(pointer.manifests || {})) {
    if (typeof raw !== 'string') continue;
    const expanded = raw.startsWith('~') ? path.join(homeDir, raw.slice(1)) : raw;
    if (expanded.startsWith(homeDir + path.sep) && !expanded.startsWith(projectContext + path.sep)) {
      errors.push(
        'per-project path discipline (Round-3d G9): manifests.' + key +
          ' resolves under home directory (' + expanded + ') but per-project pointers MUST resolve under project_context (' + projectContext + ')'
      );
    }
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/**
 * Round-3d GPT-3.D — project pointer trust policy.
 *
 * A per-project `memory-root.json` shipped inside a project repository is
 * UNTRUSTED INPUT until validated. Trust checks (fail-closed default):
 *   (a) Owner check — file MUST be owned by the user running the substrate
 *   (b) Project-context CWD invariant — project_context MUST equal realpath(cwd)
 *   (c) Optional allowlist — `~/.claude/loom/trusted-projects.json` (when present,
 *       enumerates approved project_context paths; missing-from-list = rejected)
 *
 * @param {string} pointerPath Absolute path to the per-project pointer file
 * @param {Object} pointer Parsed pointer content
 * @param {string} cwd Resolved working directory
 * @returns {{ trusted: boolean, reason?: string }}
 */
function applyTrustPolicy(pointerPath, pointer, cwd) {
  // (a) Owner check
  try {
    const stat = fs.statSync(pointerPath);
    const myUid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (myUid !== null && stat.uid !== myUid) {
      return {
        trusted: false,
        reason: 'owner-check-failed (pointer owned by uid ' + stat.uid + '; substrate runs as uid ' + myUid + ')',
      };
    }
  } catch (err) {
    return { trusted: false, reason: 'owner-check-failed (' + err.message + ')' };
  }

  // (b) Project-context CWD invariant
  let realCwd;
  try {
    realCwd = fs.realpathSync(cwd);
  } catch (err) {
    return { trusted: false, reason: 'realpath-cwd-failed (' + err.message + ')' };
  }
  let realProjectContext;
  try {
    realProjectContext = fs.realpathSync(pointer.project_context);
  } catch (err) {
    return {
      trusted: false,
      reason: 'realpath-project_context-failed (' + err.message + ')',
    };
  }
  if (realProjectContext !== realCwd) {
    return {
      trusted: false,
      reason: 'project_context mismatch (resolved: ' + realProjectContext + ' vs cwd: ' + realCwd + ')',
    };
  }

  // (c) Optional allowlist
  const allowlistPath = path.join(os.homedir(), '.claude', 'loom', 'trusted-projects.json');
  if (fs.existsSync(allowlistPath)) {
    try {
      const allowlist = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
      const trusted = Array.isArray(allowlist.trusted_project_contexts)
        ? allowlist.trusted_project_contexts
        : [];
      if (!trusted.includes(realProjectContext)) {
        return {
          trusted: false,
          reason: 'project not in ~/.claude/loom/trusted-projects.json allowlist',
        };
      }
    } catch (err) {
      return { trusted: false, reason: 'allowlist-parse-failed (' + err.message + ')' };
    }
  }

  return { trusted: true };
}

/**
 * Read a pointer file from disk. Returns null on any I/O or parse error
 * (caller decides whether to bootstrap or fail-closed).
 */
function readPointerFile(pointerPath) {
  try {
    const raw = fs.readFileSync(pointerPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Resolve the canonical pointer for a given working directory.
 *
 * Algorithm:
 *   1. If per-project pointer exists AND validates AND passes path-discipline AND passes trust-policy:
 *      → use per-project (overrides per-user)
 *   2. Else: use per-user pointer (read or bootstrap)
 *   3. If per-user is missing OR invalid: bootstrap from defaults + write atomically
 *
 * Returns: { pointer, source, advisories[] }
 *   - pointer: the resolved pointer object
 *   - source: 'per-project' | 'per-user' | 'bootstrap-per-user'
 *   - advisories: array of `per-project-pointer-rejected` reasons (informational)
 *
 * @param {{ cwd?: string, perUserPath?: string, perProjectPath?: string }} [opts]
 */
function resolvePointer(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const perUserPath = opts.perUserPath || defaultPerUserPath();
  const perProjectPath = opts.perProjectPath || defaultPerProjectPath(cwd);
  const advisories = [];

  // Try per-project first.
  if (fs.existsSync(perProjectPath)) {
    const candidate = readPointerFile(perProjectPath);
    if (candidate) {
      const v = validatePointer(candidate);
      if (!v.valid) {
        advisories.push({ kind: 'per-project-pointer-rejected', reason: 'schema-invalid', errors: v.errors });
      } else {
        const disc = checkPerProjectPathDiscipline(candidate);
        if (!disc.valid) {
          advisories.push({ kind: 'per-project-pointer-rejected', reason: 'path-discipline', errors: disc.errors });
        } else {
          const trust = applyTrustPolicy(perProjectPath, candidate, cwd);
          if (!trust.trusted) {
            advisories.push({ kind: 'per-project-pointer-rejected', reason: 'trust-policy', detail: trust.reason });
          } else {
            return { pointer: candidate, source: 'per-project', advisories, pointerPath: perProjectPath };
          }
        }
      }
    } else {
      advisories.push({ kind: 'per-project-pointer-rejected', reason: 'parse-error' });
    }
  }

  // Fall through to per-user.
  if (fs.existsSync(perUserPath)) {
    const candidate = readPointerFile(perUserPath);
    if (candidate) {
      const v = validatePointer(candidate);
      if (v.valid) {
        return { pointer: candidate, source: 'per-user', advisories, pointerPath: perUserPath };
      }
      advisories.push({ kind: 'per-user-pointer-invalid', errors: v.errors, willBootstrap: true });
    }
  }

  // Bootstrap.
  const bootstrap = {
    schema_version: POINTER_SCHEMA_VERSION,
    scope: 'per-user',
    project_context: null,
    manifests: defaultPerUserManifests(),
    schema_compat_floor: POINTER_SCHEMA_COMPAT_FLOOR,
  };
  writePointerAtomic(perUserPath, bootstrap);
  return { pointer: bootstrap, source: 'bootstrap-per-user', advisories, pointerPath: perUserPath };
}

/**
 * Write a pointer file atomically (INV-26-MRAtomicWrite).
 *
 * Reuses the shared `_lib/atomic-write.js` primitive — same tmp + fsync +
 * rename pattern used by K1/K9 + spawn-record. Per §5a.2 atomic-write
 * discipline; per §5a.9 Memory Root Pointer atomicity.
 */
function writePointerAtomic(pointerPath, pointer) {
  const v = validatePointer(pointer);
  if (!v.valid) {
    throw new Error('writePointerAtomic: invalid pointer (' + v.errors.join('; ') + ')');
  }
  // Ensure parent directory exists.
  fs.mkdirSync(path.dirname(pointerPath), { recursive: true });
  writeAtomic(pointerPath, pointer);
}

module.exports = {
  resolvePointer,
  validatePointer,
  checkPerProjectPathDiscipline,
  applyTrustPolicy,
  writePointerAtomic,
  defaultPerUserPath,
  defaultPerProjectPath,
  defaultPerUserManifests,
  defaultPerProjectManifests,
  POINTER_SCHEMA_VERSION,
  POINTER_SCHEMA_COMPAT_FLOOR,
};
