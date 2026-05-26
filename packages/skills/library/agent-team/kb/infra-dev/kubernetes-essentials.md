---
kb_id: infra-dev/kubernetes-essentials
version: 1
tags: [infra, devops, kubernetes, k8s, starter]
---

## Summary

Kubernetes essentials for HETS devops-sre personas: workloads (Deployment, StatefulSet, DaemonSet, Job, CronJob); services + ingress for traffic; namespaces + RBAC for tenancy; resource requests + limits to prevent noisy-neighbor; health probes (liveness, readiness, startup) prevent traffic to unhealthy pods; PodDisruptionBudgets gate voluntary disruption. Stub doc — expand on use.

## Full content (starter — expand when first persona uses)

### Workload types (pick the right one)

| Type | When | Notes |
|------|------|-------|
| Deployment | Stateless apps | Default for most services |
| StatefulSet | Stable identity / ordered startup / per-pod storage | Databases, brokers |
| DaemonSet | One-per-node | Log collectors, node agents |
| Job | Run-to-completion | Batch tasks |
| CronJob | Scheduled Job | Periodic batch |

### Service + Ingress

- **Service** (ClusterIP): in-cluster DNS for pods. Default.
- **Service** (NodePort / LoadBalancer): external traffic, but use Ingress instead for HTTP.
- **Ingress**: HTTP routing, TLS termination, virtual-hosting. Requires an Ingress controller (nginx, traefik, AWS ALB).

### Resources + QoS

Every container needs:
- `resources.requests.{cpu, memory}` — scheduler reservation
- `resources.limits.{cpu, memory}` — cgroup ceiling

QoS classes:
- **Guaranteed**: requests == limits → first to NOT be evicted under pressure
- **Burstable**: requests < limits → middle priority
- **BestEffort**: no requests/limits → first to be evicted

### Health probes

| Probe | Purpose | Failure action |
|-------|---------|----------------|
| `livenessProbe` | Is container alive? | Restart container |
| `readinessProbe` | Ready for traffic? | Remove from service endpoints |
| `startupProbe` | Slow startup? | Grace period before liveness applies |

Common bug: liveness probe too aggressive → restart loop. Tune `initialDelaySeconds`, `failureThreshold`.

### Tenancy + RBAC

- **Namespace** = logical separation (NOT a security boundary by default)
- **RBAC**: Role + RoleBinding (namespaced); ClusterRole + ClusterRoleBinding (cluster-wide)
- **NetworkPolicy**: namespace-to-namespace traffic restriction (requires CNI support)

### Common pitfalls

- No resource requests → pods scheduled anywhere, evicted under pressure
- No PodDisruptionBudget → voluntary disruption (node drain) takes down all replicas
- liveness probe = readiness probe (causes restart loops on slow startup)
- Secret in env var (logged on container start)
- `:latest` image tag (no rollback path; same tag points to different image over time)
- Hardcoded namespace in manifests (defeats per-env reuse)

### Related KB docs (planned)

- `kb:infra-dev/observability-basics`
- `kb:infra-dev/terraform-patterns`
- `kb:infra-dev/secret-management`
