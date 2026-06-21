---
kb_id: microservices/containers-orchestration
version: 1
tags:
  - microservices
  - docker
  - kubernetes
  - orchestration
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-cloud-docker, spring-cloud-kubernetes, mesos-marathon, jhipster, netflix-modules/genie"
  - "Istio Ambient reaches GA, v1.24 (istio.io/latest/blog/2024/ambient-reaches-ga)"
related:
  - microservices/service-discovery
  - microservices/serverless-cloud-sdk
  - microservices/distributed-tracing
status: active
---

## Summary

**Concept**: Microservices are packaged as containers and run by an orchestrator that handles scheduling, scaling, networking, and self-healing. Docker images + Compose for local; Kubernetes (Service DNS, probes, ConfigMaps/Secrets) for production; Mesos/Marathon as the legacy alternative.
**Key APIs**: Docker `Dockerfile` (`FROM`, `COPY *.jar`, `ENTRYPOINT java -jar`) + Compose bridge networks + `--scale`; K8s `ClusterIP`/`NodePort`, liveness/readiness probes wired to Actuator; Spring Cloud Kubernetes (ConfigMap->config hot-reload, Secret->env, native `DiscoveryClient`).
**Gotcha**: K8s liveness vs readiness are different — liveness failure restarts the pod, readiness failure stops routing traffic; wire them to the right Actuator health groups or you restart healthy-but-warming-up pods.
**2026-currency**: `openjdk:8-jdk-alpine` deprecated -> `eclipse-temurin`/jib/buildpacks; Compose `version:` key dropped; K8s `extensions/v1beta1` removed; service mesh (Istio Ambient GA) now handles mTLS/routing at the platform layer.
**Sources**: Baeldung `spring-cloud-docker`/`-kubernetes`/`mesos-marathon`; Istio Ambient GA.

## Quick Reference

**Docker (fat-jar image)**:
```dockerfile
FROM eclipse-temurin:21-jre   # corpus uses the deprecated openjdk:8-jdk-alpine
COPY target/*.jar app.jar
ENTRYPOINT ["java","-jar","/app.jar"]
```
Multi-service via Docker Compose on a user-defined bridge network; scale with port-ranges + `--scale service=N`.

**Kubernetes**:
- Service-to-service via K8s Service DNS (`service.namespace.svc.cluster.local`) — no Eureka needed.
- `ClusterIP` (internal) / `NodePort` (external) / `replicas` for scaling.
- **Liveness vs readiness probes** wired to Actuator: `/actuator/health/liveness` (restart on fail) and `/readiness` (stop routing on fail).
- **Spring Cloud Kubernetes**: ConfigMap -> config (with hot reload), Secret -> env var, native `DiscoveryClient` over the K8s API.

**Mesos + Marathon (legacy)**: a CI/CD pipeline (Jenkins -> Docker build/push -> Marathon REST API JSON app definition); BRIDGE networking with dynamic host ports.

**JHipster scaffolding**: generated layered anatomy (`domain` -> `repository` -> `service`+`dto`+`mapper` [MapStruct] -> `web/rest`); roles/authorities; Liquibase; the JWT/security stack; the microservice trio (gateway + car-app + dealer-app) on JHipster-Registry (Eureka + Config).

**Top gotchas**:
- Liveness/readiness confusion restarts warming-up pods or routes traffic to dead ones.
- Base64-not-encrypted K8s secrets, hardcoded registry creds in config URIs (corpus teaching artifacts).
- `mongod --smallfiles` removed; Compose `version: "2"/"3"` top-level key dropped.

**Current (mid-2026)**: `openjdk:8-jdk-alpine` is deprecated -> `eclipse-temurin` (the canonical OpenJDK base image), or build images with jib/buildpacks. `MAINTAINER` is deprecated. K8s `extensions/v1beta1` Deployment was removed (1.16+). Service mesh (Istio Ambient Mode GA in v1.24, Nov 7 2024) now handles mTLS, routing, and retries at the platform layer.

## Full content

Containerization and orchestration are how microservices actually run. A container packages the app plus its runtime into a portable image; an orchestrator schedules those images across a cluster and provides networking, scaling, config, secrets, and self-healing. The corpus covers Docker + Compose for local multi-service setups, Kubernetes for production, and the legacy Mesos/Marathon path.

### Docker and Compose

The Spring microservice image is a fat-jar pattern: a JRE base, copy the built jar, `ENTRYPOINT java -jar`. Compose wires several services onto a user-defined bridge network for local development, and `--scale` plus port-ranges gives crude horizontal scaling.

### Kubernetes specifics

On Kubernetes, discovery disappears into Service DNS — callers use stable cluster names instead of Eureka. The load-bearing operational concept is the liveness/readiness probe split: liveness tells the orchestrator to restart a hung pod; readiness tells it to stop routing traffic to a pod that isn't ready yet (e.g. still warming caches). These wire to Spring Boot Actuator health groups. Spring Cloud Kubernetes goes further, mapping ConfigMaps to config (with hot reload), Secrets to environment, and the K8s API to a native `DiscoveryClient`.

### JHipster's generated anatomy

JHipster scaffolds the whole stack — a layered domain/repository/service/web anatomy with MapStruct DTO mapping and Liquibase migrations, plus the security stack and a ready-made microservice trio (gateway + two services) on a JHipster Registry. It is a useful reference for conventional layering, even where its security defaults are now legacy.

### 2026 currency

- **Base-image and Dockerfile staleness.** `openjdk:8-jdk-alpine` is deprecated -> `eclipse-temurin` (still the canonical OpenJDK base image per the corpus carry-forward), with jib/buildpacks as image builders; `MAINTAINER` is deprecated; the Compose `version: "2"/"3"` top-level key was dropped (Compose Spec).
- **Kubernetes API churn.** `extensions/v1beta1` Deployment was removed (1.16+); use `apps/v1`. Boot's `/actuator/health/{liveness,readiness}` groups are the current probe targets (vs a hand-rolled `/health`).
- **Service mesh is the big addition since the corpus.** Istio Ambient Mode (sidecarless) reached GA in v1.24 (Nov 7 2024) — a ztunnel per-node data plane that drops the per-pod sidecar, with Istio reporting resource savings over 90% versus sidecars; Linkerd stays sidecar-based, Cilium offers an eBPF mesh. A mesh handles mTLS, traffic routing, and retries/circuit-breaking at the platform layer — an alternative to in-app Resilience4j/Eureka for those concerns. [Istio Ambient reaches GA (istio.io)](https://istio.io/latest/blog/2024/ambient-reaches-ga/) · [Istio vs Linkerd 2026 (Tasrie)](https://tasrieit.com/blog/istio-vs-linkerd-service-mesh-comparison-2026)
- **Do not seed abandoned orchestrators.** Apache Mesos went to the Attic (2021) and Marathon is dead; Netflix Genie ships 2018 images only — no revival found. [Spring Cloud 2025.0.0 release](https://spring.io/blog/2025/05/29/spring-cloud-2025-0-0-is-abvailable/)
