# 54 — `docs/` tree (human-facing documentation)

**Role.** `docs/` is the toolkit's human-facing documentation surface — the layer a
reader (contributor, operator, or future maintainer) reaches before touching code. Per the
project's `CLAUDE.md` signpost discipline there is deliberately **no monolithic
`CLAUDE.md`**; operating discipline lives in predicate-gated rule files and evolving state
lives in auto-memory. `docs/` instead holds three classes of artifact: **live-status
canon** (`ARCHITECTURE.md` / `ROADMAP.md` / `ACTIVATION-LEDGER.md` / the generated
`SIGNPOST.md` + `delta-promote-walkthrough.md`), **reference docs** (`reference/**`,
`hooks/**`, `agents/**`, `skills/**`, `install/**`, `library.md`), and **concept/design +
development docs** (`concepts/**`, `development/**`). A fourth, ephemeral class — the
in-flight `system-report/_sections/**` — is the report this very section belongs to.

The headline finding: the **deep-substrate canon is current and unusually honest** (the
v3.x phase docs are maintained per-phase with `/phase-close` sign-offs and explicit
shadow/dormant/advisory flags), but a **cluster of the v2.x-era reference docs has not been
re-pathed after the Phase-0 `packages/**` restructure** (ADR-0008). Several reference docs
still describe the flat pre-v3 layout (`agents/`, `rules/`, `hooks/scripts/`,
`swarm/personas/`, `commands/`, `skills/`) and cite paths that no longer exist. This is the
exact doc-rot class the v3.7 phase-close flagged for the README and watermarks — it was
fixed there, but the `reference/` and `development/` deep docs were not swept.

## Directory contents & nesting

```text
docs/
├── README.md                         reference  · the docs index / router
├── ARCHITECTURE.md                   LIVE-STATUS · substrate model, 10 axioms, K1–K14, threat models
├── ROADMAP.md                        LIVE-STATUS · per-phase achievement record (Phase 0 → ③.0), appended each phase
├── ACTIVATION-LEDGER.md              LIVE-STATUS · built-but-dark inventory + denial-source taxonomy
├── SIGNPOST.md                       GENERATED   · concern→location map (scripts/generate-signpost.js)
├── delta-promote-walkthrough.md      LIVE-STATUS · the v3.7 human-gated promote demo, CI-guarded
├── library.md                        reference   · the library memory organizer (CLI + layout)
├── agents/
│   ├── README.md                     reference   · agents-layer inventory  [STALE paths]
│   └── overview.md                   reference   · the 5 generic personas table  [STALE counts]
├── concepts/
│   └── library-vs-mempalace.md       concept     · library design-deltas + attribution
├── development/
│   ├── README.md                     development · extending + plan-mode + CI tooling  [STALE paths]
│   ├── attribution.md                reference   · per-pattern influence mapping
│   └── extending.md                  development · "where to add a hook/agent/skill" table  [current]
├── hooks/
│   ├── README.md                     reference   · 24-registration inventory table  [COUNT DRIFT]
│   ├── overview.md                   reference   · hook categories + representative deep-dives  [COUNT DRIFT]
│   └── error-critic.md               reference   · the one per-hook deep-dive that ships
├── install/
│   ├── README.md                     reference   · marketplace vs legacy install paths
│   └── legacy-installer.md           reference   · install.sh flag reference  [minor drift]
├── reference/
│   ├── README.md                     reference   · reference-section index
│   ├── commands.md                   reference   · slash-command table  [STALE: 8 of 14 listed]
│   ├── diagnostics.md                reference   · claude-toolkit-status.sh usage  [current]
│   ├── project-structure.md          reference   · repo-layout walkthrough  [PRE-V3 LAYOUT]
│   ├── rules.md                      reference   · always-on rules table  [STALE: 8 of 9 listed]
│   └── stability-commitment.md       reference   · v2.x stability surface (self-labeled historical)
├── skills/
│   ├── README.md                     reference   · skills-layer inventory  [STALE paths + count]
│   └── overview.md                   reference   · highlight-skills table  [STALE count]
└── system-report/_sections/
    └── *.md (30 files: 10–1a, 20–23, 30–3a, 50; 54 = this)   EPHEMERAL · the as-is system report
```

## Per-file catalog

### Live-status canon (the maintained core)

- **`docs/README.md`** — the documentation index/router. Links every deep-dive and points
  to `packages/specs/` as the authoritative design record. Accurate and current; correctly
  frames `ARCHITECTURE`/`ROADMAP`/`ACTIVATION-LEDGER` as the substrate-state trio. One
  forward-pointer says the roadmap goes "v3.7 ✓ … v3.8 breaker → v3.9 first live beta" — a
  mild lag (the roadmap itself now runs through ③.0 and v3.9 became the calibration
  bootcamp, not a live beta), but the prose is hedged enough to not be a hard contradiction.

- **`docs/ARCHITECTURE.md`** — the canonical architecture reference. Governs the shared
  mental model: the three layers (`kernel`/`runtime`/`lab`), the dependency-inward rule +
  K12 advisory lint, the **Ten Axioms** (A1–A10), the kernel transaction loop, the
  **K1–K14 primitive table with honest live/dormant/advisory/dropped/retired/deferred
  flags**, and four threat models (the human-gated delta path; the v3.9 read-mostly
  ContainerAdapter; the friction map; the recall graph + v3.11 experience layer). The
  reading-note watermark is current ("reflects the merged tree as of **v3.11**"). This is
  load-bearing canon — `delta-promote-walkthrough.md`, the ACTIVATION-LEDGER, and several
  plans deep-link into its anchors (`#kernel-primitives`,
  `#6-what-is-enforced-and-where`, `#threat-model--the-human-gated-delta-path`,
  `#threat-model--the-v39-read-mostly-containeradapter-the-calibration-backtest`). Consumed
  by: the README, ROADMAP, walkthrough, and the ledger's threat-model citations.

- **`docs/ROADMAP.md`** (604 lines) — the per-phase achievement record, appended as each
  phase lands (Phase 0 → Phase 1-alpha → v3.1 → v3.2 → v3.3 → v3.4 → v3.5 → v3.6 → v3.7 →
  v3.8 → v3.9 → v3.10 → v3.11 → v-next mock-mechanics → ③.0). Each phase carries its plan
  link, ADR/PR links, an exit-criteria table, and a **3-lens `/phase-close` sign-off**
  (PM=honesty-auditor + Principal-SDE=code-reviewer + Architect). This is the readable
  digest over `packages/specs/`; the design record there is authoritative. Current through
  ③.0 (phase-closed 2026-06-17). The closing "Deferred / field-survey debt" section
  carries the Router-v2 plan and the ContainerAdapter/network-egress/tamper-evidence
  deferrals. Self-maintaining via the "Appending to this roadmap" convention at the foot.

- **`docs/ACTIVATION-LEDGER.md`** — the honest, consolidated inventory of every
  built-but-dark / flag-gated / deferred feature, its producer, its consumer, and its
  activation fate. Governs the **Producer–Consumer Phasing rule** (a producer in phase N
  needs a consumer planned for N+1, or it is tagged a strategic OPTION — never silent
  "someday" debt). Holds the master feature ledger table, the **denial-source taxonomy**
  the circuit-breaker draws from (`verdict-fail` / `negative-attestation` / `manage-promote`
  / `reject-event`), the v3.5 deferred-feature table, and the Option-B promote-disposition
  decision + its RFC §11 re-anchoring. Current and dense; cross-links ARCHITECTURE threat
  models and the RFCs. Consumed by anyone reasoning about what is actually live vs shadow.

- **`docs/SIGNPOST.md`** — **GENERATED, do-not-edit** (the file's own header says so). An
  auto-generated concern→location map: every `packages/**` source file with its
  header-comment purpose, grouped by layer (kernel < runtime < lab < specs). **Generator:**
  `scripts/generate-signpost.js`, a 13-line thin CLI that delegates to the testable core
  `packages/kernel/recall/signpost.js` (`runCli()`); `--check` exits 1 on drift as a CI
  gate. The doc is current with the tree (it includes the ③.1 `lab/persona-experiment/` +
  `lab/trace-emitter/` modules and the v-next `lab/causal-edge/` lesson machinery).

- **`docs/delta-promote-walkthrough.md`** — the v3.7 W3 human-gated promote workflow, end
  to end, backed by a hermetic runnable demo (`node examples/delta-promote-demo.js`,
  verified present) and CI-re-run on every push
  (`tests/unit/kernel/spawn-state/delta-promote-demo-e2e.test.js`). Documents
  `stageCandidate()` (the producer) → `integrate-cli.js` (the human surface) → the
  absorbed-vs-rejected ledger asymmetry → human `git merge`. All cross-links resolve
  (ARCHITECTURE §6, ACTIVATION-LEDGER, the v3.7 plan). Posture honesty is exemplary
  (shadow/opt-in/human-gated, the two ContainerAdapter-deferred residuals named upfront).

### Reference docs (the v2.x-rooted layer — the drift cluster)

- **`docs/library.md`** — the library memory organizer reference: vocabulary
  (Library/Section/Stack/Catalog/Volume), dual storage modes (`narrative`/`schematic`),
  file layout, the `scripts/library.js` + `scripts/library-migrate.js` CLI verb tables
  (v2.1.0 → v2.2.0), the migration saga, bulkhead mode, concurrency/schema-versioning
  notes, and `CLAUDE_LIBRARY_ROOT`. Version-stamped as a v2.x feature but the substrate is
  still live; reads as accurate for the library surface.

- **`docs/reference/README.md`** — the reference-section index; links the six reference
  docs below. Correctly labels `stability-commitment` "(v2.x)". Otherwise fine.

- **`docs/reference/stability-commitment.md`** — **self-labeled historical** (an
  added top banner: "v2.x — historical record … The substrate has since moved to v3.x
  (currently v3.11)"). Documents the v2.0.0 stable/evolving/experimental surface and the
  v3-trigger conditions. The banner is the correct treatment for a historical doc — this is
  the one stale-by-content doc that handles its own staleness honestly. Note the banner
  says "v3.11" while the live phase is ③.0 — a minor lag, not a contradiction.

- **`docs/reference/diagnostics.md`** — how to run
  `scripts/claude-toolkit-status.sh` (verified present) to see what is installed/firing.
  Current and tool-accurate.

- **`docs/reference/project-structure.md`** — **PRE-V3 LAYOUT (stale).** Describes the
  flat repository (`agents/`, `rules/{core,typescript,web}`, `hooks/scripts/`, `commands/`,
  `skills/`, `swarm/personas/`, `scripts/agent-team/`) that the Phase-0 restructure
  (ADR-0008) replaced with `packages/{kernel,runtime,lab,skills,specs}/`. Of the listed
  top-level dirs, `rules/`, `hooks/`, `commands/`, `skills/`, `scripts/agent-team/` no
  longer exist at those paths. Counts are v2.x-era ("5 agents", "6 core rules", "13 slash
  commands", "16 personas", "18 contracts") vs the current tree (19 `agents/*.md`, 7 core
  rules, 14 commands, 21 skills, 17 `runtime/personas/`, 19 `runtime/contracts/`).

- **`docs/reference/commands.md`** — **stale count + stale framing.** Header says
  "Commands (13)" but lists only **8**; the actual command source
  (`packages/skills/commands/*.md`) holds **14**. Missing from the table: `/build-plan`,
  `/build-team`, `/verify-plan`, `/phase-close`, `/implement`, `/research` (and the count
  itself drifts 13→14).

- **`docs/reference/rules.md`** — **stale count.** Header says "Rules (8)" and the table
  lists 8, but the source (`packages/skills/rules/core/*.md` + `typescript/` + `web/`) holds
  **9** (the table omits `core/workspace-hygiene.md`). Also: the `core/workflow.md` row
  describes the v2.x workflow rule ("<400-line PRs, 80%+ coverage …") rather than the
  current predicate-gated workflow rule with its plan-before-edit / route-decision /
  persona-selection sections.

### Reference — hooks/agents/skills overviews

- **`docs/hooks/README.md`** + **`docs/hooks/overview.md`** — **COUNT DRIFT.** Both state
  "**24** hook registrations across 6 lifecycle events" and the README inventory table
  enumerates 24, but `packages/kernel/hooks.json` actually registers **27** command entries
  (SessionStart 2, UserPromptSubmit 1, PreToolUse 12, PostToolUse 7, PreCompact 1, Stop 4).
  The README claims "1 `SessionStart`" and "5 `PostToolUse`" — the manifest has 2 and 7.
  The missing rows include the second `SessionStart` hook
  (`catalog-reconcile-session.js`) and the two PostToolUse `catalog-reconcile-write.js` /
  others. Both docs commendably say "the manifest wins — regenerate this inventory from it"
  and "deliberately does not restate every hook (the manifest does, and stays in sync)" —
  but the stay-in-sync claim is now false. The `error-critic.md` deep-dive itself is
  current and the source path it cites resolves.

- **`docs/hooks/error-critic.md`** — the single per-hook deep-dive (H.7.7
  Critic→Refiner). Accurate; source path `packages/kernel/hooks/post/error-critic.js`
  resolves. (The v2.x stability doc flagged "per-hook deep-dive docs for the 7 validators"
  as a never-shipped backlog item — still only `error-critic.md` ships.)

- **`docs/agents/README.md`** + **`docs/agents/overview.md`** — **STALE paths + counts.**
  README cites `swarm/personas/*.md` and `swarm/personas-contracts/*.contract.json` (both
  paths gone; the live ones are `packages/runtime/personas/` [17] and
  `packages/runtime/contracts/` [19]). overview lists "Agents (5)" with the five generic
  personas — the live `agents/*.md` count is **19**. The 3-layer split
  (`agents/*.md` → `runtime/personas/NN` → `contracts/*.contract.json`) is INTENTIONAL per
  `CLAUDE.md`/MEMORY, so the docs aren't wrong about the *split existing* — they are wrong
  about *where it lives* and *how many*.

- **`docs/skills/README.md`** + **`docs/skills/overview.md`** — **STALE paths + count.**
  README's Source section cites `skills/*/SKILL.md` (gone; live is
  `packages/skills/library/*/SKILL.md` — 21 SKILL.md files) and says "17 skills". overview
  says "17 skills shipped at v2.0.0" and references the `skills/` directory. The two
  notable-link paths inside README (`packages/skills/library/agent-team/SKILL.md` +
  `USING.md`) DO resolve — only the top-line `skills/*/SKILL.md` glob and count are stale.

### Install / concept / development docs

- **`docs/install/README.md`** — marketplace (`/plugin marketplace add` +
  `/plugin install power-loom`) vs legacy path; says both produce identical state. Current;
  `.claude-plugin/` manifest-layout claim is accurate.

- **`docs/install/legacy-installer.md`** — `install.sh` flag reference
  (`--all`/`--agents`/`--rules`/`--hooks`/`--commands`/`--skills`/`--diff`/`--backup`/`--test`)
  - the manual `settings.json` merge note + the library-init step. Minor drift: `--test` is
  described as a "**7-point** smoke test suite" but `install.sh` references ~26 numbered
  tests now (the "7-point" figure is v2.0.0-era; also echoed in `development/attribution.md`
  as "7-point installer test"). The cited template path
  `hooks/settings-reference.json` is stale — the live file is
  `packages/kernel/settings-reference.json`.

- **`docs/concepts/library-vs-mempalace.md`** — design-deltas + attribution for the library
  vs MempPalace (concepts borrowed, things not borrowed, vocabulary rationale, layout
  deltas). A concept/historical doc; stable by nature, no drift. (Cites
  `packages/skills/library/agent-team/kb/` "37-doc kb tree" — a count that may have grown,
  low-stakes.)

- **`docs/development/README.md`** — **STALE paths (worst offender after
  project-structure).** The "Plan-mode tooling" and "Plugin-dev tooling" sections cite
  multiple gone paths: `commands/build-plan.md`, `skills/build-plan/SKILL.md`,
  `swarm/plan-template.md`, `skills/agent-team/patterns/plan-mode-hets-injection.md`,
  `skills/agent-team/BACKLOG.md` (live equivalents:
  `packages/skills/commands/build-plan.md`, `packages/skills/library/build-plan/SKILL.md`,
  `packages/specs/research/plan-template.md`). The CI description is also stale: it claims
  `markdown-lint` "excludes `node_modules`, `swarm/`" and `smoke` runs "12/12 hook tests",
  but the live `.github/workflows/ci.yml` also excludes `packages/specs/` and the install
  smoke count has moved past 12.

- **`docs/development/attribution.md`** — per-pattern influence mapping
  (everything-claude-code, MemPalace, MiroFish, claude-superpowers + community patterns) +
  original-contributions list. Concept/historical; stable. Carries the same "7-point
  installer test" v2.x figure as a minor echo.

- **`docs/development/extending.md`** — the "where to add a Rule/Hook/Agent/Skill/Command"
  table. **This one was re-pathed** — it correctly uses
  `packages/skills/rules/`, `packages/kernel/hooks/`, `packages/kernel/hooks.json`,
  `agents/{name}.md`, `packages/skills/library/{name}/SKILL.md`,
  `packages/skills/commands/{name}.md`. A useful contrast: it proves the v3 paths were
  threaded into *some* development docs but not its sibling `development/README.md`.

### Ephemeral — the in-flight system report

- **`docs/system-report/_sections/*.md`** (30 files at scan time: `10–1a` kernel, `20–23`
  runtime, `30–3a` lab, `50` agents/personas; `54` = this file) — the as-is exhaustive
  system report being generated section-by-section. These are the report output artifact,
  not documentation *about* the system in the same sense as the rest of `docs/`. They are
  ephemeral relative to the canon; no `lifecycle` frontmatter is declared on them.

## Findings

| Severity | Level | Type | Location | Description |
|---|---|---|---|---|
| HIGH | file | bug | `docs/reference/project-structure.md` | Describes the **pre-v3 flat layout** (`rules/`, `hooks/scripts/`, `commands/`, `skills/`, `swarm/personas/`, `scripts/agent-team/`) that ADR-0008 replaced with `packages/{kernel,runtime,lab,skills,specs}/`. Five listed top-level dirs no longer exist at those paths; all component counts (5 agents / 6 rules / 13 commands / 16 personas / 18 contracts) are v2.x-era vs live (19 / 9 / 14 / 17 / 19). |
| HIGH | file | smell | `docs/development/README.md` | "Plan-mode" + "Plugin-dev" sections cite ~5 non-existent flat paths (`commands/build-plan.md`, `skills/build-plan/SKILL.md`, `swarm/plan-template.md`, `skills/agent-team/{patterns,BACKLOG}`). The doc-path CI gate exempts `docs/` from some checks, so this rot is unguarded. CI prose also stale (claims `swarm/`-only markdown exclude + "12/12 hook tests"; live also excludes `packages/specs/` and the smoke count grew). |
| MEDIUM | file | bug | `docs/hooks/README.md`, `docs/hooks/overview.md` | Count drift: both state "**24** hook registrations" (README enumerates 24) but `packages/kernel/hooks.json` registers **27** (SessionStart 2 not 1; PostToolUse 7 not 5). Both docs assert they "stay in sync" / "the manifest wins — regenerate from it"; that self-described invariant is now violated. Missing rows incl. `catalog-reconcile-session.js` + `catalog-reconcile-write.js`. |
| MEDIUM | file | bug | `docs/agents/README.md`, `docs/agents/overview.md` | Stale source paths (`swarm/personas/`, `swarm/personas-contracts/` — both gone; live: `packages/runtime/personas/` [17], `packages/runtime/contracts/` [19]) and stale counts ("Agents (5)" vs 19 live `agents/*.md`). |
| MEDIUM | file | bug | `docs/skills/README.md`, `docs/skills/overview.md` | Stale top-line source glob (`skills/*/SKILL.md` — gone; live `packages/skills/library/*/SKILL.md`, 21 files) and stale count ("17 skills"). The two notable agent-team links inside README still resolve. |
| MEDIUM | file | bug | `docs/reference/commands.md` | Header "Commands (13)" but only **8** are tabled; live source holds **14**. Missing: `/build-plan`, `/build-team`, `/verify-plan`, `/phase-close`, `/implement`, `/research`. |
| MEDIUM | file | bug | `docs/reference/rules.md` | Header "Rules (8)" lists 8; source holds **9** (omits `core/workspace-hygiene.md`). The `workflow.md` row describes the superseded v2.x workflow rule, not the current predicate-gated one. |
| LOW | file | bug | `docs/install/legacy-installer.md` | Cites template path `hooks/settings-reference.json` (stale; live `packages/kernel/settings-reference.json`). `--test` described as "7-point smoke test" but `install.sh` now runs ~26 numbered tests. |
| LOW | file | smell | `docs/development/attribution.md`, `docs/install/legacy-installer.md` | Both echo the v2.0.0 "7-point installer test" figure; the smoke suite has grown well past 7. Cosmetic but recurring. |
| LOW | file | smell | `docs/README.md` | Roadmap forward-pointer lags ("v3.7 ✓ … v3.9 first live beta") — the live roadmap runs through ③.0 and v3.9 became the calibration bootcamp, not a live beta. Hedged enough to be lag-not-contradiction. |
| LOW | file | smell | `docs/reference/stability-commitment.md` | The added historical banner says "currently v3.11" while the live phase is ③.0 — minor watermark lag inside an otherwise correctly self-labeled historical doc. |
| INFO | component | optimization | `docs/reference/`, `docs/{agents,skills,hooks}/` | The reference/overview layer is the v2.x doc-rot cluster. Consolidation opportunity: the inventory-table docs (`project-structure`, `commands`, `rules`, `agents/overview`, `skills/overview`, `hooks/README`) duplicate counts/paths that already exist authoritatively in `hooks.json`, `packages/skills/commands/`, etc. Consider generating these tables (as `SIGNPOST.md` already is) or replacing the hand-maintained counts with "see source" pointers to stop the recurring drift. |
| INFO | file | smell | `docs/hooks/error-critic.md` | Only 1 of N hooks has a per-hook deep-dive; the v2.x stability doc itself listed "per-hook docs for the 7 validators" as never-shipped backlog. Either ship the rest or drop the implied promise — currently a documented gap. |
| INFO | component | smell | `docs/system-report/_sections/*.md` | The in-flight report sections carry no `lifecycle:` frontmatter; per workspace-hygiene convention an ephemeral generated-report tree should declare `lifecycle: ephemeral` (or live outside `docs/`) so the stale-artifact scanner can reason about them. |
