# 52 — Skills library: agent-team KB + patterns

**Scope**: `packages/skills/library/agent-team/` (85 tracked files; 0 untracked).

## Role

`agent-team/` is the **documentation + content substrate** for HETS (Hierarchical
Engineering Team Simulation). It is not executable code — the executable layer lives in
`packages/runtime/orchestration/` (resolvers, trackers, verifiers) and
`packages/kernel/` (validators, hooks). This directory holds three things the runtime
*consumes* and that humans + spawned agents *read*:

1. **The HETS skill body + format specs** (`SKILL.md`, `USING.md`, `contract-format.md`,
   `BACKLOG.md`) — what HETS is, how to drive it, the contract JSON schema, deferred work.
2. **The architectural-patterns library** (`patterns/`, 20 docs + README) — reusable
   coordination patterns extracted from HETS development; several are **canonical references
   cited by always-on rules, hooks, validators, and persona/agent definitions**.
3. **The content-addressed knowledge base** (`kb/`, 58 docs + README + `manifest.json`) —
   the frozen-per-run doc store resolved by `kb-resolver.js`, organized by stack/domain
   (`architecture/`, `backend-dev/`, `web-dev/`, `security-dev/`, …) plus HETS-internal
   conventions (`hets/`) and a `design-pushback/` anti-pattern catalog.

**Narrative arc the set encodes**: the directory is the institutional memory of a long
hardening track (phases `H.1` → `H.9.5.1` → `HT.*`, then the v4 monorepo restructure that
moved `swarm/` and `scripts/agent-team/` paths under `packages/`). `SKILL.md` and
`patterns/` are kept **current** (SKILL.md last touched 2026-06-10; the per-pattern
frontmatter is cross-validated by `contracts-validate.js`). `BACKLOG.md` is a 2951-line
**append-only historical ledger** (last touched 2026-05-26, pre-restructure) that still
carries old `swarm/`-prefixed paths — it is by-design historical, not live state.

## Live validation status (probed)

- `node packages/runtime/orchestration/contracts-validate.js` → **0 violations across all
  19 cross-validators** (pattern-status frontmatter ↔ README ↔ SKILL.md catalog
  consistency, `pattern-related-bidirectional`, `kb-architecture-related-bidirectional`,
  `contract-kb-scope-resolves`, `persona-instinct-reconcile`, …). The pattern/KB
  cross-reference graph is internally consistent.
- `node packages/runtime/orchestration/kb-resolver.js scan` → manifest in sync; 58 manifest
  entries == 58 on-disk KB docs (excluding `README.md`); sampled body hashes match manifest.
- `node scripts/validate-doc-paths.js` → **clean (115 docs; 0 blocking stale refs)** — but
  that gate only scans recognized citation forms; it does NOT catch the prose-path drift in
  `contract-format.md` / `research-plan-implement.md` flagged below.

## Directory contents & nesting

```
agent-team/
├── SKILL.md              (CANONICAL — HETS skill body: hierarchy, triple contract, workflow)
├── USING.md              (CANONICAL — end-user "drive HETS on your real project" guide)
├── contract-format.md    (CANONICAL — *.contract.json schema + check catalog)  [STALE PATHS]
├── BACKLOG.md            (HISTORICAL — 2951-line H.* phase ledger; append-only)
├── patterns/   (21 files: README + 20 pattern docs)
│   ├── README.md                       (CANONICAL — pattern index #0–#20 + status legend)
│   ├── system-design-principles.md     (CANONICAL+ENFORCED)
│   ├── validator-conventions.md        (CANONICAL+ENFORCED)
│   ├── agent-identity-reputation.md    (CANONICAL — producer-side of workflow Rule 4)
│   ├── route-decision.md               (active+enforced)
│   ├── trust-tiered-verification.md    (active+enforced)
│   ├── asymmetric-challenger.md        (active+enforced)
│   ├── forcing-instruction-family.md   (active+enforced)
│   ├── structural-code-review.md       (active)
│   ├── persona-skills-mapping.md       (active)
│   ├── shared-knowledge-base.md        (active)
│   ├── content-addressed-refs.md       (active)
│   ├── skill-bootstrapping.md          (active)
│   ├── tech-stack-analyzer.md          (active)
│   ├── kb-scope-enforcement.md         (active)
│   ├── missing-capability-signal.md    (active)
│   ├── plan-mode-hets-injection.md     (active)
│   ├── prompt-distillation.md          (active)
│   ├── meta-validation.md              (active)
│   ├── research-plan-implement.md      (active)               [STALE LAYOUT]
│   └── convergence-as-signal.md        (observed)
└── kb/   (60 files: README + manifest.json + 58 docs across 11 topic dirs)
    ├── README.md           (CANONICAL — KB layout, doc format, resolver CLI, tier loading)
    ├── manifest.json       (GENERATED — machine index: path/version/hash/tags per doc)
    ├── architecture/   (18 docs — ai-systems/ ×4, crosscut/ ×7, discipline/ ×7)
    ├── hets/           (8 docs — HETS-internal conventions; resolved into spawn prompts)
    ├── design-pushback/(7 docs — _index + 6 anti-pattern entries)
    ├── backend-dev/    (6), security-dev/ (4), web-dev/ (4),
    ├── data-dev/ (3), ml-dev/ (2), mobile-dev/ (2),
    └── infra-dev/ (2)
```

## Per-file catalog

### Top-level skill docs (4)

- `SKILL.md` — **CANONICAL**. The HETS skill body: role hierarchy (PM/super → orchestrator →
  sub-orchestrator → actor, `max_depth=3`), the **triple contract** (functional /
  anti-pattern / pattern), the workflow (assign → spawn → verify → record → review), the
  1000-zeros defense, persona-skills + identity-reputation summaries, and a "files this skill
  consumes" map pointing at `tree-tracker.js`, `contract-verifier.js`, `pattern-recorder.js`,
  `agent-identity.js`, `kb-resolver.js`, `budget-tracker.js`, `contracts-validate.js`.
  Governs how the orchestrator drives a run. Consumed by `commands/build-team.md`,
  `commands/chaos-test.md`, and the `agent-team` skill registration. The H.1→HT.1.6 inline
  changelog was deliberately trimmed 2026-06-09 (it carried ~83 stale pre-v4 paths).
- `USING.md` — **CANONICAL** (frontmatter `kb_id: hets/using-walkthrough`, but it lives at the
  skill root, not under `kb/`, so it is NOT a manifest entry — see findings). The
  product-engineer-facing 7-step walkthrough (install → init → `/build-team` → review plan →
  bootstrap missing skills → spawn → verify) with a worked rate-limiting example and a
  troubleshooting table. Distinguishes the real-task audience from the `chaos-test` audience.
- `contract-format.md` — **CANONICAL**. Full spec for `*.contract.json`: schema (budget /
  functional / antiPattern / fallbackAcceptable / skills / kb_scope), `skill_status` value
  semantics (`available` / `marketplace:…` / `not-yet-authored`), the `interface.instincts`
  binding (role-brief ↔ contract parity enforced by `persona-instinct-reconcile`), the full
  functional + anti-pattern check catalog, verifier CLI flags, verdict outcomes. Consumed by
  contract authors + `contract-verifier.js`. **Carries 2 stale paths** (see findings).
- `BACKLOG.md` — **HISTORICAL**. 2951-line append-only deferred-work + decision-record ledger
  spanning 63 `## Phase` headers (H.*and HT.*). Useful as provenance archive; not live state
  (live status is `docs/ROADMAP.md` + MEMORY.md). Last substantive touch 2026-05-26, before
  the v4 restructure, so it references `swarm/personas/`, `swarm/personas-contracts/` etc.
  Reading it for current paths would mislead — its lifecycle is "keep as archive."

### Patterns library — canonical / enforced (deep)

The `patterns/README.md` index (#0–#20) + per-pattern frontmatter + SKILL.md catalog are
the three sources of truth the `pattern-status-*-consistency` validators reconcile. Each doc
is dual-form: a ≤5-line **Summary** card (paste-inline cheap) + a full doc. The
**`active+enforced`** ones have a live callsite; **`active`** = code exists but no enforcing
callsite; **`observed`** = recurred without intentional design.

- `system-design-principles.md` — **CANONICAL+ENFORCED** (#18). The single canonical
  SOLID/DRY/KISS/YAGNI/clean-code reference. Cited by `agents/{architect,code-reviewer,
  optimizer,planner,security-auditor}.md`, `packages/runtime/personas/03-code-reviewer.md`,
  `rules/core/fundamentals.md`, and enforced via `validate-plan-schema.js` (Tier-1
  `## Principle Audit` requirement on HETS-routed plans). The widest-cited doc in the set.
- `validator-conventions.md` — **CANONICAL+ENFORCED** (#17). Conventions A–G for hook
  validators (A: separate repo-internal vs external-dependency checks; B: self-documenting
  stderr; C: tiered enforcement; D: PreToolUse-vs-PostToolUse placement; E: edit-result-aware
  scanning; G: forcing-instruction class taxonomy). Cited by `rules/core/workflow.md` (hook
  layer placement), `route-decide.js`, and ~7 kernel hooks/validators
  (`verify-plan-gate.js`, `error-critic.js`, `validate-no-bare-secrets.js`,
  `validate-plan-schema.js`, `prompt-enrich-trigger.js`, `session-reset.js`,
  `validate-adr-drift.js`). The canonical "how to author a hook" reference.
- `agent-identity-reputation.md` — **CANONICAL** (#5). Persona = role, identity = named
  instance accumulating per-instance trust; registry schema, rosters, assignment policy,
  failure modes (roster exhaustion, stale specializations, identity squatting, assignment
  race). It is the producer-side companion of workflow **Rule 4** (verdict attestation).
  Cited by `rules/core/workflow.md`, `agent-identity.js`, `lab/reputation/cli.js`,
  `commands/chaos-test.md`, and multiple plan/finding docs.
- `route-decision.md` — **active+enforced** (#15). The deterministic 7-dimension route gate
  (`route` / `borderline` / `root`) at `/build-team` Step 0; backs `route-decide.js`.
- `trust-tiered-verification.md` — **active+enforced** (#2). Verification depth scales
  inversely with measured per-identity trust; backs `agent-identity recommend-verification`.
- `asymmetric-challenger.md` — **active+enforced** (#1). Critic reads implementer output,
  surfaces ≥1 substantive disagreement at ~1.3–1.5× cost vs ~2× symmetric.
- `forcing-instruction-family.md` — **active+enforced** (#19). Catalog of the bracketed-marker
  forcing instructions across the hook scripts + class taxonomy (Convention G companion).
- `structural-code-review.md` — **active** (#12). The triple-contract third leg
  (`noUnrolledLoops` + `noExcessiveNesting`); catches the 1000-zeros family.

### Patterns library — active / observed (one-liners)

- `persona-skills-mapping.md` — **active** (#4). One-to-many persona→skills; spawn prompts
  list skill names only; verifier checks invocation via `invokesRequiredSkills`.
- `shared-knowledge-base.md` — **active** (#8). One source of truth; runs reference a frozen
  snapshot so mid-run KB edits don't perturb in-flight agents. Backs `kb/README.md`.
- `content-addressed-refs.md` — **active** (#9). `kb:<id>@<8-char-hash>` refs; hash mismatch
  rejected on resolve → cross-project reuse + reproducibility.
- `skill-bootstrapping.md` — **active** (#10). Missing skill → user-gated `/forge` → `/review`
  → catalog admission.
- `tech-stack-analyzer.md` — **active** (#11). Parse task → infer stack → map to skills →
  produce a user-redirectable plan; backs the `tech-stack-analyzer` skill.
- `kb-scope-enforcement.md` — **active** (#13). Verify an actor consumed every KB doc its
  `contract.kb_scope.default` declared (transcript scan); closes the "declare-without-read" gap.
- `missing-capability-signal.md` — **active** (#14). Sub-agents diagnose substrate gaps and
  return a structured `request:` block instead of self-authoring; root acquires.
- `plan-mode-hets-injection.md` — **active** (#16). `/build-plan` + plan template +
  architect-spawn recommendation when `convergence_value ≥ 0.10`. Additive to `/plan`.
- `prompt-distillation.md` — **active** (#7). Spawn-prompt size scales inversely with
  (trust × familiarity); cards over full docs by default. The dual-form docs apply it to docs.
- `meta-validation.md` — **active** (#6). Run the chaos test on the chaos-test infra itself.
- `research-plan-implement.md` — **active** (#20). RPI three-command workflow
  (`/research`, `/plan`, `/implement`) + documentary persona contracts 14–16. **Describes a
  stale `swarm/thoughts/` filesystem layout** (see findings).
- `convergence-as-signal.md` — **observed** (#3). Independent personas surfacing the same
  finding = high-confidence signal.

### KB — `hets/` (8 docs, HETS-internal conventions; resolved into spawn prompts)

- `spawn-conventions.md` — **CANONICAL**. The 5-step actor-spawn sequence (assign → track →
  launch → write → verify+record). Cited from SKILL.md as the starter KB ref.
- `identity-roster.md` — **CANONICAL**. Default per-persona name rosters (01-hacker →
  zoe/ren/kai, 04-architect → mira/theo/ari, builders 06–12, …) + trust-tier table.
- `stack-skill-map.md` — **CANONICAL**. Stack → required-skills lookup table; the
  tech-stack-analyzer's input behind USING.md Step 4.
- `canonical-skill-sources.md` — **CANONICAL**. skill-name → authoritative-doc-URL registry
  consulted first by `/forge` (L2 of the evolution-cycle vision).
- `challenger-conventions.md` — challenger (asymmetric-pair) spawn conventions.
- `symmetric-pair-conventions.md` — low-trust symmetric double-review conventions.
- `code-search-heuristics.md` — ripgrep/codebase-locator recall heuristics.
- `usability-adversary.md` — the documentation/usability review lens (foundational).

### KB — `architecture/` (18 docs, foundational design references; 3-tier loadable)

These follow the H.8.0 3-tier structure (`## Summary` / `## Quick Reference` / full body) so
`kb-resolver cat-summary|cat-quick-ref|cat` loads only the needed tier. All carry rich
`related:` graphs validated bidirectional.

- `ai-systems/` (4): `agent-design.md`, `evaluation-under-nondeterminism.md`,
  `inference-cost-management.md`, `rag-anchoring.md`.
- `crosscut/` (7): `single-responsibility.md`, `dependency-rule.md`, `deep-modules.md`,
  `information-hiding.md`, `acyclic-dependencies.md`, `control-and-data-flow.md`,
  `idempotency.md`, `integration-boundary-contracts.md` (8 listed — crosscut holds the SOLID +
  Ousterhout/Clean-Architecture core; `integration-boundary-contracts` is the 8th).
- `discipline/` (7): `trade-off-articulation.md`, `refusal-patterns.md`,
  `evidence-and-premise-discipline.md`, `error-handling-discipline.md`,
  `blast-radius-and-reversibility.md`, `reliability-scalability-maintainability.md`,
  `stability-patterns.md`.

### KB — `design-pushback/` (7 docs, proactive anti-pattern catalog)

- `_index.md` — **CANONICAL** (status `active+enforced`). The catalog schema (`applies_when` /
  `applies_NOT_when` context filters, severity ladder HIGH/MEDIUM/LOW, override-log path),
  consumption flow (brief-intake by tech-stack-analyzer/architect/planner), and add-entry
  discipline (empirical origin required). Distinguished from `refusal-patterns` (what to
  refuse) and `trade-off-articulation` (reactive). 6 anchor entries below:
- `google-drive-for-backend-storage.md`, `localStorage-for-auth-tokens.md`,
  `string-concat-sql.md` (HIGH); `plain-http-for-sensitive-data.md`,
  `single-region-deploy-for-mission-critical.md`, `synchronous-llm-calls-in-request-path.md`,
  `syntactic-gate-extension-for-tool-bypass.md` (MEDIUM). Note: `_index.md` Summary says "5
  anchor docs"; there are now **6** entry docs beyond `_index` (see findings).

### KB — stack/domain starter docs (23 docs, one-liners)

- `backend-dev/` (6): `node-runtime-basics`, `express-essentials`, `type-safety-at-the-boundary`,
  `jvm-runtime-basics`, `jvm-observability`, `spring-boot-essentials`.
- `security-dev/` (4): `threat-modeling-essentials`, `auth-patterns`, `defense-in-depth`,
  `protocol-and-state-abuse`.
- `web-dev/` (4): `react-essentials`, `typescript-react-patterns`, `accessibility-essentials`,
  `performance-budgets`.
- `data-dev/` (3): `data-modeling-basics`, `orchestration-essentials`, `lineage-and-cost`.
- `ml-dev/` (2): `pipeline-essentials`, `training-vs-inference`.
- `mobile-dev/` (2): `swift-essentials`, `ios-app-architecture`.
- `infra-dev/` (2): `kubernetes-essentials`, `observability-basics`.

### KB infrastructure (2)

- `README.md` — **CANONICAL**. KB layout, frontmatter format, the full `kb-resolver` CLI table
  (`cat` / `cat-summary` / `cat-quick-ref` / `hash` / `list` / `resolve` / `scan` / `snapshot`
  / `register`), 3-tier loading semantics, ref syntax, run-workflow (snapshot-freeze per run),
  path resolution (`HETS_KB_DIR` override).
- `manifest.json` — **GENERATED** by `kb-resolver scan`. Machine index: per-doc `path`,
  `version`, `hash` (SHA-256 of body), `shortHash`, `tags`, `lastUpdated`. 58 entries, all
  `version: 1`, all `lastUpdated: 2026-06-03T01:19:00Z` (a single batch regen). The
  content-address backbone for `kb:<id>@<hash>` refs.

## Findings

| Severity | Level | Type | Location | Description |
|----------|-------|------|----------|-------------|
| MEDIUM | file | smell | `contract-format.md:10` and `:18` | Stale pre-v4-restructure paths in a CANONICAL spec. `"persona": references swarm/personas/{persona}.md` — personas now live at `packages/runtime/personas/NN-name.md`. And `ENFORCEABLE as of H.2.8 via scripts/agent-team/budget-tracker.js` — the script is now `packages/runtime/orchestration/budget-tracker.js`. The doc-path gate does not catch these prose forms. A contract author following these paths lands nowhere. |
| MEDIUM | file | smell | `patterns/research-plan-implement.md:74-85` | The "Filesystem layout" section documents `swarm/thoughts/shared/{research,plans}/` as the RPI artifact home. That tree no longer exists post-restructure — RPI artifacts now live in `packages/specs/{research,plans}/` (confirmed: `git ls-files swarm/thoughts` is empty; `packages/specs/plans/` is populated). Drift between a live (`active`) pattern doc and the actual layout. |
| LOW | file | smell | `kb/design-pushback/_index.md:25` | Self-contradiction with the directory: Summary says "v2.8.6 ships the KB registry + **5 anchor docs**," but the directory now holds **6** entry docs beyond `_index.md` (`syntactic-gate-extension-for-tool-bypass.md` is the 6th, added later). The count in prose is stale; the catalog grew without updating the index sentence. |
| LOW | file | smell | `USING.md:1-8` | `USING.md` declares `kb_id: hets/using-walkthrough` in frontmatter but lives at the skill root, not under `kb/`, so it is NOT in `manifest.json` and is unresolvable via `kb-resolver cat hets/using-walkthrough`. A reader trusting the `kb_id` would expect resolver access it doesn't have. Either move it under `kb/hets/` (so `scan` indexes it) or drop the `kb_id` frontmatter to avoid implying resolvability. |
| LOW | component | smell | `BACKLOG.md` | 2951-line append-only historical ledger (last touched 2026-05-26, pre-restructure) carries many `swarm/`-prefixed paths and H.*/HT.* phase prose that no longer maps to current state. By-design archive (live state is ROADMAP.md + MEMORY.md), but it has no `lifecycle:` frontmatter marking it historical, so a cold reader could mistake its paths for current. Add a one-line "HISTORICAL ARCHIVE — paths predate the v4 restructure" banner at the top. |
| INFO | substrate | optimization | `patterns/` + `SKILL.md` | The pattern catalog is duplicated in three places kept in sync by validators: per-pattern frontmatter, `patterns/README.md` (#0–#20), and `SKILL.md`'s own "Pattern library" table (which only lists 12 of 20 and uses old `H.x` shipped-tags). The SKILL.md sub-table is a stale partial copy of `patterns/README.md`; it is not validated for completeness (only `pattern-status-skill-md-consistency` checks the rows that exist). Consider replacing the SKILL.md table with a pointer to `patterns/README.md` to remove the drift surface. |
| INFO | substrate | optimization | `kb/manifest.json` | All 58 entries share identical `lastUpdated` (2026-06-03T01:19:00Z) and `version: 1` — the manifest was regenerated in one batch, so `lastUpdated` no longer reflects per-doc edit recency and `version` never bumps. Functional for content-addressing (hashes are real and verified), but the `version`/`lastUpdated` fields carry no signal. Either wire `scan` to preserve per-doc mtime or document that these fields are regen-stamped, not edit-tracked. |
| INFO | component | smell | `patterns/` status legend | Eleven of twenty patterns are `active` (code exists, no enforcing callsite) and one is `observed`. The `active`-vs-`active+enforced` split is accurate and validated, but the large `active` (unwired) tail means much of the documented coordination machinery is advisory only. Not a defect — worth noting as the gap between documented design and enforced behavior for the system report. |
