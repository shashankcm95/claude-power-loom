---
name: phase-close
description: Phase-level verification gate run at a v3.x phase boundary (the post-phase analog of verify-plan). Spawns three independent full-context lenses in parallel — PM (honesty-auditor) + Principal-SDE (code-reviewer at phase altitude) + Architect — to review the INTEGRATED phase against its exit criteria, catching cross-PR drift the per-PR VALIDATE structurally cannot see. Produces a CLOSEABLE / NEEDS-WORK verdict + a phase-close record, and feeds the ghost-protocol effectiveness loop. Replaces ad-hoc external reviews (which lack context and hallucinate).
---

# phase-close — phase-level verification gate

At a **v3.x phase boundary** (e.g. v3.2-close after its last wave), before declaring the phase done or
bumping the plugin version, spawn three independent **full-context, in-substrate** lenses in parallel to
verify the **integrated phase against its exit criteria**. This catches what the per-PR / per-wave
VALIDATE cannot, *by construction*:

- **cross-PR contract drift** — a contract whose shape changed between PR-A and PR-B (each PR's review saw only its own diff);
- **accumulated debt** — merged-but-dark deployment state, deferred follow-ups piling up, reserved-not-produced surfaces;
- **phase-claim honesty** — "phase complete" vs the exit criteria *actually* met (deferred-but-claimed).

**Precedent:** the v3.1 phase-close sign-off (PM honesty-auditor + principal architect, both CLOSEABLE — `docs/ROADMAP.md`). This formalizes that proven ad-hoc pattern. It is the **post-phase analog of `/verify-plan`** (which is pre-approval) and is **coarser** — it fires ONCE per phase, not per PR.

## When this skill applies

- A v3.x phase (not a single wave/PR) is being declared complete OR the plugin version is about to bump.
- The phase has a defined set of **exit criteria** (in its scope doc / `docs/ROADMAP.md`) and ≥2 merged PRs.

## When it does NOT apply

- A single PR or a sub-wave (the per-wave VALIDATE already covers that — do NOT re-litigate per-PR diffs here).
- A phase with no integration surface (one-PR phases).

## Procedure (6 steps + three closing inputs at 3a/3b/3c, beyond the 3 lens verdicts)

### 1. Establish the phase scope

Identify: the phase id, its **exit criteria** (quote them from the scope/ROADMAP — verbatim), and the
set of merged PRs that compose it (`gh pr list --state merged` + the scope's PR cadence). Surface this to
the user before spawning. The lenses review the **integrated** result, so assemble the cross-PR picture:
the contracts that span PRs, the deferred items, the deployment state.

### 2. Spawn THREE lenses IN PARALLEL (single message, three Agent calls)

All three are **read-only** personas (per the read-only-verify-persona rule) and read the ACTUAL repo /
specs (full context — this is why they don't hallucinate, unlike an external review). The framing for all
three: **"what is true ACROSS these PRs that no single PR's review could have verified?"** — NOT a
re-review of each diff.

**PM lens** → `honesty-auditor`:

> Audit the INTEGRATED phase `<id>` against its exit criteria (quoted below). For EACH exit criterion: is
> it genuinely MET in the merged code, or claimed-but-deferred? Rate the phase's "complete" claim
> CONFIRMED / PARTIALLY / OVERCLAIMS with file:line evidence. Flag any deferred item presented as done,
> any merged-but-dark / inert surface, and any cross-PR claim no single PR could substantiate. **AND audit the
> living docs vs the merged code** (the root `README.md` + every per-module `README.md` the phase touched,
> `docs/ARCHITECTURE.md` / `docs/ROADMAP.md` / scope docs, and any module/skill/command/agent doc the phase
> changed): list every doc now STALE — wrong counts, wrong paths/layout, status/feature claims that no longer
> hold, undocumented new surfaces, orphaned docs — with the stale line + the correct value (these are the
> Step 3b doc-fixes the orchestrator applies before close). Verdict: CLOSEABLE / NEEDS-WORK + the
> must-fix-before-next-phase list.

**Principal-SDE lens** → `code-reviewer` (phase altitude):

> Review the INTEGRATED phase `<id>` for cross-PR coherence — NOT each diff (the per-PR gate did that).
> Specifically: the **seams** (contracts/types/enums that span PRs — did they stay consistent end-to-end?
> e.g. a producer in PR-A vs its consumer in PR-B), accumulated tech debt, dead/reserved surfaces, and
> integration bugs that only emerge when the PRs are assembled. **AND audit TEST-TIER coverage (Step 3c):**
> does every cross-module / cross-boundary flow the phase added have an INTEGRATION test wiring the REAL
> components (not just per-function unit tests, not a mocked seam), and does the phase's lifecycle have an
> e2e/acceptance SCENARIO walk where one is buildable in-process? Flag each unit-only multi-module flow + each
> missing acceptance walk; where a true e2e needs an external boundary, say so (a NAMED residual, never faked).
> Verdict: CLOSEABLE / NEEDS-WORK + findings.

**Architect lens** → `architect`:

> Assess the INTEGRATED phase `<id>` as a design unit: did the phase's architecture hold across its PRs,
> are its invariants/contracts coherent, and — critically — is the **forward contract READY for the next
> phase's consumer** (does the next phase have what it needs from this one)? Flag latent design debt the
> next phase would inherit. Verdict: CLOSEABLE / NEEDS-WORK + findings.

### 3. Aggregate the verdicts

Phase is **CLOSEABLE** iff all three return CLOSEABLE (or NEEDS-WORK whose only items are 3b doc-fixes or 3c missing-test-tier additions that get applied as part of closing).
Any code/contract NEEDS-WORK → the must-fix items **gate the next phase** (surface them; they are the
next phase's first work). Do NOT auto-close a phase over a substantive NEEDS-WORK.

### 3a. Release-surface gate (deterministic — a closing input beyond the 3 lens verdicts)

Beyond the three lenses, the phase is CLOSEABLE only if the **release version surface** matches the phase
being shipped. The plugin version is repeated across FOUR files that must move together — `.claude-plugin/plugin.json`,
the README badges + status line, the `CHANGELOG.md` top entry, and the `docs/ARCHITECTURE.md` watermark.
(`docs/SIGNPOST.md` per-module stamps are a SEPARATE surface owned by the `generate-signpost --check` gate;
`marketplace.json` has no version field; `docs/ROADMAP.md` is the record surface, not a release surface.)
The bump is **part of closing**, not a later follow-up:

1. If the phase shipped any user-relevant change (new/changed code under `packages/**`, `agents/**`, `hooks`,
   or the manifest), **land the 4-file release bump as part of the close** — a `release(vX.Y.0)` commit / PR
   cut as the closing act (the v3.8.0 release `30d642e` is the canonical 4-file template).
2. Then run the deterministic gate against the bumped tree:

   ```bash
   node scripts/validate-release-surface.js --phase <id>   # e.g. --phase v3.9
   ```

   - **PASS** → the surface is consistent and names the phase; proceed.
   - **FAIL** ("reads 3.(N-1) but closing 3.N") → a **blocking NEEDS-WORK**: the phase is NOT closeable
     until the bump lands. This is the deterministic catch for the stale-version-surface class that slipped
     at the v3.7/v3.8 boundaries (changed shipped code, forgot the bump) — do not hand-wave past it.
   - A genuinely docs/process-only phase that ships nothing user-relevant passes `--allow-unbumped` (the
     explicit human override — the version correctly holds; the gate records the deliberate N/A).

The phase-independent `--check` of this same gate runs on every push (drift-gate Test 124), so a *partial*
bump (plugin.json moved, README forgotten) is caught even outside a phase close. The check is deterministic,
so it does not depend on a lens *noticing* the stale surface.

### 3b. Docs-consistency checkpoint (lens-driven — all living docs current with the merged phase)

3a checks the version *strings* deterministically; **3b checks the docs' CONTENT is current** with what the
phase actually merged. Unlike 3a (which HARD-gates — a stale version is NOT closeable until the bump lands),
3b does NOT block on its own: stale docs are **brought up to date as part of the closing act** (apply-then-
close), and the phase is not DECLARED closed until that pass lands. A docs-only PM `NEEDS-WORK` is never a gate
on the next phase — it is applied, then the phase closes.

In scope — every living doc the phase's changes touched or invalidated:

- **README(s)** — the root `README.md` AND every per-directory `README.md` whose subtree the phase changed
  (toolkit docs live next to the code they describe; a renamed / added / removed module orphans its README).
- **`docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, scope docs** — structure, status lines, the "what exists" census.
- **Module / skill / command / agent docs** — a new flag, renamed export, moved file, changed default, or
  removed surface must be reflected wherever it is documented.

The drift classes to catch (all are claim-vs-evidence — a stale doc vs the merged code):

- stale **counts** (test counts, "N skills", primitive censuses) — prefer "run X for the live count" over a
  frozen number (the status-decay discipline), do not just refresh the stale integer;
- stale **paths / layout** (a moved or renamed file, a reorganized directory described by its old shape);
- stale **status / feature claims** ("X is unbuilt" after X shipped; a present-tense capability that changed);
- **undocumented new surfaces** (a feature this phase merged with no doc entry) and **orphaned** docs (a doc
  for a surface the phase removed).

**Detection** is the PM (`honesty-auditor`) lens's job — docs-vs-code is the same claim-vs-evidence lens, so
its prompt (Step 2) already carries the docs-drift audit; it only REPORTS (read-only-verify-persona rule).
**Application** is the orchestrator's: bring each flagged doc up to date as part of the close. Re-running the
suite/lint verifies the edits did not BREAK CI — NOT that they closed the flagged drift (lint cannot read prose
currency); so **echo each PM-flagged item as resolved in the Step-4 record** (an unaddressed item stays
visible), and if the PM returned a docs `NEEDS-WORK`, re-run just its docs-audit clause against the POST-fix
tree before writing the record.

**Honest framing (do NOT over-claim):** unlike 3a, this is **lens-detected + orchestrator-applied, NOT a
deterministic gate** — no validator proves a prose doc is current. A deterministic doc-freshness helper (e.g.
a phase-stamp the gate checks, or a doc-vs-symbol cross-ref) is a possible FUTURE escalation, not a claim
about today. The forcing function is this checkpoint's presence in the procedure + the PM lens's docs audit
(the same record-presence trust model as the rest of the gate — see Trust model below; not a hard block).

### 3c. Test-tier coverage checkpoint (integration + e2e/acceptance — not just unit)

Like 3b (and unlike the hard-gating 3a), 3c does NOT block on its own: when a phase shipped behavior that spans
modules or boundaries, the missing tier coverage is **added as part of the closing act** (apply-then-close) — a
phase should not rest on unit tests alone for a multi-module flow. The tiers:

- **Integration** — every cross-module / cross-boundary flow the phase added needs a test that wires the REAL
  components (real store / real I/O / real signed-record flow), NOT a mock of the seam. A multi-module feature
  covered only by per-function unit tests is an integration-coverage gap (the "unit folder full of integration
  tests, but the real wiring never asserted as one flow" smell).
- **e2e / acceptance** — the phase's lifecycle needs a definition-of-done SCENARIO walk where one is buildable
  in-process: a single end-to-end path through the phase's surfaces, asserting the integrated outcome.

**The honest e2e nuance (do NOT fake it):** where a TRUE end-to-end test requires a real EXTERNAL boundary the
substrate cannot exercise in-process — a deployed service, a real chain, a live cross-uid / network / sandbox
boundary — the **in-process acceptance walk is the closeable bar, and the external e2e is NAMED as a residual**,
never reported as covered. (PACT's SHADOW stake arc is the worked example: a DS1-DS6 acceptance walk closes the
in-process lifecycle; a real-forfeiture e2e is an external residual, not a coverage the phase can claim.)

**Detection** is the Principal-SDE (`code-reviewer`) lens's job — coverage-tier adequacy + the unit-only-for-a-
multi-module-flow smell is its remit, so its Step 2 prompt carries the tier audit; it only REPORTS (read-only).
**Application** is the orchestrator's: add the missing integration / acceptance tests and re-run the suite so
the NEW tests are verified green — the suite re-run verifies a new test EXISTS and PASSES (a stronger signal
than 3b, where lint cannot read prose), THOUGH a green test only proves the path it asserts, so the orchestrator
must confirm the new test wires the REAL components per the integration bar above. A true external e2e is instead
NAMED as a residual in the sign-off; a named residual is never run, so it inherits only the record-presence trust
model (like 3b) — its Step-4 echo is its sole forcing function. Echo each flagged flow as addressed-or-named in
the Step-4 record.

**Honest framing:** like 3b, lens-detected + orchestrator-applied, NOT deterministic — no validator proves a
phase's behavior is covered at the right tier. A light deterministic helper (e.g. assert each new top-level
module has a test BEYOND the unit tier — by whatever directory convention the repo uses for its integration /
acceptance tests, which differs across repos — or that an integration-tier directory is non-empty) is a possible
FUTURE escalation, not a present claim. The 3b docs-audit clause and the 3c tier-audit clause are
**LOAD-BEARING in the Step 2 prompts** — a future refactor that trims either silently no-ops that checkpoint.

### 4. Write the phase-close record

Append a `## Phase-close sign-off (<phase>, <date>)` block to `docs/ROADMAP.md` (matching the v3.1
precedent) with: the per-lens verdict, the exit-criteria delivery table, the must-fix carry-list, AND a
**closing-inputs line** — 3a (PASS / `--allow-unbumped`), 3b (each flagged-doc item resolved, or 'no living
docs touched this phase'), 3c (each flagged flow now covered + any external-e2e residual named, or 'no
cross-module flow added') — so an unaddressed flagged item stays VISIBLE in the record the ghost monitor reads. ALSO
write a library volume `library write toolkit/phase-close/<phase>-close --form narrative` so the record is
durable + queryable. The record's EXISTENCE is the "gate ran" marker the ghost monitor checks for.

### 5. Feed the ghost-protocol effectiveness loop

```bash
# the gate caught FRESH cross-PR drift the per-PR gates missed → it earns its keep:
node "${CLAUDE_PLUGIN_ROOT}/packages/kernel/spawn-state/self-improve-store.js" bump --signal improvement-effectiveness:phase-close --n 1
# (only when a lens surfaced a real cross-PR finding; a clean phase needs no bump)
```

If a drift slips PAST this gate and surfaces in a LATER phase, bump `rule-recurrence:phase-close` (the
gate missed it — effectiveness data). These two signals close the loop: *does the phase gate actually
prevent cross-phase drift?* (`drift-taxonomy.md` effectiveness formula.)

### 6. Surface the verdict

Report CLOSEABLE / NEEDS-WORK + the carry-list to the user. The user merges/closes at their gate (never
auto-close).

## Ghost-protocol monitor (HONESTLY advisory — read this)

The ghost-protocol tie-in **monitors** that this gate is actually run; it does NOT hook-enforce it. Per
`drift-taxonomy.md:93`, `drift:` convergence is **MANUAL** (surfaced for `/self-improve` triage, not
auto-fired). So:

- At session-end / pre-compact (an existing bump-discipline, `drift-taxonomy.md:66`): if a v3.x phase
  boundary was crossed **without** a phase-close record, bump `drift:phase-close-skipped`. At convergence
  (3+) `/self-improve` surfaces it.
- This makes skipping the gate **visible and tracked** — NOT a hard block.

The **release-surface gate (3a)** is a partial, deterministic realization of this: its `--check` mode runs
in the always-on pre-push + CI smoke (drift-gate Test 124), so a *partial* version bump is caught un-skippably
on every push — that part IS enforced, not advisory. What stays advisory is the *phase-equality* check
(`--phase <id>` at close): it is a deterministic PASS/FAIL, but it only runs if the agent runs the skill, so
it inherits the same "record-presence = forcing function" trust model as the rest of phase-close.

**Fuller hard enforcement** (e.g. a CI gate that runs `--phase` automatically when a `release(vX.Y.0)` /
`## [X.Y.0]` change lands, or a kernel PreToolUse hook keyed on the bump) is a deliberate FUTURE escalation —
a CI/kernel change, not a ghost-protocol edit. Probe the harness capability before building on it (ADR-0012:
a PreToolUse hook's `updatedInput` is inert on some surfaces). Do not describe the phase-equality tie-in as
hook-enforced; it is a deterministic check run under a tracked advisory discipline.

## Trust model

Like `/verify-plan`: the phase-close RECORD's presence is taken as evidence the gate ran (a forcing
function for procedural discipline), not a tamper-proof audit. Strict spawn-verification was rejected as
brittle (H.7.23). The value is the discipline + the effectiveness loop, not cryptographic proof.

## Relationship to the other gates

- `/verify-plan` — pre-approval, per-plan, before ExitPlanMode.
- per-wave VALIDATE (the per-wave workflow) — per-PR/per-wave, on a single diff.
- `/phase-close` — post-phase, on the INTEGRATED phase vs its exit criteria. Orthogonal + coarser; catches the cross-PR drift the other two can't see.
