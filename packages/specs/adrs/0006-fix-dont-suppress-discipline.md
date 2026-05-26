---
adr_id: 0006
title: "Fix-don't-suppress discipline — substrate maintains 0-finding lint baseline; suppression PROHIBITED in substrate source"
tier: governance
# status enum (5 values): proposed | accepted | seed | superseded | deprecated
status: accepted
created: 2026-05-11
author: power-loom-author / H.9.7 sub-plan + parallel architect + code-reviewer per-phase pre-approval gate (APPROVED-with-revisions; 7 FLAGs absorbed single-pass — 1 HIGH bug-surface-correction + 5 MEDIUM scope/precision + 1 LOW clarification; per HT.1.7 + HT.1.13 + ADR-0005 same-day-acceptance convention)
superseded_by: null
files_affected:
  - eslint.config.js
  - tests/smoke-ht.sh
  - scripts/agent-team/contract-verifier.js
  - scripts/agent-team/contracts-validate.js
  - scripts/agent-team/identity/trust-scoring.js
  - scripts/agent-team/pattern-recorder.js
  - scripts/agent-team/spawn-recorder.js
  - scripts/agent-team/weight-fit.js
  - scripts/prompt-pattern-store.js
invariants_introduced:
  - "Substrate maintains a 0-finding lint baseline across all installed lints (Test 80 markdownlint + Test 81 shellcheck + Test 82 jq + Test 83 yaml-lint + Test 84 ESLint). CI + local smoke harness MUST report 0 errors at every commit landing on main. **Enforcement scope clarification (per architect FLAG-4)**: this invariant is enforced at smoke-harness + CI time (post-edit, pre-merge); pre-edit hook enforcement (catching convention violations at Edit/Write time) is a separate currently-deferred discipline tracked at drift-note 78 (PreToolUse ADR-status validator scope expansion candidate at H.9.11)."
  - "Lint findings get FIXED, not suppressed. Per-line `eslint-disable-next-line`, file-level `/* eslint-disable */` comments, and per-file rule-overrides in `eslint.config.js` that downgrade or disable rules are PROHIBITED in substrate source. Sibling-style suppression (e.g., `# shellcheck disable=NNNN` inline in code beyond the 4 file-top SC2168 directives ADR-tagged at H.9.1) is similarly prohibited."
  - "Exception process for legitimate code/rule conflicts: REFACTOR the code to express the intent differently rather than suppress the rule. Examples: (a) security-detection regex requiring control chars → rebuild dynamically via `String.fromCharCode` + Unicode escapes; arguments MUST remain compile-time const literals (per architect FLAG-3 — never derived from external input); (b) intentional empty catch block → add explanatory comment to convert empty-block to commented-block (commented blocks pass `no-empty` because the comment is a statement). **Config-calibration boundary (per architect FLAG-2)**: ALLOWED — rule *options* that codify substrate-wide naming/structural conventions, applied uniformly across substrate (e.g., `varsIgnorePattern: '^_'`, `argsIgnorePattern: '^_'`, `caughtErrorsIgnorePattern: '^_'`). PROHIBITED — changing rule *severity* (`error → warn → off`) for any rule, AND any `files: [...]` block in `eslint.config.js` that scopes calibration to a subset of substrate `.js`. The mechanical test: 'does this `eslint.config.js` change apply to ALL substrate `.js` uniformly, AND does it preserve rule severity at error?' If both yes → calibration. If either no → suppression. The escape hatch — ADR-update to remove the rule — applies only when the rule is genuinely wrong for substrate (rare); rule-level disable requires this ADR's amendment, not a per-site disable comment."
  - "New lint additions to the smoke harness follow the H.9.7 entry pattern: empirical baseline first (no merge until 0-error baseline established); fix every finding; ADR-0006 invariants apply to the new lint's findings from day 1. **ESLint major-version-bump commitment (per architect FLAG-1)**: substrate authors do NOT silently bump ESLint major versions (e.g., v9 → v10); each major-version bump triggers an explicit `recommended` rule-set audit + ADR-0006 amendment if the rule set changed, via per-phase pre-approval gate. ESLint minor + patch bumps (v9.x.y → v9.x.z) flow through the smoke harness automatically; substrate's hand-rolled rules in `eslint.config.js` track major-version recommended only."
  - "Smoke harness actively detects suppression tokens in substrate source. Test 84b in `tests/smoke-ht.sh` greps for `eslint-disable` (any variant) in substrate `.js` files and fails if any matches are found. Without this active enforcement, invariant 2 (prohibition of suppression) would rely on code-review discipline alone — risk of drift within ~5 commits per code-reviewer FLAG-3 estimate. Sibling-suppression detection in other lints follows the same shape when added (e.g., future shellcheck-suppression check)."
related_adrs:
  - 0001
  - 0002
related_kb:
  - architecture/discipline/error-handling-discipline
  - architecture/crosscut/single-responsibility
---

## Context

The substrate-as-testing-framework reframe (user direction at v2.0 trajectory: "this is actually an underlying testing framework as well") has driven H.9.0–H.9.6.2 — six lint/test additions to the local verification harness. Each format-discipline gate (markdownlint, shellcheck, jq, yaml-lint) has surfaced REAL drift in substrate content the moment it landed:

- H.9.0 markdownlint: 22 existing MD037/MD038 errors accumulated across HT ledger entries; mechanically fixed
- H.9.1 shellcheck: 78 false-positive findings caused by `local` outside-function shellcheck-can't-follow-source; resolved via file-top directives at 4 sourced test files
- H.9.2 jq: 0 baseline (purely preventive); demonstrates the gate shape works for clean substrate
- H.9.5 yaml-lint: 12 failing frontmatter files (HT-state.md + 11 plan files); 223 narrative scalars rewrapped + 8-key duplicate-key consolidation
- H.9.6.1 hotfix + H.9.6.2 hardening: yaml-lint caught a regression H.9.6 introduced; diagnostic surface fortified so future failures fail loudly + locally
- H.9.7 ESLint: empirical baseline surfaced 44 errors across 15 files, **including 2 dormant REAL BUGS** in `contract-verifier.js:214,216` (HT.1.2 refactor left stale `parsed` references that would throw `ReferenceError` at runtime)

Across this trajectory, a pattern emerged: each lint gate finds real drift the moment it lands. The drift is dormant — silent in the substrate until the gate makes it visible. The substrate's reliability rests on closing this gap permanently, not on making the lint quieter.

H.9.7's user directive made the principle explicit: "the approach should never be to suppress and move on. It should always be fix before it gets out of control. we need to bake this into our plugin contract so we can increase reliability."

The decision to elevate this principle to ADR institutional commitment (governance-tier) — rather than capturing it as a lightweight BACKLOG decision-record (per HT.1.6/HT.1.12/HT.1.15/H.9.0/H.9.5.1 precedent) — reflects:

1. **Forward-looking + cross-cutting**: applies to ALL substrate `.js` files + future lint additions + future hooks/scripts. ADR-class scope.
2. **Load-bearing for reliability**: substrate is institutional substrate for power-loom users; suppression-and-move-on has compounding cost (each suppression hides one more potential real bug; quality decays over time).
3. **Code-review gate**: PRs that introduce `eslint-disable` (or sibling suppression in other lints) become NEEDS-REVISION regardless of merit. Per ADR-0003 governance-tier precedent.

## Decision

The substrate adopts **fix-don't-suppress discipline** as institutional commitment:

1. **0-finding baseline**: every installed lint (Test 80 markdownlint, Test 81 shellcheck, Test 82 jq, Test 83 yaml-lint, Test 84 ESLint) MUST report 0 errors at every commit landing on main. CI + local smoke harness enforce.

2. **Suppression PROHIBITED**: per-line `// eslint-disable-next-line`, file-level `/* eslint-disable */`, `eslint-disable-line`, and per-file rule-overrides in `eslint.config.js` that disable or downgrade rules below `error` severity are not permitted in substrate source. Sibling-style suppression in other lints (e.g., new shellcheck inline `# shellcheck disable=...` comments beyond the 4 already-grandfathered SC2168 directives at H.9.1) follows the same rule.

3. **Refactor-not-suppress for legitimate conflicts**: when a lint rule conflicts with substrate intent (e.g., security-detection regex that needs literal control chars; intentional empty catch block; legacy variable name preserved for compatibility), REFACTOR the code:
   - Security-detection regex → rebuild dynamically with `String.fromCharCode` + `\u` Unicode escapes
   - Intentional empty block → add `/* intentional: <reason> */` comment inside (markdown-comment is a statement; passes `no-empty`)
   - Legacy variable name → rename + leave a comment explaining the historical name
   - Unused variable → rename to `_`-prefix (ESLint recommended config accepts `_`-prefix as intentionally-unused convention via `varsIgnorePattern: "^_"` rule config — this is config calibration, not suppression)

4. **Escape hatch via ADR-update**: when a rule is genuinely wrong for substrate (the refactor itself would be worse than suppression — rare), update THIS ADR with the rule-level disable rationale + new files_affected entry. Per-site `eslint-disable` is never the answer. ADR-update is the deliberation surface; it forces architect + code-reviewer review per per-phase pre-approval gate convention.

5. **New lint additions**: future smoke-harness lint additions (e.g., adding TypeScript-checker, accessibility-linter, security-linter) follow the H.9.7 entry pattern: empirical baseline first; fix every finding; ADR-0006 invariants apply to the new lint's findings from day 1.

## Consequences

**Positive consequences** (what we gain):

- **Real-bug catch reliability**: ESLint v9 + eslint:recommended already surfaced 2 dormant bugs in `contract-verifier.js` (HT.1.2 stale `parsed` refs). Future installs of new lints expected to surface similar dormant drift.
- **Quality monotonicity**: substrate quality cannot regress through "just suppress this for now"; new code is held to the same bar as existing code.
- **PR review focus**: code-reviewers focus on substantive design + correctness rather than re-litigating suppression decisions on each PR.
- **Plugin-contract claim**: power-loom plugin users can rely on "substrate has 0-finding lint baseline; ESLint + markdownlint + shellcheck + jq + yaml-lint all green at every commit" as a quality marker.

**Negative consequences** (what we sacrifice):

- **Initial development friction**: legitimate code that conflicts with a lint rule must be refactored, not suppressed. Refactor may take 5-30 min per finding vs 5 sec per suppression-comment. For genuine substrate intent vs lint-rule mismatch, refactor cost is real.
- **Rule-set rigidity**: substrate is locked into the lint rules it adopts. Updating rules requires ADR-amendment + re-running empirical baseline + fixing new findings.
- **Onboarding friction**: new substrate contributors learn "no eslint-disable" as a hard rule; takes one PR cycle to internalize.

**Open questions** (what we still don't know):

- **`_`-prefix unused-vars convention**: `eslint.config.js` flat config for `no-unused-vars` accepts `varsIgnorePattern: "^_"` to skip `_`-prefixed identifiers. Is this config calibration (allowed) or suppression (prohibited)? Resolution: this ADR treats it as config calibration when documented in `eslint.config.js` comment AND the convention is uniform across substrate. Per-file rule overrides DO count as suppression.
- **Legacy code suppression carve-outs**: if a future audit surfaces substrate code with deeply-intertwined lint conflicts that genuinely warrant suppression, what's the escalation path? Resolution: ADR-update is the path. The ADR-update process forces architect + code-reviewer review; per-site disable does not.
- **Performance impact of dynamic regex refactor**: prompt-pattern-store.js H.9.7 fix uses `String.fromCharCode(...).join()` to build the control-char pattern dynamically. Likely negligible (runs once per normalize call). Drift-note candidate to re-measure if hot-path complaints emerge.

## Alternatives Considered

### Alternative A — Suppress-as-needed (status quo)

Per-line `eslint-disable-next-line` accepted with documenting comment. **Rejected**: each suppression hides one potential real bug; compounds over time. Substrate-as-testing-framework reframe is incompatible with "lint is advisory."

### Alternative B — Lightweight BACKLOG decision-record (per HT.1.6 + H.9.0 precedent)

Capture the "fix-don't-suppress" principle as the 6th lightweight BACKLOG entry, not a full ADR. **Rejected**: forward-looking + cross-cutting + governance-tier load-bearing (applies to all substrate `.js` + all future lints). ADR-class commitment, not bounded decision record. ADR ledger growth 5 → 6 justified per HT.0.9-verify FLAG-5 (ADR is for forward-looking institutional invariants).

### Alternative C — Allow per-file rule-overrides in `eslint.config.js` for legitimate-conflict files

Permit `eslint.config.js` to disable specific rules for specific files when substrate intent diverges. **Rejected**: per-file overrides in `eslint.config.js` ARE suppression by another name. The ADR's invariant 2 explicitly prohibits this. Refactor-not-suppress (invariant 3) is the principled alternative.

### Alternative D — Warning-tier vs error-tier distinction

Adopt `eslint:recommended` at error severity; allow `eslint:stylistic` or other configs at warning severity with suppression-OK. **Rejected**: warning-tier creates a permanent "we'll get to it" backlog; user directive ("fix before it gets out of control") is incompatible. Substrate stays at error-only baseline; H.9.7 ships only `eslint:recommended` rules.

## Status notes

- 2026-05-11 — proposed by power-loom-author in H.9.7 sub-plan; pending parallel architect + code-reviewer per-phase pre-approval per HT.1.7 + ADR-0002 precedent.
- 2026-05-11 — **APPROVED-with-revisions** at parallel architect + code-reviewer per-phase pre-approval gate. 7 FLAGs absorbed single-pass:
  - **Architect** (3 MEDIUM + 1 LOW): FLAG-1 Option B maintenance commitment (folded into invariant 4); FLAG-2 config-calibration vs suppression mechanical boundary (folded into invariant 3); FLAG-3 dynamic-regex const-literal requirement + semantic-equivalence verification probe (folded into invariant 3 + sub-plan Sub-phase 3); FLAG-4 invariant 1 enforcement-scope clarification (folded into invariant 1).
  - **Code-reviewer** (1 HIGH + 2 MEDIUM): FLAG-1 HIGH dormant-bug surface 18 contracts not 3 (folded into sub-plan empirical-pre-validation narrative); FLAG-2 prompt-pattern-store.js concrete regex literal in sub-plan (folded into Sub-phase 2 fix table); FLAG-3 active suppression-detection enforcement (folded into NEW invariant 5 + sub-plan Test 84b).
  - **No conflicting findings**; both reviewers concur on absorb-FLAGs-first verdict.
- 2026-05-11 — status `proposed` → `accepted` per HT.1.7 + HT.1.13 + ADR-0005 same-day-acceptance convention. First application of invariants 1-5 lands at H.9.7 ship (44 baseline errors fixed; 2 dormant real bugs in contract-verifier.js + 4 legitimate-security refactors in prompt-pattern-store.js; Test 84 + Test 84b added).

## Related work

- **User directive at H.9.7 entry**: "the approach should never be to suppress and move on. It should always be fix before it gets out of control. we need to bake this into our plugin contract so we can increase reliability." — load-bearing source for this ADR.
- **ADR-0001** (substrate-fail-open-hook-discipline; seed-tier): orthogonal mechanical discipline; ADR-0006 layers atop ADR-0001's seed by adding a substrate-content-quality invariant.
- **ADR-0002** (bridge-script-entrypoint-criterion; technical-tier): provides the per-phase pre-approval gate framework that this ADR's institutional-discipline-encoding triggered.
- **ADR-0003** (fail-open-hook governance; governance-tier): same governance-tier as ADR-0006; both are forward-looking institutional commitments.
- **ADR-0005** (slopfiles authoring discipline; editorial-tier): sibling editorial-tier governance; both encode discipline-at-authoring-time.
- **H.9.0 BACKLOG entry** (4th lightweight decision-record; ledger-authoring backtick-wrap convention): codification-only via BACKLOG was right-sized for ledger-formatting; ADR-0006 is right-sized for content-quality + forward-looking applies-to-all-future-lints scope.
- **H.9.5.1 BACKLOG entry** (5th lightweight decision-record; narrative-quoting frontmatter convention): orthogonal; ADR-0006 doesn't replace it.
- **Empirical real-bug catches** at H.9.7 baseline: contract-verifier.js HT.1.2 stale `parsed` references → ADR-0006 invariant 1 paying for itself in the first invocation.
