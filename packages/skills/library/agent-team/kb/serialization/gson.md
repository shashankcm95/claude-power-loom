---
kb_id: serialization/gson
version: 1
tags:
  - serialization
  - gson
  - json
  - type-token
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: gson"
  - "google/gson CHANGELOG (github.com/google/gson/blob/main/CHANGELOG.md)"
  - "google/gson releases (github.com/google/gson/releases)"
related:
  - serialization/jackson-databinding
  - serialization/jackson-polymorphism-dates
  - serialization/json-other-libraries
status: active
---

## Summary

**Concept**: Gson (Google) — field-reflection JSON binding (no getters needed; extra JSON fields silently ignored), with `TypeToken` for generics and several exclusion strategies.
**Key APIs**: `new Gson().toJson(obj)`/`fromJson(json, Cls)`; `new TypeToken<List<Foo>>(){}.getType()`; `GsonBuilder` (`setPrettyPrinting`, `excludeFieldsWithoutExposeAnnotation`, `registerTypeAdapter`, `registerTypeAdapterFactory`); `@SerializedName(value, alternate)`; `@Expose`; `ExclusionStrategy`.
**Gotcha**: deserializing to raw `ArrayList.class`/`Map.class` yields `LinkedTreeMap` elements (→ `ClassCastException`) and coerces all numbers to `Double`; byte overflow wraps silently (`"300"` → 44); JSON-array compare is order-sensitive.
**2026-currency**: Gson on the 2.x line (2.13.2 Sep 2025, 2.14.0 Apr 2026); `new JsonParser().parse(...)` instance method → static `JsonParser.parseString(...)`; `new Integer(...)` boxing constructors deprecated.
**Sources**: Baeldung `gson` module; google/gson CHANGELOG + releases.

## Quick Reference

**Core idioms**:

```java
Gson gson = new Gson();
String json = gson.toJson(obj);
Foo foo = gson.fromJson(json, Foo.class);
// Generics / type erasure (REQUIRED for parameterized targets):
List<Foo> list = gson.fromJson(json, new TypeToken<List<Foo>>(){}.getType());
Map<String,Employee> m = gson.fromJson(json,
        new TypeToken<Map<String,Employee>>(){}.getType());
```

**Builder config**:

```java
Gson g = new GsonBuilder()
    .setPrettyPrinting()
    .excludeFieldsWithoutExposeAnnotation()
    .registerTypeAdapter(Type.class, customAdapter)
    .registerTypeAdapterFactory(...)
    .create();
```

**Field exclusion — four strategies**: `transient`; `@Expose` + `excludeFieldsWithoutExposeAnnotation()`; `ExclusionStrategy` (by class/field/`startsWith`); a custom annotation tested inside `shouldSkipField`.

**Custom + polymorphism**: `JsonSerializer<T>`/`JsonDeserializer<T>` via `registerTypeAdapter`; `InstanceCreator` for default field values; polymorphism via a registry-keyed deserializer or `RuntimeTypeAdapterFactory` (in `gson-extras`, not core).

**Naming**: `@SerializedName(value, alternate={...})` maps multiple input names → one field.

**Top gotchas**:

- Raw `ArrayList.class` → `LinkedTreeMap` elements → `ClassCastException`; use `TypeToken`.
- Raw `Map.class` coerces all numbers to `Double`, nested objects to `LinkedTreeMap`.
- Byte overflow wraps **silently** (`"300"` → `44`); duplicate JSON keys → `JsonSyntaxException`; NaN/Infinity throw on serialize.
- JSON-array compare (`JsonElement.equals`) is **order-sensitive** even though object-key order is not.

**Current (mid-2026)**: Gson is on the **2.x line** (2.13.2 shipped Sep 10, 2025; 2.14.0 Apr 23, 2026). `new JsonParser().parse(...)` (instance) → static `JsonParser.parseString(...)` — the instance method stays deprecated across the 2.x line. `new Integer(...)` boxing constructors used in the corpus are deprecated.

## Full content

Gson serializes/deserializes via field reflection — no getters/setters required, and extra JSON fields are silently ignored (the opposite of Jackson's default strictness). Evidence: `gson/.../deserialization/test/GsonDeserializationUnitTest.java`.

### Generics and type erasure

Parameterized targets (`List<Foo>`, `Map<String,Employee>`) must carry their type via `new TypeToken<...>(){}.getType()` — a super-type token that survives erasure. Passing raw `ArrayList.class` yields `LinkedTreeMap` elements → `ClassCastException`. This is the Gson face of the cross-library raw-collection trap (see also `serialization/jackson-databinding`).

### Configuration and exclusions

`GsonBuilder` configures pretty-printing, type adapters, and field exclusion. Four exclusion strategies exist: `transient` fields; `@Expose` + `excludeFieldsWithoutExposeAnnotation()`; a programmatic `ExclusionStrategy` (by class/field name/`startsWith`); or a custom annotation checked inside `shouldSkipField`. Evidence: `gson/.../serializationwithexclusions/SerializationWithExclusionsUnitTest.java`.

### Custom adapters and polymorphism

Register `JsonSerializer<T>`/`JsonDeserializer<T>` via `GsonBuilder.registerTypeAdapter`; use `InstanceCreator` to supply default field values. Polymorphism uses a registry-keyed deserializer (`gson/.../serialization/AnimalDeserializer.java`) or `RuntimeTypeAdapterFactory` (vendored in `gson-extras`, not core: `gson/.../advance/RuntimeTypeAdapterFactory.java`).

### Primitives cookbook and comparison

The corpus covers primitive edge cases: byte overflow wraps silently (`"300"` → `44`), NaN/Infinity throw on serialize, unicode/rounding behavior, and duplicate keys throw `JsonSyntaxException`. Order-insensitive object compare uses `JsonElement.equals`, but JSON-array compare is order-sensitive. Default Date output is a US-locale string (`"Jan 1, 2000 12:00:00 AM"`), consumer-fragile. Evidence: `gson/.../primitives/PrimitiveValuesUnitTest.java`, `gson/.../jsoncompare/JsonCompareUnitTest.java`.

### 2026 currency

- **Gson is on the 2.x line** (2.13.2 shipped Sep 10, 2025; 2.14.0 shipped Apr 23, 2026). ([google/gson releases — GitHub](https://github.com/google/gson/releases))
- **`new JsonParser().parse(...)` (instance) → static `JsonParser.parseString(...)`** — the instance method remains deprecated across the current Gson 2.x line. ([google/gson CHANGELOG — GitHub](https://github.com/google/gson/blob/main/CHANGELOG.md))
- The deprecated `new Integer(...)` boxing constructors used in the corpus's primitive tests should be replaced with `Integer.valueOf(...)` / autoboxing. (carries forward from the base's deprecation flags.)
- The raw-collection / `TypeToken` pitfall is timeless teaching value — not stale. (carries forward unchanged.)
