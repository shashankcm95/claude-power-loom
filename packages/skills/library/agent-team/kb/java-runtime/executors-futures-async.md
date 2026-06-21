---
kb_id: java-runtime/executors-futures-async
version: 1
tags:
  - java-runtime
  - concurrency
  - async
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: core-java-concurrency-basic, core-java-concurrency-advanced, core-java-concurrency-advanced-2, core-java-concurrency-advanced-3"
  - "JEP 444: Virtual Threads (javaalmanac.io/features/virtual-threads)"
related:
  - java-runtime/concurrency-primitives
  - java-runtime/concurrent-collections
status: active
---

## Summary

**Concept**: Thread lifecycle plus the executor/future/async layer — thread pools, `Future`, `CompletableFuture`, fork/join — the JDK-native task-execution model.
**Key APIs**: `Thread`/`Runnable`/`Callable`, `ExecutorService`/`Executors.newFixedThreadPool`/`ThreadPoolExecutor`, `Future.get(timeout)`, `CompletableFuture` (supplyAsync/thenApply/thenCompose/thenCombine/allOf/handle), `ForkJoinPool`/`RecursiveTask`/`RecursiveAction`, `RejectedExecutionHandler`.
**Gotcha**: the shutdown idiom (`shutdown` -> `awaitTermination` -> `shutdownNow` -> re-interrupt); `Future.get()` blocks (use the timeout overload); never `Thread.stop()` — use cooperative cancellation.
**2026-currency**: virtual threads (JEP 444, final JDK 21) reframe pooling for blocking I/O; structured concurrency is STILL preview through JDK 26.
**Sources**: Baeldung `core-java-concurrency-basic`/`-advanced` modules; JEP 444.

## Quick Reference

**Threads**: extend `Thread` vs implement `Runnable` (composition preferred); `Runnable` (void) vs `Callable<T>` (returns a value, throws checked). States: NEW / RUNNABLE / BLOCKED / WAITING / TIMED_WAITING / TERMINATED via `Thread.getState()`. Daemon vs user threads (JVM exits when only daemons remain). **Cooperative cancellation**: never `Thread.stop()` (deprecated) — use an `AtomicBoolean` flag + `interrupt()`, check it in the run loop. Catching `InterruptedException` clears the flag — restore via `Thread.currentThread().interrupt()`; `interrupted()` (static) clears, `isInterrupted()` (instance) preserves.

**Thread pools**: `Executors.{newSingleThreadExecutor, newFixedThreadPool, newCachedThreadPool, newScheduledThreadPool}`; `ThreadPoolExecutor` internals (core vs max pool size + work queue); `ForkJoinPool.commonPool()`. Fixed pool queues overflow tasks; cached pool grows unbounded.

**ExecutorService shutdown idiom**:
```java
pool.shutdown();
if (!pool.awaitTermination(t, TimeUnit.SECONDS)) pool.shutdownNow();
// on InterruptedException: pool.shutdownNow(); Thread.currentThread().interrupt();
```
`submit` returns a `Future`; `get()` blocks (use the timeout overload); `isDone()` polls; `cancel()`. `ExecutorCompletionService` for take-as-completed.

**CompletableFuture cookbook**: `supplyAsync`/`runAsync` (start) -> `thenApply`/`thenApplyAsync` (transform) -> `thenAccept`/`thenRun` (consume) -> `thenCompose` (chain a future) -> `thenCombine`/`thenAcceptBoth` (join two) -> `allOf(...).join()` (aggregate) -> `handle`/`exceptionally` (recover). The JDK-native modern async primitive.

**Fork/Join**: `RecursiveTask<T>` (returns) / `RecursiveAction` (void); threshold split with `Arrays.copyOfRange` + `invokeAll` + `join`; work-stealing. `parallelStream()` uses the common `ForkJoinPool` — submit the stream task to a dedicated `ForkJoinPool(n)` to confine parallelism.

**Saturation policies (`RejectedExecutionHandler`)**: AbortPolicy, CallerRunsPolicy, DiscardPolicy, DiscardOldestPolicy (fires when saturated OR shutting down).

**Current (mid-2026)**: **virtual threads** (`Thread.ofVirtual()`, `Executors.newVirtualThreadPerTaskExecutor()`) mean you no longer pool for blocking I/O. **Structured concurrency is still preview** (do not present as stable). The mostly-stale async survey (EA Async, Cactoos, Guava `ListenableFuture`, jcabi `@Async`) is superseded by `CompletableFuture`.

## Full content

This atom spans thread lifecycle (section 1 of the map) and the executor/future/async layer (section 4): the JDK-native way to run, coordinate, and await tasks.

### Threads and cancellation

A thread runs a `Runnable` (void) or, via an executor, a `Callable<T>` (returns a value, can throw checked exceptions). Composition (implement `Runnable`) is preferred over extending `Thread`. A thread moves through NEW / RUNNABLE / BLOCKED (waiting for a monitor) / WAITING / TIMED_WAITING / TERMINATED, observable via `getState()`. Daemon threads do not keep the JVM alive. Cancellation is cooperative: never call the deprecated `Thread.stop()`; instead flip an `AtomicBoolean` and call `interrupt()`, then check both in the run loop. The interrupt-flag rules are a classic trap — catching `InterruptedException` clears the flag (restore with `Thread.currentThread().interrupt()`), the static `interrupted()` clears while the instance `isInterrupted()` preserves. Evidence: `core-java-concurrency-basic/.../stopping/ControlSubThread.java`.

### Executors and futures

`Executors` factory methods create the standard pools; `ThreadPoolExecutor` exposes the internals (core vs max size, the bounded/unbounded work queue). A fixed pool queues overflow tasks; a cached pool grows unbounded (an OOM-native-thread risk cured by a bounded pool). The lifecycle idiom is `shutdown()` -> `awaitTermination(timeout)` -> `shutdownNow()` if not finished -> re-interrupt on `InterruptedException`. Evidence: `core-java-concurrency-basic/.../executorservice/WaitingForThreadsToFinishManualTest.java:18-28`. `submit` returns a `Future` whose `get()` blocks — always prefer the timeout overload — with `isDone()` polling and `cancel()`. `ExecutorCompletionService` yields results as they complete.

### CompletableFuture

`CompletableFuture` is the modern async primitive and the corpus shows the full combinator cookbook: completion (`completedFuture`/`complete`/`completeExceptionally`), async kick-off (`supplyAsync`/`runAsync`), transform (`thenApply`/`thenApplyAsync`), consume (`thenAccept`/`thenRun`), compose (`thenCompose`), combine (`thenCombine`/`thenAcceptBoth`), aggregate (`allOf(...).join()`), and exception handling (`handle`/`exceptionally`). Evidence: `core-java-concurrency-basic/.../completablefuture/CompletableFutureLongRunningUnitTest.java`.

### Fork/Join and saturation

Fork/join divides recursive work: `RecursiveTask<T>` returns a value, `RecursiveAction` is void; below a threshold compute directly, above it split (`Arrays.copyOfRange`), `invokeAll`, and `join`. The pool uses work-stealing. `parallelStream()` runs on the shared common `ForkJoinPool` — to bound parallelism, submit the stream operation to a dedicated `ForkJoinPool(n)`. When a pool is saturated (or shutting down) a `RejectedExecutionHandler` decides: AbortPolicy (throws), CallerRunsPolicy (runs on the submitter), DiscardPolicy, DiscardOldestPolicy, or a custom GrowPolicy.

### 2026 currency

- **Virtual threads — FINAL in JDK 21 (JEP 444).** Create via `Thread.ofVirtual().start(r)`, `Thread.startVirtualThread(r)`, or `Executors.newVirtualThreadPerTaskExecutor()`. They reframe the corpus's "how to start a thread / size a fixed pool / thread-per-client" pedagogy: for blocking I/O you no longer pool. [JEP 444: Virtual Threads](https://javaalmanac.io/features/virtual-threads/)
- **Structured concurrency — STILL PREVIEW through JDK 26; do NOT present as stable.** Path JEP 453 (21) -> 462 (22) -> 480 (23) -> 499 (24) -> 505 (25) -> 533 (26). JEP 505 (JDK 25) replaced `StructuredTaskScope` public constructors with static factories `StructuredTaskScope.open()` / `open(Joiner)`. [JEP 505: Structured Concurrency (Fifth Preview)](https://openjdk.org/jeps/505) · [JEP 533: Structured Concurrency (Seventh Preview)](https://openjdk.org/jeps/533)
- **`synchronized` no longer pins (JEP 491, JDK 24)** — relevant to virtual-thread tasks that block. [JEP 491: Synchronize Virtual Threads without Pinning](https://openjdk.org/jeps/491)
- The async-library survey (EA Async, Cactoos, jcabi `@Async`, Guava `ListenableFuture`) is stale; `CompletableFuture` (plus virtual threads for blocking calls) is the JDK-native answer.
