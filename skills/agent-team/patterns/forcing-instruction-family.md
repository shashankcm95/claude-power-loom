---
pattern: forcing-instruction-family
status: active+enforced
intent: Canonical catalog of the 11-instruction forcing-instruction family — the bracketed-marker text-emission mechanism (`[CATEGORY-NAME] ... [/CATEGORY-NAME]`) that grew across H.4.x → H.7.23.1. Per-instruction class assignment, landing-rate observations, phase-tag origins, and verdicts from the H.7.25 retrospective audit (drift-note 21 closure). Cross-referenced from Convention G in `validator-conventions.md` which codifies the three-class taxonomy.
related: [validator-conventions, route-decision]
---

## Summary

The forcing-instruction family is the substrate's mechanism for "deterministic detection + Claude-side semantic recovery" — bracketed-marker text emitted to stdout (or stderr / `decision: block`) that Claude reads and acts on. The pattern grew from 1 instruction (H.4.x `[PROMPT-ENRICHMENT-GATE]`) to 11 across 9 hook scripts by H.7.23.1.

Drift-note 21 captured the count growth as "architectural smell." H.7.25 audited the family at family-level and reframed: the smell is **compositional**, not contaminating. The 11 instructions span **three semantically distinct response classes** that collapsed onto one mechanism without explicit taxonomy. Convention G (in `validator-conventions.md`) names the classes; this doc is the catalog of which instruction belongs to which.

## Three classes (per Convention G)

| Class | What | Layer | Examples |
|-------|------|-------|----------|
| **1** Advisory forcing instruction | Deterministic detection + semantic recovery | stdout (UserPromptSubmit / PostToolUse) | `[PROMPT-ENRICHMENT-GATE]`, `[ROUTE-DECISION-UNCERTAIN]`, `[CONFIRMATION-UNCERTAIN]`, `[FAILURE-REPEATED]`, `[PLAN-SCHEMA-DRIFT]`, `[ROUTE-META-UNCERTAIN]`, `[MARKDOWN-EMPHASIS-DRIFT]` |
| **2** Operator notice | Status surface, no Claude action expected | stderr (SessionStart) preferred | `[SELF-IMPROVE QUEUE]`, `[PLUGIN-NOT-LOADED]`, `[MARKETPLACE-STALE]` |
| **Class 1 textual variant on hard-gate substrate** | PreToolUse `decision: block` with structured prose | JSON `decision: block` reason | `[PRE-APPROVAL-VERIFICATION-NEEDED]` |

The third row is **not a peer Class 3** — it's a documented variant of Class 1 textual conventions applied on a hard-gate (PreToolUse `decision: block`) substrate. Single-instance is variant, not class.

## Methodology — landing-rate data source

Per-marker landing rates in this catalog are sourced from **raw hook log files** at `~/.claude/logs/<hook>.log`, NOT from the aggregated `~/.claude/self-improve-counters.json`. The `prompt-enrich-trigger.log` separates `[PROMPT-ENRICHMENT-GATE]` from `[CONFIRMATION-UNCERTAIN]` via the `instruction:` field in log entries (e.g., `[2026-05-08T11:07:29Z] injected: {"instruction":"PROMPT-ENRICHMENT-GATE"}`). The counters JSON is hook-aggregated and would conflate sibling markers — never the right source for per-marker claims.

Aggregated landing rates per hook (24h sample, 2026-05-08): see "Per-instruction catalog" section's per-row notes.

## Per-instruction catalog

### Class 1 — Advisory forcing instruction

| # | Marker | Phase | File | Landing rate | Verdict | Notes |
|---|--------|-------|------|--------------|---------|-------|
| 1 | `[PROMPT-ENRICHMENT-GATE]` | H.4.x | `hooks/scripts/prompt-enrich-trigger.js` | ~16% (hook-aggregated; per-marker via raw log) | **KEEP** | Vagueness genuinely heuristic; semantic recovery (4-part enrichment) only Claude can produce |
| 2 | `[ROUTE-DECISION-UNCERTAIN]` | H.7.5 | `scripts/agent-team/route-decide.js` | (script-level; no hook log) | **KEEP** | Score abstained; recovery is `--context` re-invoke (Claude semantic call) |
| 3 | `[CONFIRMATION-UNCERTAIN]` | H.4.3 | `hooks/scripts/prompt-enrich-trigger.js` | (subset of #1) | **CONSOLIDATE → #1 (deferred to H.7.26)** | Same hook, same layer, same "consult prior turn" semantic. Performative differentiation |
| 4 | `[FAILURE-REPEATED]` | H.7.7 | `hooks/scripts/error-critic.js` | ~16% (escalation events) | **KEEP** | Repeat-failure consolidation — deterministic detection (count ≥ 2) + Claude reasoning |
| 6 | `[PLAN-SCHEMA-DRIFT]` | H.7.12 + H.7.17 | `hooks/scripts/validators/validate-plan-schema.js` | **80.8%** | **KEEP** | Highest landing rate; reference implementation for tier-1+tier-2 conditional structure |
| 7 | `[ROUTE-META-UNCERTAIN]` | H.7.16 | `scripts/agent-team/route-decide.js` | (script-level) | **KEEP** | Substrate-meta catch-22 protection. Tier 2 narrowing recommendation: drop FP-prone meta phrases like "forcing instruction" (drift-note 58) |
| 8 | `[MARKDOWN-EMPHASIS-DRIFT]` | H.7.18 | `hooks/scripts/validators/validate-markdown-emphasis.js` | ~22% | **KEEP, FLAG for migration** | Recovery is mechanical (wrap underscores), not semantic. **Wrong tool** — committed to H.7.27 migration (markdownlint pipeline preferred over PreToolUse hard-gate) |

### Class 2 — Operator notice

| # | Marker | Phase | File | Landing rate | Verdict | Notes |
|---|--------|-------|------|--------------|---------|-------|
| 5 | `[SELF-IMPROVE QUEUE]` | H.4.1 | `hooks/scripts/session-self-improve-prompt.js` | ~12% | **KEEP, retag as Class 2** | Inbox notification, not action ask. Reclassify via Convention G; no behavior change |
| 9 | `[PLUGIN-NOT-LOADED]` | H.7.22 | `hooks/scripts/plugin-loaded-check.js` | (low post-migration) | **CONSOLIDATE → #10 (deferred to H.7.26)** | Same substrate state as #10. Layer redundancy: SessionStart stderr (#10) + UserPromptSubmit stdout (#9). The doubling was intentional per H.7.22 design but reads as duplicated emission across two layers — collapse to #10 only |
| 10 | `[MARKETPLACE-STALE]` | H.7.23 | `hooks/scripts/session-reset.js` | ~12% | **KEEP, retag as Class 2** | Status surface, no Claude action expected. Convention G reclassifies; no behavior change |

### Class 1 textual variant on hard-gate substrate

| # | Marker | Phase | File | Landing rate | Verdict | Notes |
|---|--------|-------|------|--------------|---------|-------|
| 11 | `[PRE-APPROVAL-VERIFICATION-NEEDED]` | H.7.23.1 | `hooks/scripts/validators/verify-plan-gate.js` | (recent ship; low data) | **KEEP, recognize as variant** | Already a `decision: block` hard-gate borrowing forcing-instruction-shaped reason text. Codify as canonical example of the variant pattern; future hard-gates may re-use the textual conventions |

## Family-level findings

### What the audit confirmed

1. **The pattern is healthy** at family level — each instruction has a justifiable detection criterion + semantic recovery action. No instruction is fundamentally broken.

2. **The "smell" is compositional growth**, not band-aiding. Three classes accumulated under one mechanism without explicit taxonomy. Convention G names the classes; the catalog (this doc) tracks per-instruction class assignment.

3. **Two consolidation candidates** — instructions 1+3 (same hook, same semantic) and 9+10 (same substrate state, redundant layer). Mechanical consolidation deferred to H.7.26.

4. **One misclassification** — `[MARKDOWN-EMPHASIS-DRIFT]` (#8) has mechanical recovery (wrap underscores), not semantic. Forcing-instruction is the wrong tool. Migration committed to H.7.27.

5. **Single-instance is variant, not class** — `[PRE-APPROVAL-VERIFICATION-NEEDED]` (#11) is the only `decision: block` reason borrowing forcing-instruction textual conventions. Documented as variant of Class 1 on hard-gate substrate, not as peer Class 3.

### Post-H.7.26 active count

After consolidation (H.7.26): 11 → 9 active markers.

After `[MARKDOWN-EMPHASIS-DRIFT]` migration (H.7.27): 9 → 8 active markers.

### Cap rule

Per Convention G: **max 15 active markers** before mandatory family-level audit. Current trajectory (post-H.7.27) is 8; cap allows ~7 phases of headroom at observed 0.85/phase growth rate.

If first audit (when count crosses 15) goes well, the cap rule itself is empirically validated. If the audit forces meaningful consolidation again, the cap was the right preventative.

## Drift-note 21 closure

Drift-note 21 was captured H.7.18-ish noting the forcing-instruction count growth. H.7.25 closes it with:

- **Reframe**: smell is compositional, not contaminating
- **Codification**: Convention G (3 classes + decision tree + cap rule + failure modes) in `validator-conventions.md`
- **Catalog**: this doc — per-instruction class assignment + verdicts
- **Cross-references**: each of the 9 emission files gets a one-line comment pointing at Convention G
- **Deferred work**: H.7.26 consolidation (#1+#3, #9 retire); H.7.27 `[MARKDOWN-EMPHASIS-DRIFT]` migration

## Related Patterns

- [Validator Conventions](validator-conventions.md) — Convention G is the taxonomy this catalog references
- [Route Decision](route-decision.md) — emits `[ROUTE-DECISION-UNCERTAIN]` and `[ROUTE-META-UNCERTAIN]` (instructions 2 + 7)

## Phase

Shipped: H.7.25 (closes drift-note 21).
