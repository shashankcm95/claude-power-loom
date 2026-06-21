---
kb_id: jvm-languages/groovy-collections
version: 1
tags:
  - jvm-languages
  - groovy
  - collections
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: core-groovy-collections"
  - "Groovy 5.0 release notes (https://groovy-lang.org/releasenotes/groovy-5.0.html)"
related:
  - jvm-languages/groovy-language-core
  - jvm-languages/groovy-metaprogramming
status: active
---

## Summary

**Concept**: Groovy's list/map collection idioms and the critical mutate-in-place-vs-return-new contract, plus Java Stream interop.
**Key APIs**: list literals + `as LinkedList` coercion, `<<`/`add`/`+`, `each`/`collect`/`findAll`/`grep`; map `[:]` (`LinkedHashMap`), `[(expr):val]`, `collectEntries`/`groupBy`/`subMap`; `.stream().anyMatch{}` alongside native `any`/`every`.
**Gotcha**: `toUnique`/`plus`/`minus`/`collect` return NEW; `unique`/`removeAll`/`retainAll`/`sort()` MUTATE in place; `map.collect{}` always returns a `List`; negative indices + sparse index assignment silently pad nulls.
**2026-currency**: collection semantics unchanged through Groovy 5.0; coordinates moved to `org.apache.groovy`.
**Sources**: `core-groovy-collections` module; Groovy 5.0 release notes.

## Quick Reference

**Lists**:

```groovy
def nums = [1, 2, 3]
def linked = nums as LinkedList
nums[-1]            // negative indexing → 3
nums[5] = 9         // sparse assign → pads nulls
nums << 4           // append (also add, +, +=)
nums.remove(0)      // by index; removeElement(v); nums - 2 (by value, NEW list)
nums.each { }; nums.eachWithIndex { v, i -> }
nums.collect { it * 2 }            // map → NEW list
nums.find { }; nums.findAll { }; nums.grep { }; nums.every { }; nums.any { }
nums.toUnique()    // NEW; nums.unique() mutates in place
nums.sort { a, b -> a <=> b }      // closure-as-Comparator; sort() mutates
```

**Maps**:

```groovy
def m = [:]                  // LinkedHashMap
def computed = [(key):value] // computed key
m['k']; m.k                  // access
m.collect { k, v -> }        // ALWAYS returns a List
m.collectEntries { }; m.groupBy { }; m.subMap(['a','b'])
m.sort { it.key }            // by key/value/Comparator
```

**Mutation vs new-collection split** (the key idiom):

| Returns NEW | Mutates in place |
|---|---|
| `toUnique`, `plus`, `minus`, `collect` | `unique`, `removeAll`, `retainAll`, `sort()` |

**Find / membership + Stream interop**: `indexOf > -1`, `contains`, `x in list`; `.stream().anyMatch / allMatch / filter` are equivalent to native `any` / `every` / `find` / `findAll`.

**Current (mid-2026)**: unchanged through Groovy 5.0.6; the GDK collection methods are identical — only the artifact coordinates (`org.apache.groovy`, split modules) differ from the 2.5-era corpus.

## Full content

Groovy collections wrap the JDK collection types with GDK extension methods, but the single most important thing to internalise is **which operations mutate the receiver and which return a fresh collection**.

**Lists** support literal syntax, coercion (`as LinkedList`), negative indexing (`list[-1]`), and sparse index assignment (`list[5] = x` silently pads intermediate slots with `null`). Adding has several forms (`<<`, `add`, `+`/`+=`); removal too (`remove(idx)`, `removeElement(v)`, `- value`). Iteration uses `each`/`eachWithIndex`/`collect`; filtering uses `find`/`findAll`/`grep`/`every`/`any`; sorting and `max`/`min` accept a closure as the `Comparator`. Evidence: `lists/ListUnitTest.groovy`.

**Maps** default to `LinkedHashMap` (`[:]`), support computed keys (`[(expr):val]`), dual access (`map['k']` and `map.k`), and a family of transforms: `collect` (always returns a `List`, regardless of source), `collectEntries`, `collect(HashSet){}`, `groupBy`, `subMap`. Sorting can be by key, value, or a `Comparator`. Evidence: `maps/MapTest.groovy:98-131`.

**The mutate-vs-new split** is the lane-level idiom: `toUnique`/`plus`/`minus`/`collect` return a NEW collection, while `unique`/`removeAll`/`retainAll`/`sort()` mutate the receiver in place. Assuming both forms are non-destructive (or both destructive) is a common bug source. Note also that `map.collect{}` always materialises a `List` even when the source is a `Map`.

**Find/membership and Stream interop** coexist: you can use `indexOf > -1`, `contains`, or the Groovy `x in list` operator, and you can drop into the Java Stream API (`.stream().anyMatch{}`) alongside the native `any`/`every`/`find`/`findAll`. The Stream and native forms are semantically equivalent. Evidence: `find/ListFindUnitTest.groovy:35-66`.

### 2026 currency

- **Collection semantics are unchanged through Groovy 5.0.6** (2026-05-04, current stable; JDK 17+ to build, JDK 11 to run). The GDK list/map extension methods and the mutate-vs-new contract carry forward verbatim. [Groovy 5.0 release notes](https://groovy-lang.org/releasenotes/groovy-5.0.html) · [endoflife.date/apache-groovy](https://endoflife.date/apache-groovy)
- **Only the build coordinates moved**: the 2.5-era corpus uses the retired `org.codehaus.groovy` groupId; Groovy 4+ uses `org.apache.groovy` with split modules. No collection code changes are needed beyond updating dependency coordinates.
- **EOL exposure**: Groovy 2.5 support ended 2026-04-30; move to 4.0 (security-only) or 5.0 (active) on a supported LTS JDK. [endoflife.date/apache-groovy](https://endoflife.date/apache-groovy)
