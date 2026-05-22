---
kb_id: design-pushback/plain-http-for-sensitive-data
version: 1
tags: [design-pushback, security, web, backend, network, medium-severity]
related:
  - security-dev/auth-patterns
  - architecture/discipline/error-handling-discipline
status: active+enforced
pattern: |
  Configuring an application endpoint to accept plaintext HTTP (no TLS)
  for routes that transit credentials, PII, session tokens, or any data
  whose interception would harm a user. Includes "mixed-content" cases
  where HTML loads over HTTPS but XHR/fetch targets HTTP, and dev/staging
  environments shared with real-user data.
severity: MEDIUM
applies_when:
  intent: [build, plan]
  domain: [web, backend, mobile, infra]
  feature_keywords:
    - HTTP
    - "http://"
    - "no TLS"
    - "TLS termination"
    - reverse proxy
    - load balancer
    - "internal service"
    - localhost
    - "dev server"
    - intranet
    - "service mesh"
applies_NOT_when:
  - "localhost-only dev with no real data"
  - "intra-pod traffic in a mesh with mTLS at the data plane"
  - "explicitly air-gapped network with no external connectivity"
  - "static site with no user data"
preferred_alternative:
  - "TLS termination at the edge (CloudFlare, fly.io, Vercel, AWS ALB) + HTTP to backend inside private network"
  - "Service mesh with mTLS (Linkerd, Istio) for east-west traffic"
  - "Let's Encrypt + Caddy/Traefik for self-hosted (zero-config TLS)"
why_better: |
  - **Eavesdropping defense**: TLS makes passive interception infeasible.
    On WiFi networks, mobile networks, ISP middle boxes, and corporate
    proxies, HTTP traffic is observable. TLS prevents this.
  - **Tamper resistance**: TLS prevents middle-box tampering (injecting
    ads, modifying responses, redirecting to phishing). HTTP has zero
    defense against this.
  - **Cookie security**: cookies marked `Secure` refuse to send over HTTP.
    If you set Secure cookies, an HTTP path breaks auth. If you don't,
    cookies leak over any HTTP exposure.
  - **Mixed-content blocking**: modern browsers block HTTP fetches from
    HTTPS pages. A mixed-content path is a runtime failure waiting to
    happen.
  - **HTTP/2 + HTTP/3 require TLS**: practical perf wins (multiplexing,
    0-RTT) are only available with TLS in mainstream deployments.
  - **Compliance / certification**: SOC 2, PCI DSS, HIPAA, GDPR all
    expect TLS for data-in-transit. HTTP exposes the org to audit
    findings.
  - **Zero-cost TLS**: Let's Encrypt + auto-cert tooling means there's
    no resource argument for skipping TLS. The "cost of certificates"
    objection from 2015 is no longer valid.
override_requires: |
  Explicit acknowledgment that:
  - This endpoint never carries credentials, session tokens, PII, or
    any data whose interception would harm a user
  - You have an external compensating control (mTLS service mesh, IPSec
    tunnel, physical network isolation) that prevents the relevant
    threat actor from being on-path
  - You accept the data-in-transit compliance gap
  Local dev / loopback (`localhost`, `127.0.0.1`) is exempt by default —
  this entry does not pushback on localhost HTTP.
empirical_origin: |
  v2.8.2-run1 + v2.8.3-run1 surfaced this adjacent to SSRF findings —
  the brief's Phase 1 used localhost HTTP for the Next.js dev server
  (legitimate dev case), but the design-pushback discipline applies to
  the production deployment which both runs deferred. Industry-common
  pattern: PCI DSS 4.0, NIST 800-52 (TLS 1.2+ mandate).
---

## Quick Reference

**The anti-pattern**: An app exposes HTTP endpoints for routes that
transit sensitive data. Common variants:

1. Production load balancer accepting HTTP on port 80 without redirecting
   to HTTPS
2. Internal service-to-service calls over HTTP within a "trusted" network
3. Dev/staging environment with real user data accessible over HTTP
4. Mixed-content: HTML page over HTTPS but XHR endpoint over HTTP
5. WebSocket endpoint as `ws://` instead of `wss://`

**Why it bites**: anyone on the network path (corporate proxy, ISP,
public WiFi, compromised router, malicious endpoint near the user) sees
credentials and session tokens in plaintext. Active attackers tamper
with responses. Cookies can't have the Secure flag without breaking
non-TLS flows.

**The fix**:

1. Terminate TLS at the edge (managed by ALB / CloudFlare / Vercel /
   fly.io — they auto-provision certs)
2. Force HTTPS via 301 redirect from HTTP for legacy/bookmark traffic
3. Send Strict-Transport-Security header so browsers refuse downgrade
4. Mark all cookies Secure; check that no resource is loaded mixed-
   content
5. For internal calls: mTLS via service mesh OR plain HTTP within a
   network you control end-to-end + explicit threat model documenting
   "trusted network" assumption

## Full content

### The "internal network" objection

A common justification: "this is internal-only; we control the network".

This was the conventional wisdom 15 years ago. It's not the current
state-of-the-art for several reasons:

- **Zero-trust networking**: modern security posture assumes the network
  is hostile even inside the perimeter. Insider threats, compromised
  workloads, supply-chain attacks all live "behind the firewall".
- **Service mesh ubiquity**: Linkerd / Istio / Consul Connect provide
  mTLS as a configuration option — same plain-HTTP code, encrypted on
  the wire, certificate rotation handled automatically.
- **Cloud network reality**: "internal" often means a virtual network
  shared with thousands of other tenants. Cross-tenant attacks have
  precedent (search "Azure ChaosDB", "AWS XEN" for examples).

The pattern that holds up: HTTP can be acceptable for east-west traffic
IF the entire network stack provides equivalent guarantees (mTLS mesh,
IPSec tunnels). Plain HTTP because "internal" is increasingly an
audit finding, not a defensible design choice.

### Severity calibration: why MEDIUM not HIGH

This entry is MEDIUM because:

- Real damage from HTTP requires an attacker on-path (less common than
  pure-server vulnerabilities)
- Mitigating compensating controls (network isolation, VPN-only access)
  do exist for some valid contexts
- The fix has near-zero cost (Let's Encrypt + reverse proxy) so the
  pushback is informational, not blocking

The pattern moves to HIGH if the brief explicitly mentions:
- "internet-facing"
- "user PII"
- "payment", "PCI"
- "healthcare", "HIPAA"
- "personal data", "GDPR"

In those contexts, HTTP is a hard audit finding regardless of network
topology arguments.

### Migration path

For a typical web app accepting HTTP:

1. **Provision cert**: Caddy/Traefik (zero-config Let's Encrypt) or
   managed (Vercel/fly.io auto-provision)
2. **Update server config**: bind HTTPS on 443; bind HTTP on 80 only
   for redirect handler
3. **Force redirect**: HTTP 301 → HTTPS for all paths
4. **Add HSTS header**: `Strict-Transport-Security: max-age=63072000;
   includeSubDomains; preload` (commit to HTTPS-forever before adding
   preload directive)
5. **Audit cookies**: ensure all session cookies have `Secure` flag;
   document any exceptions
6. **Update client config**: change `http://` to `https://` in any
   hardcoded URLs (mobile apps, internal tools)
7. **Verify**: SSL Labs server test (https://www.ssllabs.com/ssltest/);
   aim for A grade
8. **CSP**: add `upgrade-insecure-requests` directive so legacy HTTP
   references upgrade automatically

For internal service-to-service: deploy mTLS via service mesh OR
self-signed cert + CA distribution for static topologies.

### References

- OWASP Transport Layer Protection Cheat Sheet
- Let's Encrypt: https://letsencrypt.org/
- HSTS Preload List: https://hstspreload.org/
- BeyondCorp (Google's zero-trust paper): https://research.google/pubs/pub43231/
- Mozilla SSL Config Generator: https://ssl-config.mozilla.org/
