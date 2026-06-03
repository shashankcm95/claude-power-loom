---
kb_id: architecture/crosscut/integration-boundary-contracts
version: 1
tags:
  - crosscut
  - architecture
  - integration
  - contracts
  - ddd
  - coupling
  - foundational
sources_consulted:
  - "Eric Evans, Domain-Driven Design: Tackling Complexity in the Heart of Software (2003) — Anti-Corruption Layer, Published Language, Open Host Service, Context Map (Part IV, Strategic Design)"
  - "Sam Newman, Building Microservices 2nd ed (2021) — bounded contexts as service seams; explicit schemas; consumer-driven contracts (ch 5 + ch 9 Testing)"
  - "Ian Robinson, Consumer-Driven Contracts: A Service Evolution Pattern (martinfowler.com, 2006-06-12) — provider / consumer / consumer-driven contracts; hidden coupling"
  - "Martin Fowler, IntegrationContractTest (martinfowler.com, 2011-01-12, rev 2018) — test doubles vs real service; share contract tests with the provider"
  - "Martin Fowler, TolerantReader (martinfowler.com, 2011-05-09) — Postel's Law at the integration boundary; read only what you need"
  - "Pact — consumer-driven contract testing tool/docs (pact.io) — consumer defines expectations, provider verifies"
related:
  - architecture/crosscut/single-responsibility
  - architecture/crosscut/dependency-rule
  - architecture/crosscut/acyclic-dependencies
  - architecture/crosscut/information-hiding
  - architecture/crosscut/deep-modules
status: active
---

## Summary

**Principle**: Every place where module/service A talks to B is an **integration boundary**, and that boundary *is* a contract — explicit or accidental. Name it, make it explicit, and own it deliberately.
**The instinct (cross-cutting-integration-shape)**: when the SAME A→B boundary shape recurs across feature areas, that repeated shape is a missing abstraction — one named contract, not N bespoke integrations.
**Sources**: Evans (DDD 2003 — Anti-Corruption Layer, Published Language, Context Map) + Newman (Building Microservices 2021) + Robinson (Consumer-Driven Contracts, 2006) + Fowler (IntegrationContractTest 2011, TolerantReader 2011) + Pact.
**Test**: grep for the same translation/mapping/adapter logic across features; if A↔B mapping is duplicated 3+ times, you have N copies of one contract begging to be a Published Language behind one Anti-Corruption Layer.
**Substrate**: the kernel's record/transaction schema is a Published Language; `_lib/settings-reader.js` is an ACL over `settings.json`; INV-22's content-address is a verified contract across producers.

## Quick Reference

**The boundary is always a contract.** When A depends on B, *something* is agreed: a shape, a protocol, a meaning. The only choice is whether the contract is **named and owned** or **implicit and accidental**. Implicit contracts are the ones that break silently.

**The named instinct — `cross-cutting-integration-shape`:** scan feature areas for the *same* A→B integration recurring. The repeated shape (the same DTO mapping, the same "translate vendor JSON into our model", the same retry+parse) is a **missing abstraction**. DRY applies *at the boundary*: extract one contract + one translation layer instead of paying for N bespoke integrations.

**DDD strategic patterns (Evans 2003, Part IV) — the vocabulary for boundaries:**

| Pattern | What it is | Use when |
|---------|-----------|----------|
| **Bounded Context** | an explicit boundary within which one model + ubiquitous language applies | the same word means different things in different areas |
| **Context Map** | the documented set of contexts + the relationships between them | you need to *see* every A↔B boundary at once |
| **Published Language** | a shared, well-documented interchange model both sides agree on | many consumers integrate with one producer |
| **Open Host Service** | a provider exposes a defined protocol for all comers | one upstream, many downstream |
| **Anti-Corruption Layer (ACL)** | a translation layer isolating your model from theirs | integrating a legacy/foreign/vendor model you don't control |

**Contract testing (the verification half):**

- **Consumer-Driven Contracts** (Robinson, 2006): consumers state expectations; the provider's contract is *derived from* those expectations. Splits a provider's contract into a **provider contract** (closed, authoritative) vs **consumer contracts** (open, partial) vs the **consumer-driven contract** (the union the provider commits to). Attacks **hidden coupling** — consumers bound to an *entire* schema break on any change.
- **IntegrationContractTest** (Fowler, 2011): a test that checks your **test double** still matches the real service. Share it with the provider's build so a breaking change is caught upstream, early.
- **Pact** (pact.io): the canonical CDC tool — consumer records expectations into a pact file; provider verifies against it in CI.
- **Tolerant Reader** (Fowler, 2011 — Postel's Law): read only the fields you need, ignore the rest; lets the provider add fields without breaking you. The robustness *complement* to a strict contract.

**API/IDL contracts as the machine-readable artifact:** OpenAPI / Protobuf / GraphQL SDL / Avro schemas — the contract written down so it can be diffed, versioned, and validated. The schema *is* the Published Language made executable.

**Top smells:**

- The **same vendor/legacy mapping** copy-pasted across 3+ features (missing ACL + Published Language).
- A consumer that deserializes the provider's *entire* payload into a strict typed object (hidden coupling — should be a Tolerant Reader over a narrow consumer contract).
- N bespoke point-to-point integrations between the same two areas, each subtly different.
- A boundary with **no test** that fails when the other side changes (an implicit, unverified contract).
- A domain model that imports the vendor's field names directly (corruption leaking across the boundary).

## Intent

Integration is where systems rot. Inside one module you control both sides of every call; across a boundary — to another service, a vendor API, a legacy system, or even a sibling bounded context — the two sides change for *different reasons, on different schedules, owned by different people*. The boundary is the seam, and seams are where change amplification and silent breakage concentrate.

The core failure this principle targets is the **accidental, implicit, duplicated contract**: feature 1 integrates with the billing vendor by hand, feature 2 does it again slightly differently, feature 3 a third way. No one wrote down what "the billing contract" *is*, so there are now three of them, each coupling the domain model to the vendor's payload shape, each breaking independently when the vendor ships a change. The same A→B shape recurred across feature areas and nobody named it — that is the `cross-cutting-integration-shape` smell.

The principle makes the boundary a **first-class, named, single artifact**: one Published Language for what crosses, one Anti-Corruption Layer translating foreign models into yours, and one verified contract (consumer-driven, tested) so a change on either side is *caught*, not discovered in production. The instinct is to recognize the repeated integration shape and collapse N bespoke integrations into one owned contract.

## The Principle

> "A team can make sense of another team's *Bounded Context* by means of a *Context Map*... The translation layer can be much more complex... Create an isolating layer to provide clients with functionality in terms of their own domain model. The layer talks to the other system through its existing interface... This *Anticorruption Layer* translates in both directions." — Eric Evans, *Domain-Driven Design* (2003), Part IV, Strategic Design

And on the interchange model both sides share:

> "Use a well-documented shared language that can express the necessary domain information as a common medium of communication, translating as necessary into and out of that language. *Published Language*..." — Evans (2003)

And on who *owns* the contract's shape:

> "A Consumer-Driven Contract represents a service provider's obligations to its clients... derived from and dependent on the expectations of consumers." — Ian Robinson, *Consumer-Driven Contracts: A Service Evolution Pattern* (martinfowler.com, 2006)

Reformulated:

- **The boundary is a contract whether you name it or not.** Choosing not to name it doesn't remove the contract — it removes your *control* over it.
- **Translate at the edge; never let foreign models leak in.** An Anti-Corruption Layer keeps your domain model clean of the vendor's/legacy's shape (`information-hiding` at the integration boundary).
- **One producer, many consumers → Published Language.** Don't let every consumer reverse-engineer the producer; publish the shape once.
- **Derive the contract from consumer need, and verify it.** Consumer-Driven Contracts + contract tests turn the implicit agreement into an executable, breakage-detecting artifact.
- **A repeated integration shape is a missing abstraction.** DRY at the boundary: N bespoke integrations of the same A↔B want to be one contract.

## Recognizing the cross-cutting integration shape

The codebase-pattern-finder instinct fires on *repetition across feature areas*, not within one file. Concretely:

1. **Grep for translation logic.** Search for where the foreign payload's field names appear (`vendor.customerId`, `legacyResp.acct_no`). If they appear in 3+ feature folders, the translation is duplicated — there is no single ACL.
2. **Look for parallel adapters.** `billingClientForCheckout`, `billingHelperInReports`, `chargeUtilInAdmin` — three names for one A→B boundary. Each is a partial, drifting copy of the same contract.
3. **Diff the shapes.** When the duplicates differ subtly (one handles a null field, another doesn't), you have N *inconsistent* contracts — the worst case, because the inconsistency is invisible until one path breaks.
4. **Find the un-tested seam.** A boundary with no test that fails when the other side changes is an implicit contract. Implicit + duplicated = the highest-risk shape.

The fix is the collapse: one Published Language (the agreed interchange shape), one Anti-Corruption Layer (the single translation point), one consumer-driven contract test (the single verification). The N bespoke integrations become N callers of one owned abstraction.

## The cost: N bespoke integrations vs one contract

Each unmanaged boundary copy carries a recurring tax:

- **Change amplification.** A vendor field rename forces edits in every duplicate. One ACL → one edit.
- **Inconsistent behavior.** Subtly different copies handle edge cases differently; bugs are per-integration, not systemic-and-fixable-once.
- **Hidden coupling** (Robinson, 2006). A consumer that binds to the provider's *entire* schema breaks on *any* provider change, even to fields it never reads. A narrow consumer contract + Tolerant Reader breaks only when *its* fields change.
- **No breakage signal.** Without a shared/contract test, the provider learns it broke a consumer in production. With an IntegrationContractTest in the provider's build (Fowler, 2011), it's caught in CI.

One named contract front-loads a fixed cost (write the Published Language, build the ACL, author the pact) to retire a recurring, compounding one. The trade is YAGNI-gated: pay it when the shape has *recurred*, not on the first integration (see Tensions).

## Substrate-Specific Examples

### The kernel's record/transaction schema is a Published Language

The Power Loom kernel's provenance records (`transaction_id`, `post_state_hash`, `idempotency_key`, `content_hash`, `head_anchor`) are a **Published Language** in Evans's sense: a single, documented interchange shape that *every* producer (`buildSpawnRecord`, `buildChainedRecord`) and every consumer (`appendRecord`, `readByPostStateHash`, `readByIdempotencyKey`) agrees on. The schema validator (`transaction-record.js`) is the contract made executable. When a *new* producer is added, it must emit the same shape via `computePostStateHash` / `computeContentHash` verbatim — i.e., it integrates through the published contract, it does not invent a parallel one. M1 forward-coupling ("every `post_state_hash` producer reuses `computePostStateHash`") is exactly the `cross-cutting-integration-shape` instinct codified as an invariant: the join shape recurs across producers, so it is one contract, not N.

### `_lib/settings-reader.js` is an Anti-Corruption Layer over `settings.json`

Hook scripts do not parse `~/.claude/settings.json` by hand at each call site. They depend on `readSettings` / `isPluginEnabled` — an **Anti-Corruption Layer** translating the external, harness-owned config format into narrow named accessors the kernel controls. The harness can re-shape `settings.json`; the blast radius is one translation module, not every hook (this is `information-hiding` + `dependency-rule` applied to a foreign boundary). Before the `_lib/` extraction (H.7.14), six callers each reverse-engineered the toolkit-root / config shape — the textbook N-bespoke-integrations smell; the extraction collapsed them to one contract.

### INV-22's content-address is a *verified* contract across producers

The idempotency key is not self-asserted — `deriveIdempotencyKey(record)` re-derives it from the record body and `appendRecord` rejects any incoming key that is self-inconsistent (`idempotency-key-mismatch`). This is a **consumer-driven, verified contract** in the Robinson sense applied internally: the store (consumer) does not *trust* the producer's claimed key; it validates the producer met the agreed derivation. A forged or drifted producer is caught at the boundary — the contract is executable and breakage-detecting, exactly as an IntegrationContractTest is for a service.

### Tolerant reading on the record-store read path

The chain edge is `post_state_hash`; the F-01 "tolerate-on-read" rule means duplicate records that share the hash yield an equivalent walk, and the integrator dedups by id rather than rejecting. This is **Tolerant Reader** (Fowler, 2011) at the kernel boundary: the reader accepts benign variation (a duplicate record) instead of binding rigidly to "exactly one record per hash" and failing closed on an avoidable mismatch.

## Tension with Other Principles

### Boundary contracts vs YAGNI / premature abstraction

Naming a contract and building an ACL is upfront cost; YAGNI says don't build what you don't need. **Resolution**: the trigger is *recurrence*, not anticipation. The first integration of A→B can be inline. When the *same* shape recurs (3rd copy, or a 2nd consumer of the same producer), the `cross-cutting-integration-shape` instinct fires and the abstraction has earned itself. Building a Published Language + ACL for a one-off, single-consumer boundary is the premature-abstraction failure mode in the other direction.

### Strict contract vs Tolerant Reader (robustness)

A strict, fully-validated schema (XSD-style, or a typed object binding the *whole* payload) maximizes early error detection but maximizes coupling — Robinson's **hidden coupling**: any provider change breaks the consumer. A Tolerant Reader minimizes coupling but reads fewer guarantees. **Resolution**: validate the fields *you use* strictly; ignore the rest tolerantly. Consumer-Driven Contracts formalize this — the consumer contract is the *subset* it depends on, not the provider's whole schema.

### One Published Language vs bounded-context autonomy

A single shared interchange model risks becoming a god-schema that couples every context to one shape — the inverse of bounded-context independence. **Resolution**: Published Language is for the *interchange*, not the internal models. Each context keeps its own model and translates in/out at its ACL; the Published Language is the narrow lingua franca between them, deliberately smaller than any side's full model. This is `single-responsibility` at the boundary: the contract's one reason to change is "what crosses A↔B changes", not "A's internals changed".

### Contract testing vs end-to-end testing

CDC tests (Newman 2021, ch 9) replace many slow, brittle end-to-end tests with fast, service-scoped contract checks. The tension: a contract test verifies the *agreement*, not the full integrated behavior. **Resolution**: contract tests catch *interface* breakage cheaply and early; a thin layer of end-to-end tests still covers genuine cross-system *behavior*. CDC reduces E2E count; it does not zero it.

## When to use this principle

- **Whenever code crosses a boundary you don't own both sides of** — a vendor API, a legacy system, another team's service, a sibling bounded context.
- **The moment the same A→B integration shape appears a 2nd/3rd time** across feature areas — fire the `cross-cutting-integration-shape` instinct and collapse to one contract.
- **When one producer gains a second consumer** — publish the language before each consumer reverse-engineers it.
- **When a foreign model's field names start appearing in your domain layer** — insert an Anti-Corruption Layer immediately; corruption compounds.
- **When designing a provider many teams will integrate with** — Open Host Service + Published Language + a published OpenAPI/IDL contract + CDC verification.

## When NOT to use this principle (or apply with caveat)

- **A genuine one-off, single-consumer boundary** — inline translation is fine; a Published Language + ACL is premature abstraction until the shape recurs.
- **Inside a single bounded context / module** where you own both sides and they change together — the "contract" is just a function signature; full contract machinery is overhead.
- **Throwaway / spike code** — the front-loaded cost of formal contracts pays back over time; disposable code may never reach payback.
- **When the two sides are genuinely one consistency unit** — if A and B *must* change atomically together, they're one module wearing a fake seam; don't ceremonialize an internal call as a cross-context contract (`single-responsibility` — the boundary isn't real).

## Failure modes when applied incorrectly

- **N bespoke integrations (the headline smell)** — the same A↔B mapping duplicated and drifting across features. Counter: grep for the repeated shape; collapse to one ACL + Published Language.
- **Hidden coupling** (Robinson) — binding a consumer to the provider's *entire* schema so any change breaks it. Counter: narrow consumer contract + Tolerant Reader; depend on the subset you use.
- **Corruption leak** — foreign field names / shapes seeping into the domain model because the ACL was skipped or made too thin. Counter: the ACL must translate *fully*; the domain side must speak only the domain language.
- **Unverified contract** — a "contract" documented but with no test that fails when either side breaks it. Counter: an IntegrationContractTest (Fowler) / pact (Pact) in the provider's CI; section presence ≠ verification.
- **God Published Language** — one shared schema that every context must conform to, recreating the coupling it was meant to remove. Counter: keep the interchange language narrower than any side's internal model; translate at each ACL.
- **Contract test that tests the mock, not the boundary** — a consumer test against a hand-written double that was never reconciled with the real provider. Counter: share the contract with the provider's build (the whole point of CDC/IntegrationContractTest).

## Tests / verification

- **Duplication grep**: search for the foreign payload's field names and for parallel adapter/client/helper names across feature folders. 3+ hits for the same A→B boundary = a missing single contract.
- **Coupling audit**: for each consumer, does it deserialize the provider's *whole* payload or just its needed subset? Whole payload = hidden-coupling risk; narrow it.
- **Corruption check**: grep the domain layer for vendor/legacy field names. Any hit = an ACL is missing or leaking.
- **Contract-test presence**: every owned cross-team/vendor boundary should have a test that *fails* when the other side's shape changes — and that test should be shared with (or run in) the provider's build (Fowler, IntegrationContractTest).
- **CDC verification**: where a Pact/CDC tool is used, confirm the provider verifies the consumer pact in CI, not just that the consumer recorded it.
- **Schema-as-source-of-truth**: confirm a machine-readable contract (OpenAPI / Protobuf / SDL / Avro) exists and is versioned for each Published Language, so changes are diffable.

## Related Patterns

- [architecture/crosscut/single-responsibility](single-responsibility.md) — a boundary contract has one reason to change ("what crosses A↔B"); the bounded context is domain-level SRP (one ubiquitous language per context).
- [architecture/crosscut/dependency-rule](dependency-rule.md) — an Anti-Corruption Layer enforces the dependency direction at the integration boundary; the domain depends on its own model, never the foreign one.
- [architecture/crosscut/acyclic-dependencies](acyclic-dependencies.md) — explicit contracts + context mapping keep cross-context dependencies directed and acyclic; a Context Map is the package-level dependency graph between contexts.
- [architecture/crosscut/information-hiding](information-hiding.md) — the ACL/Published Language *hides* the foreign model behind a narrow agreed interface; the contract is the information-hiding boundary made explicit.
- [architecture/crosscut/deep-modules](deep-modules.md) — a good contract is a deep module at the seam: a narrow, stable interface (the Published Language) over a powerful translation implementation (the ACL).

## Sources

Authored by multi-source synthesis of:

1. **Eric Evans, *Domain-Driven Design: Tackling Complexity in the Heart of Software*** (Addison-Wesley, 2003), Part IV (Strategic Design). The canonical source for **Bounded Context**, **Context Map**, **Anti-Corruption Layer**, **Published Language**, and **Open Host Service** — the vocabulary for what an integration boundary is and how to own it.
2. **Sam Newman, *Building Microservices*, 2nd ed** (O'Reilly, 2021). Bounded contexts as service seams; explicit schemas giving clarity to producers and consumers; consumer-driven contracts (ch 9, Testing) replacing many end-to-end tests with service-scoped contract checks.
3. **Ian Robinson, *Consumer-Driven Contracts: A Service Evolution Pattern*** (martinfowler.com, 2006-06-12). The provider-contract / consumer-contract / consumer-driven-contract taxonomy and the **hidden coupling** failure mode that rigid whole-schema validation creates.
4. **Martin Fowler, *IntegrationContractTest*** (martinfowler.com, 2011-01-12, rev 2018-01-01). A test that verifies a test double still matches the real service, shared with the provider's build so breaking changes are caught upstream.
5. **Martin Fowler, *TolerantReader*** (martinfowler.com, 2011-05-09). Postel's Law at the boundary — read only what you need, ignore the rest — the robustness complement that lets providers evolve without breaking consumers.
6. **Pact** (pact.io). The canonical consumer-driven contract testing tool: the consumer records expectations into a pact file; the provider verifies against it in CI.

Each web source was verified to exist via WebSearch/WebFetch during authoring (Evans 2003 DDD strategic-design patterns; Newman 2021 2nd-ed CDC/ch9 + bounded contexts; Robinson 2006 article with its contract taxonomy and the 2006-06-12 date; Fowler IntegrationContractTest 2011 + TolerantReader 2011 with dates; Pact CDC tooling). Substrate examples are drawn from the Power Loom v3.1 kernel: the record/transaction schema as a Published Language, `_lib/settings-reader.js` and the H.7.14 `_lib/` extraction as Anti-Corruption Layers, INV-22's re-derived content-address as a verified consumer-driven contract, and F-01 tolerate-on-read as Tolerant Reader.

## Phase

Authored: kb authoring batch (v3.1-era, single-lens KB-gap harvest). Multi-source synthesis from 6 verifiable sources spanning strategic DDD (Evans), microservice integration (Newman), service-evolution contract theory (Robinson), and contract/robustness patterns (Fowler, Pact). Serves the `codebase-pattern-finder` persona's **`cross-cutting-integration-shape`** named instinct: recognize the same A→B boundary recurring across feature areas as one missing abstraction (DRY at the boundary) rather than N bespoke integrations. Substrate examples emphasize the kernel's Published-Language record schema, ACL config-readers, and verified-contract idempotency key as the load-bearing "name the boundary, own the contract" exemplars.
