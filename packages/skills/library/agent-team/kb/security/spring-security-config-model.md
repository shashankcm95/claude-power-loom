---
kb_id: security/spring-security-config-model
version: 1
tags:
  - security
  - spring-security
  - configuration
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: spring-security-modules/* (spring-security-web-login, spring-security-web-boot-1/2/3, spring-security-core)"
  - "What's New in Spring Security 7.0 (https://docs.spring.io/spring-security/reference/7.0/whats-new.html)"
related:
  - security/authentication-backends
  - security/authorization-method-acl
  - security/web-security-controls
status: active
---

## Summary

**Concept**: The Spring Security configuration baseline — declaring the filter chain and authentication backend that every secured Spring app rests on.
**Key APIs**: `WebSecurityConfigurerAdapter` + `@EnableWebSecurity` (legacy) -> `SecurityFilterChain` `@Bean` + lambda DSL (modern); `HttpSecurity` fluent DSL (`authorizeRequests`/`authorizeHttpRequests`, `formLogin`, `httpBasic`, `csrf`, `cors`, `sessionManagement`, `x509`).
**Gotcha**: The whole `WebSecurityConfigurerAdapter` + `authorizeRequests` + `antMatchers` + `@EnableGlobalMethodSecurity` quartet is deprecated in SS 5.7 and removed by SS 6/7 — the dominant staleness signal of the 2021 corpus.
**2026-currency**: SS 7.0 removed `authorizeRequests()`, `AntPathRequestMatcher`, the `.and()` chaining method; use `authorizeHttpRequests` + `PathPatternRequestMatcher` + multiple `HttpSecurity` beans.
**Sources**: Baeldung `spring-security-modules/*`; Spring Security 7.0 What's New.

## Quick Reference

**The legacy idiom (2021 corpus, every Spring module)**:

```java
@Configuration @EnableWebSecurity
class SecConfig extends WebSecurityConfigurerAdapter {
  @Override protected void configure(HttpSecurity http) throws Exception {
    http.authorizeRequests()
        .antMatchers("/admin/**").hasRole("ADMIN")
        .anyRequest().authenticated()
        .and().formLogin().loginPage("/login")
        .and().httpBasic();
  }
  @Override protected void configure(AuthenticationManagerBuilder auth) { ... }
}
```

**The modern equivalent (SS 6/7, component-based)**:

```java
@Bean SecurityFilterChain filter(HttpSecurity http) throws Exception {
  http.authorizeHttpRequests(a -> a.requestMatchers("/admin/**").hasRole("ADMIN")
                                   .anyRequest().authenticated())
      .formLogin(Customizer.withDefaults())
      .httpBasic(Customizer.withDefaults());
  return http.build();
}
```

**The `HttpSecurity` DSL surface**: `authorizeRequests().antMatchers(...).hasRole/hasAuthority/permitAll/authenticated/anonymous`, `formLogin()`, `httpBasic()`, `logout()`, `csrf()`, `cors()`, `requiresChannel()`, `sessionManagement()`, `exceptionHandling()`, `headers()`, `x509()`.

**Two coexisting config styles** taught side-by-side: Java config and the XML `<http>` namespace (`security.xml`/`webSecurityConfig.xml`, often pinned to `spring-security-4.2.xsd`). Modules keep one live, the other commented out as `@ImportResource`. Don't conflate them — they often define *different* users/rules.

**Multiple filter chains**: `@Order`-ed nested adapters (each scoped by `antMatcher`) — modern equivalent is multiple `SecurityFilterChain`/`HttpSecurity` `@Bean`s.

**Top gotchas**:

- `@Order`-sensitive multi-chain configs — the most specific `antMatcher` must come first or it is shadowed; a missing `@Override` on `configure` silently fails to override (`spring-security-web-boot-2`).
- Coexisting Java + XML (or legacy + modern OAuth) configs in one module — only one is active.

**Current (mid-2026)**: Spring Security tracks Framework 7 / Boot 4 (GA Nov 2025). The safest single migration target is **Boot 3.5 + Security 6.x** (last 6.x line, commercial support to 2032), with Boot 4 / Security 7 as the forward target.

## Full content

The configuration model is the pervasive baseline that every Spring Security module in the corpus rests on. Each module extends `WebSecurityConfigurerAdapter`, overriding `configure(HttpSecurity)` (the filter chain) and `configure(AuthenticationManagerBuilder)` (the authentication backend), annotated `@EnableWebSecurity`. The `HttpSecurity` fluent DSL declares URL authorization, login mechanisms, and the cross-cutting controls (CSRF, CORS, sessions, channel security, headers, X.509). Evidence: nearly all `spring-security-modules/*`, e.g. `spring-security-web-login/.../config/SecSecurityConfig.java`, `spring-security-web-boot-{1,2,3}`.

The corpus teaches two coexisting config styles throughout: Java config and the XML `<http>` namespace. Modules routinely keep one live and the other as a commented-out `@ImportResource` reference — and the two often define different users and rules, so conflating them is a documented confusion. Multiple filter chains are expressed via `@Order`-ed nested adapters, each scoped by `antMatcher` — a pattern that produces one of the most error-prone gotchas: the most specific matcher must come first or it is shadowed, and a missing `@Override` silently fails to override (`spring-security-web-boot-2`).

### 2026 currency

- **`WebSecurityConfigurerAdapter` is gone, and the removal deepened in 7.0.** Deprecated in Spring Security 5.7 (2022), removed in 6.x. The replacement is a component-based `@Bean SecurityFilterChain` + lambda DSL plus a `UserDetailsManager`/`UserDetailsService`/`AuthenticationManager` bean. SS 7.0 went further: it **removed `authorizeRequests()` outright**, removed `AntPathRequestMatcher`/`MvcRequestMatcher` (use `PathPatternRequestMatcher`), removed the `.and()` DSL chaining method, and removed `AuthorizationManager#check()` (use `#authorize()`). A snippet using `authorizeRequests().antMatchers(...).and()...` fails on all three counts under SS 7. [What's New in Spring Security 7.0](https://docs.spring.io/spring-security/reference/7.0/whats-new.html)
- **Modular `HttpSecurity` beans** replace the corpus's `@Order`-ed `WebSecurityConfigurerAdapter` multi-chain pattern — you can declare multiple `HttpSecurity`/`ServerHttpSecurity` beans per module, resolving the `@Order`-shadowing footgun. [What's New in Spring Security 7.0](https://docs.spring.io/spring-security/reference/7.0/whats-new.html)
- **The stack moved a full major.** Spring Framework 7.0 / Spring Boot 4.0 GA'd in November 2025, and Spring Security has a matching 7.x line; the base doc's "Security 6 / Boot 3" assumption is now one major behind. The safest single migration target today is Boot 3.5 + Security 6.x (last 6.x, commercial support to 2032), with Boot 4 / Security 7 as the forward target. [Spring Framework | endoflife.date](https://endoflife.date/spring-framework), [Spring Boot | endoflife.date](https://endoflife.date/spring-boot)
- **The mental model carries forward unchanged.** A request still traverses an ordered chain of security filters; authentication and authorization remain distinct phases; CSRF/CORS/session-fixation are still defenses you configure. The APIs and class names changed (lambda DSL, `authorizeHttpRequests`, `AuthorizationManager`); the concepts did not. [What's New in Spring Security 7.0](https://docs.spring.io/spring-security/reference/7.0/whats-new.html)
