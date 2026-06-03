---
kb_id: security-dev/defense-in-depth
version: 1
tags:
  - security
  - defense-in-depth
  - secure-by-default
  - least-privilege
  - auditability
  - severity-calibration
  - foundational
sources_consulted:
  - "Jerome H. Saltzer & Michael D. Schroeder, 'The Protection of Information in Computer Systems' (Proceedings of the IEEE, 63(9), 1975) — the eight design principles (economy of mechanism, fail-safe defaults, complete mediation, open design, separation of privilege, least privilege, least common mechanism, psychological acceptability) + work factor + compromise recording"
  - "OWASP Developer Guide — Security Principles (Defense in Depth, Fail Safe / Security by Default, Least Privilege, Complete Mediation, Compartmentalize) + OWASP Cheat Sheet Series (Secure Product Design)"
  - "NIST SP 800-53 Rev. 5 — Security and Privacy Controls for Information Systems and Organizations (SC-7 Boundary Protection 'deny by default, allow by exception'; CM-7 Least Functionality; AU-9 Protection of Audit Information — tamper-resistance) (2020, upd. 2023)"
  - "NIST SP 800-160 Vol. 1 — Engineering Trustworthy Secure Systems (problem/solution/trustworthiness contexts; defense-in-depth as a structural design strategy) (Rev. 1, 2022)"
  - "FIRST.org — Common Vulnerability Scoring System (CVSS) v3.1 Specification Document (2019), qualitative severity rating scale (None / Low / Medium / High / Critical), and CVSS v4.0 (2023) Base/Threat/Environmental/Supplemental metric groups"
related:
  - security-dev/threat-modeling-essentials
  - security-dev/auth-patterns
  - architecture/discipline/blast-radius-and-reversibility
  - architecture/discipline/error-handling-discipline
  - architecture/discipline/refusal-patterns
  - infra-dev/observability-basics
status: active
---

## Summary

**Defense in depth (OWASP / NIST SP 800-160)**: layer independent controls so no single failure is fatal — "single points of complete compromise are eliminated or mitigated by … multiple layers of security safeguards" (OWASP). A control *will* fail; the question is what catches it.
**Secure by default (Saltzer & Schroeder 1975 — fail-safe defaults + least privilege)**: base access on *permission, not exclusion*; every actor runs with the least privilege necessary; the default state on error is the *safe* state, not the open one.
**Auditability (NIST SP 800-53 AU-9; Saltzer & Schroeder "compromise recording")**: tamper-evident, traceable logging — "mechanisms that reliably record [unauthorized access] can be used in place of more elaborate mechanisms that completely prevent loss" — and the audit trail itself must be protected against tampering.
**Realistic severity (CVSS v3.1 / v4.0, FIRST.org)**: calibrate severity on a defensible scale (CVSS bands None→Critical) instead of crying wolf; over-rating burns the team's response budget and trains responders to ignore alerts.
**Test**: name (a) two *independent* layers that must both fail for the asset to be lost, (b) the fail-safe default each control takes on error, (c) where the tamper-evident audit record lands, and (d) the calibrated severity (with rationale) of the worst un-caught failure.
**Substrate**: the kernel layers worktree isolation + static capability masks + the agent.md↔contract reconciliation validator + tamper-evident provenance records (`idempotency_key` content-addressing) + fail-closed hashing — no single layer is trusted alone.

## Quick Reference

**The four named instincts — one row each:**

| Instinct | One-line | Anchor source |
|----------|----------|---------------|
| **defense-in-depth** | Layer independent controls; assume each one fails | OWASP Security Principles; NIST SP 800-160 |
| **secure-by-default** | Fail-safe defaults + least privilege; deny by default | Saltzer & Schroeder 1975; NIST SC-7 / CM-7 |
| **auditability** | Tamper-evident, traceable logging; protect the log | NIST SP 800-53 AU-9; S&S "compromise recording" |
| **realistic-severity** | Calibrated severity (CVSS), not crying wolf | FIRST.org CVSS v3.1 / v4.0 |

**Defense in depth — the layers (OWASP Secure Product Design):**

| Layer | Example control | Fails when … |
|-------|-----------------|--------------|
| Network / boundary | firewall, segmentation, deny-by-default egress (NIST SC-7) | misconfig opens a port |
| Authentication | who are you? (see `auth-patterns`) | credential theft / phishing |
| Authorization | are you allowed? least-privilege grant | over-broad role |
| Input validation | reject malformed at the boundary | parser gap / encoding trick |
| Integrity / crypto | signing, hashing, TLS | weak/forgeable hash |
| Audit + monitoring | tamper-evident log + alert (NIST AU-9) | log unprotected or unread |

The point of the table: an attacker must defeat *multiple independent rows*, not one. If two rows fail together for the same root cause, they were never independent — that is a "correlated-layer" smell.

**Saltzer & Schroeder (1975) — the eight principles + two considerations (verbatim cores):**

| # | Principle | Definition (S&S 1975) |
|---|-----------|------------------------|
| 1 | Economy of mechanism | "Keep the design as simple and small as possible." |
| 2 | Fail-safe defaults | "Base access decisions on permission rather than exclusion." |
| 3 | Complete mediation | "Every access to every object must be checked for authority." |
| 4 | Open design | "The design should not be secret." |
| 5 | Separation of privilege | two keys are more robust than one |
| 6 | Least privilege | "operate using the least set of privileges necessary to complete the job" |
| 7 | Least common mechanism | "Minimize the amount of mechanism common to more than one user" |
| 8 | Psychological acceptability | "the human interface … [designed] for ease of use" |
| + | Work factor | cost-to-attack vs the attacker's resources |
| + | Compromise recording | reliable recording can substitute for prevention |

**CVSS qualitative severity scale (v3.1 / v4.0, FIRST.org) — the anti-crying-wolf ruler:**

| Rating | Base score |
|--------|-----------|
| None | 0.0 |
| Low | 0.1 – 3.9 |
| Medium | 4.0 – 6.9 |
| High | 7.0 – 8.9 |
| Critical | 9.0 – 10.0 |

Qualitative ratings are explicitly *optional* in the spec, but when used they must be calibrated to the score — a `High` label on a Medium-scored finding is the crying-wolf failure mode.

**Top smells:**

- A single control framed as "the" security boundary ("we have a firewall", "the worktree sandboxes it") — one layer treated as sufficient.
- A default-*open* state on error (fail-open) where fail-closed was available.
- A log that an attacker who reaches the host can edit (no tamper-evidence) → repudiation.
- Every finding rated Critical → severity inflation → responders tune out (alert fatigue).
- "Least privilege later" — a component granted broad rights it never exercises.

## Intent

Real systems are not breached because one wall was thin — they are breached because one wall was treated as *the* wall. Defense in depth replaces the single-boundary mental model with an explicit, layered one: **assume every individual control will eventually fail, and arrange that no single failure loses the asset.** This doc gives the HETS security-engineer (and any persona reasoning about a security control) four calibrated instincts — layering, fail-safe defaults, tamper-evident auditing, and honest severity — each grounded in a primary source so the reasoning is checkable rather than vibes-based.

The discipline is also a *budget* discipline. Defense in depth without severity calibration produces alert fatigue (every layer screams Critical); severity calibration without layering produces a single accurately-rated wall that still falls in one move. The four instincts are load-bearing *together*: layers give you the catches, severity tells you which catch to staff, fail-safe defaults make a failed layer degrade safely, and auditability makes a breach *visible and attributable* after the fact.

## The Principle

> "Single points of complete compromise are eliminated or mitigated by the incorporation of a series or multiple layers of security safeguards … If one layer of defence turns out to be inadequate then … another layer of defence may prevent a full breach." — OWASP Developer Guide, *Security Principles* (Defense in Depth)

> "Fail-safe defaults: Base access decisions on permission rather than exclusion. … Least privilege: Every program and every user of the system should operate using the least set of privileges necessary to complete the job." — Saltzer & Schroeder, *The Protection of Information in Computer Systems* (1975)

> "Compromise recording: It is sometimes suggested that mechanisms that reliably record that a compromise of information has occurred can be used in place of more elaborate mechanisms that completely prevent loss." — Saltzer & Schroeder (1975)

Reformulated:

- **No single point of failure.** Size a control by what *else* catches the attacker if this one is bypassed. A layer with no backstop is a single point of failure regardless of how strong it looks.
- **Default to denied / safe.** The state a control takes when it errors, is misconfigured, or is bypassed should be the *closed* state (S&S fail-safe defaults; NIST SC-7 "deny … by default, allow … by exception").
- **Least privilege bounds the blast radius.** A compromised component can only touch what it was granted; narrow grants = small radius (links directly to `blast-radius-and-reversibility`).
- **Record tamper-evidently.** Prevention is never complete; an *attributable, tamper-resistant* record (NIST AU-9) is what turns an undetected breach into an investigable incident.
- **Rate honestly.** A severity scale (CVSS) exists so that "this is bad" is a calibrated claim, not an adrenaline response. Inflated severity is a denial-of-service on your own responders.

## Named instinct 1 — defense-in-depth (layered controls, no single point of failure)

The core move is **independence**: layers only add depth if they fail for *different* reasons. A WAF and an input-validation library that both rely on the same regex are one layer wearing two hats. NIST SP 800-160 Vol. 1 frames defense in depth as a structural design strategy across the *problem, solution, and trustworthiness contexts* — i.e. the layering is a property of the architecture, not a product you bolt on.

Practical layering for an application (OWASP Secure Product Design): network/boundary isolation → authentication → authorization → input validation → integrity/crypto → audit + monitoring. The discipline question for any control is not "is this strong?" but **"when this fails, what is the next thing the attacker hits?"** If the honest answer is "the asset," you have one layer, not depth.

Defense in depth composes with blast-radius containment (`blast-radius-and-reversibility`): cells, bulkheads, and least-privilege grants are *blast-radius* controls that double as depth — a breached component contained to one cell has another structural layer between it and the rest.

## Named instinct 2 — secure-by-default (fail-safe defaults + least privilege)

Two Saltzer & Schroeder principles fuse into one instinct:

- **Fail-safe defaults** — "base access decisions on permission rather than exclusion." The *absence* of an explicit grant means *no access*. NIST SC-7 states the operational form for boundaries: "deny network communications traffic by default and allow … by exception." Concretely: deny-by-default firewall rules, allowlists over blocklists, and an error path that lands *closed* (a failed auth check denies; a thrown validator rejects).
- **Least privilege** — "operate using the least set of privileges necessary." NIST CM-7 (least functionality) is the control form. A component gets exactly the capabilities it exercises and no more; this is what bounds the damage when (not if) it is compromised.

The anti-pattern is **fail-open**: a control that, on error/timeout/misconfig, defaults to *allowing* the action. Fail-open is occasionally a deliberate availability trade (an auth service outage that would otherwise lock everyone out), but it must be a *named, acknowledged* decision — never the accidental default. Pair with `error-handling-discipline`: fail-closed at the boundary is the secure-by-default reflex.

## Named instinct 3 — auditability (tamper-evident logging, traceability)

Saltzer & Schroeder's *compromise recording* says recording can *substitute* for some prevention — but only if the record is trustworthy. NIST SP 800-53 **AU-9 (Protection of Audit Information)** is the control that makes it trustworthy: "protects logs against tampering and unauthorized access." Two requirements follow:

1. **Tamper-evidence** — an attacker who reaches the host must not be able to silently rewrite history. Techniques: append-only stores, hash-chaining / content-addressing (each record's identity derived from its own bytes, so a forged record is detectable), write-once media, or shipping logs off-host to an isolated collector. Without this, the audit trail enables **repudiation** (STRIDE-R, see `threat-modeling-essentials`).
2. **Traceability / attribution** — the record must answer *who did what, when, and to what*. An event with no actor identity is monitoring theater.

Auditability is also a *defense-in-depth* layer in its own right: when prevention layers all fail, the tamper-evident log is the layer that turns an invisible breach into an attributable, investigable one. Detection without a protected record is the "no incident response plan" pitfall — detection theater.

## Named instinct 4 — realistic-severity (calibrated severity, not crying wolf)

CVSS (FIRST.org) exists so severity is a *defensible number*, not an adrenaline response. The v3.1 qualitative scale maps a Base score (0.0–10.0) to **None / Low / Medium / High / Critical**; CVSS v4.0 keeps a Base metric group and adds Threat, Environmental, and Supplemental groups so the *environmental* reality (is the vulnerable path even reachable here?) adjusts the raw Base score.

The discipline has two failure directions:

- **Crying wolf (over-rating)** — labeling every finding Critical. The cost is real: responders learn that "Critical" means "maybe," and the *next* genuinely-Critical finding gets the same tuned-out response. Inflated severity is a self-inflicted denial-of-service on the response budget.
- **Under-rating** — burying a reachable, high-impact issue at Low because it "feels minor." The CVSS Environmental group is the corrective: a Base-Medium finding on an internet-reachable, unauthenticated path may be Environmentally High *here*.

The instinct: **state the severity, state the CVSS-style rationale (vector or at least attack-vector / privileges / impact), and let the calibrated band — not the discoverer's excitement — set the priority.** Calibrated severity is what lets the *realistic-severity* and *defense-in-depth* instincts cooperate: it tells you which un-caught layer-failure actually deserves the staffing.

## Substrate-Specific Examples

### The kernel layers controls — no single trusted boundary

The Power Loom kernel is itself a defense-in-depth artifact, and deliberately treats *no single layer* as the security boundary:

- **Worktree isolation** is the first layer (the spawn runs in an `isolation:worktree`), but it is explicitly documented as **not a security sandbox** — absolute-path writes escape it (the Wave-1 `p-writescope` finding). It is treated as *one* layer, not *the* layer.
- **Static capability masks** are the next layer: a sub-agent's tools come from its agent.md `tools:` frontmatter, enforced at build time. ADR-0012 records the hard-won lesson that the *runtime* injection layer was inert (`updatedInput` is inert on Agent/Task spawns) — so enforcement was moved to a layer that actually holds (static frontmatter + the build-time validator) rather than trusting a single runtime control.
- **The agent.md↔contract reconciliation validator** is the build-time gate that catches a capability declared in one place but not the other — defense in depth applied to the capability declaration itself.

The instinct in action: when the runtime mask turned out to be a non-existent boundary, the design did not collapse, because it was never the *only* boundary.

### Secure-by-default: fail-closed hashing + deny-on-uncomputable

The kernel's provenance hashing is fail-*closed* by construction (the secure-by-default instinct). `canonicalJsonSerialize` is depth-bounded (`MAX_CANONICAL_DEPTH = 100`) with a controlled throw; the hashing entry points catch and return null / `record-uncomputable` rather than crashing or silently emitting a bad hash. A field deep enough to overflow the stack yields a *refused* record, not a forged-or-crashed one — the default on the error path is the safe state. This closed a crash-suppression DoS where a deep field could otherwise have suppressed a provenance record.

### Auditability: tamper-evident, content-addressed provenance records

The INV-22 provenance layer is tamper-evident by content-addressing — the canonical *auditability* instinct. A record's `idempotency_key` / `content_hash` is **re-derived from the record body** (`deriveIdempotencyKey`); a forged incoming key is rejected (`idempotency-key-mismatch`) and a forged *stored* key is skipped on read. The store is explicitly *not* a sandbox, so the design assumes an attacker can write to it and makes forgery *detectable* rather than *impossible* — exactly Saltzer & Schroeder's "reliably record" standard, plus NIST AU-9 tamper-resistance. Each record carries actor identity (`writer_spawn_id`) for traceability.

### Realistic-severity: the verify-plan three-lens tier rates, it does not panic

The substrate's review discipline (`/verify-plan`, the 3-lens parallel tier) produces *calibrated* findings — FAIL / FLAG with severity, not a flat wall of CRITICAL. The H.7.22–H.7.24 record (4 HIGH/CRITICAL caught, then a mix of 1 FAIL + 7 FLAGs) is the realistic-severity instinct working: the band is set by the finding's actual blast radius, which is what lets the team triage the one FAIL ahead of the seven FLAGs instead of treating all eight as fire.

## Tensions with Other Principles

### Defense in depth vs simplicity (economy of mechanism)

More layers = more mechanism, and Saltzer & Schroeder's *first* principle is economy of mechanism ("keep the design as simple and small as possible"). **Resolution**: depth must be *independent* layers that each earn their keep, not redundant complexity. Two correlated layers add attack surface without adding depth — that is the worst of both. The bar is the blast radius (`trade-off-articulation`): add a layer only where a single-layer failure would otherwise be terminal.

### Secure-by-default (fail-closed) vs availability

Fail-closed denies on error; sometimes that denial *is* the outage (an auth dependency that fails closed can lock out every user). **Resolution**: the fail direction is itself a `blast-radius-and-reversibility` decision — fail-closed for confidentiality/integrity-critical paths; a *named, acknowledged* fail-open only where availability strictly dominates and a compensating layer (rate-limit, degraded read-only mode) bounds the exposure.

### Auditability vs least-data / privacy

Tamper-evident, attributable logging pulls toward recording *more* (who, what, when, the payload); privacy and data-minimization pull toward recording *less*. **Resolution**: log the *attribution and the action*, not the sensitive *content* — hash or reference payloads rather than copying PII into the audit trail (this also keeps the log from becoming a second copy of the data to protect).

### Realistic-severity vs caution

Calibrating down a scary-sounding finding can feel like under-caution. **Resolution**: realistic severity is *not* "rate everything low"; it is "rate everything *accurately*." The CVSS Environmental group exists precisely to raise a Base-Medium to a contextual-High when warranted. Honest calibration in *both* directions is the discipline.

## When to use this principle

- **Any security control review** — ask of each control: what is the *next* layer if this fails, and does it fail *closed*?
- **Designing a new boundary** (auth, validation, a capability mask, an egress rule) — default to deny; grant least privilege; never let it be the *only* boundary.
- **Any logging / provenance / audit design** — make the record tamper-evident and attributable before calling it an audit trail.
- **Triaging or reporting findings** — attach a calibrated (CVSS-style) severity with rationale, not an adjective.
- **Threat-modeling** (`threat-modeling-essentials`) — defense in depth is the structural answer to STRIDE; each STRIDE category maps to a layer.

## When NOT to use this principle (or apply with caveat)

- **Trivial / non-security surfaces** — a read-only doc renderer with no secrets does not need six layers; economy of mechanism wins. Don't perform defense-in-depth theater on a zero-stakes surface.
- **When "layers" are correlated** — adding a second control that shares the first's failure mode is *not* depth; it is complexity that looks like safety. Don't count it.
- **Hard availability-first paths** — there are systems where a fail-open default is the correct, deliberate trade (life-safety overrides, break-glass access). Apply secure-by-default with an explicit, acknowledged exception, not as an absolute.
- **Severity on genuinely-unreachable issues** — a Base-High finding on a code path that is provably unreachable in this deployment is Environmentally Low; don't inflate it to satisfy a checklist.

## Failure modes when applied incorrectly

- **Single-layer reliance ("we have a firewall" / "the worktree sandboxes it")** — the canonical defense-in-depth failure; one control framed as sufficient. Counter: name the backstop layer for every control; if there isn't one, you have a single point of failure.
- **Fail-open by accident** — a control that defaults to *allow* on error because no one chose the fail direction. Counter: make fail-closed the default; require an explicit, reviewed decision to fail open (`error-handling-discipline`).
- **Unprotected audit log** — logging that an on-host attacker can edit → repudiation; the "record" is worthless. Counter: tamper-evidence (append-only / hash-chain / off-host) per NIST AU-9.
- **Detection without response** — alerts fire into a void; "no incident response plan" makes monitoring theater. Counter: pair every detection layer with a response path (`observability-basics`).
- **Severity inflation (crying wolf)** — everything Critical → responders tune out → the real Critical is missed. Counter: calibrate to CVSS bands with a stated rationale; reserve Critical for Critical.
- **Authentication without authorization** — authenticated users can do anything; the boundary checks *who* but not *what*. Counter: complete mediation (S&S) — every access checked for authority, every time (`auth-patterns`).
- **Layering without least privilege** — many layers, but each component over-granted, so a single breach is still total. Counter: least privilege bounds the per-layer blast radius (`blast-radius-and-reversibility`).

## Tests / verification

- **The no-single-point gate**: for the asset under review, name two *independent* controls that must *both* fail to lose it. If you can only name one, or the two share a failure mode, depth is missing.
- **Fail-direction audit**: for each control, force the error path (timeout, malformed input, missing config) and confirm it lands *closed*. A control whose error path allows the action is fail-open — was that chosen?
- **Tamper-evidence check**: attempt to rewrite an audit record as a host-level actor; confirm the change is *detectable* (hash mismatch, chain break, off-host divergence). If a silent edit succeeds, AU-9 is unmet.
- **Attribution check**: pick a random audit event; confirm it answers who/what/when/to-what. A missing actor identity fails traceability.
- **Severity calibration review**: sample rated findings; recompute (or sanity-check) against CVSS bands. A cluster of Critical that don't survive a vector recompute is severity inflation; a Low on a reachable unauthenticated path is under-rating.
- **Least-privilege grant audit**: for a new component, list its granted capabilities and the ones it actually exercises; the difference is excess blast radius to remove (`threat-modeling-essentials`).

## Related Patterns

- [security-dev/threat-modeling-essentials](threat-modeling-essentials.md) — STRIDE enumerates the threats each defense layer answers; defense in depth is the structural response, and least privilege bounds each layer's radius.
- [security-dev/auth-patterns](auth-patterns.md) — authentication and authorization are two of the canonical layers; complete mediation (auth on *every* request) is the secure-by-default reflex for the authz layer.
- [architecture/discipline/blast-radius-and-reversibility](../architecture/discipline/blast-radius-and-reversibility.md) — least privilege and compartmentalization are blast-radius containment that double as depth; the fail-closed-vs-fail-open choice is a one-way/two-way-door decision.
- [architecture/discipline/error-handling-discipline](../architecture/discipline/error-handling-discipline.md) — fail-closed at the boundary is the secure-by-default instinct in error-handling form; the substrate's `record-uncomputable` deny-on-error is the worked example.
- [architecture/discipline/refusal-patterns](../architecture/discipline/refusal-patterns.md) — a refused/denied default is the safe-state behavior fail-safe-defaults prescribes.
- [infra-dev/observability-basics](../infra-dev/observability-basics.md) — the audit + monitoring layer; detection without a protected, responded-to signal is theater.

## Sources

Authored by multi-source synthesis of:

1. **Saltzer, J. H. & Schroeder, M. D., "The Protection of Information in Computer Systems"** (Proceedings of the IEEE, vol. 63, no. 9, 1975). The foundational source for *fail-safe defaults* ("base access decisions on permission rather than exclusion"), *least privilege* ("the least set of privileges necessary to complete the job"), *complete mediation*, *separation of privilege*, *economy of mechanism*, and *compromise recording* (recording as a partial substitute for prevention) — the basis for the secure-by-default and auditability instincts.
2. **OWASP Developer Guide — Security Principles**, and the **OWASP Cheat Sheet Series (Secure Product Design)**. The canonical modern statement of *Defense in Depth* ("single points of complete compromise are eliminated or mitigated by … multiple layers"), *Fail Safe / Security by Default* ("default to a secure state rather than an unsafe state"), *Least Privilege*, *Complete Mediation*, and *Compartmentalize*.
3. **NIST SP 800-53 Rev. 5 — Security and Privacy Controls for Information Systems and Organizations** (2020, update 2023). Control forms cited: **SC-7 Boundary Protection** ("deny … by default and allow … by exception" — the secure-by-default boundary), **CM-7 Least Functionality** (least privilege at the system-config layer), and **AU-9 Protection of Audit Information** (tamper-resistance — protect logs against tampering and unauthorized access; the auditability instinct).
4. **NIST SP 800-160 Vol. 1 — Engineering Trustworthy Secure Systems** (Rev. 1, 2022). Frames defense in depth as a *structural* design strategy spanning the problem, solution, and trustworthiness contexts — security engineered into the architecture, not bolted on.
5. **FIRST.org — Common Vulnerability Scoring System (CVSS) v3.1 Specification Document** (2019) and **CVSS v4.0** (2023). The qualitative severity scale (None 0.0 / Low 0.1–3.9 / Medium 4.0–6.9 / High 7.0–8.9 / Critical 9.0–10.0), the explicit note that qualitative ratings are *optional*, and the v4.0 Base / Threat / Environmental / Supplemental metric groups (the Environmental group as the contextual-reality corrector) — the realistic-severity instinct.

Each web source was verified to exist via WebSearch/WebFetch during authoring: the Saltzer & Schroeder 1975 paper (hosted at cs.virginia.edu and unsw; Wikipedia summary); the OWASP Developer Guide security-principles page and Secure Product Design cheat sheet; NIST SP 800-53 Rev. 5 (csrc.nist.gov) controls SC-7 / CM-7 / AU-9; NIST SP 800-160 Vol. 1 (csrc.nist.gov); and the FIRST.org CVSS v3.1 and v4.0 specification pages. Substrate examples are drawn from the Power Loom v3.1 kernel: layered worktree-isolation + static capability masks + the agent.md↔contract reconciliation validator (ADR-0012), fail-closed depth-bounded hashing (`record-uncomputable`), content-addressed tamper-evident provenance (INV-22 `idempotency_key` re-derivation), and the calibrated `/verify-plan` 3-lens severity tier.

## Phase

Authored: kb authoring batch (v3.1-era, post-Phase-2 / Runtime Foundation), single-lens KB-gap fill. Multi-source synthesis from 5 verifiable source families spanning the foundational literature (Saltzer & Schroeder 1975), modern practitioner guidance (OWASP), the controls catalog and systems-security-engineering standards (NIST SP 800-53 Rev. 5 + SP 800-160 Vol. 1), and the severity-calibration standard (FIRST.org CVSS v3.1 / v4.0). Serves the HETS security-engineer (defense-in-depth, secure-by-default, auditability, realistic-severity), hacker (layer-independence probing, severity honesty), and architect (defense-in-depth-as-structure, fail-closed defaults) lenses. Pairs with `threat-modeling-essentials` (the threats) and `auth-patterns` (two of the layers); the realistic-severity instinct is the budget-discipline counterweight that keeps layered defense from degrading into alert fatigue.
