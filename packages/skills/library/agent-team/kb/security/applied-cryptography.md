---
kb_id: security/applied-cryptography
version: 1
tags:
  - security
  - cryptography
  - libraries
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: libraries-security (tink, bouncycastle, jasypt, passay, digitalsignature, pem, ssh)"
  - "Bouncy Castle 1.84 release notes (https://www.bouncycastle.org/resources/new-releases-bouncy-castle-java-1-84-and-bouncy-castle-java-lts-2-73-11/)"
related:
  - security/jwt-jose
  - security/sql-injection-prevention
status: active
---

## Summary

**Concept**: The applied-crypto library grab-bag — Google Tink, BouncyCastle CMS, Jasypt, Passay, JCA digital signatures, PEM reading, and SSH — plus the encrypt-the-hash anti-pattern.
**Key APIs**: Tink `Aead`/`Mac`/`KeysetHandle`/`KeyTemplates`; BouncyCastle `CMSSignedDataGenerator`/`CMSEnvelopedDataGenerator`, provider `"BC"`, `PEMParser`; Jasypt `BasicTextEncryptor`/`BasicPasswordEncryptor`; Passay password rules; JCA `java.security.Signature("SHA256withRSA")` vs the `MessageDigest`+`Cipher` anti-pattern.
**Gotcha**: The level-1 "encrypt the hash" signature (`MessageDigest` + `Cipher("RSA")` encrypt) is an anti-pattern — use `java.security.Signature`. Corpus pins weak crypto: Jasypt `PBEWithMD5AndTripleDES`, BouncyCastle CMS `AES128_CBC` (no AEAD), JSch `StrictHostKeyChecking=no` (MITM).
**2026-currency**: BouncyCastle 1.58/1.62 -> 1.84 (LTS 2.73.11); Tink 1.2.2 -> 1.19.0; JSch `com.jcraft` 0.1.55 abandoned -> `com.github.mwiede:jsch` 2.28.3; post-quantum (ML-KEM/ML-DSA) shipping in BC 1.8x.
**Sources**: Baeldung `libraries-security`; BC 1.84 release notes.

## Quick Reference

**Google Tink** (misuse-resistant): `KeysetHandle.generateNew(KeyTemplates.get("AES256_GCM"))` -> `Aead`; `Mac` (HMAC_SHA256); ECDSA signatures; ECIES hybrid encryption. Tink picks safe defaults so you can't easily misconfigure (e.g. no ECB, authenticated AEAD).

**BouncyCastle CMS**: detached/attached signing (`CMSSignedDataGenerator`), enveloped encryption (`CMSEnvelopedDataGenerator`), provider `"BC"` registered via `Security.addProvider`; `PEMParser` for PEM keys.

**Jasypt**: `BasicTextEncryptor` (two-way), `BasicPasswordEncryptor` (one-way), PBE encryptors. (The default PBE algorithm `PBEWithMD5AndDES` is weak, as is the corpus's `PBEWithMD5AndTripleDES` — see gotchas.)

**Passay**: password rule validation (`PasswordValidator` + `Rule`s) and rule-driven generation.

**JCA digital signatures** — the right way vs the anti-pattern:

```java
// CORRECT
Signature s = Signature.getInstance("SHA256withRSA");
s.initSign(privateKey); s.update(data); byte[] sig = s.sign();

// ANTI-PATTERN (level 1): hash then encrypt the hash
// MessageDigest("SHA-256") + Cipher("RSA").doFinal(hash)  <- do not do this
```

PKCS12 keystores hold the keys. PEM reading two ways: JDK `KeyFactory` + `*EncodedKeySpec` vs BouncyCastle `PEMParser`. SSH via JSch or Apache MINA SSHD.

**Top gotchas**:

- The "encrypt the hash" signature is the documented anti-pattern; use `java.security.Signature`.
- Weak crypto pinned in the corpus: SHA-1 password hashing (`spring-ldap` `MessageDigest("SHA")`), Jasypt `PBEWithMD5AndTripleDES`, BouncyCastle CMS `AES128_CBC` (no AEAD), JSch `StrictHostKeyChecking=no` (MITM-vulnerable).
- Corpus library pins are years of CVE fixes behind current.

**Current (mid-2026)**: BouncyCastle 1.58/1.62 -> **1.84** (LTS 2.73.11); Tink 1.2.2 -> **1.19.0** (`tink-crypto/tink-java`); JSch -> **`com.github.mwiede:jsch` 2.28.3**; prefer AEAD (AES-GCM) over CBC; PQC arriving.

## Full content

The applied-crypto grab-bag (`libraries-security`) is the corpus's widest library coverage. Google Tink is the misuse-resistant choice — `Aead` (AES256_GCM), `Mac` (HMAC_SHA256), ECDSA signatures, ECIES hybrid encryption, all driven by `KeysetHandle`/`KeyTemplates` so unsafe configurations are hard to reach. BouncyCastle CMS handles detached/attached signing and enveloped encryption with the `"BC"` provider and `PEMParser`. Jasypt provides two-way (`BasicTextEncryptor`) and one-way (`BasicPasswordEncryptor`) PBE encryptors. Passay validates and generates passwords against rule sets. JCA digital signatures contrast the level-1 anti-pattern (`MessageDigest("SHA-256")` + `Cipher("RSA")` encrypt-the-hash) with the correct `java.security.Signature("SHA256withRSA")`, using PKCS12 keystores. PEM reading is shown both via the JDK (`KeyFactory` + `*EncodedKeySpec`) and BouncyCastle, and SSH via JSch and Apache MINA SSHD. Evidence: `libraries-security/.../{tink/TinkLiveTest,bouncycastle/BouncyCastleCrypto,jasypt/JasyptUnitTest,passay/*,digitalsignature/*,pem/BouncyCastlePemUtils,ssh/*}.java`.

The corpus concentrates weak-crypto pitfalls: SHA-1 password hashing, Jasypt's `PBEWithMD5AndTripleDES` (a weak choice the corpus configures explicitly; Jasypt's own default is the also-weak `PBEWithMD5AndDES`), BouncyCastle CMS using non-AEAD `AES128_CBC`, the encrypt-the-hash signature anti-pattern, and JSch with `StrictHostKeyChecking=no` (MITM-exposed). All of these are conceptually current at the API-shape level but require version bumps and primitive upgrades.

### 2026 currency

- **Bouncy Castle 1.58/1.62 -> 1.84 (LTS 2.73.11).** The corpus pins predate years of CVE fixes; 1.84 ships CVE fixes plus FIPS PKCS12 PBMAC1. [BC 1.84 release notes](https://www.bouncycastle.org/resources/new-releases-bouncy-castle-java-1-84-and-bouncy-castle-java-lts-2-73-11/)
- **Google Tink 1.2.2 -> 1.19.0** (`tink-crypto/tink-java`); the library was reorganized into a dedicated repo. [tink-java releases (GitHub)](https://github.com/tink-crypto/tink-java/releases)
- **JSch is forked.** The original `com.jcraft:jsch` 0.1.55 is abandoned and unpatched; the active fork is `com.github.mwiede:jsch` (current `2.28.3`). [mwiede/jsch releases](https://github.com/mwiede/jsch/releases)
- **Post-quantum crypto is shipping in JVM crypto.** Bouncy Castle 1.8x ships finalized NIST PQC key formats (ML-KEM/ML-DSA), and the JDK's KEM API (JEP 452, JDK 21) plus the ML-KEM/ML-DSA JEPs are the standards track. [BC 1.81 release (PQC PKCS#8)](https://www.bouncycastle.org/resources/bouncy-castle-releases-java-1-81-and-c-net-2-6-1/)
- **JCA primitives carry forward.** `java.security.Signature`/`MessageDigest`/`Cipher` and `javax.crypto` are JDK packages (not Jakarta) and unchanged — the API shapes are current; prefer authenticated AEAD (AES-GCM) over the corpus's CBC and avoid MD5/SHA-1/3DES (the latter NIST-disallowed for encryption since end-2023). [BC 1.84 release notes](https://www.bouncycastle.org/resources/new-releases-bouncy-castle-java-1-84-and-bouncy-castle-java-lts-2-73-11/)
- **JCE unlimited-strength policy is a non-issue on JDK 9+** — the corpus's policy-jar `@Ignore` comments are obsolete. [BC 1.84 release notes](https://www.bouncycastle.org/resources/new-releases-bouncy-castle-java-1-84-and-bouncy-castle-java-lts-2-73-11/)
