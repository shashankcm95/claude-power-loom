---
adr_id: 0005
title: "Adopt slopfiles authoring discipline for always-on context surfaces"
# status enum (5 values): proposed | accepted | seed | superseded | deprecated
#   proposed   — drafted; not yet in effect
#   accepted   — approved; implementation can/has happened
#   seed       — pre-existing discipline codified retroactively (e.g., ADR-0001); still active for drift detection
#   superseded — replaced by another ADR (set superseded_by)
#   deprecated — no longer applies; not replaced
status: accepted
created: 2026-05-10
author: power-loom-author / HT.1.13 sub-plan + per-phase pre-approval gate (architect + code-reviewer; APPROVED-with-revisions; FLAGs absorbed single-pass)
superseded_by: null
files_affected:
  - rules/core/fundamentals.md
  - rules/core/prompt-enrichment.md
  - rules/core/research-mode.md
  - rules/core/security.md
  - rules/core/self-improvement.md
  - rules/core/workflow.md
  - swarm/architecture-substrate/prompt-enrichment-architecture.md
  - swarm/architecture-substrate/auto-loop-infrastructure.md
  - skills/agent-team/SKILL.md
invariants_introduced:
  - "Safety-critical content invariant: security guardrails, factual-claim discipline, and any content whose absence creates session-level safety regression MUST remain core-always (NOT wrapped in `<important if>`). Adding a `<important if>` wrap around safety-critical content is a load-bearing code-review gate."
  - "Authoring discipline invariant: new substrate guidance landing in always-on context surfaces is presumptively conditional. Adding NEW content to core-always (post-HT.1.13) requires explicit safety-criticality justification + code-reviewer gate."
  - "Predicate-vocabulary invariant: predicates use natural-language task descriptions. The vocabulary is curated (HT.1.13 establishes 13 starter predicates; +1 vs original 12 absorbed at architect HIGH-3 — substrate-meta predicate added); extensions go through ADR-update or code-review gate. Predicate inflation creates evaluation overhead at LLM-side; predicate compression risks losing scoping precision."
related_adrs:
  - 0001
  - 0003
related_kb:
  - architecture/discipline/error-handling-discipline
  - architecture/crosscut/single-responsibility
---

## Context

Always-on context surfaces (e.g., `~/.claude/rules/toolkit/core/*.md` auto-loaded into every Claude Code session) accumulate substrate-discipline content over time without conditionality scoping. Each new piece of substrate guidance ("when starting a multi-file change, enter plan mode"; "before invoking `/build-team`, run `route-decide`") lands as **one more always-on rule** rather than being scoped to its actual relevance window.

**Empirical state at HT.1.13 implementation (2026-05-10)**:
- 6 files at `rules/core/*.md` total **322 LoC** (deployed to `~/.claude/rules/toolkit/core/`)
- Estimated context tax: ~3870 tokens per session, regardless of task
- HT.0.8 audit framing: "context tax in 90% of unrelated sessions" — the typical user session does not trigger most of these rules

**Forces at play**:
- **Substrate growth**: each H.7.x phase adds discipline (H.7.5 Route-Decision; H.7.9 Plan Mode; H.7.18 markdown emphasis; H.7.19 Hook layer placement; H.7.22-23 Pre-approval verification; H.7.5/H.7.16 Route-Decision detail). All of these landed in `rules/core/workflow.md` as "one more rule."
- **Token economics**: every always-on token compounds across all sessions. 3.8K tokens × N sessions/day = significant aggregate context cost; some of that competes with task-relevant content.
- **Cognitive load**: rules competing for LLM attention — large always-on context dilutes per-rule weight.
- **Authoring inertia**: without explicit discipline, "always-on" is the default substrate-ledger landing place.

**Constraints**:
- Claude Code's rules layer auto-loads `~/.claude/rules/toolkit/core/*.md` verbatim into the system context. There is no Claude Code-side `<important if>` parsing.
- LLM-side conditionality compliance is best-effort instruction-following per README "What this toolkit is NOT".
- Some content is genuinely safety-critical (security guardrails, factual-claim discipline) and must remain always-on regardless of perceived task scope — moving them into conditional sections risks session-level safety regression.

**Prior state**: no authoring discipline. Rules grew organically. Each H.x phase that touched substrate norms added always-on content.

**Why now**: HT.0.8 cross-cutting audit identified the always-on-rules tax as a Size.3 special-focus item; HT.0.9 backlog scored it 6 (impact 2 / effort 3); HT.0.9-verify reframed it as "single-instance with substrate-wide pattern application" (architect FLAG-2). HT.1.13 is the substrate-side response.

**ADR taxonomy positioning** (post-HT.1.7 + HT.1.13 architect MEDIUM-2 absorption): the substrate now operates a three-tier ADR taxonomy:

- **Technical-tier** ADRs (e.g., ADR-0001 — fail-open hook discipline) — codify MECHANICAL invariants verifiable by grep/lint/test (try/catch + logger + decision: approve + hard-block scope). Drift detection is mechanical.
- **Governance-tier** ADRs (e.g., ADR-0003 — institutional commitment to enforce ADR-0001) — codify INSTITUTIONAL commitments + load-bearing code-review gates. Drift detection is human review of process discipline.
- **Editorial-tier** ADRs (this one — slopfiles authoring discipline) — codify AUTHORING discipline that depends on best-effort instruction-following (LLM-side) + author-side curation. Drift detection is partition-decision review at PR time.

The three tiers compose: technical → governance → editorial. ADR-0005 is editorial-tier — its invariants govern AUTHORING DECISIONS (which content is core-always vs conditional vs out-of-rules-migrated), not mechanical or institutional invariants. This positions ADR-0005 distinctly within the substrate's ADR institutional ledger.

## Decision

We will adopt the **slopfiles `<important if>` block-marker convention** as substrate authoring discipline for all always-on context surfaces (currently `rules/core/*.md`; forward-looking to any future surface).

**Specific approach**: always-on context content is partitioned into three categories:

### 1. Core-always content

Universal discipline that applies to every session — security guardrails, factual-claim citation discipline, fundamental coding principles. **NOT wrapped** in `<important if>`. Loaded verbatim every session.

### 2. Conditional content

Task-scoped discipline. Wrapped in `<important if "task involves X">...</important>` block markers with natural-language predicates. The LLM uses judgment to determine whether the predicate matches the current task; if not, the section is treated as a no-op.

```markdown
<important if "task involves git commits, PRs, or branch operations">

## Git Conventions

- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- Branch naming: `feat/short-description`, `fix/short-description`
...

</important>
```

### 3. Substrate-meta documentation

Informational content describing substrate behavior (auto-loop hook architecture, deterministic vagueness-detection mechanics) — **NOT discipline at all**. Migrated OUT of always-on rules surfaces entirely, into substrate KB docs (`kb/architecture/substrate/*.md`) which are referenced from rules but not auto-loaded.

### Predicate vocabulary (13 starter predicates)

| Predicate | Triggering task patterns |
|-----------|--------------------------|
| "task involves git commits, PRs, or branch operations" | `git commit`, `gh pr create`, `git push`, branch naming |
| "task involves running or writing tests" | `npm test`, test authoring, coverage discussion |
| "task involves code review" | `/code-review`, reviewing diffs, review feedback |
| "task involves deploying or release" | deploy commands, release notes, version bumps |
| "task involves multi-file changes (≥2 distinct files)" | refactors, multi-file features, sweeping changes |
| "task involves invoking /build-team or sub-agent orchestration" | HETS routing, multi-actor spawn |
| "task involves Hardening Track or HETS-routed phase" | per-phase pre-approval gate, plan-vs-research forbidden-phrase grep |
| "task involves CI workflow or install.sh changes" | new GitHub Actions, install scripts, cross-environment validation |
| "task involves markdown authoring" | .md edits, documentation drafts |
| "task involves API/library/spec research" | research questions, citation discipline |
| "task involves user-prompt-vagueness handling" | (rare; mostly automatic via hook layer) |
| "task involves Memory→Rule promotion or skill forge" | self-improve queue actions, /forge invocation |
| "task involves substrate-meta work (routing scorer, hook authoring, validator authoring, dictionary expansion, forcing-instruction class taxonomy)" | H.7.16 substrate-meta routing detection, H.7.18 markdown emphasis discipline applied to substrate authoring, dictionary-expansion catch-22 — added per architect HIGH-3 absorption |

Predicates are advisory — LLM uses judgment per README "What this toolkit is NOT" (best-effort instruction-following, not deterministic enforcement).

### Safety-critical content invariant (load-bearing)

The core-always partition is the SAFETY BOUNDARY. Content classified as core-always at HT.1.13 (per architect MEDIUM-3 + MEDIUM-4 + code-reviewer FLAG-1 + FLAG-6 absorptions; LoC empirically recounted):

- `security.md` — security guardrails (29 LoC; fully core-always)
- `research-mode.md` — factual-claim discipline (15 LoC; fully core-always)
- `fundamentals.md` Immutability + Core Principles + SOLID + File Organization + Error Handling + Input Validation + Naming sections (~51 LoC core-always; ~7 LoC conditional Pre-Completion Checklist only) — File Organization sizing kept core-always per architect MEDIUM-4 (applies to single-file authoring too, not just multi-file changes)
- `prompt-enrichment.md` Sub-Agent Awareness (3 LoC empirical: heading + 2 content lines; per code-reviewer FLAG-6)
- `self-improvement.md` Gap Detection + Throttle + Session-End Review + Pre-Compact Awareness (~15 LoC; observational discipline; Pre-Compact Awareness kept core-always per architect LOW-3 — only 3 LoC; predicate-vocabulary inflation avoided)
- `workflow.md` always-on intro paragraph (~3 LoC)

Total core-always: ~116 LoC (within ~110-120 LoC target band; HT.0.9 backlog "~30 LoC" target was over-aggressive vs empirical safety-critical content scope).

### LLM-side compliance is best-effort

The substrate's author-side discipline is fully under our control: we partition content into core-always vs conditional vs out-of-rules. LLM-side skip-when-irrelevant is observed through time, not enforced. Per README "What this toolkit is NOT":

- Best-effort instruction-following is the assumed model
- Author-side consistency is the substrate's deliverable
- Compliance metrics (does the LLM actually skip conditional sections it shouldn't apply?) are observational; HT.2+ may add measurement infrastructure

## Consequences

**Positive consequences (what we gain)**:

- **Token tax reduction (deterministic floor + best-effort upside; per architect MEDIUM-5 absorption — methodology reframed)**:
  - **Deterministic floor (substrate-author-side)**: ~55 LoC × ~12 tokens/LoC ≈ 660 tokens/session always saved via out-of-rules migration of substrate-meta content (auto-loop infrastructure description + vagueness gate description). This savings is independent of LLM compliance with `<important if>` predicates — the content is no longer in the auto-loaded surface.
  - **Best-effort upside (LLM-side)**: ~150 LoC of conditional content ≈ 1800 tokens/session saved IF LLM correctly skips conditional sections per predicate fit. Realistic LLM compliance rate is unmeasured (HT.2 sweep candidate adds observability); savings range from 0% (LLM ignores predicates entirely) to ~46% total (LLM skips perfectly).
  - **Combined estimate**: deterministic floor ~17% always-on reduction; total ceiling ~63% with full LLM compliance.
- **Authoring discipline**: future substrate guidance lands explicitly as either core-always (with safety-criticality justification) or conditional (with predicate). Stops the "one more always-on rule" accretion default.
- **Substrate-meta migration**: informational content (auto-loop infrastructure, vagueness detection mechanics) moves into substrate-internal architecture docs at `swarm/architecture-substrate/` (per architect HIGH-1/HIGH-2 absorptions — `kb/architecture/` is for canonical knowledge; substrate-meta is institutional architecture; sibling shape with HT.1.10 path-conventions doc) — separates active discipline from descriptive substrate-meta.
- **Forward-looking primitive readiness**: if Claude Code adds native `<important if>` parsing, substrate is already prepared. Migration is one-way: future native parsing renders LLM-instruction-following compliance into deterministic skip behavior.
- **Pattern application**: discipline applies to ANY future always-on context surface (per-project rules, MEMORY.md migration candidates, etc.), not just `rules/core/`.
- **markdownlint compatibility (per code-reviewer FLAG-4)**: `<important if>` block-marker syntax does not trigger MD033 because `MD033: false` is already set in `.markdownlint.json`. CI markdownlint over `rules/**/*.md` continues to pass post-HT.1.13.

**Negative consequences (what we sacrifice)**:

- **Compliance dependency**: token-tax reduction requires LLM-side compliance with `<important if>` predicates. Imperfect compliance means partial savings.
- **Predicate-vocabulary maintenance**: 12 predicates is a curated set; extensions require ADR-update or code-review gate. Vocabulary drift over time is a maintenance burden.
- **Author-cognitive overhead**: every new piece of substrate guidance now requires partition decision (core-always justification or conditional predicate selection). Mitigated by ADR-0005 invariants 1 + 2.
- **Markdown source verbosity**: `<important if "...">...</important>` block markers add lines. Trade-off accepted.

**Open questions**:

- LLM compliance rate — can we measure it? HT.2 sweep candidate to add observability (e.g., conditional-section-not-applied counter).
- Extension predicates — when do we add a 13th? ADR-update threshold (3+ phase sites needing same predicate) or code-review threshold?
- Per-project rules layer interaction — `~/.claude/projects/<project>/memory/MEMORY.md` is a separate surface; does the slopfiles discipline extend? Out of scope for HT.1.13; HT.2+ candidate.

## Alternatives Considered

### Alternative A: Frontmatter conditionals (`applies_when:` per file)

What it was: each `rules/core/*.md` gets a frontmatter `applies_when: "task involves X"` field; Claude Code (or substrate-side preprocessor) loads or skips files based on the predicate.

Why we didn't choose it:
- Per-file granularity is insufficient — `workflow.md` has 6+ orthogonal conditional sections; single `applies_when:` couldn't capture them
- Per-section conditionality requires section-level metadata syntax that doesn't exist
- Claude Code has no preprocessor hook to evaluate frontmatter conditionals at load time

### Alternative B: File splitting (multiple small task-conditional files at deeper rules paths)

What it was: split `workflow.md` into `workflow-git.md`, `workflow-tests.md`, `workflow-plan-mode.md`, etc. at deeper paths under `rules/core/`. Claude Code conditional-loads based on path matching.

Why we didn't choose it (as primary primitive):
- Claude Code has no conditional-loading mechanism for rules paths beyond what's already there (`rules/typescript/`, `rules/web/` are project-conditional via existing logic; `rules/core/` is universally auto-loaded)
- Adding sub-paths under `rules/core/` doesn't change loading behavior
- Adopt as **augmenting strategy** for purely-informational content (the substrate-meta migration to `kb/architecture/substrate/` follows this shape)

### Alternative C: Accept-as-design (do nothing)

What it would have been: leave `rules/core/*.md` as-is at 322 LoC; treat the always-on tax as the cost of substrate discipline.

Why we didn't choose it:
- HT.0.8 framing identified this as a Size.3 special-focus item — explicit user-acknowledged context tax concern
- Substrate growth pattern is asymptotic — without intervention, every H.x phase adds always-on content; tax compounds
- Future always-on surfaces (per-project rules, MEMORY.md drift) inherit the same lack-of-discipline; ADR-0005 establishes the institutional pattern preemptively

### Alternative D: ADR-only (codify discipline; defer code refactor to later phase)

What it would have been: ship ADR-0005 alone in HT.1.13; defer the `rules/core/` refactor to HT.1.13.5 or HT.2.

Why we didn't choose it:
- HT-state.md backlog scope explicitly bundles ADR + refactor into HT.1.13 (hybrid decision)
- ADR without an instance is harder to validate (Alternative A/B/C tradeoffs may surface only during refactor; per-phase pre-approval gate validates against the actual content)
- Splitting into two phases doubles cutover overhead without proportional value

## Status notes

- 2026-05-10 — proposed by HT.1.13 sub-plan
- 2026-05-10 — accepted at parallel architect + code-reviewer per-phase pre-approval gate (architect: APPROVED-with-revisions, 4 HIGH + 7 MEDIUM + 3 LOW FLAGs absorbed; code-reviewer: APPROVED-with-revisions, 2 HIGH + 4 MEDIUM + 4 LOW FLAGs absorbed; 2 HIGH FLAGs convergent across both reviewers — KB destination path + ADR-0005 status-at-ship); shipped at `status: accepted` directly per HT.1.7 precedent (transient `proposed` introduces test-timing-window risk)

## Related work

- ADR-0001 — Substrate fail-open hook discipline (technical-tier; mechanical invariants for hooks). ADR-0005 cites ADR-0001's "best-effort instruction-following" framing as parallel discipline-shape (deterministic-vs-best-effort).
- ADR-0003 — Forward-looking governance-tier institutional commitment for substrate fail-open hook discipline. ADR-0005 follows the same governance-tier shape (institutional commitment to authoring discipline + load-bearing code-review gate per invariant 1).
- HT.0.8 cross-cutting audit Size.3 — always-on rules tax 228 LoC ~3.5K tokens (LoC count later corrected to 322 at HT.1.13 empirical pre-validation; drift-note 74 captured)
- HT.0.9 synthesis backlog HT.1.13 — score 6 (impact 2 / effort 3); decision: hybrid (ADR + code)
- HT.0.9-verify architect FLAG-2 — single-instance with substrate-wide pattern application reframe; ADR-0005 retained as load-bearing
- humanlayer/advanced-context-engineering-for-coding-agents — slopfiles `<important if>` primitive source (same project as RPI doctrine adopted at H.8.6)
- README.md "What this toolkit is NOT" — best-effort instruction-following framing; ADR-0005 invariant 4 cites
- Drift-note 74 — HT.0.8 LoC count overstated vs empirical (228 vs 322); sibling cohort with measurement-methodology drift-notes 63 + 64 + 71 + 72
