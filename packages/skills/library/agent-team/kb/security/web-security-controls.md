---
kb_id: security/web-security-controls
version: 1
tags:
  - security
  - spring-security
  - web
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: spring-security-config/cors, spring-security-config/cache-control, spring-security-web-mvc, spring-5-security/xss, spring-security-web-login, spring-security-web-persistent-login, spring-security-web-rest"
  - "What's New in Spring Security 7.0 (https://docs.spring.io/spring-security/reference/7.0/whats-new.html)"
related:
  - security/spring-security-config-model
  - security/spring-session-ldap
status: active
---

## Summary

**Concept**: The cross-cutting web-security controls Spring Security configures around the auth core — CSRF, CORS, response headers, XSS, channel/TLS, the login/logout lifecycle handlers, custom filters, sessions, and remember-me.
**Key APIs**: `csrf().disable()`/`CookieCsrfTokenRepository.withHttpOnlyFalse()`, `http.cors()`, `headers()`/`ClearSiteDataHeaderWriter`/`contentSecurityPolicy(...)`, `requiresChannel().requiresSecure()`, `AuthenticationSuccessHandler`/`AuthenticationEntryPoint`, `addFilterBefore/After(...)`, `sessionManagement()`, `PersistentTokenBasedRememberMeServices`.
**Gotcha**: `http.cors()` must wire CORS into the security filter chain or the credential-less preflight `OPTIONS` 401s before MVC `@CrossOrigin` runs; `.csrf().disable()` is pervasive and a genuine risk for cookie-session browser apps.
**2026-currency**: SS 7.0 adds a first-class SPA CSRF DSL `http.csrf(c -> c.spa())`; `X-XSS-Protection` is defaulted to 0 (browsers dropped it) — CSP is the live mechanism; OWASP ESAPI unmaintained, Jsoup `Whitelist` -> `Safelist`.
**Sources**: Baeldung `spring-security-config/cors`, `spring-security-web-mvc`, `spring-5-security/xss`; Spring Security 7.0 What's New.

## Quick Reference

**CSRF**: on by default; `csrf().disable()` everywhere in demos (acceptable for stateless token APIs, a real risk for cookie-session browser apps). Custom `CsrfTokenRepository` (JWT-backed); `CookieCsrfTokenRepository.withHttpOnlyFalse()` is the SPA-friendly idiom.

**CORS**: `http.cors()` must wire CORS *into the security filter chain* or the unauthenticated preflight `OPTIONS` 401s before MVC `@CrossOrigin` ever applies. Three ways to configure: `@CrossOrigin`, global `addCorsMappings`, `CorsWebFilter`/`CorsConfigurationSource`.

**Response headers**: default aggressive `Cache-Control: no-cache,no-store,...` on secured responses (override per-endpoint with `ResponseEntity...cacheControl(CacheControl.maxAge/noStore)`); `Clear-Site-Data` on logout (`ClearSiteDataHeaderWriter` + `HeaderWriterLogoutHandler`); CSP via `contentSecurityPolicy(...)`; the obsolete `X-XSS-Protection` (`xssProtection()`).

**XSS**: an input-stripping filter (`HttpServletRequestWrapper` + OWASP ESAPI canonicalize + Jsoup `Whitelist.none()`) — a heavyweight/niche pattern; modern advice is context-aware *output* encoding.

**Channel / TLS**: `requiresChannel().requiresSecure()`; `server.ssl.*` (PKCS12/JKS keystore, `key-alias`, `enabled-protocols`); mTLS via `client-auth=need` + truststore.

**Login/logout handlers**: `AuthenticationSuccessHandler` (role-based redirect, `SavedRequestAware`), `AuthenticationFailureHandler` (JSON+401 for REST), `AccessDeniedHandler` (custom 403), `LogoutHandler`/`LogoutSuccessHandler` (`HttpStatusReturningLogoutSuccessHandler` for SPAs), `AuthenticationEntryPoint` (`RestAuthenticationEntryPoint` -> 401 no-redirect; `BasicAuthenticationEntryPoint` realm challenge).

**Custom filters**: `addFilterBefore/After(..., XFilter.class)` relative to a well-known filter (`BasicAuthenticationFilter`, `UsernamePasswordAuthenticationFilter`, `FilterSecurityInterceptor`); `GenericFilterBean`; `DelegatingFilterProxy`. Enumerate via `FilterChainProxy.getFilterChains()`.

**Sessions**: session fixation (`migrateSession`/`none`), `sessionCreationPolicy` (`STATELESS`/`IF_REQUIRED`), concurrent-session control (`maximumSessions` + `HttpSessionEventPublisher`), cookie hardening (`HttpOnly`/`Secure`).

**Remember-me**: simple hash-based (`rememberMe().key(...).tokenValiditySeconds(...)`) vs production-grade persistent token (`PersistentTokenBasedRememberMeServices` + `JdbcTokenRepositoryImpl` + `persistent_logins(username, series PK, token, last_used)`). Still current in SS 6.

**Top gotchas**:

- CORS preflight 401 (above).
- `.csrf().disable()` is a genuine vulnerability for cookie-session apps (`spring-social-login`, `spring-security-auth0`, React/WebSocket modules).
- `defaultSuccessUrl(url, true)` — the `true` forces redirect even when a saved request exists.
- Casting `getPrincipal()` to `UserDetails` -> `ClassCastException` when the principal is a bare `String` (anonymous).
- Async context: `SecurityContextHolder` is `MODE_THREADLOCAL`, invisible in `@Async`/`Callable` threads — wrap with `DelegatingSecurityContextAsyncTaskExecutor`.

**Current (mid-2026)**: SS 7.0 `http.csrf(c -> c.spa())` replaces the manual `withHttpOnlyFalse()` SPA hack; `X-XSS-Protection` defaulted to 0; CSP is the live mechanism.

## Full content

The web-security surface is the densest area of the corpus (~25 modules). CSRF is on by default but disabled in nearly every demo — fine for stateless token APIs, a genuine vulnerability for cookie-session browser apps; the SPA-friendly idiom is `CookieCsrfTokenRepository.withHttpOnlyFalse()`. CORS must be wired into the security filter chain via `http.cors()`, or the credential-less preflight `OPTIONS` is 401'd before MVC `@CrossOrigin` runs — a recurring trap. Response headers cover the default aggressive cache-control on secured responses, `Clear-Site-Data` on logout, CSP, and the obsolete `X-XSS-Protection`. The login/logout lifecycle is a family of handlers (`AuthenticationSuccessHandler`, `AuthenticationFailureHandler`, `AccessDeniedHandler`, `LogoutSuccessHandler`, `AuthenticationEntryPoint`) configurable for both browser-redirect and REST-401 modes. Custom filters are inserted relative to well-known chain filters. Session management covers fixation protection, creation policy, concurrent-session control, and cookie hardening. Remember-me ranges from a simple hash to a production-grade persistent token backed by the `persistent_logins` table. Evidence: `spring-security-config/cors/.../config/WebSecurityConfig.java`, `spring-security-config/cache-control/.../ResourceEndpoint.java`, `spring-security-web-mvc/.../clearsitedata/SpringSecurityConfig.java`, `spring-5-security/xss/{XSSRequestWrapper,XSSFilter}.java`, `spring-security-web-login/.../security/{CustomAccessDeniedHandler,CustomAuthenticationFailureHandler}.java`, `spring-security-web-persistent-login/.../webSecurityConfig.xml` + `persisted_logins_create_table.sql`.

REST-API extras include `@ControllerAdvice`/`ResponseEntityExceptionHandler` structured `ApiError` bodies and async `SecurityContext` propagation — `DelegatingSecurityContextAsyncTaskExecutor` is required because `SecurityContextHolder` is `MODE_THREADLOCAL` and the context is invisible in `@Async`/`Callable` threads. View-layer integration uses the Thymeleaf security dialect (`sec:authorize`, `sec:authentication`) and SPA patterns over form-login or stateless Basic. WebSocket/STOMP security uses `AbstractSecurityWebSocketMessageBrokerConfigurer.configureInbound`. Reactive (WebFlux) security uses `@EnableWebFluxSecurity` + `ServerHttpSecurity`.

### 2026 currency

- **SPA-friendly CSRF DSL.** The corpus's manual `CookieCsrfTokenRepository.withHttpOnlyFalse()` SPA hack is replaced by a first-class `http.csrf(csrf -> csrf.spa())` in SS 7.0. [What's New in Spring Security 7.0](https://docs.spring.io/spring-security/reference/7.0/whats-new.html)
- **`X-XSS-Protection` is dead; CSP is the live mechanism.** Browsers dropped support; Spring Security defaults `X-XSS-Protection` to `0`. OWASP ESAPI is unmaintained; Jsoup `Whitelist` -> `Safelist`. Modern XSS advice is context-aware *output* encoding, not the corpus's input-stripping filter. [What's New in Spring Security 7.0](https://docs.spring.io/spring-security/reference/7.0/whats-new.html)
- **Async/thread context is shifting.** Java 21 LTS made virtual threads GA and Java 25 LTS finalized Scoped Values (a `ThreadLocal` replacement) — both interact with `SecurityContextHolder`'s `ThreadLocal` model and the `DelegatingSecurityContextAsyncTaskExecutor` workaround. [Java 25 LTS (JetBrains blog)](https://blog.jetbrains.com/idea/2025/09/java-25-lts-and-intellij-idea/)
- **WebFlux static-resource authorization-bypass CVE.** CVE-2024-38821 affects SS 5.7.0-6.3.3; fixed per line (5.7.13 / 5.8.15 / 6.0.13 / 6.1.11 / 6.2.7 / 6.3.4). [spring.io/security/cve-2024-38821](https://spring.io/security/cve-2024-38821/), [GHSA-c4q5-6c82-3qpw](https://github.com/advisories/GHSA-c4q5-6c82-3qpw)
- **Carries forward unchanged**: persistent remember-me (`PersistentTokenBasedRememberMeServices` + `persistent_logins`), `CacheControl` + default headers, `ClearSiteDataHeaderWriter`, `server.ssl.*` TLS, session-fixation defense, and the CSRF/CORS mental model. The class names changed; the controls did not. [What's New in Spring Security 7.0](https://docs.spring.io/spring-security/reference/7.0/whats-new.html)
- **WebSocket message security** moved to `@EnableWebSocketSecurity` + `AuthorizationManager` (replacing `AbstractSecurityWebSocketMessageBrokerConfigurer.configureInbound`); `springfox`/Swagger 2 in the REST module is dead, replaced by springdoc-openapi. [What's New in Spring Security 7.0](https://docs.spring.io/spring-security/reference/7.0/whats-new.html), [springdoc.org](https://springdoc.org/)
