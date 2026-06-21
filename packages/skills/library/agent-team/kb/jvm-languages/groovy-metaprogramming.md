---
kb_id: jvm-languages/groovy-metaprogramming
version: 1
tags:
  - jvm-languages
  - groovy
  - metaprogramming
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: core-groovy-2"
  - "Groovy 5.0 release notes (https://groovy-lang.org/releasenotes/groovy-5.0.html)"
related:
  - jvm-languages/groovy-language-core
  - jvm-languages/groovy-collections
  - jvm-languages/groovy-sql-jdbc
  - jvm-languages/polyglot-scripting-interop
status: active
---

## Summary

**Concept**: Groovy's metaprogramming surface — runtime hooks, compile-time AST transforms, extension modules, categories, XML/JSON/template handling, and the 5 Java↔Groovy integration mechanisms.
**Key APIs**: `propertyMissing`/`methodMissing`, `metaClass`; `@Canonical`/`@TupleConstructor`/`@ToString`/`@Log`/`@TypeChecked` AST transforms; `use(Cat){}` categories + `@Category`; `XmlParser` vs `XmlSlurper`; `JsonSlurper.parseText(json) as Type`; `GroovyShell`/`GroovyClassLoader`/`GroovyScriptEngine`/JSR-223/joint-compilation.
**Gotcha**: dynamically loaded Groovy classes can't be cast to a Java type (classloader mismatch → `ClassCastException`) — use `invokeMethod`; `.class` on a Groovy `Map` is a KEY lookup, use `.getClass()`.
**2026-currency**: features unchanged through Groovy 5.0; XML/SQL/JSON are now split modules under `org.apache.groovy`.
**Sources**: `core-groovy-2` module; Groovy 5.0 release notes.

## Quick Reference

**Runtime metaprogramming**:

```groovy
def methodMissing(String name, args) { ... }   // dynamic method hook
def propertyMissing(String name) { ... }        // dynamic property hook
String.metaClass.shout = { -> delegate.toUpperCase() }  // add to JDK type
```

**Compile-time AST transforms** (POGO annotations): `@Canonical`, `@TupleConstructor`, `@EqualsAndHashCode`, `@ToString`, `@Log`, `@AutoClone`, `@TypeChecked` (+ `TypeCheckingMode.SKIP`).

**Extension modules**: static methods whose first arg is `self` extend a type at compile time, registered via `META-INF/services/org.codehaus.groovy.runtime.ExtensionModule`.

**Categories**: `use(Cat){ ... }` scopes added methods; built-ins `groovy.time.TimeCategory` (`2.weeks`, `5.days.from.now`), `groovy.xml.dom.DOMCategory`; custom via `static method(Type self, ...)` or `@Category(Type)` (where `this` is the receiver).

**5 Java↔Groovy integration mechanisms**: (1) static joint compilation (call the Groovy class directly); (2) `GroovyShell` + `Binding`; (3) `GroovyClassLoader.parseClass`; (4) `GroovyScriptEngine.loadScriptByName`; (5) JSR-223 `javax.script.ScriptEngine` via `GroovyScriptEngineFactory`. **Dynamically-loaded classes cannot be cast to a Java type** (different classloader → `ClassCastException`) — invoke via `invokeMethod`.

**XML**: `XmlParser` (mutable DOM `Node`, value via `.text()`) vs `XmlSlurper` (lazy `GPathResult`, value used directly); GPath navigation, `'@attr'`, mutation (`appendNode`/`replaceNode`/`NodeBuilder`); serialize via `XmlUtil.serialize`; build with `MarkupBuilder`.

**JSON**: `JsonSlurper.parseText(json) as Account` coerces to a typed object; `JsonParserType.INDEX_OVERLAY`; `JsonOutput.toJson` + `prettyPrint`.

**Templates**: `SimpleTemplateEngine`, `StreamingTemplateEngine` (>64k), `GStringTemplateEngine`, `XmlTemplateEngine`, `MarkupTemplateEngine`; all `engine.createTemplate(t).make(bindings)`.

**Type determination**: `instanceof`, `.getClass()`, `x in Type` (isCase) — **NOT `.class` on a Map** (it's a key lookup).

**Current (mid-2026)**: all of this carries forward to Groovy 5.0.6; `groovy-xml` / `groovy-json` / `groovy-sql` are now separate artifacts under `org.apache.groovy`. The extension-module service file path still uses the `org.codehaus.groovy.runtime.ExtensionModule` key.

## Full content

Groovy's metaprogramming spans runtime and compile time.

**Runtime metaprogramming** intercepts missing members via `methodMissing`/`propertyMissing` hooks, and lets you mutate the `metaClass` of any type — including JDK types like `String` — to add properties, methods, and constructors. Evidence: `metaprogramming/Employee.groovy:24-40`.

**Compile-time AST transforms** generate boilerplate on Plain Old Groovy Objects (POGOs): `@Canonical`, `@TupleConstructor`, `@EqualsAndHashCode`, `@ToString`, `@Log`, `@AutoClone`, and `@TypeChecked` (with `TypeCheckingMode.SKIP` escape hatch). Evidence: `metaprogramming/Employee.groovy:8-15`.

**Extension modules** add methods to a type at compile time: a static method whose first parameter is the receiver (`self`) becomes an instance method on that type, registered through a `META-INF/services/org.codehaus.groovy.runtime.ExtensionModule` descriptor. Evidence: `extension/BasicExtensions.groovy`.

**Categories** scope added methods to a `use(Cat){}` block. Built-ins include `groovy.time.TimeCategory` (enabling `2.weeks`, `5.days.from.now`) and `groovy.xml.dom.DOMCategory`. Custom categories are defined either as a plain class of `static method(Type self, ...)` methods or with `@Category(Type)` (inside which `this` is the receiver).

**Java↔Groovy integration** has five mechanisms (`MyJointCompilationApp.java:42-95`): static joint compilation, `GroovyShell`+`Binding`, `GroovyClassLoader.parseClass`, `GroovyScriptEngine.loadScriptByName`, and JSR-223 (`javax.script.ScriptEngine` via `GroovyScriptEngineFactory`). The recurring trap: a class loaded dynamically lives in a different classloader and cannot be cast to a Java interface/type (`ClassCastException`) — call its methods reflectively with `invokeMethod`.

**XML, JSON, and templates** round out the surface. `XmlParser` produces a mutable DOM whose values you read with `.text()`; `XmlSlurper` produces a lazy `GPathResult` whose values are used directly — mixing the two value-access styles breaks assertions, and `MarkupBuilder` output must be normalised via `XmlUtil.serialize` before comparison. `JsonSlurper.parseText(json) as Type` coerces JSON straight into a typed object. The template engines all follow `engine.createTemplate(t).make(bindings)`.

**Type determination** has a famous Groovy trap: `.class` on a `Map` is a *key lookup* (`ageMap.class` looks up the `"class"` key), not the runtime type — use `.getClass()`. Evidence: `determinedatatype/PersonTest.groovy:55-60`.

### 2026 currency

- **All metaprogramming features carry forward unchanged to Groovy 5.0.6** (2026-05-04, current stable). AST transforms, runtime `metaClass` manipulation, extension modules, and categories are stable. [Groovy 5.0 release notes](https://groovy-lang.org/releasenotes/groovy-5.0.html)
- **XML / JSON / SQL are now split modules** (`groovy-xml`, `groovy-json`, `groovy-sql`) under the `org.apache.groovy` groupId (the `org.codehaus.groovy` groupId was retired in Groovy 4). The extension-module service descriptor key is still `org.codehaus.groovy.runtime.ExtensionModule`. [endoflife.date/apache-groovy](https://endoflife.date/apache-groovy)
- **Spock 2.x on the JUnit 5 Platform** is the modern way to test Groovy metaprogramming, replacing the corpus's JUnit-4 / `GroovyTestCase` mix; Spock 2.4 (2025-12-11) ships per-Groovy artifacts (`-groovy-4.0`/`-groovy-5.0`). [Spock 2.4 release notes](https://spockframework.org/spock/docs/2.4/release_notes.html)
