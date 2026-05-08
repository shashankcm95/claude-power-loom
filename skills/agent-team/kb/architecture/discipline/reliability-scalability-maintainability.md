---
kb_id: architecture/discipline/reliability-scalability-maintainability
version: 1
tags:
  - discipline
  - architecture
  - foundational
  - reliability
  - scalability
  - maintainability
  - quality-attributes
sources_consulted:
  - "Designing Data-Intensive Applications (Martin Kleppmann, 2017) ch 1 (Reliable, Scalable, and Maintainable Applications)"
  - "Site Reliability Engineering (Beyer/Jones/Petoff/Murphy, Google, 2016) — entire book; particular weight on SLO/SLI chapter"
  - "Release It! (Michael Nygard, 2nd ed 2018) — operational reliability + stability"
  - "The Pragmatic Programmer (Hunt/Thomas, 20th anniv 2019) — engineering instincts on the three concerns"
  - "Software Architecture: The Hard Parts (Ford/Richards/Sadalage/Dehghani, 2021) — architecture characteristics taxonomy"
related:
  - architecture/discipline/trade-off-articulation
  - architecture/discipline/error-handling-discipline
  - architecture/discipline/stability-patterns
  - architecture/crosscut/idempotency
status: active+enforced
---

## Summary

**Principle (DDIA ch 1)**: System has three orthogonal quality concerns — Reliability (faults), Scalability (growth), Maintainability (productive evolution). Often pull in different directions; articulate which dominates.
**Substrate's R/A/FT specialization**: Reliability + Availability + Fault-tolerance; Maintainability hidden but exhibited via Convention G + drift-notes + Pre-Approval Verification.
**Test**: SLI/SLO defined? Load model documented? Maintainability self-test (new dev productive in N days)?
**Sources**: DDIA ch 1 + SRE book (free) + Release It! + Pragmatic Programmer + Hard Parts.
**Substrate**: H.7.22 R/A/FT codification; drift-note convention as maintainability primitive; soak period as reliability discipline.

## Quick Reference

**Principle**: A system has three orthogonal quality concerns — Reliability, Scalability, Maintainability — and they often conflict.

**Reliability** (continues working in face of faults):

- **Fault** = component deviation from spec; **Failure** = system-wide stop
- Faults are inevitable; failures are preventable via fault-tolerance
- Sources of faults: hardware, software, **human error** (leading cause in mature systems per SRE)
- SLI / SLO / Error Budget discipline: error budget = 1 - SLO; spend on features when within, focus on reliability when over

**Scalability** (handles growth):

- Define load parameters first (req/sec, fan-out, concurrent users, etc.)
- Optimize percentiles (p99+), not averages — tail latency dominates user-perceived performance
- Vertical (bigger machines) vs Horizontal (more machines) vs Elastic (auto-scaling)
- Hot-spot patterns are the usual scalability surprise (celebrity user, viral content)

**Maintainability** (productive evolution):

- **Maintenance is the dominant cost** — initial dev is 1-2y; maintenance is 5-20y
- Three sub-properties (DDIA): Operability + Simplicity + Evolvability
- Simplicity ≠ "no abstractions"; means hiding *unnecessary* complexity (per [deep-modules](../crosscut/deep-modules.md))

**Tensions**:

- **Reliability vs Scalability**: synchronous replication / strong consistency are reliable but unscalable
- **Scalability vs Maintainability**: microservices scale better but harder to maintain
- **Reliability vs Maintainability**: multi-region active-active is reliable but operationally complex

**Patterns for managing R/S/M**:

- Explicit articulation at decision time (per [trade-off-articulation](trade-off-articulation.md))
- SLO-driven prioritization — error budget governs feature-vs-reliability balance
- Maintainability investment proportional to expected lifetime
- Reliability through redundancy at the right layer (storage / runtime / app)

**Substrate examples**:

- H.7.22 R/A/FT codification: Reliability via contract-plugin-hook-deployment + matcher-drift detection; Availability via migration script + version bumps; Fault-tolerance via [PLUGIN-NOT-LOADED] + inverse-condition stderr
- Drift-note convention: 60+ drift-notes capture observed deviations + deferred work; future maintainers can answer "why is this so?"
- Convention G (H.7.25): simplicity primitive — 3 named classes reduce cognitive load for understanding 11-instruction family
- Pre-Approval Verification: evolvability primitive — substrate evolved 50+ phases without major rewrites because changes are vetted at architect layer
- Plan-template enforcement: operability primitive — every plan has same shape; future readers navigate via section headings
- Soak period commitment: reliability via empirical validation; "5+ phases with 0 new drift-notes" before v2.0 ships

## Intent

The most common architecture mistake: optimizing one quality concern in isolation while sacrificing others without acknowledgment.

- A team optimizes for **scalability** (microservices, event streaming, eventual consistency) and discovers the system is unmaintainable (no developer understands the whole; debugging takes days; onboarding a new engineer takes months)
- A team optimizes for **reliability** (synchronous replication everywhere, two-phase commit, defensive programming layers) and discovers the system is unscalable (latency budget is consumed by coordination; throughput is bounded; cost balloons)
- A team optimizes for **maintainability** (clean code, DRY abstractions, generic frameworks) and discovers the system is unreliable (failure modes hidden by abstractions; recovery requires understanding the framework's full semantics)

The intent of the R/S/M framing is to make all three orthogonal concerns visible at decision time, so trade-offs between them become explicit rather than implicit.

## The Principle

> "Reliability, scalability, and maintainability are the three concerns that are particularly important in most software systems." — Kleppmann, *Designing Data-Intensive Applications* ch 1

Reformulated:

- **Reliability**: the system performs the correct function at the desired level of performance, even when things go wrong (hardware faults, software bugs, human error)
- **Scalability**: the system has reasonable ways of dealing with growth (in data volume, traffic volume, complexity)
- **Maintainability**: many different people will work on the system over time, productively maintaining current behavior and adapting it to new use cases

The three concerns are **orthogonal but coupled**. Improving one often costs another. Articulating which the current decision optimizes is the discipline.

### The substrate's R/A/FT specialization

Per H.7.22+: substrate's own framing uses **R/A/FT (Reliability / Availability / Fault-tolerance)**. Mapping to DDIA's R/S/M:

| DDIA | Substrate R/A/FT | Mapping |
|------|------------------|---------|
| Reliability | Reliability | Direct |
| (implicit in Reliability) | Availability | Substrate's distinction: Availability = serves requests; Reliability = serves correctly |
| (implicit in Reliability — fault-tolerance is the mechanism) | Fault-tolerance | Substrate's mechanism axis: how Reliability + Availability are achieved |
| Scalability | (implicit) | Substrate is single-machine; scalability is currently out-of-scope |
| Maintainability | (implicit) | Substrate's discipline-via-Convention-G + drift-notes; not a primary axis |

The substrate's R/A/FT is appropriate for its scale (single-process, single-developer); the broader R/S/M framing is what it would adopt at multi-team / multi-deployment scale.

## Reliability

Per Kleppmann (DDIA ch 1):

> "A system should continue to work correctly, even in the face of faults and human errors."

### Faults vs Failures

- **Fault**: one component deviates from its specs (hardware crash, software bug, network partition, slow disk)
- **Failure**: the system as a whole stops providing the required service

Faults are inevitable; failures are preventable. **Fault-tolerance** is the design discipline of preventing faults from causing failures.

### Sources of faults

Per DDIA:

- **Hardware faults**: disk failures, RAM errors, power outages, hardware bugs (rowhammer, etc.)
- **Software faults**: bugs that propagate through the system; cascading failures; resource leaks
- **Human error**: misconfiguration, accidental deletion, wrong deployment, miscommunication

The interesting research finding (per SRE book): **human error is the leading cause of outages in mature systems**. Hardware reliability has improved enormously over decades; software bugs are caught by testing + code review; operational mistakes are the residual.

### Approaches to reliability (DDIA + SRE)

- **Hardware redundancy**: RAID, dual power supplies, geographically distributed replicas
- **Software redundancy**: process supervision; circuit breakers; bulkheads (per Release It!)
- **Self-checking**: checksums; quorum reads; consistency invariants checked at runtime
- **Decoupling**: a fault in one component shouldn't propagate; bulkheads isolate
- **Operational design**: reduce opportunities for human error; provide good defaults; make the right thing easy
- **Sandboxes**: provide non-production environments for testing changes
- **Roll-back**: make it fast to revert configuration changes
- **Monitoring + alerting**: catch faults early before they become failures

### SLOs / SLIs / Error Budgets (SRE book)

The SRE discipline for reliability:

- **SLI** (Service Level Indicator): a quantitative measure (e.g., success rate of requests, p99 latency)
- **SLO** (Service Level Objective): a target value for the SLI (e.g., 99.9% success rate)
- **SLA** (Service Level Agreement): the contractual SLO + consequences for missing it
- **Error Budget**: 1 - SLO; how much "unreliability" you can spend (e.g., 0.1% = 43 minutes/month of allowed downtime)

The error budget is the operational tool: when within budget, ship features; when over budget, focus on reliability. This makes the trade-off between reliability and feature velocity explicit and quantitative.

### Substrate-specific reliability examples

- **Hooks fail-open with observability**: hook errors don't break Claude sessions; logged for diagnostic. Reliability over hard-correctness for this layer.
- **Atomic-rename for tracker files**: filesystem-level atomicity prevents partial-write corruption. Fault-tolerance at the file system layer.
- **`_lib/lock.js`**: H.3.6's self-PID orphan reclamation prevents stale locks from blocking the substrate. Self-healing under fault.
- **Pre-Approval Verification**: catches architectural failures at plan time, not runtime. Reliability via early detection.
- **Substrate's `error-critic.js`**: detects and consolidates repeated failures; surfaces escalation. Reliability via observability.

## Scalability

Per Kleppmann (DDIA ch 1):

> "As the system grows, there should be reasonable ways for dealing with that growth."

### Defining growth

Scalability is not a one-dimensional property. The first step is defining the *load parameters* for your specific system:

- **Web service**: requests per second; concurrent users; request fan-out (a single request that triggers N internal calls)
- **Database**: write throughput; read throughput; data volume; concurrent connections
- **Message queue**: messages per second; queue depth; consumer count
- **HETS / agent system**: spawns per session; depth of spawn tree; coordination latency

The right load parameter depends on the system's bottleneck. Twitter's classic example (per DDIA): the bottleneck isn't tweet writes (4.6k/sec average); it's the fan-out to followers (millions/sec at peak when celebrities tweet). Optimizing the wrong metric wastes effort.

### Performance metrics

For latency-sensitive systems, **percentiles** (not averages) are the load-bearing metric:

- p50 (median): half of requests faster than X
- p90, p99, p99.9: tail latency

The tail matters because users with the most data often experience the worst latency, and bad tail latency dominates user-perceived performance. SRE discipline: optimize for high percentiles (p99+); accept that the cost of optimizing further (p99.99+) is rarely worth it.

### Vertical vs Horizontal scaling

- **Vertical**: bigger machines (more CPU, more RAM, faster storage). Operationally simple; bounded by single-machine limits.
- **Horizontal**: more machines, distributed coordination. Unbounded scaling but operational complexity (distributed systems problems per DDIA ch 8).

Modern systems are typically hybrid: scale vertically until single-machine limits hit; then scale horizontally with careful state distribution.

### Elastic systems

Auto-scaling: spin up resources during load spikes; scale down when idle. Pros: cost-efficient; handles unpredictable load. Cons: operational surprises; cold-start latency; auto-scaling rules are themselves a source of bugs.

### Substrate-specific scalability

The substrate is currently single-process, single-developer; scalability is currently out-of-scope. But the architecture exhibits scalability-aware design:

- **HETS spawn parallelism**: orchestrators can spawn multiple actors in parallel; throughput scales with parallel worker count
- **Run-state isolation**: each chaos run lives in its own directory; runs don't interfere
- **Stateless hooks**: hooks don't share state across invocations; horizontal scaling is trivial if needed
- **Content-addressed KB**: kb-resolver's hash-pinned refs enable safe parallel reads

The substrate would need explicit scalability work for multi-team / multi-machine deployment (distributed identity store, distributed tree-tracker, etc.) — but that's v2.x territory.

## Maintainability

Per Kleppmann (DDIA ch 1):

> "Different people who works on the system should all be able to work on it productively."

### The maintenance cost is the dominant cost

> "The majority of the cost of the software is in the ongoing maintenance and not the initial development." — DDIA ch 1

This is the most under-acknowledged truth in software. Initial development is 1-2 years; maintenance is 5-20 years. Maintenance includes bug fixes, security patches, dependency upgrades, feature additions, refactoring under changing requirements.

A system optimized for fast initial development but hard to maintain has a much higher total cost than a system slower to build but easier to maintain. The trade-off is rarely articulated at decision time because the maintenance cost is in the future and the development cost is now.

### Three sub-properties of maintainability (DDIA)

DDIA decomposes maintainability into three sub-concerns:

- **Operability**: making routine tasks easy. Good monitoring; avoid dependency on individual machines; good documentation; sensible defaults; self-healing where possible
- **Simplicity**: managing complexity. Reduce cognitive load. Make abstractions that hide *unnecessary* complexity (without hiding *necessary* complexity — see [deep-modules](../crosscut/deep-modules.md))
- **Evolvability**: adapting to change. Agile / continuous-evolution practices. Anticipate where requirements will change; make those areas flexible

These three are themselves orthogonal — a system can be operable but hard to evolve (legacy enterprise software with extensive runbooks); evolvable but inoperable (cutting-edge framework with constant breaking changes); simple but inflexible (overly rigid model that fits today but not tomorrow).

### Substrate-specific maintainability

The substrate exhibits explicit maintainability discipline:

- **Convention G's taxonomy** (H.7.25): names 3 classes for forcing instructions; reduces cognitive load for understanding the family; new instructions slot into a known class
- **Drift-notes convention**: captures observed deviations from intent; readable by future maintainers without prior context
- **Pre-Approval Verification**: catches architectural drift at plan time; ADRs document trade-offs for future readers
- **Phase-tag versioning**: every substantive change has a phase tag; git log is searchable by phase
- **Plan-template enforcement** (H.7.12 + H.7.22): plans MUST contain Context / Routing Decision / HETS Spawn Plan / Files / Phases / Verification / Out of Scope / Drift Notes / Principle Audit. Forces consistency for future readers.
- **`forcing-instruction-family.md`**: catalog enables future maintainers to understand the family without reading every emission file
- **Hooks as deep modules**: each hook has a small interface; replacement / refactoring is local

## Tension between R / S / M

The three concerns frequently conflict. Articulating the tension is the discipline.

### Reliability vs Scalability

- **Synchronous replication** is more reliable but less scalable (latency cost per request)
- **Strong consistency** is more reliable but less scalable (coordination cost; CAP theorem)
- **Defensive checks at every layer** is more reliable but less scalable (CPU cost per request)

The cloud-native answer is usually: pick eventual consistency where you can; reserve strong consistency for narrow critical paths; design idempotency to make eventual consistency tolerable.

### Scalability vs Maintainability

- **Microservices** scale better but are harder to maintain (distributed-systems problems, deployment complexity, debugging across services)
- **Aggressive caching** scales better but is harder to maintain (cache invalidation is hard; stale data is a debugging trap)
- **Custom optimizations** (manual sharding, custom data structures) scale better but harder to maintain (specialized knowledge required)

The cloud-native answer: start with the simpler architecture; introduce scalability machinery only when actual measured load demands it. Over-engineered scalability is a maintenance tax that may never pay back.

### Reliability vs Maintainability

- **Multi-region active-active** is more reliable but harder to maintain (data consistency across regions, deployment coordination)
- **Defense-in-depth security** is more reliable but harder to maintain (each layer has its own complexity, configurations multiply)
- **Custom monitoring + alerting** is more reliable but harder to maintain (operational burden of maintaining the monitoring stack)

The answer: pick the simplest reliability mechanisms that meet your SLO; reserve complex multi-layered defense for systems where the threat model justifies it.

## Substrate-Specific Examples

### H.7.22 R/A/FT codification

Per H.7.22: the substrate explicitly named R/A/FT as primary concerns, mapped them to specific substrate features:

- **Reliability**: `contract-plugin-hook-deployment` (every plugin hook must be deployed somewhere); matcher-drift detection; Principle Audit required in architect output
- **Availability**: migration script (deterministic, user-confirmed, reversible); manifest version bump per phase; DRY `_lib/settings-reader.js`
- **Fault tolerance**: `[PLUGIN-NOT-LOADED]` forcing instruction (9th in family at the time); legacy `install.sh` kept as fallback; inverse-condition stderr nudge

This is the substrate's explicit R/S/M framing applied to the plugin distribution problem space. Each feature was justified against one or more axes.

### Drift-note convention as maintainability primitive

Drift-notes are the substrate's primary maintainability discipline. Each drift-note captures:

- An observed deviation from intent (or unresolved trade-off)
- Why it wasn't fixed in the current phase
- What conditions would justify revisiting

Future maintainers can answer "why is this so?" by reading drift-notes — the answer is captured at the time the deviation was observed, not reconstructed years later.

The substrate has captured 60+ drift-notes through H.7.27. Many are closed (resolved in subsequent phases); some remain open as deferred concerns. The pattern is that no information is lost — every observed deviation has a durable artifact.

### Convention G as simplicity primitive

H.7.25's Convention G (forcing-instruction class taxonomy) is maintainability via simplicity. Before Convention G, future maintainers reading the substrate's 11 forcing instructions had to understand each independently. After Convention G, three named classes provide a navigation structure. New instructions slot into a class; readers understand them by class membership; cognitive load drops.

The H.7.26 + H.7.27 consolidations (11 → 9 → 8 active markers) were maintainability work: each retirement reduced future cognitive load.

### Pre-Approval Verification as evolvability primitive

The substrate's H.7.22+ Pre-Approval Verification process makes the substrate evolvable: significant changes go through architect + code-reviewer parallel spawn, surfacing trade-offs and catching errors before they ship. The substrate has evolved from H.1 → H.7.27 (50+ phases) without major rewrites because each evolution step was vetted at the architect layer.

This is evolvability via discipline: not "change everything every phase" (that breaks things) and not "freeze everything" (that prevents learning). The middle path is "every change is articulated, vetted, and traceable."

### Plan-template enforcement as operability primitive

The substrate's `validate-plan-schema.js` enforces plan structure. Every plan has the same shape; future readers can navigate any plan via section headings; missing sections trip the gate. This is operability — making the routine task (reading and understanding a plan) easy.

### Soak period as reliability primitive

The H.7.27 commitment to "5+ phases with 0 new drift-notes before v2.0.0" is reliability discipline: don't ship a major version until the substrate has been stable for several phases. This catches issues that don't surface in single-phase testing — drift, coupling problems, abstraction leaks. The soak window is reliability via empirical validation.

## Patterns for managing R / S / M

### Pattern 1: Explicit articulation at decision time

Per the [trade-off-articulation](trade-off-articulation.md) pattern: when proposing a change, articulate which axis it favors and which axis it sacrifices. Don't let R / S / M trade-offs stay implicit.

Example:

> "Adopting microservices for service X favors scalability (independent deployment, independent scaling) at the cost of maintainability (operational complexity, distributed-systems debugging). For service X specifically, the throughput requirements justify the trade. For service Y, the trade is unfavorable; keep monolithic."

### Pattern 2: SLO-driven prioritization

Per SRE book: pick SLOs that match the business reality. If 99.9% reliability is sufficient, don't pay for 99.99%. Use error budget to gate feature work — when budget is healthy, ship features; when budget is depleted, focus on reliability.

The substrate's analog: when no new drift-notes are accumulating (within "budget"), ship features (KB authoring, new patterns); when drift-notes are accumulating fast (over "budget"), focus on cleanup.

### Pattern 3: Maintainability investment proportional to lifetime

Per Pragmatic Programmer instinct: invest in maintainability proportional to expected system lifetime. A 1-week prototype: minimal documentation, no abstractions. A 5-year production system: heavy investment in operability, clean abstractions, drift-note discipline.

### Pattern 4: Reliability through redundancy at the right layer

Don't add reliability at every layer. Pick the layers where redundancy is cheapest and most effective:

- **Storage**: filesystem-level atomicity (atomic rename); database-level transactions; replication
- **Runtime**: process supervision (systemd, k8s); circuit breakers
- **Application**: idempotent operations enabling safe retry; graceful degradation

The substrate puts reliability at the storage layer (atomic rename for trackers) and the runtime layer (fail-open hooks with observability). Application-level reliability is the calling code's responsibility.

### Pattern 5: Scalability as deferred decision

Per Hard Parts trade-off discipline: don't optimize for scalability you don't yet have. The classical advice: build the simplest thing that works for current load × 10; rewrite for higher load if and when you reach it.

Premature scalability optimization is a common architectural failure mode. The cost is paid in maintainability now; the benefit is realized only if the system reaches the predicted scale (which it often doesn't).

## Recognizing R / S / M failures

### Reliability failure: unbounded blast radius

A bug, slow service, or operational mistake propagates without isolation. One downstream slowness causes upstream timeouts; cascade builds; entire system fails.

**Cause**: missing bulkheads / circuit breakers / timeouts. **Fix**: per [stability-patterns](stability-patterns.md).

### Scalability failure: unexpected hot spot

The system handles average load fine; under specific patterns (celebrity user, viral content), one component becomes a hot spot that bottlenecks the entire system.

**Cause**: load distribution assumes uniformity; reality is power-law. **Fix**: identify hot-spot patterns; design for them specifically.

### Maintainability failure: bus factor

The system has knowledge concentrated in one developer. They leave / get sick / vacation; the team cannot maintain the system without them.

**Cause**: insufficient documentation; tribal knowledge; complex implicit assumptions. **Fix**: drift-note discipline; ADR culture; pair programming; explicit knowledge transfer.

### Cross-cutting failure: implicit coupling

The system has high coupling that no one realizes until something breaks. A change to component A unexpectedly breaks component B because of an undocumented dependency.

**Cause**: missing dependency-direction discipline (per [dependency-rule](../crosscut/dependency-rule.md)); no architectural fitness functions. **Fix**: explicit dependency rules enforced via tests / lint.

## Tension with Other Principles

### R/S/M vs Speed of Decision

Articulating R/S/M trade-offs at every decision is slow. Most decisions don't need it.

**Heuristic**: scope articulation to architectural decisions (those affecting multiple components / future evolution). Local decisions (function naming, single-file refactoring) don't need full R/S/M articulation.

### R/S/M vs YAGNI

R/S/M discipline can encourage premature optimization for hypothetical futures. YAGNI says don't build flexibility for what you don't yet need.

**Resolution**: R/S/M is for decisions that LOCK IN a trade-off (architectural). For decisions that can be revisited cheaply (local), defer R/S/M analysis until evidence demands it.

### R/S/M vs Simplicity

The most R/S/M-aware design can be more complex than the simplest design. Adding monitoring, fitness functions, error budgets adds operational complexity.

**Heuristic** (per substrate's H.7.22 Principle Audit): the trade-off is real; articulate it at the decision. If R/S/M machinery's complexity outweighs its benefit for your scale, don't add it.

## When to use this framing

- **Always when proposing significant architectural changes** — articulate which R/S/M concern it primarily addresses
- **Always when comparing alternatives** — comparison is on R/S/M dimensions, not "feels right"
- **In retrospectives** — when something fails, classify the failure on R/S/M axes; design corrective work to address the right axis
- **In hiring / staffing decisions** — different skill sets serve different axes (reliability engineers, scalability/distributed-systems specialists, maintainability/refactoring experts)

## When NOT to use this framing (or apply with caveat)

- **Trivial single-component decisions**: function design, naming — overkill
- **When all three axes are clearly satisfied**: no trade-off to articulate
- **When axis priority is dictated externally** (regulatory: reliability is mandatory regardless of cost): the framing helps document the reason, but doesn't add new options

## Failure modes when applied incorrectly

- **R/S/M as buzzword**: invoking the framing without actually doing the analysis. Symptom: vague claims that one design "improves reliability" without specifying SLO targets or fault scenarios.
- **One-axis fixation**: optimizing only for reliability (or only for scalability) and ignoring maintainability. Symptom: brittle systems that work in production but no one can change.
- **Over-articulation**: spending more time analyzing R/S/M trade-offs than building the system. Symptom: design phase that never ends.

## Tests / verification

- **SLI / SLO definition**: does the system have explicit reliability targets? Are they measured? Are they reviewed regularly?
- **Load model documentation**: is the system's expected load documented (current + projected)? Are bottlenecks identified?
- **Maintainability self-test**: a new developer can become productive in N days; what is N? If unmeasured, maintainability is implicit.
- **Trade-off article presence**: do significant decisions have ADRs articulating R/S/M trade-offs? Spot-check sample decisions.

## Related Patterns

- [architecture/discipline/trade-off-articulation](trade-off-articulation.md) — R/S/M is the primary trade-off vocabulary
- [architecture/discipline/error-handling-discipline](error-handling-discipline.md) — reliability via end-to-end error propagation
- [architecture/discipline/stability-patterns](stability-patterns.md) — Release It! patterns for reliability machinery
- [architecture/crosscut/idempotency](../crosscut/idempotency.md) — reliability requires idempotent retries
- [architecture/crosscut/single-responsibility](../crosscut/single-responsibility.md) — maintainability via SRP boundaries

## Sources

Authored by multi-source synthesis of:

1. **Designing Data-Intensive Applications** (Martin Kleppmann, 2017), ch 1 (Reliable, Scalable, and Maintainable Applications). The canonical R/S/M framing. Defines the three concerns; lays out the sub-properties; warns about the maintenance-cost-dominance reality.
2. **Site Reliability Engineering** (Beyer / Jones / Petoff / Murphy, Google, 2016, free online). The operational discipline. SLI / SLO / SLA / Error Budget; toil reduction; blameless postmortems; production engineering as practice.
3. **Release It!** (Michael Nygard, 2nd ed 2018) — operational reliability + stability patterns. Capacity planning; production-failure-mode thinking.
4. **The Pragmatic Programmer** (Hunt/Thomas, 20th anniv 2019) — engineering instincts on the three axes.
5. **Software Architecture: The Hard Parts** (Ford/Richards/Sadalage/Dehghani, 2021) — architecture characteristics taxonomy provides a richer set of axes (R/S/M is the simplification; the full taxonomy includes deployability, testability, observability, etc.).

Substrate examples cite drift-notes from H.7.22 (R/A/FT codification), H.7.25 (Convention G as simplicity primitive), drift-notes 21 / 47 / 56 (captured-trade-offs as maintainability artifacts), and the broader Pre-Approval Verification + plan-template-enforcement disciplines as evolvability + operability primitives.

## Phase

Authored: kb authoring batch 5 (post-H.7.27, soak-track work). First-wave priority 8 of the authoring queue. Multi-source synthesis from 5 sources. Substrate examples emphasize the substrate's H.7.22+ R/A/FT framing as a specialization of the broader R/S/M taxonomy; convention-driven maintainability primitives; SLO-style reliability discipline applied to the drift-note convention. The substrate is itself an exemplar of R/S/M discipline applied at single-process scale.
