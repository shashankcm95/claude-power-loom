---
kb_id: java-runtime/native-interop-extensibility
version: 1
tags:
  - java-runtime
  - native-interop
  - extensibility
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: java-native, java-rmi, java-spi, osgi"
  - "JEP 454: Foreign Function & Memory API (openjdk.org/jeps/454); JEP 472: Prepare to Restrict the Use of JNI"
related:
  - java-runtime/jvm-tooling
status: active
---

## Summary

**Concept**: JVM integration and extensibility — native interop (JNI/JNA), remote method invocation (RMI), service discovery (SPI/`ServiceLoader`), and dynamic modules (OSGi).
**Key APIs**: JNI (`native` methods + `System.loadLibrary`, `JNIEnv*`), JNA (`interface extends Library`, `Native.load`, `Structure`), RMI (`Remote`/`UnicastRemoteObject.exportObject`/`LocateRegistry`), `ServiceLoader.load` + `META-INF/services`, OSGi (`BundleActivator`/`BundleContext`/`ServiceListener`).
**Gotcha**: the corpus's native interop is JNI/JNA-only (no Panama); RMI's `Serializable` DTO wire is a deserialization surface; the SPI default-provider example has a wrong package and always throws.
**2026-currency**: FFM API (JEP 454, JDK 22) is the canonical successor to BOTH JNI and JNA; JNI use is being restricted (JEP 472, JDK 24).
**Sources**: Baeldung `java-native`/`java-rmi`/`java-spi`/`osgi`; JEP 454/472.

## Quick Reference

**Native interop**:
- **JNI** (hand-written C/C++ glue): `native` methods + `System.loadLibrary("native")` in a static block; generate the header via `javac -h`; implement against `JNIEnv*` (`NewStringUTF`/`FindClass`/`GetFieldID`/`GetMethodID`/`CallObjectMethod`).
- **JNA** (no glue): declare a Java `interface extends Library`, `CMath INSTANCE = Native.load(...)`; `Pointer`/`malloc`/`free`, `Structure`+`@FieldOrder`, `NativeLong`, `FunctionMapper` to rename symbols, `LastErrorException`.
- Arch detection: `sun.arch.data.model`, `Native.POINTER_SIZE`, `Platform.is64Bit()`.

**RMI**: a `Remote` interface (methods `throws RemoteException`) + impl; export the stub via `UnicastRemoteObject.exportObject(this, 0)`; the registry is `LocateRegistry.createRegistry(1099)` + `rebind(name, stub)`/`lookup(name)`; `Serializable` DTOs travel over the wire.

**SPI / `ServiceLoader`**: decouple a service interface from impls discovered at runtime. Register a provider via `META-INF/services/<interface-FQN>` whose single line is the impl FQN; `ServiceLoader.load(iface)` is lazy/iterator-based. JPMS adds `provides...with`/`uses` directives as an alternative.

**OSGi**: dynamic modular services. A bundle has a `BundleActivator` (`start`/`stop`); register a service into the `BundleContext` registry (`context.registerService(Greeter.class, impl, props)`); consume dynamically via a `ServiceListener` (`ServiceEvent.REGISTERED`/`UNREGISTERING`); the `Export-Package`/`Private-Package` manifest contract; built with `maven-bundle-plugin`.

**Top gotchas**: JNI/JNA-only (no FFM); RMI wire DTOs are a deserialization-RCE surface; the corpus SPI `DEFAULT_PROVIDER` constant has the wrong package (`...spi` instead of `...impl`) so the no-arg default lookup always throws.

**Current (mid-2026)**: the **FFM API** (`java.lang.foreign`, JEP 454, JDK 22) is the canonical successor to BOTH JNI and JNA. **JNI is being restricted** (JEP 472, JDK 24 — warns by default; gate behind `--enable-native-access`). RMI is largely superseded by gRPC/REST/messaging.

## Full content

This atom is the JVM's integration and extensibility layer: calling native code, invoking remote methods, discovering service implementations, and loading modular services dynamically. Each is covered by a standalone Baeldung module.

### Native interop

Two approaches are taught. **JNI** requires hand-written C/C++ glue: declare `native` methods, load the library with `System.loadLibrary("native")` in a static block, generate a header with `javac -h`, and implement the functions against the `JNIEnv*` API (`NewStringUTF`, `FindClass`, `AllocObject`, `GetFieldID`/`GetMethodID`, `CallObjectMethod`). Evidence: `java-native/.../jni/HelloWorldJNI.java:5-7`. **JNA** removes the glue: declare a Java `interface extends Library` and bind it with `Native.load(...)`, then use `Pointer`/`malloc`/`free`, `Structure`+`@FieldOrder`, `NativeLong`, a `FunctionMapper` to rename symbols, and `LastErrorException`. Evidence: `java-native/.../jna/CMath.java`. Bitness is detected via `sun.arch.data.model`, `Native.POINTER_SIZE`, or `Platform.is64Bit()`.

### RMI

Remote method invocation defines a `Remote` interface whose methods `throw RemoteException`, an implementation, and a stub exported with `UnicastRemoteObject.exportObject(this, 0)`. The naming service is the registry: `LocateRegistry.createRegistry(1099)` then `rebind(name, stub)`, with clients calling `lookup(name)`. `Serializable` DTOs travel over the wire — which makes RMI a deserialization-RCE surface in the same family as the `java.io` gadget chain. Evidence: `java-rmi/.../rmi/MessengerServiceImpl.java:20-25`.

### SPI / ServiceLoader

The Service Provider Interface decouples a service interface (in an `-api` module) from implementations discovered at runtime. A provider declares itself by placing a file at `META-INF/services/<fully-qualified-interface-name>` whose single line is the implementation's FQN; consumers call `ServiceLoader.load(iface)`, which lazily iterates the discovered providers. JPMS offers an alternative declaration with `provides ... with` and `uses` directives in `module-info.java`. Evidence: `java-spi/exchange-rate-impl/.../META-INF/services/com.baeldung.rate.spi.ExchangeRateProvider`. (A real corpus bug: the `DEFAULT_PROVIDER` constant points at the wrong package, so the no-arg default lookup always throws.)

### OSGi

OSGi provides dynamic modular services. Each bundle ships a `BundleActivator` with `start`/`stop`; a service self-registers into the `BundleContext` registry (`context.registerService(Greeter.class, impl, props)`); a consumer binds dynamically by adding a `ServiceListener` filtered on `(objectclass=...)` and reacting to `ServiceEvent.REGISTERED`/`UNREGISTERING`. The `Export-Package`/`Private-Package` manifest declares the module contract, generated by the `maven-bundle-plugin`. Evidence: `osgi/osgi-intro-sample-service/.../GreeterImpl.java`, `osgi/osgi-intro-sample-client/.../Client.java`.

### 2026 currency

- **Foreign Function & Memory (FFM) API — FINAL in JDK 22 (JEP 454).** `java.lang.foreign` (`Linker`, `SymbolLookup`, `MemorySegment`, `Arena`, `FunctionDescriptor`) is the canonical successor to BOTH hand-written JNI and JNA, with downcalls/upcalls and safe off-heap memory. New native-interop code should target FFM. [JEP 454: Foreign Function & Memory API](https://openjdk.org/jeps/454)
- **JNI is being restricted (JEP 472, JDK 24)** — JNI load/link warns at runtime by default, and both JNI and FFM gate behind `--enable-native-access=<modules>|ALL-UNNAMED` with `--illegal-native-access=warn|deny` (warn is the JDK 24 default, deny is the future). [JEP 472: Prepare to Restrict the Use of JNI](https://openjdk.org/jeps/472)
- **RMI is legacy** — superseded by gRPC/REST/messaging for new remote-invocation work; its `Serializable` wire format is a known deserialization-RCE surface.
- **SPI moved namespaces where EE-derived**: the `java-spi` module's JSON-B (`javax.json.bind`/`javax.json`) usage is now `jakarta.*`; the Yahoo Finance endpoint it called is dead. The `ServiceLoader`/`META-INF/services` mechanism itself is current, with JPMS `provides...with`/`uses` as the modular alternative.
- **OSGi modernized** — the corpus's imperative `BundleActivator` style and `org.osgi.core` 6.0.0 + `maven-bundle-plugin` 3.3.0 are superseded by bnd tooling and Declarative Services (DS) annotations. (Per OSGi tooling history.)
