---
kb_id: backend-dev/type-safety-at-the-boundary
version: 1
tags:
  - backend
  - typescript
  - validation
  - concurrency
  - type-safety
  - boundary
  - foundational
sources_consulted:
  - "Alexis King, \"Parse, don't validate\" (lexi-lambda.github.io, 2019-11-05) — the canonical essay; parsing preserves the information a check learned, validation throws it away; \"push the burden of proof upward as far as possible\"; shotgun parsing; \"make illegal states unrepresentable\""
  - "Yaron Minsky, \"Effective ML\" / Jane Street OCaml talk (2010) — origin of \"make illegal states unrepresentable\"; popularized for typed FP by Scott Wlaschin, \"Designing with types: Making illegal states unrepresentable\" (F# for Fun and Profit)"
  - "Zod official docs (zod.dev) — \"TypeScript-first schema validation with static type inference\"; parse vs safeParse; z.infer schema-to-type"
  - "Valibot official docs (valibot.dev) — \"modular and type-safe schema library\"; tree-shakable, starts < 700 bytes, up to 95% smaller bundle than Zod"
  - "io-ts (github.com/gcanti/io-ts) — \"Runtime type system for IO decoding/encoding\"; Decoder/codec produces a typed value via an Either result on fp-ts"
  - "TypeScript handbook / tsconfig reference (typescriptlang.org) — strict (enables the strict family incl. strictNullChecks, noImplicitAny); strictNullChecks; noUncheckedIndexedAccess adds undefined to index-signature reads"
  - "Node.js official docs — \"The Node.js Event Loop\" / event-loop-timers-and-nexttick — single JS thread, phase order (timers → pending callbacks → idle/prepare → poll → check → close), run-to-completion semantics"
related:
  - architecture/crosscut/idempotency
  - architecture/discipline/error-handling-discipline
  - design-pushback/string-concat-sql
  - security-dev/threat-modeling-essentials
  - backend-dev/node-runtime-basics
  - backend-dev/express-essentials
status: active
---

## Summary

**Parse, don't validate (Alexis King, 2019)**: at every trust boundary, do not merely *check* that untrusted input is well-formed and then pass the same loose type onward — **parse** it into a precise typed value that *cannot* hold a bad state. A validator returns a boolean and throws away what it learned; a parser returns a narrower type and preserves it, so the rest of the program is **total** over its inputs (no input can reach code that wasn't written to handle it).
**Make illegal states unrepresentable (Yaron Minsky, 2010)**: choose data structures so invalid combinations cannot be constructed at all — push the check into the type, not into scattered runtime `if`s.
**Race-window awareness (Node.js event loop)**: Node runs JavaScript on a single thread with run-to-completion semantics, but any `await` is a yield point. Between the read and the write of a read-modify-write, other callbacks run — so "single-threaded" does **not** mean "no races." Guard shared-state mutations with atomic check-then-act, idempotency keys, or a lock/queue.
**Test**: at each boundary — (a) does untrusted input get parsed into a precise type once, at the edge, or is it re-checked ad hoc downstream? (b) can an illegal state be constructed at all? (c) for every `await` that straddles a read and a write of shared state, what stops two concurrent flows from interleaving?
**Sources**: King "Parse, don't validate"; Minsky/Wlaschin illegal-states; Zod / Valibot / io-ts official docs; TypeScript `strict` family; Node.js event-loop docs.
**Substrate**: the kernel boundary-validates `k14_ctx` before use; INV-22's `idempotency_key` is a content-address that de-dups replayed writes (atomic check-then-act on the record store); `canonicalJsonSerialize` is depth-bounded and the hashing entry points fail-closed on malformed input.

## Quick Reference

**Two named instincts this doc serves:**

| Instinct | One-line | The reflex |
|----------|----------|------------|
| **type-safety-at-the-edge** | parse untrusted input at the boundary into a precise typed value | "Where is the edge, and is the type *after* it narrower than the type *before* it?" |
| **race-window-awareness** | every `await` straddling a read-then-write of shared state is a race window | "What runs between this read and this write, and what stops two flows interleaving?" |

**Parse vs validate (the core distinction):**

| | Validate | Parse |
|---|----------|-------|
| Returns | a boolean / `void` (or throws) | a **narrower type** carrying the proof |
| Information | discarded — caller still holds the loose type | preserved — caller holds `Email`, `NonEmpty<T>`, `UserId` |
| Downstream | re-checks, defensive `if`s, "this can't be null here… right?" | total functions; the bad case is unrepresentable |
| Failure shape | "shotgun parsing" — checks smeared through the code | one funnel at the edge; inside is trusted |

**Schema parsers at the boundary (pick one; all produce a typed value from `unknown`):**

| Library | Official description | Note |
|---------|---------------------|------|
| Zod | "TypeScript-first schema validation with static type inference" | `parse` throws; `safeParse` returns `{ success, data \| error }`; `z.infer<typeof S>` derives the type |
| Valibot | "modular and type-safe schema library" | tree-shakable, starts < 700 bytes; up to ~95% smaller bundle than Zod |
| `io-ts` | "Runtime type system for IO decoding/encoding" | decode returns an `Either` (fp-ts); codec = decoder + encoder |

**TypeScript strictness (the compile-time half of the boundary):**

| Option | What it does (official) |
|--------|-------------------------|
| `strict` | enables the strict family: `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`, `strictPropertyInitialization`, … |
| `strictNullChecks` | `null` / `undefined` get distinct types; using them where a value is expected is a type error |
| `noUncheckedIndexedAccess` | adds `undefined` to every index-signature / array read — `arr[i]` is `T \| undefined`, forcing a presence check |

**Race windows in a single-threaded event loop (the runtime half):**

- Node runs JS on **one thread** with **run-to-completion** — a callback is never interrupted mid-statement.
- BUT every `await` / `.then` / `setTimeout` is a **yield point**: other queued callbacks run there. Read-modify-write across an `await` is **not** atomic.
- Guards: **atomic check-then-act** (let the datastore do compare-and-set / `INSERT … ON CONFLICT`), **idempotency keys** (a replay is a no-op), **a lock or a serialized queue** (one in-flight mutation per key).

**Top smells:**

- A handler typed `(req.body: any)` whose fields are checked with hand-rolled `if (!body.email)` deep in business logic (shotgun parsing).
- `JSON.parse(...)` whose result flows on as `any` with no schema at the edge.
- An optional/`undefined` field re-checked at five call sites instead of parsed-away once.
- `const x = await read(id); x.count += 1; await write(id, x)` with no lock, no version check, no atomic increment — a classic lost-update race window.
- `noUncheckedIndexedAccess` off, then `arr[i].foo` assumed present.

## Intent

Most "impossible" production bugs at a service boundary are the same two mistakes. **One**: input was *validated* (checked true/false) but not *parsed* (narrowed to a type), so the loose type — `any`, `string`, `Record<string, unknown>` — leaked inward, and somewhere downstream a field that "was already checked" turns out to be `undefined`, the wrong shape, or attacker-chosen. **Two**: a mutation of shared state was written as if the single-threaded event loop made it atomic, when in fact an `await` in the middle handed control to a concurrent flow that read the same stale value.

This pattern replaces *defensive checking sprinkled everywhere* with two disciplines applied at the edge. **Parse, don't validate**: convert untrusted input into the most precise representation you need, once, at the boundary, so the interior is total over its inputs and illegal states are unrepresentable. **Race-window awareness**: treat every `await` that straddles a read and a write of shared state as a place two flows can interleave, and close the window deliberately (atomic op, idempotency key, or lock). The goal is a service whose inside is *trusted* because everything crossing the edge was turned into a value that can't be wrong — and whose state mutations survive concurrency because the windows were named, not assumed away.

## The Principle

> "The difference between validation and parsing lies almost entirely in how information is preserved. … `parseNonEmpty` gives the caller access to the information it learned, while `validateNonEmpty` just throws it away." — Alexis King, *Parse, don't validate* (2019)

> "Push the burden of proof upward as far as possible, but no further. … Get your data into the most precise representation you need as quickly as you can. … Use a data structure that makes illegal states unrepresentable." — Alexis King, *Parse, don't validate* (2019)

And the type-design complement:

> "Make illegal states unrepresentable." — Yaron Minsky, *Effective ML* (2010); developed for typed code by Scott Wlaschin, *Designing with types* (F# for Fun and Profit)

Reformulated for a Node/TypeScript backend:

- **Parse at the edge, trust inside.** Untrusted input (`req.body`, query params, env vars, message-queue payloads, third-party API responses, file contents) is `unknown` until a schema parser turns it into a precise type. After the parse, downstream code never re-checks.
- **The parser's output type carries the proof.** `parse` doesn't return a boolean — it returns `Email`, `PositiveInt`, `OrderWithLineItems`. The type *is* the evidence the check happened.
- **Illegal states are a type error, not a runtime error.** A discriminated union with the bad combination omitted beats a struct of optionals re-validated everywhere. Turn `{ email?: string; postal?: string }` (four states, one illegal) into `EmailOnly | PostalOnly | Both` (three states, the empty one unrepresentable).
- **"Single-threaded" is not "race-free."** The event loop guarantees a callback runs to completion, *not* that your read-modify-write is atomic across the `await` in its middle. Name the window; close it.

## Parsing at the boundary: the funnel, not the sieve

A *sieve* checks input and lets the same loose value through; a *funnel* turns input into a narrower type and only that type flows on. The funnel is the schema parser:

```ts
import { z } from 'zod';

// Schema = single source of truth for runtime shape AND static type.
const CreateOrder = z.object({
  customerId: z.string().uuid(),
  lineItems: z.array(z.object({
    sku: z.string().min(1),
    qty: z.number().int().positive(),
  })).min(1),
});

// z.infer derives the type from the schema — no hand-kept duplicate.
type CreateOrder = z.infer<typeof CreateOrder>;

function handle(reqBody: unknown) {
  // safeParse: total — never throws; the bad case is data, not control flow.
  const parsed = CreateOrder.safeParse(reqBody);
  if (!parsed.success) {
    return reject(400, parsed.error.flatten());
  }
  // parsed.data: CreateOrder — precise, total, trusted from here inward.
  return placeOrder(parsed.data);
}
```

The point isn't the library — Zod, Valibot, and `io-ts` all do the same job (turn `unknown` into a typed value at runtime). The point is *placement*: one funnel at the boundary, the interior total over `CreateOrder`. Per King, this "pushes the burden of proof upward as far as possible" — the proof that input is well-formed lives at the edge, encoded in the type, not re-litigated at every downstream call site (the "shotgun parsing" failure mode).

**Compile-time backstop.** Runtime parsing covers data crossing the boundary; `strict` covers everything else. With `strictNullChecks`, a possibly-absent value has type `T | undefined` and the compiler forces you to handle the absence. With `noUncheckedIndexedAccess`, `arr[i]` and `map[key]` read as `T | undefined` — closing the "I indexed past the end / the key was missing" class that otherwise surfaces as a runtime `TypeError`. The two halves compose: parse turns *external* input total at runtime; the `strict` family keeps *internal* code honest about absence at compile time.

## Race-window awareness in a single-threaded event loop

Node executes JavaScript on a single thread; the event loop drives FIFO callback queues through ordered phases (timers → pending callbacks → idle/prepare → poll → check → close callbacks), and a callback **runs to completion** before the next one starts. Developers over-read this as "no concurrency, no races." The gap: **`await` is a yield point.** A function suspended at `await` lets the event loop run *other* callbacks before it resumes — so a read-modify-write spanning an `await` is **not** atomic.

```ts
// RACE WINDOW: two concurrent requests for the same key both read 5,
// both compute 6, both write 6 — one increment is lost.
async function addOne(key: string) {
  const cur = await store.get(key);   // flow A reads 5; yields here
  await store.put(key, cur + 1);      // flow B already read 5 too
}
```

Three ways to close the window (choose by the datastore and the cost of a double-apply):

- **Atomic check-then-act** — push the read-modify-write into one operation the datastore executes atomically: a SQL `UPDATE … SET n = n + 1`, an `INSERT … ON CONFLICT DO NOTHING`, a conditional/compare-and-swap write, Redis `INCR`. No window because there is no JS-side gap between read and write.
- **Idempotency key** — make the operation safe to apply twice. The caller supplies a stable key; the first apply records it, replays are no-ops returning the original result. This converts "exactly once across a race" (hard) into "at-least-once + dedupe" (tractable). See `architecture/crosscut/idempotency`.
- **Lock / serialized queue** — admit only one in-flight mutation per key (a per-key async mutex, an advisory DB lock, a single-consumer queue). Simplest to reason about; throughput-bounded, so reserve it for the case where atomic ops don't exist.

The instinct: at every `await` that sits *between* a read and a write of state two flows can share, ask "what runs here, and what stops a second flow reading the same stale value?" If the answer is "nothing," you have a lost-update / double-spend / duplicate-side-effect window.

## Substrate-Specific Examples

### Boundary-validate `k14_ctx` before the resolver uses it

The transaction-resolution context (`k14_ctx`) crossing into the resolver is treated as untrusted at the boundary: it is shape-checked before any field is consumed, rather than read optimistically and assumed well-formed. This is parse-don't-validate at the kernel edge — the resolver's interior is total over a validated context, so a malformed or partial context fails closed at the funnel instead of surfacing as an "impossible" `undefined` deep in the resolve path.

### INV-22 idempotency key = atomic check-then-act on the record store

The kernel's INV-22 invariant is the race-window discipline made concrete. Every record producer sets an `idempotency_key`, and `appendRecord` de-dups on it: a replayed write finds the existing `transaction_id` and returns `{ ok: true, deduped: true }` with **no** new record. Crucially the key is a *verified content-address* — `deriveIdempotencyKey` re-derives it from the record body, so a self-inconsistent incoming key is rejected and a forged stored key is skipped. That is exactly "make the operation safe under replay" rather than "assume each write happens once": two concurrent or retried appends of the same logical effect collapse to one, closing the duplicate-record window that single-threaded reasoning would have missed.

### Make illegal states unrepresentable: the chain edge is `post_state_hash`, not `transaction_id`

The provenance chain keys on `post_state_hash` (a fork-consistent, tree-only content hash) for its chain edge, while `idempotency_key` (which *binds spawn identity* via `computeContentHash`) keys transaction identity. Conflating the two — using the identity-erasing `post_state_hash` as a transaction key — is the CRITICAL-1 false-merge bug. The discipline that prevents it is a representational one: the two concepts are distinct typed fields with distinct derivations, so the "use the wrong hash as the key" state is caught at the producer contract rather than re-checked at every read.

### Fail-closed parsing of malformed hash input

`canonicalJsonSerialize` is depth-bounded (`MAX_CANONICAL_DEPTH = 100`) and the hashing entry points are wrapped to fail closed: `deriveIdempotencyKey` returns null on a malformed/over-deep body, and `appendRecord` degrades to `record-uncomputable` rather than crashing. This is the boundary discipline applied to *internal* untrusted data — a hostile or buggy record body is parsed defensively at the edge of the hashing code, closing a crash-suppression DoS that an "it's our own data, trust it" assumption would have left open.

## Tension with Other Principles

### Parse-at-the-edge vs KISS / not over-modeling

Turning every loose field into a branded type and every optional-pair into a discriminated union can metastasize into type astronomy. **Resolution**: parse to *the most precise type you actually need* (King's "but no further"). A handler that only forwards a string doesn't need a `Branded<Email>`; a handler that routes on presence of email-vs-postal does. The bar is "does an illegal state in *this* value cause a real downstream bug?" — if not, don't model it away.

### Schema-at-the-boundary vs DRY (two sources of truth)

Hand-writing both a runtime check and a separate TypeScript `interface` duplicates the shape and lets them drift. **Resolution**: derive the type *from* the schema (`z.infer`, `io-ts`'s `t.TypeOf`) so there is one source of truth. The schema is the canonical artifact; the static type is generated. This is the DRY-respecting form of the pattern.

### Atomicity/locks vs throughput (the concurrency cost)

A per-key lock or serialized queue is the easiest race-window fix to reason about but caps concurrency to one mutation per key. **Resolution**: prefer the datastore's atomic primitive (`INCR`, conditional write, `ON CONFLICT`) where it exists — it closes the window with no throughput ceiling. Fall back to locks only when no atomic op expresses the operation. State the trade (`architecture/discipline/trade-off-articulation`).

### Runtime parsing vs performance on hot paths

Schema validation on every request has a cost; on a very hot path a hand-tuned check (or a faster validator / compiled schema) can matter. **Resolution**: parse-don't-validate is about *placement and type-narrowing*, not a specific library. Use the fast path where measured, but still output a precise type — a fast validator that returns `any` reintroduces shotgun parsing downstream.

## When to use this pattern

- **At every trust boundary** — HTTP request bodies/params, env vars, CLI args, message-queue payloads, webhook bodies, third-party API responses, file/`stdin` contents. If it came from outside the process, parse it into a precise type before use.
- **Whenever a value is optional or nullable** — model the absence in the type (`strictNullChecks`) and handle it once, rather than re-checking for `undefined` at each use.
- **Whenever two combinations of fields are mutually exclusive** — reach for a discriminated union (make the illegal combo unrepresentable) over a struct of optionals.
- **At every read-modify-write of shared state under concurrency** — DB rows, cache entries, counters, in-memory maps shared across requests. Name the `await` window and close it (atomic op / idempotency key / lock).
- **On any handler/job that may be retried or delivered more than once** — design an idempotency key up front; at-least-once delivery is the norm, not the exception.

## When NOT to use this pattern (or apply with caveat)

- **Already-typed, in-process data** — a value produced and consumed inside the same trusted module that never crossed a boundary doesn't need a runtime schema; the compiler already proves its shape. Parsing it is ceremony.
- **Genuinely free-form blobs** — opaque pass-through payloads (an audit log of arbitrary JSON, a relay that never inspects the body) shouldn't be force-fit into a precise schema you don't use. Keep them `unknown` and *don't* read fields.
- **No shared mutable state** — a pure transform, or a write to a per-request-isolated resource, has no race window to close; adding a lock is pure contention with no benefit.
- **Single-writer-by-construction state** — if the architecture guarantees exactly one writer per key (e.g. a partitioned single-consumer), the atomic/lock machinery may be redundant — but verify the guarantee; "I'm pretty sure only one thing writes this" is how lost-update bugs ship.

## Failure modes when applied incorrectly

- **Validate-not-parse (shotgun parsing)** — checking input is well-formed but passing the loose type onward, so the same fields get re-checked (often inconsistently) downstream. Counter: the boundary function must *return a narrower type*, not a boolean.
- **`any` at the seam** — `JSON.parse()` → `any`, or `req.body as MyType` (an unchecked assertion), defeats the whole pattern: the type lies, and no runtime check happened. Counter: parse `unknown` through a schema; ban `as` on boundary data; turn on `noImplicitAny`.
- **Schema/type drift** — a hand-kept `interface` diverges from the runtime schema. Counter: derive the type from the schema (`z.infer` / `t.TypeOf`).
- **"Single-threaded so it's atomic"** — assuming a read-modify-write across an `await` can't interleave. Counter: treat every `await` between a read and a write of shared state as a window; close it explicitly.
- **Idempotency key that isn't a content-address** — trusting a client-supplied key without re-deriving/binding it lets a forged or mismatched key suppress or collide records. Counter: derive the key from the request body and reject self-inconsistent keys (the INV-22 discipline).
- **`noUncheckedIndexedAccess` off** — `arr[i]` / `map[k]` typed as present-always, then a `TypeError: cannot read properties of undefined`. Counter: enable it; handle the `T | undefined`.

## Tests / verification

- **Boundary parse audit**: for each entry point, confirm untrusted input is parsed into a precise type *once* at the edge, and grep the interior for re-checks of the same fields (a re-check is a smell that the type didn't carry the proof).
- **`unknown`-in, typed-out**: boundary parsers should take `unknown` (or the raw transport type) and return the domain type; a parser returning `any` or a boolean fails the pattern.
- **Illegal-state construction test**: attempt to construct the illegal combination (e.g. the empty email-and-postal struct); it should be a *compile* error, not a runtime guard.
- **`strict` family on**: assert `strict: true` and `noUncheckedIndexedAccess: true` in `tsconfig`; a PR that loosens them needs justification.
- **Race-window test**: drive the read-modify-write with two concurrent flows (`Promise.all([op(), op()])`) against a real/fake store and assert the final state reflects *both* (no lost update). For idempotent ops, replay the same key and assert a single effect.
- **Replay/dedup test**: submit the same idempotency key twice; assert one record/effect and that the second call returns the first result (`deduped: true`).
- **Fail-closed parse test**: feed malformed / over-deep / wrong-typed input to the boundary parser and the hashing path; assert a clean rejection, not a crash or a silent pass-through.

## Related Patterns

- [architecture/crosscut/idempotency](../architecture/crosscut/idempotency.md) — idempotency keys are the primary tool for closing replay/double-apply race windows; the INV-22 content-addressed key is its substrate instance.
- [architecture/discipline/error-handling-discipline](../architecture/discipline/error-handling-discipline.md) — a boundary parse should fail closed with a clear, non-leaking error; the funnel is where fail-fast lives.
- [design-pushback/string-concat-sql](../design-pushback/string-concat-sql.md) — the canonical "untrusted input reached a sink unparsed" failure; parameterized queries are parse-don't-validate for the SQL boundary.
- [security-dev/threat-modeling-essentials](../security-dev/threat-modeling-essentials.md) — every trust boundary is a parse point; attacker-controlled input that isn't narrowed at the edge is the root of most injection/confusion bugs.
- [backend-dev/node-runtime-basics](node-runtime-basics.md) — the event-loop phases and run-to-completion semantics that define where `await` yield points (and thus race windows) occur.
- [backend-dev/express-essentials](express-essentials.md) — input validation at the edge via Zod/Joi in the middleware chain; the HTTP-handler instance of the boundary funnel.

## Sources

Authored by multi-source synthesis of:

1. **Alexis King, "Parse, don't validate"** (lexi-lambda.github.io, 2019-11-05) — the canonical essay. Verified verbatim: parsing preserves the information a check learned while validation discards it; "push the burden of proof upward as far as possible, but no further … get your data into the most precise representation you need as quickly as you can"; the "shotgun parsing" antipattern; and "use a data structure that makes illegal states unrepresentable."
2. **Yaron Minsky, "Effective ML"** (Jane Street OCaml talk, 2010) — origin of "make illegal states unrepresentable." Developed for typed code by **Scott Wlaschin, "Designing with types: Making illegal states unrepresentable"** (F# for Fun and Profit), which explicitly attributes the maxim to Minsky and demonstrates encoding the constraint in a discriminated union so the illegal combination cannot be constructed.
3. **Zod official docs** (zod.dev) — "TypeScript-first schema validation with static type inference." Verified: `parse` throws on invalid input while `safeParse` returns a result object; a schema infers its static TypeScript type (`z.infer`).
4. **Valibot official docs** (valibot.dev) — "a modular and type-safe schema library that helps you validate data easily." Verified: tree-shakable design, "less than 700 bytes" starting size, "up to 95%" smaller bundle than Zod.
5. **`io-ts`** (github.com/gcanti/io-ts) — "Runtime type system for IO decoding/encoding." Verified: decodes `unknown` input into a typed value via an `Either` result (on `fp-ts`); a codec is a decoder + encoder.
6. **TypeScript handbook / tsconfig reference** (typescriptlang.org) — verified official descriptions: `strict` enables the strict family (incl. `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`); `strictNullChecks` gives `null`/`undefined` distinct types; `noUncheckedIndexedAccess` adds `undefined` to index-signature/array reads.
7. **Node.js official docs — "The Node.js Event Loop"** (nodejs.org, event-loop-timers-and-nexttick) — verified: a single JavaScript thread; the phase order timers → pending callbacks → idle/prepare → poll → check → close callbacks; FIFO per-phase queues drained to completion (run-to-completion), which is *why* `await` yield points create non-atomic read-modify-write windows.

Each web source was verified to exist and the quoted claims confirmed via WebFetch/WebSearch during authoring (King's essay text; Wlaschin's article + Minsky attribution; the Zod, Valibot, and `io-ts` official landing pages; the TypeScript tsconfig option descriptions; the Node.js event-loop page). Substrate examples are drawn from the Power Loom v3.1 kernel: boundary-validated `k14_ctx`, the INV-22 content-addressed `idempotency_key` (atomic check-then-act / replay-dedup on the record store), the `post_state_hash`-vs-`transaction_id` representational discipline, and depth-bounded fail-closed hashing.

## Phase

Authored: KB-gap harvest batch (v3.1-era, post-Phase-2 / Runtime Foundation; `feat/kb-gaps-single-lens`). Multi-source synthesis from 7 verifiable sources spanning typed-FP design theory (King, Minsky/Wlaschin), runtime schema parsers (Zod / Valibot / `io-ts`), the TypeScript `strict` family, and the Node.js event-loop model. Serves the HETS **node-backend** persona's named instincts **type-safety-at-the-edge** (parse-don't-validate: narrow untrusted input to a precise type at the boundary so the interior is total) and **race-window-awareness** (read-modify-write windows across `await` in the single-threaded event loop; atomic check-then-act, idempotency keys, locks/queues). Substrate examples emphasize the kernel's boundary validation and the INV-22 content-addressed idempotency discipline.
