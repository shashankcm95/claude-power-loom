---
kb_id: spring-boot/validation
version: 1
tags:
  - spring-boot
  - validation
  - bean-validation
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-validation"
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-mvc-3"
  - "Spring Boot 4.0 Migration Guide (github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)"
related:
  - spring-boot/web-rest-controllers
  - spring-boot/error-handling
  - spring-boot/externalized-configuration
status: active
---

## Summary

**Concept**: Bean Validation (JSR-380) in a Boot web/service stack — request-body validation, validation groups, programmatic service-layer validation, DB-driven dynamic constraints.
**Key APIs**: `@Valid` + `BindingResult` / `MethodArgumentNotValidException`, `@Validated(Group.class)`, `javax/jakarta.validation.Validator.validate()`, `ConstraintViolationException`, `@Constraint` + `ConstraintValidator`, `LocalValidatorFactoryBean` + `MessageSource`.
**Gotcha**: `@Valid` cannot select validation groups — use Spring's `@Validated(Group.class)`; Boot 2.3+ removed the validator from `-starter-web` (add `-starter-validation`).
**2026-currency**: `javax.validation` → `jakarta.validation` (Boot 3); constraint annotations and groups unchanged.
**Sources**: Baeldung `spring-boot-validation` / `-mvc-3`; Spring Boot 4.0 migration guide.

## Quick Reference

**Request-body validation (REST 400 + field map)**:

```java
@PostMapping
ResponseEntity<?> create(@Valid @RequestBody UserDto dto) { ... }

@ExceptionHandler(MethodArgumentNotValidException.class)
Map<String,String> onInvalid(MethodArgumentNotValidException ex) {
    Map<String,String> errors = new HashMap<>();
    ex.getBindingResult().getFieldErrors()
      .forEach(fe -> errors.put(fe.getField(), fe.getDefaultMessage()));
    return errors;   // serialized as 400 body
}
```

The MVC re-render-form variant instead injects a `BindingResult` parameter right after the `@Valid` command object.

**Validation groups** (selective constraint sets): marker interfaces `BasicInfo`/`AdvanceInfo`; constraint `@NotNull(groups = BasicInfo.class)`; handler param `@Validated(BasicInfo.class)`. Plain `@Valid` cannot select a group.

**Service-layer programmatic validation**: inject a `Validator` and validate explicitly:

```java
Set<ConstraintViolation<Bean>> v = validator.validate(bean);
if (!v.isEmpty()) throw new ConstraintViolationException(v);
```

**DB-driven dynamic constraints**: a custom `@Constraint` + `ConstraintValidator` that reads a regex/rule from a repository at validate time.

**Custom messages**: a `ReloadableResourceBundleMessageSource` wired into `LocalValidatorFactoryBean.setValidationMessageSource`.

**Top gotchas**:
- Boot 2.3+ removed the validator from `spring-boot-starter-web` — add `spring-boot-starter-validation` explicitly.
- `@Valid` cannot select validation groups; `@Validated` can.
- Constraint annotations on a method/class need `@Validated` on the bean for method-level validation to activate.

**Current (mid-2026)**: constraints moved from `javax.validation.constraints.*` to `jakarta.validation.constraints.*` in Boot 3; the API and groups model are otherwise unchanged. Pair with native `ProblemDetail` for RFC 9457 error bodies (see [spring-boot/error-handling](error-handling.md)).

## Full content

Spring Boot integrates Jakarta Bean Validation (JSR-380, Hibernate Validator as the reference implementation) across the web and service layers. The corpus demonstrates four distinct validation surfaces.

### Controller-level validation

Annotating a `@RequestBody` or command object with `@Valid` triggers validation before the handler body runs. In a REST controller the failure surfaces as `MethodArgumentNotValidException`, which a handler walks (`getBindingResult().getFieldErrors()`) into a field→message map returned as a 400. In a form-rendering MVC controller, a `BindingResult` parameter immediately after the validated object captures the errors so the view can re-render with messages.

### Validation groups

A single DTO can carry constraints that apply only in some contexts. Marker interfaces tag constraints (`@NotNull(groups = BasicInfo.class)`), and the handler activates a group with Spring's `@Validated(BasicInfo.class)`. The plain JSR-380 `@Valid` has no group selector, so `@Validated` is required here.

### Service-layer and dynamic validation

Beyond annotations on inbound DTOs, a service can validate programmatically by injecting a `Validator` and calling `validate()`, throwing `ConstraintViolationException` on any violations. For rules that live in data rather than code, a custom `@Constraint` annotation backed by a `ConstraintValidator` can read a regex or rule set from a repository at validation time. Validation messages are customizable through a `MessageSource` wired into `LocalValidatorFactoryBean`.

### Latent corpus bugs (teaching code)

Note the corpus's own demonstration bugs: `spring-boot-validation`'s `addUserAccount` persists the *invalid* account and then throws; `OrderController.validateProductsExistence` constructs an exception it never throws. These are teaching artifacts, not patterns to copy.

### 2026 currency

- **`javax.validation` → `jakarta.validation`.** All constraint annotations and the `Validator`/`ConstraintViolation` API moved to the `jakarta.*` namespace in Boot 3 / Spring 6; any 2021 sample must migrate. The constraint set, groups, and `ConstraintValidator` model are otherwise unchanged. [Spring Boot 4.0 Migration Guide](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)
- **Validator still not in `-starter-web`.** The Boot 2.3+ removal of the validator from `spring-boot-starter-web` still holds — depend on `spring-boot-starter-validation` explicitly. [Spring Boot 4.0.0 available now](https://spring.io/blog/2025/11/20/spring-boot-4-0-0-available-now/)
- **Validation failures pair with native `ProblemDetail`** (Spring 6.0 / RFC 9457) for standardized error bodies, replacing the third-party Zalando Problem library. [Spring MVC error responses reference](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-rest-exceptions.html)
