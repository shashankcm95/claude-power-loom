---
kb_id: spring-boot/error-handling
version: 1
tags:
  - spring-boot
  - error-handling
  - rest
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-rest"
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-basic-customization"
  - "Spring MVC error responses reference (docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-rest-exceptions.html)"
related:
  - spring-boot/web-rest-controllers
  - spring-boot/validation
  - spring-boot/actuator
status: active
---

## Summary

**Concept**: The full Boot error-handling toolbox — global advice, controller-local handlers, inline exceptions, the error-attribute pipeline, Whitelabel replacement, and RFC 7807/9457 problem bodies.
**Key APIs**: `@ControllerAdvice`/`@RestControllerAdvice` + `ResponseEntityExceptionHandler`, `@ExceptionHandler`, `ResponseStatusException`, `DefaultErrorAttributes`/`ErrorAttributeOptions`, `BasicErrorController`, `ErrorController`, `ProblemDetail`.
**Gotcha**: `management.endpoints.web.exposure.include=*` exposes `/shutdown` (dangerous, unauthenticated) — error and ops surfaces overlap.
**2026-currency**: Zalando Problem → native `ProblemDetail` (Spring 6.0, RFC 9457).
**Sources**: Baeldung `spring-boot-rest` / `-basic-customization`; Spring MVC error-responses reference.

## Quick Reference

**Global advice (the workhorse)**:

```java
@ControllerAdvice
class RestResponseEntityExceptionHandler extends ResponseEntityExceptionHandler {
    @ExceptionHandler(EntityNotFoundException.class)
    ResponseEntity<Object> notFound(EntityNotFoundException ex, WebRequest req) {
        return handleExceptionInternal(ex, body(ex), new HttpHeaders(),
                                       HttpStatus.NOT_FOUND, req);
    }
}
```

Extending `ResponseEntityExceptionHandler` lets you override `handleHttpMessageNotReadable` / `handleMethodArgumentNotValid` / `handleExceptionInternal`. Typical mappings: `ConstraintViolationException`/`DataIntegrityViolationException` → 400, `EntityNotFoundException` → 404, `DataAccessException` → 409, `NPE`/`IllegalArgumentException` → 500.

**Other tools in the box**:
- Controller-local `@ExceptionHandler` for handler-specific cases.
- `throw new ResponseStatusException(HttpStatus.NOT_FOUND, "...")` inline — no separate class.
- Custom error attributes: extend `DefaultErrorAttributes` / tune `ErrorAttributeOptions`.
- Replace the Whitelabel page: `implements ErrorController` + status-routed Thymeleaf views, or a custom `BasicErrorController`.
- RFC 7807 `application/problem+json`: native `ProblemDetail` (modern) replacing third-party Zalando Problem.

**Top gotchas**:
- The Actuator ops surface overlaps error handling — `exposure.include=*` exposes `/shutdown` unauthenticated; CSRF must be disabled/ignored for state-changing Actuator endpoints.
- A returned POJO with no getters yields `HttpMessageNotWritableException` ("No converter found"), which surfaces as a 500 unless handled.

**Current (mid-2026)**: build RFC 7807/9457 error bodies with the framework-native `ProblemDetail` + `ResponseEntityExceptionHandler` — the Zalando Problem dependency is no longer needed. The advice/`@ExceptionHandler`/`ResponseStatusException` toolbox carries forward unchanged.

## Full content

Boot offers a layered set of error-handling mechanisms, from inline per-request exceptions up to a global advice that centralizes mapping for the whole application.

### Global advice

A `@ControllerAdvice` (or `@RestControllerAdvice`) class that extends `ResponseEntityExceptionHandler` is the canonical place to translate exceptions into HTTP responses. It can both add `@ExceptionHandler` methods for domain exceptions and override the framework's built-in handlers (`handleMethodArgumentNotValid`, `handleHttpMessageNotReadable`, `handleExceptionInternal`) to standardize body shape and status. The corpus's `RestResponseEntityExceptionHandler` maps a spread of exception types to 400/404/409/500.

### Local and inline handling

For one-off cases a controller-local `@ExceptionHandler` keeps the mapping next to the handler, and `ResponseStatusException` lets a service throw a status directly without declaring a class — useful for "not found" inside a lookup.

### The error pipeline and Whitelabel

When no handler catches an exception, Boot's error pipeline produces the response. `DefaultErrorAttributes` + `ErrorAttributeOptions` control which fields appear; a custom `BasicErrorController` or an `ErrorController` implementation with status-routed Thymeleaf views replaces the default Whitelabel error page. `AbstractHandlerExceptionResolver` is the lower-level hook.

### Standardized problem bodies

For machine-readable errors, RFC 7807 / RFC 9457 `application/problem+json` is the standard. The 2021 corpus reached for the third-party Zalando Problem library; the framework now provides this natively.

### 2026 currency

- **Zalando Problem → native `ProblemDetail`.** Spring Framework 6.0 added RFC 7807 / RFC 9457 support via `ProblemDetail` + `ResponseEntityExceptionHandler`; the third-party library is no longer needed. [Spring MVC error responses reference](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-rest-exceptions.html)
- **The error-handling toolbox carries forward** — `@ControllerAdvice`, `@ExceptionHandler`, and `ResponseStatusException` are confirmed still-current; only the problem-body library changed. [Spring Boot 4.0.0 available now](https://spring.io/blog/2025/11/20/spring-boot-4-0-0-available-now/)
- **`RFC 9457 ProblemDetail` is a net-new must-know** — standardized error bodies built into the framework, surfaced via `ResponseEntity<ProblemDetail>` or thrown `ErrorResponseException`. [Spring MVC error responses reference](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-rest-exceptions.html)
