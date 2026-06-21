---
kb_id: build-devops/kubernetes-iac
version: 1
tags:
  - build-devops
  - terraform
  - kubernetes
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: terraform, kubernetes/k8s-intro"
  - "Encore — OpenTofu vs Terraform 2026 (https://encore.dev/articles/opentofu-vs-terraform-2026)"
related:
  - build-devops/docker-packaging
  - build-devops/metrics-observability
status: active
---

## Summary

**Concept**: declarative infrastructure provisioning (Terraform/OpenTofu) plus programmatic cluster control from Java (the official Kubernetes `client-java`).
**Key APIs**: Terraform `provider`→`resource`→`init`/`apply`/`destroy`, `data "aws_ami"`, `module {source=...}`, `locals`+functions; K8s `Config.defaultClient()` → `CoreV1Api`/`BatchV1Api`, server-side paging (`limit`+`continue`), `Watch.createWatch`, `PatchUtils` server-side apply (`PATCH_FORMAT_APPLY_YAML`).
**Gotcha**: Terraform `uuid()` in `locals` regenerates every plan (perpetual diffs); K8s watches die on 410 Gone unless handled and need `readTimeout(0)`; the `client-java` list methods take a wall of positional nullable params.
**2026-currency**: HashiCorp relicensed Terraform under BUSL 1.1 (Aug 2023) → OpenTofu (MPL-2.0, latest 1.11.0, 2025-12-09) is the live OSS fork with native state+plan encryption; `required_providers` is current on both; `map(...)` removed in 0.13+.
**Sources**: Baeldung `terraform`/`kubernetes/k8s-intro`; Encore OpenTofu-vs-Terraform 2026.

## Quick Reference

**Terraform best-practice file split**: `providers.tf` / `variables.tf` (typed + `description` + `default`) / `main.tf`.

- **Data source over hardcoded id**: `data "aws_ami" "ubuntu" { most_recent=true; filter {...}; owners=[...] }`.
- **Implicit deps via references**: `aws_instance.web` → `aws_subnet.frontend.id` → `aws_vpc.apps.id` (no explicit `depends_on` needed).
- **Modules**: `module "x" { source="./modules/x"; ... }` with a `main`/`variables`/`outputs` contract.
- **Local values + functions**: `locals {}` + conditional `cond ? a : b` + `join`/`sha1`/`uuid`.
- **State hygiene `.gitignore`**: `*.tfstate`, `*.tfvars`, `.terraform/`.
- Providers shown: AWS (EC2/VPC/subnet) and Kubernetes (`kubernetes_namespace`/`_deployment`/`_service`/`_ingress`).

**Kubernetes Java client** (`client-java`):

- **Bootstrap**: `Config.defaultClient()` → `new CoreV1Api(client)` / `new BatchV1Api(client)`.
- **Paging**: loop on `metadata.getContinue()` with a `limit`. **Async**: `AsyncHelper<R> implements ApiCallback<R>` adapting `*Async` to `CompletableFuture`.
- **Watch**: `Watch.createWatch(client, ...Call(watch=true...), new TypeToken<Response<V1Pod>>(){}.getType())`; iterate `event.type` ADDED/MODIFIED/DELETED; OkHttp `readTimeout(0)`. Resilience: resume from last `resourceVersion`, handle **410 Gone** (reset + re-list), `allowWatchBookmarks=true` for periodic BOOKMARK events.
- **CRUD + server-side apply**: `V1JobBuilder` → `createNamespacedJob`; `PatchUtils.patch(..., V1Patch.PATCH_FORMAT_APPLY_YAML, fieldManager="acme", force=true)`; poll `readNamespacedJob` → `deleteNamespacedJob`.

**Top gotchas**:
- Terraform `uuid()` in `locals` regenerates every plan → perpetual diffs / forced replacement; `map(...)` removed in 0.13+.
- K8s `client-java` list methods take a wall of positional nullable params (`listPodForAllNamespaces(allowWatchBookmarks, _continue, fieldSelector, labelSelector, limit, ...)`) — easy to misplace an arg.
- Watches die on 410 Gone unless handled; need `readTimeout(0)`.

**Current (mid-2026)**: use **OpenTofu** (MPL-2.0, 1.11.0) — Terraform itself is BUSL 1.1 source-available. `required_providers { x = { source="hashicorp/x" } }` is current on both (the inline `provider "x" { version=... }` idiom is pre-0.13). Old provider pins are far behind (AWS `~>2.53` → v5.x; k8s `~>1.10` → v2.x, `kubernetes_ingress` → `kubernetes_ingress_v1`).

## Full content

This cluster is the deploy/provision layer: declarative infrastructure-as-code (Terraform) and programmatic cluster operations from Java (the Kubernetes client). The K8s client content is the most durable; the Terraform content is conceptually valid but written in pre-0.13 syntax.

### Terraform / OpenTofu best practices

The corpus teaches the `provider`→`resource`→`init`/`apply`/`destroy` loop, then the best-practice refinements: split files by concern, type and document variables, use data sources instead of hardcoded IDs, let dependencies emerge implicitly from references, package reusable infrastructure as modules with a `main`/`variables`/`outputs` contract, and keep state out of version control. These best practices carry forward unchanged — what moved is the license and the provider/`required_providers` mechanics.

### Kubernetes from Java

The official `client-java` bootstraps via `Config.defaultClient()` into typed API objects (`CoreV1Api`, `BatchV1Api`). The durable lessons are the resilience patterns: server-side paging via `continue`, async via an `ApiCallback`→`CompletableFuture` adapter, and — most important — robust watches (resume from `resourceVersion`, handle 410 Gone by resetting and re-listing, request bookmarks, and disable the read timeout). Resource mutation uses fluent builders plus server-side apply (`PatchUtils` with `PATCH_FORMAT_APPLY_YAML` and a `fieldManager`). These watch-resilience and server-side-apply concepts remain current.

### 2026 currency

- **Terraform relicensed; OpenTofu is the live OSS fork.** HashiCorp moved Terraform to **BUSL 1.1** (Aug 2023, source-available). **OpenTofu** (MPL-2.0, Linux Foundation) diverged — **1.7 shipped native state+plan encryption**; latest **1.11.0 (2025-12-09)**. `required_providers` is current on both. [Encore — OpenTofu vs Terraform 2026](https://encore.dev/articles/opentofu-vs-terraform-2026) · [Spacelift — Terraform License Change (BSL)](https://spacelift.io/blog/terraform-license-change)
- **Pre-0.13 idiom is stale**: inline `provider "x" { version=... }` → `terraform { required_providers { x = { source="hashicorp/x" } } }`. `map(...)` removed. Provider pins ancient (AWS `~>2.53` → v5.x with schema changes; k8s `~>1.10` → v2.x, `kubernetes_ingress` → `kubernetes_ingress_v1`). [Encore — OpenTofu vs Terraform 2026](https://encore.dev/articles/opentofu-vs-terraform-2026)
- **Carries forward unchanged**: Terraform module/variable/data-source best practices and the K8s Job API + watch resilience (resourceVersion/410/bookmarks) + server-side apply remain current at the concept level. [Encore — OpenTofu vs Terraform 2026](https://encore.dev/articles/opentofu-vs-terraform-2026)
