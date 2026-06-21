---
kb_id: build-devops/supply-chain-security
version: 1
tags:
  - build-devops
  - supply-chain
  - ci-security
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: jenkins, maven-modules (dependency hygiene), gradle (wrapper)"
  - "Nathan Berg — Supply Chain Security in CI: SBOMs, SLSA, Sigstore (https://nathanberg.io/posts/supply-chain-security-ci-sbom-slsa-sigstore/)"
related:
  - build-devops/docker-packaging
  - build-devops/dev-tooling-docs
status: active
---

## Summary

**Concept**: build-time software-supply-chain security — the layer entirely absent from the 2021 base whose absence is itself the modern audit finding: SBOM generation, artifact signing, build provenance, and CI-as-code with keyless OIDC.
**Key APIs**: CycloneDX Maven/Gradle plugins (`bom.json`); Syft (→ CycloneDX/SPDX); Sigstore/cosign keyless signing; SLSA GitHub Generator (in-toto attestations); GitHub Actions `.github/workflows/` + `id-token: write` OIDC.
**Gotcha**: the absence of SBOM/signing/provenance is the audit finding (no single CVE); unpinned plugin versions are the practical risk; Log4Shell-era transitive Log4j must be pinned to a fixed release on its Java line.
**2026-currency**: GitHub Actions is the de facto OSS CI (Travis OSS is dead); Sigstore keyless signing + SLSA Level 3 provenance + SBOM are the modern build-time security expectation.
**Sources**: Baeldung `jenkins`/dependency-hygiene/`gradle`(wrapper); Nathan Berg supply-chain-security-in-CI.

## Quick Reference

**The modern supply-chain layer (absent from the 2021 base)**:

- **SBOM** (Software Bill of Materials): CycloneDX Maven/Gradle plugins emit `bom.json`; Syft generates CycloneDX/SPDX from images/filesystems.
- **Sigstore / cosign keyless signing**: short-lived OIDC-tied certs sign JARs, images, and SBOMs — no long-lived signing keys.
- **SLSA provenance**: the SLSA GitHub Generator produces Level 3 in-toto attestations describing how an artifact was built.
- **CI-as-code**: GitHub Actions is the de facto OSS CI — workflow YAML under `.github/workflows/`, with OIDC (`id-token: write`) enabling keyless signing/provenance.

**From the base, still relevant**:
- **Dependency pinning** (Maven `<dependencyManagement>`, Gradle constraints) — the supply-chain hygiene foundation.
- **Gradle Wrapper validation** — the committed `gradle-wrapper.jar` is a supply-chain entry point; `gradle-wrapper-validation` checks its integrity.
- **Maven settings password encryption is obfuscation, not security** — reversible with the master file on the same machine; use a real vault / CI secret store.

**Top gotchas**:
- The absence of SBOM/signing/provenance is itself the audit finding — there is no single CVE to point at.
- Unpinned plugin versions are the practical build-tool risk (Maven/Gradle/Bazel core have no domain-specific advisory that changes seeding beyond "use a current GA").

**Security pins (Log4Shell era)**: transitive Log4j must be pinned to a fixed release on its Java line — **≥ 2.17.0 on Java 8+** (closes CVE-2021-45105 DoS, disables JNDI message-lookups by default; back-ports 2.12.3 Java 7 / 2.3.1 Java 6). The most security-current pin is **≥ 2.17.1** (CVE-2021-44832 JDBC-Appender RCE fix).

**Current (mid-2026)**: SBOM + Sigstore signing + SLSA provenance are the build-time security baseline; GitHub Actions OIDC is the keyless backbone; SpotBugs 4.9.8 is the active bytecode bug-pattern scanner. Travis CI OSS is dead.

## Full content

This is the cluster that the 2021 base simply does not have — the only CI artifacts in the corpus are a dead `.travis.yml` and a legacy Jenkins plugin. In the modern view, the *absence* of supply-chain controls is the finding, so this doc folds the 2026-Update security facts into a first-class concern.

### SBOM, signing, provenance

Three pillars. SBOM makes the dependency graph an auditable artifact (CycloneDX plugins for Maven/Gradle, Syft for images). Sigstore/cosign signs artifacts with short-lived OIDC-tied certificates instead of long-lived keys, so a CI job can sign without holding a secret. SLSA provenance records, in a verifiable in-toto attestation, exactly how an artifact was built — the SLSA GitHub Generator reaches Level 3. GitHub Actions ties them together: workflow YAML with `id-token: write` grants the OIDC token that keyless signing and provenance require.

### What carries from the base

The base's dependency-pinning hygiene (`<dependencyManagement>`, Gradle constraints) is the foundation supply-chain security builds on. The Gradle wrapper's committed jar is a real supply-chain entry point with its own integrity check. And the base's own caveat — that Maven settings password "encryption" is obfuscation — is exactly the kind of weak control the modern layer replaces with vaults and short-lived OIDC credentials.

### 2026 currency

- **Supply-chain hardening is now a build-time security expectation** — the absence of SBOM/signing/provenance is itself the modern audit finding (no single CVE): SBOM (`CycloneDX` plugins emit `bom.json`; Syft → CycloneDX/SPDX), **Sigstore/cosign keyless signing** (short-lived OIDC-tied certs), and **SLSA provenance** (Level 3 in-toto attestations). [Nathan Berg — Supply Chain Security in CI](https://nathanberg.io/posts/supply-chain-security-ci-sbom-slsa-sigstore/) · [Trantor — SBOM, SLSA & Actions](https://www.trantorinc.com/blog/software-supply-chain-security-sbom-slsa-engineering-teams) · [Sbomify — What Is Sigstore?](https://sbomify.com/2024/08/12/what-is-sigstore/) · [AquilaX — Supply Chain: Sigstore, SLSA, Build Provenance](https://aquilax.ai/blog/supply-chain-artifact-signing-slsa)
- **CI-as-code: GitHub Actions is the de facto OSS CI** — workflow YAML under `.github/workflows/`, with OIDC (`id-token: write`) enabling keyless signing/provenance. Travis CI OSS is dead. [Nathan Berg — Supply Chain Security in CI](https://nathanberg.io/posts/supply-chain-security-ci-sbom-slsa-sigstore/)
- **Log4Shell pins** — fixed versions are **Log4j 2.17.0 (Java 8+)**, back-ports **2.12.3 (Java 7)** / **2.3.1 (Java 6)**; the most security-current pin on Java 8+ is **≥ 2.17.1** (CVE-2021-44832 JDBC-Appender RCE fix). [Apache Logging Services — Security](https://logging.apache.org/security.html) · [CISA — Apache Log4j Vulnerability Guidance](https://www.cisa.gov/news-events/news/apache-log4j-vulnerability-guidance)
- **SpotBugs 4.9.8 (Oct 2025)** — the canonical FindBugs successor for bytecode bug-pattern scanning; treat unpinned plugin versions as the practical risk. [appsecsanta — SpotBugs 2026](https://appsecsanta.com/spotbugs)
