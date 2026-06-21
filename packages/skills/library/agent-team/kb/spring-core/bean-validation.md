---
kb_id: spring-core/bean-validation
version: 1
tags:
  - spring-core
  - validation
  - jsr-380
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: javaxval / spring-mvc-xml"
  - "Spring Framework Versions (official wiki, github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)"
related:
  - spring-core/spring-mvc-web-tier
status: active
---

## Summary

**Concept**: Bean Validation (JSR-380 / Jakarta Validation) declares constraints on fields/params; Spring MVC triggers them on bound objects and method calls.
**Key APIs**: `@Valid`/`@Validated`, JSR-380 constraints (`@NotNull`/`@NotBlank`/`@Size`/`@Email`/`@Pattern`), `BindingResult`, `MethodValidationPostProcessor`, custom `@Constraint` + `ConstraintValidator`, Spring `Validator`.
**Gotcha**: `@NotNull` ≠ `@NotEmpty` ≠ `@NotBlank` (null vs null+empty vs null+empty+whitespace); method-level validation needs `@Validated` on the class AND `MethodValidationPostProcessor`.
**2026-currency**: `javax.validation` → `jakarta.validation` on Spring 6; concepts transfer 1:1.
**Sources**: Baeldung `javaxval`/`spring-mvc-xml`; Spring Framework wiki.

## Quick Reference

**Form / body validation**: `@Valid @ModelAttribute Foo foo, BindingResult result` (inspect `result.hasErrors()`); or `@Valid @RequestBody`. Errors surface in `BindingResult` (controller-handled) or as a `MethodArgumentNotValidException`.

**Built-in constraints**: `@NotNull` / `@NotEmpty` / `@NotBlank` (distinct: null / null+empty / null+empty+whitespace), `@Size`, `@Min`/`@Max`, `@Email`, `@Past`/`@Future`, `@Pattern`, `@Digits`, `@DecimalMin`. Container-element constraints: `List<@NotBlank String>`.

**Method-level validation**: `@Validated` on the class + a `MethodValidationPostProcessor` bean → `@Min`/`@Size` on params fire, throwing `ConstraintViolationException` (map to 400 via `@ControllerAdvice`/`@RestControllerAdvice`). Without BOTH, param constraints are silently ignored.

**Custom constraints**: define `@Constraint(validatedBy = MyValidator.class)` annotation + a `ConstraintValidator<MyAnnotation, T>`. Validators treat `null` as valid by convention (null-ness is `@NotNull`'s concern). Message interpolation: `{min}` / `${expr}` / `ParameterMessageInterpolator`.

**Groups**: `@GroupSequence` + group marker interfaces order/scope validation passes.

**Spring `Validator` (programmatic alternative)**: implement `supports(Class)` + `validate(Object, Errors)` with `ValidationUtils.rejectIfEmptyOrWhitespace(...)`.

**Top gotchas**:
- **`@NotNull` ≠ `@NotEmpty` ≠ `@NotBlank`** — pick by what "absent" means for the field.
- **Method validation needs `@Validated` + `MethodValidationPostProcessor`** — easy to forget the post-processor.
- A custom `ConstraintValidator` should treat `null` as valid and let `@NotNull` enforce presence.

**Current (mid-2026)**: `javax.validation` → `jakarta.validation` on the Spring 6 baseline; Hibernate Validator remains the reference impl. Constraints, custom validators, groups, and method-level validation transfer 1:1. Java 17 floor.

## Full content

Bean Validation separates *declaring* constraints (annotations on the domain/DTO) from *triggering* them (Spring MVC's `@Valid`/`@Validated`, or the JSR `ExecutableValidator`). On a controller, `@Valid` on a bound model or request body runs the constraints and records failures in a `BindingResult`; on a service, class-level `@Validated` plus a `MethodValidationPostProcessor` enables parameter/return-value validation that throws `ConstraintViolationException`.

### The three "empty" constraints

The most-confused trio is `@NotNull` (rejects null only), `@NotEmpty` (rejects null and empty), and `@NotBlank` (rejects null, empty, and whitespace-only strings). Choosing the wrong one lets blank input through. The dual to this is the custom-validator convention: a `ConstraintValidator` treats `null` as *valid* so that nullability stays the single responsibility of `@NotNull`.

### Programmatic Spring Validator

Where JSR-380 constraints don't fit (cross-field rules, context-dependent checks), Spring's `Validator` interface (`supports`/`validate`) registered via `@InitBinder` or `WebDataBinder.setValidator` is the imperative escape hatch.

### 2026 currency

Bean Validation concepts are in the base doc's durable core ("Bean Validation concepts"):

- **`javax.validation → jakarta.validation`** (now "Jakarta Validation") on the Spring Framework 6.0 Jakarta EE 9 baseline; Hibernate Validator continues as the reference implementation. The annotation set, custom-constraint mechanism, groups, and method-level validation transfer 1:1. [Spring Framework Versions (official wiki)](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)
- Validation errors integrate with the new RFC 9457 `ProblemDetail` exception model in Spring 6 MVC (a `MethodArgumentNotValidException` renders as a problem-detail body). [Spring Framework Versions (official wiki)](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)
- **Current versions (mid-2026)**: Spring Framework 7.0.8 / Spring Boot 4.1.0; Jakarta EE 10/11 baselines for 6.2/7.0. [Spring Framework | endoflife.date](https://endoflife.date/spring-framework)
