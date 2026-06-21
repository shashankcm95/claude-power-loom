---
kb_id: web-ui/forms-validation-binding
version: 1
tags:
  - web-ui
  - validation
  - data-binding
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: ninja, vraptor, vaadin, wicket, blade, jooby, grails, javafx"
  - "Hibernate ORM 6.0 Migration Guide (docs.hibernate.org/orm/6.0/migration-guide)"
related:
  - web-ui/action-mvc-frameworks
  - web-ui/component-stateful-ui
  - web-ui/server-side-ui-vaadin-gwt
  - web-ui/micro-functional-frameworks
  - web-ui/jvm-templating-engines
  - web-ui/javafx-desktop-ui
  - web-ui/javax-jakarta-migration
status: active
---

## Summary

**Concept**: Forms, validation, and data binding across the JVM web frameworks — Bean Validation (JSR-303 / Hibernate Validator) wrapped by each framework, plus param/VO binding and the typed-binder pattern of the UI frameworks. The cross-cutting "request data → validated domain object → view" flow.
**Key APIs**: Bean Validation constraints `@NotNull`/`@Size`/`@Email`/`@Pattern`; Ninja `@JSR303Validation` + `Validation.getViolations()`; VRaptor `validator.validate/hasErrors/onErrorRedirectTo`; param binding (Blade `@Param User user`, Jooby `req.params(Employee.class)`, Grails `new Student(params)`, Play Jackson `JsonNode`); typed UI binders (Vaadin `Binder<T>.forField().bind(getter,setter)`, Wicket `PropertyModel<>(bean,"prop")`, JavaFX `PropertyValueFactory`).
**Gotcha**: validate → short-circuit → redirect must actually `return` (VRaptor `AuthController` falls through); `org.hibernate.validator.constraints.Email` is deprecated (use `jakarta.validation.constraints.Email`); JSR-303 `javax.validation` → `jakarta.validation`.
**2026-currency**: `javax.validation` → `jakarta.validation` is the universal floor; Bean Validation 3.0+ / Hibernate Validator 8 are Jakarta-namespaced.
**Sources**: Baeldung framework modules; Hibernate ORM 6 migration guide.

## Quick Reference

**Bean Validation (JSR-303 / Hibernate Validator)** — the shared core, wrapped per framework:
- Entity constraints: `@NotNull`, `@Size(min, max)`, `@Email`, `@Pattern(regexp=…)`.
- Ninja: `@JSR303Validation` on the param + `Validation.getViolations()`.
- VRaptor: `validator.validate(bean)`, `validator.hasErrors()`, `validator.onErrorRedirectTo(this).form()`.

**Param / VO binding** (request → object):
- Blade: `@Param User user` (whole-VO bind).
- Jooby: `req.params(Employee.class)`.
- Grails: `new Student(params)` or `def save(Student s)`.
- Play: Jackson `request.body().asJson()` → `JsonNode`.

**Typed data-binding (UI frameworks)**:
- Vaadin: `Binder<T>.forField(field).withValidator(new StringLengthValidator(...)).bind(getter, setter)`; Flow `binder.bindInstanceFields(this)`.
- Wicket: `PropertyModel<>(bean, "prop")` — reflective read/write.
- JavaFX: `PropertyValueFactory("propName")` + observable properties.
- Tapestry: `Form.recordError` + `AlertManager`.

**The validate → short-circuit → redirect flow**:
- Validate the bean; if errors, record them and redirect back to the form; **otherwise** proceed.
- VRaptor: `validator.onErrorRedirectTo(this).form()`.

**Top gotchas**:
- **Missing `return` on the error branch**: VRaptor `AuthController` redirects on password mismatch but doesn't `return`, so it falls through and still creates the user (a security bug).
- **Magic-by-name binding**: JavaFX `PropertyValueFactory("isEmployed")` must match `getIsEmployed()`/`isEmployedProperty()` or the column is blank; Vaadin `bindInstanceFields` binds by field name.
- `org.hibernate.validator.constraints.Email` is deprecated — use the standard `Email` constraint.

**Current (mid-2026)**: The whole stack moved from `javax.validation` to **`jakarta.validation`** — Bean Validation 3.0+ and Hibernate Validator 8 are Jakarta-namespaced; the corpus's `javax.validation` constraints won't resolve on a current runtime. `org.hibernate.validator.constraints.Email` is deprecated in favor of the standard constraint. See the `javax→jakarta` migration doc.

## Full content

Every framework in this domain needs to turn request data into a validated domain object and surface errors back to a view — and they all converge on **Bean Validation (JSR-303 / Hibernate Validator)** for the validation half, wrapped in framework-specific glue, plus a binding mechanism for the request-data half.

### Bean Validation, wrapped per framework

The constraints are standard annotations on the entity: `@NotNull`, `@Size`, `@Email`, `@Pattern`. Each framework exposes them differently. Ninja annotates the controller param with `@JSR303Validation` and reads `Validation.getViolations()`. VRaptor injects a `Validator` and runs `validator.validate(bean)`, then `validator.hasErrors()` / `validator.onErrorRedirectTo(this).form()`. The pattern is **validate → short-circuit → redirect**: on error, record the violations and redirect back to the form; otherwise continue. The cautionary case is VRaptor's `AuthController`, whose password-mismatch branch redirects but **forgets to `return`**, so execution falls through and the user is created anyway — a validation-bypass bug.

### Param and VO binding

The request-to-object half varies more. Blade binds a whole value object with `@Param User user`; Jooby uses `req.params(Employee.class)`; Grails constructs from the param map (`new Student(params)`) or takes a typed command (`def save(Student s)`); Play parses JSON bodies with Jackson (`request.body().asJson()` → `JsonNode`).

### Typed binders in UI frameworks

The component/server-side-UI frameworks have richer, two-way binders. Vaadin's `Binder<T>` chains `forField(field).withValidator(new StringLengthValidator(...)).bind(getter, setter)`, and Flow adds `bindInstanceFields(this)` to auto-bind by field name. Wicket's `PropertyModel<>(bean, "prop")` reads and writes a bean property reflectively. JavaFX binds table columns via `PropertyValueFactory("propName")` over observable properties (with the name-match trap: it must align with the bean accessor or render blank). Tapestry records form errors with `Form.recordError` surfaced through an `AlertManager`.

### 2026 currency

- **`javax.validation` → `jakarta.validation` is the universal floor.** Bean Validation 3.0+ and Hibernate Validator 8 are Jakarta-namespaced; the corpus's `javax.validation` constraints will not resolve on Spring Boot 3+/Jakarta EE 9+ runtimes. See the `javax→jakarta` migration doc.
- **`org.hibernate.validator.constraints.Email` is deprecated** in favor of the standard `Email` constraint (relevant to VRaptor's usage). The legacy native Hibernate `Criteria`/`Restrictions` query API was [removed in Hibernate ORM 6](https://docs.hibernate.org/orm/6.0/migration-guide/) — the supported path is JPA-standard `jakarta.persistence.criteria`.
- The **binding/validation concepts carry forward**; what changed is the namespace and the validator version beneath the same constraint annotations.
