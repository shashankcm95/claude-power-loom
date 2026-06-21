---
kb_id: security/jakarta-security-shiro
version: 1
tags:
  - security
  - jakarta-security
  - apache-shiro
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: java-ee-8-security-api, jee-7-security, apache-shiro"
  - "Jakarta Security 4.0 (Eclipse Foundation, https://jakarta.ee/specifications/security/4.0/)"
related:
  - security/authentication-backends
  - security/authorization-method-acl
status: active
---

## Summary

**Concept**: The non-Spring auth alternatives — Jakarta/Java EE Security (JSR-375) declarative mechanisms and identity stores, and Apache Shiro's `SecurityManager`/`Subject`/`Realm` model.
**Key APIs**: JSR-375 `@BasicAuthenticationMechanismDefinition`/`@FormAuthenticationMechanismDefinition`, `@DatabaseIdentityStoreDefinition`/`@LdapIdentityStoreDefinition`, `IdentityStore`/`CredentialValidationResult`, `Pbkdf2PasswordHash`, `@ServletSecurity(@HttpConstraint)`; Shiro `Subject.login(UsernamePasswordToken)`, `hasRole`/`isPermitted`, custom `Realm`.
**Gotcha**: JSR-375's `CustomAuthentication` demo always returns a valid `admin_role` user without checking the password — a teaching shortcut, not validation; Shiro 1.5.3 has a path-traversal authn-bypass CVE cluster.
**2026-currency**: Jakarta Security 4.0 (part of Jakarta EE 11, 2025) supersedes `javax.security.enterprise`, adds a built-in `@OpenIdAuthenticationMechanismDefinition`; Shiro 1.5.3 -> 1.13.x (1.x) / 2.0 GA.
**Sources**: Baeldung `java-ee-8-security-api`, `apache-shiro`; Jakarta Security 4.0 spec.

## Quick Reference

**Jakarta/Java EE Security (JSR-375)** — declarative, on OpenLiberty:

```java
@ApplicationScoped
@BasicAuthenticationMechanismDefinition(realmName = "...")
@DatabaseIdentityStoreDefinition(
    callerQuery = "...", groupsQuery = "...",
    hashAlgorithm = Pbkdf2PasswordHash.class)
public class AppConfig { }
```

- Authentication mechanisms: `@BasicAuthenticationMechanismDefinition` / `@FormAuthenticationMechanismDefinition` / `@CustomFormAuthenticationMechanismDefinition`.
- Identity stores: `@DatabaseIdentityStoreDefinition` / `@LdapIdentityStoreDefinition` / a custom `IdentityStore` split by `validationTypes()` (`VALIDATE` vs `PROVIDE_GROUPS`) + `priority()`.
- Custom store: `implements IdentityStore` -> `validate(UsernamePasswordCredential)` returns `CredentialValidationResult`.
- `SecurityContext.authenticate(...)` -> `AuthenticationStatus`; `@ServletSecurity(@HttpConstraint(rolesAllowed="admin_role"))` + `request.isUserInRole(...)`.

**Apache Shiro (non-Spring)**:

```java
SecurityUtils.setSecurityManager(new DefaultSecurityManager(realm));
Subject s = SecurityUtils.getSubject();
s.login(new UsernamePasswordToken(u, p));
s.hasRole("admin");
s.isPermitted("articles:compose");   // wildcard permission grammar: articles:*
```

- Model: `SecurityManager`/`Subject`/`Realm`; custom `Realm` (`doGetAuthenticationInfo`/`doGetAuthorizationInfo`), custom `Permission.implies`/`PermissionResolver`; INI config; container-independent sessions.
- Spring Boot starter: `ShiroFilterChainDefinition`, excludes `SecurityAutoConfiguration`. Compared head-to-head with Spring Security.

**Top gotchas**:

- JSR-375 `CustomAuthentication` returns a valid `admin_role` user without checking the password (teaching shortcut).
- Both modules are `javax`-namespace and (for JSR-375) OpenLiberty-specific.
- Shiro 1.5.3 is vulnerable to a path-traversal authn-bypass CVE cluster (the base doc flagged it; confirmed).

**Current (mid-2026)**: Jakarta Security 4.0 (`jakarta.security.enterprise.*`, Jakarta EE 11) adds `@OpenIdAuthenticationMechanismDefinition` (built-in OIDC RP); Apache Shiro 1.13.x (1.x) or 2.0 GA.

## Full content

These are the corpus's non-Spring authentication and authorization frameworks. Jakarta/Java EE Security (JSR-375) is declarative: an `@ApplicationScoped` config bean carries an authentication-mechanism annotation (Basic, Form, or CustomForm) and an identity-store definition (database, LDAP, or a custom `IdentityStore`). A custom store implements `validate(UsernamePasswordCredential)` returning a `CredentialValidationResult`, and is split by `validationTypes()` (`VALIDATE` vs `PROVIDE_GROUPS`) and ordered by `priority()`; `SecurityContext.authenticate(...)` drives programmatic login, and `@ServletSecurity(@HttpConstraint(rolesAllowed))` plus `request.isUserInRole(...)` enforce roles. It runs on OpenLiberty. Apache Shiro is the container-independent alternative: a `SecurityManager`/`Subject`/`Realm` model where `Subject.login(UsernamePasswordToken)` authenticates and `hasRole`/`isPermitted` (with a wildcard permission grammar like `articles:*`) authorize, backed by a custom `Realm` (`doGetAuthenticationInfo`/`doGetAuthorizationInfo`) and optional custom `Permission.implies`/`PermissionResolver`; a Spring Boot starter exists. Evidence: `java-ee-8-security-api/app-auth-*/.../{AppConfig,*IdentityStore*}.java`, `apache-shiro/.../intro/{Main,MyCustomRealm}.java` + `comparison/{shiro,springsecurity}/*`. (The `jee-7-security` module is Spring Security bolted onto a JEE7 app, not pure Jakarta Security.)

Both frameworks carry teaching shortcuts that are not real validation: the JSR-375 `CustomAuthentication` demo returns a valid `admin_role` user regardless of the password supplied. Both are also `javax`-namespace, and Shiro is pinned at a CVE-vulnerable version.

### 2026 currency

- **Jakarta Security 4.0 supersedes JSR-375.** The corpus's `javax.security.enterprise` (Java EE 8 Security API) is superseded by Jakarta Security 4.0 (part of Jakarta EE 11, 2025); the `jakarta.security.enterprise.*` namespace adds a standardized `@OpenIdAuthenticationMechanismDefinition` (built-in OIDC Relying Party), which the corpus's hand-rolled OIDC predates. [Jakarta Security 4.0 (Eclipse Foundation)](https://jakarta.ee/specifications/security/4.0/), [Jakarta EE 11 in Open Liberty](https://openliberty.io/blog/2026/05/27/Jakarta-EE-11-in-Open-Liberty.html)
- **Apache Shiro path-traversal authn-bypass cluster (confirmed).** The corpus's Shiro 1.5.3 is vulnerable to all of the below; minimum safe 1.x is **1.13.0**, and the 2.x branch is now GA:
  - **CVE-2023-22602** — authn bypass with Spring Boot 2.6+ (path-matching mismatch). Fixed Shiro 1.11.0 (or set `spring.mvc.pathmatch.matching-strategy=ant_path_matcher`). [Shiro 1.11.0 release](https://shiro.apache.org/blog/2023/01/13/apache-shiro-1110-released.html)
  - **CVE-2023-34478** — path-traversal authn bypass on non-normalized requests. Fixed 1.12.0 / 2.0.0-alpha-3. [Apache Shiro security reports](https://shiro.apache.org/security-reports.html), [GHSA-pmhc-2g4f-85cg](https://github.com/advisories/GHSA-pmhc-2g4f-85cg)
  - **CVE-2023-46749** — path-traversal authn bypass with path rewriting. Fixed 1.13.0 / 2.0.0-alpha-4 (or keep the default `blockSemicolon`). [GHSA-jc7h-c423-mpjc](https://github.com/advisories/GHSA-jc7h-c423-mpjc)
- **`javax.* -> jakarta.*` is hard baseline.** Spring Framework 7.0 requires Jakarta EE 11-12; there is no `javax.*` servlet/security-enterprise path left in the current line. [Spring Framework | endoflife.date](https://endoflife.date/spring-framework)
