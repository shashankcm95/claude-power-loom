---
kb_id: spring-core/spring-aop
version: 1
tags:
  - spring-core
  - aop
  - cross-cutting
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-aop / spring-di-2 (aspectj)"
  - "Spring Framework Versions (official wiki, github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)"
related:
  - spring-core/ioc-container-di
  - spring-core/bean-lifecycle-extension
  - spring-core/cache-abstraction
  - spring-core/scheduling-async-retry
status: active
---

## Summary

**Concept**: Proxy-based AOP weaves cross-cutting advice (logging, timing, tx, cache) around Spring-bean method calls without editing the methods.
**Key APIs**: `@Aspect` + `@EnableAspectJAutoProxy`; five advice annotations; pointcut designators; `ProceedingJoinPoint.proceed()`; AspectJ `@Configurable` for unmanaged objects.
**Gotcha**: only EXTERNAL calls to PUBLIC methods of Spring beans are advised — self-invocation and non-public methods are NOT (the caveat shared with `@Cacheable`/`@Async`/`@Transactional`).
**2026-currency**: `@Aspect`, advice types, pointcut designators all carry to Spring 6/7 unchanged (durable core).
**Sources**: Baeldung `spring-aop`; Spring Framework wiki.

## Quick Reference

**Enable**: `@EnableAspectJAutoProxy` on a `@Configuration`; an aspect is `@Aspect` + `@Component`.

**Five advice types**:
- `@Before` — runs before the join point
- `@After` — finally-style, after return or throw
- `@AfterReturning(returning="ret")` — binds the return value
- `@AfterThrowing(throwing="ex")` — binds the thrown exception
- `@Around` — receives a `ProceedingJoinPoint`, MUST call `proceed()` (can short-circuit or alter args/return)

**Pointcut designators**: `execution(...)`, `within(...)`, `@annotation(...)`, `@args(...)`, `@target(...)`; named `@Pointcut` methods; combine with `&&` / `||` / `!`.

**Custom-annotation advice**: define an `@interface` (e.g. `@LogExecutionTime`), then `@Around("@annotation(logExecutionTime)")` binding the annotation as a typed advice parameter.

**Join-point reflection**: cast `joinPoint.getSignature()` to `MethodSignature` to read method / declaring-type / param names+types+values / return type / modifiers / exceptions / annotations.

**XML AOP**: `<aop:config>` / `<aop:aspect>` / `<aop:before|after|after-returning|after-throwing|around>`.

**Built-in monitors**: `PerformanceMonitorInterceptor`, `CustomizableTraceInterceptor`, wired via `AspectJExpressionPointcut` + `DefaultPointcutAdvisor`.

**Spring AOP (runtime proxies) vs AspectJ proper (weaving)**: native `.aj` aspects (or `@Configurable`) woven at compile-time (CTW via `aspectj-maven-plugin`) or load-time (LTW via `META-INF/aop.xml`) advise ANY class, non-public methods, and self-invocation. `@Configurable` / `@EnableSpringConfigured` injects Spring beans into `new`-constructed objects (e.g. JPA entities; `preConstruction=true` for use inside the ctor).

**Top gotchas**:
- **Self-invocation** — a bean calling its own advised method bypasses the proxy; advice does not fire. Same root cause as `@Cacheable`/`@Async`/`@Transactional` self-call.
- A `@Around` aspect throwing a checked exception not declared on the proxied interface gets JDK-wrapped in `UndeclaredThrowableException`.
- Non-public methods are not proxy-advisable under Spring AOP.

**Current (mid-2026)**: Spring AOP is in the durable core — `@Aspect`, the five advice types, pointcut designators, `@EnableAspectJAutoProxy`, and custom-annotation advice are unchanged on Spring 6/7. Java 17 baseline.

## Full content

Spring AOP is proxy-based: the container wraps a Spring-managed bean in a JDK dynamic proxy (interface-based) or a CGLIB subclass proxy (class-based), and the advice runs in the proxy layer. The single most-repeated Spring caveat follows directly from this design: **advice only fires for external calls that pass through the proxy**. A bean calling `this.cachedMethod()` calls the raw target, not the proxy, so `@Cacheable`/`@Async`/`@Transactional`/custom `@Aspect` advice is silently skipped. The same is true for non-public methods.

### When the proxy model is not enough

The proxy limitations are exactly why AspectJ proper exists. Compile-time weaving (CTW) and load-time weaving (LTW) rewrite bytecode, so a woven aspect can advise any class, private methods, and self-invocations. `@Configurable` bridges the two worlds: it injects Spring-managed collaborators into objects created with `new` (commonly JPA entities), which the proxy model cannot reach because those objects never pass through the container.

### Reflection at the join point

Casting `getSignature()` to `MethodSignature` gives an aspect full reflective access to the advised method, enabling generic logging/metric/audit aspects that adapt to any signature.

### 2026 currency

Spring AOP is listed in both the base doc's "still valid as-is (the durable core)" and the 2026 Update's "carries forward unchanged":

- **`@Aspect`, the five advice types, pointcut designators, `@EnableAspectJAutoProxy`, custom-annotation advice** all transfer 1:1 to Spring 6/7; only the `javax.* → jakarta.*` namespace and JDK 17 baseline changed. [Spring Framework Versions (official wiki)](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)
- The self-invocation caveat remains the most-repeated gotcha and recurs at the `@Transactional` seam in the persistence layer. [Spring Framework Versions (official wiki)](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)
- **Current versions (mid-2026)**: Spring Framework 7.0.8 (2026-06-08); Java 17 floor, engineers targeting Java 21/25. [Spring Framework | endoflife.date](https://endoflife.date/spring-framework) · [Oracle JDK | endoflife.date](https://endoflife.date/oracle-jdk)
