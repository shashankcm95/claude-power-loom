---
kb_id: security/federation-sso
version: 1
tags:
  - security
  - federation
  - sso
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: spring-security-saml, cas, cas-secured-app, spring-security-sso-kerberos, spring-security-web-x509, spring-security-auth0, spring-security-okta, spring-social-login"
  - "SAML 2.0 Login Overview :: Spring Security (https://docs.spring.io/spring-security/reference/servlet/saml2/login/overview.html)"
related:
  - security/oauth2-oidc-spring
  - security/spring-session-ldap
status: active
---

## Summary

**Concept**: Federation and SSO protocols beyond OAuth — SAML 2.0, CAS, Kerberos/SPNEGO, X.509 mutual TLS, and hosted-IdP SDKs (Auth0, Okta, Cognito, Facebook/Spring Social).
**Key APIs**: SAML extension (`SAMLEntryPoint`/`SAMLProcessingFilter`, `MetadataGenerator`); CAS (`CasAuthenticationEntryPoint`/`Filter`/`Provider`, `Cas30ServiceTicketValidator`); Kerberos (`SpnegoAuthenticationProcessingFilter`, `KerberosServiceAuthenticationProvider`); `http.x509().subjectPrincipalRegex(...)`; Auth0 `mvc-auth-commons`, `okta-spring-boot-starter`.
**Gotcha**: The Spring Security SAML *Extension* (OpenSAML 2) is abandoned — zero code carries forward; Spring Social is EOL since 2018 and can't talk to modern Facebook Graph API.
**2026-currency**: Built-in `spring-security-saml2-service-provider` (`saml2Login()` + `RelyingPartyRegistration`) now on OpenSAML 5 (`OpenSaml5AuthenticationProvider`); SS 7.0 removed OpenSAML 4 and folded Kerberos into core.
**Sources**: Baeldung `spring-security-saml`/`cas`/`spring-security-sso-kerberos`/`spring-security-web-x509`; Spring Security SAML2 docs.

## Quick Reference

**SAML 2.0 Web SSO (SP-initiated, the abandoned extension)**: `spring-security-saml2-core` on OpenSAML 2 — `MetadataGenerator(Filter)`, `SAMLEntryPoint`/`SAMLProcessingFilter`/`SAMLLogoutFilter`, WebSSO profiles, `JKSKeyManager`, IdP metadata via `ExtendedMetadataDelegate` + `FilesystemMetadataProvider`, custom authority mapping by subclassing `SAMLAuthenticationProvider.getEntitlements`.

**CAS SSO**: Apereo CAS server (Gradle WAR-overlay, JSON service registry, JDBC authn, back-channel single logout) + Spring Security CAS client (`CasAuthenticationEntryPoint`/`Filter`/`Provider`, `Cas30ServiceTicketValidator`, `SingleSignOutFilter`).

**Kerberos / SPNEGO**: `SpnegoAuthenticationProcessingFilter` + `SpnegoEntryPoint` (Negotiate challenge), `KerberosServiceAuthenticationProvider` (keytab + service principal via `SunJaasKerberosTicketValidator`) with form-login fallback (`KerberosAuthenticationProvider`); embedded `MiniKdc` integration test; `KerberosRestTemplate` client.

**X.509 / mutual TLS**:

```java
http.x509().subjectPrincipalRegex("CN=(.*?)(?:,|$)").userDetailsService(uds);
```

Maps the cert CN to a user; server `client-auth=need` + truststore for mTLS; the cert IS the credential (empty `UserDetails` password).

**Hosted-IdP SDKs**: Auth0 (`mvc-auth-commons` `AuthenticationController`, JWKS verify, Management API via client_credentials), Okta (`okta-spring-boot-starter` zero-config OAuth2 + management SDK), Amazon Cognito (`oauth2Login` + OIDC `issuerUri`), Facebook via Spring Social (`ProviderSignInController` + `SignInAdapter` bridging into the `SecurityContext`, `ConnectionSignUp` implicit provisioning).

**Top gotchas**:

- The SAML Extension (OpenSAML 2) is abandoned — zero code carries forward; the built-in provider is a completely different, far smaller API.
- Spring Social is EOL (since 2018), does not support modern Facebook Graph API.
- X.509 integration tests are bare `contextLoads()` (no real mTLS/CN assertion); CAS/auth0/social-login have only smoke tests or none.
- `spring-security-auth0` uses `TestingAuthenticationToken` (a test helper) to hold the authenticated principal in production — a hack.
- Committed secrets: real-looking Google/Facebook/GitHub OAuth client secrets, CAS DB password + `passwordEncoder.type=NONE`, UAA RSA/SAML keys, keystore password `changeit`.

**Current (mid-2026)**: built-in SAML2 SP (`saml2Login()` + `RelyingPartyRegistration`) on OpenSAML 5; Kerberos folded into SS 7.0 core; Okta starter 1.4 -> 3.x; Auth0 `mvc-auth-commons` 1.2 -> 1.11+; replace Spring Social with `oauth2Login()`.

## Full content

Federation covers the SSO protocols beyond OAuth, each with a dedicated module (breadth over depth). SAML 2.0 Web SSO uses the abandoned Spring Security SAML Extension on OpenSAML 2: metadata generation, the entry-point/processing/logout filter set, WebSSO profiles, JKS key management, and IdP metadata loading. CAS pairs an Apereo CAS server (WAR overlay, JSON service registry, single logout) with the Spring Security CAS client filters and ticket validator. Kerberos/SPNEGO negotiates via `SpnegoAuthenticationProcessingFilter` and validates a service ticket with a keytab through `SunJaasKerberosTicketValidator`, falling back to form login. X.509 mutual TLS maps a client cert's CN to a user — the cert is the credential, so the `UserDetails` password is empty. Hosted-IdP SDKs wrap Auth0, Okta, Amazon Cognito, and Facebook (via the EOL Spring Social, which bridges social sign-in into the `SecurityContext`). Evidence: `spring-security-saml/.../config/{SamlSecurityConfig,WebSecurityConfig}.java`; `cas/cas-server/...` + `cas-secured-app/.../CasSecuredApplication.java`; `spring-security-sso-kerberos/.../{intro,kerberos}/*`; `spring-security-web-x509/.../X509AuthenticationServer.java`; `spring-security-auth0/.../controller/AuthController.java`, `spring-security-okta/.../controller/*`, `spring-social-login/.../security/{FacebookSignInAdapter,FacebookConnectionSignup}.java`.

The federation modules are thin on real tests: both X.509 integration tests are bare `contextLoads()`; CAS, Auth0, and social-login have only smoke tests or require external running servers. They also concentrate the corpus's "leaked-by-design demo creds" anti-pattern — real-looking OAuth client secrets, Facebook `appId`/`appSecret`, the CAS DB password with `passwordEncoder.type=NONE`, and keystore password `changeit`.

### 2026 currency

- **SAML 2 successor is built-in and advanced to OpenSAML 5.** The abandoned OpenSAML-2 extension is replaced by `spring-security-saml2-service-provider` (`saml2Login()` + `RelyingPartyRegistration`); the built-in provider now uses `OpenSaml5AuthenticationProvider`, SS 7.0 **removed OpenSAML 4 support**, and added a JDBC-based `AssertingPartyMetadataRepository`. [SAML 2.0 Login Overview :: Spring Security](https://docs.spring.io/spring-security/reference/servlet/saml2/login/overview.html), [Authenticating saml2:Responses :: Spring Security](https://docs.spring.io/spring-security/reference/servlet/saml2/login/authentication.html), [What's New in Spring Security 7.0](https://docs.spring.io/spring-security/reference/7.0/whats-new.html)
- **Spring Security Kerberos folded into core.** The corpus's `spring-security-kerberos` "dormant extension" concern is resolved — Kerberos is part of Spring Security 7.0 core. [What's New in Spring Security 7.0](https://docs.spring.io/spring-security/reference/7.0/whats-new.html)
- **Spring Social is EOL since 2018.** It does not support the modern Facebook Graph API; replace with Spring Security OAuth2 Client `oauth2Login()`. [What's New in Spring Security 7.0](https://docs.spring.io/spring-security/reference/7.0/whats-new.html)
- **Hosted-IdP SDK version bumps.** `okta-spring-boot-starter` 1.4 -> 3.x; `com.auth0:mvc-auth-commons` 1.2 -> 1.11+. The `server.ssl.*` TLS properties, PKCS12 keystores, `x509()` configurer, and mTLS remain current (pin TLSv1.3). [What's New in Spring Security 7.0](https://docs.spring.io/spring-security/reference/7.0/whats-new.html)
- **Apereo CAS 6.1.x -> 7.x.** The corpus's CAS server pin is multiple majors stale. [What's New in Spring Security 7.0](https://docs.spring.io/spring-security/reference/7.0/whats-new.html)
