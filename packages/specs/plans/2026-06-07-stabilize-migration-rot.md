# Stabilize the migration-rot — clean plugin base state

## Context

A "Phase-0 / v4 workspace restructure" moved the plugin's files (`scripts/agent-team/*` → `packages/runtime/orchestration/` + `packages/kernel/`; `swarm/thoughts/*` → `packages/specs/`) and **flattened `scripts/`** to 7 top-level files. The *enforced* layer (hooks.json, CI, install.sh) was updated — but the *human-facing references* (command bodies, skill/pattern docs, one validator's regexes, one generator's source paths) were not. A 4-agent research audit (research-mode, evidence-cited) found the "frankenstein" feeling is **localized**, not pervasive:

- **NOT broken** (do not touch): the persona system is an intentional 3-layer split (`agents/*.md` registration → `runtime/personas/NN-*.md` behavior → `contracts/*.json` enforcement, CI-reconciled by `contracts-validate.js`); **0 dead modules**; hooks.json all-resolve; `scan-stale-artifacts.js` reports CLEAN; archive well-curated.
- **The actual rot** = dangling *references* from the move: **2 runtime bugs** + **~35 doc-rot files** + **1 dead-path generator** + minor consistency items.

**Outcome:** the codebase stops tripping on moved paths; the dead frontmatter-gate is revived to actually protect skills. Delivered as **2 PRs** (functional fixes, then a mechanical doc sweep).

## Routing Decision

`route-decide` scores `root` (substrate-vocab gap). **Judgment-override → ROUTE:** a kernel-validator change (safety-control revival) + multi-area remediation across ~40 files. Per-wave rigor applies (`/verify-plan` + 3-lens VALIDATE on PR1).

## Scope

**IN:** A1 build-team dead paths · A2 frontmatter-gate revival · C doc-rot sweep · D generator repoint + CI `--check` · E archive superseded drafts + phase-close consistency.
**OUT (decided with user):** B = the 3 dormant modules (`kernel/_lib/lineage.js`, `runtime/orchestration/weight-fit.js`, `quality-factors-backfill.js`) → **KEEP** (inert, not "tripping" rot; lineage.js is K9-adjacent, the CLIs are operator tools). The persona 3-layer system (intentional). ADRs/historical specs (immutable record).

---

## PR1 — Functional fixes (tested + 3-lens VALIDATE)

Supersedes the in-flight `fix/frontmatter-gate-exclude-commands` branch (its partial edit is folded into A2's fuller fix). Branch fresh off `main`. **Order matters: A2 before A1** (the gate must permit editing the command doc — A2's fix is re-read by the PreToolUse hook on the next edit).

### A2 — revive the frontmatter gate (`packages/kernel/validators/validate-frontmatter-on-skills.js`)
The `REQUIRES_FRONTMATTER` regexes (`:28-32`) expect `skills/<dir>/SKILL.md` + `skills/agent-team/patterns/` — but the post-restructure layout is `skills/library/<skill>/SKILL.md` + `skills/library/agent-team/patterns/`. **Probe:** tested `skills/library/react/SKILL.md` → NOMATCH → the gate currently protects **nothing real**; its only live effect was mis-blocking `skills/commands/*`.
- Repoint the patterns to the real layout: `skills/library/<skill>/SKILL.md` and `skills/library/agent-team/patterns/*.md` (broaden, keep them anchored).
- Keep the `SKIP_DIR_PATTERNS` exclusion for `skills/commands/` (commands ship frontmatter-less — 13/14; loader registers regardless).
- Add `contract-format.md` to `SKIP_BASENAMES` (the 1 legit frontmatter-less library doc — a reference/schema doc, sibling to README/BACKLOG; confirmed by audit).
- **Test (TDD) — verify-plan code-reviewer FAIL-1, MUST fix:** the EXISTING smoke fixtures (`tests/smoke-h7.sh` Test 22/23) use `/tmp/h7-20-skills/skills/test/SKILL.md` (OLD layout). The repointed regex NOMATCHes that path → the tests would silently false-green the moment A2 lands. So **UPDATE the Test 22/23 fixture paths to `skills/library/test/SKILL.md`** (not just "extend"), AND add new cases: a command doc → **approve**; `contract-format.md` → **approve**. The block-on-frontmatter-removal invariant must still hold against the NEW-layout fixture.

### A1 — fix `/build-team`'s dead paths (`packages/skills/commands/build-team.md`)
Lines 17,35,54-56,68,93,96,162 **and 207** (verify-plan FLAG-4 — 207 is an uncounted prose ref) invoke `scripts/agent-team/{build-team-helpers.sh,kb-resolver.js,agent-identity.js}` — all moved. Repoint via the verified mapping (below); all map to `runtime/orchestration/` (no special-case targets in this file). Probe: targets confirmed present. Note the bash blocks at `:35,54-56,93,96` are inside ```fences — edit the path text, preserve the fence structure (FLAG-3 care). A2-before-A1 ordering holds: on a fresh branch off `main` the commands-exclusion isn't present yet, so the gate WOULD block this edit until A2 lands.

### D — repoint + CI-wire the generator (`scripts/generate-persona-agents.js` + `.github/workflows/ci.yml`)
Source-verification paths (`:29-30`) point at dead `swarm/personas` + `swarm/personas-contracts` → it aborts if run today. (Its *rendered output* paths are already correct.) Decision: **repoint + CI-wire `--check`** (skill-forge owns evolution-time new-persona generation; this stays a fixed-roster integrity guard).
- `:29` → `packages/runtime/personas`; `:30` → `packages/runtime/contracts`.
- Add a CI step running `node scripts/generate-persona-agents.js --check` (exit 1 if any roster stub missing) — turns dead tooling into a live guard against the original "5/16 stubs missing → general-purpose fallback" drift. **verify-plan code-reviewer FAIL-2:** `main()` runs the source-path existence check (`:181-196`) BEFORE `--check`, so against current code `--check` exits **2** ("source missing", the dead `swarm/` paths), NOT 0. The repoint (`:29-30`) + the CI step land in the SAME commit, so the step is green from its first CI run; do NOT add the CI step before the repoint, and the verification probe below is valid only POST-edit.
- (Backlog note, NOT this PR: the hardcoded persona table `:37-129` duplicates the briefs — a future "read names from disk" refactor.)

**PR1 VALIDATE:** 3-lens (kernel-validator + safety-control class) — `code-reviewer` (correctness/no-regression) + `hacker` (does the revived gate now actually block? can the `--check` be fooled?) + `honesty-auditor` (claims match).

---

## PR2 — Doc-rot sweep (mechanical, lighter review)

Branch fresh off `main` (after PR1 merges, or parallel — minimal file overlap; excludes build-team.md, fixed in PR1).

### C — `scripts/agent-team/` reference sweep (~33 live files)
**NOT a blind find-replace** — a verified per-target mapping (probed this session):

| Old path | New path |
|---|---|
| `scripts/agent-team/contract-verifier.js` | `packages/kernel/validators/contract-verifier.js` |
| `scripts/agent-team/_lib/library-paths.js` | `packages/kernel/_lib/library-paths.js` |
| `scripts/agent-team/_lib/{file-path-pattern,settings-reader}.js` | `packages/kernel/hooks/_lib/…` |
| `scripts/agent-team/<everything else>` (agent-identity, kb-resolver, contracts-validate, weight-fit, build-team-helpers, budget-tracker, pattern-runner) | `packages/runtime/orchestration/<same>` |

- **Safe mechanism (verify-plan FLAG-3 — NOT a naive global sed):** replace the 4 longer special-case prefixes FIRST (`scripts/agent-team/contract-verifier.js`, `scripts/agent-team/_lib/library-paths.js`, `scripts/agent-team/_lib/file-path-pattern.js`, `scripts/agent-team/_lib/settings-reader.js` → their kernel targets), THEN the general `scripts/agent-team/` → `packages/runtime/orchestration/` (longest-prefix-first guarantees the special-cases are already consumed). Per-file review for any doc with code-fenced examples (preserve fences). Apply across the live set (the `agent-team` skill: SKILL.md/USING.md/BACKLOG.md/contract-format.md + `kb/**` + `patterns/**`; commands build-plan/chaos-test/implement/research/verify-plan; docs development/README, library.md, CONTRIBUTING.md; SKILLs build-plan/skill-forge/tech-stack-analyzer/verify-plan).
- **PRESERVE (do not sweep):** `packages/runtime/README.md:15` + `docs/ROADMAP.md:20` — they correctly say "formerly `scripts/agent-team/`".
- Also fix `contract-format.md:10` dead `swarm/personas/{persona}.md` → `packages/runtime/personas/`.

### E — consistency + archive
- `git mv` superseded drafts to `_archive/` (provenance-preserving): `rfcs/v3.3-substrate-synthesis-v{1,2}.md` (v3 is current), `plans/2026-05-25-phase-0-workspace-restructure-v1.md` (unsuffixed is current). Create `rfcs/_archive/` if needed.
- ~~Fix ROADMAP.md:7 -v1 citation~~ — **DROPPED (re-probed: NO-OP).** ROADMAP.md:13 already cites the unsuffixed plan; there is no `-v1.md` citation anywhere in ROADMAP (the audit's claim was imprecise; architect FLAG + re-probe confirmed).
- Strip the lone YAML frontmatter from `packages/skills/commands/phase-close.md` (the only command with it; 13 others have none) to match convention.

**PR2 VALIDATE:** `code-reviewer` + a grep-sanity gate (mechanical) — confirm 0 remaining live `scripts/agent-team/` refs outside the 2 preserved files + `packages/specs/`; markdownlint clean.

---

## Critical files

- **PR1:** `packages/kernel/validators/validate-frontmatter-on-skills.js` (+ `tests/smoke-h7.sh`), `packages/skills/commands/build-team.md`, `scripts/generate-persona-agents.js`, `.github/workflows/ci.yml`.
- **PR2:** the ~33 doc files (mapping above), 3 `git mv`'d drafts, `docs/ROADMAP.md`, `packages/skills/commands/phase-close.md`.

## Verification (end-to-end)

- **PR1:** (1) validator smoke test — real `skills/library/*/SKILL.md` frontmatter-removal → block; command → approve; contract-format.md → approve; (2) `node scripts/generate-persona-agents.js --check` → exit 0 + the new CI step green; (3) `ls` every repointed build-team.md target → all exist; (4) full kernel suite + eslint + K12 + markdownlint green.
- **PR2:** `grep -rl "scripts/agent-team" packages docs CONTRIBUTING.md install.sh | grep -v _archive | grep -v packages/specs` → returns only `runtime/README.md` + `docs/ROADMAP.md` (the preserved "formerly" notes); markdownlint clean; `scan-stale-artifacts.js` still CLEAN. NOTE (architect FLAG-8a): the grep scope deliberately omits `.claude/` — a stale orphaned worktree `.claude/worktrees/agent-a7923d0d2602bf79c/` holds a full repo-duplicate (~half of a naive repo-wide grep's hits); it is git-ignored + out of scope. (Housekeeping: that worktree should be discarded separately — the leftover from a parallel session.)
- Persist the canonical plan copy to `packages/specs/plans/2026-06-07-stabilize-migration-rot.md` on execution (the durable project record).

## HETS Spawn Plan

- **`/verify-plan`** on THIS plan before ExitPlanMode: `architect` (the 2-PR split soundness, the gate-revival design, the verified mapping, scope discipline) + `code-reviewer` (the regex change, the sweep mapping's special-cases, no-regression on the smoke fixtures).
- **PR1 build → 3-lens VALIDATE** (code-reviewer + hacker + honesty-auditor; read-only; the safety-control revival is the high-stakes part).
- **PR2 build → code-reviewer + grep-sanity** (mechanical; full 3-lens not warranted for a verified-mapping doc sweep).

## Drift Notes
- This is the disciplined remediation of restructure-rot (the USER's "frankenstein" intuition — confirmed localized, not pervasive). The audit's biggest value was DISPROVING the feared persona-duplication (intentional 3-layer) + confirming 0 dead modules — scoping the fix down to references.

## Pre-Approval Verification

Ran `/verify-plan` (architect + code-reviewer, parallel, read-only, 2026-06-07). Both spot-verified claims against the live repo with firsthand probes.

**Architect — READY.** Confirmed: the NOMATCH probe (gate protects nothing real), the old→new mapping resolves (incl. the `_lib` split), the persona 3-layer is intentional (don't touch), the 2 "formerly" lines are load-bearing-to-preserve, B-dormant KEEP is empirically grounded (`lineage.js` has zero live `require()` — the `record-store.js` hits are comment-only). FLAGs, folded: (a) **ROADMAP.md:7 -v1 citation is a NO-OP** → **re-probed + DROPPED** from E; (b) acknowledge the orphaned `.claude/worktrees/` duplicate in the PR2 grep note → **folded**; (c) call out code-fenced-example care in the sweep → **folded** into A1 + C. (KB-citation hook noted the architect's section had no `kb:` ref — its findings are firsthand runtime probes, which I independently re-verified; treated as evidence-grounded, not kb-grounded.)

**Code-reviewer — NEEDS-REVISION → resolved.** 2 HIGH FAILs (both folded):
- **FAIL-1 (Test fixture false-green):** the repointed regex NOMATCHes the existing `skills/test/SKILL.md` smoke fixture → Test 22/23 would silently pass. **Fixed:** A2 now mandates UPDATING the fixture paths to `skills/library/test/...` (not just "extend").
- **FAIL-2 ("green today" false):** `--check` exits 2 today (source-path abort precedes it). **Fixed:** D now states the repoint + CI step land in one commit; the probe is POST-edit only.
- FLAG-3 (sweep mechanism) → **folded:** longest-prefix-first + per-file fence care. FLAG-4 (build-team.md:207) → **folded** into A1. FLAG-7 (scope = 5 files) → the Critical-files list already enumerates all 5 (validator + smoke-h7.sh + build-team.md + generator + ci.yml).

**Resolution:** no blocking finding remains; both FAILs + all FLAGs folded; the one phantom item (ROADMAP:7) dropped after re-probe. The load-bearing design (2-PR split, gate-revival, verified mapping, B-KEEP) is sound per both reviewers. Plan READY.

---

## PR1 — 3-lens VALIDATE (execution record, 2026-06-07)

Ran the full tier on the PR1 diff (kernel-validator + safety-control class; hacker weights fails-to-protect).

- **code-reviewer: APPROVE.** All checks pass; 2 informational flags (README rescued by SKIP ordering; narrowing was deliberate). No defects.
- **hacker: NEEDS-REVISION -> all folded.** The repoint genuinely revived the SKILL.md+patterns gate, but as a safety control it initially fails-to-protect on reachable classes:
  - C1 (CRITICAL): `skills/library//x/SKILL.md` (`//`) dodged the anchored regex while fs collapses it -> a broken skill written through. FIXED: `path.posix.normalize` before matching.
  - H1 (HIGH): the 47-doc `kb/**` tree + `USING.md` (frontmatter-bearing, kb-resolved) were ungated. FIXED: broadened to `skills/library/<skill>/.+\.md` (any depth).
  - H2 (HIGH): nested `library/<skill>/sub/SKILL.md` + `patterns/sub/x.md` escaped (one-segment `[^/]+`). FIXED by the broad pattern.
  - M1 (MEDIUM): `--check` was false-green (existsSync only) -> a zero-byte/malformed stub passed CI. FIXED: `--check` now asserts frontmatter + non-trivial body (verified: truncated stub -> exit 1).
  - M2 (MEDIUM): bare-basename `contract-format.md` skip was location-blind. FIXED: path-scoped SKIP_PATHS (a same-named file elsewhere now blocks).
  - All 5 re-probed directly post-fix: the gate now BLOCKS C1/H1/H2/real-SKILL/M2-elsewhere and APPROVES the 4 legit frontmatter-less docs + commands. The complete frontmatter-less inventory under skills/library/ (4 docs: BACKLOG.md, contract-format.md, kb/README.md, patterns/README.md) is fully skip-covered -> no false-block.
- **honesty-auditor: GRADE B (overclaims) -> folded.** Caught: build-team.md:3,81 still had stale `skills/tech-stack-analyzer/` links (a different rot class) -> FIXED (now `../library/...` + full path). Disclosures folded below.

### Honest disclosures (carry to the PR)
1. LIVE-GATE STALENESS: the validator fix takes effect only on `claude plugin update`. In THIS session the running PreToolUse gate is the OLD installed validator (old regex still catches `skills/commands/*`), so command-doc edits (build-team.md) were made via Bash (a legitimate source edit; the gate is a confirmed false-positive the fix corrects). Not immediately live in-session.
2. SMOKE INVOCATION: `tests/smoke-h7.sh` must be run SOURCED (it uses `local`; standalone errors out). Sourced run = passed=27 failed=0. Standalone "failures" are a harness artifact, not regressions.
3. DOC-ROT SCOPE: PR1 fixes build-team.md fully + the gate + the generator. The remaining ~32-file `scripts/agent-team/` + the broader `skills/<x>/` -> `skills/library/<x>/` doc-rot is PR2's sweep (NOT closed by PR1).

**Gate:** sourced smoke 27/0 + eslint clean + markdownlint 0 + K12 0; gate adversarially re-probed (C1/H1/H2/M1/M2 closed, no new bypass on normalize edge-cases).
