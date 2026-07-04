# Decision records (ADRs)

Why Power Loom chose X over Y, per wave. Immutable once accepted — a new ADR supersedes an old one; never
rewrite an accepted record. An ADR is the **Decisions** layer of the project-docs convention (the
[phases hub](../phases/README.md) is the Implementation layer): the [PRD](../PRD.md) says *what + why + order*,
a phase doc says the *steps*, and an ADR records the *decisions* made while doing them.

> **Bridge (overlay adoption).** Power Loom's decision history already lives in three existing places, which
> this directory does **not** migrate:
>
> - **[`packages/specs/adrs/`](../../packages/specs/adrs/)** — the canonical ADR store (0001–0015+). This is the
>   toolkit's accepted-decision ledger; e.g. ADR-0005 (slopfiles authoring discipline), ADR-0012 (a PreToolUse
>   hook's `updatedInput` is inert on Agent/Task spawns — capability enforcement is static), ADR-0015
>   (`failure_signature` frozen).
> - **[`packages/specs/rfcs/`](../../packages/specs/rfcs/)** — the design-arc RFCs, including the
>   [north star](../../packages/specs/rfcs/2026-06-11-north-star-autonomous-sde-trust.md) (the terse canon of
>   decided/rejected directions) and the enforcing-vs-advisory ceiling.
> - **[`packages/specs/research/`](../../packages/specs/research/)** — the deeper research verdicts that grounded
>   those decisions (e.g. the autonomous-SDE lifecycle gap-map, the tiered-memory-demotion design).
>
> Going forward, a **new** standalone decision uses [`ADR.template.md`](ADR.template.md), numbered
> `NNNN-<slug>.md`, and lands in [`packages/specs/adrs/`](../../packages/specs/adrs/) (the canonical store) —
> this hub indexes it. Cross-link. The north star remains the terse canon of decided/rejected directions; an ADR
> that changes a decided direction must also amend the north star with a dated rationale.

## Index (go-forward, this convention)

| ADR | Title | Status | Supersedes |
|---|---|---|---|
| *(first go-forward ADR lands in `packages/specs/adrs/` and is indexed here)* | — | — | — |

**Existing decision records (bridged, not migrated):** [`packages/specs/adrs/`](../../packages/specs/adrs/) —
0001–0015+ (ADR-0005 slopfiles discipline, ADR-0012 static-capability enforcement, ADR-0015 frozen
`failure_signature`, …). Plus the [north star](../../packages/specs/rfcs/2026-06-11-north-star-autonomous-sde-trust.md)
§ decided/rejected directions and the research verdicts under [`packages/specs/research/`](../../packages/specs/research/).

## When to write one

- A meaningful, non-obvious decision or design fork resolved during a phase — record it at the phase's close.
- A decision that changes a *direction the north star decided* — write the ADR **and** amend the north star with
  a dated rationale; never let the build quietly diverge from the anchor.
- Skip for a mechanical or obvious choice — an ADR is for the decisions a future reader would otherwise
  re-litigate. (Per ADR-0005, keep the record terse and predicate-scoped; don't bloat always-on context.)
