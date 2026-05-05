---
pattern: agent-identity-reputation
status: implementing
intent: Personas as roles; identities as persistent named instances accumulating per-identity trust.
related: [trust-tiered-verification, persona-skills-mapping, hets, prompt-distillation]
---

## Summary

Persona = role (e.g., `04-architect`). Identity = named instance within that role (e.g., `architect.mira`). Each identity has persistent track record across runs: verdicts, specializations, skill invocations. Trust scored per identity, not per persona class — so "I trust mira" is meaningful, not just "I trust architects." Identities are assigned at spawn time from a per-persona roster (round-robin initially; trust-weighted later).

## Intent

A team of three architects on a real engineering team isn't three interchangeable units — each has a track record, specialty, and earned trust. Modelling agents the same way enables (a) reasoning about specific contributors, (b) targeted skill development per identity, (c) graceful retirement of underperforming identities, (d) social-cognitive scaffolding for humans reviewing the team's output ("mira flagged this — she's been right 19/20 times on architecture claims").

## Components

- **Identity registry** — `~/.claude/agent-identities.json` (gitignored). Schema: per-identity entry with `persona`, `name`, `createdAt`, `lastSpawnedAt`, `totalSpawns`, `verdicts {pass, partial, fail}`, `specializations[]`, `skillInvocations {skill: count}`.
- **Per-persona roster** — small set of names per persona, defined once at toolkit init. Suggested:
  - `01-hacker` → `["zoe", "ren", "kai"]`
  - `02-confused-user` → `["sam", "alex", "rafael"]`
  - `03-code-reviewer` → `["nova", "jade", "blair"]`
  - `04-architect` → `["mira", "theo", "ari"]`
  - `05-honesty-auditor` → `["quinn", "lior", "aki"]`
- **Assignment policy** — `agent-identity assign --persona 04-architect [--task ...]` returns an identity name. v1: round-robin across roster. v2 (post-tiering): pick best-fit by `(specializations × task tags)` overlap.
- **Recording** — `pattern-recorder record --identity 04-architect.mira --verdict pass ...` updates the identity's history. Existing per-persona stats remain (aggregated view).
- **Frontmatter ID convention** — actor spawns now have `id: actor-architect-mira` (was `actor-architect`). Tree-tracker child IDs follow same convention.

## Failure Modes

1. **Roster exhaustion** — if all roster names for a persona are spawned in a single run, round-robin starts to repeat. Counter: roster size ≥ max parallel actors per persona; default 3 covers current chaos-test usage.
2. **Stale specializations** — auto-derived specializations (e.g., "regex-bug-hunting") may persist after the identity's actual focus shifts. Counter: decay specializations over runs; require ≥3 recent runs in a category to keep the tag.
3. **Identity squatting** — a persona's roster could be exhausted by a single bad-faith user pre-spawning all names. Counter: rosters are toolkit-shipped, not user-mutable in v1.
4. **Concurrent identity assignment race** — two parallel spawns ask for an architect simultaneously; both get `mira`. Counter: file lock on `agent-identities.json` write; same lock pattern as `pattern-recorder.js`.

## Validation Strategy

Stress-test scenarios:
- Spawn 3 architects in one run. Verify each gets a distinct identity. Verify `nextIndex` advances correctly.
- Spawn 4 architects in one run (exceeds default roster of 3). Verify round-robin wraps and the 4th reuses `mira` (and downstream tooling tolerates duplicate identities in one run).
- Run 5 chaos cycles with consistent personas. Verify each identity's `totalSpawns` advances monotonically and `passRate` is computed correctly.
- Manually edit `agent-identities.json` to corrupt one identity's verdict counts. Verify the script either repairs or refuses to advance until corrected.
- Spawn under file-lock contention (5 parallel `record` calls). Verify no lost updates.

## When to Use

- All HETS chaos runs once `agent-identities.json` exists (Phase H.2 onwards)
- Any future multi-agent coordination outside chaos-test (HETS pattern is general)

## When Not to Use

- One-off experiments where identity continuity is noise
- Test runs that need fresh / unbiased identities (use `--ephemeral` flag — not yet implemented)

## Trust Formula (H.4.2 — explicit + auditable)

The trust score is **computed on demand** from each identity's persisted verdict history; there is no static `trust: 0.85` field on disk. Source of truth: `tierOf(stats)` in `scripts/agent-team/agent-identity.js:97-104`. The formula is intentionally simple — no recency decay, no skill-invocation weighting, no per-task complexity adjustment — so audits can reproduce any tier assignment from `verdicts {pass, partial, fail}` alone.

### The actual formula

```
total = pass + partial + fail
if total < 5:                  tier = 'unproven'
else:
  passRate = pass / total
  if passRate >= 0.8:          tier = 'high-trust'
  elif passRate >= 0.5:        tier = 'medium-trust'
  else:                        tier = 'low-trust'
```

Three things to notice:

1. **Minimum-runs gate** — under 5 verdicts you're treated as `unproven` (which the verification policy maps to `low-trust` defaults). One lucky pass doesn't earn high-trust.
2. **Partial = miss** — `partial` verdicts count toward the denominator but NOT the numerator. Equivalent to `partial → 0.0 credit`. Conservative; could be tuned to give partial credit (e.g., 0.5) in a future pass.
3. **No recency decay** — old verdicts weigh equally with new ones. An identity that passed 100 times two years ago and failed 5 times this week stays high-trust. **Known limitation**; tracked in BACKLOG for H.4.x or H.5.

### Worked example (live data, 2026-05-05)

```
identity                       totalSpawns   pass  partial  fail   tier
04-architect.mira              2             0     0        0      unproven (passes < 5)
06-ios-developer.riley         1             1     0        0      unproven (passes < 5)
01-hacker.zoe (CS-1)           1             0     1        0      unproven (passes < 5)
[hypothetical: 9 pass, 1 fail] 10            9     0        1      high-trust (passRate=0.9)
[hypothetical: 6 pass, 4 fail] 10            6     0        4      medium-trust (passRate=0.6)
```

Every live identity is currently `unproven` — this isn't a bug, it's the gate doing its job. Trust accumulates with verdict count.

### Tier → policy mapping (read by `recommend-verification`)

The trust formula above is purely descriptive; the **policy table** (`agent-identity.js:293-322`) maps each tier to a verification recommendation:

| Tier | Verification | Challenger | Skips |
|------|--------------|------------|-------|
| `high-trust` | spot-check only | none | `noTextSimilarityToPriorRun` |
| `medium-trust` | asymmetric challenger (1) | 1, different persona preferred | none |
| `low-trust` | symmetric pair | 2 | none |
| `unproven` | symmetric pair (cautious default) | 2 | none |

### Why simple beats sophisticated here

A weighted formula like `0.4·passRate + 0.2·skillCompleteness + 0.2·recency + 0.2·complexity` (cf. ruflo's published `0.4·success + 0.2·uptime + 0.2·threat + 0.2·integrity`) is more expressive but also more opaque. Audits become "why is mira high-trust?" → "she's at 0.78 weighted trust" → "what does that mean?" The current pass-rate-with-floor model gives every audit a one-line answer: *"mira is high-trust because she's passed 8 of her 10 verdicts (80%) since being spawned 2026-05-02."* When the formula evolves, it does so explicitly — change the function, bump the doc, ship a new phase.

### Tunables (BACKLOG)

- `MIN_VERDICTS_FOR_TIER` — currently hardcoded at 5 in `tierOf`. Future: contract-level override per persona.
- Partial-credit weight — currently 0.0; tuning to 0.5 would let challenger personas (which often produce partial verdicts on edge cases) accumulate trust faster.
- Recency window — track `passRate` over last N verdicts as well as lifetime; surface both in `tier` output.

## Related Patterns

- [Trust-Tiered Verification Depth](trust-tiered-verification.md) — reads per-identity trust to decide verification depth
- [Persona-Skills Mapping](persona-skills-mapping.md) — identities accumulate per-skill invocation history
- [HETS](../SKILL.md) — the substrate
