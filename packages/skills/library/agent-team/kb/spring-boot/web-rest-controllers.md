---
kb_id: spring-boot/web-rest-controllers
version: 1
tags:
  - spring-boot
  - web
  - rest
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-rest"
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-mvc-2"
  - "Spring Boot 3.2.0 available now (spring.io/blog/2023/11/23/spring-boot-3-2-0-available-now)"
related:
  - spring-boot/validation
  - spring-boot/error-handling
  - spring-boot/api-documentation
  - spring-boot/security
  - spring-boot/persistence-jpa
status: active
---

## Summary

**Concept**: Spring MVC controllers and REST idioms — request mapping, `ResponseEntity`, content negotiation, Jackson, HATEOAS, pagination, ETags, functional routing, filters/interceptors, CORS.
**Key APIs**: `@RestController`/`@GetMapping`/`@PathVariable`/`@RequestBody`, `ResponseEntity` (`.ok()`/`.created(uri)`/`.noContent()`), `ServletUriComponentsBuilder`, `MappingJackson2HttpMessageConverter`, `RepresentationModel`/`WebMvcLinkBuilder`, `Pageable`/`Page`, `ShallowEtagHeaderFilter`, `RouterFunction`.
**Gotcha**: `@RestController(value="/x")` sets the BEAN NAME, not a path; `ShallowEtagHeaderFilter` overrides a manual ETag and saves bandwidth, not compute.
**2026-currency**: `RestTemplate` → `RestClient` (Spring 6.1 / Boot 3.2); Boot 4.0 adds API versioning + HTTP Service Clients; Jackson 3 default.
**Sources**: Baeldung `spring-boot-rest` / `-mvc-2`; spring.io 2023/2025.

## Quick Reference

**Controller basics**: `@RestController` (or `@Controller` + `@ResponseBody`), `@RequestMapping` + `@GetMapping`/`@PostMapping`/`@PutMapping`/`@DeleteMapping`, `@PathVariable`, `@RequestParam`, `@RequestBody`, `@ResponseStatus`. A single constructor injects repos/services with no `@Autowired`.

**`ResponseEntity`** — fluent builder is idiomatic:

```java
return ResponseEntity
    .created(ServletUriComponentsBuilder.fromCurrentRequest()
        .path("/{id}").buildAndExpand(id).toUri())
    .body(saved);   // 201 + Location header
```

Also `.ok()`, `.badRequest()`, `.notFound().build()`, `.noContent()`, `.eTag(...)`, `.status(...).header(...).body(...)`.

**Content negotiation & converters**: `produces=MediaType.APPLICATION_JSON_VALUE`/`_XML_VALUE`; register `MappingJackson2HttpMessageConverter` (JSON) + an XML converter via `WebMvcConfigurer#configureMessageConverters`. "No converter found" (`HttpMessageNotWritableException`) means a returned POJO has no getters.

**Jackson customization (six ways)**: `spring.jackson.*` props, a `@Primary ObjectMapper`, a `@Primary Jackson2ObjectMapperBuilder`, a `Jackson2ObjectMapperBuilderCustomizer`, a `Module` bean, or a converter bean. Only one `@Primary` per context. Dates via `@JsonFormat` / `spring.jackson.date-format` / `JavaTimeModule`. `@JsonComponent` registers serializers as beans.

**HATEOAS**: model `extends RepresentationModel<T>`; `CollectionModel.of(list, linkTo(methodOn(Ctrl.class).all()).withSelfRel())`; HAL `application/hal+json`.

**Pagination**: a `Pageable` argument → Spring Data `Page`/`PageRequest.of(page, size, Sort...)`.

**ETags**: global `ShallowEtagHeaderFilter` via `FilterRegistrationBean` (overrides a manual ETag) or manual `ResponseEntity.ok().eTag(...).body(x)`; `If-None-Match` → 304.

**Functional MVC** (servlet stack): a `@Bean RouterFunction<ServerResponse>` built with `route().GET(...).nest(...).filter(...).onError(...).build()`.

**Servlets/filters/interceptors the Boot way**: `ServletRegistrationBean`, `FilterRegistrationBean`, `@Component @Order` filter, `HandlerInterceptor` via `WebMvcConfigurer#addInterceptors`. Boot auto-registers ONE `DispatcherServlet` (no `web.xml`). **CORS**: `@CrossOrigin` vs global `addCorsMappings`.

**Top gotchas**:
- `@RestController(value="/clients")` sets the bean name, not a URL path.
- `@EnableWebMvc` on a Boot app disables WebMvc auto-config (usually an anti-pattern).
- Reading `request.getInputStream()` in an interceptor consumes the stream — use `ContentCachingRequestWrapper`.

**Current (mid-2026)**: `RestTemplate` is superseded by the fluent `RestClient` (Spring 6.1 / Boot 3.2). Boot 4.0 adds first-class API versioning + HTTP Service Clients and makes Jackson 3 the default (`@JsonComponent` → `@JacksonComponent`). Functional MVC (`org.springframework.web.servlet.function`) is the most future-proof web sample in the corpus.

## Full content

Spring Boot's web tier is Spring MVC with auto-configuration and an embedded servlet container. The corpus covers the controller surface broadly across `spring-boot-rest`/`-2`, `-mvc`/`-2`/`-3`, `-bootstrap`, and `-data`/`-2`.

### Controllers and responses

`@RestController` combines `@Controller` + `@ResponseBody`; method-level mapping annotations bind HTTP verbs, and `@PathVariable`/`@RequestParam`/`@RequestBody` bind inputs. Constructor injection of collaborators needs no `@Autowired` on a single constructor. Responses are built with `ResponseEntity` — the fluent builder is preferred — and a 201 carries a `Location` header via `ServletUriComponentsBuilder.fromCurrentRequest()`.

### Serialization and content negotiation

Message converters render the response body. `produces=` plus registered `MappingJackson2HttpMessageConverter` / XML converters drive JSON-vs-XML selection. Jackson is customizable six ways, but only one `@Primary ObjectMapper` may exist per context. Date handling defaults to ISO via `JavaTimeModule`/jsr310.

### Discoverability and paging

Spring HATEOAS adds typed hypermedia (`RepresentationModel`, `CollectionModel`, `WebMvcLinkBuilder.linkTo`/`methodOn`) emitting HAL. Pagination is a `Pageable` argument resolved to a Spring Data `Page`. ETags either come from the global `ShallowEtagHeaderFilter` (which overrides any manually-set ETag and saves bandwidth via 304s, though the body is still generated and hashed) or are set manually on the `ResponseEntity`.

### Functional routing and low-level web

The servlet-stack functional model exposes a `RouterFunction<ServerResponse>` bean with nested routes and per-route filters — the cleanest, most future-proof style. Servlets, filters, and listeners register through `*RegistrationBean` types or `@WebServlet`/`@WebFilter` + `@ServletComponentScan` (embedded-container only); interceptors hook in via `WebMvcConfigurer`. Boot wires exactly one `DispatcherServlet` with no `web.xml`.

### 2026 currency

- **`RestTemplate` → `RestClient`.** The fluent `RestClient` (Spring 6.1 / Boot 3.2) is the successor for outbound HTTP and also enables HTTP Interfaces without pulling in WebFlux. [Spring Boot 3.2.0 available now](https://spring.io/blog/2023/11/23/spring-boot-3-2-0-available-now/)
- **Boot 4.0 web changes.** First-class API versioning + HTTP Service Clients; Jackson 3 becomes the default (`tools.jackson` group id; `@JsonComponent` → `@JacksonComponent`; a `spring-boot-jackson2` bridge exists); portfolio-wide JSpecify null-safety. [Spring Boot 4.0.0 available now](https://spring.io/blog/2025/11/20/spring-boot-4-0-0-available-now/), [Spring Boot 4.0 Migration Guide](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)
- **Functional MVC, HATEOAS post-1.0 API, and `ResponseEntity` carry forward unchanged** at the concept level. [Spring Boot 4.0.0 available now](https://spring.io/blog/2025/11/20/spring-boot-4-0-0-available-now/)
- **`HandlerInterceptorAdapter` deprecated** (Spring 5.3) → implement `HandlerInterceptor` directly. The reactive `WebFlux` / `WebClient` stack is a sibling concern the MVC corpus only references. [Spring Boot 4.0 Migration Guide](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)
