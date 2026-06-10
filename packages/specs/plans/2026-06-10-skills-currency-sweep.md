---
status: in-progress
research_artifact: null
lifecycle: ephemeral
---

> **PR-A (Waves 1+2) DONE** — the gate-widening surfaced ~28 FRESH path-rot hits beyond the audit's 8 (the `kb/patterns` tree was a total blind spot). PR-A grew to "widen the gate + sweep all prescriptive v4 path-rot": 20 docs remapped (incl. the 2 HIGH copy-paste-broken `--contract` commands), the validator now scans `agent-team/{kb,patterns}` (35→115 docs) + suppresses a `/usr/bin/env` shebang FP, +4 regression tests. Gate clean, full CI-job set green. PR-B = Waves 3-5.

# Plan — skills-currency sweep (bring all 53 docs current with v3.6)

## Context

A 14-slice parallel honesty-auditor audit + completeness critic (workflow `wduak7as1`, 2026-06-10) re-derived the deferred MED/LOW skills-audit findings against current main (post-#282), premise-probing each firsthand. Result: **37 findings — 2 HIGH, 14 MED, 21 LOW** (34 firsthand-verified, 3 inferred → web-verify). Goal: every command/skill/agent doc coheres with the live substrate.

Two structural roots:
- **Doc-path gate gap (#276)**: `scripts/validate-doc-paths.js` scans only `packages/skills/{commands/*.md, library/*/SKILL.md}` and roots on `[swarm,packages,scripts,…]` — so it misses `agent-team/kb/**` + `agent-team/patterns/**` docs AND `kb/`-prefixed tokens. Both HIGH broken-examples + ~6 path-rot-residuals live in that blind spot.
- **Missing `## Citation format` heading in `agents/architect.md`**: ~13 agent docs cross-ref a section that doesn't exist (the real one is `## KB Sources Consulted`).

## Waves (each a reviewable PR; per-wave workflow plan→VERIFY-if-coded→build→gate→PR)

### Wave 1 — doc-path gate widening (CODE; ships FIRST so it catches Wave 2)
Extend `validate-doc-paths.js` to (a) also scan `packages/skills/library/agent-team/{kb,patterns}/**/*.md`, (b) recognize `kb/`-prefixed and `swarm/`-rooted tokens already covered but extend ROOTS/scan set, (c) keep the path-traversal + placeholder + EXEMPT guards. Add regression tests for a `swarm/personas-contracts/` dead ref and a `kb/hets/...` ref. Architect VERIFY (gate-widening risks new FPs) → TDD → gate. **Risk: MED (could over-flag); shadow the new scan against current tree first, fix all hits in Wave 2 same-PR-or-before.**
- Findings closed/enabled: the gate now blocks the whole path-rot class going forward.

### Wave 2 — path-rot sweep (DOCS; the 2 HIGH + 6 path-rot)
Single mechanical pass `swarm/personas-contracts/` → `packages/runtime/contracts/` across the 8 occurrences:
- **HIGH** `agent-team/kb/hets/spawn-conventions.md:81-86` (copy-paste-broken `--contract` dir)
- **HIGH** `agent-team/kb/hets/challenger-conventions.md:87-91` (same)
- `patterns/system-design-principles.md`, `patterns/missing-capability-signal.md:88`, `kb/architecture/discipline/refusal-patterns.md:278`, `kb/architecture/ai-systems/agent-design.md:90,325`
- `commands/build-plan.md:125` + `library/build-plan/SKILL.md:67` `kb/hets/spawn-conventions.md` → resolvable path
- `commands/chaos-test.md:110` `kb:agent-team/patterns/asymmetric-challenger` → relative pattern-doc link
- `agents/architect.md:178` stale `swarm/` path-scope test → `packages/runtime/personas|contracts/` + `swarm/run-state/`
Re-run the widened gate (Wave 1) → must be clean.

### Wave 3 — agent-doc consistency (DOCS; systemic + small)
- Add `## Citation format` subheading (or alias) in `agents/architect.md` so the `§Citation format` cross-ref in ~13 agent docs resolves (one-fix-many). (hacker, confused-user, node-backend, java-backend, react-frontend, ios-developer, ml-engineer, data-engineer, devops-sre, …)
- `agents/codebase-locator.md:25-26` dup `kb:hets/spawn-conventions` → replace one with `kb:hets/code-search-heuristics`.
- `agents/architect.md:133-139` design-pushback catalog under-counts by one → add `syntactic-gate-extension-for-tool-bypass` OR replace the hand-list with "directory is source of truth."

### Wave 4 — substrate-meta currency (DOCS)
- `commands/self-improve.md`: "not invoked in 2+ weeks" → catalog/snapshot judgment (no invocation log); reframe "2+ times"/"2+ separate sessions" off the retired auto-counter (finish #278 on the COMMAND).
- `commands/build-plan.md`: soften Step-1 `EnterPlanMode` with the headless-denial caveat (mirror workflow.md); standardize plan dir (`~/.claude/plans/` vs `.claude/plans/` across build-plan cmd+SKILL vs plan.md — pick `.claude/plans/`).
- `library/build-plan/SKILL.md`: `convergence_value >= 0.10` → current calibration (0.15); `weights_version v1.1` → v1.2; drop brittle `workflow.md:28-44` line-pin → cite by section name.
- `library/agent-team/SKILL.md`: remove 3 non-existent `role-templates/*.md` bullets; add a "Gates" note (route-decide.js + /verify-plan + /phase-close); drop "planned" on the shipped 09-react-frontend ref.
- `library/swift-development/SKILL.md`: "planned for H.2.6" `invokesRequiredSkills` → present-tense.
- `library/airflow/SKILL.md`: canonical-source "should be added … on next H.6.7 audit" → "per registry."
- `library/penetration-testing/SKILL.md`: dead `related_kb security-dev/web-vulnerability-classes` → remove or author.

### Wave 5 — domain-skill version anchors (DOCS; the 3 inferred → web-verify FIRST, research-mode)
- `next-js/SKILL.md:91` "PG14+ behavior" → "Next 14+/15+".
- `typescript/SKILL.md:10,16` "Next.js 14" → "14/15".
- `airflow/SKILL.md:58` `WHEN NOT MATCHED BY SOURCE … postgres-15` → verify (PG17+) and correct.
- `node-backend-development/SKILL.md:97` legacy nodejs.org event-loop URL → current learn URL (verify live).
- `penetration-testing/SKILL.md` OWASP 2021 "current categories" → verify current edition; relabel/update.

### Wave 6 — dogfood (the goal) — DONE, all GREEN
Exercised the touched surface against the LIVE substrate (on the branch source):
- **Paths/refs**: doc-path 115/0 clean; all 5 cited `kb:` ids resolve via kb-resolver; `contract-kb-scope-resolves` 0 violations.
- **Command CLIs**: `route-decide.js` (build-plan/build-team Step 0) → borderline; `agent-identity.js assign` for 09-react-frontend/14-codebase-locator/04-architect all OK (#279 roster path healthy); `kb-resolver cat hets/stack-skill-map` + `agent-identity list` (build-team preflight) OK.
- **The 2 HIGH commands EXECUTE end-to-end**: `contract-verifier.js --contract packages/runtime/contracts/04-architect.contract.json` → `{"agentId":"actor-architect","persona":"04-architect",...}`. Note: the verifier binary lives at `packages/kernel/validators/contract-verifier.js` (the command cites it correctly; the agent-team SKILL "consumes" header covers it via "+ packages/kernel/").
- **Agent spawns**: `architect` loaded + emitted `## KB Sources Consulted` with 2 valid `kb:` refs (the `### Citation format` ref resolves); `codebase-locator` loaded, located the gate files, cited `kb:hets/code-search-heuristics` correctly + independently confirmed the dup-KB fix is needed (live def still has it; PR-B fixes on merge).

## Status: PR-A #283 + PR-B #284 (stacked) up; dogfood GREEN. Awaiting user merge.

## Runtime Probes (firsthand, from the audit)

- `swarm/personas-contracts/` is DEAD; live = `packages/runtime/contracts/` (8 doc occurrences; `build-team-helpers.sh` + `budget-tracker.js` + agent-team SKILL use the live path).
- `agents/architect.md` has `## KB Sources Consulted`, NOT `## Citation format` (the §ref target).
- doc-path gate `ROOTS` (validate-doc-paths.js:44) excludes `kb`; scan set excludes `agent-team/{kb,patterns}`.
- `route-decide.js` convergence weight recalibrated 0.10→0.15; weights_version v1.1→v1.2 (verify exact strings before editing).
- No invocation-log mechanism exists in `packages/kernel` (grep-confirmed).

## Out of Scope (Deferred)

- Deep domain-library currency beyond the flagged version anchors (a separate SME/web pass).
- The 3 INFERRED findings are web-verified in Wave 5 before any edit (no blind fixes).

## Drift Notes

- The doc-path gate's blind spot (kb/patterns dirs) is the root cause that let the 2 HIGH copy-paste-broken examples survive — Wave 1 closes it, mirroring the #276 → #281 "rot in the uncovered surface" pattern.
