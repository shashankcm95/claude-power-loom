# /phase-close — phase-level verification gate + ghost-protocol monitor tie-in

> Lifecycle: persistent until the skill ships + first dogfooded at v3.2-close. USER-proposed
> (2026-06-03): a phase-level independent-lens gate to catch cross-PR drift the per-PR VALIDATE
> structurally can't see, replacing ad-hoc external reviews (which lack context → hallucinate).

## Context

The per-wave/per-PR VALIDATE (architect + code-reviewer + hacker + honesty) verifies one diff in
isolation. It cannot see **cross-PR contract drift** (a contract that changed shape between PR-A and
PR-B), **accumulated debt** (merged-but-dark deployment, deferred follow-ups piling up), or **phase-claim
honesty** ("phase complete" vs exit-criteria-actually-met). A **phase-close gate** — independent PM +
Principal-SDE + Architect lenses, full-context in-substrate, reviewing the INTEGRATED phase against its
exit criteria — catches exactly that. **Precedent:** the v3.1 phase-close sign-off (PM honesty-auditor +
principal architect, both CLOSEABLE; `docs/ROADMAP.md`). This formalizes that proven ad-hoc pattern.

It is the **post-phase analog of `/verify-plan`** (which is pre-approval). Coarser than the per-wave
VALIDATE (fires once per v3.x phase, not per PR) → cheap relative to its drift-catch.

## Routing Decision

```json
{ "recommendation": "root-build-direct",
  "note": "Building a markdown procedure-skill + command + a library-taxonomy edit + a rules-source predicate-section, modeled on the proven /verify-plan skill. Not orchestrating a team (building directly), so the route-decide-before-spawn gate doesn't apply. The one genuine design risk — the ghost tie-in's enforce-vs-advisory honesty — is grounded by the Runtime Probes below, not assumed (ADR-0012 discipline)." }
```

## Runtime Probes (ghost-protocol mechanism — verified, NOT assumed)

| Claim | Probe | Result |
|---|---|---|
| ghost protocol = signal-bumping, not a hook | `drift-taxonomy.md:11-13` | bump via `node ~/.claude/scripts/self-improve-store.js bump --signal <type:value>`; counts in `~/.claude/self-improve-counters.json` |
| **`drift:` convergence is MANUAL, not auto** | `drift-taxonomy.md:93` | "auto-fires on convergence **FALSE** … candidate threshold is 5; `drift:` misclassifies low-risk; queue never surfaces it — convergence is MANUAL" → so the tie-in is an **advisory monitor surfaced for /self-improve triage**, NOT a hard enforcer |
| taxonomy names are immutable | `drift-taxonomy.md:28` | "ONCE A SIGNAL NAME IS USED IT NEVER CHANGES" → pick the phase-close signal names carefully, once |
| there's an effectiveness loop | `drift-taxonomy.md:32-45` | `improvement-effectiveness:R` vs `rule-recurrence:R` → use it to track whether the gate actually catches drift |
| skills auto-discover (no manifest edit) | `.claude-plugin/plugin.json` | `"skills": "./packages/skills/library"`, `"commands": "./packages/skills/commands"` — adding dirs/files is enough |
| drift-taxonomy is a LIBRARY volume, not repo | `ls ~/.claude/library/.../ghost-protocol/volumes/` | `drift-taxonomy.md` lives in the library → edited DIRECTLY (local), NOT via a repo PR; the SKILL/command/rules are repo (PR) |
| `/verify-plan` is the structural model | `commands/verify-plan.md` + `library/verify-plan/SKILL.md` | command = thin entry; SKILL = the multi-step spawn procedure; trust model = section-PRESENCE (forcing-function discipline, not tamper-proof) |

## Design

**The gate (`SKILL.md`)** — a 3-lens phase verification, full-context, reviewing the INTEGRATED phase:

- **PM** → `honesty-auditor`: did the phase deliver its *scoped exit criteria*? claim-vs-evidence on "complete"; scope honesty (deferred-but-claimed?). Reads the phase's scope/ROADMAP exit criteria + the merged PRs.
- **Principal-SDE** → `code-reviewer` at phase altitude: cross-PR integration **seams** (contracts spanning PRs) + accumulated debt — explicitly NOT re-reviewing each diff (the per-PR gate did that).
- **Architect**: phase design soundness as a unit + **forward-contract readiness** for the next phase's consumer.

All three read-only (per the read-only-verify-persona rule). The framing prompt: *"what's true ACROSS these PRs that no single PR's review could have verified?"* Output a **verdict: CLOSEABLE / NEEDS-WORK-before-next-phase** + findings, written as a **phase-close record** (a library volume + a `## Phase-close sign-off` block in `docs/ROADMAP.md`, matching the v3.1 precedent). NEEDS-WORK must-fix items gate the next phase.

**Ghost tie-in (the monitor — HONESTLY advisory, per probe #2):**
- New taxonomy signals (immutable, added once): `drift:phase-close-skipped` (a v3.x phase boundary crossed without the gate) + `improvement-effectiveness:phase-close` (the gate caught FRESH cross-PR drift) + `rule-recurrence:phase-close` (drift the gate SHOULD have caught slipped to a later phase).
- The skill BUMPS `improvement-effectiveness:phase-close` when it catches drift the per-PR gates missed (closing the effectiveness loop — does the gate earn its keep?).
- The session-end / pre-compact discipline (already a bump-point, `drift-taxonomy.md:66`) checks: phase boundary crossed without a phase-close record? → bump `drift:phase-close-skipped`. Converges → /self-improve triage surfaces it.
- **HONEST scope:** this is a TRACKED ADVISORY monitor (the ghost protocol's nature — manual convergence), NOT a hard block. Hard enforcement (a kernel PreToolUse hook on the plugin-manifest version bump requiring a phase-close record) is a documented FUTURE escalation — out of scope here, and it'd be a kernel-hook PR, not a ghost-protocol edit. Do not claim the ghost tie-in "enforces" in the hook sense.

## Files To Modify

| File | Change |
|---|---|
| `packages/skills/library/phase-close/SKILL.md` | **NEW** — the 3-lens phase-gate procedure + the ghost-bump steps |
| `packages/skills/commands/phase-close.md` | **NEW** — the command entry (model on `verify-plan.md`) |
| `packages/skills/rules/core/workflow.md` | **MOD (source)** — add a predicate-gated "phase-close gate" section (`<important if "task involves closing a v3.x phase">`); sync via `install.sh --rules` |
| `~/.claude/library/.../ghost-protocol/volumes/drift-taxonomy.md` | **MOD (library-local, NOT a repo PR)** — add the 3 phase-close signals + the monitor description |

## Verification Probes

- `SKILL.md` + `phase-close.md` pass the skill-frontmatter validator (`name` + `description`) + markdownlint.
- `bash install.sh --hooks --test` green (skill frontmatter Test, markdownlint Test 80, yaml Test 83).
- The drift-taxonomy edit uses NEW signal names (no rename of an existing signal — taxonomy-stability).
- Honesty self-check: the skill + taxonomy describe the tie-in as ADVISORY (tracked monitor + manual convergence), never as hard hook-enforcement.

## Out of Scope

- **Hard hook-enforcement** of "no phase-close → no version-bump" — a future kernel-hook escalation, noted not built.
- **Running the gate now** — v3.2 isn't closed (Wave 3 remains); first dogfood is v3.2-close.
- A `phase-close-spawn.js` aggregation helper — KISS: the skill is orchestrator-driven (Claude spawns + writes the record directly), like `/verify-plan`'s "no LLM-spawn-from-Node" rule. Add a helper only if aggregation proves fiddly.

## Drift Notes

- This skill IS a drift-catcher; building it without the full per-wave VERIFY/VALIDATE spawn (compact-after constraint) is a small, conscious exception — mitigated by modeling on the proven `/verify-plan` + grounding the one risky claim (ghost enforce-vs-advisory) in Runtime Probes. The skill's own first dogfood (v3.2-close) is its real test. A retro VERIFY/VALIDATE pass on the skill is a reasonable follow-up.
