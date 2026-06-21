---
kb_id: security/oauth2-oidc-spring
version: 1
tags:
  - security
  - oauth2
  - oidc
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: spring-security-oidc, spring-5-security-oauth, cloud-foundry-uaa, spring-5-security-cognito, spring-security-oauth2-sso, oauth2-framework-impl"
  - "Spring Authorization Server moving to Spring Security 7.0 (https://spring.io/blog/2025/09/11/spring-authorization-server-moving-to-spring-security-7-0/)"
related:
  - security/jwt-jose
  - security/federation-sso
status: active
---

## Summary

**Concept**: OAuth2/OIDC in Spring — the modern client + resource-server model (SS 5+), contrasted with the EOL `spring-security-oauth` stack and a hand-rolled MicroProfile auth server.
**Key APIs**: `http.oauth2Login()`, `http.oauth2ResourceServer().jwt()`, config-driven `ClientRegistration` (`spring.security.oauth2.client.*`), `issuer-uri` discovery, `@AuthenticationPrincipal OidcUser`/`Jwt`, `OAuth2AuthorizedClientService`; (legacy) `@EnableAuthorizationServer`/`@EnableOAuth2Sso`/`OAuth2RestTemplate`.
**Gotcha**: The legacy `spring-security-oauth` stack (`@EnableAuthorizationServer`, `@EnableOAuth2Sso`, `OAuth2RestTemplate`, `security.oauth2.*`) is fully EOL/removed — two whole SSO/OIDC corpus modules ride a dead stack.
**2026-currency**: Spring Authorization Server merged into Spring Security 7.0 (`spring-security-oauth2-authorization-server:7.0.x`), enables PKCE by default, adds RFC 7591 dynamic registration; SS 6.5 added DPoP (RFC 9449); SS 7.0 removed the password grant.
**Sources**: Baeldung `spring-security-oidc`, `cloud-foundry-uaa`; spring.io Authorization Server blog.

## Quick Reference

**Modern OAuth2/OIDC client (SS 5+)**:

```java
http.oauth2Login(o -> o.userInfoEndpoint().oidcUserService(svc));
// @AuthenticationPrincipal OidcUser -> getClaims()
// config:
//   spring.security.oauth2.client.registration.<id>.{client-id,client-secret,scope}
//   spring.security.oauth2.client.provider.<id>.issuer-uri  (well-known discovery)
```

`issuer-uri` discovers endpoints/JWKS from `/.well-known/openid-configuration`. `OAuth2AuthorizedClientService`/`OAuth2AuthorizedClient`/`OAuth2AccessToken`; custom `OidcUserService`/`OAuth2UserService`. RP-initiated logout: `OidcClientInitiatedLogoutSuccessHandler(clientRegistrationRepository).setPostLogoutRedirectUri(uri)`.

**Modern resource server**:

```java
http.oauth2ResourceServer().jwt();   // validates bearer JWTs against issuer JWKS
// antMatchers("/read/**").hasAuthority("SCOPE_resource.read");
// read via @AuthenticationPrincipal Jwt / JwtAuthenticationToken.getTokenAttributes()
// config: spring.security.oauth2.resourceserver.jwt.issuer-uri
```

Scopes surface as `SCOPE_*` authorities.

**Request/token customization**: `OAuth2AuthorizationRequestResolver` (decorate `DefaultOAuth2AuthorizationRequestResolver`), `OAuth2AuthorizationCodeGrantRequestEntityConverter`, `OAuth2AccessTokenResponseHttpMessageConverter.setTokenResponseConverter(...)` (e.g. `LinkedinTokenResponseConverter`).

**Reactive**: `WebClient.builder().filter(new ServerOAuth2AuthorizedClientExchangeFilterFunction(...))`; `@RegisteredOAuth2AuthorizedClient("id")`; client-credentials for `@Scheduled` jobs (no user session) needs `UnAuthenticatedServerOAuth2AuthorizedClientRepository` + `setDefaultClientRegistrationId(...)`.

**Legacy / EOL (do NOT seed)**: `@EnableAuthorizationServer` (in-memory `ClientDetailsServiceConfigurer`, grants, `autoApprove`, `tokenKeyAccess`/`checkTokenAccess`), `@EnableOAuth2Sso`, `@EnableOAuth2Client` + `OAuth2RestTemplate` + `AuthorizationCodeResourceDetails`, `PrincipalExtractor`/`AuthoritiesExtractor`, `security.oauth2.*` properties.

**Top gotchas**:

- The corpus has **no** Spring Authorization Server — only the EOL `@EnableAuthorizationServer` and a bespoke MicroProfile server.
- The hand-rolled `oauth2-framework-impl` server has real flaws: non-constant-time client-secret comparison, NPE on forged auth code, codes not single-use (replay), refresh token not rotated, `response_type` validation commented out.

**Current (mid-2026)**: Spring Authorization Server is now part of Spring Security 7.0; PKCE enabled by default; dynamic client registration (RFC 7591); DPoP sender-constrained tokens (RFC 9449) since SS 6.5; opaque-token introspection (`RestClientOpaqueTokenIntrospector`, RFC 7662) since SS 7.1.

## Full content

OAuth2/OIDC is the corpus's protocol layer for delegated authorization and federated authentication. The modern Spring Security 5 model splits into three roles: client (`http.oauth2Login()`, config-driven `ClientRegistration`, `issuer-uri` discovery, `OidcUser`/`OAuth2User` principal), resource server (`http.oauth2ResourceServer().jwt()` validating bearer JWTs against the issuer JWKS, scopes as `SCOPE_*`), and authorization server. The corpus covers client and resource-server well (`spring-security-oidc`, `cloud-foundry-uaa`, `spring-5-reactive-oauth`, `spring-5-security-oauth`) but the authorization-server role only via the EOL `@EnableAuthorizationServer` and a bespoke MicroProfile server (`oauth2-framework-impl`). The legacy `spring-security-oauth` stack — `@EnableAuthorizationServer`, `@EnableOAuth2Sso`, `@EnableOAuth2Client`, `OAuth2RestTemplate`, `PrincipalExtractor`/`AuthoritiesExtractor`, `security.oauth2.*` — is fully EOL; two whole SSO/OIDC modules (`spring-security-oauth2-sso`, `spring-security-legacy-oidc`) ride this dead stack. Evidence: `spring-security-oidc/.../{login,discovery,sessionmanagement}/*`, `cloud-foundry-uaa/cf-uaa-oauth2-{client,resource-server}/*`, `spring-5-security-oauth/.../{oauth2,oauth2request}/*`, `oauth2-framework-impl/oauth2-authorization-server/.../api/{TokenEndpoint,AuthorizationEndpoint,JWKEndpoint}.java`.

The hand-rolled MicroProfile server implements full authorization-code/implicit/refresh_token flows — `/authorize` (consent, `state`, redirect_uri match, scope intersection, 10-min codes), `/token` (Basic client auth, CDI `Instance<AuthorizationGrantTypeHandler>.select(NamedLiteral)` Strategy dispatch), `/jwk` (publishes the RSA public key), Nimbus-signed RS256 tokens — but is educational only, with documented flaws: plaintext non-constant-time client-secret comparison, NPE on unknown/forged auth code, authorization codes not single-use (replay), refresh token not rotated, and `response_type` validation commented out.

### 2026 currency

- **Spring Authorization Server exists — and is now part of Spring Security 7.** The modern answer to the corpus's EOL `@EnableAuthorizationServer` is Spring Authorization Server (OAuth 2.1 + OIDC 1.0), which merged into SS 7.0; from 7.0 the artifact is `org.springframework.security:spring-security-oauth2-authorization-server:7.0.x`. It **enables PKCE by default** and **adds OAuth 2.0 Dynamic Client Registration (RFC 7591)**. [spring.io blog 2025-09-11](https://spring.io/blog/2025/09/11/spring-authorization-server-moving-to-spring-security-7-0/), [What's New in Spring Security 7.0](https://docs.spring.io/spring-security/reference/7.0/whats-new.html)
- **SS 7.0 removed the OAuth 2.0 resource-owner password grant** entirely. [What's New in Spring Security 7.0](https://docs.spring.io/spring-security/reference/7.0/whats-new.html)
- **DPoP (RFC 9449) — sender-constrained tokens.** SS 6.5 added a resource-server `DPoPAuthenticationProvider` (auto-enabled with `oauth2ResourceServer().jwt()`), and Spring Authorization Server added DPoP issuance — hardening bearer tokens against theft/replay. [DPoPAuthenticationProvider (Spring Security javadoc)](https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/oauth2/server/resource/authentication/DPoPAuthenticationProvider.html), [RFC 9449](https://www.rfc-editor.org/info/rfc9449/)
- **Opaque-token introspection client.** SS 7.1 adds `RestClientOpaqueTokenIntrospector` (RFC 7662); the corpus listed token introspection / opaque tokens as absent. [What's New :: Spring Security 7.1](https://docs.spring.io/spring-security/reference/whats-new.html)
- **Token-response client moved to RestClient.** SS 6.4 added `RestClientAuthorizationCodeTokenResponseClient` (replacing `DefaultAuthorizationCodeTokenResponseClient`); SS 7.0 converges servlet/reactive stacks on `RestClient`/`WebClient`, with `RestClient.create(RestTemplate)` as the migration bridge. [RestClient Support for OAuth2 in Spring Security 6.4 (spring.io blog)](https://spring.io/blog/2024/10/28/restclient-support-for-oauth2-in-spring-security-6-4/)
- **The OAuth2/OIDC client model carries forward.** `oauth2Login`, `OidcUser`, `issuer-uri` discovery, `OidcClientInitiatedLogoutSuccessHandler`, `oauth2ResourceServer().jwt()` with `SCOPE_*`, and the authorization-code + PKCE flow shape are all current; only the config-class style changed. [What's New in Spring Security 7.0](https://docs.spring.io/spring-security/reference/7.0/whats-new.html)
