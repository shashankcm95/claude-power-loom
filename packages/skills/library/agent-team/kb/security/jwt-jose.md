---
kb_id: security/jwt-jose
version: 1
tags:
  - security
  - jwt
  - jose
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: jjwt, oauth2-framework-impl, spring-5-reactive-oauth, spring-security-legacy-oidc"
  - "jjwt 0.13.0 — Maven Central (https://central.sonatype.com/artifact/io.jsonwebtoken/jjwt)"
related:
  - security/oauth2-oidc-spring
  - security/applied-cryptography
status: active
---

## Summary

**Concept**: Minting and verifying JSON Web Tokens by hand — JJWT and Nimbus JOSE+JWT — plus the critical "decode is not validate" trap.
**Key APIs**: JJWT `Jwts.builder()...signWith(SignatureAlgorithm.HS256, key).compact()` / `Jwts.parser().setSigningKeyResolver(...).parseClaimsJws(...)`; Nimbus `SignedJWT` + `RSASSASigner`/`RSASSAVerifier`, `JWSHeader.Builder(JWSAlgorithm.RS256)`, `JWTClaimsSet.Builder`.
**Gotcha**: Decode != validate — JJWT's decoder Base64-splits header+payload without checking the signature; `token.split("\\.")[2]` throws `ArrayIndexOutOfBounds` on an unsigned token. Manual `(int) claims.get("exp")` breaks past 2038 / when Jackson deserializes `exp` as `Long`.
**2026-currency**: JJWT 0.7.0 API is removed — current is 0.13.0, split api/impl/jackson, with `parserBuilder()`/`verifyWith(...)`/`signWith(Key, alg)`/`Locator<Key>`; Nimbus is now 10.9.1 with post-quantum (ML-DSA/SLH-DSA) on the 2026 roadmap.
**Sources**: Baeldung `jjwt`, `oauth2-framework-impl`; jjwt Maven Central.

## Quick Reference

**JJWT build / parse**:

```java
// build
String jwt = Jwts.builder()
    .setIssuer("x").setSubject("s").setExpiration(exp)
    .claim("k", v)
    .signWith(SignatureAlgorithm.HS256, key)            // 0.7.0 API — see currency
    .compressWith(CompressionCodecs.DEFLATE)
    .compact();

// parse (validates)
Jws<Claims> jws = Jwts.parser()
    .setSigningKeyResolver(resolver)                    // picks key by alg
    .requireIssuer("x")
    .parseClaimsJws(jwt);
```

`SigningKeyResolverAdapter.resolveSigningKeyBytes(header, claims)` keys selection on `alg`.

**Decode-without-verify (the trap)**: `token.split("\\.")`, Base64-decode `[0]`/`[1]` (header+payload) — this does NOT check the signature. Verify separately: `new DefaultJwtSignatureValidator(alg, key).isValid(header + "." + payload, signature)`.

**Nimbus mint**:

```java
SignedJWT jwt = new SignedJWT(
    new JWSHeader.Builder(JWSAlgorithm.RS256).build(), claimsSet);
jwt.sign(new RSASSASigner(rsaKey));   // RSASSAVerifier to verify
```

RSA keys from PEM via `JWK.parseFromPEMEncodedObjects`.

**JWT-as-CSRF-token** scheme appears in `jjwt` (custom `CsrfTokenRepository` backed by a JWT).

**Top gotchas**:

- **Decode != validate** — returning header/payload without signature verification is the canonical JWT vulnerability.
- `token.split("\\.")[2]` `ArrayIndexOutOfBounds` on an unsigned token.
- Manual OIDC claim validation fragility: `(int) claims.get("exp")` breaks past 2038 and if Jackson deserializes `exp` as `Long` (`spring-security-legacy-oidc`).
- Don't trust the `alg` header — pin the algorithm server-side (algorithm-confusion / `alg:none` attacks).

**Current (mid-2026)**: JJWT 0.7.0 (`signWith(SignatureAlgorithm, byte[])`, `MacProvider`, `TextCodec`, `io.jsonwebtoken.impl.*`) is gone; use 0.13.0 `parserBuilder()`/`verifyWith(...)`/`signWith(Key, alg)`/`Locator<Key>`. Nimbus 7.3 -> 10.9.1.

## Full content

The corpus handles JWT/JOSE by hand in two libraries. JJWT offers a fluent builder (`Jwts.builder()` with registered + custom claims, `signWith(SignatureAlgorithm.HS256, key)`, DEFLATE compression, `.compact()`) and a parser (`Jwts.parser().setSigningKeyResolver(...).requireIssuer(...).parseClaimsJws(...)` returning `Jws<Claims>`), with an alg-keyed `SigningKeyResolverAdapter`. The load-bearing lesson is **decode != validate**: the corpus demonstrates a manual Base64 split that returns header and payload without checking the signature, contrasted with separate verification via `DefaultJwtSignatureValidator`. Nimbus JOSE+JWT mints RS256 tokens with `SignedJWT` + `RSASSASigner`/`RSASSAVerifier`, `JWSHeader.Builder`, and `JWTClaimsSet.Builder`, reading RSA keys from PEM. Evidence: `jjwt/.../controller/{StaticJWTController,DynamicJWTController}.java`, `.../util/JWTDecoderUtil.java`, `.../config/JWTCsrfTokenRepository.java`; `oauth2-framework-impl/.../handler/AbstractGrantTypeHandler.java` (Nimbus).

The corpus has no production-grade JWT-by-hand: `oauth2-framework-impl` (Nimbus, educational, several flaws) and `jjwt` (pinned at 0.7.0) are the only hand-rolled paths; most JWT handling is delegated to the Spring resource server (issuer-uri/JWKS validation). Manual OIDC claim validation in `spring-security-legacy-oidc` is fragile — `(int) claims.get("exp")` breaks past 2038 and when Jackson deserializes `exp` as `Long`.

### 2026 currency

- **JJWT 0.7.0 API is removed.** Current JJWT is `0.13.0` (2025-08-20), split into `jjwt-api` / `jjwt-impl` / `jjwt-jackson`; the modern API is `parserBuilder()` / `verifyWith(...)` / `signWith(Key, alg)` / `Locator<Key>`. The old `signWith(SignatureAlgorithm, byte[])`, `MacProvider`, `TextCodec`, and `io.jsonwebtoken.impl.*` are gone. [jjwt — Maven Central](https://central.sonatype.com/artifact/io.jsonwebtoken/jjwt), [jwtk/jjwt (GitHub)](https://github.com/jwtk/jjwt)
- **Nimbus JOSE+JWT 7.3 -> 10.9.1** (latest on Maven Central). [Maven Central](https://central.sonatype.com/artifact/com.nimbusds/nimbus-jose-jwt)
- **Post-quantum crypto is arriving in the JOSE stack.** Nimbus's 2026 roadmap adds ML-DSA (Dilithium) / SLH-DSA (SPHINCS+) signatures and ML-KEM / HPKE encryption; Bouncy Castle 1.8x ships finalized NIST PQC key formats — PQC is moving from "future" to "shipping" in JVM crypto. [Nimbus roadmap 2026 (connect2id)](https://connect2id.com/blog/nimbus-jose-jwt-roadmap-2026), [BC 1.81 release (PQC PKCS#8)](https://www.bouncycastle.org/resources/bouncy-castle-releases-java-1-81-and-c-net-2-6-1/)
- **JWT structure carries forward unchanged.** Header/payload/signature, claims, and signature verification are still the model; the verify rules (check `iss`, `aud`, `exp`, `nbf`, pin the `alg`) are timeless. The library APIs changed; the concepts did not. [What's New in Spring Security 7.0](https://docs.spring.io/spring-security/reference/7.0/whats-new.html)
