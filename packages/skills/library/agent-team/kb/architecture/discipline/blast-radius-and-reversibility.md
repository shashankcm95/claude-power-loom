---
kb_id: architecture/discipline/blast-radius-and-reversibility
version: 1
tags:
  - discipline
  - architecture
  - foundational
  - decision-making
  - reliability
  - operational
  - risk
sources_consulted:
  - "Jeff Bezos, Amazon 2015 Letter to Shareholders — Type 1 (one-way door) vs Type 2 (two-way door) decisions"
  - "Jeff Bezos, Amazon 1997 Letter to Shareholders — long-term orientation; reversibility-of-investment framing"
  - "Release It! 2nd ed (Michael Nygard, 2018) ch 5 (Stability Patterns) — Bulkheads, Circuit Breaker, Steady State; ch 4 (Stability Antipatterns) — Cascading Failures"
  - "Accelerate (Forsgren / Humble / Kim, 2018) — the four delivery metrics: change-fail-rate, time-to-restore (MTTR), deployment frequency, lead time"
  - "The Site Reliability Workbook (Google, 2018) ch 16 (Canarying Releases) + Site Reliability Engineering (Beyer/Jones/Petoff/Murphy, 2016) ch 27 (Reliable Product Launches) — gradual rollout, blast-radius reduction"
  - "AWS Well-Architected — Reducing the Scope of Impact with Cell-Based Architecture (2023) + REL-10 fault isolation; shuffle-sharding (AWS Builders' Library)"
related:
  - architecture/discipline/stability-patterns
  - architecture/discipline/trade-off-articulation
  - architecture/discipline/error-handling-discipline
  - architecture/discipline/reliability-scalability-maintainability
  - architecture/crosscut/idempotency
  - architecture/crosscut/single-responsibility
  - security-dev/threat-modeling-essentials
  - infra-dev/observability-basics
status: active+enforced
---

## Summary

**Principle (Bezos 2015)**: classify a decision by its **consequence-if-wrong**, not by its diff size. Reversible (two-way-door) decisions are cheap and should be made fast; irreversible (one-way-door) decisions get a higher bar and explicit acknowledgement.
**Blast radius (AWS)**: the maximum impact sustained if a change/component fails. Size the change by its blast radius; **contain** the radius structurally (bulkheads, circuit breakers, cells, least privilege, canary).
**Test**: before merging, can you name (a) the worst-case blast radius if this is wrong, (b) the rollback path, and (c) the door-type (one-way vs two-way)? If the door is one-way, did a human acknowledge it?
**Sources**: Bezos 2015/1997 letters + Release It! 2nd ed + Accelerate/DORA + Google SRE/Workbook (canarying) + AWS cell-based architecture / shuffle-sharding.
**Substrate**: the kernel never mutates user HEAD (maximally reversible); shadow-first-then-enforce; K9 promote stages a branch + a HUMAN merges (the one-way door is gated); quarantine over destructive ops; M1 one-line maximal-blast invariant.

## Quick Reference

**Two orthogonal axes — size every change on BOTH:**

| Axis | Question | Cheap end | Expensive end |
|------|----------|-----------|---------------|
| **Reversibility** | How costly to undo? | two-way door (rollback, revert) | one-way door (data deleted, secret leaked, API published) |
| **Blast radius** | Consequence-if-wrong? | one user, one cell, journal-only | all users, all data, the substrate itself |

**The decoupling (the core insight):** diff size correlates with neither axis.

- A **one-line** change can be a one-way door with global blast radius (drop a `WHERE` clause; flip a feature flag default; change a hash function whose output is a join key).
- A **500-line** refactor can be a two-way door with tiny blast radius (rename + re-test behind green tests; revert is one `git revert`).

**Decision policy:**

1. **Two-way door** → decide fast, low ceremony; bias to action (Bezos: made "quickly by high-judgment individuals").
2. **One-way door** → higher bar: explicit acknowledgement, review, a way to *not* take it if avoidable.
3. **Turn one-way doors into two-way doors** when you can — soft-delete instead of delete; deprecate instead of remove; flag-gate instead of cut over.

**Containment patterns (structural — limit the radius before it fires):**

| Pattern | Source | Effect |
|---------|--------|--------|
| Bulkhead | Release It! ch 5 | partition resources so one failure can't sink the ship |
| Circuit Breaker | Release It! ch 5 | stop calling a failing dependency; fail fast, recover |
| Cells / cell-based architecture | AWS Well-Architected | failure contained to one cell; partition-key routing |
| Shuffle sharding | AWS Builders' Library | virtual shards overlap minimally → noisy-neighbor blast bounded |
| Canary / gradual rollout | Google SRE Workbook ch 16 | a small % takes the change first; detect bad push early |
| Least privilege | threat-modeling-essentials | a compromised component's blast radius = its grants |

**Recovery metrics (DORA / Accelerate):** **change-fail-rate** (how often a change breaks prod) and **time-to-restore / MTTR** (how fast you recover) measure your real-world reversibility. Low MTTR *is* a two-way door at the org level.

**Top smells:**

- "It's just one line" used as a *reason to skip review* (diff-size reasoning on a load-bearing change).
- A merge with no stated rollback path.
- An irreversible op (delete, drop, force-push, destroy) where a reversible one (soft-delete, quarantine, deprecate) was available and not chosen.
- "We'll add the canary later" on a change that touches all users at once.

## Intent

Most production disasters are not big, deliberate, well-reviewed changes — they are *small* changes whose blast radius was misjudged because the reviewer sized them by their diff. The reflex "it's a one-line change, ship it" is the single most reliable way to take a maximal-blast-radius one-way door without noticing.

This principle replaces *diff-size intuition* with two explicit questions asked of every change: **how bad if it's wrong (blast radius)** and **how costly to undo (reversibility)**. Once those are explicit, two behaviors follow: you spend review/ceremony budget where it actually matters (big consequence, hard to undo), and you actively engineer changes to be *more reversible* and *lower blast radius* than they naturally are — soft-deletes, flags, canaries, cells, bulkheads. The goal is a system where being wrong is cheap, because most decisions are two-way doors and the few one-way doors are gated and acknowledged.

## The Principle

> "Some decisions are consequential and irreversible or nearly irreversible — one-way doors — and these decisions must be made methodically, carefully, slowly, with great deliberation and consultation. ... But most decisions aren't like that — they are changeable, reversible — they're two-way doors." — Jeff Bezos, Amazon 2015 Letter to Shareholders

And the complementary operational definition:

> "Blast radius [is] the maximum impact that might be sustained in the event of a system failure." — AWS Well-Architected, *Reducing the Scope of Impact with Cell-Based Architecture*

Reformulated:

- **Size by consequence, not by size.** Diff size is a red herring; the load-bearing question is what breaks, for whom, if this is wrong.
- **Reversible decisions are cheap; spend the budget on irreversible ones.** Bezos's warning is that large orgs over-apply the heavy Type-1 process to Type-2 decisions and grind to a halt; the inverse failure — applying the *light* process to a Type-1 decision — is the one that bricks systems.
- **Engineer for reversibility.** A one-way door is often a one-way door only because you chose the destructive primitive. Prefer the primitive you can walk back through.
- **Contain blast radius structurally**, before the failure, with bulkheads / circuit breakers / cells / canaries / least privilege — not after, with a postmortem.

## Sizing a change: the two-axis grid

Plot every change on reversibility × blast radius. The interesting quadrants are the diagonals diff-size reasoning gets wrong:

| | **Low blast radius** | **High blast radius** |
|---|---|---|
| **Reversible (two-way)** | trivial — ship fast, light review | bias to ship, but stage a rollback (canary/flag); revert is cheap so the downside is bounded |
| **Irreversible (one-way)** | bounded — acknowledge, but the cap on harm is small | **the danger zone** — methodical, reviewed, explicitly acknowledged; turn it two-way if at all possible |

**Worked examples of the decoupling:**

- *One line, danger zone:* changing the algorithm that derives a content-address used as a join key. The diff is `sha1(` → `sha256(`. The blast radius is every record that joins on that key; the door is one-way if old records are already persisted. (This is exactly the substrate's M1 invariant below.)
- *500 lines, trivial:* a mechanical rename across 30 files behind a green test suite. Blast radius is bounded by the tests; the door is two-way (`git revert`).
- *Config, not code, danger zone:* flipping a feature-flag *default* from off to on. Zero code diff. Blast radius is 100% of users on next deploy.

## Reversibility as a first-class design goal

The cheapest way to be safe is to make wrong decisions cheap to undo. Concretely:

- **Prefer the reversible primitive.** Soft-delete over delete; tombstone over drop; deprecate-then-remove over remove; flag-gate-then-cut-over over cut-over; **quarantine over destroy**.
- **Out-of-tree / append-only effects.** Effects written as *new* objects + a pointer move are reversible by repointing; in-place mutation of shared state is not. (This is the core of immutability-as-safety and of the substrate kernel's design.)
- **Stage the irreversible step behind a human or a gate.** If a one-way door is unavoidable, make crossing it an explicit, separate, acknowledged action — not a side effect of a routine merge.
- **Measure your real reversibility.** Accelerate/DORA's **time-to-restore (MTTR)** and **change-fail-rate** are the empirical readout: a team that restores in minutes has effectively converted many one-way doors into two-way doors at the operational layer. Optimizing MTTR is optimizing reversibility.

## Containing blast radius structurally

Reversibility limits the *cost* of being wrong; containment limits the *reach*. The canonical containment patterns:

- **Bulkheads** (Release It! ch 5): partition resources (thread pools, connection pools, cells) so a failure in one partition cannot consume the resources of another. Named for ship hull compartments — a breach floods one compartment, not the vessel. Directly bounds blast radius.
- **Circuit Breaker** (Release It! ch 5): when a dependency is failing, stop calling it and fail fast, preventing a slow/failing dependency from cascading into thread exhaustion upstream (the **Cascading Failures** antipattern, ch 4).
- **Cells / cell-based architecture** (AWS Well-Architected): each cell is a complete, independent instance with a fixed maximum size; a partition key routes each request to one cell; a failure is contained to its cell while the others serve. The blast radius of any single failure is at most one cell.
- **Shuffle sharding** (AWS Builders' Library): assign each tenant a *virtual* shard of randomly chosen instances; overlap between any two tenants is small, so one bad tenant's blast radius is bounded to its shard, not the fleet.
- **Canary / gradual rollout** (Google SRE Workbook ch 16): "a partial and time-limited deployment of a change and its evaluation" — route a small fraction of traffic to the new version, compare against control, promote only if healthy. A bad push is caught while it affects a few percent, not 100%.
- **Least privilege** (threat-modeling): a component's worst-case blast radius if compromised equals the set of things it is authorized to touch. Narrow grants = small radius.

These compose: a system with cells + canary + circuit breakers has *defense in depth on blast radius* — a bad change has to escape the canary, then escape its cell, then trip no breaker, before it reaches the whole system.

## Substrate-Specific Examples

### The kernel never mutates the user's HEAD / working tree (maximally reversible)

The load-bearing reversibility decision in the Power Loom kernel: **all effects are out-of-tree git objects + `refs/loom/*` refs; the user's checked-out HEAD and working tree are never touched.** A spawn's delta is captured as a `commit-tree`'d object pinned under a hidden ref, never applied in place. This makes the entire effect-capture path a two-way door: nothing the kernel does can corrupt the user's branch, because the kernel writes only *new* objects and *new* refs. Recovery from any kernel bug is "ignore the loom refs" — zero blast radius into the user's real tree. (Probe-verified in the live dogfood: `enforce`, `candidate`, and `shadow` arms all left HEAD at the same commit.)

### Shadow-first, then enforce (prove in a no-mutation shadow before crossing the door)

The resolver ships in a **shadow** default that writes only a journal + provenance record and performs **no real mutation**, gated behind a flag before any enforcing path. This is the two-axis grid applied to rollout: the enforcing path is higher-blast-radius (it moves refs), so it was held until the journal-only shadow proved the logic on real delta-bearing spawns. Shadow is the canary; the flag is the gate. The order is deliberately *reversible-first*.

### K9 promote stages a branch — a HUMAN merges (the one-way door is gated)

The promote path **does not** merge into the user's mainline. It stages the delta onto a branch / candidate ref and stops; the actual merge — the irreversible, blast-radius-into-mainline step — is a separate, explicit **human** action. The substrate deliberately refuses to cross the one-way door automatically. "Merges are the user's gate; never auto-merge" is the codified form of "Type-1 decisions get a higher bar."

### Quarantine instead of destructive ops

When the ordered integrator hits a merge conflict or an un-resolvable merge-base (`git merge-base --all` returns ≠ 1 base, i.e. a criss-cross), it **quarantines** the candidate via a plain `update-ref` rather than discarding or force-resolving it. Quarantine is the reversible primitive: the delta is preserved and inspectable; no information is destroyed. This is "prefer the primitive you can walk back through" made concrete.

### M1 forward-coupling — a one-line, maximal-blast-radius invariant

The M1 invariant is the substrate's canonical proof that blast radius ≠ diff size: **every producer of a `post_state_hash` must reuse `computePostStateHash` verbatim.** A one-line deviation (a different field order, a different serializer, a stray normalization) silently breaks the value-equality join in `readByPostStateHash` — and because the store *keys* the provenance chain on that hash, the break is global to the chain and fails closed. One line, maximal blast radius. It is treated as a one-way door (any new producer must route through the shared function), exactly because the consequence-if-wrong is total, not because the change is large.

## Tension with Other Principles

### Blast-radius caution vs decision velocity (Bezos's actual warning)

The Bezos framing is *not* "be cautious." It is the opposite for most decisions: over-applying caution to two-way doors produces "slowness, unthoughtful risk aversion, failure to experiment." **Resolution**: caution is *targeted* by the two axes. Two-way / low-radius → move fast, low ceremony. One-way / high-radius → slow down. Spending Type-1 ceremony on Type-2 changes is itself a failure mode.

### Reversibility vs YAGNI

Engineering reversibility (soft-deletes, flags, canary infra) is upfront cost; YAGNI says don't build what you don't need. **Resolution**: the bar is the blast radius. For a low-radius two-way-door change, building elaborate rollback machinery is YAGNI theater. For a high-radius or one-way change, the reversibility infrastructure *is* needed — that's precisely the case YAGNI doesn't apply to.

### Containment vs simplicity (KISS)

Bulkheads, cells, and shuffle-sharding add structure and operational complexity. A monolith in one cell is simpler. **Resolution**: this is a `trade-off-articulation` decision — state what's sacrificed (operational simplicity) for what's gained (bounded blast radius), and let the consequence-if-wrong justify it. Cells earn their complexity only when a single-cell failure would otherwise be a whole-system failure.

### Reversibility vs consistency / atomicity

The most reversible design (append-only, out-of-tree, eventual) often trades away strong consistency. **Resolution**: see `reliability-scalability-maintainability` and `idempotency` — append-only + idempotent replay buys reversibility *and* a path to consistency on read, at the cost of read-time reconciliation.

## When to use this principle

- **Always at merge/deploy time** — name the blast radius and the rollback path before shipping, regardless of diff size.
- **Whenever a destructive primitive is on the table** (delete, drop, truncate, force-push, destroy, irreversible migration) — ask if a reversible one exists.
- **Whenever a change touches a shared/global surface** — a flag default, a join key, a content-address, a schema, an auth grant, a published API.
- **When sizing review ceremony** — route the heavy review to the one-way / high-radius changes; don't drown two-way doors in process.

## When NOT to use this principle (or apply with caveat)

- **Genuinely trivial two-way doors** — local refactors behind green tests, doc edits, formatting. Naming a "blast radius" is theater; just ship.
- **Forced one-way doors with no reversible alternative** — sometimes the only available primitive is irreversible (a third-party API call with side effects, a legally-required deletion). Acknowledge it; you can't engineer it away. The discipline is the *acknowledgement*, not pretending a two-way door exists.
- **Emergencies** — during an incident, the fastest mitigation may be the higher-blast-radius one; take it, then articulate the trade-off in the postmortem (and improve MTTR so the next incident has a cheaper undo).

## Failure modes when applied incorrectly

- **Diff-size reasoning** — "it's one line, skip review." The single most common path to a maximal-blast one-way door. Counter: size by consequence; route review by the grid, not the line count.
- **Reversibility theater** — claiming a rollback path exists that was never tested. An untested rollback is a one-way door you *believe* is two-way. Counter: rehearse the rollback (game-day / chaos test); measure MTTR.
- **Over-applying Type-1 ceremony** — gating every two-way door behind heavy review until velocity dies (Bezos's named failure). Counter: explicitly classify the door; fast-path the two-way ones.
- **Containment without observability** — cells/canaries that don't surface a bad signal still let the change escape. A canary you don't *evaluate* is just a slow rollout. Counter: pair every containment pattern with the metric that trips it (`observability-basics`).
- **Destructive-by-default primitives** — defaulting to delete/drop when soft-delete/quarantine was available. Counter: make the reversible primitive the default; require an extra acknowledgement to take the destructive one.

## Tests / verification

- **The three-question gate**: before any merge — (1) worst-case blast radius if wrong? (2) rollback path, and has it been exercised? (3) one-way or two-way door, and if one-way, who acknowledged it? Missing any answer blocks the merge.
- **Rollback rehearsal**: for high-radius changes, actually execute the rollback in a non-prod environment. An unrehearsed rollback doesn't count as reversibility.
- **MTTR / change-fail-rate tracking** (DORA): trend time-to-restore and change-fail-rate over time. Rising MTTR = reversibility is decaying.
- **Canary-evaluated, not just canary-deployed**: verify the gradual rollout has an automated health comparison that can *halt* promotion, not just a staggered schedule.
- **Destructive-primitive audit**: grep the change for `delete` / `drop` / `--force` / `rm -rf` / `destroy`; for each, confirm a reversible alternative was considered and the irreversible choice was deliberate.
- **Least-privilege check**: for a new component, the blast-radius-if-compromised equals its grants — confirm grants are minimal (`threat-modeling-essentials`).

## Related Patterns

- [architecture/discipline/stability-patterns](stability-patterns.md) — Bulkheads, Circuit Breaker, Steady State; the structural containment toolkit this principle prescribes.
- [architecture/discipline/trade-off-articulation](trade-off-articulation.md) — containment (cells/bulkheads) trades simplicity for bounded radius; that trade must be articulated, not assumed.
- [architecture/discipline/error-handling-discipline](error-handling-discipline.md) — fail-closed / fail-fast bound blast radius at the boundary; the M1 invariant fails closed by design.
- [architecture/discipline/reliability-scalability-maintainability](reliability-scalability-maintainability.md) — reversibility favors maintainability/reliability and often trades raw consistency; the R/S/M frame names the pull.
- [architecture/crosscut/idempotency](../crosscut/idempotency.md) — idempotent replay is what makes append-only, out-of-tree effects safely reversible.
- [security-dev/threat-modeling-essentials](../../security-dev/threat-modeling-essentials.md) — least privilege is blast-radius containment for the security lens.
- [infra-dev/observability-basics](../../infra-dev/observability-basics.md) — containment without the signal that trips it is just a slow rollout.

## Sources

Authored by multi-source synthesis of:

1. **Jeff Bezos, Amazon 2015 Letter to Shareholders** — the Type 1 (one-way door, irreversible) vs Type 2 (two-way door, reversible) decision framework, and the warning that large orgs over-apply the Type-1 process to Type-2 decisions, producing slowness and risk-aversion. The canonical source for the reversibility axis.
2. **Jeff Bezos, Amazon 1997 Letter to Shareholders** — the long-term-orientation framing ("a fundamental measure of our success will be the shareholder value we create over the long term"); investment decisions sized by their long-term, hard-to-reverse consequences.
3. **Release It! 2nd ed** (Michael Nygard, 2018), ch 5 (Stability Patterns: Bulkheads, Circuit Breaker, Steady State) + ch 4 (Stability Antipatterns: Cascading Failures, Blocked Threads). The structural blast-radius containment toolkit.
4. **Accelerate** (Forsgren / Humble / Kim, 2018) and the DORA program — the four delivery metrics; **change-fail-rate** and **time-to-restore (MTTR)** are the empirical measure of real-world reversibility.
5. **The Site Reliability Workbook** (Google, 2018) ch 16 (Canarying Releases) + **Site Reliability Engineering** (Beyer / Jones / Petoff / Murphy, 2016) ch 27 (Reliable Product Launches) — gradual rollout and canarying as blast-radius reduction; "canary" from the coal-mine allusion.
6. **AWS Well-Architected — Reducing the Scope of Impact with Cell-Based Architecture** (2023) + the REL-10 fault-isolation guidance + **shuffle sharding** (AWS Builders' Library, *Workload isolation using shuffle-sharding*) — the canonical cloud definition of blast radius and the cell / shuffle-shard containment techniques.

Each web source was verified to exist via WebSearch/WebFetch during authoring (Bezos 2015/1997 letter passages; Release It! 2nd ed table of contents; DORA four-metrics; Google SRE Workbook ch 16; AWS cell-based architecture FAQ + shuffle-sharding). Substrate examples are drawn from the Power Loom v3.1 kernel: out-of-tree-only effects (HEAD never mutated), shadow-first-then-enforce rollout, the K9 human-gated promote, conflict quarantine, and the M1 `computePostStateHash` forward-coupling invariant.

## Phase

Authored: kb authoring batch (v3.1-era, post-Phase-2 / Runtime Foundation). Multi-source synthesis from 6 verifiable sources spanning decision theory (Bezos), stability engineering (Nygard), delivery science (DORA/Accelerate), and cloud fault-isolation (Google SRE, AWS). Substrate examples emphasize the kernel's reversibility-by-construction (out-of-tree effects, shadow-first, human-gated promote, quarantine-over-destroy) and the M1 invariant as the load-bearing "blast radius ≠ diff size" exemplar. Serves the HETS architect (reversibility-preference, blast-radius-sizing), devops-sre (blast-radius-sizing, rollback-ready), and security-engineer (blast-radius-containment) lenses.
