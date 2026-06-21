---
kb_id: java-runtime/concurrent-collections
version: 1
tags:
  - java-runtime
  - concurrency
  - collections
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: core-java-concurrency-collections, core-java-concurrency-collections-2"
  - "JEP 444: Virtual Threads (javaalmanac.io/features/virtual-threads)"
related:
  - java-runtime/concurrency-primitives
  - java-runtime/executors-futures-async
status: active
---

## Summary

**Concept**: Thread-safe collections in `java.util.concurrent` — blocking queues, concurrent maps, copy-on-write lists — the concurrent counterparts of single-thread collections.
**Key APIs**: `LinkedBlockingQueue`/`ArrayBlockingQueue`/`PriorityBlockingQueue`/`DelayQueue`/`SynchronousQueue`/`TransferQueue`, `ConcurrentHashMap`/`ConcurrentSkipListMap`, `CopyOnWriteArrayList`, `ConcurrentLinkedQueue`; Guava `Striped` for lock striping.
**Gotcha**: `ConcurrentHashMap` rejects null keys AND values; `ConcurrentLinkedQueue.poll()` returns null on empty (non-blocking); `CopyOnWriteArrayList` copies the whole array per write.
**2026-currency**: pure JDK, unchanged; blocking-queue producer/consumer pools are increasingly replaced by virtual threads for blocking I/O.
**Sources**: Baeldung `core-java-concurrency-collections`/`-collections-2` modules.

## Quick Reference

**Blocking queues** (producer/consumer backbone):

| Queue | Behavior |
|---|---|
| `LinkedBlockingQueue` / `ArrayBlockingQueue` | `put`/`take` block when full/empty |
| `PriorityBlockingQueue` | orders elements on retrieval |
| `DelayQueue<E extends Delayed>` | element takeable only when `getDelay() <= 0` |
| `SynchronousQueue` | zero-capacity rendezvous; `size()` always 0 |
| `TransferQueue` / `LinkedTransferQueue` | `transfer` blocks until a consumer receives; `tryTransfer(timeout)` |

**Poison-pill shutdown**: a bounded `LinkedBlockingQueue` with one sentinel element per consumer. Custom `Delayed`: implement `getDelay(TimeUnit)` + `compareTo`.

**Blocking vs non-blocking**: `LinkedBlockingQueue.take()` blocks vs `ConcurrentLinkedQueue.poll()` (lock-free CAS) returns `null` immediately on empty — loop/`peek`, never assume an element.

**Concurrent maps**:
- `ConcurrentHashMap` — NO null keys/values; atomic compound ops `putIfAbsent`/`compute`/`computeIfAbsent`/`merge`; beats `Hashtable`/`synchronizedMap` under contention; a degenerate `hashCode()` degrades it >10x; `size()` mid-update is not a reliable snapshot.
- `ConcurrentSkipListMap`/`ConcurrentNavigableMap` — sorted, lock-free; `tailMap`/`headMap` time-window views.

**Copy-on-write**: `CopyOnWriteArrayList` snapshot iterators (mutations invisible to an existing iterator; iterator `remove()` throws); copies the whole array per mutation — bad for write-heavy use.

**Lock striping**: Guava `Striped<Lock>` partitions the key space into N locks so disjoint keys proceed concurrently (vs one global lock); benchmarked with JMH. Caveat: striping only works because keys are partitioned — it does not make a plain `HashMap` concurrent.

**Avoid `ConcurrentModificationException`**: `Iterator.remove()`, collect-then-`removeAll`, `removeIf`, or stream `filter`/`collect`.

**Current (mid-2026)**: the toolbox is pure JDK and unchanged. With virtual threads (JEP 444, JDK 21) the thread-per-task model means blocking-queue handoff between a fixed producer/consumer pool is less often the right shape for blocking I/O — but the collections themselves remain the canonical thread-safe choice.

## Full content

These are the concurrent counterparts of `java.util`'s single-thread collections (the L02 collections share the fail-fast-vs-weakly-consistent iterator story). The Baeldung `core-java-concurrency-collections` modules cover blocking queues, concurrent maps, and copy-on-write lists.

### Blocking queues

`LinkedBlockingQueue` and `ArrayBlockingQueue` are the producer/consumer backbone — `put` blocks when full, `take` blocks when empty. The canonical clean shutdown is the **poison pill**: enqueue one sentinel per consumer so each consumer terminates after draining real work. Evidence: `core-java-concurrency-collections/.../blockingqueue/BlockingQueueUsage.java`. Specialized variants: `PriorityBlockingQueue` orders on retrieval; `DelayQueue<E extends Delayed>` only releases an element once its `getDelay()` reaches zero (implement `getDelay(TimeUnit)` + `compareTo`, evidence `core-java-concurrency-collections/.../delayqueue/DelayObject.java`); `SynchronousQueue` is a zero-capacity rendezvous whose `size()` is always 0; `TransferQueue`/`LinkedTransferQueue` block the producer in `transfer` until a consumer receives (with a `tryTransfer(timeout)` variant). Contrast a blocking `LinkedBlockingQueue.take()` with a lock-free `ConcurrentLinkedQueue.poll()` that returns `null` on empty.

### Concurrent maps

`ConcurrentHashMap` is the workhorse: it rejects null keys AND values (unlike `HashMap`), offers atomic compound operations (`putIfAbsent`, the `compute*` family, `merge`), and outperforms the legacy `Hashtable`/`Collections.synchronizedMap` under contention. Two cautions: a degenerate `hashCode()` degrades it by more than 10x, and `size()` taken mid-update is not a reliable snapshot. `ConcurrentSkipListMap` (a `ConcurrentNavigableMap`) keeps keys sorted, lock-free, and supports `tailMap`/`headMap` time-window views.

### Copy-on-write and striping

`CopyOnWriteArrayList` gives snapshot iterators frozen at creation — concurrent mutations are invisible to an existing iterator and the iterator's `remove()` throws — at the cost of copying the entire backing array on every write, so it is appropriate only for read-mostly data. Lock striping (Guava `Striped<Lock>`) partitions the key space into N independent locks so operations on disjoint keys never contend; the corpus benchmarks `SingleLock` vs `StripedLock` with JMH. Evidence: `core-java-concurrency-collections-2/.../concurrent/lock/{ConcurrentAccessExperiment,SingleLock,StripedLock,ConcurrentAccessBenchmark}.java`. A subtle pitfall: striping only delivers concurrency because keys are partitioned — copying the technique onto a plain `HashMap` does not make it thread-safe.

### Avoiding ConcurrentModificationException

Mutating a collection while iterating it throws `ConcurrentModificationException`. The fixes are `Iterator.remove()`, collect-then-`removeAll`, `removeIf`, or a stream `filter`/`collect` pipeline that builds a new collection.

### 2026 currency

- The entire concurrent-collections toolbox is pure JDK and unchanged in 2026 — the recommended thread-safe collections remain `ConcurrentHashMap`, the blocking queues, and (for read-mostly data) `CopyOnWriteArrayList`.
- **Virtual threads (JEP 444, JDK 21)** shift the surrounding architecture: where the corpus pools a fixed set of producers/consumers around a blocking queue, blocking I/O is now often better expressed as one virtual thread per task. The queues remain valid as bounded back-pressure buffers and hand-off points. [JEP 444: Virtual Threads](https://javaalmanac.io/features/virtual-threads/)
