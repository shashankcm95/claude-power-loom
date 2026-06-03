---
kb_id: architecture/crosscut/control-and-data-flow
version: 1
tags:
  - crosscut
  - program-analysis
  - foundational
  - architecture
  - static-analysis
  - data-flow
  - control-flow
related:
  - architecture/crosscut/single-responsibility
  - architecture/crosscut/dependency-rule
  - architecture/crosscut/idempotency
  - architecture/discipline/evidence-and-premise-discipline
  - architecture/discipline/error-handling-discipline
sources_consulted:
  - "Aho / Lam / Sethi / Ullman, Compilers: Principles, Techniques, and Tools (Dragon Book, 2nd ed 2006), ch 8 (Code Generation / basic blocks + flow graphs) + ch 9 (Machine-Independent Optimization / data-flow analysis: reaching definitions, live variables, available expressions)"
  - "Nielson / Nielson / Hankin, Principles of Program Analysis (Springer, 1999) — the four approaches: data-flow analysis, constraint-based analysis, abstract interpretation, type-and-effect systems"
  - "Gary A. Kildall, A Unified Approach to Global Program Optimization, POPL 1973 — the monotone data-flow framework (per-node transfer function + meet/join over a lattice, solved to a fixpoint)"
  - "Frances E. Allen, Control Flow Analysis, ACM SIGPLAN Notices, July 1970 — origin of the control-flow graph (CFG): basic blocks as nodes, control transfers as edges; dominators (building on Prosser)"
  - "Edward J. Schwartz / Thanassis Avgerinos / David Brumley, All You Ever Wanted to Know About Dynamic Taint Analysis and Forward Symbolic Execution (but Might Have Been Afraid to Ask), IEEE S&P 2010 — formal taint semantics: source → propagation → sink"
  - "David F. Bacon / Peter F. Sweeney, Fast Static Analysis of C++ Virtual Function Calls, OOPSLA 1996 (Rapid Type Analysis) + Dean / Grove / Chambers, Optimization of Object-Oriented Programs Using Static Class Hierarchy Analysis, ECOOP 1995 (CHA) — call-graph construction under dynamic dispatch"
status: active
---

## Summary

**Principle**: a program has two readable structures — **control flow** (the order statements *may* execute, the CFG and call graph) and **data flow** (how *values* move from where they are produced to where they are consumed). Reading code as an analyzer means recovering these graphs, not scanning lines top-to-bottom.
**The four instincts**: build the **call graph** (who-calls-what), trace **def-use chains** (data-flow-tracing), walk the **exception/error path** (error-path-tracing), surface the **side-effect set** (state-mutation-surfacing).
**Test**: for a given value, can you name every site that produces it and every site that consumes it? For a given `throw`, can you name where it lands? For a function, can you name everything it mutates?
**Sources**: Dragon Book ch 8-9 (CFG + data-flow) + Nielson³ (the four analyses) + Kildall 1973 (the framework) + Allen 1970 (the CFG) + Schwartz/Avgerinos/Brumley 2010 (taint) + Bacon/Sweeney + Dean/Grove/Chambers (call graphs).
**Substrate**: the kernel's provenance chain is a hand-built def-use graph (`post_state_hash` producer → consumer); INV-22 closes a source→sink taint path; M1 is a forward-coupling (reaching-definition) invariant.

## Quick Reference

**Two graphs, one program:**

| Graph | Nodes | Edges | "What does it answer?" | Source |
|-------|-------|-------|------------------------|--------|
| Control-flow graph (CFG) | basic blocks | possible control transfers | what *order* can run? | Allen 1970 |
| Call graph | functions/methods | "calls" relation | who calls whom? | Dean/Grove/Chambers 1995 |
| Data-flow (def-use) | definitions + uses | "this def reaches this use" | where does a *value* go? | Dragon Book ch 9 |

**The four canonical data-flow problems** (Dragon Book ch 9; direction = which way facts propagate, meet = how facts merge at joins):

| Problem | Direction | Meet | Answers |
|---------|-----------|------|---------|
| Reaching definitions | forward | union (`may`) | which defs of `x` could reach here? |
| Live variables | backward | union (`may`) | is `x` read again before re-write? |
| Available expressions | forward | intersection (`must`) | is `a+b` already computed on all paths? |
| Very-busy expressions | backward | intersection (`must`) | is `a+b` used on every path ahead? |

**The framework (Kildall 1973)**: each CFG node gets a **transfer function**; a **meet/join** merges facts where paths converge; iterate to a **fixpoint** over a lattice of finite height with monotone transfers (the **worklist algorithm**: re-process a node's successors only when its output changed). This single frame instantiates all four problems above by choosing the lattice, direction, and transfer.

**Static vs dynamic** (Schwartz/Avgerinos/Brumley 2010 frame it for taint):

- **Static** — analyze source without running it. Covers *all* paths; over-approximates → **false positives**. `may` answers.
- **Dynamic** — observe one real execution. Precise for *that* run; under-approximates → **false negatives** off the observed path.

**The four named instincts (this doc's core):**

- **who-calls-what** — build the call graph: callers (who invokes this?) and callees (what does this invoke?). Dynamic dispatch makes the callee set imprecise — CHA/RTA bound it.
- **data-flow-tracing** — follow a value def → all uses (def-use chains, built from reaching definitions). SSA gives each value one def, making the chain linear and unambiguous.
- **error-path-tracing** — walk the unhappy path: where a `throw`/error/`null` is caught, propagates uncaught, or silently swallowed. Exception edges are extra CFG edges.
- **state-mutation-surfacing** — find the side-effect set: every write to shared/persistent state. A pure function has none; an impure one's blast radius = its mutation set.

**Taint analysis (source → sink)**: untrusted input enters at a **source**, flows through the program, reaches a security-sensitive **sink**; a path with no **sanitizer** in between is the bug (OWASP injection). It is data-flow-tracing with a security lattice (`tainted` / `untainted`).

**Top smells when an analyzer skips these:**

- "It calls `save()`" without asking *which* `save()` (ignored dynamic dispatch).
- Reasoning about a value at its use without finding *all* its defs (missed a reaching definition).
- Blessing a happy path while the `throw` two frames up lands in a bare `catch {}` (un-walked error path).
- Calling a function "read-only" without auditing its writes (un-surfaced side effect).

## Intent

Source code is written and stored as a *linear* sequence of lines, but it does not *execute* linearly, and its meaning is not local to a line. Two questions dominate any non-trivial reading-of-code task — **"what can run, in what order, calling what?"** (control flow) and **"where does this value come from and where does it go?"** (data flow) — and neither is answerable by scanning top-to-bottom. The discipline this doc encodes is: when analyzing code, *recover the graphs the compiler would build* rather than trusting line order.

This matters because the costly bugs live in the gaps between the linear text and the actual graphs: a value mutated through an alias you didn't trace; an exception that unwinds past the handler you assumed would catch it; a callee resolved by dynamic dispatch to an implementation you never read; an untrusted input that reaches a sink because the one path without a sanitizer was the path you didn't follow. The four instincts below are the analyst's version of the four classical program analyses — made into reading habits rather than tooling.

## The Principle

> "We construct a control-flow graph (CFG) ... the nodes of the flow graph are the basic blocks, [and] there is an edge from block B to block C if and only if it is possible for the first instruction in block C to immediately follow the last instruction in block B." — Aho/Lam/Sethi/Ullman, *Compilers: Principles, Techniques, and Tools* (Dragon Book, 2nd ed), §8.4

> "We define a *data-flow analysis* as ... an association of a data-flow value with each point in the program, [computed by] a set of constraints [transfer functions and a meet operator] on the data-flow values ... solved by iteration to a fixed point." — Dragon Book §9.2

And the unifying frame:

> "A general purpose program flow analysis algorithm is developed which ... depends upon the existence of an *optimizing function* [per-node transfer function] and a *meet* operation [how information from different nodes is combined]." — Gary A. Kildall, *A Unified Approach to Global Program Optimization*, POPL 1973

Reformulated for the analyst:

- **Control flow is a graph, not a list.** Recover the CFG (basic blocks + branch/loop/return edges) and the call graph (caller→callee edges). Line order is a serialization of the graph, not the graph.
- **Data flow is a relation, not a location.** A value's behavior is defined by the *set* of its definitions and the *set* of its uses, connected by reaching-definition edges — not by the line where it happens to appear.
- **There is one framework.** Kildall's monotone framework instantiates reaching definitions, liveness, available expressions, taint, and constant propagation by choosing a lattice, a direction, and a transfer function. The analyst's instincts are this framework applied by hand.
- **Static over-approximates; dynamic under-approximates.** A sound static reading reports everything that *may* happen (and some things that can't); a single execution shows what *did* happen on one path. Know which guarantee you are getting.

## The four instincts (analyzer subsections)

### Instinct: who-calls-what (build the call graph)

The reflex: never read a function in isolation. For any function, recover **both** directions — its **callers** (who invokes it; the impact set of a change) and its **callees** (what it invokes; the behavior it delegates). Together these are the **call graph**: nodes are functions, edges are the "calls" relation (Dean/Grove/Chambers 1995).

The hard part is **dynamic dispatch**: a call through an interface/virtual method does not name its callee syntactically — the actual target depends on the runtime type of the receiver. Static call-graph construction must *bound* the callee set:

- **Class Hierarchy Analysis (CHA)** (Dean/Grove/Chambers, ECOOP 1995): the callee set is every override in the declared receiver type's subtype hierarchy. Sound, but over-approximates — includes types never instantiated.
- **Rapid Type Analysis (RTA)** (Bacon/Sweeney, OOPSLA 1996): prune CHA's set to types actually instantiated anywhere reachable from `main`. More precise than CHA, at the cost of needing whole-program instantiation info.

Analyst habit: at a polymorphic call site, ask "what is the *set* of implementations this could resolve to?" — then read the ones that matter. Treat `grep` for callers as a sound-ish CHA, and remember it misses reflection / dynamic invocation / function-pointer indirection (the edges no syntactic search finds).

### Instinct: data-flow-tracing (follow a value def → all uses)

The reflex: pick a value and trace it. A **definition** (`def`) is a site that writes the variable; a **use** is a site that reads it. A **def-use chain** links a definition to every use it can reach; a **use-def chain** links a use to every definition that can reach it (Dragon Book §9.2.5). These chains are *built from* the **reaching-definitions** analysis: "which definitions of `x` may reach this point without an intervening redefinition?"

Two refinements an analyst leans on:

- **Reaching definitions is a `may` (union) forward analysis** — at a merge point, a use sees *every* def that reaches along *any* path. Missing one is the classic "I only looked at the obvious assignment" bug.
- **SSA (static single assignment)** gives each value exactly one definition (φ-functions merge at joins), so every use has exactly one reaching def and chains are linear in program size rather than quadratic. When a value is confusing, mentally rename it SSA-style: each reassignment is a *new* value.

Analyst habit: to understand a value, enumerate its defs and its uses — do not reason from the single occurrence in front of you. Aliasing (two names for one cell) and indirection (the value flows through a field, a closure, a global) are where the chain breaks; follow the value, not the name.

### Instinct: error-path-tracing (walk the unhappy path)

The reflex: the happy path is the path everyone reads; the bug is on the other one. For a given `throw` / returned error / `null`, answer: **where does it actually land?** Exceptions add edges to the CFG that ordinary control flow doesn't show — an exception unwinds the call stack until a matching handler is found, so the "next statement" after a throwing call may be a `catch` several frames up (this is an *interprocedural* control-flow question, not a local one).

Three landings to distinguish:

- **Caught and handled** — the error reaches a handler that does something meaningful. Verify the handler actually matches (type/scope) and recovers, vs. re-throws.
- **Propagated uncaught** — the error unwinds past every handler to a top-level boundary (crash, 500, rejected promise). Trace *which* boundary, and whether it leaks internals (`error-handling-discipline`).
- **Silently swallowed** — a bare `catch {}` / ignored error return / unobserved rejected promise. This is the worst landing: the unhappy path terminates with no signal. It is the analyst's job to *find* these, because no test failure points at them.

Analyst habit: for each error source, walk the unwinding path explicitly. Treat empty catch blocks, discarded `err` returns, and un-awaited promises as un-walked edges, not as "handled."

### Instinct: state-mutation-surfacing (find the side-effect surface)

The reflex: a function's signature lies about what it does; its **side-effect set** is the truth. A **pure** function's output depends only on its inputs and it mutates nothing observable — it is **referentially transparent** (the call can be replaced by its result without changing program meaning). An **impure** function reads or writes state outside its locals: globals, fields, the filesystem, the network, a database, shared memory.

Surface the mutation set by asking, for the code under analysis: what *shared or persistent* state does this write? Side-effect / purity analysis (a classic application of data-flow analysis, and the subject of Nielson³'s type-and-effect-systems approach) classifies each function by the effects it may perform. For an analyst:

- **The mutation set is the blast radius.** A function that mutates only its return value is trivially reversible and concurrency-safe; one that mutates shared state couples every caller to the order of calls (see `idempotency`, `blast-radius-and-reversibility`).
- **Aliasing widens the set.** A write through a parameter that aliases caller state is a side effect even though it "looks local." Trace the alias.
- **Purity is compositional.** A function is pure only if every callee it invokes is pure. One impure callee taints the whole subtree.

Analyst habit: before calling anything "read-only" or "safe to reorder/retry," enumerate its writes — transitively. Immutability (the substrate's "create new objects, never mutate") is the design that makes this set provably empty.

## Static vs dynamic, and taint as the bridge

The two reading modes trade the same way everywhere:

- **Static analysis** reads the code without executing it and reasons over *all* paths. To stay sound it must over-approximate (a `may`-analysis), so it reports spurious possibilities — **false positives**. This is the mode of the four instincts above when done by inspection.
- **Dynamic analysis** observes one concrete execution. It is precise about *that* run but blind to every path not taken — **false negatives**. A debugger / log / single test is dynamic.

**Taint analysis** is the security-flavored union of data-flow-tracing and the static/dynamic axis (Schwartz/Avgerinos/Brumley, IEEE S&P 2010). Mark untrusted input at a **source**; propagate the `tainted` mark along data flow; raise an alarm if tainted data reaches a security-sensitive **sink** (a SQL string, an HTML response, a shell command, an `eval`) without passing a **sanitizer**. A source→sink path with no sanitizer is precisely an injection vulnerability (OWASP A03). The analyst's instinct is the same as def-use tracing, with the lattice specialized to `{tainted, untainted}` and the question specialized to "can attacker-controlled data reach somewhere it can do harm?"

## Substrate-Specific Examples

### The provenance chain is a hand-built def-use graph

The kernel's transaction-record store keys the provenance chain on `post_state_hash`: a producer *defines* the hash (`computePostStateHash`), and `readByPostStateHash` *uses* it as a value-equality join to find the chain edge. This is a def-use chain expressed in the substrate's data model — the "definition" is the producing spawn, the "uses" are every chained record that walks back through that hash. Reading the provenance code correctly *requires* the data-flow-tracing instinct: you cannot understand a record by reading it locally; you trace its `post_state_hash` to the records that produce and consume it.

### M1 is a reaching-definition / forward-coupling invariant

The M1 invariant — *every* producer of a `post_state_hash` must reuse `computePostStateHash` verbatim — is a forward data-flow constraint: the value defined at each producer must reach the consumer (`readByPostStateHash`) *identically*, or the value-equality join silently breaks and fails closed. It is reaching-definitions reasoning made into a codified rule: the analyst's question "do all definitions of this value agree at the use?" is exactly M1's enforcement target. A one-line deviation (different serializer, field order) is a def the consumer can't match.

### INV-22 closes a source→sink taint path

INV-22's idempotency key is, in taint terms, a **sanitizer on an identity sink**. An incoming `idempotency_key` is untrusted (the store is not a sandbox — `p-writescope`); `deriveIdempotencyKey` re-derives it from the record body and `appendRecord` *rejects a self-inconsistent key* before it can suppress a write. The source is the externally-supplied key; the sink is the de-dup decision; the re-derivation is the sanitizer that makes a forged source-value un-actionable. Reading this code is error-path-tracing + taint-tracing: the defended path is the *unhappy* one (a forged key arriving).

### Out-of-tree effects bound the side-effect surface

The kernel's "never mutate the user's HEAD/working tree; write only new objects + `refs/loom/*`" discipline is state-mutation-surfacing applied as a design constraint: the mutation set is *deliberately* held to append-only, out-of-tree writes so that the side-effect surface is small, observable, and reversible. The state-mutation-surfacing instinct is what verifies the constraint holds — auditing each effect-producing path for writes that escape the intended surface (e.g., an absolute-path write escaping the worktree — the Wave-1 `p-writescope` finding).

## Tension with Other Principles

### Soundness (static `may`) vs precision (dynamic `did`)

A sound static reading reports everything that *may* happen, including impossibilities; a dynamic reading reports one real path with no false positives but blind spots everywhere else. **Resolution**: match the guarantee to the stakes. For a safety/security property (can tainted data *ever* reach this sink?), prefer the sound `may`-analysis and tolerate false positives. For "what is actually happening in this incident," use the dynamic/observed path. Don't confuse "I ran it once and it was fine" (dynamic, under-approximate) with "it is safe" (a static `may`-claim) — this is the `evidence-and-premise-discipline` failure of treating one observation as a universal.

### Full def-use tracing vs analysis cost (and YAGNI)

Tracing every def-use chain, every callee of every dynamic dispatch, and every transitive side effect is unbounded work. **Resolution**: scope the analysis to the question. Blast-radius sizing decides depth — trace exhaustively where the consequence-if-wrong is high (a join key, a security sink, a shared-state write), and stop at the first safe boundary elsewhere. Over-analyzing a pure local helper is YAGNI; under-analyzing a taint sink is negligence.

### Interprocedural reach vs modular reasoning

Error-path-tracing and call-graph construction are inherently *interprocedural* — an exception lands in another function, a callee is in another module — which pulls against the modular ideal of reading one unit at a time (`single-responsibility`, `dependency-rule`). **Resolution**: clean module boundaries are what make the interprocedural graphs *tractable* — a narrow interface bounds the callee set and the error contract. The tension is productive: code that is hard to trace across boundaries is usually code whose boundaries are wrong.

## When to use this principle

- **Any code-reading / code-review task** where correctness depends on more than one location — which is nearly all of them above triviality.
- **Before declaring a function safe to retry, reorder, cache, or parallelize** — state-mutation-surfacing is the prerequisite (it feeds `idempotency`).
- **Security review** — taint-style source→sink tracing for every untrusted-input path (`threat-modeling-essentials`).
- **Impact analysis before a change** — who-calls-what (callers) gives the blast radius; data-flow-tracing gives the downstream values affected.
- **Debugging an error that "shouldn't happen"** — error-path-tracing to find where it actually lands (often a swallowed catch).

## When NOT to use this principle (or apply with caveat)

- **Genuinely local, pure helpers** — a self-contained function with no callees, no shared-state writes, and no throws is readable as a list; building graphs for it is theater.
- **Throwaway / prototype code** — exhaustive def-use and call-graph reasoning pays back over a maintained codebase; for disposable spikes the overhead can exceed the value.
- **When a sound tool already answers the question** — if a type system, an effect system, or a static analyzer already proves "this is pure" / "no tainted flow," re-deriving it by hand is redundant. Trust the sound mechanism; spend the manual instinct where tooling is absent or unsound.

## Failure modes when applied incorrectly

- **Reasoning from one occurrence** — analyzing a value at its single visible use and missing other reaching definitions (the merge-point def you didn't see). Counter: enumerate *all* defs and uses; think SSA.
- **Ignoring dynamic dispatch** — reading the syntactic callee and missing the actual override that runs. Counter: bound the callee set (CHA/RTA reasoning); read the implementations that matter.
- **Happy-path-only reading** — blessing the success path while the exception unwinds to a bare `catch {}`. Counter: walk every error source to its landing; treat empty catches and ignored error-returns as un-handled.
- **"Looks read-only"** — calling a function safe to reorder/retry without auditing its transitive writes (especially writes through aliased parameters). Counter: surface the full mutation set before any reorder/retry/parallelize claim.
- **Dynamic-as-proof** — "it worked when I ran it" used as a soundness claim. Counter: one execution is an under-approximation; a `may`-property needs a `may`-analysis.
- **Unsanitized source→sink** — tracing data flow but not flagging that an untrusted source reaches a sink with no sanitizer on *some* path. Counter: it's the path *without* the sanitizer that is the bug.

## Tests / verification

- **Def-use enumeration**: for a load-bearing value, list every definition and every use; if you can't, you haven't traced it. The M1 invariant is this test codified for `post_state_hash`.
- **Callee-set bound**: at each polymorphic call site touched by a change, name the set of possible implementations (CHA-style) and confirm the ones that matter were read.
- **Error-landing audit**: for each `throw` / error-return in scope, name its handler (or the boundary it escapes to); grep for `catch {}` / `catch (e) {}` with empty bodies and ignored-error returns as un-walked edges.
- **Side-effect ledger**: for a function claimed pure or read-only, list its transitive writes to shared/persistent state; empty ledger ⇒ pure. The substrate's out-of-tree-only effects make this ledger auditable.
- **Source→sink reachability**: for each untrusted source, confirm every path to a sensitive sink passes a sanitizer; an unsanitized path is a finding (`threat-modeling-essentials`).
- **Static/dynamic honesty**: label each claim as `may` (static, over-approximate) or `did` (dynamic, one path); never let a `did` masquerade as a `may`.

## Related Patterns

- [architecture/crosscut/single-responsibility](single-responsibility.md) — clean actor boundaries bound the call graph and the error contract, making interprocedural tracing tractable.
- [architecture/crosscut/dependency-rule](dependency-rule.md) — the direction of "calls" edges is what DIP governs; a clean dependency graph is a readable call graph.
- [architecture/crosscut/idempotency](idempotency.md) — state-mutation-surfacing is the prerequisite for any idempotency / safe-retry claim; the side-effect set decides it.
- [architecture/discipline/evidence-and-premise-discipline](../discipline/evidence-and-premise-discipline.md) — the static (`may`) vs dynamic (`did`) distinction is the program-analysis form of "one observation is not a universal."
- [architecture/discipline/error-handling-discipline](../discipline/error-handling-discipline.md) — error-path-tracing is the analysis; fail-closed / no-silent-swallow is the discipline it verifies.

## Sources

Authored by multi-source synthesis of:

1. **Aho / Lam / Sethi / Ullman, *Compilers: Principles, Techniques, and Tools*** (Dragon Book, 2nd ed, 2006) — §8.4 (basic blocks + flow graphs / the CFG) and ch 9 (Machine-Independent Optimization): the data-flow framework and the canonical problems — reaching definitions, live variables, available expressions — with direction (forward/backward) and meet (union/intersection), the iterative/worklist solution, and def-use / use-def chains (§9.2.5).
2. **Nielson / Nielson / Hankin, *Principles of Program Analysis*** (Springer, 1999) — the four-approaches taxonomy: data-flow analysis, constraint-based analysis, abstract interpretation, and type-and-effect systems (the basis for side-effect/purity analysis as a formal discipline).
3. **Gary A. Kildall, *A Unified Approach to Global Program Optimization*** (POPL 1973) — the monotone data-flow framework: a per-node transfer ("optimizing") function plus a meet operation, solved to a fixpoint over a lattice; the single frame that instantiates all the per-problem analyses.
4. **Frances E. Allen, *Control Flow Analysis*** (ACM SIGPLAN Notices, July 1970) — the origin of the control-flow graph: basic blocks as nodes, control transfers as edges, and dominator relationships (building on Prosser; later expanded by Lowry/Medlock).
5. **Schwartz / Avgerinos / Brumley, *All You Ever Wanted to Know About Dynamic Taint Analysis and Forward Symbolic Execution (but Might Have Been Afraid to Ask)*** (IEEE S&P 2010) — formal taint semantics (source → propagation → sink) and the static-vs-dynamic precision/soundness trade.
6. **Dean / Grove / Chambers, *Optimization of Object-Oriented Programs Using Static Class Hierarchy Analysis*** (ECOOP 1995, CHA) + **Bacon / Sweeney, *Fast Static Analysis of C++ Virtual Function Calls*** (OOPSLA 1996, RTA) — call-graph construction under dynamic dispatch and the soundness/precision trade between CHA and RTA.

Each web source was verified to exist via WebSearch/WebFetch during authoring (Dragon Book ch 9 data-flow problems and directions; Kildall 1973 POPL framework; Allen 1970 SIGPLAN CFG; Schwartz/Avgerinos/Brumley 2010 IEEE S&P taint semantics; Nielson³ 1999 four-approaches; CHA Dean/Grove/Chambers 1995 and RTA Bacon/Sweeney 1996; OWASP source→sink injection framing). Substrate examples are drawn from the Power Loom v3.1 kernel: the `post_state_hash` provenance def-use chain, the M1 forward-coupling invariant, the INV-22 idempotency-key sanitizer on the identity sink, and the out-of-tree-only side-effect surface.

## Phase

Authored: kb authoring batch (v3.1-era single-lens KB-gap harvest). Multi-source synthesis from 6 verifiable sources spanning compiler theory (Dragon Book, Allen, Kildall), program-analysis foundations (Nielson³), security data-flow (Schwartz/Avgerinos/Brumley + OWASP), and call-graph construction (CHA/RTA). Serves the HETS codebase-analyzer persona's four named instincts — who-calls-what (call graphs), data-flow-tracing (def-use chains / reaching definitions), error-path-tracing (exception/error-flow), and state-mutation-surfacing (side-effect/purity analysis) — and supplies the static-vs-dynamic and taint (source→sink) lenses for the code-reviewer and security-engineer roles.
