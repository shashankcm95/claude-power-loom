---
kb_id: spring-boot/api-documentation
version: 1
tags:
  - spring-boot
  - api-documentation
  - openapi
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-springdoc"
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-swagger"
  - "springdoc-openapi releases (github.com/springdoc/springdoc-openapi/releases)"
related:
  - spring-boot/web-rest-controllers
  - spring-boot/security
status: active
---

## Summary

**Concept**: Documenting a Boot REST API — the dead SpringFox path vs the live springdoc-openapi (OpenAPI 3) path, plus REST Docs.
**Key APIs**: springdoc `springdoc-openapi-starter-webmvc-ui`, OpenAPI 3 annotations (`@Operation`/`@Parameter`/`@Schema`/`@Tag`/`@Hidden`), `OpenAPI`/`Info` bean, `@ParameterObject` for `Pageable`; (legacy SpringFox `Docket`/`@Api`/`@ApiOperation`); Spring REST Docs.
**Gotcha**: SpringFox is abandoned (last 3.0.0, 2020) and dead on Boot 3 — do not start new work on it.
**2026-currency**: SpringFox → springdoc-openapi; springdoc Boot-2/3 line at 2.8.6 (2025), Boot-4-aligned 3.0.x shipped (3.0.3, 2026-04-11).
**Sources**: Baeldung `spring-boot-springdoc` / `-swagger`; springdoc-openapi releases.

## Quick Reference

**Live path — springdoc-openapi (OpenAPI 3)**: add `springdoc-openapi-starter-webmvc-ui`; Swagger UI is served automatically. Annotate with the OpenAPI 3 model (`io.swagger.v3.oas.annotations.*`):

```java
@Operation(summary = "Get a foo by id")
@GetMapping("/{id}")
Foo get(@Parameter(description = "foo id") @PathVariable Long id) { ... }

@Bean
OpenAPI api() {
    return new OpenAPI().info(new Info().title("Foo API").version("v1"));
}
```

`@Tag` groups operations, `@Schema` documents models, `@Hidden` excludes; `@ParameterObject` documents a `Pageable`. JWT bearer in Swagger UI via a `SecurityScheme` + `SecurityRequirement`.

**Dead path — SpringFox (do not use)**: `Docket` bean with `DocumentationType.SWAGGER_2`, `@Api`/`@ApiOperation`/`@ApiIgnore`, `UiConfiguration`. Last release 3.0.0 (2020-07-14), requires Spring 5.x / Boot 2.2+, broken on Boot 2.6+ (`PathPatternParser`), dead on Boot 3.

**Test-driven docs — Spring REST Docs**: generates snippets from passing tests for hand-curated, accurate documentation (complements or replaces annotation-driven specs).

**Top gotchas**:
- `@RestController(value="/clients")` sets the bean name, not a path — a frequent mis-read in Swagger configs.
- Build-time `@..@` version tokens (e.g. `@springdoc.version@`) stay literal without Maven resource filtering.

**Current (mid-2026)**: springdoc-openapi is the maintained successor — the Boot-2/3 line is at 2.8.6 (2025-03-23) and a Boot-4-aligned 3.0.x line has shipped (3.0.3, 2026-04-11). Migrate SpringFox `@Api`/`@ApiOperation` to OpenAPI 3 `@Tag`/`@Operation`.

## Full content

API documentation for a Boot REST service is the clearest "abandoned vs alive" story in the corpus: the demonstrated tool (SpringFox) is dead, and its replacement (springdoc-openapi) is what current work uses.

### The dead path: SpringFox

The corpus's `spring-boot-swagger`/`-jwt` modules configure SpringFox with a `Docket` bean, `DocumentationType.SWAGGER_2`, and the `@Api`/`@ApiOperation`/`@ApiIgnore` annotation family. SpringFox has had no release since 3.0.0 (2020), breaks on the Boot 2.6+ `PathPatternParser`, and does not run on Boot 3 at all. It is useful now only as a migration source.

### The live path: springdoc-openapi

springdoc-openapi scans the application and generates an OpenAPI 3 document plus a bundled Swagger UI from `springdoc-openapi-starter-webmvc-ui`. Documentation is expressed with the standard OpenAPI 3 annotations (`@Operation`, `@Parameter`, `@Schema`, `@Tag`, `@Hidden`) and a programmatic `OpenAPI`/`Info` bean for top-level metadata. `@ParameterObject` documents composite arguments like `Pageable`. JWT bearer auth is surfaced in the UI by registering a `SecurityScheme` and `SecurityRequirement`.

### Test-driven documentation

Spring REST Docs takes a different approach: it asserts request/response shapes in tests and emits documentation snippets from the passing runs, so the docs cannot drift from the actual API. It can be combined with springdoc.

### 2026 currency

- **SpringFox → springdoc-openapi.** SpringFox's last release is 3.0.0 (2020-07-14, requires Spring 5.x / Boot 2.2+) with nothing since; it does not support Boot 3+. springdoc-openapi is the actively-maintained successor: the Boot-2/3 line is at 2.8.6 (2025-03-23) and a Boot-4-aligned 3.0.x line has shipped (3.0.3, 2026-04-11). [SpringFox 3.0.0 release](https://github.com/springfox/springfox/releases/tag/3.0.0), [springdoc-openapi releases](https://github.com/springdoc/springdoc-openapi/releases)
- **Annotation migration.** SpringFox `@Api`/`@ApiOperation` map to OpenAPI 3 `@Tag`/`@Operation`; the `io.swagger.v3.oas.annotations.*` package is the current home. [springdoc-openapi releases](https://github.com/springdoc/springdoc-openapi/releases)
- **Spring REST Docs carries forward unchanged** as the test-driven alternative. [Spring Boot 4.0.0 available now](https://spring.io/blog/2025/11/20/spring-boot-4-0-0-available-now/)
