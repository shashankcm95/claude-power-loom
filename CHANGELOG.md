# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) starting at v1.0.0. Pre-1.0 versions are aggregations of phase tags shipped before the SemVer commitment.

For granular per-phase detail, see annotated tags `phase-H.x.y` and `swarm/H.x.y-findings.md` files.

---

## [1.12.1] — 2026-05-10 — HT.2.2 parseFrontmatter YAML 1.2 inline-comment strip (drift-note 73 closed; parser-discipline-edge HT.2.2 second HT.2 sub-phase)

**HT.2 second sub-phase. Sub-plan-only methodology per HT.2 master plan methodology table line 328 (mechanical YAML 1.2 spec compliance; no fresh design surface; chaos-test mitigates regression risk).** Extends `scripts/agent-team/_lib/frontmatter.js parseFrontmatter` to honor YAML 1.2 §9.1.6 inline `#` comment semantics. **Plugin manifest patch bump 1.12.0 → 1.12.1** per code-reviewer HIGH-2 absorption at HT.2.0 (consumer-visible parser API behavior change — frontmatter inline `#` semantics change from "preserved as literal" to "YAML 1.2-spec comment-strip"; preserves pure-doc no-bump distinction per HT.1.10/HT.1.12/HT.1.14/HT.1.15 — HT.2.2 is NOT pure-doc since it changes parser behavior).

### What landed

- **NEW `_stripInlineComment(val)` helper** in `scripts/agent-team/_lib/frontmatter.js` (~25 LoC; quote-aware traversal). Strips `#` comments where preceded by whitespace; preserves `#` inside single-quoted + double-quoted scalars + bare scalars where `#` is not preceded by whitespace; documented gotcha for inline-array elements containing unquoted `# c` (per YAML 1.2 spec, treated as comment-truncation; use quoted form `[a, "b # c", d]` to embed).
- **2 application sites in `parseFrontmatter`**:
  - Main scalar value extraction — between `m[2].trim()` (line 60) and empty-value branch. Comments at value position (`key: # foo`) collapse to empty value → triggers existing block-list-start branch per YAML 1.2 spec.
  - Block-list item extraction — between `.trim()` and `.replace(/^["']|["']$/g, '')` in the line-45 chain. Strip-comment runs BEFORE quote-strip so quote-protected `#` survives.
- **`module.exports`** extended: `{ parseFrontmatter, _stripInlineComment }` (helper exported for substrate-internal reuse + future testing).
- **8 NEW unit tests in `_h70-test.js` Section 8** validate: bare scalar trailing comment strip; inline array trailing comment preserves array; `#` inside double-quoted scalar preserved; `#` inside single-quoted scalar preserved; block-list item trailing comment strip; regression guard — comment-free frontmatter unchanged; bare `#` value → empty → block-list start; `#` not preceded by whitespace → literal.

### Drift-note 73 RESOLVED-by-implementation

drift-note 73 was captured at HT.1.12 mid-implementation when inline-comment frontmatter authoring (`  - architecture/ai-systems/agent-design  # planned — not yet authored`) revealed the parser limitation; HT.1.12 pivoted to body-section migration. HT.2 master plan §"Sub-phase 2 — HT.2.2 parser-discipline-edge sweep" routed the original parser limitation to HT.2.2. Now closed: future KB / ADR / pattern frontmatter authoring can use inline `#` comments per YAML 1.2 spec without ref-string contamination.

### Empirical pre-validation pattern — 10-phase confirmed

`parseFrontmatter` value-extraction sites read live before sub-plan flipped draft → approved. Insertion point at line 60 (`m[2].trim()`) + block-list extraction at line 45 confirmed. Sibling-cohort pattern with HT.1.8-1.15 + HT.2.1.

### Forbidden-phrase grep gate

Sub-plan grep returned 2 matches both within carve-outs: (1) line 20 — direct quote from YAML 1.2 spec §9.1.6 (quotation carve-out); (2) line 47 — plan-mode prescriptive language describing implementation sequencing (plan-mode carve-out per HT.1.3 / HT.2.0 / HT.2.1 precedent). Sub-plan PASSES.

### Methodology

- **Sub-plan-only** per HT.2 master plan methodology table line 328 + HT.1.2 + HT.1.4 + HT.1.6 + HT.1.8 + HT.1.9 sub-plan-only precedent (now 10 consecutive sub-plan-only phases since HT.1.7 with HT.1.13 + HT.2.1 as per-phase pre-approval invocations in between). Per-phase pre-approval skipped with EXPLICIT decision rationale matrix per HT.1.6 convention: mechanical YAML 1.2 spec compliance; no fresh design surface (algorithm is canonical quote-aware traversal); no option-axis fork; no schema change; no institutional discipline encoding. HIGH-class risk surface (regression on existing frontmatter) mitigated by chaos-test across all 4 frontmatter cohorts.

### Verification

- **install.sh smoke**: 73/73 (unchanged from HT.2.1; behavior-internal change; no new install.sh tests added)
- **_h70-test.js asserts**: 54/54 (was 46/46; +8 HT.2.2 Section 8 unit tests)
- **contracts-validate.js violations**: 16 baseline only (chaos-test PASS — no regression across ~58 frontmatter sources scanned: 33 KB docs + 21 pattern docs + 4 ADRs)

### Plugin manifest

`1.12.0` → `1.12.1` per code-reviewer HIGH-2 absorption at HT.2.0 master-plan pre-approval (consumer-visible parser API behavior change). Preserves pure-doc no-bump distinction per HT.1.10/HT.1.12/HT.1.14/HT.1.15 precedent — HT.2.2 is NOT pure-doc since it changes parser behavior.

### Wallclock

~75 min end-to-end (sub-plan + empirical pre-validation ~25 min + helper + 2 application sites + JSDoc ~20 min + 8 unit tests ~10 min + chaos-test + 3-tier verification ~10 min + cutover ~10 min).

### Pattern-level observations

- HT.2.2 closes drift-note 73 (parser-discipline-edge) as the second HT.2 sub-phase; remaining HT.2 inventory is hooks-discipline-edge (drift-notes 67 + 75; HT.2.3 with per-phase pre-approval UNCONDITIONAL per architect HIGH-2 at HT.2.0) + doc-lag (drift-notes 68 + 69; HT.2.4) + soak gate readiness (HT.2.5).
- Empirical pre-validation pattern is now 10-phase confirmed (HT.1.8-1.15 + HT.2.1 + HT.2.2).
- HT.2.2 is the first non-pure-doc HT.2 sub-phase — preserves pure-doc no-bump convention by being a parser-behavior-change phase rather than a doc-only phase; matches code-reviewer HIGH-2 absorption at HT.2.0 master plan.

### Next

HT.2.3 hooks-discipline-edge sweep (drift-notes 67 + 75; per-phase pre-approval UNCONDITIONAL per architect HIGH-2 absorption at HT.2.0). Part A: `_lib/lock.js withLock` fail-fast vs auto-mkdir parent option-axis fork on drift-note 75. Part B: `session-end-nudge.js` migration from inline lock primitive to `_lib/lock.js` (acquireLock + releaseLock direct usage per fail-soft contract) option-axis fork on drift-note 67.

---

## [unreleased] — 2026-05-10 — HT.2.1 measurement-methodology codification doc (`swarm/measurement-methodology.md` — observed dogfooded practice across 9 case studies + 5 canonical patterns)

**HT.2 first sub-phase. Per-phase pre-approval gate INVOKED per HT.1.10 convention-doc precedent.** Authors `swarm/measurement-methodology.md` (207 LoC) capturing observed dogfooded measurement-methodology practice across 9 case studies (6 active audit-method-and-currency / count-drift + option-axis-conflation drift-notes + 3 in-scope-resolution drift-notes) into a single substrate-internal convention doc. Third convention-doc institutional artifact in the `swarm/` namespace (sibling shape with HT.1.10 path-reference-conventions + HT.2.5 forthcoming soak-gate-readiness readout). **No version bump** per pure-doc convention (matches HT.1.10/HT.1.12/HT.1.15 precedents).

### What landed

- **NEW `swarm/measurement-methodology.md`** (207 LoC) codifies:
  - **9 case studies cohort-first**: active cohort (drift-notes 63 + 64 + 65 + 71 + 72 + 74) → in-scope-resolution cohort (drift-notes 66 + 70 + 76; drift-note 76 spans both as dual-cohort case study)
  - **5 canonical patterns** (APPENDABLE — future drift-notes may add patterns): (1) Inventory-via-grep + per-site classification; (2) Audit-method-and-currency awareness (visual estimate ≠ analytical claim ≠ fence-line empirical + audit-date currency drift); (3) Reference count grounding; (4) Caller-count empirical re-validation (with meta-applicability to pre-approval gates themselves); (5) Option-axis disambiguation
  - **Observed-practice framing** (NOT prescriptive rules) per architect MEDIUM-2 absorption at HT.2.0 — captures existing dogfooded practice, not new institutional invariant
  - **Pre-validation-at-sub-plan-time** observed pattern from HT.1.8-1.15 dogfooded cohort
  - **In-scope-resolution shapes**: reframe (drift-note 70) + already-resolved (66) + pivot (76)
  - **Cross-references** to `swarm/path-reference-conventions.md` + HT-state.md drift-note inventory + 3 BACKLOG.md lightweight entries + 4 ADRs
- **NEW bidirectional cross-references** per architect MEDIUM-2 absorption:
  - `swarm/path-reference-conventions.md` (HT.1.10) → reverse-ref added in "Related work" section
  - `skills/agent-team/BACKLOG.md` (HT.1.6 + HT.1.12 + HT.1.15 lightweight entries) → reverse-refs added

### Drift-note 66 RESOLVED in-scope at HT.2.0 master-plan-pre-approval

Code-reviewer HIGH-1 at HT.2.0 surfaced that drift-note 66 (`commands/research.md` `.full` → `.identity` jq path bug) was ALREADY RESOLVED at HT.1.6 (3-line fix shipped per HT-state.md line 96 + install.sh smoke test 72 closed integration-test gap). HT-state.md drift-note inventory section had documentation lag listing it as outstanding until HT.2.0 master-plan pre-approval. Drift-note inventory shrunk 12 → 11 active drift-notes; 3 in-scope-resolutions (66 + 70 + 76) all documented as case studies 7 + 8 + 9 in measurement-methodology doc.

### Pattern 2 reframe — architect HIGH-1 + code-reviewer HIGH-1 convergent absorption

Pattern 2 originally framed as "LoC measurement disambiguation" (function-span vs file-LoC vs feature-span). Both reviewers caught from different angles that the framing was empirically wrong: code-reviewer HIGH-1 verified `install.sh` is 311 LoC currently and `run_smoke_tests` starts at line 218 (max span 93 lines) — the 537 LoC the audit cited was simply WRONG; the empirical pre-HT.1.4 reality was 1188 LoC monolithic body; architect HIGH-1 noted Pattern 2 didn't actually flow from case study 1's lesson which was audit-count drift, not LoC-scope ambiguity. **Reframed**: Pattern 2 → "Audit-method-and-currency awareness" — name the measurement method (visual estimate ≠ analytical claim ≠ fence-line empirical) AND audit findings have audit-date currency. Case study 1 (drift-note 63) reframed as visual-vs-empirical-method gap. Three case studies map to Pattern 2: drift-notes 63 + 64 + 74.

### Code-reviewer HIGH-2 INVALIDATED — Pattern 4 meta-applicability demonstration

Code-reviewer HIGH-2 reported `validate-adr-drift.js` as missing from the substrate (would have invalidated case study 9's "2 callers" claim). Empirical re-grep across the full substrate confirmed the file exists at `hooks/scripts/validators/validate-adr-drift.js` (code-reviewer searched only `scripts/agent-team/` per Pattern 4 violation: caller files may live anywhere). The Pattern 4 example in the doc explicitly captures this meta-applicability: the canonical patterns apply to pre-approval reviews of the doc itself. 2 callers / 3 call sites empirically confirmed: build-spawn-context.js:77,90 (`invokeNodeJson` + `invokeNodeText`) + validate-adr-drift.js:98 (`invokeNodeJson`).

### Methodology

**Per-phase pre-approval gate INVOKED** per master plan v3.1 + HT.1.10 convention-doc precedent (5/5 triggers fired). 12 FLAGs absorbed single-pass (4 HIGH + 4 MEDIUM + 4 LOW; 1 convergent on Pattern 2 reframe; 1 INVALIDATED on code-reviewer HIGH-2). **Empirical pre-validation pattern is now 9-phase confirmed** (HT.1.8-1.15 + HT.2.1).

### Verification

- **73/73 install.sh smoke** (unchanged from HT.1.15; pure-doc work; no behavior surface affected)
- **46/46 _h70-test.js asserts** (regression check)
- **0 contracts-validate violations** excluding pre-existing 16 baseline
- **Forbidden-phrase gate** on measurement-methodology.md: 0 matches (clean first-pass; validates observed-practice framing per architect MEDIUM-2)

### Plugin manifest

`1.12.0` unchanged (no version bump per pure-doc convention; matches HT.1.10 + HT.1.12 + HT.1.15 precedents per code-reviewer HIGH-2 absorption at HT.2.0).

### Wallclock

~135 min end-to-end: sub-plan + empirical pre-validation ~20 min + parallel pre-approval gate FLAG absorption ~50 min + measurement-methodology.md authoring ~40 min + bidirectional cross-refs ~10 min + verification + cutover ~15 min.

### Pattern-level observations

- **HT.2.1 dogfoods the substrate's measurement-methodology discipline at the pre-approval gate itself** — code-reviewer HIGH-2 was caused by single-directory grep (Pattern 4 violation: scripts/agent-team/ only); empirical re-grep across full substrate (hooks/scripts/validators/ included) confirmed file exists. The doc's Pattern 4 example explicitly captures this meta-applicability.
- **Third convention-doc institutional artifact** in the `swarm/` namespace (HT.1.10 path-conventions + HT.2.1 measurement-methodology + HT.2.5 forthcoming soak-gate-readiness readout); substrate's lightweight-decision-record cohort now 3 BACKLOG.md entries + 2 convention docs = 5 lightweight institutional artifacts across HT.1 + HT.2.1 closing.
- **Fifty-eighth distinct phase shape**: substrate-internal convention doc with observed-practice framing + 9-case-study cohort + APPENDABLE pattern enumeration + dual-cohort case study (drift-note 76 spans active + in-scope-resolution).
- **Convergent FLAG absorption strengthened the case-study + pattern derivation** — both reviewers caught the same root issue from different angles; the convergent finding produced a cleaner reframe than either single reviewer's framing would have.

### Next

**HT.2.2** — `parseFrontmatter` YAML 1.2 inline-comment strip (drift-note 73; extend `scripts/agent-team/_lib/frontmatter.js` to strip YAML inline `#` comments per spec; chaos-test against existing KB + ADR + pattern + persona contract frontmatter; sub-plan only per master plan; consumer-visible parser API behavior change → patch bump 1.12.0 → 1.12.1).

---

## [unreleased] — 2026-05-10 — HT.1.15 _lib/safe-exec.js adoption decision (keep at 2-caller scope + lightweight BACKLOG canonical-pattern entry)

**Hardening Track refactor 15 of N. THIRD and FINAL lightweight institutional decision record per HT.1.6 BACKLOG.md declaration. CLOSES HT.1 backlog top-15 cap.** Documents canonical safe-subprocess pattern + adoption boundary; resolves drift-note 76 in-scope (sibling shape with HT.1.10 drift-note 70). **No version bump** per pure-doc convention (matches HT.1.10/1.12 precedents).

### Changed

- **NEW lightweight BACKLOG.md entry** at `skills/agent-team/BACKLOG.md` between HT.1.12 entry and Phase H.8.4 entry (third `decision-record-pattern: lightweight` entry per HT.1.6 declaration). Documents:
  - Canonical safe-subprocess pattern (array-form `execFileSync('node', [scriptPath, ...args], opts)` via `_lib/safe-exec.js` helper)
  - Adoption boundary table (USE cases vs 6 NON-USE cases enumerated for pattern-recorder + _h70-test + contract-verifier + session-self-improve-prompt + auto-store-enrichment + pre-compact-save)
  - Future-state guidance (3rd caller threshold; API extension via ADR-update gate; deletion threshold ≤1 caller)
  - drift-note 76 resolution-in-scope rationale

- **NO code changes**: pure decision-record + canonical-pattern documentation. `_lib/safe-exec.js` + 2 consumers preserved unchanged.

### Drift-note 76 NEW (captured at sub-plan time + RESOLVED in-scope)

**Title**: HT.0.8 Trajectory.2 helper caller-count overstated vs empirical reality at HT.1.15.

**Source**: HT.0.8 audit + HT.0.9-verify backlog spec cited "1 caller post-H.8.4" for `_lib/safe-exec.js` helper.

**Empirical reality** (HT.1.15): **2 caller files; 3 actual call sites**:

| File | Functions used | Call sites |
|------|----------------|-----------|
| `scripts/agent-team/build-spawn-context.js` | `invokeNodeJson`, `invokeNodeText` | 2 (one per function; wrapped in local `invokeJson` + `invokeKbResolver` thin delegates) |
| `hooks/scripts/validators/validate-adr-drift.js` | `invokeNodeJson` | 1 (wrapped in `_runAdrTouchedBy`) |

Both consumers have `H.8.4: ...safe-exec helper...` provenance comments — both have existed since the helper's creation phase. The HT.0.8 audit's "1 caller" framing was a miscount.

**Sibling cohort with measurement-methodology drift-notes 63 + 64 + 71 + 72 + 74** — **six-instance pattern of audit count drift now established**. HT.2 sweep target to re-validate other HT.0.x finding counts against current empirical state.

**Resolution: in-scope at HT.1.15**. Sibling shape with HT.1.10 drift-note 70 (path-convention finding misframed → conventions ARE intentional context-dependent semantic encoding; convention doc closes documentation gap). drift-note 76 resolves by reframing the helper's appropriate scope (2 callers IS the correct scope; pivot from delete-and-migrate to keep-and-document).

### Decision pivot rationale

**Backlog spec (HT.0.9-verify approved)**: option (a) "delete `_lib/safe-exec.js`; migrate `build-spawn-context.js` to direct `execFileSync` with same array-form semantics".

**Pivot to option (b/c) keep + document** — empirical 2-caller reality flips the math:

- **Code growth on deletion would be net positive (+15-30 LoC)**: 3 call sites × ~5-10 LoC of try/catch + stderr-log + `execFileSync` boilerplate = duplication exceeding the helper's ~70 LoC implementation. The helper IS doing real DRY work at 2-caller scope.
- **Security provenance preservation**: helper was created in response to chaos C1 RCE finding (chaos-20260508-191611-h83-trilogy POC: `--task 'foo $(touch /tmp/PWNED) bar'` triggered RCE).
- **HT.1.8 "extract at 3+ callers" rule asymmetry**: rule guides EXTRACTION; doesn't symmetrically apply to DELETION of existing extractions because deletion adds duplication when ≥2 callers exist.
- **Adoption boundary clarity**: helper's API well-scoped to `node script.js [args]` patterns; other spawnSync sites have bespoke shape that doesn't fit.

### Methodology

**Sub-plan-only** per HT.1.4 + HT.1.6 + HT.1.8 + HT.1.9 + HT.1.10 + HT.1.11 + HT.1.12 + HT.1.14 sub-plan-only precedent (now **9 consecutive sub-plan-only phases since HT.1.7 with HT.1.13 as the only per-phase pre-approval invocation in between**). Per-phase pre-approval gate skipped with EXPLICIT decision rationale matrix per HT.1.6 convention (no fresh design surface — empirical caller-count drives pivot; no schema change; lightweight institutional discipline encoding via BACKLOG entry).

**Empirical pre-validation pattern is now 8-phase confirmed** (HT.1.8-1.15): per-caller-count empirical inventory verified BEFORE sub-plan flips draft → approved.

### Verification

- **73/73 install.sh smoke** (unchanged from HT.1.14; pure-doc work; no behavior surface affected)
- **46/46 _h70-test.js asserts** (regression check)
- **0 contracts-validate violations** excluding pre-existing 16 baseline
- **`_lib/safe-exec.js` + 2 consumers preserved unchanged** (no code changes)

### Why this matters

- **Closes HT.0.8 Trajectory.2 lowest-priority backlog finding** as decision-record (option b/c keep + document)
- **drift-note 76 RESOLVED in-scope** (sibling shape with HT.1.10 drift-note 70) — six-instance audit-count-drift pattern now established (sufficient evidence for HT.2 measurement-methodology codification doc)
- **Closes HT.1 backlog top-15 cap** — third-and-final lightweight BACKLOG decision-record entry per HT.1.6 declaration; HT.2 starts after this phase
- **Empirical pre-validation pattern is now 8-phase confirmed** (HT.1.8-1.15) — pre-cycle resolution shape complete across HT.1.8-1.15 cohort
- **HT.0.9-verify FLAG-5 right-sizing validated empirically across all 3 lightweight BACKLOG entries** (HT.1.6 + HT.1.12 + HT.1.15) — substrate's ADR institutional ledger remains at 4 ADRs total post-HT.1 (would have been 7 ADRs without right-sizing)
- **Fifty-sixth distinct phase shape**: lightweight institutional decision-record + drift-note RESOLVED in-scope + canonical-pattern documentation

### Plugin manifest

`1.12.0` unchanged (no version bump per pure-doc convention; matches HT.1.10 + HT.1.12 precedents).

### HT.1 cumulative reflections (closing the backlog)

- **15 phases shipped** over ~36 hours wallclock cumulatively over 2026-05-10 to 2026-05-11
- **Methodology distribution**: 11 sub-plan-only + 4 per-phase pre-approval gate INVOCATIONS (HT.1.3 + HT.1.5 + HT.1.7 + HT.1.13) + 1 mechanical (HT.1.1) ≈ 73%/27% ratio
- **Empirical pre-validation pattern**: 8 of 15 phases (HT.1.8-1.15) used the gate; ALL 8 surfaced sub-plan-time drift-notes (67-76)
- **Drift-note inventory**: 12 captured for HT.2 sweep (drift-notes 63 + 64 + 65 + 66 + 67 + 68 + 69 + 71 + 72 + 73 + 74 + 75) + 2 RESOLVED in-scope (drift-note 70 at HT.1.10; drift-note 76 at HT.1.15)
- **Plugin manifest progression**: 1.9.0 → 1.9.1 → 1.10.0 → 1.10.1 → 1.11.0 → 1.11.1 → 1.11.2 → 1.11.3 → 1.12.0 (3 minor + 4 patch + 8 unchanged increments)
- **Lightweight BACKLOG decision-record entries shipped**: 3 of 3 planned (HT.1.6 + HT.1.12 + HT.1.15)
- **ADR institutional ledger growth**: ADR-0001 (seed; H.8.2) + ADR-0002 (proposed; HT.1.3) + ADR-0003 (accepted; HT.1.7) + ADR-0005 (accepted; HT.1.13). Three-tier taxonomy introduced at HT.1.13 (technical / governance / editorial)

### Out of scope (deferred)

- **Expand-helper-adoption** to other spawnSync sites — bespoke shapes don't fit helper's contract; deferred indefinitely; HT.2+ sweep candidate ONLY if patterns converge
- **Helper API expansion** (`invokeNodeBinary`, async variant) — YAGNI; current 2-caller use is sufficient; HT.2+ sweep candidate
- **drift-note 75 fix** (`_lib/lock.js` lockfile-parent-dir resilience) — separate substrate primitive; HT.2 sweep candidate (sibling cohort with drift-note 67 + 75)

---

## [unreleased] — 2026-05-10 — HT.1.14 auto-store-enrichment.js subprocess density (batched into in-process call)

**Hardening Track refactor 14 of N.** Replaces 22-spawnSync worst-case in `auto-store-enrichment.js` `bumpSelfImproveCounters` with single in-process `require(SELF_IMPROVE_SCRIPT).bumpBatch(signals)` call. Closes HT.0.1 D.1 most-weighty hooks-layer optimization finding. **No version bump** per pure-refactor convention (matches HT.1.2/HT.1.8/HT.1.9/HT.1.11 precedent).

### Changed

- **NEW programmatic surface in `scripts/self-improve-store.js`**: `bumpBatch(signals)` exported function batches turn counter + per-signal bumps + conditional scan in single Node module load (cached after first call). Single-lock acquisition for counter mutations (better atomicity than 22 separate lock acquisitions); conditional scan acquires its own nested-lock matching `cmdScan` pattern.
- **`module.exports = { bumpBatch, cmdBump, cmdBumpTurn, cmdScan, cmdPending, cmdDismiss, cmdPromote, cmdReset, cmdStats }`** added (9 keys; previously no module.exports).
- **CLI dispatch wrapped in `if (require.main === module)` guard** — `require('./scripts/self-improve-store.js')` does NOT trigger CLI switch dispatch on (always-undefined for require) `process.argv[2]`.
- **`hooks/scripts/auto-store-enrichment.js` `bumpSelfImproveCounters` refactored**: 3 static spawnSync sites (line 243 bump-turn + line 250 loop body up to 20× signal bumps + line 256 conditional scan) → single in-process call. ADR-0001 fail-soft invariant 2 preserved via caller's try/catch + log-on-error + return null on failure.

### Latency improvement

- **Pre-HT.1.14**: 22 sequential spawnSync × ~50-100ms = 1.1-2.2 sec worst-case latency in user-perceptible Stop window
- **Post-HT.1.14**: <50ms first call (module load) + <1ms subsequent (Node require cache hit). Effectively eliminates the latency.

### Drift-note 75 NEW (captured at mid-implementation; lockfile-parent-dir surface)

**Title**: `_lib/lock.js withLock` primitive fails opaquely with timeout-instead-of-ENOENT when lock-file parent directory doesn't exist.

**Surfaced when**: HT.1.14 test 77 fixture used ephemeral HOME tmpdir without pre-creating `~/.claude/checkpoints/`. `withLock` attempted to acquire lock at `tmpdir/.claude/self-improve-counters.json.lock` but failed silently for 3 seconds before "Could not acquire lock... within 3000ms. Aborting." rather than emitting a clear ENOENT-style error.

**Resolution**: HT.1.14 test 77 pre-creates `~/.claude/checkpoints/` in tmpdir before invoking `bumpBatch`. drift-note 75 deferred to HT.2 sweep — additive enhancement to `_lib/lock.js`: either `mkdirSync({recursive: true})` on lockfile parent before acquisition attempt, OR fail clearly with ENOENT detection rather than 3-second timeout.

**Sibling cohort with drift-note 67** (session-end-nudge.js HOOK lock-primitive deferred) — both surface `_lib/lock.js` discipline-edge concerns. HT.2 sweep target.

### Methodology

**Sub-plan-only** per HT.1.4 + HT.1.6 + HT.1.8 + HT.1.9 + HT.1.10 + HT.1.11 + HT.1.12 sub-plan-only precedent (now 8 consecutive sub-plan-only phases since HT.1.7's per-phase pre-approval gate, with HT.1.13 as the exception which INVOKED gate per substantive design surface). Per-phase pre-approval gate skipped with EXPLICIT decision rationale matrix per HT.1.6 convention (no fresh design surface — batched-call shape mechanical; no schema change; no institutional discipline encoding; no HIGH-class bug catchable at design — ADR-0001 invariant 2 protects).

**Empirical pre-validation pattern is now 7-phase confirmed** (HT.1.8 + HT.1.9 + HT.1.10 + HT.1.11 + HT.1.12 + HT.1.13 + HT.1.14): per-spawnSync-site-call-frequency inventory verified BEFORE sub-plan flips draft → approved.

### Verification

- **73/73 install.sh smoke** (+1 NEW HT.1.14 test 77 batch-call-shape validation)
- **46/46 _h70-test.js asserts** (regression check; HT.1.14 doesn't touch agent-identity / its sub-modules)
- **0 contracts-validate violations** excluding pre-existing 16 baseline
- **CLI surface preserved**: `node scripts/self-improve-store.js bump-turn` exits 0 with expected JSON
- **Programmatic surface verified**: `node -e "Object.keys(require('./scripts/self-improve-store.js'))"` returns 9 keys including `bumpBatch`

### Why this matters

- **Closes HT.0.1 D.1 most-weighty hooks-layer optimization finding** — 1.1-2.2 sec worst-case latency reduced to <50ms (single in-process call)
- **Captures drift-note 75** (lockfile-parent-dir discipline-edge; sibling cohort with drift-note 67)
- **Empirical pre-validation pattern is now 7-phase confirmed** (HT.1.8-1.14)
- **CLI surface preserved by design** — `require.main === module` guard
- **Fifty-fifth distinct phase shape**: hooks-layer subprocess-batch optimization via in-process require + programmatic-surface addition

### Plugin manifest

`1.12.0` unchanged (no version bump per pure-refactor convention; matches HT.1.2/HT.1.8/HT.1.9/HT.1.11 precedents — substrate-internal optimization; no consumer-visible behavior change).

### Out of scope (deferred)

- **Extract shared `_scanInternal()` helper** from `cmdScan` to share scan logic with `bumpBatch` (currently scan body is duplicated; HT.2 sweep candidate to extract shared internal helper)
- **`_lib/lock.js` lockfile-parent-dir resilience** (drift-note 75; HT.2 sweep candidate)
- **Direct unit tests for `bumpBatch`** (deferred; install.sh integration test 77 covers behavior preservation)

---

## [1.12.0] — 2026-05-10 — HT.1.13 Slopfiles authoring discipline + ADR-0005 + rules/core refactor

**Hardening Track refactor 13 of N.** Adopts `<important if "task involves X">...</important>` block-marker convention for always-on context surfaces (`rules/core/*.md`); authors ADR-0005 codifying slopfiles authoring discipline as substrate primitive (THIRD load-bearing ADR after ADR-0002 + ADR-0003). Closes HT.0.8 Size.3 most-weighty cross-cutting finding (always-on rules tax). Plugin manifest `1.11.3 → 1.12.0` (minor — additive substrate primitive + 2 NEW substrate-meta architecture docs).

### Changed

- **NEW ADR-0005**: `swarm/adrs/0005-slopfiles-authoring-discipline.md` — codifies slopfiles authoring discipline as substrate primitive. Ships at `status: accepted` directly per HT.1.7 precedent (per-phase pre-approval gate IS the acceptance ceremony; transient `proposed` introduces test-timing-window risk). 3 invariants: safety-critical content + authoring discipline (new content presumptively conditional) + predicate-vocabulary curation gate. Editorial-tier ADR distinct from ADR-0001 (technical) + ADR-0003 (governance) — INTRODUCES three-tier ADR taxonomy.

- **rules/core/ partitioning** (per ADR-0005 invariant 1: safety-critical content invariant):
  - `security.md` (29 LoC; **fully core-always** — security guardrails universally apply)
  - `research-mode.md` (15 LoC; **fully core-always** — factual-claim discipline universally applies)
  - `fundamentals.md` (58 LoC → 62 LoC with markup; ~51 LoC core-always: Immutability + Core Principles + SOLID + File Organization + Error Handling + Input Validation + Naming; ~7 LoC conditional Pre-Completion Checklist wrapped in `<important if "task involves multi-file changes (≥2 distinct files) or task is at completion">`). File Organization sizing kept core-always per architect MEDIUM-4 absorption (applies to single-file authoring too).
  - `prompt-enrichment.md` (32 → 20 LoC; Sub-Agent Awareness ~3 LoC core-always; "When vague" workflow ~9 LoC wrapped in `<important if "task involves user-prompt-vagueness handling">`; Vagueness Detection Gate substrate-meta description migrated OUT to `swarm/architecture-substrate/prompt-enrichment-architecture.md`)
  - `self-improvement.md` (60 → 38 LoC; Gap Detection + Throttle + Session-End Review + Pre-Compact Awareness ~15 LoC core-always; Forging Procedure ~7 LoC wrapped in `<important if "task involves Memory→Rule promotion or skill forge">`; Auto-loop infrastructure substrate-meta description migrated OUT to `swarm/architecture-substrate/auto-loop-infrastructure.md`)
  - `workflow.md` (128 → 170 LoC including markup; ~3 LoC always-on intro; ~125 LoC functional content wrapped across 9 H2 sections under 9 unique predicates from 13-predicate starter vocabulary)

- **NEW substrate-meta architecture namespace** at `swarm/architecture-substrate/`:
  - `auto-loop-infrastructure.md` — H.4.1 hook coordination + threshold-based auto-promotion + CLI surface
  - `prompt-enrichment-architecture.md` — vagueness detection gate + skip patterns + pattern-store auto-apply substrate
  - Sibling cohort with `swarm/path-reference-conventions.md` (HT.1.10) — substrate-internal institutional architecture namespace, distinct from `skills/agent-team/kb/architecture/` (canonical knowledge) and `swarm/adrs/` (decision records)

### 13-predicate starter vocabulary (per ADR-0005 invariant 3)

Original 12 predicates + "task involves substrate-meta work" added per architect HIGH-3 absorption (workflow.md H.7.16/H.7.18 sections needed substrate-meta predicate). Vocabulary extensions go through ADR-update or code-review gate.

### Drift-note 74 NEW (captured at sub-plan time via empirical pre-validation)

**Title**: HT.0.8 always-on rules LoC count overstated vs empirical reality at HT.1.13.

**Source**: HT.0.8 audit + HT-state.md cite "228 LoC ~3.5K tokens" across `rules/core/*.md` 6 files.

**Empirical reality** (HT.1.13): **322 LoC** (+94 LoC; +41% understatement). Per-file: fundamentals (58) + prompt-enrichment (32) + research-mode (15) + security (29) + self-improvement (60) + workflow (128) = 322. Token estimate 322 × ~12 tokens/LoC ≈ 3870 tokens.

**Root cause**: workflow.md likely grew via H.7.x additions post-2026-05-09 audit (H.7.5 Route-Decision detail; H.7.9 Plan Mode/HETS-aware; H.7.18 markdown emphasis; H.7.19 Hook layer placement; H.7.22-H.7.23 Pre-approval verification + schema-level questions). Most H.7.x additions touched workflow.md as the substrate-discipline ledger.

**Sibling cohort with drift-notes 63 + 64 + 71 + 72** — five-instance pattern of audit measurement-methodology drift now established (function span detection HT.1.4 + LoC counting HT.1.5 + static-vs-dynamic regex classification HT.1.11 + forward-reference count HT.1.12 + always-on-rules LoC HT.1.13). HT.2 sweep candidate: re-validate other HT.0.x finding counts against current empirical state.

### Per-phase pre-approval gate INVOKED (architect + code-reviewer parallel)

Both reviewers returned APPROVED-with-revisions. **6 HIGH + 11 MEDIUM + 7 LOW FLAGs absorbed single-pass**; 2 HIGH FLAGs convergent across both reviewers:

- **Convergent HIGH (path)**: KB destination `kb/architecture/substrate/` doesn't exist (architect HIGH-1) + KB taxonomy mismatch (architect HIGH-2) → pivoted to `swarm/architecture-substrate/` matching HT.1.10 path-conventions doc precedent
- **Convergent HIGH (status)**: ADR-0005 ships at `status: proposed` would create test-timing-window failure (architect HIGH-4 + code-reviewer FLAG-2) → flipped to `accepted` directly per HT.1.7 precedent
- Architect HIGH-3: predicate vocabulary missing substrate-meta — added 13th predicate
- Code-reviewer FLAG-1 (HIGH): LoC accuracy in fundamentals.md split — recounted empirically; File Organization kept core-always per architect MEDIUM-4
- 11 MEDIUM + 7 LOW FLAGs absorbed inline (invariant 4 dropped — meta-statement; editorial-tier framing added; token estimate methodology reframed to deterministic floor; rollback shape revised; markdownlint compat note added; etc.)

Drift-note 40 codification value is now **9th consecutive phase** (per-phase pre-approval gate continues to pay across all load-bearing-ADR phases: HT.1.3 ADR-0002 + HT.1.5 + HT.1.7 ADR-0003 + HT.1.13 ADR-0005).

### Methodology

Per-phase pre-approval gate INVOKED with EXPLICIT decision rationale matrix per HT.1.6 convention. 5/5 triggers fired (substrate-fundament schema change INDIRECT + fresh design surface YES + institutional discipline encoding YES + multi-file coordination PARTIAL + HIGH-class bug catchable at design YES — safety-critical content boundary). Empirical pre-validation pattern is now **6-phase confirmed** (HT.1.8 + HT.1.9 + HT.1.10 + HT.1.11 + HT.1.12 + HT.1.13) — surfaced drift-note 74 at sub-plan time before implementation.

### Verification

- **72/72 install.sh smoke** (+2 NEW HT.1.13 tests: test 75 ADR-0005 accepted [count ≥ 2; includes ADR-0005] + test 76 `<important if>` block-marker count target band ≥ 8 ≤ 14)
- **46/46 _h70-test.js asserts** (regression check; HT.1.13 doesn't touch agent-identity / its sub-modules)
- **0 contracts-validate violations** excluding pre-existing 16 baseline
- **ADR-0005 active for drift detection**: `adr.js touched-by rules/core/workflow.md` returns ADR-0005 with all 3 invariants
- **markdownlint compatibility**: `MD033: false` already disabled in `.markdownlint.json` per code-reviewer FLAG-4 — `<important if>` block-marker syntax does not trigger MD033

### Token-tax reduction estimate (per architect MEDIUM-5 absorption — methodology reframed)

- **Deterministic floor (substrate-author-side)**: ~17% always-on reduction (~660 tokens/session always saved via out-of-rules migration of ~55 LoC substrate-meta content; independent of LLM compliance with `<important if>`)
- **Best-effort upside (LLM-side)**: ~46% with full LLM compliance with `<important if>` predicates (~1810 tokens/session); realistic compliance rate unmeasured (HT.2 sweep candidate adds observability)
- **Combined ceiling**: ~63% with full compliance

### Why this matters

- **Closes HT.0.8 Size.3 most-weighty cross-cutting finding** (always-on rules tax — first substrate-side response)
- **Captures drift-note 74** (HT.0.8 LoC count overstated; sibling cohort with 63 + 64 + 71 + 72)
- **THIRD load-bearing ADR introduced**: editorial-tier ADR taxonomy distinct from technical/governance — substrate now operates 3-tier ADR ledger
- **Empirical pre-validation pattern is now 6-phase confirmed** (HT.1.8-1.13)
- **NEW `swarm/architecture-substrate/` namespace** for substrate-meta institutional architecture documentation (sibling cohort with HT.1.10 path-reference-conventions doc)
- **Forward-looking primitive readiness**: if Claude Code adds native `<important if>` parsing, substrate is already prepared
- **Fifty-fourth distinct phase shape** in the HT track: slopfiles authoring discipline + editorial-tier ADR + substrate-meta out-of-rules migration + drift-note 74 captured at sub-plan time

### Plugin manifest

`1.11.3 → 1.12.0` (minor — additive substrate primitive: slopfiles authoring discipline + 2 NEW substrate-meta architecture docs). Rules-content shape is NOT versioned as public surface in this substrate's semver convention; user-facing API is CLI/hooks/scripts. Per architect MEDIUM-6 absorption.

### Out of scope (deferred)

- **Per-project rules layer** (`rules/typescript/`, `rules/web/`) — already project-conditional via Claude Code's rules layer; not auto-loaded into unrelated sessions
- **`~/.claude/projects/<project>/memory/MEMORY.md`** user-memory layer — different surface; out of scope
- **Automated lint enforcement of `<important if>` block-marker syntax** — HT.2 sweep candidate
- **LLM compliance rate measurement** for `<important if>` predicates — HT.2 sweep candidate (adds observability for conditional-section-not-applied counter)
- **Migration of additional always-on context surfaces** (CLAUDE.md project-level imports, etc.) — HT.2+ candidate

---

## [1.12.0-pre] — 2026-05-10 — HT.1.12 Architecture KB forward-reference resolution

**Hardening Track refactor 12 of N.** Annotates 7 broken `related:` forward references across 5 of 10 architecture KBs to 5 unique non-existent `kb_id` targets via body-section migration per `react-essentials.md` precedent. Closes HT.0.5a E.1 most-weighty finding (bidirectional `related:` validator skips broken refs because targets don't exist). **No version bump** per pure-doc convention (matches HT.1.10 precedent).

### Changed

- **5 architecture KBs frontmatter cleanup + body section migration**: removed broken refs from `related:` arrays + added new H2 body section `## Related KB docs (planned, not yet authored)` before the `## Phase` postscript in each affected file:
  - `kb/architecture/ai-systems/rag-anchoring.md` — 3 forward refs (agent-design + evaluation-under-nondeterminism + inference-cost-management)
  - `kb/architecture/crosscut/deep-modules.md` — 1 forward ref (information-hiding)
  - `kb/architecture/crosscut/dependency-rule.md` — 1 forward ref (information-hiding)
  - `kb/architecture/discipline/error-handling-discipline.md` — 1 forward ref (refusal-patterns)
  - `kb/architecture/discipline/trade-off-articulation.md` — 1 forward ref (refusal-patterns)

- **NEW BACKLOG.md `decision-record-pattern: lightweight` entry** at `skills/agent-team/BACKLOG.md` — second of 3 planned lightweight BACKLOG entries per HT.1.6 declaration (sibling: HT.1.6 documentary persona class + HT.1.15 helper-deletion canonical pattern). Documents the deferred-author-intent shape (body-section migration; H2 for KBs with existing `related:` graphs vs H3 for KBs without; migration discipline when planned KB is authored).

### Drift-note 72 NEW (captured at sub-plan time via empirical pre-validation)

**Title**: HT.0.5a forward-reference count overstated vs empirical reality at HT.1.12 implementation.

**Source**: HT-state.md cutover claim "11 broken refs across 7 of 10 architecture KBs to 8 non-existent kb_id targets."

**Empirical reality** (post-empirical-pre-validation):
- **7 broken refs across 5 of 10 architecture KBs to 5 unique non-existent kb_id targets**
- Affected KBs: rag-anchoring (3), deep-modules (1), dependency-rule (1), error-handling-discipline (1), trade-off-articulation (1)
- Unique planned-but-unauthored targets: agent-design, evaluation-under-nondeterminism, inference-cost-management, information-hiding, refusal-patterns

**Root cause**: either HT.0.5a count miscounted, or the architecture tree shape changed between 2026-05-09 audit and 2026-05-10 implementation.

**Sibling cohort with drift-notes 63 + 64 + 71** (measurement-methodology codification target for HT.2): four convergent layers of audit measurement-methodology gap now captured: drift-note 63 = function span detection (HT.1.4), drift-note 64 = LoC counting + 3-layer convergent measurement gap (HT.1.5), drift-note 71 = static-vs-dynamic regex classification (HT.1.11), drift-note 72 = forward-reference count overstated (HT.1.12).

### Drift-note 73 NEW (captured at mid-implementation; inline-comment annotation pivot)

**Title**: `parseFrontmatter` (`scripts/agent-team/_lib/frontmatter.js`) does not strip YAML inline `#` comments per YAML 1.2 spec; comments contaminate ref-string values in parser output.

**Surfaced when**: initial HT.1.12 attempt at frontmatter inline annotations (`  - architecture/ai-systems/agent-design  # planned — not yet authored`) was tested via `parseFrontmatter` roundtrip and the output ref-string included the inline comment text (`'architecture/ai-systems/agent-design  # planned — not yet authored'` instead of clean kb_id).

**Resolution**: pivoted from frontmatter inline annotation to body-section migration (Approach B per `react-essentials.md` precedent). Drift-note 73 deferred to HT.2 sweep candidate: extend `parseFrontmatter` to strip inline `#` comments per YAML 1.2 (additive enhancement; chaos-test the change against existing KB + ADR + pattern frontmatter to verify no regression).

### Implementation observation

**Mid-implementation encoding-shape pivot**: empirical pre-validation correctly confirmed inventory + scope (5 affected files; 7 broken refs; 5 unique targets) at sub-plan time but did NOT validate parser-behavior assumptions. The inline-comment encoding intent assumed YAML 1.2 parser behavior; the substrate's hand-rolled `parseFrontmatter` subset parser does not implement comment stripping. Pivot from inline-comment to body-section took ~10 min (5 file reverts + 5 body-section additions in parallel; scope confirmation already done by pre-validation; only encoding shape changed).

**Pattern-level observation**: empirical pre-validation catches PLAN-VS-REALITY drift; 3-tier verification + parse roundtrip catches IMPLEMENTATION-VS-PLAN drift (HT.1.11 JSDoc comment-containment bug; HT.1.12 inline-comment pollution). BOTH layers are needed for clean execution. The HT.1.12 pivot was efficient because pre-validation had already confirmed scope; only encoding needed to change.

### Methodology

**Sub-plan-only** per HT.1.4 + HT.1.6 + HT.1.8 + HT.1.9 + HT.1.10 + HT.1.11 sub-plan-only precedent (now 7 consecutive sub-plan-only phases since HT.1.7's per-phase pre-approval gate). Pure-doc work against well-bounded empirical inventory; no fresh design surface (annotation shape established by `react-essentials.md` precedent); no schema change (YAML/markdown structure preserved); lightweight institutional discipline encoding (BACKLOG entry, not ADR). Per-phase pre-approval gate skipped with EXPLICIT decision rationale matrix.

**Empirical pre-validation pattern is now 5-phase confirmed** (HT.1.8 + HT.1.9 + HT.1.10 + HT.1.11 + HT.1.12): per-export / per-file / file-existence / per-site-static-vs-dynamic / per-ref-existence inventory verified BEFORE sub-plan flips draft → approved. All 5 phases surfaced sub-plan-time findings (drift-notes 67 + 68 + 69 + 70 + 71 + 72) that refined scope or methodology vs the audit framing. Pattern naming candidate (HT.2 sweep target): "empirical pre-validation gate."

### Verification

- **70/70 install.sh smoke tests** (unchanged from HT.1.11; pure-doc work; no behavior surface affected)
- **46/46 _h70-test.js asserts** (regression check; HT.1.12 doesn't touch agent-identity / its sub-modules)
- **0 contracts-validate violations** excluding pre-existing 16 baseline
- **YAML parse roundtrip verified clean** on all 5 affected files (32 real kb_ids in tree; 0 broken refs across architecture KB frontmatters post-edit; 0 comment-polluted refs)

### Why this matters

- **Closes HT.0.5a E.1 most-weighty finding** (bidirectional validator skips broken refs)
- **Captures drift-note 72** (HT.0.5a count overstated; sibling cohort with drift-notes 63 + 64 + 71 — measurement-methodology codification target)
- **Captures drift-note 73** (parseFrontmatter doesn't strip YAML inline comments — substrate-discipline-edge finding)
- **Empirical pre-validation pattern is now 5-phase confirmed** (HT.1.8-1.12)
- **Second lightweight BACKLOG decision-record entry** per HT.1.6 declaration (sibling cohort with HT.1.6 + HT.1.15)
- **Body-section migration** per `react-essentials.md` precedent extends the deferred-author-intent shape from web-dev to architecture KB class
- **Fifty-third distinct phase shape** in the HT track: KB forward-reference resolution + body-section deferred-author-intent shape + 2 drift-notes (72 + 73)

### Plugin manifest

`1.11.3` unchanged (no version bump per pure-doc convention; matches HT.1.10 precedent).

### Out of scope (deferred)

- **Authoring the 5 planned-but-unauthored KB docs** (agent-design + evaluation-under-nondeterminism + inference-cost-management + information-hiding + refusal-patterns) — deferred to post-Hardening Track per HT.1.12 backlog spec
- **Bidirectional `related:` validator extension to KB docs** — currently scoped to pattern files via `pattern-related-bidirectional` validator at `contracts-validate.js:187`; HT.2 sweep candidate
- **`parseFrontmatter` extension to strip YAML inline `#` comments** — drift-note 73; HT.2 sweep candidate (additive enhancement)
- **Cross-subtree forward-reference scan** (backend-dev / data-dev / hets / infra-dev / ml-dev / mobile-dev / security-dev / web-dev) — survey may reveal sibling broken refs; HT.2 sweep candidate

---

## [1.12.0-pre] — 2026-05-10 — HT.1.11 Per-call regex compilation cleanup

**Hardening Track refactor 11 of N.** Targeted optimization across 6 sites with empirical-pre-validation-driven scope refinement. Closes HT.0.1 + HT.0.2 + HT.0.4 per-call regex compilation findings as targeted optimization (6 sites with actual migration value) rather than blanket sweep (would have over-applied to 3 Tier 4 sites without value). **No version bump** per pure-refactor convention (matches HT.1.2 + HT.1.8 + HT.1.9 precedents).

### Changed

- **Tier 1 (1 site; STATIC pattern promoted to module-top const)**: `scripts/agent-team/verify-plan-spawn.js` — `appendSection` previously created `new RegExp(...)` per call with a fully-static pattern (no template variables); now uses module-top regex literal `const PRE_APPROVAL_RE = /\n## Pre-Approval Verification[\s\S]*?(?=\n## |$)/g;`. Reset `lastIndex = 0` before `.test()` because `/g` flag retains state across consecutive calls on the same regex instance.

- **Tier 2 (1 site; HOT memoization)**: `scripts/agent-team/route-decide.js` — `buildKeywordRegex` now memoizes by keyword key in module-scope `Map`. Previously recompiled regex on every call; `scoreTask` invokes ~90× per call (9 dims × ~10 keywords). Keyspace is bounded (~100 unique keywords across all KEYWORDS dims + SUBSTRATE_META_TOKENS). Memoization eliminates per-call compile after first invocation. Behavior unchanged.

- **Tier 3 (4 sites; consistency win across validator family)**: section-name regex memoization with module-scope `Map` cache:
  - `hooks/scripts/validators/validate-plan-schema.js` `hasH2Heading` — memoize section regex by sectionName
  - `hooks/scripts/validators/validate-kb-doc.js` `hasH2Section` — memoize section regex by sectionName
  - `hooks/scripts/validators/verify-plan-gate.js` `hasH2Heading` — memoize section regex by sectionName
  - `scripts/agent-team/kb-resolver.js` `extractSections` — extract `_getSectionRe` helper memoizing both startName + endName regexes by name
  Each site keeps its own per-module cache (per HT.1.8 "extract at 3+ callers" rule, 4 callers IS the threshold for shared `_lib/regex-cache.js` extraction — but extraction adds module-boundary indirection; deferred to HT.2 sweep candidate to keep HT.1.11 scope mechanical).

### Drift-note 71 NEW (captured at sub-plan time via empirical pre-validation)

**Title**: HT.0.1 + HT.0.2 + HT.0.4 "9 sites with per-call regex compilation" finding misframed; only 6 sites have migration value

**Source**: HT.0.1 audit listed 5 hook-layer sites (validate-plan-schema, verify-plan-gate, validate-kb-doc, auto-store-enrichment, prompt-enrich-trigger); HT.0.2 listed `route-decide.js scoreTask`, `pattern-runner.js extractScenarios`, `kb-resolver.js extractSections`; HT.0.4 listed 4 sites in `contract-verifier.js`. Total ≥12 sites in audit framing.

**Empirical reality** (post-empirical-pre-validation):
- 1 site is STATIC (verify-plan-spawn.js — clear migration value; not even in original audit list)
- 1 site is HOT dynamic (route-decide.js buildKeywordRegex — biggest win; in HT.0.2 list)
- 4 sites are lukewarm dynamic (validate-plan-schema + validate-kb-doc + verify-plan-gate + kb-resolver — section-name memoization opportunity; consistency win)
- 3 sites are NOT per-call (prompt-enrich-trigger module-level + config-guard config-load + contract-verifier:223 small keyspace; HT.0.4 sites 300/392/409 use static regex literals not `new RegExp()`)

**Sibling cohort with drift-notes 63 + 64** (measurement-methodology codification target for HT.2): three convergent layers of audit measurement-methodology gap now captured: drift-note 64 = LoC counting; drift-note 63 = function span detection; drift-note 71 = static-vs-dynamic regex classification.

### Implementation observation

**JSDoc comment-containment caught at implementation time**: my edit pattern initially placed a memoization cache definition INSIDE an unclosed `/**` JSDoc block in `validate-kb-doc.js` (the cache was swallowed by the comment; runtime ReferenceError caused fail-open per ADR-0001 invariant 2; test 66 caught it via `decision=approve marker=False`). Fixed by closing the block before insertion.

**Pattern-level observation**: empirical pre-validation eliminates PLAN-VS-REALITY drift-notes (audit framing accuracy) but doesn't catch IMPLEMENTATION-LEVEL bugs in the edit itself (like JSDoc comment-containment). A clean pre-validation phase doesn't guarantee 100% green first-pass at implementation — it ensures the plan is correct. The 3-tier verification (install.sh smoke + _h70-test + contracts-validate) is the safety net for implementation-level bugs. ADR-0001 fail-open invariant 2 prevented the bug from breaking sessions; test 66 caught it deterministically.

### Methodology

**Sub-plan-only** per HT.1.2 + HT.1.4 + HT.1.6 + HT.1.8 + HT.1.9 + HT.1.10 sub-plan-only precedent (now 6 consecutive sub-plan-only phases since HT.1.7's per-phase pre-approval gate). Mechanical refactor against well-bounded empirical inventory; no fresh design surface; no schema change; no institutional discipline encoding. Per-phase pre-approval gate skipped with EXPLICIT decision rationale matrix.

**Empirical pre-validation pattern is now 4-phase confirmed** (HT.1.8 + HT.1.9 + HT.1.10 + HT.1.11): per-export / per-file / file-existence / per-site-static-vs-dynamic inventory verified BEFORE sub-plan flips draft → approved. All 4 phases surfaced sub-plan-time findings that refined scope vs the audit framing. Pattern naming candidate (HT.2 sweep target): "empirical pre-validation gate."

### Verification

- **70/70 install.sh smoke tests** (unchanged from HT.1.10; 1-test-failure caught + fixed mid-implementation due to JSDoc comment-containment bug; final 70/70 green)
- **46/46 _h70-test.js asserts** (regression check; CRITICAL — exercises route-decide.js scoreTask via `_lib/route-decide-export.js` → `identity/trust-scoring.js`; behavior preservation verified)
- **0 contracts-validate violations** excluding pre-existing 16 baseline
- **6-site CLI smoke**: route-decide.js (memoized buildKeywordRegex returns recommendation), kb-resolver.js (extractSections preserves output for cat-summary), verify-plan-spawn.js (PRE_APPROVAL_RE module-top const loads cleanly)

### Why this matters

- **Closes HT.0.1 + HT.0.2 + HT.0.4 per-call regex findings** as targeted optimization (6 sites with value vs 9-12 in audit framing)
- **Captures drift-note 71** (audit framing vs empirical reality gap; sibling cohort with drift-notes 63 + 64)
- **Empirical pre-validation pattern is now 4-phase confirmed** (HT.1.8-1.11)
- **Tier 2 memoization addresses the hot site** (route-decide.js buildKeywordRegex ~90×/scoreTask)
- **Tier 3 memoization adds consistency** across the validator family (4 sites)
- **Fifty-second distinct phase shape** in the HT track: per-call regex compilation cleanup with empirical-pre-validation-driven scope refinement + drift-note 71 captured at sub-plan time + JSDoc comment-containment caught + fixed at implementation time

### Plugin manifest

`1.11.3` unchanged (no version bump per pure-refactor convention).

### Out of scope (deferred)

- **prompt-enrich-trigger.js, config-guard.js, contract-verifier.js:223** — Tier 4 sites; not per-call dynamic in steady state
- **Shared `_lib/regex-cache.js` extraction** — 4 callers IS the HT.1.8 "extract at 3+ callers" threshold; HT.2 sweep candidate to extract a shared utility
- **`pattern-runner.js extractScenarios`** — uses static section-header regex literal; not per-call dynamic
- **`auto-store-enrichment.js`** — uses static regex literals; not per-call dynamic
- **`adr.js per-call full-tree read`** — different concern (file I/O caching); HT.2+ candidate
- **`contracts-validate.js 4× pattern-file reads`** — different concern (file I/O caching); HT.2+ candidate

---

## [1.11.3] — 2026-05-10 — HT.1.10 Path-convention consolidation (convention doc only)

**Hardening Track refactor 10 of N.** Convention doc authoring per `decision-record-pattern: lightweight` shape — closes HT.0.3 + HT.0.4 + HT.0.5a path-convention findings as documentation rather than code change. Empirical pre-validation per HT.1.8/1.9 dogfooded pattern reveals that the apparent "5-convention inconsistencies" are intentional context-dependent semantic encoding (drift-note 70). Scope reduces from "convention doc + 8+ site sweep" to "convention doc only."

### Added

- **NEW `swarm/path-reference-conventions.md`** (203 LoC) — codifies the 5 path conventions in use across substrate documentation, commands, persona MDs, and KB docs:
  1. **Repo-relative** (`scripts/agent-team/X.js`) — for ADR `files_affected`, persona contract `kb_scope`, internal substrate references
  2. **Hardcoded author-machine** (`~/Documents/claude-toolkit/X`) — for source-only files (e.g., `swarm/hierarchical-aggregate.js`, `swarm/personas-contracts/*.json`, `swarm/run-state/`); persona MD instructions executing on author's machine; documentation of source location
  3. **`$HOME`-aware** (`$HOME/Documents/claude-toolkit/X`) — for slash-command bash where `~` expansion is unreliable (per HT.1.5-verify code-reviewer Q4 HIGH catch); used in `commands/build-team.md`, `build-team-helpers.sh`
  4. **Relative path** (`../`) — for cross-internal documentation references (file-to-sibling)
  5. **Deployed-marketplace** (`~/.claude/X`) — for runtime invocation of deployed install (e.g., compliance-probe; testing deployed hook behavior); both-locations-write pattern in forge.md/evolve.md
- Decision tree for "which convention applies?"
- Examples from `commands/chaos-test.md`, `swarm/personas/02-confused-user.md`, `commands/build-team.md`, `swarm/personas/04-architect.md` showing correct context-dependent usage
- Documentation of `findToolkitRoot()` runtime resolution as the substrate-script counterpart to documentation conventions
- "What this DOES NOT prescribe" section closing the multi-machine portability + automated lint enforcement out-of-scope items

### Drift-note 70 RESOLVED

**Title**: HT.1.10 "5 path conventions" finding was misframed as needing a sweep — empirical pre-validation reveals the conventions are intentional context-dependent semantic encoding.

**Resolution**: HT.0.3 + HT.0.4 + HT.0.5a "5 path conventions" finding hereby reclassified from "consolidation candidate" / "needs sweep" to "documentation gap (now closed)." The 5 conventions are intentional: source-only files MUST use source paths (e.g., `swarm/hierarchical-aggregate.js` does NOT exist at `~/.claude/swarm/...`); deployed-and-source files can use deployed paths for runtime invocation; documentation references the actual file location regardless. Future audits framing the conventions as "inconsistency" should consult `swarm/path-reference-conventions.md` rather than recommending sweep.

### Methodology

**Sub-plan-only** per HT.1.6 BACKLOG.md `decision-record-pattern: lightweight` precedent (this is the second lightweight decision record after HT.1.6's documentary persona class entry); convention doc has institutional weight without ADR-system-bloat. No fresh design surface beyond documentation framing; no code changes; no schema change. Per-phase pre-approval gate skipped with EXPLICIT decision rationale matrix.

**Empirical pre-validation pattern is now 3-phase confirmed** (HT.1.8 + HT.1.9 + HT.1.10): per-export consumer counts / per-file inventory verified BEFORE sub-plan flips draft → approved. Surfaced drift-note 70 + scope reduction at sub-plan time rather than during-implementation discovery; 100% green first-pass verification. Pattern naming candidate (HT.2 sweep target): "empirical pre-validation gate" — institutional discipline for sweep-style refactors.

### Verification

- **70/70 install.sh smoke tests** (unchanged from HT.1.9 — no code changes; convention doc only)
- **46/46 _h70-test.js asserts** (regression check)
- **0 contracts-validate violations** excluding pre-existing 16 baseline
- **Convention doc 203 LoC** (slightly over 100-200 target due to comprehensive examples + decision tree; load-bearing for institutional documentation)

### Why this matters

- **Closes HT.0.3 + HT.0.4 + HT.0.5a path-convention findings** as documentation (not code change)
- **Captures + resolves drift-note 70** (the convention finding was misframed as needing a sweep; pre-validation reveals it's a documentation gap)
- **Empirical pre-validation pattern is now 3-phase confirmed** (HT.1.8 + HT.1.9 + HT.1.10 all surfaced meaningful sub-plan findings via empirical smoke before sub-plan finalization); forward-looking institutional discipline for sweep-style refactors
- **Lightweight institutional decision record** per HT.1.6 BACKLOG.md `decision-record-pattern: lightweight` precedent (second-of-3 planned across HT.1; sibling: HT.1.6 documentary persona class + HT.1.10 this doc + HT.1.12 deferred-author-intent or HT.1.15 helper-deletion canonical pattern per HT.0.9-verify FLAG-5 right-sizing)
- **Fifty-first distinct phase shape** in the HT track: convention doc authoring + drift-note-driven scope reduction + lightweight institutional decision record

### Plugin manifest

`1.11.2 → 1.11.3` (patch — additive substrate convention doc; no behavior change visible to consumers).

### Out of scope (deferred)

- **Multi-machine portability migration** (out of scope; not currently a substrate goal; HT.2+ candidate)
- **Automated lint enforcement of the convention** (HT.2+ sweep candidate)
- **Per-file migration of persona MDs / KB docs to runtime-resolved paths** (out of scope; substrate scripts already use `findToolkitRoot()` at runtime)

---

## [unreleased] — 2026-05-10 — HT.1.9 Speculative-API exports cleanup sweep

**Hardening Track refactor 9 of N.** Mechanical sweep converging substrate export-surface — drops 21 speculative-API exports across 7 files. Closes HT.0.1 D-finding (3 hooks/_lib/ modules with 7 speculative exports) + HT.0.2 D-finding (4 substrate scripts with 0-consumer module.exports) + HT.0.6 E-finding (`adr.js` exports with 0 external callers). **No version bump** per pure-refactor convention (matches HT.1.2 + HT.1.8 precedents).

### Changed

- **4 standalone substrate scripts — DROPPED `module.exports` block entirely** (14 named exports; 0-consumer per empirical pre-validation; all used internally only):
  - `scripts/agent-team/verify-plan-spawn.js` — dropped 3 exports (`buildSection`, `appendSection`, `PRE_APPROVAL_HEADER`)
  - `scripts/agent-team/adr.js` — dropped 3 exports (`loadAllAdrs`, `isActive`, `findAdrById`); `validate-adr-drift.js` consumes adr.js via subprocess CLI `touched-by`, NOT via require
  - `scripts/agent-team/build-spawn-context.js` — dropped 3 exports (`buildContext`, `formatText`, `formatJson`)
  - `scripts/agent-team/architecture-relevance-detector.js` — dropped 5 exports (`detect`, `detectSignals`, `combineRefs`, `recommendTier`, `ROUTING_RULES`); test 57 in tests/smoke-h8.sh invokes via CLI subprocess `list-signals`, NOT via require

- **3 hooks/_lib/ modules — PRUNED `module.exports`** (7 speculative exports dropped; 5 actually-consumed exports preserved as public API; speculative definitions remain as module-scope for internal use):
  - `hooks/scripts/_lib/file-path-pattern.js` — kept `extractFilePaths` (2 consumers); dropped `UNIX_PATH`, `WINDOWS_PATH`, `QUOTED_PATH` (used internally only by `extractFilePaths` lines 51-53)
  - `hooks/scripts/_lib/marketplace-state-reader.js` — kept `getMirrorRoot`, `getMirrorAgeDays` (1 consumer each); dropped `getMirrorHeadTimestamp` (used internally by `getMirrorAgeDays` line 73), `DEFAULT_MARKETPLACE_NAME` (used internally by `getMirrorRoot` line 31)
  - `hooks/scripts/_lib/settings-reader.js` — kept `isPluginEnabled`, `getRegisteredMarketplaces` (1 consumer each); dropped `readSettings` (used internally by both kept functions), `SETTINGS_PATH` (used internally by `readSettings` line 28)

### Drift-note 68 (NEW; deferred to HT.2 sweep)

**Title**: `contracts-validate.js:53` `SETTINGS_READER` constant is dead code

**Source**: HT.1.9 empirical pre-validation surfaced this — `contracts-validate.js:51-53` defines `const SETTINGS_READER = path.join(...)` with header comment "settings-reader for the new contract-plugin-hook-deployment validator" but never `require()`s the constant. The header claim "Used by ... contracts-validate.js" in `settings-reader.js:3` is documentary lie.

**Why deferred**: out of HT.1.9 scope (HT.1.9 is about converging EXPORTS, not pruning DEAD CONSUMER CODE). HT.2 sweep target — adds to drift-notes 63 + 64 + 65 + 66 + 67 + 69 cohort.

### Drift-note 69 (NEW; deferred to HT.2 sweep)

**Title**: `settings-reader.js:3` header comment references retired `plugin-loaded-check.js`

**Source**: `settings-reader.js:3` says "Used by plugin-loaded-check.js (a hook) and contracts-validate.js (a substrate script)" but `plugin-loaded-check.js` was retired at H.7.26 (per HT.0.7 audit). The header documentation is stale.

**Why deferred**: doc-lag fix; HT.2 sweep candidate. Sibling concern with drift-note 68 — both are in `settings-reader.js` documentary surface.

### Methodology

**Sub-plan-only** — mechanical sweep against well-bounded empirical inventory; no fresh design surface (per-export consumer counts verified empirically; no ambiguity about which exports are speculative); no schema change; no institutional discipline encoding. Matches HT.1.2 + HT.1.4 + HT.1.6 + HT.1.8 sub-plan-only precedents. Per-phase pre-approval gate skipped with EXPLICIT decision rationale matrix in sub-plan per HT.1.6 convention.

**Empirical pre-validation gate applied per HT.1.8 dogfooded pattern** — per-export consumer counts verified BEFORE sub-plan flips draft → approved. Pre-validation surfaced drift-notes 68 + 69 at sub-plan time rather than during-implementation discovery; 100% green first-pass verification (second consecutive HT.1 phase using the pattern).

### Verification

- **70/70 install.sh smoke tests** (unchanged from HT.1.8 — pure refactor; no test count delta; CLI surfaces preserved by design)
- **46/46 _h70-test.js asserts** (regression check; HT.1.9 doesn't touch agent-identity / its sub-modules)
- **0 contracts-validate violations** excluding pre-existing 16 baseline
- **7-site CLI smoke**: `adr.js list` (count=3); `architecture-relevance-detector.js list-signals` (rule_count=21); `build-spawn-context.js --task test --format json` (task echoed); `verify-plan-spawn.js` loads via require cleanly (require.main check skips main()); 3 hooks/_lib/ modules load + export only their consumed surface

### Why this matters

- **Closes HT.0.1 + HT.0.2 + HT.0.6 speculative-API findings** as institutional discipline
- **Forty-ninth distinct phase shape** in the HT track: substrate export-surface convergence + speculative-API resolution + 2 drift-notes captured at sub-plan time via empirical pre-validation
- **The empirical pre-validation pattern is now 2-phase confirmed** (HT.1.8 + HT.1.9): pre-validate sub-plan completeness via empirical smoke before sub-plan flips draft → approved; surfaces inventory drift at sub-plan time rather than during-implementation discovery; 100% green first-pass verification both phases

### Plugin manifest

`1.11.2` unchanged (no version bump per pure-refactor convention; matches HT.1.2 + HT.1.8 precedents).

### Out of scope (deferred)

- Dead consumer code in `contracts-validate.js:53` (drift-note 68; HT.2 sweep)
- Stale header in `settings-reader.js:3` (drift-note 69; HT.2 sweep)
- HOOK lock-primitive migrations (drift-note 67; HT.2)
- Per-module unit tests for the modified modules
- agent-identity.js `__test_internals__` subcommand — preserved as test surface for `_h70-test.js`

---

## [unreleased] — 2026-05-10 — HT.1.8 `withLock` DRY consolidation

**Hardening Track refactor 8 of N.** Mechanical DRY consolidation of lock primitive across 3 substrate scripts. Closes HT.0.2 D.4 finding (3-site DRY divergence post-`_lib/lock.js` extraction at H.3.2) + HT.0.8 Trajectory.2 confirmation. **No version bump** per pure-refactor convention (matches HT.1.2 parseFrontmatter DRY precedent — substrate-internal restructuring; no consumer-visible surface change).

### Changed

- **`scripts/prompt-pattern-store.js`** — migrated from 50 LoC inline lock primitive to `_lib/lock.js` `withLock` shared helper. Dropped: `LOCK_TIMEOUT_MS`, `LOCK_STALE_MS` constants; `sleepMs` helper (only used by inline lock); `acquireLock`, `releaseLock`, `withLock` functions (lines 41-114). Added: `const { withLock } = require('./agent-team/_lib/lock');` near top imports. Call site at line 188 → 129 updated to `withLock(LOCK_PATH, () => { ... }, { maxWaitMs: LOCK_TIMEOUT_MS })` — preserves original 5000ms timeout via `{maxWaitMs}` opt (vs `_lib/lock.js`'s 3000ms default; 5000ms tolerance is load-bearing for high-contention spawn flow). LoC: 338 → 279 (-59 LoC). **Closes the 5000ms-vs-30000ms timeout divergence as load-bearing bug surface** — concurrent invocations could previously race past `_lib/lock.js`'s 3000ms default if prompt-pattern-store.js's primitive held for up to 30s before stale reclamation. PID-based stale detection (in `_lib/lock.js`) is strictly better than time-based 30s window (in prior inline impl) for single-machine substrate scripts: immediate reclamation after crash vs 30s grace window.

- **`scripts/self-improve-store.js`** — collapsed 3-tier require fallback (lines 57-65) to 1-tier `__dirname`-relative require. The explicit `~/.claude/scripts/agent-team/_lib/lock` path attempt was redundant — `__dirname`-relative resolution covers both deployed-marketplace install (script at `~/.claude/scripts/`) and local-checkout (script at `~/Documents/claude-toolkit/scripts/`) scenarios. Preserved: `_warnLockFallback()` H.5.3 stderr warning (load-bearing observability per CS-3 hacker.kai H-1 + code-reviewer.blair H-2). LoC: 429 → 431 (+2; collapsed 9 LoC try-fallback to 2 LoC; added 9 LoC explanation comment for the rationale).

- **`scripts/agent-team/spawn-recorder.js`** — added `_warnLockFallback()` stderr warning for parity with self-improve-store.js's H.5.3 fix. Closes the silent-degradation observability gap when `_lib/lock.js` is unreachable (the fallback path is unlikely to fire in practice since substrate always ships the helper, but the warning is institutional discipline per ADR-0001 invariant 3 spirit: every fail-open path must be observable). LoC: 370 → 388 (+18; warning function adds ~9 LoC; explanation comment adds ~9 LoC).

### Added

- None. Pure-refactor; substrate-internal DRY consolidation only. No new files; no new schema; no new ADR.

### Drift-note 67 (NEW; deferred to HT.2 sweep)

**Title**: `session-end-nudge.js` inline lock primitive — hook fail-soft contract divergence from `_lib/lock.js` `withLock()` exit-on-timeout

**Why deferred**: `session-end-nudge.js` is a Stop hook with explicit fail-soft contract (passes input through silently on lock_timeout per ADR-0001 + ADR-0003 hook fail-soft invariant). `_lib/lock.js`'s `withLock()` wrapper calls `process.exit(2)` on timeout — incompatible with hook contract. Migration would require `acquireLock()` + `releaseLock()` direct usage (different pattern than other 8 consumers which use `withLock` wrapper) + preserve `log('lock_timeout', ...)` observability call + preserve fail-soft pass-through semantics. This is structurally distinct from HT.1.8's mechanical migration and warrants its own analysis. **HT.2 sweep candidate** alongside `error-critic.js` try-fallback (sibling concern — both are HOOK consumers with different fail-soft contract requirements than substrate-script consumers).

### Methodology

**Sub-plan-only** — mechanical DRY consolidation against established `_lib/lock.js` helper; no fresh design surface (PID-based vs time-based stale detection — `_lib/lock.js`'s PID-based is strictly better for single-machine substrate; timeout values preserved per-site via `{maxWaitMs}` opt); no schema change; no institutional discipline encoding. Per-phase pre-approval gate would not catch HIGH severity bugs that empirical smoke wouldn't catch. Matches HT.1.4 (mechanical bash extraction) + HT.1.6 (mechanical persona MD authoring) + HT.1.2 (parseFrontmatter DRY) precedents. EXPLICIT decision rationale matrix in sub-plan per HT.1.6 methodology.

### Verification

- **70/70 install.sh smoke tests** (unchanged from HT.1.7 — pure refactor; no test count delta)
- **46/46 _h70-test.js asserts** (regression check; HT.1.8 doesn't touch agent-identity / its sub-modules)
- **0 contracts-validate violations** excluding pre-existing 16 baseline
- **3-site smoke**: `node scripts/prompt-pattern-store.js list` (lock acquired + released cleanly); `node scripts/self-improve-store.js pending` (1-tier require resolves correctly); `node scripts/agent-team/spawn-recorder.js --help` (lock primitive load + warning function compile-clean)

### Why this matters

- **Closes HT.0.2 D.4 finding** (3-site DRY divergence post-`_lib/lock.js` extraction at H.3.2)
- **Closes HT.0.8 Trajectory.2 confirmation** (8 callers vs 1 inline + 2 try-fallback observation)
- **Closes the 5000ms-vs-30000ms timeout divergence** as load-bearing bug surface
- **Adds observability parity** to spawn-recorder.js (closes silent-degradation gap per ADR-0001 invariant 3 spirit; aligns with self-improve-store.js's H.5.3 fix)
- **Mechanical refactor against established helper** — no fresh design surface; matches HT.1.2 + HT.1.4 + HT.1.6 sub-plan-only precedent
- **Forty-ninth distinct phase shape** in the HT track: substrate-scripts DRY consolidation + observability parity addition + drift-note 67 captured for HOOK lock-primitive migration deferral

### Plugin manifest

`1.11.2` unchanged (no version bump; pure-refactor; matches HT.1.2 precedent).

### Out of scope (deferred)

- HOOK lock-primitive migrations (`session-end-nudge.js` + `error-critic.js`) — drift-note 67; HT.2 sweep candidates (different fail-soft hook contract than substrate-script consumers)
- `_lib/lock.js` API extensions or behavioral changes
- Logger-vs-console.error observability parity at the helper layer (HT.2+ sweep)
- Per-module unit tests for `_lib/lock.js` (HT.2+ sweep)

---

## [1.11.2] — 2026-05-10 — HT.1.7 ADR-0001 retroactive shape + ADR-0003 governance-tier forward-looking

**Hardening Track refactor 7 of N.** Schema-level reshape of the ADR system to disclose ADR-0001's retroactive codification + author governance-tier ADR-0003 as forward-looking institutional commitment. Closes master plan v3.1 line 344 (chaos theo F4 finding) + HT.0.6 E.6 finding + HT.0.9-verify architect FLAG-1 committed-path resolution.

### Changed

- **`swarm/adrs/_TEMPLATE.md`** — frontmatter status comment header lists 5 enum values (was 4); explicit gloss for each.
- **`swarm/adrs/_README.md`** — frontmatter status enum + Lifecycle list expanded from 4 to 5 statuses; "Active" definition widened to include `seed`; CLI example for `active` subcommand updated.
- **`scripts/agent-team/adr.js`** — `isActive()` widened to admit `status: seed` alongside `status: accepted` (gated by empty `superseded_by`); top docstring updated. **Backward compat preserved**: existing `accepted` ADRs unaffected.
- **`swarm/adrs/0001-substrate-fail-open-hook-discipline.md`** — retagged from `status: accepted` to `status: seed`; `related_adrs: []` → `related_adrs: [0003]` (bidirectional cross-reference); status notes append second entry recording the 2026-05-10 retag with rationale + cross-reference to ADR-0003.
- **`tests/smoke-h8.sh`** — test 48 (H.8.2 touched-by) updated to assert `matched_count: 2` (was 1) post-HT.1.7 — reflects ADR-0001 + ADR-0003 sharing files_affected list.

### Added

- **NEW `swarm/adrs/0003-substrate-fail-open-hook-discipline-forward-looking.md`** — governance-tier ADR codifying institutional commitment + load-bearing code-review gate for fail-open hook discipline. Distinct scope from ADR-0001's mechanical discipline (technical-tier vs governance-tier). 2 invariants — institutional commitment (PR verification of all 4 ADR-0001 invariants) + governance gate (NEEDS-REVISION on missing verification). Ships at `status: accepted` directly per architect FLAG-6 + code-reviewer FLAG-1 convergent absorption (per-phase pre-approval gate IS the acceptance ceremony; transient `proposed` introduces test 74 timing-window failure + reproduces the retroactive-status-mismatch shape that HT.1.7 is fixing).
- **NEW `seed` status enum value** in ADR system. Semantic: pre-existing discipline codified retroactively; the discipline existed before the ADR primitive shipped. **Design B chosen**: `seed` ADRs participate in drift detection (`isActive()` returns true; not museum-only). Preserves drift surface for retroactive ADRs alongside their forward-looking governance siblings.
- **NEW install.sh smoke tests 73 + 74** at `tests/smoke-ht.sh`:
  - Test 73: `adr.js list --status seed` returns count 1 (ADR-0001) post-retag
  - Test 74: `adr.js touched-by hooks/scripts/fact-force-gate.js` returns matched_count 2 (ADR-0001 seed + ADR-0003 accepted) — validates Design B (seed active-for-drift)

### Methodology

**Per-phase pre-approval INVOKED** (3rd HT.1 phase invoking the gate; HT.1.3 + HT.1.5 + HT.1.7). Parallel architect (subagent_type: architect) + code-reviewer (subagent_type: code-reviewer) ran 2026-05-10 per HT.0.9-verify methodology. Both returned **APPROVED-with-revisions**; **7 unique FLAGs absorbed in single revision pass** (1 HIGH convergent across both reviewers + 4 MEDIUM + 2 LOW):

- **HIGH (architect FLAG-6 + code-reviewer FLAG-1, convergent)**: ADR-0003 ships at `status: accepted` directly. Transient `proposed` would introduce test 74 timing-window failure (`isActive()` filters by accepted/seed; proposed excluded → `matched_count` would be 1 not 2) + reproduces the retroactive-status-mismatch shape that HT.1.7 is fixing. Resolved by recording proposed + accepted transitions as same-day status notes rather than authoring transient state on disk.
- **MEDIUM (architect FLAG-3, load-bearing)**: ADR-0003 reframed as **governance-tier** ADR distinct from ADR-0001's **technical-tier** scope. Two distinct concerns (mechanical discipline vs institutional enforcement); collapsing into one ADR mixes scope. The governance/technical separation is genuinely ADR-worthy and avoids the "two ADRs saying the same thing" critique.
- **MEDIUM (architect FLAG-2 + FLAG-4, convergent on FLAG-3 absorption)**: ADR-0003 `invariants_introduced` tightened from 4 forward-looking restatements to 2 governance-novel invariants (institutional commitment + code-review gate). ADR-0001's 4 mechanical invariants stay in ADR-0001; referenced by ID in ADR-0003 prose, NOT duplicated. Resolves drift-noise concern (overlapping-invariants critique).
- **MEDIUM (architect FLAG-1)**: `seed` naming defended explicitly. Etymologically apt for "first / foundational discipline that pre-existed the ADR primitive." Alternatives (`retroactive` / `codified-retroactively` / `historical` / `legacy` / `archived`) considered + rejected: the first two over-rotate toward "process artifact" rather than "foundational discipline"; the latter three imply NO LONGER ACTIVE which contradicts Design B.
- **MEDIUM (code-reviewer FLAG-3)**: `_README.md:71` (active CLI comment) updated as distinct from line 65 (`list --status accepted` filter example). Two distinct locations; both must reflect the schema extension.
- **LOW (architect FLAG-5)**: ADR-0001 `related_adrs: []` → `related_adrs: [0003]`. Bidirectional machine-readable cross-reference.
- **LOW (code-reviewer FLAG-6)**: Verification probe 7 corrected — `adr.js active` returns 2 ADRs post-HT.1.7 (ADR-0001 seed + ADR-0003 accepted; ADR-0002 remains `status: proposed` from HT.1.3 ship state — NOT included in active until separately promoted).

### Verification

- **70/70 install.sh smoke tests** (was 68/68; +2 HT.1.7 tests 73 + 74; test 48 updated to assert post-HT.1.7 matched_count 2)
- **46/46 _h70-test.js asserts** (regression check; HT.1.7 doesn't touch `agent-identity.js` or its sub-modules)
- **0 contracts-validate violations** excluding pre-existing 16 baseline
- **All 12 verification probes pass** (per sub-plan): list returns 3 ADRs total; `--status seed` returns 1; `--status accepted` returns 1 (ADR-0003 — ADR-0002 still proposed); `active` returns 2 (ADR-0001 + ADR-0003); `touched-by hooks/scripts/fact-force-gate.js` returns matched_count 2; `read 0001` renders ADR-0001 with `status: seed` + appended status note; `read 0003` renders ADR-0003

### Why this matters

- **Closes master plan v3.1 special-focus item** at line 344 (chaos theo F4 — ADR-0001 retroactive shape refactor candidate)
- **Closes HT.0.6 E.6 finding** (refactor candidate documented at audit time; documenting state at audit phase, fixing at refactor phase per master plan discipline)
- **Closes HT.0.9-verify architect FLAG-1** (committed-path resolution: retag-in-place via `seed` enum; "OR ADR-0007 supersedes ADR-0001" branch removed)
- **Backward-compatible schema extension**: existing `accepted` ADRs unchanged; new `seed` enum value is additive; `isActive()` widening preserves all existing behavior — verified empirically via `adr.js list --status accepted` returning ADR-0003 only (the new accepted ADR; ADR-0002 still `proposed` from HT.1.3 ship)
- **Institutional discipline codified** for fail-open hook discipline going forward — load-bearing for all future hook authors + code reviewers as the substrate grows past the original 14 hooks
- **Forty-eighth distinct phase shape** in the HT track: ADR system schema extension + retroactive shape disclosure + governance-tier forward-looking institutional commitment

### Plugin manifest

`1.11.1 → 1.11.2` (patch — additive substrate surface; new lifecycle status enum value; new governance-tier ADR; CLI/hook surface unchanged from consumers' POV; no behavior change visible to existing `accepted` ADRs).

### Out of scope (deferred)

- ADR-0001 + ADR-0003 `files_affected` 14-vs-16 mechanical doc-lag fix (HT.0.6 finding; HT.2 sweep)
- "9th forcing instruction" stale claim in `_README.md:85` + `validate-adr-drift.js:75` (current count is 10 post-H.8.8; HT.2 sweep)
- ADR-0001 invariant-3 phrasing nit re: `session-end-nudge.js:130,142` (`state_save_failed` vs literal `error`; HT.0.1 finding; HT.2 sweep)
- Per-module unit tests for ADR system (HT.1.3 deferred per design; HT.2 sweep)
- Automated lint check verifying ADR-0001's four mechanical invariants on hook file changes (drift-note candidate per ADR-0003 Open question; HT.2+ sweep target)

---

## [Unreleased]

### Added

- **HT.1.6** Documentary persona MD asymmetry + DEFAULT_ROSTERS gap + /research path-extraction fix (sixth Hardening Track refactor; closes drift-note 60 sub-decisions 2-4 + drift-notes 65 + 66). Closes HT.0.4 B.4 architect FLAG-2 (documentary 14/15/16 contracts present; persona MDs absent) + HT.0.8 Completeness.4 confirmation. **3 NEW persona MDs** at `swarm/personas/14-codebase-locator.md` (68 LoC) + `15-codebase-analyzer.md` (70 LoC) + `16-codebase-pattern-finder.md` (68 LoC) — auditor-class structural shape (Identity / Mindset / Focus area / What you do (and do NOT do) / Specific things to find / Output format / Constraints) adapted for documentary discipline (WHERE / HOW / EXISTING-PATTERNS triad). **Substantive empirical scope expansion** during HT.1.6 implementation surfaced TWO drift-notes that required in-scope fixes for `/research` runtime correctness: **(1) drift-note 65 (NEW)**: HT.0.9-verify decision-block 3-option collapse — parent backlog line 160's "(a) join DEFAULT_ROSTERS / (b) keep `persona: <fixed>` shape / (c) adopt `<set-at-spawn>` shape" presented two independent axes as mutually exclusive alternatives. Axis 1 (contract `persona` field shape: fixed vs `<set-at-spawn>`) was resolved by HT.0.9-verify choosing (b). Axis 2 (DEFAULT_ROSTERS membership) was orthogonal but silently left absent — `assign --persona 14-codebase-locator` failed at runtime with "No roster for persona" (verified empirically). **(2) drift-note 66 (NEW; sibling)**: `commands/research.md:62-67` used `jq -r '.full'` to extract identity from assign output, but assign output JSON has `.identity` field (`"14-codebase-locator.scout"`) — not `.full`. Pre-existing H.8.6 documentation error masked by the same integration-test gap as drift-note 65 (no integration test exercises /research's spawn flow). **HT.1.6 scope expansion** to fix both: **3 NEW DEFAULT_ROSTERS entries** at `scripts/agent-team/identity/registry.js` (lines 51-58 with new "Documentary family" comment block) — `'14-codebase-locator': ['scout', 'nav', 'atlas']` (wayfinding theme) + `'15-codebase-analyzer': ['lex', 'dex', 'kit']` (analytical theme) + `'16-codebase-pattern-finder': ['vega', 'nori', 'pip']` (pattern-spotting theme); all 9 names verified non-collision against existing 39 identity names; **3-line fix to `commands/research.md:63,65,67`**: `.full` → `.identity` (drift-note 66 sibling fix). **NEW install.sh smoke test 72** at `tests/smoke-ht.sh` exercises both fixes end-to-end: (a) `assign --persona 14-codebase-locator` returns valid identity from {scout, nav, atlas} roster; (b) `commands/research.md` uses `.identity` × 3 (not `.full`). Closes the integration-test gap that masked both drift-notes. Test uses `if grep -q; then` form to bypass install.sh's `set -euo pipefail` propagation when grep finds 0 matches (initial test logic produced "0\n?" via `|| echo "?"` fallback breaking equality check; corrected mid-implementation). **NEW lightweight BACKLOG.md decision-record-pattern entry** at `skills/agent-team/BACKLOG.md` top section — first `decision-record-pattern: lightweight` entry per HT.0.9-verify FLAG-5 right-sizing (ADR-system bloat avoidance; original sub-plan draft proposed ADR-0003; downgraded because documentary persona class shape is bounded to N=3 with no expected expansion). Codifies: documentary class invariants (`documentary: true` + `_documentary_note` + `research-mode` skill required + `kb:hets/spawn-conventions` kb_scope + F3 hasFileCitations min 5 + A4 noCritiqueLanguage + fallbackAcceptable handoff); roster shape resolution (chose option (a) DEFAULT_ROSTERS membership AND option (b) contract `persona: <fixed>` shape together as independent axes; clarifies HT.0.9-verify framing); 3-name rosters per existing convention; both drift-notes 65 + 66 captured for HT.2 sweep candidate (sibling axis-conflation pattern detection across HT.1 backlog 3-option Decision blocks). **Methodology**: sub-plan-only per HT.1.4 precedent (mechanical authoring per established template + no fresh design surface for which architect/code-reviewer would catch HIGH severity bugs); per-phase pre-approval skipped with EXPLICIT decision rationale matrix in sub-plan (avoids the failure mode of skipping pre-approval by default without principled assessment). **Verification**: 68/68 install.sh smoke (was 67/67; +1 test 72); 46/46 _h70-test.js asserts (regression check; HT.1.6 doesn't touch trust-scoring / verdict / lifecycle paths beyond DEFAULT_ROSTERS additions which _h70-test.js consumes via `ai.DEFAULT_ROSTERS`); 0 contracts-validate violations excluding pre-existing 16 baseline. Plugin manifest 1.11.0 → 1.11.1 (patch — additive substrate fix; new persona MD surface; CLI/skill/hook surface unchanged from consumers' POV; sibling fix to /research path-extraction; rosters extend existing convention). ~2 hours wallclock end-to-end (sub-plan ~30 min including drift-note 65 capture during empirical reproduction + implementation ~60 min including drift-note 66 discovery + test 72 set-e fix + 3-tier verification + cutover ~30 min). **Drift-note 60 closed**: 4 sub-decisions resolved across HT.1 track (1: noCritiqueLanguage at HT.1.1; 2-4: persona MD asymmetry + roster registration + class shape codification at HT.1.6). **Forty-seventh distinct phase shape**: documentary persona MD authoring + DEFAULT_ROSTERS substrate fix + drift-note option-axis-conflation capture + integration-test gap closure. **Pattern-level observation**: HT.1.6 dogfooded the "drift-notes-during-implementation" pattern — sub-plan was authored from approved backlog assuming "Decision: (b) per HT.0.9-verify" was complete; empirical smoke test against the substrate immediately surfaced drift-note 65 (DEFAULT_ROSTERS gap blocks /research) and drift-note 66 (.full vs .identity). Both fixed within HT.1.6 scope expansion rather than punted (meta-fix-after-instance discipline; matches HT.1.4's drift-note 63 pattern). Both close together because they share the same root cause (no integration test for /research spawn flow). **HT.1.6's lightweight BACKLOG entry is the first of 3 planned across HT.1** (HT.1.6 documentary class + HT.1.12 deferred-author-intent precedent + HT.1.15 helper-deletion canonical pattern). Next: HT.1.7 ADR-0001 retroactive shape + ADR-0002 forward-looking (3-step ADR work: add `seed` enum to `_TEMPLATE.md` + retag ADR-0001 to `status: seed` + author ADR-0002 forward-looking institutional discipline).

### Changed

- **HT.1.5** `commands/build-team.md` 322 LoC + 6-responsibility split (fifth Hardening Track refactor; third ADR-0002 application). Closes HT.0.3 B.1 + C.1 + HT.0.8 Size.2 multi-responsibility-at-lifecycle-entrypoint findings for `commands/build-team.md`. **Sibling decision under ADR-0002** (cross-language application section validated empirically across all three target languages — Node.js dispatcher at HT.1.3 / bash sourced files at HT.1.4 / markdown narrative + helper-script invocations at HT.1.5). **Responsibility-count-bound trigger**: 322 LoC well under the 800 LoC bound BUT 6 responsibilities > 5 responsibilities bound (per ADR-0002 Decision: "EITHER size bound is breached"). Lifecycle coherence holds (single `/build-team <task>` invocation; chat-agent-followed orchestration in sequence). **Empirical 6-responsibility breakdown**: Steps 0 (route-decision gate H.7.3+H.7.5) + 1 (pre-flight check) + 1.5 (pre-spawn context auto-extension H.8.5) + 2 (tech-stack-analyzer + Step 7 spawn flow with H.5.7 contract selection + tier dispatch) + 3-4 (consolidated artifact + capability-request handling H.6.5) + 5 (don't auto-commit constraint). **NEW** `scripts/agent-team/build-team-helpers.sh` (285 LoC; 5 subcommands + `--help`): `route-decide-gate` wraps H.7.3+H.7.5 route-decide.js with --context support; `build-spawn-context` wraps build-spawn-context.js with H.8.5 fail-open semantics; `verify-with-contract-selection` applies H.5.7 task-type heuristic + audit/engineering contract selection + tier-aware contract-verifier dispatch (only spot-check-only consumes skipChecks per H.7.1 H-2; medium/low tiers run full verification); `assign-challenger-pair` polymorphic dispatch over agent-identity.js assign-challenger (count=1) vs assign-pair (count≥2); `record-verdict` wraps pattern-recorder.js record with task-signature derivation (`${persona}:actor-${persona}` consolidating duplicated pattern at original lines 237-238 + 264-265). **Path resolution**: `$HOME/Documents/claude-toolkit/...` matching the existing `ROUTE_DECIDE_SCRIPT` pattern at original build-team.md line 32 across all 14 commands; `$SCRIPT_DIR` is NOT set in slash-command context (HT.1.5-verify code-reviewer Q4 HIGH severity catch — would have caused runtime failure; converged with architect Q6 LOW). **Dispatch idiom**: bash `case "$1" in` positional with `--help` handled before case block (HT.1.5-verify code-reviewer Q3 MEDIUM specification). `commands/build-team.md` shrinks 322 → 207 LoC (35.7% reduction); 4 of 5 bash blocks extracted to helper invocations (Step 1 pre-flight 3-LoC bash kept inline per HT.1.5-verify architect Q2 YAGNI — speculative DRY without second consumer); 9 helper invocations replace 209 LoC of embedded bash. **HT.1.5-verify per-phase pre-approval gate INVOKED** per documented HT.1.5 methodology: parallel architect (subagent_type: architect) + code-reviewer (subagent_type: code-reviewer) ran 2026-05-10. Both returned APPROVED-with-revisions / NEEDS-REVISION (architect APPROVED-with-revisions; code-reviewer NEEDS-REVISION on HIGH severity `$SCRIPT_DIR` runtime-failure catch); **9 unique FLAGs absorbed in single revision pass** (1 HIGH converged across both reviewers + 4 MEDIUM + 4 LOW). Notable absorptions: (1) FLAG path-resolution HIGH `$SCRIPT_DIR` → `$HOME/Documents/claude-toolkit/...` (would have caused runtime failure at every `/build-team` invocation; verified absent across all 14 commands); (2) FLAG architect Q1a MEDIUM dropped `recommend-verification` subcommand (pure 1:1 pass-through over `agent-identity.js recommend-verification` — no abstraction value); (3) FLAG architect Q1b MEDIUM merged `select-contract` + `verify-contract` into single `verify-with-contract-selection` (chained-subcommand state-threading via stdout was a smell; single subcommand applies H.5.7 internally then dispatches verifier); (4) FLAG architect Q2 LOW dropped `pre-flight-check` subcommand (3 LoC bash + 3 substrate-primitive readiness checks read better inline; YAGNI; original "EXTRACT for consistency" framing was code-reviewer-anticipation rather than principled design); (5) FLAG code-reviewer Additional MEDIUM Step 2 fence-indent stripping via `sed 's/^  //'` (Step 2 bash block lives under bullet list with 2-space prefix); (6-9) precision improvements (dispatch idiom + status: approved metadata + drift-note 64 deferral to HT.2 + naming convention rationale). Original draft 7+1 helper API right-sized to 5+1 post-FLAG-absorption. **Drift-note 64 captured** during HT.1.5-verify (3-layer convergent measurement gap): (a) HT.0.3 audit's "~45% embedded bash" claim was an undercount — actual 64.9% (209 LoC of 322 = 64.9% bash density vs 45% claimed; visual percentage estimate without block-level enumeration); (b) HT.0.9-verify FLAG-2 "537 LoC" claim was wrong — actual `run_smoke_tests` span 1188 LoC (drift-note 63 from HT.1.4); (c) HT.1.5 sub-plan original draft "213 LoC bash" — fence-line-inclusive counting; corrected to 209 LoC fence-exclusive at HT.1.5-verify code-reviewer Q1 LOW. Three convergent layers point at audit-phase measurement-methodology gap; HT.2 sweep target. **Token cost reduction**: 322 LoC × 18,952 bytes × 0.25 tok/byte = ~4,738 tokens current → ~155-207 LoC narrative-heavy at ~10 tok/line = ~1,800-2,300 tokens post-split (~50-60% compression per `/build-team` invocation; helper script load is on-demand per Step). **CLI surface preserved**: `/build-team <task>` invocation contract identical; chat-agent reads narrative + invokes helper as needed; spawn_implementer / spawn_challenger placeholders remain inline as Agent-tool actions per `kb:hets/spawn-conventions` and `kb:hets/challenger-conventions` (helper script intentionally does NOT wrap chat-agent actions — only substrate primitives). **Verification**: 67/67 install.sh smoke (was 66/66; +1 NEW test 71 HT.1.5 helper-script dispatch + subcommand-surface integrity asserting `--help` exits 0 with 5 expected subcommands listed + unknown-subcommand exits 1 with usage on stderr; if-form substitution wraps the unknown-subcommand exec to bypass install.sh `set -euo pipefail` propagation); 46/46 _h70-test.js asserts (regression check; HT.1.5 doesn't touch agent-identity); 0 contracts-validate violations excluding pre-existing 16 baseline. Plugin manifest 1.10.1 → 1.11.0 (minor — new substrate surface `build-team-helpers.sh` exposing 5-subcommand callable API; semver minor for additive surface). **Third ADR-0002 application validates the cross-language framing empirically across all three target languages** — Node.js dispatcher (HT.1.3) + bash sourced files (HT.1.4) + markdown narrative + helper-script invocations (HT.1.5) work cleanly under the same criterion (lifecycle coherence + ≤800 LoC AND ≤5 responsibilities). **Forty-sixth distinct phase shape**: markdown narrative + helper-script invocations under ADR-0002 with chat-agent-action placeholders preserved inline. **Drift-note 40 codification value 7th consecutive phase**: code-reviewer's HIGH severity `$SCRIPT_DIR` catch alone (would have caused 100% runtime failure on every `/build-team` invocation) justified the per-phase pre-approval gate tax. Next: HT.1.6 documentary persona MD asymmetry (14/15/16) — different shape than HT.1.3-1.5 ADR-0002 cluster; advances drift-note 60 sub-decisions 2-4.

- **HT.1.4** install.sh `run_smoke_tests` 1188 LoC bash extraction (fourth Hardening Track refactor; second ADR-0002 application). Closes HT.0.7 B.2 + C.2 + HT.0.8 Size.2 multi-responsibility-at-lifecycle-entrypoint findings for install.sh. **Sibling decision under ADR-0002** (cross-language application section ratified at HT.1.3-verify FLAG-6 absorption); bash sourced-file post-split shape (vs HT.1.3's Node.js dispatcher pattern). **4-file phase-era extraction** under `tests/`: `smoke-h4.sh` (124 LoC; 10 tests; pre-H.x cohort + H.4.x), `smoke-h7.sh` (492 LoC; 26 tests; H.7.x — tests 20-21 retired with validate-markdown-emphasis.js at H.7.27 + tests 28-29 retired with plugin-loaded-check.js at H.7.26), `smoke-h8.sh` (511 LoC; 27 tests; H.8.x excluding trailer test 65), `smoke-ht.sh` (103 LoC; 3 tests; HT.1.x tests 69-70 + H.8.7 trailer test 65 in execution-order-preserving sequence). install.sh shrinks 1477 LoC → 311 LoC (79% reduction); `run_smoke_tests()` body shrinks 1188 LoC → 22 LoC (98% reduction; 4 source statements + brief comment). **CLI surface preserved**: `bash install.sh --hooks --test` invocation contract identical; SCRIPT_DIR-relative source paths stable across install/dev/test environments. **Test ordering preserved**: source-order sequencing (h4 → h7 → h8 → ht) replicates pre-extraction execution order tests 1-68 → 69-70 → 65 trailer (per HT.0.7 audit anomaly preservation). **Drift-note 63 captured** during execution: HT.0.9-verify code-reviewer FLAG-2 LoC correction was itself wrong — the "537 LoC at lines 218-754" claim was incorrect because line 754 is `}` inside the `SETTINGS_EOF` heredoc that closes at line 755; actual function span is 218-1406 = 1188 LoC, closer to the original draft's "~1119 LoC" pre-FLAG-2 claim. Verified by grep of all heredoc terminators (14 instances between 218-1406). The line-counting methodology (column-0 `}` matching) was unreliable for heredoc-heavy bash files; future per-script LoC validations should use awk function-span detection or balance-aware brace counting. This is the second per-phase-pre-approval LoC correction-of-correction in the HT.1 sequence (HT.1.2's 4-vs-5 site enumeration paid off; HT.1.3's 1698 LoC + 5 responsibilities was correct; HT.1.4's 537 → 1188 reverses HT.0.9-verify's FLAG-2 correction). **Per-phase pre-approval gate skipped** per documented sub-plan-only methodology: ADR-0002 already covers bash post-split shape (Cross-language application section); phase-era boundaries are mechanical (pre-existing `# Test N (H.x.y)` comment markers); LoC discovery doesn't change extraction shape only file-size estimates; no test re-ordering proposed; no test-grouping ambiguity. **Verification**: 66/66 install.sh smoke (unchanged from HT.1.3); 46/46 _h70-test.js asserts (regression — HT.1.4 doesn't touch agent-identity); 0 contracts-validate violations excluding pre-existing 16 baseline. Plugin manifest 1.10.0 → 1.10.1 (patch — bash-side restructuring; no behavior change visible to plugin consumers; CLI surface unchanged). ~75 min wallclock end-to-end (sub-plan ~15 min + extraction ~30 min + verification + cutover ~30 min). **Second ADR-0002 application validates the cross-language framing** introduced at HT.1.3-verify FLAG-6 absorption — the bash post-split shape works empirically. Forty-fifth distinct phase shape: bash sourced-file decomposition under ADR-0002 with execution-order-preserving source sequencing. Next: HT.1.5 commands/build-team.md 322 LoC + 6-responsibility split (markdown post-split shape per ADR-0002).

- **HT.1.3** `agent-identity.js` 5-module split + ADR-0002 (third Hardening Track refactor; first ADR-led + hybrid item from HT.1 backlog at score-9 highest priority). Closes HT.0.2 B.4 most-weighty single-script finding + HT.0.8 Size.2 confirmation. **Empirical 5-module split**: pre-split agent-identity.js was 1698 LoC bundling 5 distinct responsibilities at one CLI bridge-script entrypoint; post-split lives across 5 modules under `scripts/agent-team/identity/` (registry.js 387 LoC + trust-scoring.js 309 LoC + verdict-recording.js 113 LoC + verification-policy.js 197 LoC + lifecycle-spawn.js 487 LoC) plus thin dispatcher (agent-identity.js 141 LoC; total 1634 LoC). Each sub-module is responsibility-bounded ≤ 800 LoC; agent-identity.js is now a CLI dispatcher + module.exports re-export block preserving the external surface. **NEW ADR-0002** at `swarm/adrs/0002-bridge-script-entrypoint-criterion.md` codifies the bridge-script entrypoint criterion as forward-looking institutional discipline: a bridge-script accrues multi-responsibility cleanly when (a) lifecycle coherence holds AND (b) BOTH size bounds hold (≤800 LoC AND ≤5 responsibilities); split applies otherwise. Language-agnostic criterion; per-language post-split shape varies (Node.js dispatcher; bash sourced files; markdown helper-script invocations). Sibling decisions: HT.1.4 install.sh `run_smoke_tests` (LoC bound trigger); HT.1.5 commands/build-team.md (responsibility-count bound trigger). **Pre-extraction fixes** applied per HT.1.3-verify code-reviewer FLAGs (single revision pass): (1) computeWeightedTrustScore mutation at line 521 replaced with object-spread (`augmentedQF`) to honor the documented purity contract; (2) `_readPersonaContract` redundant inline `require('fs')` + `require('path')` removed (shadowed module-level requires). **Per-phase pre-approval gate (Option A)**: parallel architect + code-reviewer ran before implementation per HT.0.9-verify methodology; both returned APPROVED-with-revisions; 10 unique FLAGs absorbed in single revision pass (3 ADR-0002 FLAGs: redundancy in 3 size bounds → reframed to 2 with explicit "both axes load-bearing" + bridge-script vocabulary gloss + "Cross-language application" section; 7 sub-plan FLAGs: cmdStats relocated registry/lifecycle-spawn → registry per read-only-vs-mutators split + computeWeightedTrustScore purity caveat + _readPersonaContract inline-requires cleanup + __test_internals__ dual-source enumeration + _h70-test.js:56 + tierOf in checklist + identity/ naming rationale clarified). **CLI surface preserved**: all 13 subcommands (init/assign/assign-challenger/assign-pair/tier/recommend-verification/list/stats/record/prune/unretire/breed/__test_internals__) dispatch correctly through new dispatcher to relevant sub-module cmd functions. **Module surface preserved**: dispatcher's module.exports re-exports all 23 symbols (8 trust-scoring constants + 1 registry constant + 1 verification-policy constant + 8 trust-scoring helpers + 1 registry helper + 5 cmd handlers) so existing `require('./agent-identity.js')` consumers (`_h70-test.js:56` + `:74`) continue to work. **Verification**: 66/66 install.sh smoke (unchanged from HT.1.2); 46/46 _h70-test.js asserts; 0 contracts-validate violations excluding pre-existing 16 baseline; CLI matrix smoke against ephemeral HETS_IDENTITY_STORE confirms init/assign/list/stats/tier/recommend-verification/record/__test_internals__ all respond correctly. Plugin manifest 1.9.1 → 1.10.0 (minor — new module surface; semver minor for additive structural change). Drift-note 60 (documentary persona class 4-sub-decision intersection) unchanged; HT.1.6 carries the persona-MD-asymmetry sub-decisions. **First HT.1 ADR-led item ships at status: approved** (HT.1.3-verify approved sub-plan 2026-05-10; implementation took ~120 min wallclock end-to-end). 6th consecutive phase validating drift-note 40 codification value (parallel pre-approval continues to catch FLAGs that would land at execution time). Next: HT.1.4 install.sh `run_smoke_tests` 537 LoC extraction (sibling decision under ADR-0002).

- **HT.1.2** `parseFrontmatter` DRY consolidation (second Hardening Track refactor; pure-refactor item from HT.1 backlog). Closes HT.0.2 + HT.0.8 Trajectory.2 carry-over confirmation. Post-H.8.7 `_lib/frontmatter.js` extraction at chaos-H4 closure, 4 inline `parseFrontmatter` copies remained in consumers (HT.0.9-verify code-reviewer FLAG-1 enumerated them; corrected the original draft's "5 + 1 unspecified" claim to "exactly 4"). **Migration**: replaced 4 inline implementations with `require('./_lib/frontmatter')` (or `'../scripts/agent-team/_lib/frontmatter'` for `swarm/hierarchical-aggregate.js`): (1) `scripts/agent-team/pattern-runner.js:41` straight replacement; (2) `swarm/hierarchical-aggregate.js:63` straight replacement; (3) `scripts/agent-team/contract-verifier.js:41` replacement + caller simplification (previous inline returned `null` on no-frontmatter requiring `parsed ? parsed.body : output` ternary; canonical always returns `{frontmatter, body}`); (4) `scripts/agent-team/contracts-validate.js:56` replacement + caller rename (previous inline returned `{ fm: {}, body: text }` with `fm` field name; 4 destructuring sites updated via `const { frontmatter: fm } = ...` rename to keep downstream `fm` usages stable). **Adoption math**: helper consumer count 3 → 7. Closes the divergent-bug-surface risk per chaos eli LOW-3 sibling — different inline implementations had subtle behavior differences (null vs object early-return; `fm` vs `frontmatter` field name; missing null literal/block list/digit-bearing key support). **No plugin manifest bump** (pure consumer-side adoption of helper already shipped at H.8.7; no behavior change visible to plugin consumers; CLI surface unchanged). **No new install.sh smoke tests** (consolidation; existing tests 1-70 already exercise consumers + canonical helper). 66/66 install.sh smoke (unchanged from HT.1.1); 46/46 _h70-test.js asserts; 0 contracts-validate violations excluding pre-existing 16 baseline. Spot-check `node scripts/agent-team/pattern-runner.js list-patterns` returns 20 patterns with frontmatter parsed correctly. ~15 min wallclock end-to-end. Next: HT.1.3 `agent-identity.js` articulate-or-split (substantive sub-plan phase; ADR-0002 + 5-module split; per-phase pre-approval likely warranted).

### Added

- **HT.1.1** `noCritiqueLanguage` antiPatternCheck implementation (first Hardening Track refactor; pure-code item from HT.1 backlog HT.1.1-HT.1.15). Closes HT.0.4 E.2 most-weighty finding + HT.0.8 Correctness.8 carry-over confirmation. Documentary persona contracts 14/15/16 (codebase-locator + codebase-analyzer + codebase-pattern-finder) declared `noCritiqueLanguage` antiPatternCheck via H.8.6 RPI infrastructure but `contract-verifier.js` never implemented the check; H.3.6 dispatch path returned `unknown_check` → `antiPatternWarns++` → documentary actor verdicts locked at `partial` (verdict logic at line 552-555: warns > 0 → not `pass`). **Implementation**: `noCritiqueLanguage(cArgs)` slotted in `scripts/agent-team/contract-verifier.js:433-457` (after `noPaddingPhrases` to keep documentary-discipline checks adjacent); accepts `cArgs.forbidden_phrases` (snake_case primary; matches all 3 contracts) + `cArgs.forbiddenPhrases` (camelCase defensive); substring case-insensitive match mirrors `noPaddingPhrases` convention; default phrase list is union most commonly used across the 3 contracts. **Behavior change**: clean documentary output → A4 status `pass` → verdict can reach `pass`; output containing forbidden phrases → A4 status `warn` (severity stays `warn` per contract) → verdict stays `partial`. **HT.0.9-verify code-reviewer pre-validated** the insertion point (`contract-verifier.js:376-448` antiPatternChecks block boundary PASS) + the `noPaddingPhrases` mirroring pattern before implementation. 2 NEW install.sh smoke tests (69 positive: clean output → A4 pass + verdict pass; 70 negative: forbidden phrase "should be" → A4 warn + verdict partial + foundPhrase reported). Plugin manifest 1.9.0 → 1.9.1 (patch — implementation of declared check; no new surface; CLI unchanged). 66/66 install.sh smoke (was 64/64; +2 HT.1.1); 46/46 _h70-test.js asserts; 0 contracts-validate violations excluding pre-existing 16 `contract-plugin-hook-deployment` environment-specific entries (same as baseline). **First HT.1 refactor ships at status: approved** (HT.0.9-verify approved backlog 2026-05-10; HT.1.1 implementation took ~30 min end-to-end). Drift-note 60 (documentary persona class 4-sub-decision intersection) advances 1 of 4 sub-decisions (noCritiqueLanguage implementation); remaining 3 land at HT.1.6 (persona MD asymmetry + roster shape + class shape codification). Next: HT.1.2 `parseFrontmatter` DRY consolidation (4 inline copies → `_lib/frontmatter.js` adoption per HT.0.9-verify code-reviewer FLAG-1 corrected enumeration).

- **H.8.8** `validate-kb-doc.js` substrate-enforced kb authoring discipline (final H.8.x phase). Closes chaos-20260508-191611-h83-trilogy theo F8 PRINCIPLE — kb authoring rules previously lived in `swarm/kb-architecture-planning/_PRINCIPLES.md` document only; nothing in the substrate enforced them. **NEW** `hooks/scripts/validators/validate-kb-doc.js` — PreToolUse:Edit|Write hook that fires on edits to `kb/architecture/**.md` paths and asserts: (a) frontmatter has required fields `kb_id` + `tags`; (b) body has required H2 sections `## Summary` + `## Quick Reference` (fence-aware via H.8.7 fence-aware extraction). When discipline is missing, emits `[KB-DOC-INCOMPLETE]` Class 1 advisory forcing instruction with detailed missing-piece list + canonical structure template. Per ADR-0001 fail-open: hook errors return `{decision: approve}`. Bypass: `SKIP_KB_DOC_CHECK=1` env var. **10th forcing instruction** in the family (post-H.8.2 had 9; cap rule N=15 still has 5-headroom). Wired into `hooks/hooks.json` PreToolUse:Edit|Write entry. **Convention G + forcing-instruction-family.md** updated: active count restored 9 → 10 with H.8.8 transition row. Plugin manifest 1.8.1 → 1.9.0 (minor — new hook surface). 3 NEW install.sh smoke tests (66 forcing-instruction emit, 67 silent on complete doc, 68 SKIP_KB_DOC_CHECK bypass). 64/64 install.sh smoke (was 61/61; +3 H.8.8); 0 contract-validate violations. **Closes the H.8.x cleanup arc**: H.8.4 (security hot-fix) → H.8.5 (wire H.8.3) → H.8.6 (RPI infrastructure) → H.8.7 (chaos batch) → H.8.8 (substrate-enforced kb authoring). Sets up post-H.8.x break + Hardening Track (HT.0 audit + HT.1+ refactor backlog using RPI as canonical workflow).

- **H.8.7** Batch chaos H1-H5 fixes — first RPI cycle. **Inaugural plan artifact**: `swarm/thoughts/shared/plans/2026-05-09-H.8.7-batch-h1-h5-chaos-fixes.md` (6 phases, all `- [x]` complete; H.8.6 RPI infrastructure dogfooded). Closes 5 HIGH-class chaos findings + 2 MEDIUM + 1 LOW from chaos-20260508-191611-h83-trilogy super-root report. **Phase 1 (chaos H4 — DRY)**: NEW `scripts/agent-team/_lib/frontmatter.js` extracted as canonical YAML-frontmatter parser. Both kb-resolver.js and adr.js previously had divergent inline implementations with different bug surfaces (kb-resolver: no block-list support; adr.js: didn't honor null literal; both: digit-bearing keys silently dropped). Canonical parser supports scalar fields, quoted scalars, inline arrays, block lists, null literals, digit-bearing keys (closes chaos eli LOW-3 sibling). **Phase 2 (chaos H1 + M2)**: `kb-resolver.extractSections` now fence-aware (lines starting with ` ``` ` toggle inFence state; section boundaries inside fences ignored) AND start-name-precise (`## Summary` matches only `## Summary` (with optional whitespace-only suffix); not `## Summary of Findings`). **Phase 3 (chaos H2)**: `adr.js touched-by` path-segment-aware. Previous `endsWith` allowed `barfoo.js` to match `foo.js` ADR entry; now requires `/` boundary for suffix matches. **Phase 4 (chaos H3 + H5)**: H3 — `cmdNew` YAML-escapes title (`\` → `\\`, `"` → `\"`); rejects newlines in title input; titles with `"` no longer corrupt frontmatter. H5 — `cmdNew` ID-claim wrapped in `withLock` (filesystem lock at `${ADRS_DIR}/.cmdNew.lock`); concurrent invocations no longer claim same ID. **Phase 5 (chaos M3 + L1)**: M3 — `adr.js listAdrFiles` adds `lstatSync` symlink defense; symlinks in ADRS_DIR are filtered. L1 — `isActive` defensively handles both `null` (canonical post-frontmatter-fix) and `'null'` string (legacy on-disk). **Phase 6 (tests + manifest)**: 5 NEW install.sh tests (61: helper extracted + consumers wired; 62: extractSections fence-aware fixture; 63: touched-by true-positive vs false-positive; 64: cmdNew YAML-escape end-to-end; 65: symlink defense). Plugin manifest 1.8.0 → 1.8.1 (patch — backward-compatible bug fixes; CLI surface unchanged). 61/61 install.sh smoke (was 56/56; +5 H.8.7); 0 contract-validate violations. **Note: parseFrontmatter no longer exported from adr.js module** (was internal; consumers should use `_lib/frontmatter.js` directly). **Closure**: H.8.7 closes the chaos H1-H5 batch + the M2 + M3 + L1 carry-overs from the H.8.4 hot-fix; sets up H.8.8 (validate-kb-doc.js substrate-enforced kb authoring) as the final H.8.x cleanup phase.

- **H.8.6** Adopt RPI (Research → Plan → Implement) infrastructure from canonical [humanlayer/advanced-context-engineering-for-coding-agents](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents) (Dex Horthy / HumanLayer 2025). Doctrine pivot toward four-dimensional context engineering (Correctness > Completeness > Size > Trajectory) and Frequent Intentional Compaction (40-60% utilization range). **Doc-only / additive**: no runtime hooks, no behavior changes, no breaking changes; legacy `/plan` + `/build-plan` + `/build-team` + `/chaos-test` flows fully preserved. **NEW slash commands**: `commands/research.md` (Research step — documentary, no critique; spawns documentary sub-agents) + `commands/implement.md` (Implement step — phase-by-phase pause-for-verification; resumable via plan-file checkboxes). Existing `/plan` becomes the canonical Plan step. **NEW filesystem layout**: `swarm/thoughts/{,shared/research,shared/plans}/` with READMEs codifying the lifecycle, frontmatter schema, and content discipline; tracked in git as durable per-project memory across sessions. **NEW documentary persona contracts** (14-codebase-locator, 15-codebase-analyzer, 16-codebase-pattern-finder) — each carries `documentary: true` flag + `_documentary_note` explaining the discipline + `noCritiqueLanguage` antiPattern check listing forbidden phrases (`should be`, `recommend`, `anti-pattern`, etc.) + `fallbackAcceptable` instructing the persona to surface critique requests as handoffs to critic personas (architect / code-reviewer / security-engineer) rather than editorialize. **NEW pattern doc**: `skills/agent-team/patterns/research-plan-implement.md` (status `active`) — 20th in patterns/README; cites canonical authority; documents when to use RPI vs `/build-team` vs `/build-plan` vs `/plan`; documents 5 failure modes (F1 critique-leak, F2 missing-success-criteria, F3 implement-skips-pause, F4 research-without-search, F5 plan-staleness); documents reference implementation. **Bidirectional `related:` invariant**: 6 sibling pattern docs updated (validator-conventions, system-design-principles, route-decision, plan-mode-hets-injection, asymmetric-challenger, forcing-instruction-family) — plus 3 pre-existing latent violations exposed when `plan-mode-hets-injection.md`'s YAML format was normalized to inline (route-decision + asymmetric-challenger + convergence-as-signal each got `plan-mode-hets-injection` added; previously the validator silently skipped the unparseable nested-list format). Plugin manifest 1.7.2 → 1.8.0 (minor — new commands + new personas + new filesystem layer; SemVer minor for additive-non-breaking). 56/56 install.sh smoke (was 53/53; +3 H.8.6: tests 58 documentary-contracts-present, 59 slash-commands-present, 60 thoughts-filesystem-present); 0 contract-validate violations (down from 18 — closed 3 latent bidirectional bugs as side effect of format normalization). Sets up H.8.7 (first real RPI cycle = batch chaos H1-H5 fixes) and HT.0+ (Hardening Track audit using RPI as canonical workflow).

- **H.8.5** Wire H.8.3 (`build-spawn-context.js`) into `commands/build-team.md` spawn flow + retract overstatement of H.8.3's lift. Closes chaos-20260508-191611-h83-trilogy theo F3 (PRINCIPLE — H.8.3 unwired YAGNI inversion). NEW Step 1.5 in build-team.md "Pre-spawn context auto-extension" — runs after the pre-flight check, before tech-stack-analyzer is invoked; calls `build-spawn-context.js --task "$TASK_DESCRIPTION" [--files "..."]` to build the team-wide spawn-context block; result `$SPAWN_CONTEXT` flows through to Step 7's `spawn_implementer` calls as a prefix prepended to each identity's persona/task block (signature extended: `spawn_implementer "$IDENTITY" "$TASK" "$SPAWN_CONTEXT"`). Per ADR-0001 fail-open: if helper errors, `$SPAWN_CONTEXT` becomes empty string and spawns proceed without the prefix — substrate degrades gracefully. **Retraction**: H.8.3 CHANGELOG entry's "Pure composition" claim corrected to "Composition layer with thin formatter logic (~150 LoC formatter + CLI on top of subprocess invocation; no new domain rules)" per quinn PARTIAL verdict on Claim 4. SKILL.md H.8.3 entry similarly corrected. **Doc-only / wiring change** — no behavior change in compiled artifacts; the build-team chat-agent flow gains the prefix step. Plugin manifest 1.7.1 → 1.7.2 (patch — additive wiring + claim correction). 53/53 install.sh smoke (unchanged from H.8.4; no new test surface — the wiring is at the chat-agent-instruction layer; existing tests 52-54 already verify build-spawn-context.js produces valid context). Closes chaos PRINCIPLE-class debt PC1 from chaos-20260508-191611 super-root report.

<!-- security: critical — H.8.4 closes shell-injection RCE (CVSS local-tool; chaos-20260508-191611-h83-trilogy) + Cyrillic homograph dead-regex (HIGH) + routing-rule count drift (HIGH). Patch bump for security hot-fix: local-tool RCE on subprocess composition + dead-regex routing failure. CLI surface unchanged. CHANGELOG annotated `security: critical` for downstream scanners. -->
- **H.8.4** Shell injection RCE fix + Cyrillic homograph fix + routing rule count correction. **Security: CRITICAL** (chaos run chaos-20260508-191611-h83-trilogy). Three findings closed:
  - **C1 (RCE — CRITICAL)**: `build-spawn-context.js` and `validate-adr-drift.js` both used `execSync(shellString)` to invoke sub-scripts, building the shell command via string concatenation with user-controlled arguments. POC confirmed: `--task 'foo $(touch /tmp/PWNED) bar'` triggered arbitrary command execution; the fail-open hook discipline (ADR-0001) masked the attack by returning `decision: approve` on error, meaning attackers who killed the subprocess still got through. **Fix**: NEW shared helper `scripts/agent-team/_lib/safe-exec.js` exporting `invokeNodeJson()` and `invokeNodeText()` — both use `execFileSync('node', [scriptPath, ...args])` (argument array; never passed through a shell). Both vulnerable files refactored to consume the helper. DRY extraction per architect FLAG-1: single fix site for both call patterns. Four existing `execSync` sites verified safe (fixed-string git args, no user-controlled data); one-line comment added at each: `hooks/scripts/console-log-check.js:18,29,34` (git rev-parse, git diff, git ls-files) and `hooks/scripts/_lib/marketplace-state-reader.js:50` (git log). **Patch bump per SemVer (backward-compatible bug fix; CLI surface unchanged). Note: CVE-class internal — local-tool exploitation requires attacker control of `--task` argument or hook stdin payload, which is the user's own input on their own machine. Severity rationale documented for downstream scanning.**
  - **C2 (Cyrillic homograph — HIGH)**: `architecture-relevance-detector.js` line 98 contained `/\bouтbox\s+pattern\b/i` with a Cyrillic `т` (U+0442) instead of ASCII `t`, silently disabling the `outbox pattern` routing rule. The detector reported 21 rules in `list-signals` (counting the broken entry) but never matched the rule in practice. **Fix**: replaced with `/\boutbox\s+pattern\b/i` (pure ASCII). Verification: `grep -P '[^\x00-\x7F]' architecture-relevance-detector.js` (scoped to regex literals) returns zero lines post-fix.
  - **CC1 (count doc drift)**: `CHANGELOG.md` and `skills/agent-team/SKILL.md` both documented an outdated count of `rule_count: 20`; canonical count from `list-signals` is 21. **Fix**: updated both to the correct canonical of 21 rules.
  - **Tests added**: Test 55 (shell-injection regression — 7 adversarial payloads including `$(...)`, backtick, semicolon, pipe, `&&`, comma-injection via `--files`, and hook stdin path), Test 56 (non-ASCII regex-literal invariant — scans `scripts/`, `hooks/scripts/`, `swarm/` for non-ASCII chars inside regex literals on non-comment lines), Test 57 (routing-rule count invariant — queries canonical `rule_count` from detector and checks it matches all doc mentions). **Adversarial fixture**: `swarm/test-fixtures/malicious-task-strings.json` with 7 payloads (t55-01 through t55-07).

- **H.8.3** HETS spawn context auto-extension primitive — closes the H.8.x trilogy. NEW `scripts/agent-team/build-spawn-context.js` (~280 LoC) composes the three previously-shipped primitives (architecture-relevance-detector from H.8.1 + adr.js touched-by from H.8.2 + kb-resolver tier-aware loading from H.8.0) into a single helper that produces a structured spawn-time context block. **Composition layer with thin formatter logic** (~150 LoC of CLI parsing + text/JSON formatting + Map-based ADR deduplication on top of subprocess invocation; no new domain rules). The "Pure composition" framing in the original H.8.3 entry overstated the lift; this entry is the corrected statement (per chaos-20260508-191611-h83-trilogy honesty-auditor.quinn PARTIAL verdict on Claim 4). The substrate becomes "auto-RAG-anchoring at spawn time" when this helper is used in build-team workflow. **CLI**: `--task <text>` (required) + optional `--files "f1,f2"` (for ADR matching) + optional `--tier T` (override detector recommendation) + optional `--cap N` (max kb refs) + optional `--format text|json` (paste-inline default; structured output for programmatic use). **Output structure**: detected signals (from architecture-relevance-detector) + recommended tier + KB refs loaded at that tier (via kb-resolver `cat-summary` / `cat-quick-ref` / `cat`) + active ADRs touching specified files (via adr.js touched-by). **Per ADR-0001 fail-open discipline**: each subprocess invocation is wrapped; failures log to stderr; whatever context could be assembled is returned (empty context is a valid output). Plugin manifest 1.6.0 → 1.7.0 (minor — new substrate primitive). 3 NEW install.sh smoke tests (52-54): composes detector+kb-resolver into structured context; surfaces active ADRs when `--files` matches; `--format json` produces parseable structured output. **Verification**: 50/50 install.sh smoke (was 47/47; +3 H.8.3); 0 contract violations. Fully composable: `bash` users invoke via CLI; programmatic consumers `require()` the module exports (`buildContext`, `formatText`, `formatJson`). **HETS spawn flow integration ready**: future build-team workflow integration would invoke this helper at spawn time and inject output into spawn prompt; substrate-curated kb anchoring + drift-aware ADR injection becomes automatic per spawn. **Closes H.8.x trilogy**: kb-resolver tier-aware (H.8.0) + architecture-relevance-detector (H.8.1) + ADR primitive (H.8.2) + this composition layer (H.8.3) form a complete RAG-shaped retrieval pipeline.

- **H.8.2** ADR primitive substrate ship. Closes the cross-spawn drift fix at the substrate level (drift-note 21 lineage). Three components: (1) NEW `swarm/adrs/` directory with structured `_TEMPLATE.md` + `_README.md` documenting the ADR convention; first seed ADR `0001-substrate-fail-open-hook-discipline.md` codifies the substrate's existing fail-open hook discipline retrospectively (14 hooks affected; 4 invariants introduced). (2) NEW `scripts/agent-team/adr.js` (~280 LoC) — CLI for managing ADRs: `new --title "..."` auto-increments ID; `list [--status S]` filters; `read <id>` prints content; `active` lists currently-effective ADRs; `touched-by <file>` returns active ADRs whose `files_affected` includes the given file (consumed by the hook). YAML frontmatter parser handles structured fields (adr_id, title, status, files_affected, invariants_introduced) including list syntax. (3) NEW `hooks/scripts/validators/validate-adr-drift.js` (~115 LoC) — PreToolUse:Edit|Write hook that emits `[ADR-DRIFT-CHECK]` forcing instruction (the 9th in the family — Class 1 advisory per Convention G; cap rule N=15 still has 6-headroom). When editing a file in any active ADR's `files_affected`, surfaces the matched ADRs with their invariants; Claude reads + decides whether the edit preserves invariants; bypass via `SKIP_ADR_CHECK=1` env var (matches `verify-plan-gate.js` pattern). Per ADR-0001: hook fails-open with observability — errors logged via `logger('error', ...)`; on hook failure returns `decision: approve`. **Convention G + forcing-instruction-family.md** updated: active marker count restored 8 → 9 with H.8.2 transition row. Plugin manifest 1.5.0 → 1.6.0 (minor — new substrate primitive + new hook surface). 5 NEW install.sh smoke tests (47-51): adr.js list shows seed ADR; adr.js touched-by detects file matches; hook emits forcing instruction on ADR-managed file; hook silent on non-ADR-managed; bypass works. **Verification**: 47/47 install.sh smoke (was 42/42; +5 H.8.2); 0 contract-validate violations. Sets up HETS spawn flow integration (architect persona writes ADRs for routed work; subsequent spawns receive active ADRs in kb_scope) — that integration is separate phase work. Soak counter remains at 0/N (runtime change continues drift risk).

- **H.8.1** architecture-relevance-detector substrate primitive. NEW `scripts/agent-team/architecture-relevance-detector.js` (~360 LoC). Maps task descriptions to relevant `kb/architecture/` refs via deterministic regex matching. BM25-style term-based retrieval (per the rag-anchoring.md pattern doc): pure function, no LLM compute, no vector index, fast, predictable token budget. **21 routing rules** in two tiers — direct kb-doc-name matches (highest precision; weight 3) for explicit pattern mentions like "Single Responsibility Principle", "DIP", "circuit breaker", "RAG"; signal-category patterns (broader concepts; weight 2) for state-mutation, concurrency, multi-file-change, error-handling, module-boundary, performance-scaling, api-design, reliability-production, llm-agent, shared-utility-extraction, architectural-decision. **Output**: JSON with matched signals + kb_refs (deduplicated, capped at 5) + tier recommendation (1-2 signals → summary; 3-4 → quick-ref; 5+ → full). **CLI**: `detect --task "<text>" [--tier T] [--cap N]` and `list-signals`. **Tier scaling**: light tasks get cheap Tier 1 injection; complex multi-signal tasks escalate to Tier 2 (Quick Reference) for richer context. Compatible with H.8.0 kb-resolver subcommands: detector returns refs + tier; consumer pipes through `kb-resolver cat-summary` / `cat-quick-ref` / `cat`. Plugin manifest 1.4.0 → 1.5.0 (minor — new substrate primitive). 3 NEW install.sh smoke tests (44-46): state-mutation routes to idempotency; no-match returns empty refs + summary tier; multi-signal task escalates to quick-ref tier. 42/42 smoke (was 39/39; +3 H.8.1 tests). Sets up Phase H.8.2 (ADR primitive — structured `swarm/adrs/` + cross-spawn read enforcement + drift detection); also enables HETS spawn flow integration in subsequent phases (kb_scope auto-extension based on detector output). Forward-compatible with hybrid retrieval if needed later (BM25 + embedding-based fallback). Soak counter resets per substrate discipline (runtime change).

- **H.8.0** kb-resolver tier-aware loading. First post-soak runtime change; ends H.7.x cycle and enters H.8.x integration phase. Two new subcommands extract specific tiers from authored `kb/architecture/` pattern docs: `cat-summary` returns only the `## Summary` section (Tier 1, ~120 tokens — cheap inline injection); `cat-quick-ref` returns `## Summary` + `## Quick Reference` together (Tier 2, ~700-800 tokens — design-in-progress refresher). The existing `cat` subcommand is unchanged (Tier 3, full content). Both new subcommands fall back gracefully on docs without `## Quick Reference` section: `cat-quick-ref` returns just the Summary plus an informational stderr note; `cat-summary` returns full body if no Summary section exists. Helper function `extractSections()` extracts contiguous H2-bounded ranges from doc bodies via regex matching. Per the H.7.27 measurement experiment on `single-responsibility.md`: tier-aware retrieval saves ~91% on average injection size (frequency-weighted with realistic 80/15/5 mix). Plugin manifest 1.3.3 → 1.4.0 (minor — new feature). 3 NEW install.sh smoke tests (41-43): cat-summary returns only Summary; cat-quick-ref returns Summary + Quick Reference; cat-quick-ref falls back to Summary + stderr note on docs without Quick Reference. 39/39 smoke (was 36/36; +3 H.8.0 tests). Sets up Phase H.8.1 (architecture-relevance-detector) and Phase H.8.2 (ADR primitive). The 10 first-wave kb/architecture/ docs already have the tier structure shipped via PRs #109-#112; this phase ships the runtime to consume it. Soak counter resets to 0/5 (runtime change carries drift risk per substrate discipline).

- **H.7.27** `[MARKDOWN-EMPHASIS-DRIFT]` migration to markdownlint pipeline (closes architect FLAG #6 from H.7.25). Mechanical migration of the misclassified Class 1 marker that the H.7.25 audit identified as wrong-tool ("recovery is mechanical, not semantic — wrap underscores in backticks"). Detection now absorbed by `markdownlint-cli2` MD037 rule (default-enabled in `.markdownlint.json`); CI's existing markdown-lint job catches the cluster pattern at PR time. **Empirical validation**: the same fixture that triggered the retired hook (`HETS_TOOLKIT_DIR _h70-test _lib/` paragraph) also triggers MD037 in `markdownlint-cli2` — confirms the lint pipeline absorbs the detection completely. **Files removed**: `hooks/scripts/validators/validate-markdown-emphasis.js` (~230 LoC). **Files changed**: `hooks/hooks.json` (PostToolUse:Edit|Write entry removed); `forcing-instruction-family.md` (#8 marked RETIRED-in-H.7.27 with rationale); `validator-conventions.md` Convention G failure-modes section + cap rule updated for 8-active state; `plugin.json` 1.3.2 → 1.3.3 (patch). **install.sh tests**: 19-21 (PostToolUse hook assertions) replaced with single MD037 absorption check (verifies markdownlint catches the same cluster pattern). **Active marker count**: 9 → 8. **Soak-period entry conditions met**: 5+ phases of zero new drift-notes captured begins now. Migration shape "lint pipeline absorption" preferred over PreToolUse hard-gate codified in Convention G failure-modes section.

- **H.7.26** Forcing-instruction consolidation execution (closes drift-note 57). Shipped the two consolidation candidates surfaced by H.7.25's family-level audit. **Sub-phase 1 — `[CONFIRMATION-UNCERTAIN]` consolidated into `[PROMPT-ENRICHMENT-GATE]`**: `prompt-enrich-trigger.js` now emits a unified `[PROMPT-ENRICHMENT-GATE]` marker with `tier:` discriminator (`tier: full-enrichment` for vague prompts requiring 4-part enrichment; `tier: short-confirm` for short ambiguous confirmation prompts requiring prior-turn consultation). Same hook, same layer, same semantic — performative differentiation removed. Body text preserves the lightweight "consult prior turn" semantic recovery action under the unified marker. **Sub-phase 2 — `[PLUGIN-NOT-LOADED]` retired**: `hooks/scripts/plugin-loaded-check.js` deleted; entry removed from `hooks/hooks.json` UserPromptSubmit and `hooks/settings-reference.json`. The same substrate state (marketplace registered + plugin not enabled) is already covered by `session-reset.js`'s inverse-condition stderr branch (Class 2 honest, SessionStart) — duplication across SessionStart stderr + UserPromptSubmit stdout collapsed to the SessionStart layer only. **Sub-phase 3 — Catalog + Convention G updates**: `forcing-instruction-family.md` marks #3 + #9 as RETIRED-in-H.7.26 (with rationale for each); top-level Class 1 / Class 2 example lists updated; new "Active marker counts" table tracks H.7.23.1 peak (11) → H.7.26 (9) → H.7.27 planned (8). `validator-conventions.md` Phase footers updated. Plugin manifest 1.3.1 → 1.3.2 (patch — refactor + retirement; no behavior changes for callers). install.sh: tests 27-28 (PLUGIN-NOT-LOADED) retired; test 10 updated to assert `tier: short-confirm` body field. **Active marker count**: 11 → 9. **Drift-note 57 closed**. Soak-period entry conditions: -1 phase to go (H.7.27 [MARKDOWN-EMPHASIS-DRIFT] migration).

- **H.7.25** Forcing-instruction family retrospective + Convention G + catalog (closes drift-note 21). Audits the 11-instruction family that drift-note 21 captured as "architectural smell." Reframes the smell from "band-aiding what should be hard gates" to "compositional growth that bifurcated into three semantic classes without an explicit taxonomy." **Sub-phase 1**: NEW `skills/agent-team/patterns/forcing-instruction-family.md` (~200 LoC catalog) — 11 instructions × {class, landing rate, phase-tag origin, verdict, action}. Frontmatter `related: [validator-conventions, route-decision]`. **Convention G** added to `validator-conventions.md` (~120 LoC additive between Convention E and Related Patterns) — 3-class taxonomy: Class 1 (advisory forcing instruction; deterministic detection + semantic recovery via stdout), Class 2 (operator notice; status surface via stderr), Class 1 textual variant on hard-gate substrate (PreToolUse `decision: block` borrowing forcing-instruction text shape — single-instance variant, not peer class per architect FLAG #4). Cap rule **N=15** active markers (per architect FLAG #3 — bumped from 12; 6-headroom over current 9 active = ~7 phases at 0.85/phase growth rate). Decision tree + failure modes + reference implementations included. **Sub-phase 2**: 9 cross-reference comments added to emission files (`prompt-enrich-trigger.js`, `route-decide.js`, `error-critic.js`, `session-self-improve-prompt.js`, `validate-plan-schema.js`, `validate-markdown-emphasis.js`, `plugin-loaded-check.js`, `session-reset.js`, `verify-plan-gate.js`) — placement after architecture comment block, before first declaration. Two markers FLAGGED for follow-on phases: `[MARKDOWN-EMPHASIS-DRIFT]` → H.7.27 markdownlint-pipeline migration; `[PLUGIN-NOT-LOADED]` → H.7.26 retirement (consolidate into `[MARKETPLACE-STALE]` Class 2). **Sub-phase 3**: `plugin.json` 1.3.0 → 1.3.1 (patch — documentation-only); SKILL.md / BACKLOG.md / CHANGELOG.md / patterns/README.md updated; install.sh tests 39-40 (table-row context grep for all 11 markers + Convention G structural tokens including "Class 1", "Class 2", "decision tree", "N=15"). **Pre-Approval Verification (4th consecutive phase)**: parallel architect + code-reviewer spawn caught 7 FLAGs (no FAILs, no BLOCKED); all 7 fixes incorporated. Architect produced explicit Principle Audit per H.7.22 contract — 4-for-4 success rate. **Recursive dogfood**: `[ROUTE-META-UNCERTAIN]` (substrate-meta detection) fired correctly on this very phase's route-decide call — substrate auditing itself catches its own meta-meta state. **Net post-H.7.26**: 11 → 9 active markers (consolidation deferred). **Drift-note 21 closure**: smell explained as compositional growth, not contaminating; Convention G names the 3 classes. Drift-notes 56/57/58/59 captured.

- **H.7.24** Substrate UX hardening 6-pack (closes drift-notes 39/46/49/50/51/52). Post-major-cycle polish bundling 6 distinct UX rough edges accumulated during H.7.22 / H.7.23 / H.7.23.1 cycle. **Sub-phase 1 (drift-note 39)**: principle codification extended from `architect.md` (Layer 1+2) to 4 non-architect agents — `planner.md`, `code-reviewer.md`, `optimizer.md`, `security-auditor.md` — each gets Layer 1 (foundational SOLID/DRY/KISS/YAGNI). code-reviewer.md adds new PRINCIPLE severity tier between HIGH and MEDIUM. planner.md ADR template + optimizer.md report template extended. `03-code-reviewer.contract.json` F7 + `12-security-engineer.contract.json` F10 add `containsKeywords` checks (parallel to architect's F6). `architect.md` adds reference-shape note for future design-shaped agents (drift-note 53). **Sub-phase 2 (drift-note 49)**: bulk frontmatter audit — 9 SKILL.md files (prompt-enrichment / skill-forge / research-mode / fullstack-dev / agent-swarm / self-improve / swift-development / deploy-checklist / tech-stack-analyzer) gained `name:` + `description:` frontmatter. Now 17/17 SKILL.md files have frontmatter; H.7.20 validator's `Edit\|Write` matcher will catch any future skill file missing frontmatter. **Sub-phase 3 (mechanical fixes)**: `contracts-validate.js` `contract-plugin-hook-deployment` extended with informational stderr when enabledPlugins truthy but CLAUDE_PLUGIN_ROOT unset (drift-note 50; **per code-reviewer FLAG #1** NOT auto-pass — settings-side signal weaker, could mask broken install). `auto-release-on-tag.yml` switched from `git tag -l --format='%(contents)'` (returns empty in CI) to `git for-each-ref` + explicit `git fetch --tags --force` (drift-note 51). `prompt-enrich-trigger.js` adds SKIP pattern `^\s*\?+\s*$` for repeated `?` (drift-note 52; **per code-reviewer FAIL #3** narrowed to `?`-only matching YAGNI claim). `session-reset.js` env-var override `CLAUDE_MARKETPLACE_STALE_DAYS` with input validation (drift-note 46; **per code-reviewer FLAG #4** Number.isFinite + positive check + stderr warning on invalid). **Sub-phase 4**: plugin manifest 1.2.1 → 1.3.0 (minor — agent-md modifications affect HETS spawn API surface); workflow.md adds principle codification scope note. **Pre-Approval Verification (3rd consecutive phase)**: parallel architect + code-reviewer spawn caught 1 FAIL + 7 FLAGs; all 8 fixes incorporated before user surfacing. Architect produced explicit Principle Audit per H.7.22 contract — 3-for-3 success rate. 38/38 install.sh smoke; 46/46 _h70-test. Drift-notes 53/54 captured.

- **H.7.23.1** (UX completion) Auto-trigger `/verify-plan` via PreToolUse:ExitPlanMode gate. Closes the gap left by H.7.23 — invocation was manual, requiring users to remember. NEW `hooks/scripts/validators/verify-plan-gate.js` blocks ExitPlanMode if active plan is HETS-routed AND missing `## Pre-Approval Verification` section. Block reason emits `[PRE-APPROVAL-VERIFICATION-NEEDED]` (11th forcing instruction in family) directing Claude to run `/verify-plan` first. Block-and-retry pattern mirrors `fact-force-gate` "must Read before Edit." Bypass via `SKIP_VERIFY_PLAN=1` env var. Manifest 1.2.0 → 1.2.1 (patch). 3 new smoke tests (33-35). 35/35 passing. Drift-note 21 (forcing-instruction smell) gets one notch deeper — future arc retrospective candidate.

- **H.7.23** Distribution-channel + verification-discipline hardening 6-pack (closes drift-notes 37/40/41/42/43/44). Codifies the verification discipline that should have prevented the 3 H.7.22 hotfix sequence. **Sub-phase 1**: vendored `swarm/schemas/{plugin-manifest,marketplace}.schema.json` from schemastore.org for offline-CI reliability + `refresh-plugin-schema.sh` manual refresh helper + NEW `hooks/scripts/_lib/marketplace-state-reader.js` (DRY API). **Sub-phase 2**: NEW `contract-marketplace-schema` validator targeting the 3 specific H.7.22 failure patterns (regex on marketplace source / regex on plugin.json paths / redundancy flag); empirically catches H.7.22.1 bug pattern when seeded. `validate-plan-schema.js` Tier 1 conditional extended with Pre-Approval Verification section requirement. `session-reset.js` third diagnostic branch — `[MARKETPLACE-STALE]` 10th forcing instruction (LOCAL git timestamp, no `git fetch`). **Sub-phase 3**: NEW `/verify-plan` slash command + `skills/verify-plan/SKILL.md` codifying the parallel architect + code-reviewer pre-approval verification pattern; aggregator helper does NOT spawn (split design). **Sub-phase 4**: NEW `phase-tag-version-check.yml` (CI fails if `phase-H.*` tag pushed without manifest bump) + `auto-release-on-tag.yml` (auto-publishes GitHub Release on `v*` semver tags using tag annotation as notes — not CHANGELOG which uses permanent `[Unreleased]`). **Sub-phase 5**: workflow.md adds 2 new sections (pre-approval verification rule + schema source-of-truth rule); manifest 1.1.3 → 1.2.0 (minor per semver §7 — new slash command is feature addition); 3 install.sh tests (30-32). **Pre-Approval Verification (recursive dogfood)**: parallel spawn caught 5 substantive issues + 4 plan-honesty issues; all 8 fixes incorporated before user surfacing. **Architect spawn empirically validated**: H.7.22's drift-note 36 fix confirmed working. Drift-notes 45/46/47/48/49 captured.

- **H.7.22.1** (hotfix) Marketplace source format fix. `.claude-plugin/marketplace.json` declared `"source": "."` — Claude Code's plugin schema requires path-based sources to match `^\./.*` (must start with `./`). The `"."` value (no trailing slash) was rewritten to `"unsupported"` by the schema validator, surfacing `"This plugin uses a source type your Claude Code version does not support"` when user ran `/plugin install power-loom@power-loom-marketplace` post-migration. Fix: `"."` → `"./"` (one character). Manifest version bumped 1.1.0 → 1.1.1. Drift-notes 41 (marketplace mirror staleness — third manual git-pull needed) and 42 (marketplace.json schema validation gap in `contract-plugin-hook-deployment`) captured.

- **H.7.22** System Design Principles in HETS substrate + Plugin Distribution Validation + R/A/FT Primitives (closes drift-notes 33/34/36). **Concern 1**: 42 sessions in 24h showed plugin never installed via `/plugin install`; 3 PostToolUse hooks (H.7.7/H.7.12/H.7.18) never wired in real config. **Concern 2**: SOLID/DRY/KISS/YAGNI/clean-code principles not codified in HETS substrate. Both shared root cause: discipline-by-default not codified. **Phase 1**: `fundamentals.md` expanded to KISS/DRY/SOLID/YAGNI; NEW `system-design-principles.md` pattern doc; `architect.md` Principles section restructured (Layer 1 foundational + Layer 2 design qualities); ADR template adds Principle Audit field; `04-architect.contract.json` adds F6 (`containsKeywords` on Principle Audit); `super-agent.md` adds Principle Adherence Summary section. **Phase 2**: `validate-plan-schema.js` Tier 1 conditional check requires `## Principle Audit` when plan involves architectural decisions (HETS Spawn Plan or `recommendation: route`). **Phase 3**: plugin manifest `1.0.0 → 1.1.0`; NEW `bin/migrate-to-plugin.sh` (with bash-bug fixes from code-reviewer review baked in); `install.sh` banner clarifies legacy fallback; `README.md` install section restructured plugin-first. **Phase 4**: NEW `hooks/scripts/_lib/settings-reader.js` (DRY shared API); NEW `contract-plugin-hook-deployment` validator detecting un-deployed hooks + matcher drift, auto-passing in CI. **Phase 5**: NEW `hooks/scripts/plugin-loaded-check.js` (UserPromptSubmit; emits `[PLUGIN-NOT-LOADED]` forcing instruction — 9th in family); `session-reset.js` extended with inverse-condition stderr nudge. **Phase 6**: install.sh tests + self-improve `/plugin` candidate promoted. **Pre-Approval Verification (NEW PROCESS — drift-note 40)**: parallel architect + code-reviewer spawn pre-ExitPlanMode caught 4 HIGH/CRITICAL bugs (3 bash bugs + 1 false-negative auto-pass) + 4 plan-honesty issues; all 15 fixes incorporated before user surfacing. Drift-notes 35/37/38/39/40 captured.

- **H.7.21** Edit-result scan in `validate-no-bare-secrets.js` + Convention E (closes drift-note 29). Phase 1 audit of all 4 PreToolUse validators found 1 real Edit-coverage gap (secrets validator scanned `new_string` only, missed assignment-completion patterns from surrounding context); 2 are tool-agnostic by design (config-guard path-based, fact-force-gate read-tracker). Validator's Edit branch now reads existing file + applies proposed edit (handles `replace_all` + MultiEdit `edits[]`) + scans full post-edit result. Falls back to `new_string`-only scan if file unreadable. **Convention E** added to `validator-conventions.md`: Edit-result-aware (Pattern 1) vs tool-agnostic (Pattern 2) decision tree + reference table. Convention D table updated for H.7.20 + H.7.21 matcher changes. 3 new smoke tests (24-26): Edit-completes-assignment blocks; Edit-unrelated-text approves; Edit-with-pre-existing-secret blocks. 26/26 install.sh smoke (was 23/23). Drift-notes 30/31/32 captured.

- **H.7.20** Extend `validate-frontmatter-on-skills.js` to Edit (closes drift-note 28). Prior validator only blocked Write events; Edit that removes frontmatter silently passed. Validator now handles Edit by reading existing file + applying proposed edit + checking result. Per Convention D (H.7.19), validator stays PreToolUse — silent-failure-prevention gate. `hooks.json` matcher updated `Write` → `Edit|Write`. 2 new smoke tests (22-23): Edit-removes-frontmatter blocks; Edit-preserves-frontmatter approves. 23/23 install.sh smoke (was 21/21). Drift-note 29 captured (audit other PreToolUse validators for similar Edit-coverage gaps).

- **H.7.19** PreToolUse-vs-PostToolUse audit + Convention D codification (closes drift-note 25). Audit found all 4 PreToolUse hooks correctly placed (silent-failure-prevention or security gates); all 3 PostToolUse hooks correctly clean. No migrations needed. NEW Convention D in `skills/agent-team/patterns/validator-conventions.md`: decision tree for hook layer placement (PreToolUse for true gates, PostToolUse for advisory). NEW section in `rules/core/workflow.md` codifying the same. Pure documentation phase; no code changes. 21/21 install.sh smoke (regression); 46/46 _h70-test (regression). Drift-note 28 captured (validate-frontmatter-on-skills only blocks Write, not Edit).

- **H.7.18** Markdown emphasis validator (closes drift-note 19). NEW `hooks/scripts/validators/validate-markdown-emphasis.js` (~165 LoC, 14th hook) catches the underscore-emphasis bug pattern that bit me 3 times this session. Tiered enforcement — Tier 1: 2+ unbackticked underscore-bearing tokens in same paragraph → `[MARKDOWN-EMPHASIS-DRIFT]` forcing instruction (8th in family); Tier 2: 1 isolated token → stderr informational. PostToolUse:Edit|Write per H.7.17 lesson. NEW Convention C in `validator-conventions.md` (tiered enforcement matches actual writing variance — reinforces H.7.12 model). NEW `workflow.md` section on markdown emphasis discipline. Pre-plan audit by Explore agent (user-requested) found 0 confirmed-broken + 4 latent clusters in `BACKLOG.md`; spot-fixed inline. 21/21 install.sh smoke (was 18/18; +3 H.7.18 tests). 46/46 _h70-test (regression).

- **H.7.17** Migrate `validate-plan-schema.js` from PreToolUse:Edit\|Write to PostToolUse:Edit\|Write per theo's H.7.9 Section C original spec. Closes drift-note 10 definitively after `claude-code-guide` agent confirmed PostToolUse supports any tool name including Write/Edit. Output semantics adjusted: dropped `{decision: "approve"}` JSON (PostToolUse doesn't expect it); forcing instruction `[PLAN-SCHEMA-DRIFT]` now goes to stdout (matches `error-critic.js` PostToolUse pattern). Tier 3 stays on stderr. 18/18 smoke tests still pass (regression). Drift-notes 10 + 23 closed; drift-notes 24 (claude-code-guide as substrate-research tool) + 25 (audit PreToolUse-vs-PostToolUse decisions for conservative deviations) captured.

- **H.7.16** Substrate-meta routing detection + PostToolUse:Write empirical investigation. Closes drift-notes 9 + 10 (deferred from H.7.15 as architectural/investigative). Architect: `04-architect.mira`. Pure-additive `route-decide.js` extension: NEW `SUBSTRATE_META_TOKENS` constant (17 tokens, 2 tiers) + `detectSubstrateMeta()` + `buildMetaForcingInstruction()` emitting `[ROUTE-META-UNCERTAIN]` (7th in forcing-instruction family) + 3 new output JSON fields. **NOT touching** `WEIGHTS`/`WEIGHTS_VERSION`/scoring math (theo's load-bearing comment honored). 6 H.7.3 baselines byte-identical. 46/46 _h70-test (was 41/41; +5 H.7.16 assertions). Recursive-dogfood property: detector catches its own design task. Drift-note 10 PostToolUse:Write empirical test inconclusive in-session (likely hooks.json caching); status quo (PreToolUse:Write per H.7.12) validated as correct conservative path; fresh-session test deferred to H.7.17. Convergence with theo: agree.
- **H.7.15** Drift-note housekeeping bundle: closes 5 of 7 pending drift-notes (mechanical + process scope; architectural pieces deferred per AskUserQuestion). NEW `skills/agent-team/patterns/validator-conventions.md` (pattern #17) codifying validator concerns-separation + self-documenting stderr message conventions (drift-notes 7 + 8). NEW "CI infrastructure changes (H.7.15)" section in `rules/core/workflow.md` codifying CI dogfood discipline (drift-note 5). `validate-plan-schema.js` extended to support `CLAUDE_PLAN_DIR` env var for custom plan paths (drift-note 12). install.sh subdir-glob audit closed clean (drift-note 13). 18/18 smoke tests (was 17/17). Bidirectional frontmatter reverse-links updated on 3 referenced patterns.
- **H.7.14** Drift-note 6 audit: extract canonical `findToolkitRoot()` helper across substrate family. NEW `scripts/agent-team/_lib/toolkit-root.js` (~88 LoC) extracted from contracts-validate.js's H.7.10 inline copy. 6 callers refactored: `contracts-validate.js`, `_lib/runState.js`, `kb-resolver.js`, `budget-tracker.js`, `pattern-runner.js`, `agent-identity.js:_readPersonaContract`. All preserve their `HETS_X_DIR` env-var override; only the second fallback (was hardcoded `~/Documents/claude-toolkit/`) now uses the shared helper. CI-environment simulation verified — scripts work correctly from `/tmp` via walk-up branch. Closes drift-note 6 (substrate-wide hardcoded-path anti-pattern). Net LoC reduction.
- **H.7.13** Agent discipline + JSDoc polish (closes H.7.7 deferral). Per-function JSDoc (@param/@returns + concise descriptions) added to 7 hook scripts: `session-end-nudge.js`, `auto-store-enrichment.js`, `fact-force-gate.js`, `prompt-enrich-trigger.js`, `pre-compact-save.js`, `error-critic.js`, `_lib/file-path-pattern.js`. Total: 59 @param/@returns lines. Agents at `agents/` already consistent (Phase 1 confirmed) — no agent work. Comments-only; zero behavior delta. **Meta-validation of H.7.11 v1.2 dict**: counter_signals (`polish`, `jsdoc`, `comment`, `formatting`) fired on H.7.13 task → root 0.037 confidence 0.875. H.7.11 expansion working as designed.
- **H.7.12** Plan-template enforcement hook (tiered-mandatory + PreToolUse:Write + nudge). NEW `hooks/scripts/validators/validate-plan-schema.js` (~250 LoC) with 3-tier enforcement (Tier 1 truly mandatory, Tier 2 conditional on new-style plan, Tier 3 aspirational stderr-only). Hook fires PreToolUse:Edit|Write on `~/.claude/plans/*.md` paths; emits `[PLAN-SCHEMA-DRIFT]` forcing instruction to stderr when Tier 1 or Tier 2 sections missing; never blocks (`decision: approve` always). Closes theo's H.7.9 Section C deferral with honest revision (PostToolUse:Write spec → PreToolUse:Write reality). Hook count: 12 → 13. Smoke tests: 13 → 17 (+4 H.7.12 tests). **Bonus install bug fix**: `install_hooks()` now copies `validators/` and `_lib/` subdirectories — pre-H.7.12 the legacy validators were unreachable via `$CLAUDE_DIR` (only `${CLAUDE_PLUGIN_ROOT}` worked).
- **H.7.11** Route-decide dictionary expansion (closes drift-notes 1 + 4). `weights_version` bumped `v1.1-context-aware-2026-05-07` → `v1.2-dict-expanded-2026-05-07`. ~50 new tokens across 5 dimensions + counter_signals. Strictly additive: no weight/threshold/dimension/suppression changes. Architect: `04-architect.ari` paired with `04-architect.theo` (`--convergence agree`). Drift-note 1 was root 0.225 → borderline 0.525; drift-note 4 was root 0.112 → route 0.675. All 6 H.7.3 calibration baselines byte-identical post-expansion (additive-only invariant). 9 new regression tests in `_h70-test.js` Section 6 (32 → 41 passing).
- **H.7.10** Mira retrospective fixes via `/build-plan` (recursive dogfood). Applies all 3 CRITICAL + 2 HIGH findings from mira's H.7.7+H.7.8 retrospective using the `/build-plan` flow shipped in H.7.9 — proves the abstraction is sound by eating own dogfood.
- **H.7.9** HETS-in-plan-mode injection. NEW `commands/build-plan.md` (dual-gate slash command modeled on `/build-team`); NEW `skills/build-plan/SKILL.md`; NEW `swarm/plan-template.md` (canonical plan template with mandatory sections — Context / Routing Decision verbatim JSON / HETS Spawn Plan / Files / Phases / Verification / Out of Scope / Drift Notes); NEW `skills/agent-team/patterns/plan-mode-hets-injection.md` (16th pattern). Converts soft-norm plan-mode + HETS-spawn discipline (`rules/core/workflow.md`) into a sharper gate without merging it with the route-decide gate. Recursive-dogfood property: theo (architect) designed the pattern using the pattern; mira (different identity, same persona family) authored the H.7.7+H.7.8 retrospective that motivated it.
- **`/plan` vs `/build-plan` decision tree** added to `rules/core/workflow.md`. Both coexist (additive). `/build-plan` Step 0's `root` recommendation redirects cleanly to `/plan`.
- **Drift-note convention** in plan files — captures soft-norm-drift observations during plan work; feeds the auto-loop's session-end review per `rules/core/self-improvement.md`.
- **H.7.7** substrate primitive additions (Critic→Refiner failure-consolidation hook + workflow-state-aware pre-compact). NEW `hooks/scripts/error-critic.js` (~210 LoC); workflow-state-aware `pre-compact-save.js` (+80 LoC); 2 new smoke tests (10 → 12).
- **H.7.8** plugin-dev tooling discipline. NEW `.markdownlint.json`, `.editorconfig`, `.github/workflows/ci.yml` (3 parallel jobs: smoke / markdown-lint / json-validate). README CI status badge.
- **install.sh test 13** — Cross-session leak detection (load-bearing property: state persistence across test boundary, NO rm-rf between tests 12 and 13).

### Fixed (H.7.10)

- **error-critic.js C-1 (TMPDIR session leak)** — Path now session-scoped: `${TMPDIR}/.claude-toolkit-failures/<SESSION_ID>/<key>.{count,log}`. SESSION_ID from `CLAUDE_SESSION_ID`/`CLAUDE_CONVERSATION_ID` env or random hex fallback. macOS-aware (was Linux-assumption broken).
- **error-critic.js C-2 (RMW race)** — Count + log RMW blocks now wrapped in `withLock` from `scripts/agent-team/_lib/lock.js`. H.3.2 canonical primitive used across kb-resolver/budget-tracker/tree-tracker.
- **session-reset.js C-1 defense-in-depth** — Cleans stale `.claude-toolkit-failures/<session-dir>/` entries > 1 day old at SessionStart.
- **pre-compact-save.js C-3 (SAVE_PROMPT integration)** — Replaced static const + suffix-append with dynamic `buildSavePrompt(activeRuns)`. Workflow-state integrates as NUMBERED 4th task INSIDE the 1-3 list, not as unnumbered H2 suffix. Error branch no longer glues suffix to error text.
- **pre-compact-save.js H-1 (path priority)** — `TOOLKIT_RUN_STATE_CANDIDATES` reordered: env vars (`CLAUDE_TOOLKIT_PATH`, `CLAUDE_PLUGIN_ROOT`) → cwd → walk-up from `__dirname` → hardcoded LAST. Closes silent no-op for non-author installs.
- **pre-compact-save.js H-2 (recency filter)** — `MAX_ACTIVE_AGE_MS = 4 hours`; runs older than 4hr filtered out before being marked "active". Verified: 29 stale → 1 active in current state.

---

## [1.0.0] — 2026-05-07 — `power-loom` (rename + evolution-loop ship)

**The H.7.x evolution-loop arc completed.** Plugin renamed from `claude-skills-consolidated` to `power-loom`. SemVer adopted. Stability commitment in README.

### Added

- **H.7.0** evolution loop + drift detection + multi-axis trust signal — `agent-identity breed` subcommand, parent-child generation propagation, diversity guard at breed-time, population cap, user-gate on first breed per persona; specialization-aware `cmdAssign`; drift triggers in `cmdRecommendVerification` (recalibration_due, task-novelty mismatch, quality-trend-down); new score-affecting axis `task_complexity_weighted_pass` (theory-driven +0.10 weight; reuses route-decide 7-dim score for bucketing); new observable axes `recency_decay_factor` (30-day half-life) and `qualityTrend` (3-spawn windowed slope). `WEIGHT_PROFILE_VERSION` bump to `"h7.0-multi-axis-v1"`. ~250 LoC code + 514 LoC tests + 210 LoC pattern doc.
- **CHANGELOG.md** — this file. Aggregates phase history into versioned releases.
- **Stability commitment** section in README — explicit stable / evolving / experimental classification.
- **Differentiation table** in README vs adjacent official marketplace plugins (`code-review`, `hookify`, `feature-dev`, `claude-md-management`, `claude-code-setup`).

### Changed

- **Plugin renamed** from `claude-skills-consolidated` to `power-loom` (`.claude-plugin/plugin.json` `name` field; `marketplace.json` references). Industrial Revolution metaphor: power-loom (Edmund Cartwright, 1784) automated coordination of weaving; this plugin does the same for multi-agent coordination on Claude Code. Skill namespace migrates from `/claude-skills-consolidated:X` to `/power-loom:X`.
- **Version** bumped from `0.5.0` to `1.0.0` (SemVer adopted; first stable release).
- **GitHub repo renamed** from `shashankcm95/claude-skills-consolidated` to `shashankcm95/claude-power-loom`. GitHub auto-redirects from old URL but URLs in the repo (homepage, install instructions, tag references) updated to the new canonical form. Phase tags + bookmarks under the old URL continue to resolve via redirect.

### Architecture commitments held

- `tierOf` byte-for-byte unchanged at `agent-identity.js:98-105` (H.4.2 audit-transparency commitment); 31/31 active identities had identical tier output pre/post H.7.0.
- All schema changes additive; legacy verdicts handled via `_backfillSchema` (renamed from `_backfillH66Schema`).
- No subprocess LLM calls (toolkit's deterministic-substrate convention preserved).

### Cycle data

mira (04-architect, medium-trust) caught 3 CRITICAL pushbacks before implementation: (C-1) multiplicative composition `composite = passRate × complexity × decay` had degenerate zeros — fix: composition stays additive within bonus; (C-2) `recency_decay` cannot be empirically fit at n=35 / 5.11d span — fix: ship as observable-only with theory-driven defaults until n≥30/span≥30; (C-3) new `task_complexity` verdict field would shift `aggregateQualityFactors` denominator silently — fix: derive at aggregate-time from existing `task_signature`. kira (13-node-backend) shipped per spec; convergence agree.

---

## [0.8.0] — 2026-05-07 — Today's session (5 phases)

### Added

- **H.7.5** route-decision context-awareness + forcing-instruction fallback. `--context` flag for `route-decide.js`; borderline-promotion rule (mira CRITICAL C-1 math fix); `[ROUTE-DECISION-UNCERTAIN]` forcing instruction. Closes the H.7.4 false-negative where bare task scored 0/root because routing signal lived in prior turn. `weights_version` bumped to `"v1.1-context-aware-2026-05-07"`.
- **H.4.3** prompt-enrich-trigger intent-aware skip. SKIP_PATTERNS extended for confirmation variants (`sure, go for it`, `let's go with X`, `ship it`, `make it so`); `[CONFIRMATION-UNCERTAIN]` forcing instruction for short ambiguous prompts. 3 new smoke tests (10 total now).

### Fixed

- **publish-polish-H.0** — 6 actionable items from prior plugin-readiness reviews: plugin.json `$schema` + explicit component paths; entities.json "Severity" anomaly; mempalace.yaml keyword dedupe; ATTRIBUTION smoke-test count (8→7→10); .gitignore tracked-file contradiction; install.sh recursive copy for `scripts/agent-team/`.
- **CS-13** IRL test environment isolation completion. `HETS_SPAWN_HISTORY_PATH` + `HETS_PATTERNS_PATH` env-var overrides on `spawn-recorder.js` + `pattern-recorder.js`. Coverage matrix now 4 of 4 (joins `HETS_IDENTITY_STORE` H.2.4 + `HETS_RUN_STATE_DIR` H.5.5).

---

## [0.7.0] — 2026-05-06 / 2026-05-07 — Trust formula evolution (H.7.x arc through H.7.4)

### Added

- **H.7.4** empirical refit of weighted trust score weights from accumulated 70 pattern entries. `file_citations_per_finding` `0.10 → 0.135` (Pearson r=0.439, moderate confidence); other 5 axes keep theory-driven priors (sparse data or weak correlation). Architect override on `tokens` axis (normative penalty vs descriptive correlation; sample-censoring confound). New `WEIGHT_PROFILE_VERSION = "h7.4-empirical-v1"`. **First production firing of H.7.1 high-trust spot-check**: A2 noTextSimilarityToPriorRun marked `skipped` for HIGH-TRUST `04-architect.ari`.
- **H.7.3** route-decision intelligence. `scripts/agent-team/route-decide.js` (CLI; pure-function 7-weighted-dimension scoring: stakes, novelty, compound, audit, scope, convergence, user-facing). Two thresholds (route ≥0.60, root ≤0.30, borderline between). New Step 0 in `commands/build-team.md` short-circuits before tech-stack-analyzer fires. New `Route-Decision for Non-Trivial Tasks` rule in `rules/core/workflow.md`. n=20 toolkit-wide builder verdict milestone hit; H.7.4 unblocked.
- **H.7.2** theory-driven weighted trust score. `computeWeightedTrustScore(stats, aggregateQF)` returns `{score, passRate, quality_bonus, components, ...}`. `score = passRate × (1 + clamped_bonus)` with cap [-0.10, +0.50]. Theory-driven weights with research citations (Dunsmore 2003, Bacchelli & Bird MSR 2013, Cohen's κ / Krippendorff's α). `tierOf` UNCHANGED.
- **H.7.1** asymmetric-challenger callsite wired into `/build-team` Step 7 (~93-line bash flow with three branches keyed off `recommend-verification.verification` field). New `cmdAssignPair` subcommand. Convergence axis: `pattern-recorder.js` extended with `--paired-with` + `--convergence agree|disagree|n/a`.
- **H.7.0-prep** hybrid quality factors + validation_sources registry. Identity records carry `quality_factors_history` array (per-verdict 5 axes: findings_per_10k, file_citations_per_finding, cap_request_actionability, kb_provenance_verified, tokens). Validation_sources registry extends `kb:hets/canonical-skill-sources` schema with optional RFC/NIST/paper citations.

---

## [0.6.0] — 2026-05-04 / 2026-05-06 — Substrate maturity cycle (H.5.1 through CS-6)

### Added

- **CS-6** end-user `skills/agent-team/USING.md` walkthrough (283 lines). 7-step product-engineer audience guide with worked example threading H.6.8 rate-limiting task. **First asymmetric architect+confused-user pair-run**. **First identity to reach HIGH-TRUST tier** (`04-architect.ari`).
- **H.5.7** engineering-task contract template (`swarm/personas-contracts/engineering-task.contract.json`). Generic shared template with engineering-fit thresholds (minFindings ≥1, hasFileCitations ≥1, no severity sections required, no audit-keywords). `commands/build-team.md` Step 7 task-type heuristic with `--task-type` override + extended audit-verb regex. Closes M-5 from H.6.9.
- **H.6.0–H.6.9** orchestration cycle: spawn-recorder for visibility; abstract-task orchestration walkthrough; Node/Express routing coherence (13-node-backend persona + contract + KB docs); skill-forge auto-warn at assign-time (`forgeNeeded` field surfaced); missing-capability-signal pattern (sub-agents diagnose; root acquires); lifecycle primitives (soft-retire + specialist-tag + L3-forward schema); canonical-source registry (24 entries: skill-name → official-docs URL); first-post-H.6.7 orchestration test (13-node-backend.kira PASS); full 5-task / 5-PASS orchestration cycle.
- **H.5.6** first builder dogfood run (12-security-engineer.mio authors auditor kb_scope; verdict PASS). First builder verdict ever recorded; populates real trust-formula data.
- **H.5.5** architectural cleanup — `hierarchical-aggregate.js` location decided; `_lib/runState.js` extracted (closes "_lib/ is a directory of one" finding).

### Fixed

- **H.5.1–H.5.4** CS-3 bundle: pattern status sync (9 patterns → active); KB exemption documentation; CS-3 CRIT bundle (5 fixes — kb_scope provenance via transcript checking; secrets validator hardening for github_pat_; README hook-count consistency; plugin install path documentation; Edit-tool secret scan field correction); self-improve-store hardening + frontmatter BOM (6 CS-3 HIGHs); remaining CS-3 HIGH cluster (filePath regex, CLAUDE_PLUGIN_ROOT verification, README clarity).

---

## [0.5.0] — 2026-05-02 — Initial Claude Code plugin packaging (H.5.0)

### Added

- Three plugin manifests at repo root per `code.claude.com/docs/en/plugins-reference` schema: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `marketplace.json`.
- 11 deterministic hooks across 5 lifecycle events (SessionStart, UserPromptSubmit×2, PreToolUse×4, PreCompact, Stop×3): fact-force-gate, config-guard, console-log-check, pre-compact-save, prompt-enrich-trigger, session-reset, session-end-nudge, session-self-improve-prompt, auto-store-enrichment, validate-no-bare-secrets, validate-frontmatter-on-skills.
- HETS substrate: 13 personas (5 auditors + 8 builders), persistent identity reputation in `~/.claude/agent-identities.json`, triple-contract verification (functional + anti-pattern + structural), kb_scope enforcement with transcript provenance, content-addressed shared knowledge base.
- Auto self-improve loop with risk taxonomy (low → auto-graduate; medium → queue; high → manual `/self-improve`).
- Chaos-test meta-validation infrastructure (`/chaos-test`).
- Two install paths: plugin marketplace + legacy `install.sh`. Both produce identical `~/.claude/` state.
- Anti-AI-slop differentiation table in README comparing the plugin's enforcement footprint to typical SKILL.md-template plugins.

### Note on pre-0.5.0

The toolkit existed for 50+ phases prior to 0.5.0 (H.1 through H.4.2 + earlier). 0.5.0 is the first version with formal Claude Code plugin packaging. See annotated tags `phase-H.1` through `phase-H.4.2` for the phase-by-phase pre-packaging history; pre-0.5.0 work was direct-to-main before the CONTRIBUTING.md PR-flow conventions adopted at H.2.8.

---

## Unreleased

See [skills/agent-team/BACKLOG.md](skills/agent-team/BACKLOG.md) for deferred items. Major future directions:

- **HETS-on-git portfolio** (deferred on substrate gap — needs per-agent git credentials)
- **H.7.5+ refit** of recency_decay + qualityTrend axes (gated on n≥30/span≥30 days per identity)
- **Auto-mode breeding** (gated on observed population dynamics over ≥3 cycles)
- **Cross-version tracking** for route-decide ↔ agent-identity profile dependency

---

[1.0.0]: https://github.com/shashankcm95/claude-power-loom/releases/tag/v1.0.0
[0.8.0]: https://github.com/shashankcm95/claude-power-loom/releases/tag/phase-H.4.3
[0.7.0]: https://github.com/shashankcm95/claude-power-loom/releases/tag/phase-H.7.4
[0.6.0]: https://github.com/shashankcm95/claude-power-loom/releases/tag/phase-CS-6
[0.5.0]: https://github.com/shashankcm95/claude-power-loom/releases/tag/phase-H.5.0
