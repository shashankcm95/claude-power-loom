---
kb_id: reactive/lmax-disruptor
version: 1
tags:
  - reactive
  - disruptor
  - concurrency
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: disruptor"
  - "endoflife.date — Eclipse Temurin (endoflife.date/eclipse-temurin)"
related:
  - reactive/jvm-async-alternatives
status: active
---

## Summary

**Concept**: The LMAX Disruptor is a lock-free inter-thread messaging library built on a pre-allocated ring buffer — mechanical-sympathy concurrency, in the async lane but NOT Reactive Streams (no backpressure contract).
**Key APIs**: `Disruptor<>(EventFactory, bufferSize, ThreadFactory, ProducerType, WaitStrategy)`; `RingBuffer` publish protocol `next()` → `get(seq)` → mutate → `publish(seq)`; `EventHandler(event, seq, endOfBatch)`; `BusySpinWaitStrategy`.
**Gotcha**: event slots are reused in place — retaining a reference sees it overwritten (copy out fields); multiple `EventHandler`s = broadcast (each gets every event), NOT a work pool.
**2026-currency**: Disruptor is alive; **4.x** drops the deprecated DSL/`ProducerType` constructor flavor shown here, but ring-buffer/EventHandler concepts hold; Java LTS is now 25.
**Sources**: Baeldung `disruptor` module; endoflife.date Eclipse Temurin.

## Quick Reference

**Construction**:
```java
Disruptor<ValueEvent> disruptor = new Disruptor<>(
    EVENT_FACTORY, bufferSize, DaemonThreadFactory.INSTANCE,
    ProducerType.SINGLE,   // or MULTI
    new BusySpinWaitStrategy());
disruptor.handleEventsWith(handler1, handler2);
RingBuffer<ValueEvent> ringBuffer = disruptor.start();
```

**Event pre-allocation** (GC avoidance): `EventFactory = () -> new ValueEvent()` — the ring buffer allocates all slots up front; producers mutate the existing slot in place rather than allocating per event.

**Publish protocol** (claim → fill → publish):
```java
long seq = ringBuffer.next();        // claim a slot
ValueEvent e = ringBuffer.get(seq);  // get the (reused) slot
e.setValue(...);                      // mutate in place
ringBuffer.publish(seq);              // make it visible to consumers
```

**Consumers**: `EventHandler<T>` with `onEvent(event, sequence, endOfBatch)`.

**Wait strategies**: `BusySpinWaitStrategy` = lowest latency, highest CPU; others trade latency for CPU.

**Producer types**: `ProducerType.SINGLE` (one producer) / `MULTI` (concurrent producers).

**Top gotchas**:
- **Event slots are reused** — retaining a reference to the `event` object sees it overwritten by a later publish; copy out the fields you need.
- **Multiple `EventHandler`s = broadcast** — each handler receives every event (a parallel pipeline / fan-out), NOT a work-sharing pool.
- The ring buffer size must be a power of two.

**Current (mid-2026)**: the Disruptor library is alive. Disruptor **4.x** drops the deprecated DSL / `ProducerType`-constructor flavor shown in the corpus, but the core ring-buffer / `EventFactory` / `EventHandler` concepts hold. It sits beside (not inside) the Reactive Streams family — no `request(n)` backpressure contract.

## Full content

The LMAX Disruptor is a high-performance, lock-free library for passing messages between threads, originating from the LMAX exchange. It is an outlier in the reactive/async lane: it is about mechanical sympathy (cache-line awareness, GC avoidance, lock-free coordination) rather than the Reactive Streams demand-driven contract. The Baeldung `disruptor` module demonstrates the ring buffer across four producer×consumer permutations (`DisruptorIntegrationTest.java`).

### The ring buffer

At the core is a pre-allocated **ring buffer** sized to a power of two. Because all slots are allocated up front via an `EventFactory` (`() -> new ValueEvent()`), the hot path never allocates — producers reuse the existing slot objects in place, eliminating per-message GC pressure. This in-place reuse is the source of the most common bug: any reference you keep to an `event` object will be overwritten when that slot cycles around, so consumers must copy out the fields they need.

### Publish protocol

Publishing follows a three-step claim/fill/publish protocol: `ringBuffer.next()` claims the next sequence, `ringBuffer.get(seq)` returns the (reused) slot, the producer mutates it, and `ringBuffer.publish(seq)` makes it visible to consumers. This separation lets the framework coordinate sequences lock-free.

### Consumers, producers, wait strategies

Consumers implement `EventHandler<T>` with `onEvent(event, sequence, endOfBatch)` (the `endOfBatch` flag enables batch-aware processing). Construction declares the `ProducerType` (`SINGLE` for one producer, `MULTI` for concurrent producers) and a `WaitStrategy` — `BusySpinWaitStrategy` gives the lowest latency at the cost of pegging a CPU core; gentler strategies trade latency for CPU. A critical semantic: registering multiple `EventHandler`s via `handleEventsWith(...)` **broadcasts** — every handler sees every event (a parallel fan-out pipeline), which is not the same as a work-sharing pool where each event goes to exactly one worker.

### 2026 currency

- **The Disruptor library is alive.** Disruptor **4.x** drops the deprecated DSL / `ProducerType`-constructor flavor shown here, but the ring-buffer / `EventFactory` / `EventHandler` concepts hold; the corpus pins disruptor 3.3.6. [endoflife.date — Eclipse Temurin](https://endoflife.date/eclipse-temurin)
- **It is async but not Reactive Streams.** The Disruptor has no `request(n)` backpressure contract — it bounds via the ring-buffer capacity and wait strategy instead. Treat it as a mechanical-sympathy concurrency tool adjacent to, not part of, the reactive family. [endoflife.date — Eclipse Temurin](https://endoflife.date/eclipse-temurin)
- **JVM context has moved.** Java LTS cadence is now 17 (2021), 21 (2023), 25 (2025); Java 25 is the newest LTS — and Virtual Threads (Java 21) are now the simpler default for many thread-coordination problems that previously reached for low-level lock-free tools. [endoflife.date — Eclipse Temurin](https://endoflife.date/eclipse-temurin) · [JEP 444: Virtual Threads](https://openjdk.org/jeps/444)
