---
kb_id: java-runtime/concurrency-primitives
version: 1
tags:
  - java-runtime
  - concurrency
  - synchronization
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: core-java-concurrency-advanced, core-java-concurrency-advanced-3, core-java-concurrency-advanced-4, core-java-concurrency-basic-2"
  - "JEP 491: Synchronize Virtual Threads without Pinning (openjdk.org/jeps/491)"
related:
  - java-runtime/executors-futures-async
  - java-runtime/concurrent-collections
status: active
---

## Summary

**Concept**: Low-level `java.util.concurrent` mutual-exclusion, visibility, and coordination primitives — the building blocks under every higher-level executor/collection.
**Key APIs**: `synchronized` (intrinsic monitor), `ReentrantLock`/`ReentrantReadWriteLock`/`StampedLock` + `Condition`, `Semaphore`, `volatile`, the `Atomic*` family (`AtomicInteger`/`AtomicReference`/`AtomicStampedReference`/`LongAdder`), `CountDownLatch`/`CyclicBarrier`/`Phaser`/`Exchanger`, `wait`/`notify`/`notifyAll`.
**Gotcha**: `volatile` gives visibility but NOT atomicity (`count++` still loses updates); `wait()` must loop on a `while` inside `synchronized`; the ABA problem defeats plain CAS.
**2026-currency**: pure JDK, unchanged; JEP 491 (JDK 24) eliminated `synchronized` virtual-thread pinning, retiring the "prefer ReentrantLock" workaround.
**Sources**: Baeldung `core-java-concurrency-advanced*` family; JEP 491.

## Quick Reference

**Five mutex mechanisms** (taught side-by-side): `synchronized` method, `synchronized` block, `ReentrantLock` (lock/unlock in try-finally), `Semaphore(1)` as a binary mutex, Guava `Monitor`.

**`synchronized`** — instance method (locks `this`), static method (locks `.class`), instance block, static block. Intrinsic monitor lock; reentrant.

**Explicit locks**:
- `ReentrantLock` + `Condition` (await/signalAll; two conditions for producer/consumer); owned + reentrant (`getHoldCount`).
- `ReentrantReadWriteLock` — separate read/write locks.
- `StampedLock` — write/read/optimistic-read: `long s = tryOptimisticRead(); read; if(!validate(s)) fall back to readLock()`.
- `Semaphore` — ownerless (any thread releases; no reentrancy/hold-count); use a fair `ReentrantLock(true)` to avoid starvation.

**`wait`/`notify`** — MUST hold the monitor (`synchronized`) or `IllegalMonitorStateException`; ALWAYS loop on a `while` condition (spurious wakeups). `sleep` (on `Thread`, holds locks) vs `wait` (on `Object`, releases the monitor).

**Atomics & lock-free**:
- `volatile` — visibility (happens-before), no atomicity.
- CAS loop: `while(true){ old=get(); next=f(old); if(cas(old,next)) return; }`.
- `AtomicStampedReference` adds a monotonic stamp → defeats the **ABA problem** (plain value-CAS silently accepts A->B->A).
- `LongAdder`/`LongAccumulator` stripe across cells, beating `AtomicLong` under contention (`sum()` not atomic with concurrent updates).

**Coordination**: `CountDownLatch` (one-shot gate), `CyclicBarrier` (reusable + barrier action), `Phaser` (reusable multi-phase), `Exchanger` (two-thread rendezvous swap). Start N threads together via `CountDownLatch(1)` release or `CyclicBarrier(N)`.

**Top gotchas**: lock on a private final `Object` per guarded field — never String literals (JVM-wide pool), boxed `Boolean`/cached `Integer` (-128..127), or `this`/publicly-reachable objects. Avoid `this`-escape (don't `start()` a thread in a constructor). Local variables are thread-safe (per-frame); only shared fields race.

**Current (mid-2026)**: all primitives are pure-JDK and unchanged. The base's "`synchronized` pins a virtual thread to its carrier, prefer `ReentrantLock`" advice held for JDK 21-23 only; JEP 491 (JDK 24) eliminated nearly all pinning, so the workaround is no longer needed for pinning reasons.

## Full content

This is the bottom layer of `java.util.concurrent`: the mutual-exclusion, memory-visibility, and thread-coordination primitives that executors, futures, and concurrent collections are all built on top of. The Baeldung corpus teaches them in increasing depth across the `core-java-concurrency-advanced` family (basic-2 -> basic -> advanced -> advanced-2/3/4).

### Mutual exclusion

Five mechanisms appear side-by-side: a `synchronized` method, a `synchronized` block, a `ReentrantLock`, a `Semaphore(1)` used as a binary mutex, and Guava's `Monitor`. Intrinsic `synchronized` locks `this` (instance) or the `.class` object (static) and is reentrant. `ReentrantLock` adds explicit lock/unlock (always in try-finally), hold counts (`getHoldCount`), fairness (`new ReentrantLock(true)`), and `Condition` objects. `ReentrantReadWriteLock` separates concurrent readers from exclusive writers. `StampedLock` adds an optimistic-read mode: `tryOptimisticRead()` returns a stamp, you read, then `validate(stamp)` — if a writer intervened it returns false and you fall back to a real `readLock()`. Evidence: `core-java-concurrency-advanced/.../locks/StampedLockDemo.java:47-64`.

A `Semaphore` is ownerless — any thread can release a permit, there is no reentrancy or hold count — which distinguishes it from `ReentrantLock`.

### Guarded blocks: wait / notify

The classic producer/consumer guarded block uses `while(condition){ wait(); }` inside a `synchronized` block, with `notifyAll()` after mutating state. Two rules are load-bearing: the call must hold the object's monitor (else `IllegalMonitorStateException`), and the wait must be inside a `while` loop, not an `if`, to defend against spurious wakeups and stolen signals. `Thread.sleep` holds any locks the thread owns; `Object.wait` releases the monitor. Evidence: `core-java-concurrency-basic-2/.../waitandnotify/Data.java`.

### Visibility, atomics, and lock-free

`volatile` provides a happens-before visibility guarantee but NOT atomicity — `count++` on a volatile field is still a lost-update race; pair it with `synchronized` or use an atomic. The `Atomic*` classes implement lock-free counters and structures via a CAS retry loop. `AtomicStampedReference` pairs a reference with a monotonically incremented stamp to defeat the ABA problem, where a plain value-only CAS silently accepts an A->B->A round-trip. Under high contention `LongAdder`/`LongAccumulator` stripe across internal cells and outperform `AtomicLong` (their `sum()` is not atomic with concurrent updates). Evidence: `core-java-concurrency-advanced/.../atomic/SafeCounterWithoutLock.java`, `core-java-concurrency-advanced-3/.../atomicstampedreference/StampedAccount.java`.

### Coordination

`CountDownLatch` is a one-shot gate (countDown/await); `CyclicBarrier` is reusable with an optional per-trip barrier action; `Phaser` is a reusable multi-phase barrier (register/arriveAndAwaitAdvance/getPhase); `Exchanger` is a two-thread rendezvous that swaps objects. To start N threads simultaneously, hold them on a `CountDownLatch(1)` and release, or trip a `CyclicBarrier(N)`.

### Anti-patterns

Synchronization footguns recur: locking on String literals/interned strings (shared JVM-wide via the string pool), boxed `Boolean` or cached `Integer` (-128..127), or `this`/any publicly-reachable object — any of which lets unrelated code contend on your lock. The fix is a dedicated `private final Object` lock per guarded field. The `this`-escape bug publishes a half-built object by starting a Thread inside a constructor. Deadlock (nested locks in opposite order; dining philosophers) contrasts with livelock (threads keep yielding without progress). `SimpleDateFormat` is mutable and not thread-safe — a shared static instance corrupts under concurrency (modern fix: immutable `DateTimeFormatter`). Local variables are inherently thread-safe (per stack frame); only shared fields race. Evidence: `core-java-concurrency-advanced-4/.../synchronizationbadpractices/AnimalSolution.java`.

### 2026 currency

- The entire primitive set is pure JDK and unchanged in 2026.
- The base's caveat "`synchronized` pins a virtual thread to its carrier, prefer `ReentrantLock`" holds for **JDK 21-23 only**. **JEP 491 (JDK 24)** associates the monitor with the virtual thread so blocking inside `synchronized` now unmounts the carrier — the `ReentrantLock` workaround is no longer necessary for pinning reasons. [JEP 491: Synchronize Virtual Threads without Pinning](https://openjdk.org/jeps/491)
- **Scoped values — FINAL in JDK 25 (JEP 506)** are the immutable, lexically-scoped successor to `ThreadLocal` for per-task context in virtual-thread code: `ScopedValue.where(KEY, val).run(lambda)`, fixing ThreadLocal's mutability and poor virtual-thread scaling. [JEP 506: Scoped Values](https://openjdk.org/jeps/506)
- The canonical pitfalls (lost update, ABA, this-escape, deadlock/livelock, `SimpleDateFormat`, lock-target anti-patterns) are timeless and carry forward unchanged.
