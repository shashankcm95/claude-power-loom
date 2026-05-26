# Substrate measurement-methodology — observed dogfooded practice

> **Status**: substrate-internal convention doc; sibling shape with `swarm/path-reference-conventions.md`
> **Type**: lightweight institutional decision record (per `skills/agent-team/BACKLOG.md` `decision-record-pattern: lightweight` precedent)
> **Editorial-tier shape**: observed-practice catalog per ADR-0004 taxonomy (technical / governance / editorial); NOT itself an editorial-tier ADR (which would require institutional commitment per ADR-0004 + ADR-0005 editorial-tier criteria). The doc describes what phases have done, not what future phases must do.
> **NOT an ADR**: captures observed practice, not new institutional invariant
> **Created**: 2026-05-10 (HT.2.1; voice reframed at HT.3.2 to align with observation positioning per post-HT audit-followup Tier 2)
> **Pattern enumeration**: APPENDABLE — described as such because HT.2.1 derived these from a 9-case-study cohort; future drift-notes have historically extended pattern catalogs in this way

## Audience

- Phase planners authoring sub-plans
- Audit phase authors
- Anyone citing "N sites" / "N LoC" / "N references" / "N options" / "N callers" in HT-state.md or research artifacts
- Reviewers performing parallel architect + code-reviewer pre-approval gates

## What this doc captures

Observed dogfooded measurement-methodology practice from the HT.1 hardening track. Across HT.1.4–1.15, substrate accumulated nine convergent case studies demonstrating audit-count drift, audit-method gaps, audit-date currency, option-axis conflation, and pre-cycle in-scope resolution patterns. This doc codifies what the substrate already does well; it is a reference, not a binding rule.

## What this doc does NOT prescribe

- Prescriptive rules — future phases reference observed practice; nothing here binds them
- Closed pattern enumeration — the pattern list is APPENDABLE; historically (HT.2.1) phases derived 5 patterns from a 9-case-study cohort; future drift-notes have extended pattern catalogs in similar fashion (unlike `swarm/path-reference-conventions.md` whose 5 conventions are closed for the substrate's 5 contexts)
- Automated lint enforcement — patterns are observational; not executable rules; substrate convention is to keep this kind of guidance in markdown form
- Institutional commitment — not an ADR; substrate ADR ledger is 5 (ADR-0001/0002/0003/0004/0005 post-HT.3.1 codification); this doc's editorial-tier shape (observed-practice catalog) is distinct from editorial-tier ADRs (institutional commitment around authoring discipline — see ADR-0005)

## Case studies — cohort-first ordering

Cases 1-6 are the **active cohort** (audit-method-and-currency drift + count-drift + option-axis-conflation); cases 7-9 are the **in-scope-resolution cohort** (pre-cycle drift-note resolutions that SHRANK or REFRAMED phase scope). Case study 9 (drift-note 76) spans both cohorts — appears in in-scope-resolution position with cross-reference from active-cohort Pattern 4.

### Active cohort

#### Case study 1 — drift-note 63 (HT.1.4): visual-estimate-vs-empirical-fence-line measurement gap

- **Audit claim**: HT.0.9-verify FLAG-2 cited 537 LoC for `run_smoke_tests` in `install.sh`
- **Empirical reality (pre-HT.1.4)**: 1188 LoC monolithic body — verified via `install.sh:226` inline comment ("pre-HT.1.4 1188-LoC monolithic body") + HT-state.md drift-note 63 framing
- **Drift**: +651 LoC understatement (+121%)
- **Post-HT.1.4 state**: `install.sh` is 311 LoC; `run_smoke_tests` starts at line 218 with max span 93 lines (function now delegates to sourced test-group files extracted at HT.1.4)
- **Root cause**: HT.0.9-verify FLAG-2 visual estimate diverged from empirical fence-line wc-l count; the audit cited a number that didn't match the actual line count
- **Lesson**: name the measurement METHOD when citing — visual estimate ≠ analytical-claim count ≠ fence-line empirical wc-l

#### Case study 2 — drift-note 64 (HT.1.5): three convergent measurement methods, three counts

- **Three counts produced by three methods at three phases**:
  - HT.0.3 visual estimate → count A
  - HT.0.9-verify FLAG-2 analytical claim → count B (537 LoC — see case study 1)
  - HT.1.5 fence-line empirical → count C (1188 LoC pre-HT.1.4)
- **Root cause**: three different measurement methods applied across three phases without explicit method labeling
- **Lesson**: same measurement, three methods, three numbers — always specify which method when citing a count

#### Case study 3 — drift-note 65 (HT.1.6): option-axis conflation in 3-option decision-block

- **Decision-block claim**: HT.0.9-verify backlog line 160 enumerated "(a) join DEFAULT_ROSTERS / (b) keep `persona: <fixed>` shape / (c) adopt `<set-at-spawn>` shape" as 3 mutually-exclusive options
- **Empirical reality**: 2 independent axes were collapsed into a 3-option enumeration:
  - Axis 1: contract `persona` field shape — fixed vs `<set-at-spawn>`
  - Axis 2: DEFAULT_ROSTERS membership — present vs absent
- **Substrate-time exposure**: HT.0.9-verify chose option (b) (contract persona field shape: fixed); Axis 2 was silently left undecided until HT.1.6 empirical reproduction at runtime (`assign --persona 14-codebase-locator` failed with "No roster for persona")
- **Root cause**: decision-block treated multi-axis decision as single-axis 3-option enumeration; one axis silently undecided
- **Lesson**: when a decision-block enumerates N options, identify the underlying axes; collapsed axes lead to silent decision gaps

#### Case study 4 — drift-note 71 (HT.1.11): grep count without per-site classification

- **Audit claim**: HT.0.1 + HT.0.2 + HT.0.4 cited 9 sites with per-call regex compilation
- **Empirical reality**: per-site classification revealed 4 distinct migration tiers; only 6 sites had actual migration value
  - Tier 1 (STATIC promoted to module-top const): 1 site
  - Tier 2 (HOT memoization): 1 site
  - Tier 3 (consistency-win memoization): 4 sites
  - Tier 4 (OUT-OF-SCOPE: already module-level OR not per-call OR small-keyspace): 3 sites
- **Root cause**: raw grep count without per-site scope-or-value classification
- **Lesson**: never cite a raw grep count without per-site classification; classify in-scope vs out-of-scope, static-value vs hot-path, live-call vs dead-code

#### Case study 5 — drift-note 72 (HT.1.12): forward-ref count vs filesystem reality

- **Audit claim**: HT.0.5a cited 11 broken refs across 7 KBs to 8 unique non-existent targets
- **Empirical reality (verified at HT.1.12)**: 7 broken refs across 5 KBs to 5 unique non-existent targets
- **Drift**: -4 refs / -2 KBs / -3 targets (the audit count was overstated)
- **Root cause**: either HT.0.5a miscount OR architecture tree shape changed between 2026-05-09 audit + 2026-05-10 implementation
- **Lesson**: count broken references against the actual filesystem at sub-plan time, not against the audit's expected target list

#### Case study 6 — drift-note 74 (HT.1.13): audit-date currency drift

- **Audit claim**: HT.0.8 cited 228 LoC for always-on rules
- **Empirical reality (verified at HT.1.13)**: 322 LoC
- **Drift**: +94 LoC understatement (+41%)
- **Root cause**: `rules/core/workflow.md` likely grew via H.7.x additions post-audit-date — H.7.5 Route-Decision + H.7.9 Plan Mode/HETS-aware + H.7.18 markdown emphasis + H.7.19 Hook layer placement + H.7.22-H.7.23 Pre-approval verification + schema-level questions
- **Lesson**: audit findings have audit-date currency; substrate evolves between audit-T and implementation-T+N; re-validate before treating as ground truth

### In-scope-resolution cohort (pre-cycle drift-note resolutions)

#### Case study 7 — drift-note 66 (HT.1.6, RESOLVED in-scope at HT.1.6): drift-note inventory documentation lag

`commands/research.md:62-67` had a `.full` → `.identity` jq path bug (pre-existing H.8.6 documentation error masked by integration-test gap). Resolution shipped IN-SCOPE at HT.1.6 (3-line fix + new install.sh smoke test 72 closed the integration-test gap). HT-state.md drift-note inventory section had documentation lag listing drift-note 66 as outstanding until HT.2.0 master-plan-pre-approval surfaced (code-reviewer HIGH-1). **Lesson**: drift-note inventory sections require periodic re-validation against substrate; pre-cycle resolution patterns mean some inventory entries are stale. **Full detail**: see HT-state.md Highlights entry for HT.1.6.

#### Case study 8 — drift-note 70 (HT.1.10, RESOLVED in-scope at HT.1.10): documentation gap reframe

HT.0.3 + HT.0.4 + HT.0.5a cited "5 path conventions" inconsistencies needing consolidation sweep. Empirical pre-validation at HT.1.10 revealed the conventions are intentional context-dependent semantic encoding (Convention 1 repo-relative + Convention 2 hardcoded author-machine + Convention 3 `$HOME`-aware + Convention 4 relative path + Convention 5 deployed-marketplace), NOT inconsistency. Resolution at HT.1.10: scope SHRANK from "convention doc + 8+ site sweep" to "convention doc only"; `swarm/path-reference-conventions.md` (203 LoC) authored capturing existing practice. **Lesson**: empirical pre-validation can SHRINK phase scope by reframing "needs sweep" findings as "needs documentation" gaps. **Full detail**: see HT-state.md Highlights entry for HT.1.10.

#### Case study 9 — drift-note 76 (HT.1.15, RESOLVED in-scope at HT.1.15; DUAL COHORT)

`_lib/safe-exec.js` "1 caller post-H.8.4" → empirical "2 caller files / 3 actual call sites" — `build-spawn-context.js` (2 call sites at lines 77 + 90) + `validate-adr-drift.js` (1 call site at line 98). Resolution at HT.1.15: backlog spec option (a) "delete-and-migrate" pivoted to option (b/c) "keep + document"; lightweight BACKLOG canonical-pattern entry shipped. **Lesson**: caller-count empirical re-validation before "delete + migrate" decisions; grep ALL invocation forms (require + spawnSync + execFile + bash + comment references). **Cross-reference from Pattern 4**: this case study is the canonical example for Pattern 4 (Caller-count empirical re-validation) — see active-cohort patterns below. **Full detail**: see HT-state.md Highlights entry for HT.1.15.

## Canonical patterns observed in practice

Five patterns derived from the case studies above. The pattern list is described as APPENDABLE — HT.2.1 derived these five from the 9-case-study cohort; the same growth shape applies forward (future drift-notes have historically extended pattern catalogs in this way).

### Pattern 1 — Inventory-via-grep + per-site classification

Observed practice: when phase work involved a raw grep count, dogfooded approach added per-site classification along axes of:
- **in-scope vs out-of-scope** for the action under consideration
- **static-value vs hot-path vs lukewarm** for optimization actions
- **live-call vs dead-code** for code-cleanup actions
- **module-load-time vs per-call** for compilation/initialization actions

Phases that adopted this pattern surfaced classification value at sub-plan time (typically pre-empted false in-scope counts from carrying into implementation).

**Example**: case study 4 (drift-note 71) — HT.1.11 9-site grep → 4-tier classification → 6 sites with migration value.

### Pattern 2 — Audit-method-and-currency awareness

Observed practice: phases citing measurement explicitly named the method — visual estimate, analytical claim, and fence-line empirical can yield different counts. Phases also re-validated audit-cited counts against substrate state at implementation-time-T+N rather than treating audit-T counts as ground truth.

Method ladder (least → most reliable, as observed across HT.1):
- **Visual estimate**: rough order-of-magnitude scan; useful for prioritization, not for thresholds
- **Analytical claim**: counted across a finding's named scope (e.g., "function `X`"); accurate only if scope is well-bounded
- **Fence-line empirical**: `wc -l` or `grep -c` against the actual filesystem state at sub-plan time; the ground truth
- **Audit-date currency**: any count cited in an audit was true at audit-T; substrate may have evolved since — empirical pre-validation at sub-plan time addressed this in the HT.1.8-1.15 cohort

**Examples** (three case studies):
- Case study 1 (drift-note 63): HT.0.9-verify FLAG-2 cited 537 LoC; empirical reality was 1188 LoC pre-HT.1.4 — visual-estimate-vs-fence-line gap (+121% understatement)
- Case study 2 (drift-note 64): same measurement, three methods, three numbers across HT.0.3 + HT.0.9-verify + HT.1.5
- Case study 6 (drift-note 74): HT.0.8 cited 228 LoC for always-on rules; empirical reality at HT.1.13 was 322 LoC (+41%); workflow.md grew via H.7.x additions post-audit-date — audit-date currency drift

### Pattern 3 — Reference count grounding

Observed practice: phases counting broken references queried the actual filesystem at sub-plan time rather than relying on the audit's expected target list. Audits authored at time T can have stale-by-time-T+N counts if the substrate tree shape evolves. This is distinct from Pattern 2's audit-date currency — Pattern 3 is about WHAT-IS-COUNTED (filesystem state) vs Pattern 2's WHEN-WAS-COUNTED (currency at audit time).

**Example**: case study 5 (drift-note 72) — HT.1.12 cutover claim 11/7/8 broken refs vs empirical 7/5/5 against actual filesystem.

### Pattern 4 — Caller-count empirical re-validation

Observed practice: phases authoring "delete + migrate" decisions grepped ALL invocation forms during sub-plan empirical pre-validation:
- `require('./X')` (CommonJS)
- `import` (ESM — none in substrate currently but future-proofing)
- `spawnSync('node', [..., 'X', ...])` (subprocess)
- `execFile('X', ...)` (subprocess)
- `bash` invocation referencing X
- Documentation / comment references (not invocations but document the consumer relationship)

The search spanned ALL substrate directories — not just `scripts/agent-team/` (the most-common location); also `hooks/scripts/validators/` + `hooks/scripts/_lib/` + `tests/` + `commands/`. Caller files can live anywhere; raw grep count from a single directory is incomplete.

**Example**: case study 9 (drift-note 76) — HT.0.8 cited 1 caller for `_lib/safe-exec.js`; empirical reality 2 callers / 3 call sites — `build-spawn-context.js` (in `scripts/agent-team/`) + `validate-adr-drift.js` (in `hooks/scripts/validators/`). The HT.2.1 pre-approval gate itself demonstrated this pattern: code-reviewer HIGH-2 initially searched only `scripts/agent-team/` and reported `validate-adr-drift.js` as missing; empirical re-grep across full substrate confirmed the file exists at `hooks/scripts/validators/`. The pattern's meta-applicability to the pre-approval gates themselves is documented as a substrate observation, not a binding rule.

### Pattern 5 — Option-axis disambiguation

Observed practice: phases encountering decision-blocks with N enumerated options checked for underlying axes. Collapsed axes can lead to silent decision gaps — a 3-option enumeration may actually be a 2×2 matrix with 1 axis silently undecided.

Identify-axes heuristic (as practiced):
- For each option, what attribute(s) does it commit to?
- If two options share attribute X but differ in attribute Y, X and Y are independent axes
- If three options share attribute X but differ in attribute Y, X is shared and Y is the axis being decided
- When phases could not identify a single axis across all options, the enumeration typically conflated multiple axes

**Example**: case study 3 (drift-note 65) — HT.0.9-verify decision-block "3 options" → 2 independent axes (contract field shape × roster membership) → one axis silently undecided until runtime exposure.

## Pre-validation-at-sub-plan-time — observed practice

Observed pattern from the HT.1.8-1.15 dogfooded cohort: pre-cycle resolution (drift-note resolved before implementation begins) is more institutionally efficient than during-cycle resolution. Sub-plans empirically validate audit findings before treating them as ground truth. The pre-validation step typically takes 15-30 minutes and surfaces drift-notes at sub-plan time rather than during implementation (where they cause re-work).

This section captures observation, not prescription. Future phases may adopt; the pattern is not binding.

**Dogfooded data** (HT.1 closing cohort HT.1.8-1.15):
- 8 phases used empirical pre-validation gate
- 8 phases surfaced sub-plan-time drift-notes (67 + 68 + 69 + 71 + 72 + 74 + 75 + 76 captured at sub-plan time; drift-note 73 captured mid-implementation)
- 4 in-scope-resolution outcomes (drift-notes 66 + 70 + 76 + HT.2.0 master-plan-pre-approval's surfaced 66) — pre-cycle resolution SHRANK or REFRAMED phase scope

## When in-scope resolution applies (observed)

Three observed shapes of pre-cycle drift-note resolution across HT.1 → HT.2 boundary:

1. **Reframe** (drift-note 70 at HT.1.10): audit finding misframed as needing code change; empirical pre-validation reveals it's a documentation gap. Resolution = author documentation.
2. **Already-resolved** (drift-note 66 at HT.1.6): finding fixed in-scope at an earlier phase; documentation lag in inventory section listed it as outstanding. Resolution = update inventory.
3. **Pivot** (drift-note 76 at HT.1.15): backlog spec option (a) "delete-and-migrate" empirically untenable; pivot to option (b/c) "keep + document". Resolution = different action than spec proposed.

All three shapes are valid. Pre-validation determines which applies (if any).

## Scope-axis disambiguation

Observed practice: phases interpreting an audit's "N candidates" claim distinguished three scope axes:
- **candidates-for-action**: how many will the action under consideration touch?
- **candidates-for-consideration**: how many were inventoried (some may be filtered out as out-of-scope)?
- **candidates-existing-empirically**: how many exist in the substrate right now?

These can yield three different numbers in practice; phases that surfaced the scope distinction at sub-plan time reduced misframing at implementation.

## Cross-references

- `swarm/path-reference-conventions.md` — sibling lightweight convention doc (HT.1.10; 203 LoC; 5 closed path conventions)
- `swarm/thoughts/shared/HT-state.md` — canonical drift-note inventory source; lines 427-441 carry the empirical-grounding for all 9 case studies above
- `skills/agent-team/BACKLOG.md` — lightweight institutional decision records (HT.1.6 documentary persona + HT.1.12 deferred-author-intent + HT.1.15 safe-exec canonical-pattern entries)
- ADR ledger (5 ADRs post-HT.3.1; this doc is NOT ADR-shape — captures observed practice, not new institutional invariant):
  - ADR-0001 substrate-fail-open-hook-discipline (technical)
  - ADR-0002 bridge-script-entrypoint-criterion (technical)
  - ADR-0003 substrate-fail-open-hook-discipline-forward-looking (governance)
  - ADR-0004 adr-tier-taxonomy (governance; codifies the 3-tier ADR shape this doc references for its editorial-tier positioning)
  - ADR-0005 slopfiles-authoring-discipline (editorial)

## History

- 2026-05-10 (HT.2.1): authored at substrate-time when the 9-case-study cohort had accumulated empirical mass across HT.1.4-1.15. Pattern 2 (Audit-method-and-currency awareness) reframed during pre-approval gate (architect HIGH-1 + code-reviewer HIGH-1 convergent absorption) from initial "LoC measurement disambiguation" framing to absorb audit-method gap + audit-date currency together; case study 1 (drift-note 63) reframed from function-span/feature-span to visual-vs-empirical-method gap.
- 2026-05-11 (HT.3.2): voice reframed from imperative ("Never cite...", "Name the measurement method...", "Before X, grep ALL invocation forms...", "When N enumerated options, identify the underlying axes", "Specify which scope when citing") to descriptive observed-practice ("Observed practice: phases that did X..."). Post-HT audit-followup Tier 2 institutional reframing surfaced the framing-vs-content contradiction: doc declared itself "captures observed practice, not new institutional invariant" but used imperative voice that read as institutional commitment. Reframe preserves the doc's existing "not an ADR" positioning by aligning voice with observation framing. ADR ledger count updated 4 → 5 (post-HT.3.1 codification of ADR-0004 tier taxonomy). Editorial-tier shape reference added at top per ADR-0004 taxonomy framing.
- **Future**: pattern enumeration remains APPENDABLE; when new drift-notes surface that don't fit existing patterns, the substrate convention has been to add new patterns to this doc with case study + observed-practice framing, following the HT.2.1 derivation shape.
