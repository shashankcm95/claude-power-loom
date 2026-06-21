---
kb_id: microservices/microservice-security
version: 1
tags:
  - microservices
  - security
  - jwt
  - oauth2
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: jhipster, jhipster-uaa, jhipster-5, spring-cloud-security, spring-cloud-bootstrap, spring-cloud-rest"
  - "Spring Authorization Server 1.5.8 + OAuth 2.1/OIDC (spring.io/projects/spring-authorization-server)"
related:
  - microservices/api-gateway
  - microservices/declarative-http-clients
  - microservices/centralized-config
status: active
---

## Summary

**Concept**: Distributed auth elaborates single-app auth across service boundaries — the corpus shows three models: shared-secret HS512 JWT, OAuth2 + UAA with asymmetric RSA JWTs, and federated/remote authentication. The edge gateway relays tokens downstream.
**Key APIs**: shared-secret `Jwts.builder().signWith(HS512, secret)` + `JWTFilter`/`JWTConfigurer`; UAA `@EnableAuthorizationServer`/`@EnableResourceServer`, `JwtTokenStore`/`JwtAccessTokenConverter`, RSA `KeyStoreKeyFactory`, `/oauth/token_key`; Feign token relay (`@AuthorizedFeignClient` vs `@AuthorizedUserFeignClient`).
**Gotcha**: shared-secret HS512 means one leaked secret forges tokens for EVERY service; the two Feign auth strategies look identical but one forwards the user token and one makes a machine `client_credentials` call — choosing wrong drops user identity.
**2026-currency**: Spring Security OAuth (`@EnableAuthorizationServer` etc.) is removed -> Spring Authorization Server (OAuth 2.1 + OIDC); `WebSecurityConfigurerAdapter` -> `SecurityFilterChain`; jjwt 0.9 -> 0.12+ immutable parser.
**Sources**: Baeldung `jhipster-uaa`/`spring-cloud-security`; Spring Authorization Server.

## Quick Reference

**Model 1 — shared-secret HS512 JWT** (symmetric): one secret distributed via central config; each service verifies tokens locally and reconstructs `Authentication` from claims (no session, no DB-per-request).
```java
Jwts.builder().setSubject(user).claim("auth", roles).signWith(SignatureAlgorithm.HS512, secret);
// JWTFilter extends GenericFilterBean strips "Bearer ", sets SecurityContextHolder
// JWTConfigurer.addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class)
```

**Model 2 — OAuth2 + UAA, asymmetric RSA JWTs**: a dedicated authorization server (`@EnableAuthorizationServer`) signs with an RSA private key from a keystore (`KeyStoreKeyFactory`); resource servers (`@EnableResourceServer`) fetch the public key from `/oauth/token_key` to verify (no shared secret). The gateway holds tokens in cookies + transparent refresh. Downstream relay via Feign interceptor:
- `@AuthorizedFeignClient` -> machine `client_credentials` token (`OAuth2FeignRequestInterceptor`).
- `@AuthorizedUserFeignClient` -> forwards the user's token (`OAuth2AuthenticationDetails.getTokenValue()` -> `Authorization: Bearer`).

**Model 3 — federated/remote auth**: a custom `AuthenticationManager` delegates credential checking to an external HTTP service (`RestTemplate.postForEntity`), provisions a local user on success, and still issues local JWTs + roles.

**Edge security**: Zuul pre-filter token relay; gateway form-login + role-based access; distributed sessions (Spring Session + Redis); `CookieCsrfTokenRepository`.

**Top gotchas**:
- Shared-secret HS512 — leaking the one secret forges tokens for every service (Model 2's RSA public-key verification avoids this).
- `@AuthorizedFeignClient` vs `@AuthorizedUserFeignClient` look identical; the user-token interceptor silently sends NO header when `Authentication.getDetails()` isn't an `OAuth2AuthenticationDetails`.
- Committed demo creds everywhere — keystores, plaintext passwords, an unencoded `admin` password under a BCrypt encoder (login throws). Never reuse.

**Current (mid-2026)**: Spring Security OAuth is removed — `@EnableAuthorizationServer`/`@EnableResourceServer`/`JwtTokenStore`/`JwtAccessTokenConverter`/`TokenEnhancer`/`OAuth2RestTemplate` no longer exist. Use **Spring Authorization Server** (OAuth 2.1 + OIDC 1.0, latest 1.5.8) for the server, `spring-boot-starter-oauth2-resource-server` (`JwtDecoder` + JWK-set URI) for resource servers, and the OAuth2 client. `WebSecurityConfigurerAdapter` -> `SecurityFilterChain` bean. jjwt 0.9 -> 0.12+ immutable parser.

## Full content

Microservice security is single-app auth elaborated across service boundaries: a token issued once must be verified by, and relayed between, many services without each one re-authenticating the user. The corpus's main value is three contrasting models side by side, plus the edge-gateway relay patterns.

### The three models

Model 1 (shared-secret HS512) is the simplest: one symmetric secret, distributed via central config, lets every service both sign and verify. The fatal weakness is symmetry — a single leaked secret forges tokens fleet-wide. Model 2 (OAuth2 + UAA) fixes this with asymmetric RSA: only the authorization server holds the private key; resource servers fetch the public key from `/oauth/token_key` and can verify but not forge. Model 3 (federated) delegates credential checking to an external service while still minting local tokens — a bridge pattern for integrating an existing identity backend.

### Token relay and the Feign trap

Across service hops, the user's identity must travel. The gateway relays tokens (Zuul pre-filter or cookie-based), and downstream Feign calls choose one of two interceptors. The trap is that `@AuthorizedFeignClient` (machine `client_credentials`) and `@AuthorizedUserFeignClient` (forward the user token) look nearly identical — picking the wrong one either drops the user's identity or makes an unauthorized machine call, and the user-token interceptor fails silently (no header) when the auth details aren't OAuth2.

### 2026 currency

- **Spring Security OAuth -> Spring Authorization Server.** The EOL `spring-security-oauth` project is gone; Spring Authorization Server implements OAuth 2.1 + OpenID Connect 1.0 and is the current Spring-stack authorization-server project (latest 1.5.8, Jun 9 2026). The whole jhipster-UAA + spring-cloud-security approach is legacy. [Spring Authorization Server project](https://spring.io/projects/spring-authorization-server/) · [SAS releases](https://github.com/spring-projects/spring-authorization-server/releases)
- **`WebSecurityConfigurerAdapter` -> `SecurityFilterChain` bean.** Spring Security 6 removed the adapter; the idiom is a `SecurityFilterChain` `@Bean` with the lambda DSL — `authorizeRequests()` -> `authorizeHttpRequests()`, `antMatchers()` -> `requestMatchers()`, `@EnableGlobalMethodSecurity` -> `@EnableMethodSecurity`. [Spring Security 6 changes (Dan Vega)](https://www.danvega.dev/blog/spring-security-6) · [Spring Security 5->6->7 migration](https://ankurm.com/spring-security-5-to-6-to-7-migration-guide/)
- **jjwt 0.9 -> 0.12+.** In 0.12.0 `JwtParser` became immutable, `Jwts.parser()` returns the builder directly, and `Jwts.parserBuilder()` was removed; the idiom is `Jwts.parser().verifyWith(key).build().parseSignedClaims(token)`, with a `java.security.Key` instead of a `String` secret. [jjwt 0.12 JwtParserBuilder javadoc](https://javadoc.io/doc/io.jsonwebtoken/jjwt-api/0.12.0/io/jsonwebtoken/JwtParserBuilder.html) · [jjwt releases](https://github.com/jwtk/jjwt/releases)
- **JHipster UAA -> OIDC/Keycloak.** Keycloak is JHipster's default OAuth2/OIDC provider; the legacy custom-JWT/UAA path is under-maintained. Current generator line is 8.11.x (May 2025). [JHipster Security docs](https://www.jhipster.tech/security/) · [JHipster 8.11.0 release](https://www.jhipster.tech/2025/05/06/jhipster-release-8.11.0.html)
- **Service mesh provides mTLS** between services at the platform layer, an alternative to in-app token verification for service-to-service trust. [Istio Ambient reaches GA](https://istio.io/latest/blog/2024/ambient-reaches-ga/)
