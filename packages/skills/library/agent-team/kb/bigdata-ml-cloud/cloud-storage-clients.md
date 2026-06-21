---
kb_id: bigdata-ml-cloud/cloud-storage-clients
version: 1
tags:
  - bigdata-ml-cloud
  - google-cloud
  - azure
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: google-cloud"
  - "Baeldung tutorials (eugenp/tutorials) module: azure"
  - "How ADC works (docs.cloud.google.com/docs/authentication/application-default-credentials)"
related:
  - bigdata-ml-cloud/aws-sdk-java
  - bigdata-ml-cloud/apache-olingo-odata
status: active
---

## Summary

**Concept**: Non-AWS cloud integration in the corpus — Google Cloud Storage object CRUD via the `Storage`/`Blob` API, plus Azure as deployment tooling only (no SDK code) and AppSync as managed GraphQL.
**Key APIs**: `GoogleCredentials.fromStream(serviceAccountJson)` → `StorageOptions.newBuilder().setCredentials().setProjectId().getService()` → `Storage`; `BucketInfo.of`, `bucket.create(name,bytes)`, `BlobId`, `blob.writer()`; Azure `azure-webapp-maven-plugin` + `SpringBootServletInitializer` WAR.
**Gotcha**: GCS `FileInputStream` has no try-with-resources (handle leak); never commit the `google_auth.json` service-account key; Azure pom has literal `{}` (not `${}`) placeholders that won't interpolate.
**2026-currency**: google-cloud-storage 2.67.0 (BOM-managed) with Application Default Credentials by default — static JSON keys discouraged; Azure's `azure-webapp-maven-plugin` 1.1.0 → the `com.microsoft.azure` 2.x plugin (schema v2), Spotify `docker-maven-plugin` abandoned → Jib/Buildpacks.
**Sources**: Baeldung `google-cloud` + `azure` modules; Google ADC docs.

## Quick Reference

**Google Cloud Storage**:
- Auth + service: `GoogleCredentials.fromStream(serviceAccountJson)` → `StorageOptions.newBuilder().setCredentials(...).setProjectId(...).getService()` → `Storage`
- Bucket get-or-create: `BucketInfo.of(name)` → `storage.create(...)`
- Blob CRUD: `bucket.create(name, bytes)`, read by `BlobId` or by-name scan over `bucket.list()` → `Page<Blob>`, update via `blob.writer()` (a `WritableByteChannel`)

**Azure** (deployment tooling only — *no* Azure SDK Java code):
- `azure-webapp-maven-plugin` (deploy to App Service) + Spotify `docker-maven-plugin` (push to Azure Container Registry)
- WAR packaging via `SpringBootServletInitializer`
- Externalized datasource: H2 locally / MySQL in Azure

**Top gotchas**:
- GCS `FileInputStream` lacks try-with-resources → handle leak.
- Never commit the `google_auth.json` service-account key.
- Azure pom uses literal `{}` (not `${}`) placeholders that won't interpolate; a `CrudRepository<User, Long>` whose `User.id` is `Integer` (latent type mismatch).

**Current (mid-2026)**: **google-cloud-storage 2.67.0** (BOM-managed) with **Application Default Credentials** by default; static GCP service-account JSON keys are discouraged in favor of ADC / Workload Identity Federation. Azure: `azure-webapp-maven-plugin` 1.1.0 → the `com.microsoft.azure` 2.x plugin (schema v2); the abandoned Spotify `docker-maven-plugin` → Jib / Buildpacks / `bootBuildImage`. The corpus's GCS coverage is storage-only (no BigQuery, Pub/Sub, Vertex AI, Firestore).

## Full content

Beyond AWS, the corpus's cloud coverage is thin but instructive in two different ways: Google Cloud Storage shows a real SDK CRUD surface, while Azure shows deployment tooling with no SDK code at all.

**Google Cloud Storage** follows the standard GCP client shape. Authentication loads a service-account JSON (`GoogleCredentials.fromStream(serviceAccountJson)`), then a fluent builder produces the service: `StorageOptions.newBuilder().setCredentials(...).setProjectId(...).getService()` returns a `Storage`. Buckets are get-or-created with `BucketInfo.of(name)`. Blobs support full CRUD: create with `bucket.create(name, bytes)`, read either by `BlobId` or by scanning `bucket.list()` (a `Page<Blob>`) by name, and update via `blob.writer()` (a `WritableByteChannel`). The resource gotcha is a `FileInputStream` without try-with-resources, and the security gotcha is the temptation to commit the `google_auth.json` key.

**Azure** contributes no SDK code — it is purely deployment tooling. The module deploys a Spring Boot app to Azure App Service via `azure-webapp-maven-plugin`, pushes a Docker image to Azure Container Registry via Spotify's `docker-maven-plugin`, packages as a WAR through `SpringBootServletInitializer`, and externalizes its datasource (H2 locally, MySQL in Azure). Its pom carries a latent bug — literal `{}` placeholders instead of `${}`, which won't interpolate — and a `CrudRepository<User, Long>` against a `User` whose `id` is `Integer`.

The corpus also includes **AWS AppSync** (managed GraphQL): a single `/graphql` POST endpoint with a `{query, variables, operationName}` body and `x-api-key` auth, consumed via a WebFlux `WebClient` — the reactive-consumption side of which is covered in the reactive-cloud-integration sibling.

### 2026 currency

**Google Cloud Storage** is now BOM-managed at **google-cloud-storage 2.67.0** and uses **Application Default Credentials** by default ([google-cloud-storage 2.67.0 overview (Google)](https://docs.cloud.google.com/java/docs/reference/google-cloud-storage/latest/overview)). The corpus's GCS 1.16.0 with a static service-account JSON key is far behind and against current guidance — static GCP service-account JSON keys are discouraged in favor of **ADC / Workload Identity Federation** ([How ADC works (Google Cloud)](https://docs.cloud.google.com/docs/authentication/application-default-credentials) · [Authenticate your requests — Java (Google Cloud)](https://docs.cloud.google.com/java/docs/authentication)). The core `Storage`/`Blob`/`BlobId`/`StorageOptions` API shape is durable; only the version and the credential mechanism changed.

**Azure**'s tooling is stale: `azure-webapp-maven-plugin` 1.1.0 has been superseded by the `com.microsoft.azure` 2.x plugin (schema v2), and the Spotify `docker-maven-plugin` (~2018) is abandoned — use **Jib, Cloud Native Buildpacks, or `bootBuildImage`** instead. Note also the coverage gap: the corpus only touches GCS, with no BigQuery, Pub/Sub, Vertex AI, or Firestore, and no Azure SDK calls at all.
