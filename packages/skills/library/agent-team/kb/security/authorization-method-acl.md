---
kb_id: security/authorization-method-acl
version: 1
tags:
  - security
  - spring-security
  - authorization
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: spring-security-core, spring-security-acl, spring-security-web-boot-1, spring-security-web-rest-custom"
  - "CVE-2025-41248 — Spring Security method-security authorization bypass (https://spring.io/security/cve-2025-41248/)"
related:
  - security/spring-security-config-model
  - security/authentication-backends
  - security/jakarta-security-shiro
status: active
---

## Summary

**Concept**: Authorization at three levels — URL, method, and per-instance (domain-object/ACL) — once a user is authenticated.
**Key APIs**: `antMatchers(...).hasRole/hasAuthority/access(SpEL)`; `@EnableGlobalMethodSecurity` -> `@PreAuthorize`/`@PostAuthorize`/`@Secured`/`@RolesAllowed`/`@PreFilter`/`@PostFilter`; Spring Security ACL (`JdbcMutableAclService`, `AclPermissionEvaluator`, `hasPermission(...)`, the 4 `acl_*` tables).
**Gotcha**: The `hasRole` vs `hasAuthority` mismatch — `hasRole('X')`/`roles("X")`/`@WithMockUser(roles=...)` prepend `ROLE_`; `hasAuthority`/`authorities=...` do not. The single most common bug across modules.
**2026-currency**: `@EnableGlobalMethodSecurity` -> `@EnableMethodSecurity` + `AuthorizationManager` SPI; the `AccessDecisionVoter`/`AccessDecisionManager` model is fully gone; CVE-2025-41248/41232/22223 are method-security bypass bugs.
**Sources**: Baeldung `spring-security-core`, `spring-security-acl`; spring.io CVE advisories.

## Quick Reference

**URL authorization** (in the filter chain): `antMatchers("/admin/**").hasRole("ADMIN")`, `.hasAuthority("X")`, `.access(SpEL)`, `.hasIpAddress(...)`, `.anyRequest().authenticated()`.

**Method security** — enable on a `GlobalMethodSecurityConfiguration` subclass:

```java
@EnableGlobalMethodSecurity(prePostEnabled=true, securedEnabled=true, jsr250Enabled=true)
```

enables four annotation families:

- `@PreAuthorize`/`@PostAuthorize` (SpEL: `hasRole`, `hasAuthority`, `hasAnyRole`, argument binding `#id == authentication.principal.id`, `returnObject`)
- `@Secured({"ROLE_X"})` (no SpEL)
- `@RolesAllowed("X")` (JSR-250)
- `@PreFilter`/`@PostFilter` (element-wise collection filtering via `filterObject`, `filterTarget` to pick the collection)

**Meta-annotations** compose reusable rules (`@IsViewer` annotated `@PreAuthorize`); class-level `@PreAuthorize` covers every method.

**Domain-object (ACL / per-instance) security**: `JdbcMutableAclService(ds, BasicLookupStrategy, EhCacheBasedAclCache)` + the 4 ACL tables (`acl_sid`/`acl_class`/`acl_object_identity`/`acl_entry`, bitmask `mask`: 1=READ, 2=WRITE) + `AclPermissionEvaluator` wired into `MethodSecurityExpressionHandler`, consulted via `hasPermission(...)` in `@PreAuthorize`/`@PostAuthorize`/`@PostFilter`.

**Custom extension**: extend `SecurityExpressionRoot`/`DefaultMethodSecurityExpressionHandler` to add domain methods (`isMember(#id)`); `PermissionEvaluator.hasPermission`; secure-by-default via a `MethodSecurityMetadataSource` injecting `DENY_ALL` for any `@Controller` method lacking `@PreAuthorize`/`@PostAuthorize`. Run-As elevation: `RunAsManagerImpl` + `RunAsImplAuthenticationProvider` (shared key) swap in `RUN_AS_*` authorities.

**Testing**: `@WithMockUser(roles=...)` (adds `ROLE_`) vs `(authorities=...)` (raw), `@WithAnonymousUser`, custom `@WithMockX` meta-annotations; missing-auth -> `AuthenticationCredentialsNotFoundException`, denied -> `AccessDeniedException`.

**Top gotchas**:

- `hasRole` vs `hasAuthority` mismatch (the recurring footgun above).
- `@PreFilter`/`@PostFilter` materialize and iterate the whole collection in memory — unsuitable for large/paged result sets.
- Run-As key mismatch -> elevation silently fails authentication.
- IP whitelisting is spoofable — `hasIpAddress(...)` reads the socket peer, not a validated `X-Forwarded-For`.

**Current (mid-2026)**: `@EnableGlobalMethodSecurity` -> `@EnableMethodSecurity`; the voter model (`AccessDecisionVoter`/`UnanimousBased`/`AffirmativeBased`) is fully replaced by `AuthorizationManager`; SS 7.0 removed `AuthorizationManager#check()` (use `#authorize()`).

## Full content

Authorization runs at three granularities. URL authorization lives in the filter chain (`antMatchers(...).hasRole/hasAuthority/access(SpEL)`). Method security, enabled via `@EnableGlobalMethodSecurity`, offers four annotation families plus collection filtering. The `hasRole` vs `hasAuthority` distinction is the single most recurrent bug across modules: `hasRole`, `roles(...)`, and `@WithMockUser(roles=...)` implicitly prepend `ROLE_`, while `hasAuthority` and `authorities=...` do not. Domain-object (ACL) security adds per-instance checks via Spring Security ACL: the four `acl_*` tables, a bitmask permission scheme, `AclPermissionEvaluator` wired into the method-security expression handler, and `hasPermission(...)` calls in SpEL. Evidence: `spring-security-core/.../methodsecurity/service/UserRoleService.java`, `spring-security-acl/.../config/{ACLContext,AclMethodSecurityConfiguration}.java` + `acl-schema.sql`/`acl-data.sql` + `SpringACLIntegrationTest.java`; custom expressions/voters/run-as in `spring-security-web-boot-1/.../roles/{custom,voter,ip}/*` and `spring-security-web-rest-custom`.

Custom expression handlers, voters, and permission evaluators extend the base machinery: a custom `SecurityExpressionRoot` adds domain methods like `isMember(#id)`; secure-by-default is achieved with a `MethodSecurityMetadataSource` injecting `DENY_ALL` for any controller method lacking an explicit `@PreAuthorize`/`@PostAuthorize` (`spring-security-core/denyonmissing`). The legacy `AccessDecisionVoter` + `UnanimousBased`/`AffirmativeBased` `AccessDecisionManager` model is the pre-`AuthorizationManager` infrastructure.

### 2026 currency

- **`@EnableGlobalMethodSecurity` -> `@EnableMethodSecurity`, and the voter model is fully gone.** SS 6 moved to `@EnableMethodSecurity` + the `AuthorizationManager` SPI; SS 7.0 removed `AuthorizationManager#check()` in favor of `#authorize()` and removed the legacy `authorizeRequests`/`AntPathRequestMatcher` — completing the migration off `AccessDecisionVoter`/`AccessDecisionManager`. [What's New in Spring Security 7.0](https://docs.spring.io/spring-security/reference/7.0/whats-new.html)
- **Method-security authorization-bypass CVE family (2024-2025).** Exactly the bug class the corpus's heavy `@PreAuthorize` usage is exposed to:
  - **CVE-2025-41248** — bypass for method-security annotations on parameterized types (`@PreAuthorize` ignored under certain inheritance/generics). Affects SS 6.4.0-6.4.10 and 6.5.0-6.5.4; **fixed 6.4.11 / 6.5.5** (the last *affected* patch is not the fix). [spring.io/security/cve-2025-41248](https://spring.io/security/cve-2025-41248/)
  - **CVE-2025-41249** — companion Spring Framework annotation-detection bypass; fixed 6.2.11 (5.3.45 / 6.1.23 commercial). [Spring Framework security flaws (GBHackers)](https://gbhackers.com/spring-framework-security-flaws/)
  - **CVE-2025-41232** — bypass on private methods (Spring Security Aspects); affects 6.4.0-6.4.5, **fixed 6.4.6**. [spring.io/security/cve-2025-41232](https://spring.io/security/cve-2025-41232/)
  - **CVE-2025-22223** — earlier parameterized-type bypass instance. [spring.io/security/cve-2025-22223](https://spring.io/security/cve-2025-22223/)
- **`@EnableGlobalMethodSecurity` deny-on-missing metadata-source approach is legacy infra** under `@EnableMethodSecurity`; the ACL `hasPermission` model, `PermissionEvaluator`, and custom expression roots remain current (re-registered via `@EnableMethodSecurity`). [What's New in Spring Security 7.0](https://docs.spring.io/spring-security/reference/7.0/whats-new.html)
- **`CVE-2022-22978`** — `RegexRequestMatcher` authorization bypass with `.` (any-char); relevant because the corpus uses regex matchers. [GitLab Advisory CVE-2022-22978](https://advisories.gitlab.com/pkg/maven/org.springframework.security/spring-security-web/CVE-2022-22978/)
