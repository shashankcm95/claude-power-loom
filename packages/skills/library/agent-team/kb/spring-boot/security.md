---
kb_id: spring-boot/security
version: 1
tags:
  - spring-boot
  - security
  - authentication
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-security"
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-jasypt"
  - "Spring Security servlet config reference (docs.spring.io/spring-security/reference/servlet/configuration/java.html)"
related:
  - spring-boot/web-rest-controllers
  - spring-boot/actuator
  - spring-boot/testing
  - spring-boot/api-documentation
status: active
---

## Summary

**Concept**: Securing a Boot app — auto-config + the modern `SecurityFilterChain` config model, method security, testing secured apps, property encryption, and OAuth2/OIDC.
**Key APIs**: `spring-boot-starter-security`, `@Bean SecurityFilterChain` + `authorizeHttpRequests`/`requestMatchers` (lambda DSL), `@EnableMethodSecurity` + `@PreAuthorize`, `PasswordEncoderFactories`/`BCryptPasswordEncoder`, `SecurityMockMvcConfigurers.springSecurity()` + `@WithMockUser`, Jasypt `ENC(...)`.
**Gotcha**: `@EnableWebSecurity` + `WebSecurityConfigurerAdapter` is removed in Spring Security 6 — must use a `SecurityFilterChain` bean.
**2026-currency**: `WebSecurityConfigurerAdapter` → `SecurityFilterChain`; Keycloak adapter → native OAuth2 + Spring Authorization Server.
**Sources**: Baeldung `spring-boot-security` / `-jasypt`; Spring Security servlet config reference.

## Quick Reference

**Auto-config**: `spring-boot-starter-security` auto-wires HTTP Basic + a generated user; opt out with `exclude = SecurityAutoConfiguration.class`.

**Modern config (Spring Security 6 / current)** — a `SecurityFilterChain` bean with the lambda DSL:

```java
@Bean
SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http.authorizeHttpRequests(a -> a
            .requestMatchers("/private/**").hasRole("USER")
            .requestMatchers("/public/**").permitAll())
        .httpBasic(withDefaults());
    return http.build();
}
```

Multiple chains via `@Order` + `securityMatcher`. **The removed 2021 idiom** was `@EnableWebSecurity` + extending `WebSecurityConfigurerAdapter` and overriding `configure(HttpSecurity)` with `authorizeRequests`/`antMatchers`/`.and()`.

**Password encoding**: `PasswordEncoderFactories.createDelegatingPasswordEncoder()` (stores `{bcrypt}`-prefixed) or `BCryptPasswordEncoder`.

**Method security**: `@EnableMethodSecurity(prePostEnabled=true)` (was `@EnableGlobalMethodSecurity`) + `@PreAuthorize("hasRole('USER')")` / `@PreAuthorize("isAuthenticated()")` on service methods.

**Testing secured apps**: `@SpringBootTest` + MockMvc + `SecurityMockMvcConfigurers.springSecurity()`; `@WebMvcTest`; `TestRestTemplate.withBasicAuth(...)`; `@WithMockUser`; profile-based on/off.

**Locking down Actuator**: `EndpointRequest.toAnyEndpoint()` restricted to a role.

**Property encryption (Jasypt)**: `ENC(...)` markers decrypted transparently; `@EnableEncryptableProperties` / `@EncryptablePropertySource`; custom `StringEncryptor` via `jasypt.encryptor.bean`; password supplied externally.

**Top gotchas**:
- `WebSecurityConfigurerAdapter` is deprecated (5.7) and removed (6.0) — porting is mandatory.
- The Keycloak Spring Boot adapter is deprecated/removed; `/auth` context path is gone in Keycloak 17+.

**Current (mid-2026)**: Spring Security 7.1 (7.0 GA 2025-11-17) under Boot 4. Use native OAuth2 client/resource-server for OIDC, and Spring Authorization Server (1.0 GA 2022-11-22, OAuth 2.1 + OIDC) for the authorization-server role. Jasypt's weak default (`PBEWithMD5AndDES`) should be `PBEWITHHMACSHA512ANDAES_256`.

## Full content

Spring Boot's security story is Spring Security, auto-configured. The corpus covers it thinly and on the now-removed configuration model, so the modernization is the most important part of this entry.

### Auto-config and custom config

Adding `spring-boot-starter-security` secures everything with HTTP Basic and a generated password — a sane default that is almost always replaced. The 2021 idiom replaced it by extending `WebSecurityConfigurerAdapter`; the current idiom defines a `SecurityFilterChain` bean and configures `HttpSecurity` with the lambda DSL (`authorizeHttpRequests`, `requestMatchers`), returning `http.build()`. Multiple chains coexist via `@Order` + `securityMatcher`.

### Method security and password storage

`@EnableMethodSecurity` (formerly `@EnableGlobalMethodSecurity`) turns on `@PreAuthorize`/`@PostAuthorize` SpEL-guarded method access. Passwords are stored through a `DelegatingPasswordEncoder` (which prefixes the algorithm, e.g. `{bcrypt}`) so the encoding can evolve without breaking existing hashes.

### Testing

Secured apps are tested with MockMvc + `SecurityMockMvcConfigurers.springSecurity()`, `@WithMockUser` for an authenticated principal, and `TestRestTemplate.withBasicAuth` for full-stack calls. Profiles can disable security in some test runs.

### Property encryption and OIDC

Jasypt encrypts individual property values marked `ENC(...)`, decrypting them transparently at bind time with an externally-supplied password. For federated identity, the corpus only shows the deprecated Keycloak adapter; the modern path is Spring Security's native OAuth2.

### 2026 currency

- **`WebSecurityConfigurerAdapter` → `SecurityFilterChain`.** Deprecated in Spring Security 5.7, removed in 6.0; the component-based `@Bean SecurityFilterChain` with `authorizeHttpRequests`/`requestMatchers` is the only supported model. [Spring Security servlet config reference](https://docs.spring.io/spring-security/reference/servlet/configuration/java.html)
- **Keycloak adapter → native OAuth2 + Spring Authorization Server.** Use Spring Security's OAuth2 client/resource-server, and Spring Authorization Server (1.0 GA 2022-11-22, OAuth 2.1 + OIDC) for the AS role, replacing both the deprecated Keycloak adapter and the EOL Spring Security OAuth. [Spring Authorization Server 1.0 GA](https://spring.io/blog/2022/11/22/spring-authorization-server-1-0-is-now-ga/)
- **Spring4Shell — CVE-2022-22965** (post-snapshot): critical RCE in Spring MVC on JDK 9+, exploitable for WAR-on-Tomcat deployments (the fat-jar default was not vulnerable). Fixed in Spring 5.3.18/5.2.20 or Boot 2.5.12/2.6.6; any supported Boot 3.x/4.x is well past it. [Securelist — Spring4Shell](https://securelist.com/spring4shell-cve-2022-22965/106239/)
- **Current versions**: Spring Security 7.1 (released 2026-06-09; 7.0 GA 2025-11-17) under Boot 4. Jasypt's weak default `PBEWithMD5AndDES` should be replaced by the 3.x default `PBEWITHHMACSHA512ANDAES_256`. [endoflife.date/spring-security](https://endoflife.date/spring-security)
