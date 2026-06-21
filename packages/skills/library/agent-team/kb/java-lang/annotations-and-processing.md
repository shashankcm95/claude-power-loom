---
kb_id: java-lang/annotations-and-processing
version: 1
tags:
  - java-lang
  - annotations
  - metaprogramming
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-annotations"
  - "Baeldung tutorials (eugenp/tutorials) module: annotations (annotation-processing)"
  - "InfoQ: Java 23 delivers Markdown javadoc (JEP 467): https://www.infoq.com/news/2024/09/java23-released/"
related:
  - java-lang/reflection-and-proxies
status: active
---

## Summary

**Concept**: Built-in + meta-annotations, declaring `@interface`, runtime annotation processing (via reflection), and compile-time annotation processing (code generation).
**Key APIs**: `@Override`/`@SuppressWarnings`/`@SafeVarargs`/`@Deprecated`/`@FunctionalInterface`; meta `@Retention`/`@Target`/`@Inherited`/`@Documented`/`@Repeatable`; `AbstractProcessor.process(...)` + `@SupportedAnnotationTypes` + `Filer` + `Messager`; Google `@AutoService`.
**Gotcha**: only `@Retention(RUNTIME)` annotations are reflection-visible — SOURCE/CLASS are invisible at runtime. `@SafeVarargs` is legal only on `final`/`static`/`private` methods. A compile-time processor must live in a separately-compiled artifact.
**2026-currency**: `javax.annotation.Generated` removed from the JDK at Java 11 → `jakarta.annotation.Generated`; but `javax.annotation.processing` (JSR-269) is NOT a Jakarta casualty. Markdown javadoc `///` (JDK 23, JEP 467) is a net-new documentation surface.
**Sources**: `core-java-annotations`, `annotations`.

## Quick Reference

**Built-in annotations**: `@Override`, `@SuppressWarnings`, `@SafeVarargs` (only on `final`/`static`/`private` methods), `@Deprecated`, `@FunctionalInterface`.

**Meta-annotations**:
- `@Retention(SOURCE | CLASS | RUNTIME)` — **only RUNTIME is reflection-visible**
- `@Target(...)` — where the annotation may appear
- `@Inherited` — subclasses inherit a class-level annotation
- `@Documented` — appears in javadoc
- `@Repeatable(Container.class)` — apply the same annotation multiple times

**Declaring**: `@interface` with elements + `default` values.

**Runtime processing** (reflection-driven): read `@Retention(RUNTIME)` annotations off members and act on them — e.g. an annotation-driven object→JSON serializer reflecting on `@JsonSerializable`/`@JsonElement`/`@Init`.

**Compile-time processing** (code generation):

```java
@AutoService(Processor.class)
@SupportedAnnotationTypes("com.example.BuilderProperty")
@SupportedSourceVersion(SourceVersion.RELEASE_17)
public class BuilderProcessor extends AbstractProcessor {
    @Override public boolean process(Set<? extends TypeElement> a, RoundEnvironment env) {
        // use this.filer (emit source) and this.messager (compile errors)
    }
}
```

The `Filer` emits generated source; `Messager` reports compile errors; Google `@AutoService` registers the processor. The **processor must live in a separately-compiled artifact** from the code it processes.

**Top gotchas**:
- SOURCE/CLASS retention is invisible to runtime reflection — use RUNTIME for reflective processing.
- `@SafeVarargs` placement is restricted to `final`/`static`/`private` methods.
- `@Repeatable` requires a declared container annotation.

**Current (mid-2026)**: `javax.annotation.Generated` → `jakarta.annotation.Generated` (removed from the JDK at Java 11). `javax.annotation.processing` (JSR-269) stays in the JDK. Markdown javadoc `///` (JDK 23) is new.

## Full content

Annotations attach typed metadata to program elements. The **built-ins** include `@Override` (compiler-checked override), `@SuppressWarnings`, `@SafeVarargs` (legal only on `final`/`static`/`private` methods, where it documents that a generic-varargs method does not leak heap pollution), `@Deprecated`, and `@FunctionalInterface`. **Meta-annotations** configure custom annotations: `@Retention` controls lifetime — `SOURCE` (discarded after compile), `CLASS` (in the bytecode but not loaded), and `RUNTIME` (the **only** retention visible to reflection); `@Target` restricts where the annotation may appear; `@Inherited` propagates a class-level annotation to subclasses; `@Documented` includes it in javadoc; and `@Repeatable(Container.class)` permits multiple applications via a declared container. A custom annotation is declared with `@interface`, whose methods are its *elements* and may carry `default` values.

There are two processing models. **Runtime annotation processing** reads `@Retention(RUNTIME)` annotations off classes/fields/methods via reflection and acts on them — the canonical example being an annotation-driven object→JSON serializer that reflects on `@JsonSerializable`/`@JsonElement`/`@Init`. Because SOURCE/CLASS retention is invisible at runtime, only RUNTIME annotations are usable this way.

**Compile-time annotation processing** generates code during compilation. A processor extends `javax.annotation.processing.AbstractProcessor`, declares `@SupportedAnnotationTypes` and `@SupportedSourceVersion`, and overrides `process(...)`. Inside, the `Filer` emits new source files (the Baeldung example generates a fluent Builder), and the `Messager` reports compile-time errors. Google's `@AutoService(Processor.class)` registers the processor in the `META-INF/services` descriptor automatically. A hard constraint: the processor must live in a **separately-compiled artifact** from the code it processes, because it has to exist as compiled bytecode before that code is compiled.

Annotation processing is the entry point to the broader bytecode/compiler-internals world the base also samples (ASM, the javac `com.sun.source.util.Plugin`, ANTLR), but those are advanced and fragile; runtime + compile-time annotation processing are the stable, supported metaprogramming surfaces and pair with reflection (see `java-lang/reflection-and-proxies`).

### 2026 currency

**`javax.annotation.Generated` → `jakarta.annotation.Generated`.** `javax.annotation.Generated` was **removed from the JDK at Java 11**; the replacement is `jakarta.annotation.Generated` (or the `javax.annotation:javax.annotation-api` artifact). Critically, **`javax.annotation.processing` (JSR-269, the compiler annotation-processing API) is NOT a Jakarta casualty** — it remains in the JDK under `javax.*`, as does `javax.annotation.Nonnull` (JSR-305, a *separate, abandoned* JSR, not Jakarta-renamed). Avoid the false flag of renaming the processing API.

**Markdown documentation comments — final JDK 23 ([JEP 467](https://www.infoq.com/news/2024/09/java23-released/)).** Javadoc now supports `///` Markdown comments as an alternative to HTML-plus-`@`-tag comments — a net-new authoring surface for the documentation portion of this lane. The annotation model itself (retention, target, processing) is unchanged across modern JDKs; only the `javax.annotation.*` runtime annotations were affected by the Jakarta rename.
