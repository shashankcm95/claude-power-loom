---
kb_id: spring-core/bean-lifecycle-extension
version: 1
tags:
  - spring-core
  - bean-lifecycle
  - container-internals
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-core-3 / spring-core-4 / spring-core-2"
  - "Spring Framework Versions (official wiki, github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)"
related:
  - spring-core/ioc-container-di
  - spring-core/spring-aop
status: active
---

## Summary

**Concept**: Container extension points + lifecycle callbacks let code hook bean creation, mutate definitions, and react to context events.
**Key APIs**: `BeanPostProcessor`, `BeanFactoryPostProcessor`, `FactoryBean<T>` (`&name`), `*Aware` callbacks, `@PostConstruct`/`@PreDestroy`, `InitializingBean`, custom `Scope`, `ApplicationEvent`/`@EventListener`.
**Gotcha**: a `BeanFactoryPostProcessor` `@Bean` method must be `static`; the async event multicaster bean must be named exactly `applicationEventMulticaster`.
**2026-currency**: All extension points transfer 1:1 to Spring 6/7; `@PostConstruct`/`@PreDestroy` move from `javax.annotation` to `jakarta.annotation`.
**Sources**: Baeldung `spring-core-3`/`spring-core-4`; Spring Framework wiki.

## Quick Reference

**Lifecycle hooks** (in order): construction → dependency injection → `*Aware` callbacks → `BeanPostProcessor.postProcessBeforeInitialization` → `@PostConstruct` → `InitializingBean.afterPropertiesSet` → `@Bean(initMethod)` → `BeanPostProcessor.postProcessAfterInitialization` → (in use) → `@PreDestroy` → `DisposableBean.destroy` → `@Bean(destroyMethod)`. `@PreDestroy` runs only on context close / shutdown-hook (NOT for prototype beans). `@PostConstruct` may be private.

**Extension points**:
- `BeanPostProcessor` — per-bean before/after init; sees AOP-proxied beans (unwrap via `AopUtils.isJdkDynamicProxy` + `Advised.getTargetSource().getTarget()` before reading annotations).
- `BeanFactoryPostProcessor` (BFPP) — mutates bean *definitions* before instantiation; its `@Bean` method should be `static` or the enclosing `@Configuration` instantiates too early (its own BPP-processing bypassed).
- `FactoryBean<T>` — `getObject` / `getObjectType` / `isSingleton`; `&beanName` retrieves the factory itself, not its product.
- `BeanDefinitionCustomizer` — tweaks a definition during functional registration.

**`*Aware` callbacks**: `BeanNameAware`, `BeanFactoryAware`, `ApplicationContextAware`.

**Custom scopes**: implement `Scope`, register via a `BeanFactoryPostProcessor` calling `registerScope(name, scope)`. Use a scoped proxy (`@Scope(scopeName="...", proxyMode=TARGET_CLASS)`) to inject a shorter-lived bean into a singleton.

**Prototype-into-singleton** (naive injection captures ONE instance for the singleton's life) — the four fixes:
1. `@Lookup` method injection
2. `jakarta.inject.Provider<T>.get()`
3. `ObjectFactory`
4. scoped proxy (`proxyMode=ScopedProxyMode.TARGET_CLASS`)

**Spring events**: custom `ApplicationEvent` + `ApplicationEventPublisher.publishEvent` + `ApplicationListener<T>`; annotation-driven `@EventListener` (SpEL `condition`); `@TransactionalEventListener(phase=...)` fires only inside a transaction; context lifecycle events (`ContextStartedEvent`/`ContextStoppedEvent`) via `@EventListener` + `@Order`. Async events need a `SimpleApplicationEventMulticaster` bean named exactly `applicationEventMulticaster` + a task executor.

**Top gotchas**:
- BFPP `@Bean` methods that are non-`static` instantiate the config too early.
- A `BeanPostProcessor` constructor annotated `@Lazy` restores auto-proxy eligibility.
- Generic events lose their type parameter to erasure unless the event extends `ApplicationEvent` or implements `ResolvableTypeProvider`.
- `@TransactionalEventListener` does nothing outside a transaction.

**Current (mid-2026)**: All extension points carry to Spring 6/7. `@PostConstruct`/`@PreDestroy` are now `jakarta.annotation`; `Provider` is `jakarta.inject`. Java 17 baseline.

## Full content

The container exposes well-defined seams for intercepting and customizing bean creation. The distinction between a `BeanPostProcessor` (operates on bean *instances*) and a `BeanFactoryPostProcessor` (operates on bean *definitions*) is the load-bearing one: BFPP runs first and can change what gets created; BPP runs per-instance and can wrap or decorate (AOP auto-proxying is itself a `BeanPostProcessor`).

### FactoryBean and the `&` prefix

A `FactoryBean<T>` is a bean that produces another bean: `getObject()` returns the product, `getObjectType()` declares its type, `isSingleton()` controls caching. Asking the context for `beanName` returns the product; asking for `&beanName` returns the factory itself.

### Custom scopes and prototype-into-singleton

A custom `Scope` (e.g. a tenant scope) is registered through a `BeanFactoryPostProcessor` calling `registerScope`. The recurring prototype-into-singleton trap — injecting a prototype directly into a singleton captures a single instance for the singleton's lifetime — has four canonical fixes (`@Lookup`, `Provider.get()`, `ObjectFactory`, scoped proxy), all of which re-resolve the prototype per access.

### The event system

Spring's observer model spans programmatic (`ApplicationEvent` + `ApplicationListener`) and annotation-driven (`@EventListener`) styles. Two subtleties recur: async multicasting requires a bean named *exactly* `applicationEventMulticaster`, and generic event types are erased unless the event carries its own type information.

### Pitfalls

- A `BeanFactoryPostProcessor` declared via a non-`static` `@Bean` method forces premature `@Configuration` instantiation, bypassing its own post-processing.
- A `BeanPostProcessor` sees beans *after* AOP proxying; reading annotations off a proxy without unwrapping reads the proxy, not the target.

### 2026 currency

The extension-point and lifecycle model is in the base doc's durable core and the 2026 Update's "carries forward unchanged" list. The migration is namespace-only:

- **`javax.annotation → jakarta.annotation`** for `@PostConstruct`/`@PreDestroy`, **`javax.inject → jakarta.inject`** for `Provider`, on the Spring 6.0+ Jakarta EE 9+ baseline. [Spring Framework Versions (official wiki)](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)
- **Java 17 baseline** for Spring 6/7; current Spring Framework is 7.0.8 (2026-06-08), Spring Boot 4.1.0 (2026-06-10). [Spring Framework | endoflife.date](https://endoflife.date/spring-framework) · [Spring Boot | endoflife.date](https://endoflife.date/spring-boot)
