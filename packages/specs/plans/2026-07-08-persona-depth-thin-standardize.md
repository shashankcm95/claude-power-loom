---
lifecycle: persistent
plan_id: persona-depth-scoped-core
created: 2026-07-08
status: VERIFY-passed (scoped) — build-ready
supersedes_scope: the 2026-07-08 "full thin-standardize" (4-wave) draft — RE-SCOPED to 2 waves after the 3-lens VERIFY board
topic: persona-depth, scoped-core, SSOT, DRY, citation-hub-extraction, orphan-personas, optimizer-18, planner-19, named-instincts, generator-model-field, fat-agents-stay-fat
routing: route (multi-file arc; 2 waves, each its own PR + VALIDATE board)
---

# Persona-depth (SCOPED CORE): citation-hub extraction + the two orphans

## Overview

Two high-value, low-risk pieces — the scoped core carved after the 3-lens VERIFY board
(which returned unanimous NEEDS-REVISION on the original full-thin scope; the architect
recommended shipping exactly these two and stopping; the USER chose it — see "Why scoped"):

1. **Citation-hub extraction (the DRY win)** — the substrate-wide `§Citation format`
   output convention (cited ~20x) currently lives inside `agents/architect.md`. Move it
   to a **dedicated neutral shared doc**; repoint every citer. Kills the 20-way
   cross-file reference into one home.
2. **The two orphans** — `optimizer` + `planner` have NO Layer-2 brief and NO instinct
   model. Author `18-optimizer` + `19-planner` Layer-2 briefs (named instincts + migrated
   workflow/templates) + Layer-3 contracts, add them to the generator (with a new
   per-persona `model` field), and thin their `agents/*.md` so they reach the instinct
   model via the same delegation the other 14 use.

**The fat agents stay fat.** `architect`, `code-reviewer`, `security-auditor` keep their
bodies — thinning them is uniformity-not-capability and was rejected (see "Why scoped").

## Why scoped (the 3-lens VERIFY verdict → USER re-scope 2026-07-08)

The board (architect + hacker + code-reviewer) returned **unanimous NEEDS-REVISION** on the
original full-thin scope, converging on:
- Thinning the fat agents **breaks a live enforcement loop** — the `kb-citation-gate`
  kernel hook (architect-scoped) + contract checks F6/F7/F10 enforce
  `## KB Sources Consulted` / `## Principle Audit` on actor output; those instructions live
  INLINE in the fat files today, and thinning moves them to a soft-read brief the spawn may
  skip → the gate blocks (hacker H2).
- It **regresses guaranteed-in-prompt depth** for exactly the 5 agents that don't have the
  delivery problem — delivery stays soft-read either way (ADR-0012), so full-thin buys
  uniformity, not capability (architect LOW-1 + MEDIUM-3).
- "Migrate the fat body into Layer-2" would **recreate the hub one layer down** and bloat a
  186-line role brief past 350, mixing identity + KB-index + output-contract (architect
  HIGH-2; code-reviewer SRP audit).

USER chose **Scoped core**: do the two pieces above, stop, leave the fat agents fat.

## Requirements

1. The `§Citation format` convention lives in ONE neutral shared doc; no file cites
   `agents/architect.md §Citation format`. All ~20 citers repointed.
2. `optimizer`→`18-optimizer`, `planner`→`19-planner`: Layer-2 briefs with named instincts
   plus Layer-3 contracts; both pass every cross-layer validator
   (`persona-instinct-reconcile`, `agent-contract-capability-reconcile`,
   `two-tier-shape-present`, `traits-resolve-clean`).
3. The generator gains a per-persona `model` field; `optimizer` stays `sonnet`, `planner`
   `opus`; no silent model-tier change (board CRITICAL/HIGH — 3 fat agents are `sonnet`).
4. Orphan thinning preserves the workflow/report/plan TEMPLATES: they land in the Layer-2
   brief before the stub is regenerated, guarded by a committed heading/token probe
   (`tests/unit/runtime/personas/orphan-brief-migration.test.js`). The KB catalog is
   DELIBERATELY condensed from the fat flat lists into a per-instinct Instinct→KB map
   (planner −9 refs, optimizer −3), per the thin-persona convention — a reshape, NOT
   wholesale preservation (do not overclaim "loss-free").
5. A `persona-pointer-resolves` validator asserts each thin stub's delegation pointer
   resolves to the CORRECT persona (alias-aware for `security-auditor`↔`12-security-engineer`);
   a wrong-pointer fixture fails it (non-vacuous).
6. All CI gates stay green; `docs/system-report/_sections/50-agents-personas.md` (hand-
   maintained: paragraph + line-count tree + finding-row) brought current.

## Runtime Probes (board-confirmed)

- **Generator hardcodes `model: opus`** — `Probe: scripts/generate-persona-agents.js:146`
  (literal string; no `p.model`). `agents/{optimizer,code-reviewer,security-auditor}.md:5`
  are `model: sonnet`. → per-persona `model` field required (Req 3).
- **`validate-doc-paths.js` does NOT scan `agents/`** — `Probe: scripts/validate-doc-paths.js:176-193`
  (`collectDocs()` scan set = commands + SKILL.md + kb + patterns only). A stale
  `architect.md §…` ref inside a stub is invisible → W2 must repoint via grep + regenerate,
  not rely on the gate.
- **Citer set (20)** — `Probe:` grep `architect.md §Citation format` → generator template
  (`:175`), 14 generated stubs, Layer-2 `01/02/03/05`, `04-architect.md:165` (self-ref to
  the moved section), `docs/system-report/_sections/50-agents-personas.md:96`.
  (`04-architect.md:125,157` cite OTHER architect sections that STAY fat — do NOT repoint.)
- **Capability floors** — `Probe: contracts-validate.js:1245-1290` + `traits/_registry.json`:
  `optimizer` `[Read,Grep,Glob,Bash,Edit]` ⇒ contract MUST carry
  `read_repo`+`bash_test_runner`+`worktree_writable`; `planner` `[Read,Grep,Glob]` ⇒
  `read_repo` only. `declared_capabilities` deep-equals `resolveTraits(traits)`
  (`traits-resolve-clean`). Board attack-7 confirmed a forgotten `worktree_writable` fails
  `write-floor-missing`.
- **Alias** — `Probe: contracts-validate.js:1221` `AGENT_NAME_ALIASES={'security-engineer':'security-auditor'}`
  — the pointer-validator must alias-resolve, not assume `agents/X → personas/NN-X`.
- **`kb-citation-gate` is architect-scoped** — `Probe: packages/kernel/hooks/post/kb-citation-gate.js:30`
  (`KB_REQUIRED_SUBAGENTS` = architect only). optimizer/planner are NOT gated → thinning
  them breaks no live hook (unlike the fat agents).

## Wave decomposition (each = its own PR + 3-lens VALIDATE board)

**W1 — Orphans + generator `model` field (additive; the truer lowest-risk foundation).**
- Add a `model` field to `renderAgentMd` + every `PERSONAS[]` entry (default `'opus'`).
- Author `packages/runtime/personas/18-optimizer.md` + `19-planner.md`: Identity + `## Mindset`
  (named instincts distilled from the current fat bodies) + Instinct→KB map + Focus + Output
  and Constraints; MIGRATE the fat workflow/templates (optimizer's Optimization Report +
  audit workflow; planner's plan template + sizing heuristics + red flags + Process steps
  1-3) into the brief.
- Author `18-optimizer.contract.json` + `19-planner.contract.json` (shape per
  `03-code-reviewer.contract.json`; `interface.instincts[]` == the brief's Mindset slugs;
  traits/declared_capabilities per the floors above).
- Add `optimizer` (`model:sonnet`) + `planner` (`model:opus`) to `PERSONAS[]`; regenerate to
  thin `agents/optimizer.md` + `agents/planner.md`.
- Tests: extend `persona-instinct-reconcile` + `agent-contract-reconcile` coverage to 18/19;
  a loss-free heading/token probe for the migrated templates.
- Risk: **Low-Med** (additive; proves the new-persona validator path end-to-end).

**W2 — Citation-hub extraction + pointer validator + doc sweep.**
- Create `packages/skills/library/agent-team/kb/hets/citation-format.md` (new `kb:hets/citation-format`)
  — the canonical, gate-passing `## KB Sources Consulted` / `kb:<id>` citation convention.
  (Dedicated doc, NOT `spawn-conventions` — SRP: that's a ceremony doc; architect MEDIUM-1.)
- Move the `### Citation format` body out of `agents/architect.md`; leave a one-line pointer
  to `kb:hets/citation-format`. (architect stays fat otherwise.) **Retain a `## KB Sources
  Consulted` heading token in architect.md** so `tests/unit/agents/architect.test.js:59-64`
  (`hasOutputContract`) stays green — or update that assertion in this PR.
- Repoint all 20 citers: the generator template (`:175`) → regenerate all 16 stubs; Layer-2
  `01/02/03/05` + `04-architect.md:165`; `docs/system-report/_sections/50-agents-personas.md`.
- Add `persona-pointer-resolves` validator (parse the stub's `NN-slug` pointer; assert
  equality to the alias-resolved expected id; wrong-pointer fixture fails it).
- Doc sweep: `system-report/_sections/50-agents-personas.md` (paragraph + tree + finding-row),
  `CHANGELOG`. (`workflow.md:250` H.7.24 sentence stays — the fat agents stay fat, so that
  Layer-1+2 description is still accurate; do NOT edit it.)
- Risk: **Med** (wide but mechanical repoint; `validate-doc-paths` won't catch a miss →
  VALIDATE hacker re-greps for residual `architect.md §Citation` refs).

## Risks + mitigations

- **Silent model upgrade** (board CRITICAL) → per-persona `model` field + a test asserting
  each generated `model:` equals the source value.
- **Stale `§Citation` anchor un-gated** (`validate-doc-paths` blind to `agents/`) → W2
  regenerates all stubs + VALIDATE hacker re-greps; the `persona-pointer-resolves` validator
  covers the pointer specifically.
- **Orphan content loss on regeneration** → migrate templates into the brief FIRST; a probe
  asserts each fat-body heading/token appears in the new brief before `--force` regenerates.
- **`architect.test.js` red window** → W2 retains the `## KB Sources Consulted` token in
  architect.md (or updates the assertion in the same PR); run the agents suite in W2's gate.
- **Delivery stays soft-read** — HONEST: this arc does NOT change how depth reaches a spawn.
  It buys the DRY hub-kill + gives 2 orphans their instinct model. State this in PR bodies.

## HETS Spawn Plan (per-wave boards)

- **VERIFY (this plan):** DONE — 3-lens board (architect + hacker + code-reviewer),
  unanimous NEEDS-REVISION on the superset → re-scoped to this 2-wave core; findings folded
  above. See `## Pre-Approval Verification`.
- **VALIDATE (post-build, per wave, Rule 2a):** `code-reviewer` (correctness / migration
  completeness) + `hacker` live-reprobe (run the validators against the built tree; grep for
  residual fat-refs; confirm no model upgrade; wrong-pointer fixture fails) + `honesty-auditor`
  (claim-vs-evidence: migration truly loss-free; soft-read caveat stated honestly).

## Principle Audit

- **SRP** — the citation convention moves to a dedicated doc (one home for a substrate-wide
  rule), not `spawn-conventions` (a ceremony doc) or a persona brief.
- **DRY** — kills the 20-way cross-file citation reference; SSOT for the orphans' depth.
- **KISS/YAGNI** — no fat-agent thinning (uniformity-not-capability, rejected); no mechanical
  delivery injector (delivery stays soft-read, ADR-0012); scope is the endorsed subset.
- **Open/Closed** — new personas (18/19) + new validator added alongside; fat agents + existing
  contracts untouched.

## KB Sources Consulted

- `kb:architecture/crosscut/single-responsibility` — grounds the dedicated-doc home for the
  citation convention (one reason to change) over dumping it in a ceremony/persona file.
- `kb:hets/spawn-conventions` — the sibling ceremony doc the new `kb:hets/citation-format`
  links from (step 4 "Actor writes output"); read to confirm SRP separation.

## Success criteria

- [ ] `grep -rn "architect.md §Citation"` → 0 hits; `kb:hets/citation-format` is the sole home.
- [ ] `18-optimizer` + `19-planner` briefs + contracts exist; all cross-layer validators green.
- [ ] `agents/optimizer.md` `model: sonnet`, `agents/planner.md` `model: opus` after regeneration.
- [ ] `persona-pointer-resolves` present + a wrong-pointer fixture fails it (non-vacuous).
- [ ] Full pre-push gate green; agents suite green; `system-report` section current.

## Pre-Approval Verification

3-lens VERIFY board on the original full-thin superset (architect + hacker + code-reviewer,
read-only, on the plan + real substrate), 2026-07-08:

- **hacker** — CRITICAL: generator `model:opus` silently upgrades 3 sonnet agents; HIGH:
  `validate-doc-paths` blind to `agents/`; HIGH: thinning breaks the live `kb-citation-gate`
  and F6/F7/F10 loop; HIGH: wrong-pointer validator sequenced too late + alias hazard; M1-M3
  citer/migration/save-path gaps. Capability reconcile = the one mechanic the plan got right.
- **architect** — NEEDS-REVISION: HIGH-1 model-tier (3 sonnet, not 1); HIGH-2 "migrate fat
  body → Layer-2" recreates the hub one layer down + violates Layer-2 SRP → carve
  (output-contracts → shared doc; KB catalog → kb-index; role-cognition → Layer-2);
  MEDIUM-1 prefer a dedicated `kb:hets/output-contract`/`citation-format` doc over
  spawn-conventions; MEDIUM-3 full-thin is a net regression for the 5 fat agents; LOW-1
  "ship W1+W2 + carve, stop — reconsider full-thin as a separate pass" (the re-scope basis).
- **code-reviewer** — 5 HIGH: architect `## Process` omitted from inventory; `04-architect.md`'s
  own 3 self-refs missed; W4 security-auditor merge under-specified (OWASP checklist has no
  home in the differently-shaped `12`); model-field undercounted 3x; W3 diff >600 lines.
  MEDIUM: code-reviewer severity catalog; `architect.test.js` red window. LOW: `--check`
  can't diff content; `workflow.md:250` spans all 5; system-report needs a real rewrite.

**Disposition:** re-scoped to the 2-wave core (this plan). Every finding that bears on the
retained scope (model-field, dedicated-doc hub home, complete citer set incl. `04:165`,
orphan migration inventory + loss-free probe, pointer-validator + alias, `architect.test.js`
token retention, system-report rewrite) is folded above. Findings that only bore on the
dropped W3/W4 (architect/code-reviewer/security-auditor thinning, H.7.24 reversal, the
migration carve of the fat bodies) are moot under the scoped plan.

## VALIDATE result (W1)

3-lens VALIDATE board on the BUILT W1 diff (code-reviewer + hacker live-reprobe + honesty-auditor),
2026-07-08:

- **hacker** — all 6 assigned attack vectors HELD; "the W1 diff is safe to ship." Capability
  floors deep-equal `resolveTraits` (`launder=[]`); model guard real (drop-field flips to `opus`);
  roster integrity clean (0 dup across 57 identities); `main()`-guard side-effect-free; persona-id
  fuzz rejected. Deferred (below): M1, L1, L3.
- **code-reviewer** — 0 CRITICAL; 1 HIGH + 1 MEDIUM content-completeness (folded); all mechanical
  gates clean (byte-identical regeneration, instinct-slug parity, non-vacuous model test, CI-covered).
- **honesty-auditor** — B / MINOR-OVERCLAIMS; nothing blocking. Overclaim cluster (folded): "loss-free"
  absolute + uncommitted probe; "audit workflow migrated"; "the board endorsed."

**Folded into W1 before PR:** (a) optimizer `verify-before-ship` instinct (restores the dropped
"Validate" step + recovers the `evaluation-under-nondeterminism` KB ref) + contract slug; (b) planner
design-pushback repointed `_index`→`surface-assumptions` + restored the HIGH/MEDIUM severity protocol;
(c) generator comment scoped `kb-citation-gate` correctly (architect-only); (d) committed the loss-free
probe `tests/unit/runtime/personas/orphan-brief-migration.test.js`; (e) reworded the plan's "loss-free"
and "endorsed" claims honestly; (f) explicit 18/19 roster-merge assertion.

## Deferred follow-ups (out of scope — a separate PR)

- **M1 (MEDIUM) — `generate-persona-agents --check` is content-blind.** It validates frontmatter
  presence only, so a hand-edit of a committed thin stub (e.g. flipping `model:` back to `opus`, or
  the pre-existing 407-byte hand-curation drift in `agents/hacker.md` + 6 siblings) is caught by NO
  gate. The fix (a `stub-matches-generator` content-equality arm) COLLIDES with those 7 legitimately
  hand-curated stubs — it needs the generator `PERSONAS[]` table reconciled with the curated stubs (or
  the curation relocated to the Layer-2 briefs) FIRST, or the gate fails on them. Genuinely out of scope
  for the orphans wave.
- **L1 (LOW) — the still-fat `sonnet` agents (`code-reviewer`, `security-auditor`) are unprotected by
  the model guard** (they're not in `PERSONAS[]`). If a future change adds either to the table without a
  `model` field, the silent-upgrade CRITICAL recurs. Latent, not live. A `stub-matches-generator` gate
  (M1) that asserts every `agents/*.md` `model:` equals its intended tier would also close this.
- **L3 (context) — `worktree_writable` ≠ security sandbox** (`p-writescope`): `18-optimizer`'s
  `Edit`+`worktree_writable` can escape the worktree via an absolute path; "never weaken a safety hook"
  is advisory prose the harness does not enforce. Pre-existing capability model (shared with
  `13-node-backend` / `12-security-engineer`), NOT a W1 regression — recorded as trust-boundary context.
