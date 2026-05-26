// packages/kernel/_lib/synthid.js
//
// HETS-SynthId — content-addressed agent identifier (v2.8.0 — Shape A only).
//
// FORMAT
//   <persona>.<name>[~<contentHash>][/r:<runId>[:d<depth>][:p=<parentName>#<parentHash4>]]
//
//   Bare-name fallback: `04-architect.mira` is a valid SynthId (the suffix
//   is optional). All existing CLIs continue to accept the bare label;
//   only emitters add the suffix. This is the load-bearing backwards-compat
//   invariant per the architect's v2.8.0 design.
//
//   contentHash = first 4 bytes of sha256, hex-encoded (8 chars; ~4B-space).
//   Same family as the kb:-resolver short-hash. Birthday-bound at ~65K
//   identities; HETS population is tens. Rotate to 12 hex chars if
//   collisions ever surface (same escalation path as kb:-resolver).
//
// LINEAGE encoding ships in v2.8.1; this module's `formatSynthId` and
// `parseSynthId` already accept lineage args for forward compatibility.
//
// CONTENT-HASH INPUTS (precise — anchors `kb:architecture/crosscut/idempotency`):
//   - persona_contract: full JSON of packages/runtime/contracts/<persona>.contract.json
//     with the `skill_status` field DELIBERATELY STRIPPED (it churns during
//     bootstrap and would invalidate hashes for cosmetic reasons)
//   - skills_required: sorted list (order-independent per CH12)
//   - skills_recommended: sorted list
//   - kb_scope_default: sorted list
//   - agent_md_hash: sha256-hex of agents/<persona>.md content if present;
//     null otherwise
//   - plugin_version: MAJOR.MINOR only (PATCH excluded — cosmetic ships
//     shouldn't churn hashes; per CH7+CH8+CH9)
//
// DELIBERATELY OUT:
//   - skill_status (bootstrap churn)
//   - per-spawn flags (--task, --require-forged)
//   - the identity's own verdict history (would create circular dependency:
//     every recorded verdict bumps the hash and invalidates prior records)
//   - registry roster ordering
//   - plugin PATCH version
//
// DESIGN ANCHORS (per architect Phase 2):
//   - kb:architecture/crosscut/single-responsibility — this helper owns ONE
//     concern: hash composition + parse. Mirrors _lib/atomic-write.js +
//     _lib/lock.js shape.
//   - kb:architecture/crosscut/information-hiding — callers treat SynthId
//     as an opaque string + a parser; they never assemble the hash
//     themselves. The fields composing the hash are an internal contract.
//   - kb:architecture/crosscut/idempotency — same persona + same name +
//     same contract + same machine → same SynthId, every time. Content-
//     addressed by construction.
//   - kb:architecture/crosscut/deep-modules — SynthId is a small interface
//     (1 string) over a large body of meaning (full persona spec).

'use strict';

const crypto = require('crypto');

/**
 * Recursively sort object keys for canonical JSON serialization.
 * Arrays preserve their order (semantic-bearing); only object keys are
 * sorted. Primitives pass through unchanged.
 *
 * @param {*} value
 * @returns {*}
 */
function _canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(_canonicalize);
  const sortedKeys = Object.keys(value).sort();
  const result = {};
  for (const k of sortedKeys) {
    result[k] = _canonicalize(value[k]);
  }
  return result;
}

/**
 * Serialize an object via canonical JSON (sorted keys, no whitespace,
 * deterministic). Equivalent inputs → byte-identical output.
 *
 * @param {*} value
 * @returns {string}
 */
function _canonicalJson(value) {
  return JSON.stringify(_canonicalize(value));
}

/**
 * Compute sha256-hex of a string.
 *
 * @param {string} s
 * @returns {string} 64-char hex digest
 */
function _sha256hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * Deep-clone a contract object with hash-irrelevant fields stripped from
 * the `skills` sub-object:
 *   - `skill_status`: churns during bootstrap; would invalidate hashes
 *     for cosmetic reasons (per CH6).
 *   - `required` / `recommended` arrays: already represented separately
 *     as top-level SORTED canonical lists. Embedding the raw (potentially
 *     unsorted) lists here too would make the hash sensitive to source-
 *     ordering, violating CH12 (sort-order invariance).
 *
 * The remaining persona_contract content (role, functional, antiPattern,
 * budget, kb_scope, fallbackAcceptable, etc.) all contributes to the hash.
 *
 * @param {object} contract
 * @returns {object}
 */
function _stripSkillStatus(contract) {
  if (!contract || typeof contract !== 'object') return contract;
  const clone = JSON.parse(JSON.stringify(contract));
  if (clone.skills && typeof clone.skills === 'object') {
    delete clone.skills.skill_status;
    delete clone.skills.required;
    delete clone.skills.recommended;
  }
  return clone;
}

/**
 * Compute the 8-hex content hash for a HETS identity.
 *
 * @param {object} args
 * @param {string} args.persona - persona ID (e.g., "04-architect")
 * @param {object} args.contract - parsed persona contract JSON
 * @param {string} [args.agentMd] - content of agents/<persona>.md (optional)
 * @param {string} args.pluginVersion - semver string like "2.8.0"
 * @returns {string} 8 lowercase hex characters
 */
function computeContentHash({ persona, contract, agentMd, pluginVersion }) {
  if (!persona || !contract || !pluginVersion) {
    throw new Error('computeContentHash requires persona + contract + pluginVersion');
  }

  // Extract MAJOR.MINOR from semver (patch deliberately excluded).
  const versionParts = String(pluginVersion).split('.');
  const majorMinor = `${versionParts[0] || '0'}.${versionParts[1] || '0'}`;

  // Build the canonical input object. Keys are alphabetical via
  // _canonicalize during serialization; we structure them clearly here.
  const canonicalInput = {
    agent_md_hash: agentMd ? _sha256hex(agentMd) : null,
    kb_scope_default: [...((contract.kb_scope && contract.kb_scope.default) || [])].sort(),
    persona_contract: _stripSkillStatus(contract),
    plugin_version: majorMinor,
    skills_recommended: [...((contract.skills && contract.skills.recommended) || [])].sort(),
    skills_required: [...((contract.skills && contract.skills.required) || [])].sort(),
  };

  const json = _canonicalJson(canonicalInput);
  const fullHash = _sha256hex(json);
  return fullHash.slice(0, 8);
}

/**
 * Format a SynthId string from its component parts.
 *
 * @param {object} args
 * @param {string} args.persona
 * @param {string} args.name
 * @param {string} [args.contentHash] - 8 hex chars; omitted produces bare name
 * @param {object} [args.lineage]
 * @param {string} args.lineage.runId
 * @param {number} [args.lineage.depth=0] - if > 0, encoded as `:d<n>`
 * @param {string} [args.lineage.parent]
 * @param {string} [args.lineage.parentHash] - 4 hex chars
 * @returns {string}
 */
function formatSynthId({ persona, name, contentHash, lineage } = {}) {
  if (!persona || !name) {
    throw new Error('formatSynthId requires persona + name');
  }
  let id = `${persona}.${name}`;
  if (contentHash) id += `~${contentHash}`;
  if (lineage && lineage.runId) {
    id += `/r:${lineage.runId}`;
    if (lineage.depth && lineage.depth > 0) id += `:d${lineage.depth}`;
    if (lineage.parent && lineage.parentHash) {
      id += `:p=${lineage.parent}#${lineage.parentHash}`;
    }
  }
  return id;
}

// Parser regex per architect design. Personas may contain hyphens
// (`02-confused-user`); names are anchored after the last `.` before
// any `~` or `/`. Hash is 8 lowercase hex; lineage suffix is optional.
const PARSE_RE = /^(?<persona>[^.~/]+(?:-[^.~/]+)*)\.(?<name>[^~/]+)(?:~(?<contentHash>[0-9a-f]{8}))?(?:\/r:(?<runId>[A-Za-z0-9]+)(?::d(?<depth>\d+))?(?::p=(?<parent>[^#]+)#(?<parentHash>[0-9a-f]+))?)?$/;

/**
 * Parse a SynthId string into its component parts.
 *
 * @param {string} synthId
 * @returns {{ persona: string, name: string, contentHash: string|null, lineage: object|null } | null}
 */
function parseSynthId(synthId) {
  if (typeof synthId !== 'string' || synthId.length === 0) return null;
  const m = PARSE_RE.exec(synthId);
  if (!m || !m.groups) return null;
  const { persona, name, contentHash, runId, depth, parent, parentHash } = m.groups;

  let lineage = null;
  if (runId) {
    lineage = {
      runId,
      depth: depth ? parseInt(depth, 10) : 0,
      parent: parent || null,
      parentHash: parentHash || null,
    };
  }

  return {
    persona,
    name,
    contentHash: contentHash || null,
    lineage,
  };
}

/**
 * Validate a SynthId's content-hash suffix against the CURRENT persona
 * contract. Pure function — observability-only contract: callers decide
 * what to do with mismatches (warning record, log, prompt, etc.).
 *
 * v2.8.0.x — wired into contract-verifier.js so per-verdict records
 * surface persona-contract drift since the agent was spawned.
 *
 * Status values:
 *   - 'match'         — suffix === computed hash from current contract
 *   - 'mismatch'      — suffix !== computed hash; .warning string populated
 *   - 'no-suffix'     — bare-label identity (no `~hash` portion); pre-v2.8.0
 *                       record or current-session emitter that didn't add one
 *   - 'no-identity'   — identity arg was null/empty
 *   - 'parse-error'   — identity string failed parseSynthId
 *   - 'no-contract'   — suffix present but contract arg missing (callsite
 *                       didn't supply one — observability-only fallback)
 *   - 'compute-error' — computeContentHash threw (e.g., missing
 *                       pluginVersion); .error string populated
 *
 * @param {object} args
 * @param {string|null} args.identity - SynthId string (bare or suffixed)
 * @param {object|null} args.contract - parsed persona contract JSON
 * @param {string|null} args.pluginVersion - semver string
 * @param {string} [args.agentMd] - content of agents/<persona>.md (optional)
 * @returns {{ status: string, identity?: string, suffix?: string,
 *             expectedHash?: string, warning?: string, error?: string }}
 */
function validateSuffix({ identity, contract, pluginVersion, agentMd } = {}) {
  if (!identity || typeof identity !== 'string' || identity.length === 0) {
    return { status: 'no-identity' };
  }
  const parsed = parseSynthId(identity);
  if (!parsed) {
    return { status: 'parse-error', identity };
  }
  if (!parsed.contentHash) {
    return { status: 'no-suffix', identity };
  }
  if (!contract) {
    return { status: 'no-contract', identity, suffix: parsed.contentHash };
  }
  let expectedHash;
  try {
    expectedHash = computeContentHash({
      persona: parsed.persona,
      contract,
      agentMd,
      pluginVersion,
    });
  } catch (err) {
    return {
      status: 'compute-error',
      identity,
      suffix: parsed.contentHash,
      error: err && err.message ? err.message : String(err),
    };
  }
  if (expectedHash === parsed.contentHash) {
    return { status: 'match', identity, suffix: parsed.contentHash, expectedHash };
  }
  return {
    status: 'mismatch',
    identity,
    suffix: parsed.contentHash,
    expectedHash,
    warning: `SynthId suffix ${parsed.contentHash} does not match current contract hash ${expectedHash} — persona-contract has drifted since the identity was last spawned`,
  };
}

module.exports = {
  computeContentHash,
  formatSynthId,
  parseSynthId,
  validateSuffix,
  // Exported for internal/test reuse only; not part of the stable API.
  _canonicalJson,
  _stripSkillStatus,
};
