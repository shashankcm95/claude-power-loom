---
kb_id: security/authentication-backends
version: 1
tags:
  - security
  - spring-security
  - authentication
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: guest/spring-security, spring-security-web-boot-1/2, spring-security-web-rest-custom, spring-5-security/passwordstorage"
  - "What's New in Spring Security 7.0 (https://docs.spring.io/spring-security/reference/7.0/whats-new.html)"
related:
  - security/spring-security-config-model
  - security/authorization-method-acl
  - security/spring-session-ldap
  - security/jakarta-security-shiro
status: active
---

## Summary

**Concept**: How Spring Security loads and verifies a user — the `UserDetails`/`UserDetailsService` model, the authentication providers behind it, and password storage.
**Key APIs**: `inMemoryAuthentication()`/`InMemoryUserDetailsManager`, `JdbcUserDetailsManager`/`jdbcAuthentication()`, custom `UserDetailsService`, custom `AuthenticationProvider` (`authenticate`+`supports`), `DelegatingPasswordEncoder` + `{id}` prefix, `BCryptPasswordEncoder`.
**Gotcha**: No `PasswordEncoder` -> runtime "There is no PasswordEncoder mapped for the id null"; plaintext-equality overrides silently defeat a wired encoder; returning `null` instead of throwing `UsernameNotFoundException` masks failures.
**2026-currency**: BCrypt remains a sound default; SS 7.0 adds Password4j-backed Argon2/Bcrypt/Scrypt/PBKDF2/Balloon encoders. The `UserDetails`/`UserDetailsService` abstraction carries forward unchanged.
**Sources**: Baeldung `guest/spring-security`, `spring-security-web-boot-*`, `spring-5-security/passwordstorage`.

## Quick Reference

**Three backends, taught as a ladder**:

```java
// in-memory (demo default)
auth.inMemoryAuthentication()
    .withUser("u").password("{noop}p").roles("USER");

// JDBC over the default users/authorities schema
auth.jdbcAuthentication().dataSource(ds)
    .usersByUsernameQuery(...).authoritiesByUsernameQuery(...);

// custom UserDetailsService loading from JPA
auth.userDetailsService(myUserDetailsService);
```

**The user model**: `User`/`Role`/`Privilege` JPA entities flattened into `SimpleGrantedAuthority`s, returned as a custom `UserDetails` from `UserDetailsService.loadUserByUsername`. `User.withUsername(...).password("{noop}...").roles(...)` for in-memory.

**Custom `AuthenticationProvider`** (the deepest extension point): implement `authenticate(Authentication)` + `supports(Class)`; return a built `Authentication` on success, `null` to delegate to the next provider. Subclass `DaoAuthenticationProvider`/`AbstractUserDetailsAuthenticationProvider` to reuse machinery.

**Password storage (Spring Security 5+)**: `PasswordEncoderFactories.createDelegatingPasswordEncoder()` produces a `DelegatingPasswordEncoder` keyed by the `{id}` prefix (`{bcrypt}`, `{noop}`, ...). `BCryptPasswordEncoder` is the default; `SCryptPasswordEncoder`, `StandardPasswordEncoder` (legacy), `NoOpPasswordEncoder`/`{noop}` escape hatch. On-login rehash/upgrade via an `AuthenticationSuccessEvent` listener (needs `eraseCredentials(false)`).

**Manual authentication**: `AuthenticationManager.authenticate(token)` then `SecurityContextHolder.getContext().setAuthentication(auth)`, persisted under session key `SPRING_SECURITY_CONTEXT`.

**Top gotchas**:

- No `PasswordEncoder` bean -> "There is no PasswordEncoder mapped for the id null" for bare/plaintext passwords.
- A `CustomDaoAuthenticationProvider` comparing `u.getPassword().equals(password)` despite a `BCryptPasswordEncoder` bean silently defeats the encoder (`spring-security-web-sockets`). Do not copy.
- `UserDetailsService` returning `null` instead of throwing `UsernameNotFoundException` masks failures.
- Mock providers that ignore the input password (accept any credential) are teaching shortcuts, not validation.

**Current (mid-2026)**: SS 7.0 adds `Argon2Password4jPasswordEncoder`, `BcryptPassword4jPasswordEncoder`, `ScryptPassword4jPasswordEncoder`, `Pbkdf2Password4jPasswordEncoder`, `BalloonHashingPassword4jPasswordEncoder` (additive; BCrypt still sound).

## Full content

Authentication backends answer "is this user who they claim to be?" The corpus teaches a ladder: in-memory (`inMemoryAuthentication()`/`InMemoryUserDetailsManager`, the demo default), JDBC (`JdbcUserDetailsManager` over the default `users`/`authorities` schema, or `jdbcAuthentication()` with custom `usersByUsernameQuery`/`authoritiesByUsernameQuery`), and a custom `UserDetailsService` loading from JPA (`User`/`Role`/`Privilege` entities flattened into `SimpleGrantedAuthority`s). The deepest extension point is a custom `AuthenticationProvider` (`authenticate` + `supports`) or a subclass of `DaoAuthenticationProvider`/`AbstractUserDetailsAuthenticationProvider`, returning a built `Authentication` on success and `null` to delegate. Custom login fields beyond username/password are handled either cheaply (concat the extra field into the principal string, split in the service) or properly (a custom `Authentication` token + filter + provider). Programmatic authentication is `AuthenticationManager.authenticate(token)` followed by `SecurityContextHolder.getContext().setAuthentication(auth)`, persisted under `SPRING_SECURITY_CONTEXT`. Evidence: `guest/spring-security/.../config/WebSecurityConfig.java`, `spring-security-web-boot-2/.../jdbcauthentication/*`, `spring-security-web-rest-custom/.../security/CustomAuthenticationProvider.java`, `spring-5-security/loginextrafields{simple,custom}/*`.

Password storage in Spring Security 5 uses a `DelegatingPasswordEncoder` and the `{id}` prefix scheme. The corpus's most dangerous recurring bug is plaintext: many modules ship plaintext in-memory/seed passwords that fail at runtime with "There is no PasswordEncoder mapped for the id null", and at least one (`spring-security-web-sockets`) overrides the provider to compare passwords with `.equals()` despite a `BCryptPasswordEncoder` bean being injected — silently defeating the encoder. Evidence: `spring-5-security/passwordstorage/{PasswordStorageWebSecurityConfigurer,BaeldungPasswordEncoderSetup}.java`.

### 2026 currency

- **`UserDetails`/`UserDetailsService` and `PasswordEncoder` carry forward unchanged.** They remain the user-loading abstraction and per-encoder hashing model; BCrypt remains a sound default. [What's New in Spring Security 7.0](https://docs.spring.io/spring-security/reference/7.0/whats-new.html)
- **New Password4j-backed encoders (SS 7.0).** `Argon2Password4jPasswordEncoder`, `BcryptPassword4jPasswordEncoder`, `ScryptPassword4jPasswordEncoder`, `Pbkdf2Password4jPasswordEncoder`, and `BalloonHashingPassword4jPasswordEncoder` broaden beyond the corpus's BCrypt/SCrypt/`DelegatingPasswordEncoder` set. [What's New in Spring Security 7.0](https://docs.spring.io/spring-security/reference/7.0/whats-new.html)
- **WebAuthn / Passkeys + One-Time-Token login are built in (SS 7.0).** Passwordless authentication is the corpus's biggest "Not covered" gap; SS 7.1 adds WebAuthn authentication-event publishing and conditional MFA for registered users. [What's New in Spring Security 7.0](https://docs.spring.io/spring-security/reference/7.0/whats-new.html), [What's New :: Spring Security 7.1](https://docs.spring.io/spring-security/reference/whats-new.html)
- **Multi-Factor Authentication is first-class.** SS 7.0 adds `AuthorizationManagerFactory.multiFactor()` / `AllRequiredFactorsAuthorizationManager`; 7.1 adds programmatic `when`/`withWhen` and `MultiFactorCondition`. [What's New in Spring Security 7.0](https://docs.spring.io/spring-security/reference/7.0/whats-new.html), [What's New :: Spring Security 7.1](https://docs.spring.io/spring-security/reference/whats-new.html)
- **Virtual threads + Scoped Values context.** Java 21 LTS made virtual threads GA and Java 25 LTS finalized Scoped Values (a `ThreadLocal` replacement) — relevant because `SecurityContextHolder`'s `ThreadLocal` model interacts with both. [Java 25 LTS (JetBrains blog)](https://blog.jetbrains.com/idea/2025/09/java-25-lts-and-intellij-idea/)
