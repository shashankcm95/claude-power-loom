---
kb_id: build-devops/docker-packaging
version: 1
tags:
  - build-devops
  - docker
  - containerization
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: docker, jib, kaniko, podman"
  - "codecentric — 7 Ways to Replace Kaniko (https://www.codecentric.de/en/knowledge-hub/blog/7-ways-to-replace-kaniko-in-your-container-image-builds)"
related:
  - build-devops/kubernetes-iac
  - build-devops/jvm-runtime-modernization
  - build-devops/supply-chain-security
status: active
---

## Summary

**Concept**: packaging JVM apps as container images — Docker Compose for local topology, Spring Boot layered jars for cache-efficient images, and a survey of daemonless/Dockerfile-less builders (Jib, Buildpacks, Kaniko, Podman).
**Key APIs**: `spring-boot-maven-plugin` layers + `layers.xml` + multi-stage `layertools extract`; `jib-maven-plugin` (`jib:build`/`jib:dockerBuild`/`jib:buildTar`); `spring-boot:build-image`/`bootBuildImage` (Buildpacks); Compose named/host/`:ro` volumes, user-defined networks, container DNS by service name.
**Gotcha**: a layered-jar Dockerfile needs `<layerOrder>` listing every layer (order/glob-sensitive) and assumes `target/*.jar` exists — run `mvn package` BEFORE `docker build`; alpine services with no long-lived process need `tty:true`.
**2026-currency**: Kaniko is archived read-only (2025-06-03) — migrate to BuildKit/Buildah/Podman/ko; `JarLauncher` moved to `org.springframework.boot.loader.launch.JarLauncher` (Boot 3.2+); `adoptopenjdk:*` → `eclipse-temurin:21-jre`.
**Sources**: Baeldung `docker`/`jib`/`kaniko`/`podman`; codecentric Kaniko-replacement survey.

## Quick Reference

**Docker Compose fundamentals**: named volumes shared across services, host bind mounts, `:ro` read-only, user-defined networks, `"1337:80"` port publish, container DNS by service name (`jdbc:postgresql://db:5432/...`), `depends_on`, `tty:true` (alpine services with no long-lived process exit immediately without it), env-var datasource config (`SPRING_DATASOURCE_URL` via Boot relaxed binding).

**Spring Boot layered jar** (Boot 2.3+, for layer-cache efficiency):

```dockerfile
# stage 1 — extract
RUN java -Djarmode=layertools -jar application.jar extract
# stage 2 — copy each layer dir + launch
ENTRYPOINT ["java","org.springframework.boot.loader.JarLauncher"]
```

`spring-boot-maven-plugin` `<layers><enabled>true</enabled>` + `layers.xml` (schema `layers-2.3.xsd`) with `<into layer="...">` `<include>` globs (`com.baeldung.docker:*:*`, `*:*:*SNAPSHOT`) + a mandatory `<layerOrder>` (least→most changing). Requires `mvn package` before `docker build`.

**Daemonless / Dockerfile-less builders**:

- **Jib** (`jib-maven-plugin`) — daemonless, Dockerfile-less, layered, builds from Maven; goals `jib:build` (registry), `jib:dockerBuild` (local daemon), `jib:buildTar`. Builds from the thin (non-fat) layout; no `<from>` → version-default JRE base. `jib:build` needs registry credentials (not in the POM).
- **Cloud Native Buildpacks** — `spring-boot:build-image` / `bootBuildImage`.
- **Kaniko** — runs as a K8s Pod, builds from a mounted context (`--no-push`/`--destination`).
- **Podman** — daemonless/rootless, consumes standard Dockerfiles unchanged.

**Heap-in-container**: `ManagementFactory.getMemoryMXBean().getHeapMemoryUsage().getMax()/getInit()`; pass flags via `JAVA_OPTS`.

**Top gotchas**:
- Layered-jar `<layerOrder>` must list every layer or the build fails; Dockerfile assumes `target/*.jar` exists.
- Compose `version:` top-level key is now obsolete (v2 ignores/warns); `'2'` vs `'3'` differ in `depends_on`/`deploy` semantics.
- Jib `jib:build` fails auth without registry credentials.

**Current (mid-2026)**: Kaniko is dead (archived read-only) → BuildKit/Buildah/Podman/ko. `JarLauncher` → `org.springframework.boot.loader.launch.JarLauncher` (Boot 3.2+). `adoptopenjdk:*`/`openjdk` images → `eclipse-temurin:21-jre`/`25-jre`. Jib `jib-maven-plugin` 3.5.1.

## Full content

This cluster covers how a JVM app becomes a container image. The corpus is strong here: Docker (Compose + layered jars + heap) plus a near-complete daemonless-build survey (Jib, Buildpacks, Kaniko, Podman).

### Docker Compose and layered jars

Compose declares the local multi-container topology — volumes (named/host/read-only), user-defined networks with service-name DNS, port publishing, and env-var configuration that Boot's relaxed binding picks up. The layered-jar technique (Boot 2.3+) splits the fat jar into cache-friendly layers (dependencies change rarely; application classes change often) using `layertools extract` in a multi-stage Dockerfile, so a code change rebuilds only the top layer. The load-bearing requirements: a complete `<layerOrder>` and a prior `mvn package`.

### The daemonless-build survey

Jib builds images directly from Maven with no Docker daemon and no Dockerfile, producing layered images and pushing to a registry. Cloud Native Buildpacks (`bootBuildImage`) do the same from the build tool. Kaniko and Podman are the in-cluster/rootless answers — Kaniko as a K8s Pod against a mounted context, Podman as a daemonless drop-in that consumes standard Dockerfiles. The reusable idea is "build an OCI image without a privileged daemon," which is exactly the axis that churned post-snapshot.

### 2026 currency

- **Dead Docker base images**: `adoptopenjdk:*` rebranded **Eclipse Temurin** (`eclipse-temurin:21-jre`, `eclipse-temurin:25-jre`); the `openjdk` Docker Hub image is deprecated; `centos:latest`+`yum` (CentOS Linux EOL Dec 2021) → Stream/Rocky/Alma/UBI + `dnf`. [endoflife.date — Eclipse Temurin](https://endoflife.date/eclipse-temurin)
- **Kaniko is archived read-only (2025-06-03)** — no further Google CVE fixes; migrate off it to **BuildKit** (rootless `buildkitd`), **Buildah**, **Podman**, or **ko**; Spring Boot's Buildpacks (`spring-boot:build-image`/`bootBuildImage`) remain first-class. [thehapyone — Kaniko Has Been Archived](https://thehapyone.com/the-end-of-an-era-kaniko-has-been-archived/) · [codecentric — 7 Ways to Replace Kaniko](https://www.codecentric.de/en/knowledge-hub/blog/7-ways-to-replace-kaniko-in-your-container-image-builds)
- **Boot loader entry point moved**: `org.springframework.boot.loader.JarLauncher` → `org.springframework.boot.loader.launch.JarLauncher` (Boot 3.2+); layered-jar Dockerfiles must use the new path. [Spring Boot 3.2 Release Notes](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.2-Release-Notes)
- **Compose `version:` top-level key is now obsolete** (Compose v2 ignores/warns); **Jib `jib-maven-plugin` 3.5.1** is current, daemonless concept unchanged. [codecentric — 7 Ways to Replace Kaniko](https://www.codecentric.de/en/knowledge-hub/blog/7-ways-to-replace-kaniko-in-your-container-image-builds)
