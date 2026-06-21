---
kb_id: testing/test-data-fixtures
version: 1
tags:
  - testing
  - fixtures
  - test-data
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: easy-random, mocks (javafaker/jimfs)"
  - "Instancio — instancio.org (https://www.instancio.org/)"
  - "Datafaker — github.com/datafaker-net/datafaker (https://github.com/datafaker-net/datafaker)"
related:
  - testing/junit5-jupiter
  - testing/mockito
status: active
---

## Summary

**Concept**: Fixture libraries generate test data so tests don't hand-build object graphs — **EasyRandom** populates objects with random values, **JavaFaker** (→ Datafaker) produces realistic fake data, **Jimfs** provides an in-memory filesystem. Modern successor: **Instancio** (records/sealed/Java 21).
**Key APIs**: EasyRandom `new EasyRandom().nextObject(Class)` (recursive), `objects(Class, n)`, `EasyRandomParameters` (`stringLengthRange`, `excludeField`, `randomize(Type, Randomizer)`); JavaFaker `faker.address()/name()`, seeded `Random`, `FakeValuesService.bothify/regexify`; Jimfs `Jimfs.newFileSystem(Configuration.unix())`.
**Gotcha**: faker output is non-deterministic — assertions must seed a fixed `Random` or match by regex, not exact value; Jimfs only intercepts `java.nio.file` (code using `java.io.File` directly isn't redirected).
**2026-currency**: JavaFaker → Datafaker (`net.datafaker`, Java 17, adds `templatify`/`csv`/`json`); EasyRandom is maintenance-only → **Instancio** for records/sealed/generics; EasyRandom coordinate is `org.jeasy:easy-random-core`, package `org.jeasy.random`.
**Sources**: Baeldung `easy-random`/`mocks`; Instancio; Datafaker GitHub.

## Quick Reference

**EasyRandom** (random populated objects):
```java
EasyRandom r = new EasyRandom(
    new EasyRandomParameters()
        .stringLengthRange(5, 50)
        .collectionSizeRange(2, 10)
        .excludeField(named("id"))
        .randomize(YearQuarter.class, new YearQuarterRandomizer()));
Person p = r.nextObject(Person.class);          // recursive populate
Stream<Person> many = r.objects(Person.class, 100);
```
Coordinates `org.jeasy:easy-random-core`, package `org.jeasy.random` (renamed from "Random Beans" `io.github.benas.randombeans`). Custom `Randomizer<T>`; `excludeType` via predicates.

**JavaFaker → Datafaker** (realistic fake data):
```java
Faker faker = new Faker(new Random(42));   // seed for reproducibility
faker.name().fullName(); faker.address().city();
faker.bothify("???-####");                 // FakeValuesService
```
Locales supported; `regexify` for pattern-driven values.

**Jimfs** (in-memory filesystem):
```java
FileSystem fs = Jimfs.newFileSystem(Configuration.unix());  // or .windows()/.osX()
Path p = fs.getPath("/tmp/test.txt");      // exercises java.nio.file with no disk I/O
```

**Top gotchas**:
- Faker is non-deterministic — seed a fixed `Random` or assert by regex, never exact value.
- Jimfs only intercepts `java.nio.file` — code calling `java.io.File` directly cannot be redirected.
- EasyRandom import confusion: `org.jeasy.random`, not the old `io.github.benas.randombeans`.

**Current (mid-2026)**: prefer **Datafaker** (`net.datafaker`) over inactive JavaFaker, and **Instancio** over maintenance-only EasyRandom for record/sealed/Java-21 fixtures.

## Full content

Fixtures attack the boilerplate of building object graphs by hand in every test. Three concerns appear in the corpus: random structural population, realistic-looking values, and filesystem isolation.

### EasyRandom — random object population

`nextObject(Class)` recursively populates an object graph with random values, which is ideal when a test needs *a* valid instance but doesn't care about specific field values. `EasyRandomParameters` tunes the generation (string/collection sizes, excluded fields/types, per-type `Randomizer`s). The historical naming churn (Random Beans → EasyRandom, `io.github.benas.randombeans` → `org.jeasy.random`) is a common import-resolution stumble.

### JavaFaker / Datafaker — realistic values

Where EasyRandom gives structurally-valid garbage, Faker gives plausible values (names, addresses, emails) for demos and readable test data. The critical discipline is **determinism**: Faker is random by default, so a test asserting on faker output must seed a fixed `Random` (reproducible) or match by regex.

### Jimfs — in-memory filesystem

Jimfs implements `java.nio.file.FileSystem` in memory, so file I/O tests need no temp directory and leave no disk artifacts. Its boundary is exact: it only intercepts the NIO `java.nio.file` API — legacy `java.io.File` code bypasses it entirely. (For real temp directories, JUnit 5's `@TempDir` is the in-framework option — see [testing/junit5-jupiter](junit5-jupiter.md).)

### 2026 currency

- **JavaFaker → Datafaker (`net.datafaker`)** is the maintained successor (original JavaFaker is inactive); Datafaker 2.x requires Java 17 and adds `templatify`, `exemplify`, `csv`, `json` directives. An OpenRewrite recipe automates the migration. [Datafaker (GitHub)](https://github.com/datafaker-net/datafaker) · [Migrate Java Faker to Datafaker (OpenRewrite)](https://docs.openrewrite.org/recipes/java/testing/datafaker/javafakertodatafaker)
- **Instancio is the modern fixture generator** — EasyRandom is maintenance-only. Instancio supports records, sealed classes, generics, Java 21 sequenced collections, JPA/Bean-Validation-aware generation, and an `InstancioExtension` for JUnit 5. [Instancio](https://www.instancio.org/) · [Instancio with JUnit 5 (Baeldung)](https://www.baeldung.com/java-test-data-instancio)
- **`record` / sealed-type test fixtures are mainstream** — Java 17/21 records and sealed types are pervasive; fixture libs (Instancio natively, Datafaker, recent Mockito/Jackson) must support record construction, which the 2021 base explicitly lacked. [Instancio record/sealed support](https://www.instancio.org/)
