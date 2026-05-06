---
skill: kubernetes
status: active
domain: infra-dev
canonical_source: https://kubernetes.io/docs/home/
forged_via: H.6.7-canonical-source-registry
related_kb: [infra-dev/kubernetes-essentials]
notes: Concepts + Tasks + Reference are the three pillars. For YAML manifests the API reference (https://kubernetes.io/docs/reference/kubernetes-api/) is the source of truth. Always pin to current GA k8s version (1.29+ as of 2026).
---

# Kubernetes

Specialist skill for the `10-devops-sre` HETS persona (and any other persona that needs Kubernetes expertise). Loaded on demand via the `Skill` tool when the spawn prompt lists `kubernetes` as required.

## When to use this skill

Trigger when:
- Authoring or modifying Kubernetes manifests (Deployment, Service, ConfigMap, Secret, Ingress, etc.)
- Designing pod placement, scaling, or networking
- Debugging pod failures, OOMKilled events, image-pull errors, scheduling issues
- Designing zero-downtime deploys, rolling updates, blue-green, canary patterns
- Writing health probes, readiness gates, lifecycle hooks

**Skip** when the work is pure container building (`Dockerfile`-only — that's `docker` skill); cluster-level admin (RBAC policy, network policies at infra layer — needs deeper specialist); or platform-as-a-service deploys (Vercel, Cloudflare Pages, App Engine — k8s isn't relevant).

## Core competencies

### Manifest fundamentals

- **`apiVersion` matters** — `apps/v1` for Deployment/StatefulSet/DaemonSet; `v1` for core (Pod, Service, ConfigMap, Secret, Namespace, PVC); `networking.k8s.io/v1` for Ingress, NetworkPolicy.
- **`metadata.labels` are the load-bearing identity layer** — they're how Services find Pods, how Deployments track ReplicaSets, how monitoring scrapes targets. Use a consistent label scheme (`app.kubernetes.io/name`, `app.kubernetes.io/version`, `app.kubernetes.io/component`).
- **`spec.selector.matchLabels` MUST match `template.metadata.labels`** in Deployments. Mismatch is the most common silent breakage — Deployment creates Pods that ReplicaSet can't track.
- **Namespaces** isolate by name + by RBAC defaults. Don't deploy to `default` — make a namespace per app or per environment.

### Deployment patterns

- **Rolling updates by default**: `strategy.type: RollingUpdate` with `maxSurge: 25%, maxUnavailable: 25%` (defaults are sane for most cases). Tune `maxUnavailable: 0` for can't-afford-degradation; `maxSurge: 0` for cluster-tight resource budgets.
- **Recreate strategy** ONLY when the app cannot run two versions simultaneously (e.g., DB schema migrations that break old version). Causes downtime — design out if possible.
- **Replica count**: minimum 2 for any production workload (single replica = single point of failure on node loss). Scale based on request volume + memory pressure, not request count alone.

### Pod resources + scheduling

- **`resources.requests` is the scheduler's contract** — it places the pod on a node with at least this much capacity. Under-request = noisy-neighbor; over-request = cluster waste.
- **`resources.limits` is the kernel's contract** — exceeding memory limit triggers OOMKill; exceeding CPU limit throttles. Don't set memory request ≠ memory limit unless you understand the implications (overcommit = unpredictable kills).
- **Common starting point**: `requests: { cpu: 100m, memory: 128Mi }` for stateless services; tune from observed P99. Always set `limits.memory` (no exceptions); CPU limits are debated — many disable them to allow burst, but rate-limited by `requests` competition.
- **Horizontal Pod Autoscaler** for traffic-driven scaling. Vertical (VPA) is rarely production-ready — sticks pods to recommendations that change pod identity.

### Health probes

- **`startupProbe`** for slow-starting apps (gives them time before liveness kicks in). Without it, a 30s startup app gets killed by 10s liveness probe.
- **`readinessProbe`** controls Service membership — failing probe removes pod from rotation but doesn't kill it. Use for "ready to serve traffic" semantics (DB connection healthy, cache warmed).
- **`livenessProbe`** triggers restart when failing. Use sparingly — restart is expensive and rarely fixes the underlying problem. Many production apps have NO liveness probe (rely on startup + readiness).
- **Probe types**: `httpGet` for HTTP services (preferred); `exec` for non-HTTP (DB ping); `tcpSocket` last resort. Always set `failureThreshold` high enough to ride out transient blips.

### Service patterns

- **`ClusterIP`** (default) for in-cluster traffic — most common. Pod-to-pod via service DNS (`<service>.<namespace>.svc.cluster.local`).
- **`NodePort`** for legacy fixed-port external access — generally NOT recommended; use Ingress.
- **`LoadBalancer`** for cloud-provider-managed external LB — costs money per service in most clouds; use Ingress to share one LB across multiple services.
- **`Ingress` + IngressController** is the modern path: one external endpoint, host/path-based routing to multiple services, TLS termination, rate-limiting (controller-dependent).
- **`headless` Services** (`clusterIP: None`) for StatefulSet pod-DNS or when you need direct pod IPs (e.g., gossip protocols).

### Secrets + ConfigMaps

- **ConfigMap** for non-sensitive config (URLs, feature flags, log levels). Mount as env vars OR files.
- **Secret** for sensitive data — but base64 is NOT encryption; etcd-at-rest encryption is required for actual confidentiality.
- **External secret managers** (Vault, AWS Secrets Manager via External Secrets Operator) for production. Don't keep prod secrets in Git, even encrypted with sealed-secrets — the operational story is fragile.
- **Never** mount secrets as `subPath` — silently disables atomic rotation.

### Networking + ingress

- **Ingress controllers**: NGINX, Traefik, Istio, AWS ALB, GKE ingress — pick based on platform + features. NGINX is the lowest-common-denominator.
- **TLS** via cert-manager + Let's Encrypt for public services. Use ClusterIssuer for cluster-wide certs.
- **NetworkPolicy** for pod-to-pod isolation — deny-all by default, allow specific paths. Critical for multi-tenant clusters; optional for single-app clusters.

### Storage

- **PersistentVolumeClaim** binds to PersistentVolume (provisioner-managed). Pod uses PVC name; storage backend is abstracted.
- **`accessModes`**: `ReadWriteOnce` (single node, most common); `ReadWriteMany` (multi-node — only on shared storage backends like NFS, CephFS); `ReadOnlyMany` (rare).
- **StorageClass** defines the provisioner + parameters (SSD vs HDD, replication, encryption). Default StorageClass is what gets used when a PVC doesn't specify one.

### Lifecycle + graceful shutdown

- **`terminationGracePeriodSeconds`** (default 30) is how long the pod has after SIGTERM before SIGKILL. Match it to your app's drain time.
- **`preStop` hook**: runs before SIGTERM. Use for "tell the load balancer to drain me" steps that need to happen before the process dies.
- **App must handle SIGTERM** — Node.js, Python, Go all need explicit signal handlers. Default is "exit immediately" which loses in-flight requests.

### Production-readiness checklist

- Resource requests + memory limits set
- 2+ replicas for stateless workloads
- Readiness probe configured + tested
- Graceful shutdown handler in app + matched `terminationGracePeriodSeconds`
- Labels follow `app.kubernetes.io/*` convention
- Secrets via env or mounted files (not baked into image)
- ImagePullPolicy explicit: `IfNotPresent` for production, `Always` for dev
- Image tag pinned to digest or semver (NEVER `:latest` in prod)
- ServiceMonitor / PrometheusRule for monitoring (or your platform's equivalent)
- HPA configured if traffic varies

## Common pitfalls

1. **Selector mismatch** — `selector.matchLabels` vs `template.metadata.labels` drift. Deployment creates Pods that don't get tracked. Symptom: replicas show 0 even though pods are running.
2. **`:latest` tag in production** — the image tag is mutable; cluster nodes cache differently. Different replicas can run different code. ALWAYS pin to digest or specific semver.
3. **Missing memory limits** — pod balloons to consume node memory, kernel OOM-killer evicts arbitrary other pods. Always set `limits.memory`.
4. **Liveness probe too aggressive** — kills pods during normal latency spikes. Start with conservative thresholds (e.g., `failureThreshold: 6, periodSeconds: 10` = 60s grace).
5. **Single replica for "stateless"** — node maintenance evicts it; outage. Always 2+ replicas + PodDisruptionBudget.
6. **No graceful shutdown** — Node.js default exits on SIGTERM, drops in-flight requests. Implement signal handler that closes server + drains.
7. **NodePort for "external" access** — locks you to cluster IPs + an arbitrary port; doesn't survive cluster moves. Use Ingress.
8. **Configs in image** — every config change requires a rebuild + redeploy. ConfigMaps + env-from-configmap let configs change without image rebuilds.

## Sources

- Kubernetes docs home: https://kubernetes.io/docs/home/ (canonical source per `kb:hets/canonical-skill-sources` H.6.7 registry)
- API reference: https://kubernetes.io/docs/reference/kubernetes-api/
- Concepts: https://kubernetes.io/docs/concepts/
- Production-readiness: https://kubernetes.io/docs/setup/production-environment/

## When to forge specialized sub-skills

If a task surfaces a sub-domain not adequately covered above (Helm chart authoring, custom resources / operators, service mesh — Istio/Linkerd, GitOps — ArgoCD/Flux, multi-cluster federation), surface a `request: forge-skill` via missing-capability-signal back to root. Don't try to cover the whole k8s ecosystem here — this skill is the manifest + workload baseline.
