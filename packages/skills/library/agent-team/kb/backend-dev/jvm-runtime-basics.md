---
kb_id: backend-dev/jvm-runtime-basics
version: 1
tags: [backend, jvm, java, gc, threading, starter]
---

## Summary

JVM runtime basics for HETS java-backend personas: heap is divided into young (eden + 2 survivor) + old generation; G1GC is the default GC for OpenJDK 9+; ZGC and Shenandoah for low-pause workloads; thread-per-request servers (Tomcat, Jetty) need bounded thread pools; virtual threads (JDK 21+) change the equation. Stub doc — expand on use.

## Full content (starter — expand when first persona uses)

### Heap structure

- **Young generation**: short-lived objects. Eden + 2 Survivor spaces.
- **Old generation**: objects that survived multiple young-gen GCs.
- **Metaspace** (off-heap): class metadata. Old PermGen replacement.

### Garbage collectors (pick one)

| GC | When to use | Pause profile |
|----|-------------|---------------|
| G1GC (default 9+) | General workloads, mid-large heaps | Predictable pauses |
| ZGC | Latency-sensitive, large heaps | Sub-millisecond pauses |
| Shenandoah | Latency-sensitive | Sub-millisecond pauses |
| Parallel | Throughput batch jobs | Long pauses, high throughput |
| Serial | Tiny heaps (<100 MB) | Long pauses, lowest overhead |

Tune via `-XX:+UseG1GC`, `-XX:MaxGCPauseMillis=200`, etc.

### Threading models

- **Platform threads** (default): expensive (~1 MB stack each). Use bounded pools (Tomcat: `server.tomcat.threads.max`).
- **Virtual threads** (JDK 21+): cheap (~kB each). Enable via `-Dspring.threads.virtual.enabled=true` in Spring Boot 3.2+.
- **Reactive (`Mono`/`Flux`)**: avoid blocking inside reactive chains; schedule blocking work on `Schedulers.boundedElastic()`.

### Memory observability

- Heap dumps: `jcmd <pid> GC.heap_dump <path>` or `-XX:+HeapDumpOnOutOfMemoryError`
- GC logs: `-Xlog:gc*:file=gc.log`
- Live profiling: async-profiler, JFR

### Common pitfalls

- Using `Thread.sleep()` inside a reactive chain (blocks the event loop)
- Unbounded thread pools (eventual OOM under load)
- Ignoring metaspace sizing for apps that load many classes dynamically
- `String.intern()` overuse (string pool growth)

### Related KB docs (planned)

- `kb:backend-dev/spring-boot-essentials`
- `kb:backend-dev/observability-jvm`
