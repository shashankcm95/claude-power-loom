#!/usr/bin/env node

// @loom-layer: lab
//
// item 4 (D3) - the SINGLE SOURCE OF TRUTH that pairs a BARE agentType (the Agent-tool
// selector - what persona-selection reasons about, e.g. `node-backend`, `security-auditor`)
// with its NUMBERED brief basename (the persona slot, e.g. `13-node-backend`,
// `12-security-engineer`). Both the classifier's legal emit set AND the materializer's known
// set derive from here, so they can never drift out of sync.
//
// DERIVATION (memoized, derived ONCE per process):
//   - The AUTHORITATIVE agentType is the agents/*.md SOURCE basename (the SAME source
//     canonical-persona-key + arm-compose glob - one source of truth, K12-safe).
//   - The NUMBERED brief basename is the runtime contract's `persona` field (read as DATA,
//     never `require`d from packages/runtime - the lab->runtime IMPORT ban; reading a runtime
//     file as data is fine). e.g. `packages/runtime/contracts/12-security-engineer.contract.json`
//     has `"persona": "12-security-engineer"`.
//   - PAIRING: for each contract, strip the numbered prefix from `persona` to get the
//     contract's bare name (`security-engineer`); the agentType is that bare name UNLESS an
//     alias diverges it. The ONLY divergence is `security-engineer` -> `security-auditor` (the
//     contract's persona-slot name has no `agents/security-engineer.md`; the floor lives in
//     `agents/security-auditor.md`). This mirrors AGENT_NAME_ALIASES in
//     packages/runtime/orchestration/contracts-validate.js - defined LOCALLY here (no runtime
//     import). Add an entry for any future contract whose persona-slot name diverges from its
//     agents/<name>.md basename.
//
// K12: NO import from packages/runtime / packages/kernel/hooks. We READ runtime contract JSON
// as DATA (fs.readFileSync) and glob agents/*.md - the same K12-safe pattern as the siblings.
// A read failure on any single source is fail-CLOSED-soft: that pairing is simply absent (the
// agentType resolves to null), NEVER a silent wrong-key.

'use strict';

const fs = require('fs');
const path = require('path');

const { AGENTS_DIR, BARE_SHAPE } = require('./canonical-persona-key');

// Resolved relative to this module (packages/lab/persona-experiment/ -> repo root -> ...).
const CONTRACTS_DIR = path.join(__dirname, '..', '..', 'runtime', 'contracts');

// A leading numbered prefix only: `13-`, `09-`. Mirrors canonical-persona-key's NUMBERED_PREFIX.
const NUMBERED_PREFIX = /^\d+-/;
// A well-formed numbered brief basename: `NN-name`, lowercased name body (the persona slot shape).
const NUMBERED_BRIEF_SHAPE = /^\d+-[a-z][a-z0-9-]{0,40}$/;

// The contract persona-slot name -> agents/<name>.md basename alias, for the (rare) case where
// the bare-stripped persona slot diverges from the agentType. LOCAL copy of the runtime
// validator's AGENT_NAME_ALIASES (no cross-layer import). Frozen: never mutated at runtime.
const AGENT_NAME_ALIASES = Object.freeze({ 'security-engineer': 'security-auditor' });

// D2 - the exact-set BUILDER allowlist. Only these personas are legal classifier targets and
// legal materialize subjects; a reviewer/analyzer persona (architect, code-reviewer, hacker,
// honesty-auditor, optimizer, planner, confused-user, codebase-*) is NEVER materialized.
// Frozen exact-set (security.md exact-set discipline): the allowlist cannot be widened at runtime.
const BUILDER_PERSONAS = Object.freeze([
  'node-backend',
  'python-backend',
  'java-backend',
  'react-frontend',
  'ios-developer',
  'ml-engineer',
  'data-engineer',
  'devops-sre',
  'security-auditor',
]);

let _cachedMap = null;

// Glob agents/*.md -> the authoritative bare agentType set. A read failure -> EMPTY set
// (fail-closed: every agentType resolves to null, never an accept-all). Not memoized here on
// its own - it feeds buildAliasMap which IS memoized.
function agentTypeSet() {
  let names = [];
  try {
    names = fs.readdirSync(AGENTS_DIR)
      .filter((n) => n.endsWith('.md'))
      .map((n) => n.slice(0, -'.md'.length))
      .filter((n) => BARE_SHAPE.test(n));
  } catch { names = []; }
  return new Set(names);
}

// Read every contract's `persona` (numbered brief basename) as DATA. Returns an array of
// well-formed numbered basenames; a contract whose `persona` is absent / mis-shaped / set at
// spawn (e.g. `<set-at-spawn>`) is skipped (never poisons the map). A dir-read failure -> [].
function numberedBriefBasenames() {
  let files = [];
  try {
    files = fs.readdirSync(CONTRACTS_DIR).filter((n) => n.endsWith('.contract.json'));
  } catch { return []; }
  const out = [];
  for (const f of files) {
    let persona = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(CONTRACTS_DIR, f), 'utf8'));
      persona = parsed && typeof parsed.persona === 'string' ? parsed.persona : null;
    } catch { persona = null; }   // unreadable / malformed contract -> skip this pairing
    if (persona && NUMBERED_BRIEF_SHAPE.test(persona)) out.push(persona);
  }
  return out;
}

// Build (and memoize) the agentType -> numbered-brief-basename alias map. Derived ONCE: pair
// each numbered brief basename with its authoritative agentType (the bare-stripped persona,
// run through AGENT_NAME_ALIASES, then validated to EXIST in agents/*.md). A pairing whose
// agentType is not a real agents/*.md basename is DROPPED (fail-closed: never a wrong-key).
function buildAliasMap() {
  if (_cachedMap) return _cachedMap;
  const agents = agentTypeSet();
  const map = new Map();
  for (const numbered of numberedBriefBasenames()) {
    const bare = numbered.replace(NUMBERED_PREFIX, '');
    if (bare.length === 0) continue;
    const agentType = AGENT_NAME_ALIASES[bare] || bare;
    if (!BARE_SHAPE.test(agentType)) continue;        // mis-shaped -> skip
    if (!agents.has(agentType)) continue;             // no agents/<type>.md -> skip (fail-closed)
    if (!map.has(agentType)) map.set(agentType, numbered); // first wins; stable
  }
  _cachedMap = map;
  return _cachedMap;
}

/**
 * Resolve a bare agentType to its numbered brief basename, or null.
 *
 * @param {*} agentType - `node-backend` | `security-auditor` | (anything else -> null)
 * @returns {string|null} the numbered brief basename (e.g. `13-node-backend`,
 *          `12-security-engineer`), or null if unknown / unresolvable / non-string.
 *          NEVER a guess.
 */
function resolveBriefBasename(agentType) {
  if (typeof agentType !== 'string') return null;
  const key = agentType.trim();
  if (key.length === 0) return null;
  if (!BARE_SHAPE.test(key)) return null;
  const map = buildAliasMap();
  return map.has(key) ? map.get(key) : null;
}

/**
 * The single legal emit/materialize set: the BUILDER allowlist intersected with the personas
 * that actually resolve to a brief. The classifier emits ONLY from this set; the materializer
 * knows ONLY this set. Returns a FRESH array each call (a caller cannot poison the source).
 *
 * @returns {string[]} the bare agentTypes that are both builders AND brief-resolvable.
 */
function materializablePersonas() {
  return BUILDER_PERSONAS.filter((p) => resolveBriefBasename(p) !== null);
}

module.exports = {
  BUILDER_PERSONAS,
  resolveBriefBasename,
  materializablePersonas,
  AGENT_NAME_ALIASES,
};
