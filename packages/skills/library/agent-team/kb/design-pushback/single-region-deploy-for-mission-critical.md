---
kb_id: design-pushback/single-region-deploy-for-mission-critical
version: 1
tags: [design-pushback, infra, reliability, medium-severity]
related:
  - architecture/discipline/stability-patterns
  - architecture/discipline/reliability-scalability-maintainability
  - infra-dev/kubernetes-essentials
status: active+enforced
pattern: |
  Deploying a system characterized as "mission-critical", "production-
  grade", "highly available", or "for customer use" into a single cloud
  region with no failover plan, no cross-region replication, and no
  documented RTO/RPO targets.
severity: MEDIUM
applies_when:
  intent: [build, plan, refactor]
  domain: [infra, backend, web]
  feature_keywords:
    - production
    - "production-grade"
    - "mission-critical"
    - "high availability"
    - HA
    - SLO
    - SLA
    - "customer-facing"
    - "revenue-generating"
    - "real-time"
applies_NOT_when:
  - prototype-only
  - "internal tool with documented best-effort availability"
  - "explicitly accepting single-region risk with stated rationale"
  - "MVP / pre-PMF stage"
  - "cost-constrained side project"
preferred_alternative:
  - "Multi-region active-passive: primary region serves traffic, secondary stays warm-replicated, manual or automated DNS failover"
  - "Multi-region active-active: traffic routed to nearest region via Anycast/GeoDNS, cross-region replication via CDC or distributed DB"
  - "Single-region with explicit best-effort SLA + documented Recovery Time Objective"
  - "Managed services that handle multi-region internally (Cloudflare Workers, fly.io, Vercel Edge, Aurora Global)"
why_better: |
  - **Single-region failures happen**: AWS us-east-1 has had multi-hour
    outages roughly annually for the last decade (Dec 2021, Jun 2023,
    etc.). GCP, Azure each have similar histories. Region-level outages
    are a "when not if" event for any system running long enough.
  - **Cascading failure surface**: a single-region deployment couples
    your availability to the region's network, EBS, RDS, S3, IAM
    (the IAM dependency caught many teams in 2021), and dozens of
    transitive dependencies. Cross-region designs decouple by definition.
  - **Maintenance windows**: cloud providers do planned maintenance
    (control-plane upgrades, hardware migrations). In a single region,
    these become user-visible incidents. In multi-region, traffic
    drains gracefully.
  - **Latency for global users**: even when single-region IS up, users
    far from the region see degraded latency. Multi-region with
    geo-routing fixes this for free.
  - **Regulatory data residency**: GDPR, India's DPDPA, China's PIPL,
    and others increasingly require data localization. A single-region
    architecture cannot satisfy these without re-architecting.
  - **Disaster recovery testing**: a multi-region architecture has DR
    capability built-in (failover IS the DR test). Single-region
    requires explicit DR runbook + backup-restore drills, which atrophy.
override_requires: |
  Explicit acknowledgment of:
  - Documented Recovery Time Objective (RTO) for a region-level
    outage — what's the maximum acceptable downtime?
  - Documented Recovery Point Objective (RPO) — how much data loss is
    acceptable on a hard region failure?
  - Backup strategy with tested restore procedure (last successful
    restore-from-backup drill within last 90 days)
  - Cost-benefit analysis showing the multi-region cost (typically
    1.5-2x infrastructure spend) is not justified by the reliability
    delta you're forgoing
  Or: state that the system is NOT actually mission-critical despite
  the brief's framing (legitimate — sometimes "production-grade" means
  "polished UX", not "five-nines availability").
empirical_origin: |
  Industry-common. v2.8.2-run1 + v2.8.3-run1 bench projects deployed to
  single-region Cloudflare Pages (legitimate for the bench scope — they
  were not mission-critical). Pattern surfaces consistently in early-
  stage product teams that say "production" when they mean "shipped" —
  the framing primes for single-region defaults that become hard to
  unwind at scale.
---

## Quick Reference

**The anti-pattern**: A team says "we're building a production-grade
SaaS for our customers" and deploys to single-region AWS / GCP / Azure
with no DR strategy. Months later, the cloud provider has a regional
outage; the SaaS is down for 4 hours; customers churn.

**Why it bites**: cloud reliability marketing implies "the cloud
doesn't go down". Single regions DO go down, regularly. The
architecture choice that determines whether "your service is down" or
"you fail over to another region" is made at deployment-design time —
nearly impossible to retrofit.

**The fix** (in order of effort):

1. **MVP-grade**: single-region is fine + explicit RTO statement +
   tested backup-restore. Set expectations honestly.
2. **Scale-up grade**: active-passive multi-region. Primary serves
   traffic; secondary is warm. DB replicates async. DNS failover
   manual or via health checks. Maybe 1.4x cost.
3. **Mission-critical grade**: active-active multi-region with global
   traffic routing. Cross-region DB (Aurora Global, CockroachDB,
   YugabyteDB) or CDC-replicated stores. ~2x cost but no failover
   pause.
4. **Cloud-native grade**: managed services that abstract multi-region
   away. Cloudflare Workers, fly.io, Vercel Edge, AWS Lambda@Edge run
   in N regions transparently. Higher unit cost but no infra ops.

## Full content

### What "mission-critical" actually means

This pattern has a CALIBRATION problem. The word "production" or
"mission-critical" in a brief is often aspirational, not technical.

Honest scoring of mission-critical:

| Signal | Interpretation |
|--------|---------------|
| Has paying customers | Likely mission-critical (revenue-generating) |
| Customer SLA in writing | DEFINITELY mission-critical |
| Internal tool, hourly use | Important but downtime survivable |
| Engineering-team tool | Best-effort, downtime educational |
| Pre-PMF / MVP / experimental | Best-effort by definition |

The pushback fires on briefs that describe customer-facing or
revenue-generating contexts. It does NOT fire on briefs that explicitly
acknowledge "MVP" or "experimental" — single-region is the right
default for those.

### The cost question

Multi-region IS expensive. Typical cost premium:

- Active-passive: 1.3-1.6x infrastructure spend (idle replica capacity)
- Active-active: 1.8-2.2x (full duplicate)
- Cross-region DB: significant if using global-write multi-master
- Network egress between regions: $0.02-0.09 / GB depending on cloud

For a company doing $100K MRR, 2x infrastructure cost may be $10K/month
extra. For a company doing $10K MRR, that's a death sentence.

The pushback exists to MAKE THIS CONVERSATION HAPPEN at architecture
time, not to mandate the expensive option. "We're single-region because
we're $5K MRR and 2x infra would kill us" is a perfectly valid
override.

### Architecture patterns

**Active-passive (warm standby)**:

```
            Route 53 health-check
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
   Region A (primary)  Region B (warm)
   ┌──────────────┐   ┌──────────────┐
   │ Web tier     │   │ Web tier     │
   │ App tier     │   │ App tier     │
   │ Primary DB ──┼──→┤ Replica DB   │ (async replication)
   └──────────────┘   └──────────────┘
```

DNS health check fails over to Region B when A is down. Replica
promotes to primary. Manual or automated.

**Active-active (geographic load balancing)**:

```
              GeoDNS / Anycast
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
   Region A           Region B
   (us-east users)    (eu-west users)
        │                   │
        └─────── CDC ───────┘
        (or distributed DB layer)
```

Both regions serve writes. Conflict resolution at DB layer (CRDT,
last-write-wins, or pgsql logical replication with conflict handlers).
No failover pause.

**Cloud-native (managed multi-region)**:

```
   Cloudflare Workers / fly.io / Vercel Edge
   ├─ deployed to 200+ regions automatically
   ├─ traffic auto-routed to nearest
   ├─ DB: pick cross-region service (Neon, Turso, FaunaDB)
   └─ no manual region setup
```

Highest abstraction, lowest infra-ops burden. May cost more per request
than DIY but eliminates the architecture conversation entirely.

### Single-region acceptable contexts

- **Strict regulatory data residency**: if you must serve only one
  region (Iran sanctions, etc.), multi-region IS impossible
- **Cost-bound MVP**: legitimate; just document the trade
- **Single-customer enterprise deals**: if the contract specifies
  one region, multi-region is over-engineering
- **Edge case: latency-bound trading systems**: where co-location
  matters more than multi-region

These all have a common shape: explicit constraint that makes
multi-region wrong, documented at architecture time.

### References

- AWS Multi-Region Application Architecture: https://aws.amazon.com/architecture/well-architected/
- Google SRE Book — Service-Level Objectives chapter
- DDIA ch 5 (Replication) + ch 9 (Consistency and Consensus)
- Cloudflare Anycast & Global Network docs
- AWS Post-Event Summaries (the actual outage post-mortems are
  educational about what fails in single-region)
