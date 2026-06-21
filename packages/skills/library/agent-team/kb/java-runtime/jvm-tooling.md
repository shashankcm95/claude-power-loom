---
kb_id: java-runtime/jvm-tooling
version: 1
tags:
  - java-runtime
  - jvm
  - observability
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: core-java-jvm, core-java-jvm-2, core-java-perf, java-jdi"
  - "JEP 439: Generational ZGC (openjdk.org/jeps/439); JEP 474: ZGC Generational Mode by Default"
related:
  - java-runtime/native-interop-extensibility
status: active
---

## Summary

**Concept**: JVM internals, tooling, and debugging — instrumentation/Java agents, class loaders, bytecode tooling, memory layout (JOL), profiling/GC/JMX/JFR, and the JDI programmatic debugger.
**Key APIs**: `java.lang.instrument.Instrumentation` (`premain`/`agentmain`, `ClassFileTransformer`), `ClassLoader` (`findClass`/`defineClass`), JOL `ClassLayout`/`GraphLayout`, `ThreadMXBean`/`HotSpotDiagnosticMXBean`, JMX `*MBean`/`ObjectName`, JDI `VirtualMachine`/`BreakpointRequest`.
**Gotcha**: `System.exit()` runs shutdown hooks vs `Runtime.halt()` bypasses them; `System.gc()` is advisory; `tools.jar` removed in JDK 9 makes the JDI example JDK-8-only as configured.
**2026-currency**: unified GC logging (`-Xlog:gc*`) since JDK 9; Generational ZGC default in JDK 23; internal APIs moved to `jdk.*` modules.
**Sources**: Baeldung `core-java-jvm`/`-jvm-2`/`-perf` + `java-jdi`; JEP 439/474.

## Quick Reference

**Instrumentation / Java agents**: `java.lang.instrument.Instrumentation`; `premain` (`-javaagent`) or `agentmain` (dynamic attach via `com.sun.tools.attach.VirtualMachine`); a `ClassFileTransformer` rewrites bytecode (e.g. Javassist `insertBefore`/`insertAfter` to wrap a method with timing); `getObjectSize`, `getAllLoadedClasses`/`getInitiatedClasses`.

**Class loaders**: bootstrap / extension(platform) / system hierarchy with parent delegation; a custom `ClassLoader` overrides `findClass` and calls `defineClass(name, bytes, 0, len)`. Bytecode viewing: ASM (`ClassReader`+`TraceClassVisitor`), BCEL (`Repository.lookupClass`), Javassist (`getClassFile`).

**JIT / exit / GC**: method inlining (`-XX:MaxInlineSize`/`FreqInlineSize`, warm with a tight loop); branch prediction (sorted vs shuffled array timing); `System.exit()` (runs shutdown hooks/finalizers) vs `Runtime.halt()` (forcible, bypasses hooks); `System.gc()` is advisory; `addShutdownHook`.

**Memory layout (JOL)**: `ClassLayout.parseClass(X.class).toPrintable()` (shallow) and `GraphLayout.parseInstance(o).totalSize()` (deep/retained). Object header = mark word + klass pointer; field packing/alignment/padding to 8 bytes; compressed oops; `boolean` = 1 byte; array length in header; `@Contended` false-sharing padding.

**Profiling**: verbose GC logging; heap dumps via `HotSpotDiagnosticMXBean.dumpHeap(path, live)`; thread dumps via `ThreadMXBean.dumpAllThreads`; JMX (define a `*MBean` interface + impl, register under an `ObjectName`, inspect in JConsole); Java Flight Recorder (`-XX:StartFlightRecording`). Memory-leak taxonomy: static collections, unclosed resources, bad `equals`/`hashCode`, inner-class outer refs, `finalize()`, `String.intern()`.

**JDI (programmatic debugger on JPDA)**: `LaunchingConnector` -> `VirtualMachine`; `ClassPrepareRequest`/`BreakpointRequest`/`StepRequest`; the `eventQueue().remove()` loop; inspect a `StackFrame`'s locals at a breakpoint; single-step (`STEP_LINE`/`STEP_OVER`).

**Current (mid-2026)**: unified `-Xlog:gc*` is the GC-logging idiom (legacy `-XX:+PrintGCDetails` removed). Generational ZGC is default in JDK 23. `com.sun.tools.attach` -> `jdk.attach`, `sun.misc.Contended` -> `jdk.internal.vm.annotation.Contended`; `tools.jar` removed in JDK 9 (JDI now in the `jdk.jdi` module).

## Full content

This atom covers the JVM's introspection, instrumentation, profiling, and debugging surface — well represented in the corpus across `core-java-jvm`, `core-java-jvm-2`, `core-java-perf`, and the standalone `java-jdi`.

### Instrumentation and class loading

A Java agent hooks the JVM via `java.lang.instrument.Instrumentation`, entered through `premain` (when launched with `-javaagent`) or `agentmain` (when dynamically attached via `com.sun.tools.attach.VirtualMachine`). The agent registers a `ClassFileTransformer` to rewrite bytecode as classes load — the corpus wraps a method with timing using Javassist `insertBefore`/`insertAfter`. `Instrumentation` also offers `getObjectSize` and `getAllLoadedClasses`/`getInitiatedClasses`. Evidence: `core-java-jvm/.../instrumentation/agent/AtmTransformer.java:44-66`. Class loading follows the bootstrap/extension(platform)/system hierarchy with parent delegation; a custom loader overrides `findClass` and calls `defineClass(name, bytes, 0, len)` on bytes read from a resource. Evidence: `core-java-jvm/.../classloader/CustomClassLoader.java`. Bytecode is viewable with ASM, BCEL, or Javassist.

### JIT, exit, and GC control

JIT behavior is observed by warming a tight loop to trigger C2 method inlining (`-XX:MaxInlineSize`/`FreqInlineSize`) and by timing sorted vs shuffled arrays to expose branch prediction. Process termination distinguishes `System.exit()` (which runs shutdown hooks and finalizers) from `Runtime.halt()` (forcible, bypassing hooks); `System.gc()` is only advisory; `addShutdownHook` registers cleanup. Many of these examples are observational (they require specific JVM flags or reading stdout and assert nothing).

### Memory layout

JOL inspects object layout: `ClassLayout.parseClass(X.class).toPrintable()` shows the shallow layout (mark word + klass pointer header, field packing, 8-byte alignment/padding, compressed oops), and `GraphLayout.parseInstance(o).totalSize()` computes deep/retained size. The corpus demonstrates that a `boolean` occupies 1 byte (not 1 bit), array length lives in the header, an object's address (`VM.addressOf`) moves under GC, and `@Contended` pads to avoid false sharing. Evidence: `core-java-jvm-2/.../memlayout/MemoryLayoutUnitTest.java`.

### Profiling and JMX

Production diagnostics: heap dumps via a `HotSpotDiagnosticMXBean` proxy `.dumpHeap(path, live)`, thread dumps via `ThreadMXBean.dumpAllThreads`, verbose GC logging, OOM reproducers (GC-overhead-limit, unable-to-create-native-thread cured by a bounded pool), and JMX — define a `*MBean` interface plus an implementation, register it under an `ObjectName`, and inspect it in JConsole. Java Flight Recorder starts with `-XX:StartFlightRecording`. The memory-leak taxonomy enumerates static collections, unclosed resources, broken `equals`/`hashCode`, inner-class outer references, `finalize()`, and `String.intern()`. Evidence: `core-java-perf/.../heapdump/HeapDump.java`, `core-java-perf/.../jmx/{Game,GameMBean,JMXTutorialMainlauncher}.java`.

### JDI

The Java Debug Interface is a programmatic debugger on the JPDA: a `LaunchingConnector` produces a `VirtualMachine`; you set a `ClassPrepareRequest`, resolve `locationsOfLine`, set a `BreakpointRequest`, drive the `eventQueue().remove()` loop, inspect `frame(0)` locals at the breakpoint, and single-step with a `StepRequest` (`STEP_LINE`/`STEP_OVER`). Evidence: `java-jdi/.../jdi/JDIExampleDebugger.java`. Note this module depends on `tools.jar` and is JDK-8-only as configured.

### 2026 currency

- **GC logging confirmed durable**: unified `-Xlog:gc*` has been the idiom since JDK 9 and the legacy `-XX:+PrintGCDetails`/`-Xloggc` flags are removed.
- **Generational ZGC** — introduced in **JDK 21 (JEP 439)**, made **default in JDK 23 (JEP 474)**, with non-generational mode removed (JEP 490) — is the modern low-latency GC, entirely absent from the corpus's G1-era tuning. [JEP 439: Generational ZGC](https://openjdk.org/jeps/439) · [JEP 474: ZGC Generational Mode by Default](https://openjdk.org/jeps/474) · [JEP 490: ZGC Remove Non-Generational Mode](https://openjdk.org/jeps/490)
- **Internal-API moves**: `com.sun.tools.attach` -> the `jdk.attach` module, `sun.misc.Contended` -> `jdk.internal.vm.annotation.Contended`, `com.sun.javafx.util.Logging` is dead without JavaFX, and `tools.jar` was removed in JDK 9 with JDI relocated to the `jdk.jdi` module (so the `java-jdi` example needs rework for modern JDKs). (Stated from canonical JPMS history.)
- **`finalize()` deprecated for removal (JEP 421, JDK 18)** — relevant to the memory-leak taxonomy's `finalize()` entry; migrate to `Cleaner`. [JEP 421: Deprecate Finalization for Removal](https://openjdk.org/jeps/421)
