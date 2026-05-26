# Markdownlint debt — pre-existing violations unmasked by Phase 0 specs move

**Status**: open (tracked debt)
**Surfaced**: 2026-05-26 (Phase 0 Step 10 smoke iteration)
**Owner**: deferred to post-v3.0-alpha cleanup
**Test guard**: `tests/smoke-ht.sh` Test 80 (markdownlint smoke) + `.github/workflows/ci.yml` Markdown lint job

## Provenance

These violations are **not regressions caused by Phase 0**. They are pre-existing in the markdown content under `swarm/thoughts/shared/{plans,research}/` and `swarm/H.*-findings.md`. The original `tests/smoke-ht.sh` Test 80 and CI `Run markdownlint` invocation both excluded `swarm/` via the `#swarm` glob exclude pattern (rationale captured in `.github/workflows/ci.yml:59-60`: *"those are historical phase findings docs; lint would noise + research/plan/HT-state narrative with carve-out backtick patterns"*).

Phase 0 Step 9 moved:
- `swarm/thoughts/shared/plans/*` → `packages/specs/plans/*`
- `swarm/thoughts/shared/research/*` → `packages/specs/research/*`
- `swarm/H.*-findings.md` + `swarm/CS-*-findings.md` → `packages/specs/findings/*`

The `#swarm` exclude no longer matches the new paths. The lint glob `**/*.md` now picks them up. Same content, same violations, newly visible.

## Verification of pre-existence

Spot-check: `packages/specs/research/HT-state.md:302` col 1700-1850 contains literal text `tutional discipline). **Verification**: 75/75 install.sh smoke unchanged...` — the `** ` pattern that triggers `MD037/no-space-in-emphasis`. Confirmed identical bytes via `git show main:swarm/thoughts/shared/HT-state.md | sed -n '302p'` at the pre-Phase-0 path. Pre-existing.

## Phase 0 disposition

Test 80 (smoke-ht.sh) + `.github/workflows/ci.yml` updated to add `#packages/specs` to the exclude patterns. This **restores the pre-Phase-0 exclusion semantic exactly** — research/plan/findings docs were not lint-enforced before, are not lint-enforced now. Net behavior change: zero.

The 35 violations remain in the files (no content edits in Phase 0 — `git mv` only).

## Full violation list (35 errors, 3 rule categories, 13 files)

### Errors by rule

| Rule | Count | Description |
|---|---|---|
| `MD037/no-space-in-emphasis` | 20 | Pattern `_text _` or `_ text_` — emphasis marker with adjacent whitespace breaks the emphasis. Most are research-doc patterns where `_` is used as a list separator or numeric subscript (`6 _foo`), not actual emphasis. |
| `MD038/no-space-in-code` | 10 | Pattern `` ` text ` `` — backtick code span with leading/trailing space inside the span. Mostly multi-line YAML examples inside backticks where the natural indentation looks like padding. |
| `MD056/table-column-count` | 5 | Markdown table rows with cell count mismatched to header. Plan-shaped tables documenting changes where some rows have collapsed columns. |

### Errors by file

| File | Count |
|---|---|
| `packages/specs/research/HT-state.md` | 18 |
| `packages/specs/plans/2026-05-09-H.8.7-batch-h1-h5-chaos-fixes.md` | 3 |
| `packages/specs/plans/2026-05-10-HT.1.7-adr-retroactive-shape.md` | 2 |
| `packages/specs/plans/2026-05-10-HT.2.2-parsefrontmatter-yaml-comment-strip.md` | 2 |
| `packages/specs/plans/2026-05-12-H.9.6.2-test83-hardening.md` | 2 |
| `packages/specs/findings/H.5.7-findings.md` | 1 |
| `packages/specs/plans/2026-05-10-HT.1.6-documentary-persona-md.md` | 1 |
| `packages/specs/plans/2026-05-10-HT.2-doc-lag-measurement-methodology-sweep-master-plan.md` | 1 |
| `packages/specs/plans/2026-05-11-H.9.4-pending-docs-completion.md` | 1 |
| `packages/specs/plans/2026-05-11-H.9.5-yamllint-frontmatter.md` | 1 |
| `packages/specs/plans/2026-05-11-HT.3.1-adr-tier-taxonomy.md` | 1 |
| `packages/specs/plans/2026-05-12-H.9.15-chaos-findings-closure.md` | 1 |
| `packages/specs/plans/2026-05-24-v3.0-multiphase-hets-execution-plan.md` | 1 |

### Hotspot: `HT-state.md` (51% of errors)

18 of 35 errors live in the single HT-state.md research log. Most are MD037 patterns where `_` shows up as a structural separator in narrative tables (`6 _foo`, `, _bar`) rather than markdown emphasis. A fix-in-place pass should:
- Replace `_` separators with `\_` (escaped) or alternate notation
- Wrap problematic emphasis-adjacent patterns in code spans
- Or reformat to avoid the pattern entirely

## Full error log

```
packages/specs/findings/H.5.7-findings.md:147:53 error MD037/no-space-in-emphasis Spaces inside emphasis markers [Context: "6 _"]
packages/specs/plans/2026-05-09-H.8.7-batch-h1-h5-chaos-fixes.md:62:188 error MD038/no-space-in-code Spaces inside code span elements [Context: "`  - one`"]
packages/specs/plans/2026-05-09-H.8.7-batch-h1-h5-chaos-fixes.md:108:39 error MD038/no-space-in-code Spaces inside code span elements [Context: "`  - architecture/ai-systems/a..."]
packages/specs/plans/2026-05-09-H.8.7-batch-h1-h5-chaos-fixes.md:154:1 error MD056/table-column-count Table column count [Expected: 4; Actual: 3; Too few cells, row will be missing data]
packages/specs/plans/2026-05-10-HT.1.6-documentary-persona-md.md:71:147 error MD038/no-space-in-code Spaces inside code span elements [Context: "`  - <kb_id>  # planned — not ..."]
packages/specs/plans/2026-05-10-HT.1.7-adr-retroactive-shape.md:54:61 error MD056/table-column-count Table column count [Expected: 3; Actual: 10; Too many cells, extra data will be missing]
packages/specs/plans/2026-05-10-HT.1.7-adr-retroactive-shape.md:60:140 error MD056/table-column-count Table column count [Expected: 3; Actual: 5; Too many cells, extra data will be missing]
packages/specs/plans/2026-05-10-HT.2-doc-lag-measurement-methodology-sweep-master-plan.md:133:139 error MD038/no-space-in-code Spaces inside code span elements [Context: "`  - architecture/ai-systems/a..."]
packages/specs/plans/2026-05-10-HT.2.2-parsefrontmatter-yaml-comment-strip.md:18:315 error MD038/no-space-in-code Spaces inside code span elements [Context: "`  - architecture/ai-systems/a..."]
packages/specs/plans/2026-05-10-HT.2.2-parsefrontmatter-yaml-comment-strip.md:169:79 error MD038/no-space-in-code Spaces inside code span elements [Context: "`# `"]
packages/specs/plans/2026-05-11-H.9.4-pending-docs-completion.md:150:74 error MD037/no-space-in-emphasis Spaces inside emphasis markers [Context: "+ _"]
packages/specs/plans/2026-05-11-H.9.5-yamllint-frontmatter.md:71:55 error MD038/no-space-in-code Spaces inside code span elements [Context: "`  - value`"]
packages/specs/plans/2026-05-11-HT.3.1-adr-tier-taxonomy.md:209:115 error MD037/no-space-in-emphasis Spaces inside emphasis markers [Context: "+ _"]
packages/specs/plans/2026-05-12-H.9.15-chaos-findings-closure.md:106:117 error MD038/no-space-in-code Spaces inside code span elements [Context: "`*/$ `"]
packages/specs/plans/2026-05-12-H.9.6.2-test83-hardening.md:135:265 error MD038/no-space-in-code Spaces inside code span elements [Context: "`Results: `"]
packages/specs/plans/2026-05-12-H.9.6.2-test83-hardening.md:152:188 error MD056/table-column-count Table column count [Expected: 3; Actual: 2; Too few cells, row will be missing data]
packages/specs/plans/2026-05-24-v3.0-multiphase-hets-execution-plan.md:131:221 error MD056/table-column-count Table column count [Expected: 2; Actual: 3; Too many cells, extra data will be missing]
packages/specs/research/HT-state.md:302:1771 error MD037/no-space-in-emphasis Spaces inside emphasis markers [Context: "3 _"]
packages/specs/research/HT-state.md:303:2065 error MD037/no-space-in-emphasis Spaces inside emphasis markers [Context: "3 _"]
packages/specs/research/HT-state.md:304:3477 error MD037/no-space-in-emphasis Spaces inside emphasis markers [Context: "3 _"]
packages/specs/research/HT-state.md:314:89 error MD037/no-space-in-emphasis Spaces inside emphasis markers [Context: "2 _"]
packages/specs/research/HT-state.md:316:1304 error MD038/no-space-in-code Spaces inside code span elements [Context: "`  - <kb_id>  # planned — not ..."]
packages/specs/research/HT-state.md:318:5384 error MD037/no-space-in-emphasis Spaces inside emphasis markers [Context: "6 _"]
packages/specs/research/HT-state.md:324:4855 error MD037/no-space-in-emphasis Spaces inside emphasis markers [Context: "6 _"]
packages/specs/research/HT-state.md:328:5145 error MD037/no-space-in-emphasis Spaces inside emphasis markers [Context: "6 _"]
packages/specs/research/HT-state.md:334:1797 error MD037/no-space-in-emphasis Spaces inside emphasis markers [Context: "6 _"]
packages/specs/research/HT-state.md:335:1631 error MD037/no-space-in-emphasis Spaces inside emphasis markers [Context: "6 _"]
packages/specs/research/HT-state.md:338:1762 error MD037/no-space-in-emphasis Spaces inside emphasis markers [Context: "2 _"]
packages/specs/research/HT-state.md:355:74 error MD037/no-space-in-emphasis Spaces inside emphasis markers [Context: "2 _"]
packages/specs/research/HT-state.md:369:1494 error MD037/no-space-in-emphasis Spaces inside emphasis markers [Context: ", _"]
packages/specs/research/HT-state.md:374:1350 error MD037/no-space-in-emphasis Spaces inside emphasis markers [Context: "a _"]
packages/specs/research/HT-state.md:746:737 error MD037/no-space-in-emphasis Spaces inside emphasis markers [Context: "6 _"]
packages/specs/research/HT-state.md:750:1041 error MD037/no-space-in-emphasis Spaces inside emphasis markers [Context: "6 _"]
packages/specs/research/HT-state.md:919:256 error MD037/no-space-in-emphasis Spaces inside emphasis markers [Context: "2 _"]
packages/specs/research/HT-state.md:925:571 error MD037/no-space-in-emphasis Spaces inside emphasis markers [Context: "ee _"]
```

## Reproducing this list

```bash
# Same exact command that produced this list (note: deliberately bypasses the
# Test 80 / CI exclusion so it surfaces the debt for tracking).
cd <repo-root>
npx --yes markdownlint-cli2 \
  "packages/specs/research/**/*.md" \
  "packages/specs/plans/**/*.md" \
  "packages/specs/findings/**/*.md" \
  "#node_modules"
```

## Remediation plan (post-v3.0-alpha)

Three tiers, smallest first:

1. **Tier 1 (5 MD056 fixes)** — table-column-count is a structural issue; trivially fixed with `|` padding or row reformatting. Low risk. Estimated: ~15 min.
2. **Tier 2 (10 MD038 fixes)** — backtick spans with leading/trailing space inside. Mechanical: replace `` ` text ` `` with `` ` text` `` or use code blocks. Low risk. ~30 min.
3. **Tier 3 (20 MD037 fixes)** — emphasis-marker spacing. Mostly HT-state.md hotspot (18 of 20). Requires per-instance judgment: was `_` intended as emphasis (rewrite), separator (escape with `\_`), or numeric subscript (rewrite as `<sub>`)? ~60 min.

After remediation, remove `#packages/specs` from Test 80 + CI exclusion to enable enforcement, then re-run to confirm zero errors.

## Test 80 exclusion (current Phase 0 disposition)

```bash
# tests/smoke-ht.sh Test 80
npx --yes markdownlint-cli2 \
  "**/*.md" \
  "packages/specs/kb-architecture-planning/**/*.md" \
  "#node_modules" "#swarm" "#bench/runs" "#packages/specs"
```

```yaml
# .github/workflows/ci.yml Markdown lint job
- name: Run markdownlint
  run: npx --yes markdownlint-cli2 "**/*.md" "#node_modules" "#swarm" "#packages/specs"
```

The `packages/specs/kb-architecture-planning/**/*.md` include glob (still in Test 80) overrides the `#packages/specs` exclude — KB architecture planning docs remain enforced. The exclusion only covers `research/`, `plans/`, `findings/`, `adrs/`, `rfcs/`, `spikes/`, `bench/`, `architecture-substrate/`, `test-fixtures/` content.
