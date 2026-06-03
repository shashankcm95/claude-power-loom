---
adr_id: 0015
title: "Freeze the failure_signature schema (negative-attestation witness)"
tier: technical
status: accepted
created: 2026-06-03
author: 04-architect (v3.2 Wave 1→2 boundary design session) + USER (boundary ratification)
superseded_by: null
files_affected:
  - packages/specs/plans/2026-06-02-v3.2-runtime-decomposition-scope.md
  - packages/specs/rfcs/v3.3-substrate-synthesis-v3.md
invariants_introduced:
  - "INV-FS-StructuralDiagnosticFirewall — v3.3 E2 (derived-policy extraction) reads ONLY the closed-enum structural fields (failed_criterion_id, discipline, verifier_kind, detection_phase); it MUST NOT parse the diagnostic free-form fields (expected, observed, human_message). This keeps E2 a pure deterministic function (no NLP in the policy path)."
  - "INV-FS-AppendOnlyEnums — the four structural enum value-sets may only GROW append-only; an older E2 reader tolerates an unknown enum member by ignoring that record (schema-additive, mirroring abort_detail's forward-compat posture)."
  - "INV-FS-CriterionEnumMirrorsR9 — failed_criterion_id's enum MUST stay in sync with R9's normative leaf-criteria set (the v3.2 scope's Boundary Decisions table); a criterion added to R9 is added here."
related_adrs:
  - 0011
  - 0012
related_kb:
  - architecture/crosscut/deep-modules
  - architecture/discipline/trade-off-articulation
  - architecture/discipline/evidence-and-premise-discipline
---

## Context

The v3.2 scope (`2026-06-02-v3.2-runtime-decomposition-scope.md`) named a **`failure_signature`
schema freeze** as a Wave -1 gate — *"the only FORWARD contract; lock it with a concrete 6-8 field
sketch so v3.3 E2 can consume it."* It was never produced; the v3.2 Wave 1→2 boundary design session
(2026-06-03) closes it.

Forces:

- **R11** (the spawn-verify dispatcher, v3.2 Wave 2) is the **producer**: when a decomposition leaf
  FAILS verification it must emit a structured witness, not prose.
- **v3.3 E2** (the Class-1 derived-policy extraction function, `v3.3-substrate-synthesis-v3.md:252`)
  is the **consumer**: it "reads only STRUCTURAL fields from failure_signature + spawn axioms" and is a
  pure deterministic function (NO LLM call). It needs a stable, machine-switchable shape NOW so its
  extraction logic can be written against a frozen contract rather than a moving target.
- The schema must be **forward-frozen at the v3.2 boundary** because the producer ships in v3.2 but the
  consumer ships in v3.3 — they cannot co-evolve; the contract has to be locked before R11 emits.

Why now: the producer (R11) is about to be built (Wave 2). A forward contract consumed a phase later
must be frozen before the producer hard-codes a shape.

**The scope's "ADR-0011" pointer was a collision** — the real ADR-0011 is *"K9↔K14 sequencing, Phase
1-alpha spec deltas"* (`0011-k9-k14-sequencing-and-phase-1-alpha-spec-deltas.md`). The
`failure_signature` freeze is this new **ADR-0015**.

## Decision

Freeze `failure_signature` as an **8-field block**, modeled on the existing `abort_detail` block
(`packages/kernel/schema/transaction-record.schema.json:135-160`) and split by a **structural /
diagnostic firewall**: E2 reads the structural closed-enum fields deterministically and MUST NOT parse
the diagnostic free-form fields.

| field | type | required | structural / diagnostic | purpose |
|---|---|---|---|---|
| `failed_criterion_id` | enum (`cost-justified` \| `semantically-cohesive` \| `interface-clean` \| `validation-supported` \| `resource-bounded` \| `discipline-gate`) | yes | **STRUCTURAL** | Which R9 criterion (or the R8 discipline gate) rejected the leaf. E2's primary clustering key; closed enum so E2 switches without parsing prose. |
| `discipline` | enum (`tdd` \| `spec-driven` \| `exploratory`) | yes | **STRUCTURAL** | The leaf's declared decomposition discipline (R8 vocabulary) that routed the verifier. E2 derives discipline-scoped policies. NB: R8 froze `{spec-driven, tdd}` (Option A, PR #214) — `exploratory` is a reserved member, not yet used. |
| `verifier_kind` | enum (`schema` \| `test-run` \| `structural` \| `registry-lookup` \| `predicate`) | yes | **STRUCTURAL** | The KIND of gate that ran. Lets E2 distinguish a hard-gate failure from an advisory-predicate failure. **`test-run` + `registry-lookup` CONFIRMED live by R12 (v3.2 Wave 2); full member-set lock deferred to R11, the producer** (see Open questions). |
| `detection_phase` | enum (`pre-spawn-leaf-check` \| `post-spawn-verify` \| `budget-abort`) | yes | **STRUCTURAL** | Where in R11's lifecycle the failure surfaced (mirrors `abort_detail.detection_phase`). Separates "rejected as a bad leaf before running" from "ran and failed its gate." |
| `leaf_ref` | string \| null | no | structural (weak) | Stable id of the failing leaf (R7 checkpoint id / folder-path sha). Reserved for v3.4 attribution-graph edges; E2 does NOT branch policy on it. |
| `expected` | string \| null | no | diagnostic | The threshold/shape the gate wanted (e.g. `"estimated_tokens >= 500"`). E2 IGNORES (free-form); for the human. |
| `observed` | string \| null | no | diagnostic | What was actually seen (e.g. `"estimated_tokens = 120"`). E2 IGNORES. |
| `human_message` | string (minLength 1) | yes | diagnostic | Required prose explanation (mirrors `abort_detail.human_message`, the persona-Maya M3 debuggability rationale). E2 IGNORES entirely. |

**E2-consumption contract:** E2 reads deterministically and ONLY the four closed-enum structural fields
(`failed_criterion_id`, `discipline`, `verifier_kind`, `detection_phase`; `leaf_ref` reserved for v3.4).
The three free-form fields are diagnostic and E2 MUST NOT parse them — this firewall is what keeps E2 a
pure deterministic extraction function rather than smuggling NLP into the policy path.

## Consequences

**Positive:**

- R11 (v3.2) emits against a frozen shape; v3.3 E2 is written against a locked contract — no co-evolution
  hazard across the phase boundary.
- The structural/diagnostic firewall keeps E2 deterministic by construction (INV-FS-StructuralDiagnosticFirewall).
- Append-only enums (INV-FS-AppendOnlyEnums) make the contract forward-safe: a v3.2 R11 emitting a member
  a v3.3 E2 doesn't recognize is tolerated (the record is ignored, not a hard error) — exactly the
  `abort_detail` "schema-additive; older readers tolerate it" posture.

**Negative:**

- `failed_criterion_id` is coupled to R9's criteria set (INV-FS-CriterionEnumMirrorsR9) — a drift between
  them is a latent bug. Mitigation: R9's normative criteria live in the v3.2 scope's Boundary Decisions
  table, and this enum mirrors it 1:1 (+ `discipline-gate`).
- One enum (`verifier_kind`) references R12 adapter kinds that don't exist yet — a partial forward-freeze
  (see Open questions).

**Open questions:**

- **`verifier_kind` value-set — PARTIALLY RESOLVED (v3.2 Wave 2, R12).** R12 (the test-runner adapter
  library) landed and **CONFIRMS the `test-run` + `registry-lookup` members are live and adequate**: the
  `node-runner` adapter surfaces `test-run` (it runs a leaf's tests), and the registry's
  `isVerificationSupported` surfaces `registry-lookup` (R9 #4's availability check). **The full member-set
  LOCK is deferred to R11** — R11 is the ADR-0015 *producer* (it emits the signature) and is the only
  component positioned to confirm the set is complete across ALL gate-kinds (`schema`/`structural`/
  `predicate` are R9/R11 gate-kinds R12 does not surface). Locking the whole set at R12 would assert a
  completeness only the producer can verify (a false-precision "locked" label — `drift:plan-honesty`
  class). The enum MECHANISM stays frozen (append-only, tolerate-unknown), so deferring the lock one
  component costs nothing. **Lock the concrete member-set at R11.**
- **Criterion #2 (`semantically-cohesive`) is advisory, not a hard gate** (v3.2 scope Boundary Decisions,
  open item). If it stays a soft signal, a `failed_criterion_id: semantically-cohesive` record means
  "advisory miss," not "hard reject" — E2 should weight it accordingly. Resolve when R9 builds.
- Should `failure_signature` be a standalone record in the transaction store, or a sub-block of an
  R11-emitted verification record? Decide at R11 build (Wave 2); the field shape is independent of that
  envelope choice.

## Alternatives Considered

### Alternative A: free-form / prose failure reason

A single `reason: string`. Rejected: it forces v3.3 E2 to parse natural language → E2 is no longer a
deterministic function (the explicit "NO LLM call" requirement, `v6:1498`), defeating the whole
negative-attestation → derived-policy pipeline.

### Alternative B: reuse `abort_detail` verbatim

`abort_detail` is for K9/K14 *transaction* aborts (chain-walk / evidence-link failures); its
`detection_phase` enum (`schema-validate | evidence-link | bootstrap-sentinel | chain-walk`) has no member
for a leaf-verification failure. Reusing it would force a dishonest enum value (the same problem the Wave 1
trampoline hit with the ABORTED record). `failure_signature` is the verification-surface analogue with its
own honest enums; it borrows `abort_detail`'s STRUCTURE (and the `human_message`/`detection_phase` idea),
not its values.

### Alternative C: do nothing (defer to v3.3)

Rejected: R11 (the producer) ships in v3.2. If the shape isn't frozen before R11 emits, R11 hard-codes an
ad-hoc shape that v3.3 E2 must then reverse-engineer — the exact moving-target hazard the scope called out
by naming this "the only forward contract."

## Status notes

- 2026-06-03 — proposed + accepted at the v3.2 Wave 1→2 boundary design session (architect-designed,
  USER-requested session). Frozen as the forward contract for R11 (v3.2 Wave 2 producer) → v3.3 E2 consumer.

## Related work

- v3.2 scope `2026-06-02-v3.2-runtime-decomposition-scope.md` — the Wave -1 gate that required this; the
  Boundary Decisions section records the OQ-11 ratification + R9 normative criteria this enum mirrors.
- `v3.3-substrate-synthesis-v3.md` E1 (the witness block) + E2 (the deterministic consumer).
- `transaction-record.schema.json:135-160` (`abort_detail`) — the structural model.
- Corrects the v3.2 scope's dangling "ADR-0011" reference (a collision; 0011 is K9↔K14 sequencing).
