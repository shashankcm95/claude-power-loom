---
kb_id: java-runtime/java-crypto-security
version: 1
tags:
  - java-runtime
  - security
  - cryptography
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: core-java-security, core-java-security-2, core-java-security-3"
  - "JEP 452: Key Encapsulation Mechanism API (openjdk.org/jeps/452); NIST SP 800-131A Rev. 2"
related:
  - java-runtime/io-streams
  - java-runtime/networking
status: active
---

## Summary

**Concept**: JCA/JCE applied crypto — symmetric/asymmetric ciphers, hashing, password hashing, KeyStore, TLS, `SecureRandom`, and the JAAS/SASL/GSS auth frameworks.
**Key APIs**: `Cipher.getInstance(transformation)`, `SecretKeySpec`/`KeyGenerator`/`KeyPairGenerator`, `MessageDigest`, `SecretKeyFactory`+`PBEKeySpec` (PBKDF2), `KeyStore`, `SSLContext`/`SSLSocketFactory`, `SecureRandom`, JAAS `LoginContext`.
**Gotcha**: `ECB` mode leaks plaintext structure (`AES/ECB` insecure) — the corpus stops at CBC, never reaching authenticated AES-GCM; MD5/SHA-1 broken for collision resistance; 3DES NIST-disallowed since end-2023.
**2026-currency**: AES-GCM is the correct successor to the CBC ceiling; KEM API (JEP 452, JDK 21) + PQC arriving; `javax.crypto`/`javax.net.ssl` stay `javax` (JDK, not Jakarta).
**Sources**: Baeldung `core-java-security`/`-2`/`-3`; JEP 452; NIST SP 800-131A.

## Quick Reference

**Ciphers**: `Cipher.getInstance(transformation)` (e.g. `AES/CBC/PKCS5Padding`, `RSA/ECB/PKCS1Padding`) -> `init(ENCRYPT_MODE/DECRYPT_MODE, key)` -> `doFinal`. Keys from `SecretKeySpec`/`KeyGenerator`/`KeyPairGenerator`; IV via `SecureRandom` + `IvParameterSpec`. File encryption with `CipherInputStream`/`CipherOutputStream` (IV prepended, 16-byte prefix); `SealedObject` for object encryption; secret-key <-> String round-trip via Base64.

**Hashing**: `MessageDigest` (MD5/SHA-256/SHA3-256), Guava `Hashing`, Commons `DigestUtils`, BouncyCastle (Keccak); checksums (`CRC32`/`CheckedInputStream`).

**Password hashing**: `PBKDF2WithHmacSHA1` via `SecretKeyFactory`/`PBEKeySpec` with a random salt + cost + **constant-time comparison** (the right way; token `$31$<cost>$<base64>`) vs a naive salted SHA-512 (the wrong way).

**KeyStore**: CRUD via `getInstance(type)`/`load`/`store`; secret-key, private-key+cert-chain, and cert entries; `aliases()`. `getDefaultType()` = JKS pre-9, **PKCS12 since 9**. Reading the JDK `cacerts` trust store; PEM reading (strip armor + Base64 + `KeyFactory`).

**TLS / CSPRNG / auth**: `SSLSocketFactory`/`SSLSocket`, `SSLContext`, `SSLParameters`, `HttpsURLConnection`. `SecureRandom.getInstance(SHA1PRNG/NativePRNG)`; the `java.security.egd` entropy option affects seeding latency. JAAS (`LoginModule`/`CallbackHandler`/`LoginContext`/`Subject`/`Principal`), SASL (DIGEST-MD5 challenge/response), GSS-API/Kerberos (`GSSManager`/`GSSContext`). Enumerate providers via `Security.getProviders()` -> `getServices()`.

**Top gotchas**: `AES/ECB` leaks structure (insecure) — corpus never reaches AES-GCM; MD5/SHA-1 broken for collision resistance (checksum-only); 3DES (`DESede`) NIST-disallowed for encryption since end-2023; `SecurityManager` permanently disabled (JEP 486, JDK 24).

**Current (mid-2026)**: use `AES/GCM/NoPadding` + `GCMParameterSpec` (authenticated). KEM API (JEP 452, JDK 21) + post-quantum crypto (ML-KEM/ML-DSA; BouncyCastle 1.82+) are the standards track. `javax.crypto`/`javax.net.ssl`/`javax.security.*` are JDK packages — they stay `javax`.

## Full content

This is the JCA/JCE applied-crypto and auth surface — broad in the corpus (ciphers, hashing, password hashing done right, KeyStore, TLS, JAAS/SASL/GSS, SecureRandom) but with a CBC ceiling and several now-disallowed primitives.

### Ciphers and hashing

`Cipher.getInstance(transformation)` selects an algorithm/mode/padding (e.g. `AES/CBC/PKCS5Padding`, `RSA/ECB/PKCS1Padding`), then `init(ENCRYPT_MODE | DECRYPT_MODE, key)` and `doFinal`. Keys come from `SecretKeySpec`, `KeyGenerator`, or `KeyPairGenerator`; an IV is generated with `SecureRandom` into an `IvParameterSpec`. File encryption streams data through `CipherInputStream`/`CipherOutputStream` and prepends the IV (a 16-byte prefix read back on decrypt); `SealedObject` encrypts a whole object. Evidence: `core-java-security/.../encrypt/FileEncrypterDecrypter.java`, `core-java-security-2/.../aes/AESUtil.java`. Hashing uses `MessageDigest` (MD5/SHA-256/SHA3-256), with Guava `Hashing`, Commons `DigestUtils`, and BouncyCastle Keccak alternatives; `CRC32`/`CheckedInputStream` for non-cryptographic checksums.

### Password hashing and KeyStore

The right way to hash a password is `PBKDF2WithHmacSHA1` via `SecretKeyFactory`/`PBEKeySpec` with a per-user random salt, an iteration cost, and a constant-time comparison (the corpus emits a `$31$<cost>$<base64>` token), explicitly contrasted with a naive salted SHA-512. Evidence: `core-java-security-2/.../passwordhashing/PBKDF2Hasher.java`. `KeyStore` does full CRUD — `getInstance(type)`/`load`/`store`, secret-key / private-key+cert-chain / trusted-cert entries, `aliases()` — and `getDefaultType()` returns JKS before JDK 9 and PKCS12 since. The corpus also reads the JDK `cacerts` trust store and parses PEM files (strip the armor, Base64-decode, feed a `KeyFactory`).

### TLS, randomness, and auth frameworks

TLS uses `SSLSocketFactory`/`SSLSocket`, `SSLContext`, `SSLParameters`, and `HttpsURLConnection`, enabling protocols explicitly. `SecureRandom.getInstance(SHA1PRNG/NativePRNG)` is the CSPRNG, and the `java.security.egd` option tunes the entropy device that affects seeding latency. The auth frameworks are JAAS (`LoginModule`, `CallbackHandler`, `LoginContext`, `Subject`/`Principal`, `doAsPrivileged`), SASL (a DIGEST-MD5 challenge/response with wrap/unwrap), and GSS-API/Kerberos (`GSSManager`/`GSSContext`). Available algorithms are enumerable by iterating `Security.getProviders()` then `getServices()`.

### 2026 currency

- **AES-GCM is the correct successor to the corpus's AES/CBC ceiling** — `AES/GCM/NoPadding` + `GCMParameterSpec` adds authentication; `AES/ECB` leaks plaintext structure and should never be used. (Standard JCA, stated by inference — not a 2022+ feature.)
- **3DES / `DESede` is disallowed**: per NIST SP 800-131A, three-key TDEA encryption was deprecated through 2023-12-31 and is now disallowed (decryption permitted for legacy use only); SP 800-67 Rev. 2 is being withdrawn. [NIST: Withdraw SP 800-67 Rev. 2](https://csrc.nist.gov/news/2023/nist-to-withdraw-sp-800-67-rev-2) · [NIST SP 800-131A Rev. 2](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-131Ar2.pdf)
- **MD5 / SHA-1** remain broken for collision resistance (checksum-only); use SHA-256 / SHA-3.
- **KEM API (JEP 452, JDK 21)** — `javax.crypto.KEM` / `KEM.Encapsulated` is a provider-neutral Key Encapsulation Mechanism (RSA-KEM, ECIES, DHKEM per RFC 9180, and a hook for NIST PQC KEMs). [JEP 452: KEM API](https://openjdk.org/jeps/452) · [KEM (JDK 21 API)](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/javax/crypto/KEM.html)
- **Post-quantum crypto** is arriving: BouncyCastle 1.82+ (Sep 2025) ships PQC updates, and the JDK's KEM plus the ML-KEM/ML-DSA JEPs are the standards track. [BouncyCastle 1.82 / LTS 2.73.9 release notes](https://www.bouncycastle.org/resources/new-releases-bouncy-castle-java-1-82-and-bouncy-castle-java-lts-2-73-9/)
- **BouncyCastle CVEs** — the corpus pins 1.60; treat anything < 1.78 as vulnerable (CVE-2024-34447 DNS-poisoning hostname verification; CVE-2024-30172 Ed25519 verification DoS — both fixed in 1.78) and prefer current 1.84 / LTS 2.73.x. [GHSA-4h8f-2wvx-gg5w (CVE-2024-34447)](https://github.com/advisories/GHSA-4h8f-2wvx-gg5w)
- **`SecurityManager` permanently disabled** — JEP 411 deprecated it (JDK 17), **JEP 486 permanently disabled it (JDK 24)**: you can no longer enable it at startup or install one at runtime, making the corpus's SecurityManager article fully obsolete. [JEP 486: Permanently Disable the Security Manager](https://openjdk.org/jeps/486)
- **`javax` stays `javax` for crypto**: `javax.crypto` / `javax.net.ssl` / `javax.security.*` are JDK packages, NOT Jakarta EE — current and unchanged (the KEM API added to `javax.crypto` in JDK 21 confirms the JDK keeps extending it). [KEM (JDK 21 API)](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/javax/crypto/KEM.html)
