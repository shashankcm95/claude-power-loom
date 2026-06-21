---
kb_id: java-libraries/code-generation
version: 1
tags:
  - java-libraries
  - code-generation
  - bytecode
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: lombok, lombok-custom, libraries-6 (javapoet/reflections), libraries (javassist), libraries-5 (bytebuddy), libraries-3 (classgraph/nullaway), guice, dagger"
  - "Lombok Changelog (projectlombok.org/changelog)"
related:
  - java-libraries/bean-mapping
status: active
---

## Summary

**Concept**: compile-time + runtime code/bytecode generation and DI — Lombok (annotation processor), JavaPoet (source codegen), Javassist/Byte Buddy/cglib (bytecode), Classgraph/Reflections (classpath scanning), and DI cores Guice (runtime) + Dagger 2 (compile-time).
**Key APIs**: Lombok `@Data`/`@Builder`/`@SuperBuilder`/`@Singular`/`@Builder.Default`/`@Slf4j`; JavaPoet `TypeSpec`/`MethodSpec` (`$L`/`$S`/`$T`/`$N`); Byte Buddy `new ByteBuddy().subclass(..).intercept(..)`; Guice `Guice.createInjector`/`AbstractModule`; Dagger `@Inject`/`@Module`/`@Provides`/`@Component`.
**Gotcha**: Lombok `@SuperBuilder` is NOT mixable with `@Builder` for inheritance; `@Builder.Default` needed to preserve field initializers; boolean getter naming (`isRunning` vs `getRunning`); annotation processors are INERT until you build (IDE shows "cannot resolve symbol"); lombok-custom broke on JDK 9+ (`tools.jar` removed).
**2026-currency**: Lombok 1.18.46 (JDK 25 support in 1.18.40); compile-time processors (Lombok/Dagger/MapStruct) are GraalVM-native-friendly, runtime-reflection libs (Javassist/cglib/Byte Buddy/Reflections) are native-hostile.
**Sources**: Baeldung `lombok`/`libraries-*`/`guice`/`dagger` modules.

## Quick Reference

**Compile-time annotation processors (native-image friendly):**

- **Lombok** — `@Getter`/`@Setter`/`@Data`/`@Value`/`@Builder`/`@SuperBuilder`/`@Singular`/`@Accessors`/`@Delegate`/`@Slf4j`/`@SneakyThrows`.
  - `@SuperBuilder` for inheritance — **NOT** mixable with `@Builder`.
  - `@Builder.Default` to preserve field initializers (the default-value trap).
  - boolean getter naming: `boolean running` → `isRunning()`; `Boolean running` → `getRunning()`.
- **Dagger 2** — compile-time DI (see below).

**Source codegen:** **JavaPoet** — `TypeSpec`/`MethodSpec`/`FieldSpec` with `$L` (literal) / `$S` (string) / `$T` (type) / `$N` (name) placeholders, emit `JavaFile`.

**Bytecode manipulation (runtime):**

- **Javassist** — `ClassPool`/`ClassFile`/`Bytecode` (build/traverse/inject).
- **Byte Buddy** — `new ByteBuddy().subclass(..).method(ElementMatchers..).intercept(FixedValue/MethodDelegation)`; `redefine`/`rebase` via `ByteBuddyAgent`.
- **cglib** — proxy/mixin.

**Classpath scanning:** **Classgraph** (`new ClassGraph().enableAllInfo().scan()` → `getClassesWithAnnotation`); **Reflections** (`SubTypesScanner`/`MethodAnnotationsScanner`, renamed `Scanners.*` in 0.10.x). **Static analysis:** **NullAway** (Error-Prone null checker, `@Nullable`).

**DI cores:**

```java
// Guice (runtime reflection)
Injector inj = Guice.createInjector(new AbstractModule() {
    protected void configure() { bind(Service.class).to(ServiceImpl.class); }
    @Provides Brand provideBrand() { return new Brand(); }
});
inj.getInstance(Car.class);

// Dagger 2 (compile-time, no runtime reflection)
@Inject Car(Engine e, Brand b) {}
@Module class M { @Provides @Singleton Brand provideBrand() {...} }
@Component(modules = M.class) interface C { Car build(); }
DaggerC.create().build();   // unscoped → new each build; @Singleton → shared
```

**Top gotchas:**

- Annotation processors / AspectJ weaving (Dagger/MapStruct/Lombok/jcabi-aspects/NullAway) are **inert until you build** — IDE shows "cannot resolve symbol".
- Log4j2 custom plugins need `packages="..."` scanning or the plugin cache.
- **lombok-custom** (writing your own handler via javac/Eclipse SPI) broke on **JDK 9+** (`tools.jar` + `com.sun.tools.javac.*` removed).

**Current (mid-2026):** Lombok **1.18.46** (JDK 24 in 1.18.38, JDK 25 in 1.18.40). Compile-time processors (Lombok/Dagger/MapStruct) are **GraalVM-native-friendly**; reflection/bytecode libs (Javassist/cglib/Byte Buddy/Reflections/Classgraph) are native-**hostile** (need reachability metadata).

## Full content

This atom spans the libraries that *write or rewrite code* — at compile time (annotation processors, source generators) and at runtime (bytecode manipulation) — plus the dependency-injection cores that lean on those mechanisms. **Lombok** is the ubiquitous compile-time annotation processor: it generates getters/setters, `equals`/`hashCode`, builders, and more from annotations (`@Data`, `@Value`, `@Builder`, `@SuperBuilder`, `@Singular`, `@Slf4j`). Its traps are well-known: `@SuperBuilder` (for inheritance) cannot be mixed with `@Builder`; `@Builder.Default` is required to preserve a field's initializer when a builder is used; and the boolean getter naming differs by box-ness (`boolean running` yields `isRunning()`, `Boolean running` yields `getRunning()`). **JavaPoet** generates *source* (not bytecode): you compose `TypeSpec`/`MethodSpec`/`FieldSpec` with format placeholders (`$L` literal, `$S` string, `$T` type, `$N` name) and emit a `JavaFile`.

Runtime bytecode manipulation has three libraries: **Javassist** (the low-level `ClassPool`/`ClassFile`/`Bytecode` API to build, traverse, and inject), **Byte Buddy** (a fluent DSL — `new ByteBuddy().subclass(..).method(ElementMatchers..).intercept(FixedValue/MethodDelegation)`, plus `redefine`/`rebase` via a `ByteBuddyAgent`), and **cglib** (proxy/mixin generation). Classpath scanning is covered by **Classgraph** (`new ClassGraph().enableAllInfo().scan()`) and **Reflections** (scanner-based, with the `Scanners.*` rename in 0.10.x), and compile-time null checking by **NullAway** (an Error-Prone plugin using `@Nullable`).

The two DI cores contrast on mechanism. **Guice** uses runtime reflection: `Guice.createInjector(Module..)` builds an `Injector`, and an `AbstractModule.configure()` binding DSL (`bind().to()`, `toInstance`, `toProvider`, `annotatedWith(Names.named(..))`, `asEagerSingleton`) plus `@Provides` factory methods declare the graph; it also offers AOP via `bindInterceptor` + AOP-Alliance `MethodInterceptor`. **Dagger 2** is compile-time DI (an annotation processor, no runtime reflection): `@Inject` constructors, `@Module`+`@Provides` factories, and a `@Component` interface that generates `Dagger<Name>`. Scoping is the teaching point — unscoped bindings produce a new instance per `build()`, while `@Singleton` shares one. The unifying caveat across all of these: annotation processing and AspectJ weaving are *invisible build steps* — until you actually build, the IDE shows unresolved symbols and the generated/woven behavior is absent.

### 2026 currency

- **Lombok 1.18.46** — JDK 24 support landed in 1.18.38 (Mar 2025), JDK 25 in 1.18.40 (Sep 2025). [Lombok Changelog](https://projectlombok.org/changelog)
- **GraalVM native image** is now a mainstream deployment target, and it splits this cluster sharply: compile-time processors (**MapStruct, Dagger, Lombok**) are native-friendly, while reflection/bytecode libraries (**Javassist, cglib, Byte Buddy, Reflections, Classgraph**) are native-hostile and require GraalVM Reachability Metadata to work under native-image. [GraalVM Reachability Metadata (graalvm.org)](https://www.graalvm.org/latest/reference-manual/native-image/metadata/)
- **lombok-custom** (custom Lombok handlers via the javac/Eclipse SPI) is broken on JDK 9+ because `tools.jar` and `com.sun.tools.javac.*` were removed in JDK 9 — that example does not survive a modern JDK.
- Byte Buddy, Classgraph, and JavaPoet are API-stable and safe to seed (bump versions).
