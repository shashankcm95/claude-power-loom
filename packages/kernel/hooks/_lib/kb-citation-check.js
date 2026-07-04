'use strict';

// Shared KB-citation compliance SEMANTIC — the single source of truth for
// "what is a compliant KB citation", imported by BOTH enforcers:
//   - kb-citation-gate.js          (PostToolUse:Agent|Task — sync responses)
//   - kb-citation-subagent-stop.js (SubagentStop — sync + async, self-correcting)
//
// SRP (kb:architecture/crosscut/single-responsibility): the compliance RULE has
// exactly one reason to change, so it lives in exactly one place. If the two
// gates carried their own copies of the regex, they could silently diverge on
// what "compliant" means — the exact failure the DRY case exists to prevent.
//
// Scope is deliberately TIGHT (architect VERIFY F3): only the semantic that MUST
// NOT diverge is shared. Each hook keeps its own I/O — stdin read, emit
// convention (PostToolUse `{decision:'approve'}` vs Stop-class `{}`), log path,
// and PERSONA-FIELD extraction (PostToolUse `tool_input.subagent_type` vs
// SubagentStop top-level `agent_type`). Format-shape helpers like
// `extractResultText` stay duplicated per the spawn-record.js precedent — they
// are format utilities each hook may evolve independently, not the shared rule.

// Subagents whose output contract REQUIRES a trailing `## KB Sources Consulted`
// section (agents/<name>.md Output Contract, H.9.20.0). Currently just the
// architect (the only persona with the trailing-section contract; code-reviewer /
// security-auditor use per-finding inline citations, a different pattern).
const KB_REQUIRED_SUBAGENTS = new Set(['architect']);

/**
 * Normalize a raw subagent/agent type to its base name: lowercased, trimmed,
 * with any plugin prefix stripped ("power-loom:architect" or "plugin:architect"
 * → "architect"). Pure; tolerates any input (non-strings → ''). The `.trim()`
 * (both ends + the split segment) is defensive: a whitespace-padded value like
 * " architect" / "architect\n" must still resolve, not silently skip
 * enforcement (hacker VALIDATE LOW — the harness delivers clean tokens, so this
 * is belt-and-suspenders for an unobserved shape).
 * @param {*} raw
 * @returns {string}
 */
function normalizeSubagentType(raw) {
  const lower = String(raw == null ? '' : raw).toLowerCase().trim();
  const base = lower.includes(':') ? lower.split(':').pop() : lower;
  return base.trim();
}

/**
 * The compliance semantic. A response is KB-compliant iff it carries a
 * `## KB Sources Consulted` h2 heading (optionally numbered, e.g.
 * `## 7. KB Sources Consulted`) AND at least one canonical `kb:` reference.
 *
 * The `^##\s+` anchor rejects h3 (`### KB Sources Consulted`) and h1; the
 * optional `(?:\d+\.\s*)?` tolerates a numbered structural prefix (observed in
 * real architect dispatches). Returns the decomposition so callers can log
 * has_kb_section / kb_refs_count honestly.
 *
 * PRESENCE-ONLY — a best-effort NUDGE, NOT a security boundary (hacker VALIDATE).
 * It checks that a heading + a `kb:`-shaped token are PRESENT; it does NOT: strip
 * code fences (a fenced/illustrative `## KB Sources Consulted` example counts),
 * left-anchor the `kb:` token (`mykb:foo` matches), or verify the id resolves
 * against the kb catalog. This is intentional: the consumer is a cooperating
 * architect self-citing its own KB consultation, not an adversary — the gate
 * raises the floor on honest citation, it cannot defeat a determined dodge. A
 * real-grounding check (resolve each id against kb-resolver, fence-strip,
 * `\bkb:` boundary) is a tracked hardening follow-up, deliberately NOT done here
 * (it would change the shared semantic + #508's merged gate; these weaknesses are
 * inherited byte-for-byte from #508, not introduced by this change).
 *
 * @param {string} text  the response text (callers extract this per their event)
 * @returns {{hasKbSection: boolean, kbRefsCount: number, compliant: boolean}}
 */
function isKbCompliant(text) {
  const s = typeof text === 'string' ? text : '';
  const hasKbSection = /^##\s+(?:\d+\.\s*)?KB Sources Consulted/im.test(s);
  const kbRefs = s.match(/kb:[a-z][a-z0-9\-/]+/gi) || [];
  return {
    hasKbSection,
    kbRefsCount: kbRefs.length,
    compliant: hasKbSection && kbRefs.length >= 1,
  };
}

module.exports = { KB_REQUIRED_SUBAGENTS, normalizeSubagentType, isKbCompliant };
