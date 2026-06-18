#!/usr/bin/env node

// @loom-layer: lab
//
// 3.1-W3a -- the C2 read-side persona-key normalizer (fork 1). Two shapes for the same
// persona exist end-to-end: the BARE agentType `node-backend` (the Agent-tool selector,
// the Rule-4 producer convention, what persona-selection reasons about) and the NUMBERED
// roster form `13-node-backend` (the identity registry's canonical key). A slice over a
// persona's experience would return a DISJOINT subgraph unless BOTH collapse to ONE key.
//
// THE CANONICAL DIRECTION (architect VERIFY, fork 1): bare-`agentType`-canonical. We strip
// a leading `^\d+-` numbered prefix, then VALIDATE the bare result against the known-bare
// persona set. An unknown / unvalidatable / non-string input -> null. NEVER a silent
// wrong-key, NEVER a guess (the laundering lever the hacker lens probes: a crafted string
// must not fold two identities into one slice).
//
// K12 (the code-reviewer F1 fold): NO import from packages/runtime (DEFAULT_ROSTERS is
// module-private there anyway, and lab->runtime is a sideways coupling) and NO
// packages/kernel/hooks. The known-bare set is derived K12-safely by globbing the
// agents/*.md SOURCE basenames -- the SAME source arm-compose reads. PURE + deterministic
// (a single readdirSync of agents/, memoized).

'use strict';

const fs = require('fs');
const path = require('path');

// The repo's agents/ dir holds one <persona>.md per bare agentType. Resolved relative to
// this module (packages/lab/persona-experiment/ -> repo root -> agents/). No runtime import.
const AGENTS_DIR = path.join(__dirname, '..', '..', '..', 'agents');

// A leading numbered prefix only: `13-`, `999-`. An interior digit run (e.g. `node-13-x`)
// is NOT a prefix and is left intact (so it fails validation, never laundering into a key).
const NUMBERED_PREFIX = /^\d+-/;

// The bare-agentType shape: lowercase, dash-joined, no separators that would survive a
// path or namespace boundary. Mirrors the roster token shape (recall-graph ROSTER_TOKEN).
// Caps a bare key at 41 chars (1 + {0,40}); widen the bound if a longer persona name is ever
// introduced (a 42+-char name currently resolves to null). EXPORTED so the sibling arm-compose
// file-I/O seam validates with the SAME rule -- one source of truth (code-reviewer DRY fold).
const BARE_SHAPE = /^[a-z][a-z0-9-]{0,40}$/;

let _cachedDefault = null;

// Glob agents/*.md -> the set of bare basenames. The underlying name list is memoized (the
// dir is stable per process). A read failure yields an EMPTY set (fail-closed: everything
// resolves to null, never a silent accept-all). Returns a FRESH defensive-copy Set each call
// so a caller that mutates the result can NEVER poison the shared cache for other callers --
// the prior code returned the shared instance and falsely commented it "frozen" (a Set is not
// frozen by Object.freeze anyway), so a .add('evil-persona') laundered a wrong-key through
// every caller in-process, defeating the "never a silent wrong-key" invariant (code-reviewer fold).
function defaultKnownPersonas() {
  if (!_cachedDefault) {
    let names = [];
    try {
      names = fs.readdirSync(AGENTS_DIR)
        .filter((n) => n.endsWith('.md'))
        .map((n) => n.slice(0, -'.md'.length));
    } catch { names = []; }
    _cachedDefault = new Set(names);
  }
  return new Set(_cachedDefault); // defensive copy: a caller cannot mutate the shared cache
}

// Coerce the caller's knownPersonas option to a validated Set of well-shaped bare tokens.
// An array or Set is accepted; anything else -> the default glob. A non-string or
// mis-shaped member is dropped (never a silent wrong-key vector).
function toKnownSet(knownPersonas) {
  if (knownPersonas == null) return defaultKnownPersonas();
  const iterable = Array.isArray(knownPersonas) || knownPersonas instanceof Set ? knownPersonas : null;
  if (!iterable) return defaultKnownPersonas();
  const set = new Set();
  for (const p of iterable) {
    if (typeof p === 'string' && BARE_SHAPE.test(p)) set.add(p);
  }
  return set;
}

/**
 * Canonicalize a raw persona reference to the bare agentType key, or null.
 *
 * @param {*} raw - `node-backend` | `13-node-backend` | (anything else -> null)
 * @param {{knownPersonas?: string[]|Set<string>}} [opts] - the validation set
 *        (defaults to the agents/*.md basenames).
 * @returns {string|null} the canonical bare key, or null if unknown / unvalidatable /
 *          non-string. NEVER a guess.
 */
function canonicalPersonaKey(raw, opts = {}) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // strip a single leading numbered prefix (bare form is unchanged by this).
  const bare = trimmed.replace(NUMBERED_PREFIX, '');
  if (bare.length === 0) return null;          // e.g. "13-" -> "" -> reject
  if (!BARE_SHAPE.test(bare)) return null;     // a separator/uppercase/oversize -> reject
  const known = toKnownSet(opts.knownPersonas);
  return known.has(bare) ? bare : null;        // validate against the known-bare set
}

module.exports = { canonicalPersonaKey, defaultKnownPersonas, AGENTS_DIR, BARE_SHAPE };
