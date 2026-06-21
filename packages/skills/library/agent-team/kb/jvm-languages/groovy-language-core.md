---
kb_id: jvm-languages/groovy-language-core
version: 1
tags:
  - jvm-languages
  - groovy
  - language-semantics
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: core-groovy"
  - "Baeldung tutorials (eugenp/tutorials) module: core-groovy-strings"
  - "Groovy 5.0 release notes (https://groovy-lang.org/releasenotes/groovy-5.0.html)"
related:
  - jvm-languages/groovy-collections
  - jvm-languages/groovy-metaprogramming
  - jvm-languages/groovy-sql-jdbc
status: active
---

## Summary

**Concept**: Groovy's dynamic-language core — closures, GString interpolation (eager vs lazy), string types, traits, script-binding scope, dynamic `def` typing.
**Key APIs**: `def x = { -> }` closures (`it` implicit param, `.call()`); `"$x"` eager vs `"${-> x}"` lazy GString; `trait` keyword; `as` runtime trait application; `as Integer` / `.toInteger()` conversions.
**Gotcha**: eager-vs-lazy GString is a real footgun; un-`def`'d script assignment leaks into the global binding; private trait methods are invisible to the implementer.
**2026-currency**: language semantics unchanged through Groovy 5.0; only groupId (`org.codehaus.groovy` → `org.apache.groovy`) and packaging changed in Groovy 4.
**Sources**: `core-groovy`, `core-groovy-strings` modules; Groovy 5.0 release notes.

## Quick Reference

**Closures** — first-class anonymous blocks:

```groovy
def greet = { name -> "Hi $name" }   // explicit param
def shout = { it.toUpperCase() }     // implicit single param `it`
greet('Sam'); greet.call('Sam')      // closure(args) == closure.call(args)
def sum = { int... args -> args.sum() }   // varargs
```

Closures are passed as method arguments (`volume(Closure, int...)`) and drive collection ops (`each`, `findAll`, `collect`).

**GString interpolation — eager vs lazy** (recurring footgun):

```groovy
def name = "A"
def eager = "$name"          // binds value at creation
def lazy  = "${-> name}"     // closure interpolation; evaluated on use
name = "B"
assert eager == "A"          // mutation NOT reflected
assert lazy.toString() == "B" // mutation IS reflected
```

**String types**: single-quote `'x'` = `java.lang.String` (no interpolation); double-quote `"x"` = GString; triple-quote = multiline; slashy `/.../` (regex-friendly, no `/`-escaping); dollar-slashy `$/.../$`. `char` has no literal — coerce via `'A' as char` or `(char)'C'`.

**Traits** — multiple behavior inheritance: `trait` keyword (abstract + concrete + private methods, properties, `implements` an interface); last-declared-wins on override; runtime application `new Dog() as AnimalTrait`. **Private trait methods are NOT callable on the implementer** (`MissingMethodException`).

**Script variable scope**: an undeclared assignment (`x = 200`) or an un-`def`'d assign inside a function leaks into the script **binding** (global); a `def` local stays local.

**String→int** (8+ idioms): `as Integer` / `as int`, `.toInteger()`, `Integer.parseInt` / `valueOf`, `DecimalFormat("#").parse(...).intValue()`; guard with `str?.isInteger()`. `null.toInteger()` throws NPE; `"123a" as Integer` throws `NumberFormatException`.

**Dynamic `def`**: an unassigned `def` is `NullObject` (`is(null)`); reassignable across types; a typed var throws `GroovyCastException` on bad assignment.

**Current (mid-2026)**: Groovy 5.0.6 is current stable (JDK 17+ to build, JDK 11 to run); 4.0 is in maintenance. All language features here are unchanged — only coordinates moved (`org.codehaus.groovy` → `org.apache.groovy`, split modules).

## Full content

Groovy layers dynamic-language ergonomics onto the JVM. The most distinctive and error-prone features are closures and GStrings.

**Closures** are reified blocks of code with their own scope. They can be invoked with `closure(args)` (sugar for `closure.call(args)`), accept explicit parameters (`{ name -> }`) or use the implicit single parameter `it`, and support varargs (`{ int... args -> }`). They are passed as ordinary method arguments and are the backbone of Groovy's collection idioms (`each`, `findAll`, `collect`). Evidence: `core-groovy/.../closures/Closures.groovy` + `ClosuresUnitTest.groovy`.

**GString interpolation** has an eager and a lazy form. `"$name"` captures the *value* at GString-creation time. `"${-> name}"` (closure interpolation) defers evaluation until the GString is read, so later mutation of the referenced variable IS reflected. This distinction is load-bearing in two places: string concatenation (`strings/Concatenate.groovy:14-16`) and safe SQL parameterization (the GString-param `groovy.sql.Sql` idiom — see `jvm-languages/groovy-sql-jdbc`). Evidence: `ClosuresUnitTest.groovy:45-63`.

**String types** are richer than Java's: single-quote produces a plain `java.lang.String` with no interpolation; double-quote produces a `GString`; triple-quote allows multiline; slashy `/.../` strings are regex-friendly (no need to escape `/`); dollar-slashy `$/.../$` add another escaping layer. There is no `char` literal — coerce with `'A' as char` or `(char)'C'`.

**Traits** provide multiple behavior inheritance. A `trait` may contain abstract, concrete, and private methods plus properties, and may `implements` an interface. Conflicts resolve last-declared-wins. Traits can be applied at runtime with `as` (`new Dog() as AnimalTrait`). A subtle trap: private trait methods are not callable on the implementing class — invoking one yields `MissingMethodException`. Evidence: `traits/TraitsUnitTest.groovy:95-113`.

**Script scope** surprises newcomers: an un-`def`'d assignment at script level (or inside a script function) leaks the variable into the global script *binding*, whereas `def` keeps it local. Evidence: `scopes/Scopes.groovy:5-22`.

**Type conversion** offers many string-to-int idioms (`as Integer`, `.toInteger()`, `Integer.parseInt`/`valueOf`, `DecimalFormat`). Guard against bad input with `str?.isInteger()` because `null.toInteger()` throws NPE and `"123a" as Integer` throws `NumberFormatException`. The dynamic `def` keyword binds to `NullObject` when unassigned and is freely reassignable across types; an explicitly-typed variable throws `GroovyCastException` on an incompatible assignment.

### 2026 currency

- **Groovy 4.x → 5.0 is the current stable major.** Groovy 5.0.6 (2026-05-04) is current; 4.0 is in maintenance (active support ended 2025-08-21, security fixes only, latest 4.0.32); 6.0.0-alpha1 is in development. 5.0 requires JDK 17+ to build, JDK 11 minimum to run. [endoflife.date/apache-groovy](https://endoflife.date/apache-groovy) · [Groovy 5.0 release notes](https://groovy-lang.org/releasenotes/groovy-5.0.html)
- **The `org.codehaus.groovy` → `org.apache.groovy` groupId change landed in Groovy 4 and persists in 5**, with split modules (`groovy-xml`, `groovy-sql`, `groovy-json`). The retired Codehaus groupId is the build break, not the language: traits, closures, GStrings, slashy strings, and categories are unchanged.
- **EOL exposure**: Groovy 2.5 support ended 2026-04-30; Groovy 3.0 is bug-fix-only. Move to 4.0 (security fixes) or 5.0 (active) on a supported LTS JDK (17/21/25). [endoflife.date/apache-groovy](https://endoflife.date/apache-groovy)
- **Groovy 5 aligns `instanceof` pattern matching with JDK 16+** and explicitly supports the JEP-512 compact-source / instance-`main()` form, narrowing the scripting gap Groovy historically filled. [Groovy 5.0 release notes](https://groovy-lang.org/releasenotes/groovy-5.0.html)
