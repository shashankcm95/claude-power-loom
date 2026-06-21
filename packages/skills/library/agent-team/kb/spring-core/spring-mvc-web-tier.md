---
kb_id: spring-core/spring-mvc-web-tier
version: 1
tags:
  - spring-core
  - spring-mvc
  - web-tier
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-web-modules/spring-mvc-* / spring-5-mvc / spring-rest-http"
  - "Error Responses :: Spring Framework reference (docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-rest-exceptions.html)"
related:
  - spring-core/view-technologies
  - spring-core/rest-client
  - spring-core/bean-validation
  - spring-core/websocket-soap
  - spring-core/spring-testing
status: active
---

## Summary

**Concept**: Servlet-stack Spring MVC routes HTTP requests through a `DispatcherServlet` front controller to annotated `@Controller`/`@RestController` handler methods.
**Key APIs**: `DispatcherServlet`, `@GetMapping`/`@PostMapping`, `@PathVariable`/`@RequestParam`/`@RequestBody`, `ResponseEntity`/`ResponseStatusException`, `@ControllerAdvice`/`@ExceptionHandler`, `WebMvcConfigurer`, async (`DeferredResult`/`SseEmitter`/`StreamingResponseBody`).
**Gotcha**: `@RestController("/x")` — the string is the BEAN NAME, not a path; ambiguous same-path+verb mappings throw `IllegalStateException: Ambiguous mapping` at startup.
**2026-currency**: Annotations carry to Spring 6/7; new `ProblemDetail` (RFC 9457), native API versioning (7.0); suffix-pattern matching removed; `WebMvcConfigurerAdapter` deprecated.
**Sources**: Baeldung `spring-mvc-*`; Spring Framework reference docs.

## Quick Reference

**Bootstrap**: `@SpringBootApplication` (Boot), or `WebApplicationInitializer` / `AbstractAnnotationConfigDispatcherServletInitializer` (programmatic, no `web.xml`), or `SpringBootServletInitializer` (WAR). The `WebMvcConfigurer` callbacks: `addViewControllers`, `addResourceHandlers`, `addInterceptors`, `addFormatters`, `addArgumentResolvers`, `configureContentNegotiation`, `configurePathMatch`, `extendMessageConverters`.

**Controllers**: `@Controller` returns view names / `ModelAndView`; `@RestController` = `@Controller` + `@ResponseBody` (serializes the return to the body via Jackson). Mapping shortcuts `@GetMapping`/`@PostMapping`/`@PutMapping`/`@DeleteMapping`/`@PatchMapping` are composed over `@RequestMapping(method=)`. Interface-driven controllers: mappings on an interface, `@RestController implements` it.

**`@RequestMapping` attributes**: `value`, `method`, `headers`, `produces`, `consumes`. Ambiguous (same path+verb) → `IllegalStateException` at startup unless disambiguated by `produces`.

**Request binding**: `@PathVariable` (name / `required=false` / `Optional` / `Map`), `@RequestParam`, `@RequestHeader` (single/`Map`/`HttpHeaders`), `@MatrixVariable` (needs `removeSemicolonContent=false`), `@RequestPart`, `@RequestAttribute`/`@SessionAttribute`, `@CookieValue`. `@ModelAttribute` (method-level pre-populates the model; param-level binds the form). `@InitBinder` + `WebDataBinder.registerCustomEditor`.

**Data conversion**: `Converter<S,T>`, `ConverterFactory<S,R>`, `GenericConverter`, registered in `addFormatters`; `@DateTimeFormat`; custom `HandlerMethodArgumentResolver`.

**Responses & status**: `ResponseEntity<T>` (status/headers/body), `@ResponseStatus`, `ResponseStatusException(HttpStatus, reason, cause)` (throw a status directly). URI building: `UriComponentsBuilder`, `ServletUriComponentsBuilder.fromCurrentRequest()` for a created-resource `Location`.

**Exception handling**: `@ControllerAdvice`/`@RestControllerAdvice` + `@ExceptionHandler` → `ResponseEntity`; `ResponseEntityExceptionHandler` base.

**Async MVC** (all offload the servlet thread): `DeferredResult` (long-polling, `onTimeout`/`setErrorResult`), `Callable<T>`, `SseEmitter` (Server-Sent Events), `ResponseBodyEmitter` (object streaming), `StreamingResponseBody` (raw bytes, no buffering).

**Sessions / flash**: `@SessionAttributes` (needs `SessionStatus.setComplete()` or it grows unbounded); flash across redirect via `RedirectAttributes.addFlashAttribute` + `RedirectView` + `getInputFlashMap` (POST-redirect-GET).

**Top gotchas**:
- `@RestController("/x")` sets a bean name, not a path.
- Matrix variables silently fail without `removeSemicolonContent=false`.
- File-upload security: writing the client-supplied `getOriginalFilename()` to disk unsanitized is a path-traversal / arbitrary-write hole that recurs across the corpus.

**Current (mid-2026)**: Annotations transfer 1:1 to Spring 6/7. Return a `ProblemDetail` (RFC 9457) from `@ExceptionHandler` instead of hand-rolled error DTOs. Spring 7.0 adds native request API-versioning. `CommonsMultipartResolver` removed (use `StandardServletMultipartResolver`); suffix-pattern matching removed (RFD attacks); `WebMvcConfigurerAdapter` deprecated (implement `WebMvcConfigurer`); MVC themes deprecated; JSONP dead.

## Full content

`DispatcherServlet` is the front controller: it consults ordered `HandlerMapping`s (`RequestMappingHandlerMapping` for annotated methods, `BeanNameUrlHandlerMapping` where the bean name IS the URL), invokes the matched handler via a `HandlerAdapter` (`RequestMappingHandlerAdapter`), and renders the result. `@Controller` returns a view name resolved by a `ViewResolver`; `@RestController` serializes the return through an `HttpMessageConverter` (Jackson for JSON).

### Content negotiation and file handling

Content is negotiated by `Accept` header, `?param`, or (legacy) path extension. Vendor-MIME API versioning historically used `produces="application/vnd.x.v1+json"`. File upload binds `MultipartFile` (single / array / `List` / `@ModelAttribute` command); `MultipartFile.transferTo(File)` persists it. HTTP caching uses `CacheControl` on `ResponseEntity`, `WebRequest.checkNotModified(lastModified)` → 304, and `ShallowEtagHeaderFilter`.

### Filters, forward vs redirect

`@WebServlet`/`@WebFilter`/`@WebListener` coexist with Spring; `OncePerRequestFilter` (+ `shouldNotFilter`) and `FilterRegistrationBean` (URL scoping) are the Spring-friendly wrappers. A redirect (302) is a new request; a forward is server-side within the same request.

### 2026 currency

The MVC annotation model is in the durable core; the migration is namespace plus successor idioms:

- **`javax.servlet → jakarta.servlet`** on the Spring 6.0 (Nov 2022) Jakarta EE 9 / Servlet 5.0 baseline; concepts transfer 1:1. [Spring Framework Versions (official wiki)](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)
- **RFC 9457 / RFC 7807 Problem Details.** Spring 6.0 added first-class `ProblemDetail` + `ErrorResponse`/`ErrorResponseException`; `ResponseEntityExceptionHandler` renders MVC exceptions as RFC 9457 bodies — the modern replacement for hand-rolled `ApiErrorResponse` DTOs. [Error Responses :: Spring Framework reference (official docs)](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-rest-exceptions.html)
- **Native API versioning (Spring 7.0)** across RestClient and request mapping — a first-class successor to the vendor-MIME `produces=` idiom. [The state of HTTP clients in Spring (official blog)](https://spring.io/blog/2025/09/30/the-state-of-http-clients-in-spring/)
- **Removed / deprecated**: `CommonsMultipartResolver` removed (use `StandardServletMultipartResolver`); suffix-pattern / path-extension matching removed (RFD attacks, `PathPatternParser` is the default); `WebMvcConfigurerAdapter` deprecated since Spring 5; MVC theme abstraction deprecated in Spring 6; JSONP dead (use CORS). [Spring Framework Versions (official wiki)](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)
- **Virtual threads** (Java 21, JEP 444): Spring Boot 3.2 wires them into web request handling with `spring.threads.virtual.enabled=true`. [JEP 444: Virtual Threads (openjdk.org)](https://openjdk.org/jeps/444) · [All together now: Spring Boot 3.2, GraalVM, Java 21, virtual threads (official blog)](https://spring.io/blog/2023/09/09/all-together-now-spring-boot-3-2-graalvm-native-images-java-21-and-virtual/)
