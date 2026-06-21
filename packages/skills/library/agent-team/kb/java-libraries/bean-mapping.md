---
kb_id: java-libraries/bean-mapping
version: 1
tags:
  - java-libraries
  - bean-mapping
  - annotation-processing
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: mapstruct, dozer, orika"
  - "MapStruct News (mapstruct.org/news)"
related:
  - java-libraries/code-generation
  - java-libraries/http-clients
status: active
---

## Summary

**Concept**: DTO ↔ domain bean mapping via four libraries distinguished by *mechanism* — Dozer (runtime reflection, dead), Orika (runtime bytecode-gen via Javassist, abandoned), MapStruct (compile-time annotation processor, the 2026 winner), ModelMapper (live alternative).
**Key APIs**: MapStruct `@Mapper`/`@Mapping(source,target)`/`Mappers.getMapper`/`componentModel="spring"`; Orika `MapperFactory`/`classMap().field().byDefault().register()`; Dozer `DozerBeanMapper.map`.
**Gotcha**: MapStruct + Lombok need `lombok-mapstruct-binding` on `annotationProcessorPaths` or MapStruct sees no accessors; Orika `.register()` is mandatory or `classMap` silently no-ops; declaring any `.field()` disables auto same-name mapping unless `.byDefault()` is added.
**2026-currency**: MapStruct 1.6.3 (records); 1.7.0.Beta1 adds native `Optional`. Dozer/Orika no revival — do not seed.
**Sources**: Baeldung `mapstruct`/`dozer`/`orika` modules.

## Quick Reference

**The four mappers, by mechanism:**

| Library | Mechanism | 2026 status |
|---|---|---|
| **MapStruct** | compile-time annotation processor (no runtime reflection) | **the winner** — native-image friendly |
| **ModelMapper** | runtime reflection (convention-based) | live alternative |
| **Orika** | runtime *bytecode* gen via Javassist | abandoned (`ma.glasnost.orika` 1.5.4, final) |
| **Dozer** | runtime reflection | dead (`net.sf.dozer` 5.5.1) |

**MapStruct canonical pattern:**

```java
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
interface CarMapper {
    @Mapping(source = "numberOfSeats", target = "seatCount")
    CarDto toDto(Car car);
}
// or no Spring: CarMapper m = Mappers.getMapper(CarMapper.class);
```

**MapStruct feature surface:** `@Mappings`, `@BeforeMapping`/`@AfterMapping` + `@MappingTarget` hooks; `expression="java(...)"` / `defaultExpression`; qualifier-based method selection (`@Qualifier`+`qualifiedBy`, `@Named`+`qualifiedByName`); multi-source `from(A,B)`; in-place update via `@MappingTarget` first param; `unmappedTargetPolicy` (`WARN` default / `ERROR` / `IGNORE`); collection mapping with `uses=` and `CollectionMappingStrategy.ADDER_PREFERRED`.

**Orika pattern:** `new DefaultMapperFactory.Builder().build()` → `MapperFacade`; `classMap(A,B).field("nom","name").byDefault().register()`; field expressions `nameList[0]` / `nameMap['first']` / `name.firstName`; `CustomMapper<A,B>` overriding `mapAtoB`/`mapBtoA`.

**Dozer pattern:** `DozerBeanMapper.map(src, Dest.class)`; `BeanMappingBuilder` API; XML mapping files; `@Mapping("dest")`; `CustomConverter` (untyped `instanceof` dispatch).

**Top gotchas:**

- **MapStruct + Lombok**: add `lombok-mapstruct-binding` to `annotationProcessorPaths` (else MapStruct runs first, sees no accessors).
- **Orika `.register()`** is mandatory for any `classMap` using `.field()`/`.exclude()` — silently no-ops if forgotten.
- Declaring any `.field()` disables auto same-name mapping unless you add `.byDefault()`.
- Custom date converters (unix-`long` ↔ ISO-8601 `String`) are timezone-fragile — `SimpleDateFormat` runs in JVM-default TZ.

**Current (mid-2026):** MapStruct **1.6.3** (records since 1.6.x); **1.7.0.Beta1** adds native `Optional` + Java 21 Sequenced Collections. Base's 1.4.2 is stale. Dozer/Orika confirmed dead.

## Full content

Bean mapping libraries exist to remove the boilerplate of copying fields between two object shapes — typically a persistence entity and an API DTO. The four mappers covered share a recurring vocabulary: implicit same-name field mapping with automatic type coercion (`"320"` → `int`), explicit remap of differently-named fields, bidirectional/reverse mapping, field exclusion, custom converters for type-incompatible fields (the canonical example everywhere being unix-`long` ↔ ISO-8601 `String` date), nested/indexed/keyed field expressions, and null-handling policy. What separates them is *when and how* they do the work.

**MapStruct** is the compile-time annotation processor: you declare an `@Mapper` interface with `@Mapping(source, target)` methods, and the processor generates a plain Java implementation at build time — no runtime reflection, which makes it fast and GraalVM-native-image friendly. Obtain instances via `Mappers.getMapper(X.class)` or, with `componentModel="spring"`, as injectable beans. Its rich surface includes lifecycle hooks (`@BeforeMapping`/`@AfterMapping` with `@MappingTarget`), inline `expression="java(...)"` (unchecked string-Java), qualifier-based disambiguation of same-signature converters (`@Qualifier`/`@Named` with `qualifiedBy`/`qualifiedByName`), multi-source mappings, in-place updates (`@MappingTarget` as the first parameter), and a configurable `unmappedTargetPolicy` (defaulting to `WARN`). The single most important build-time gotcha: when Lombok and MapStruct coexist, the `lombok-mapstruct-binding` artifact must be on `annotationProcessorPaths`, otherwise MapStruct runs before Lombok generates accessors and sees an empty bean.

**Orika** generates bytecode at runtime via Javassist. You build a `MapperFactory`, register `classMap(A, B)` definitions with `.field("nom","name")`, `.byDefault()`, `.exclude()`, and `.customize()` clauses, and **must call `.register()`** — forgetting it silently produces a no-op mapper. A subtle trap: declaring any explicit `.field()` disables the automatic same-name mapping unless you also chain `.byDefault()`. **Dozer** is the oldest, using pure runtime reflection driven by either a fluent `BeanMappingBuilder`, XML mapping files, or `@Mapping` annotations, with untyped `CustomConverter` implementations dispatching on `instanceof`.

Both Dozer and Orika are abandoned and runtime-reflection/bytecode based, which makes them hostile to GraalVM native image; MapStruct (a compile-time processor) is native-friendly. For any new code in 2026 the recommendation is MapStruct (or ModelMapper where convention-based runtime mapping is wanted).

### 2026 currency

- **MapStruct 1.6.3** (9 Nov 2024) supports records since the 1.6.x line; **1.7.0.Beta1** (1 Feb 2026) adds native `Optional` mapping and Java 21 Sequenced Collections. The base's 1.4.2 pin is stale. [MapStruct News](https://mapstruct.org/news/)
- **Dozer and Orika** show no revival; both remain dead/abandoned and should not be seeded for new code (use MapStruct/ModelMapper). The base's abandoned-library finding still holds.
- Compile-time mappers (MapStruct) are **GraalVM-native-image friendly**, whereas runtime-codegen mappers (Dozer/Orika) are native-image-hostile — a net-new selection axis since the 2021 corpus. [GraalVM Reachability Metadata (graalvm.org)](https://www.graalvm.org/latest/reference-manual/native-image/metadata/)
