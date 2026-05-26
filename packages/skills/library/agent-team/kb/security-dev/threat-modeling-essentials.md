---
kb_id: security-dev/threat-modeling-essentials
version: 1
tags: [security, threat-modeling, stride, attack-trees, starter]
---

## Summary

Threat modeling essentials for HETS security-engineer personas: STRIDE framework for systematic enumeration (Spoofing, Tampering, Repudiation, Information disclosure, DoS, Elevation of privilege); attack trees for goal-oriented analysis; threat actor profiles (script kiddie → nation-state) shape what's worth defending against; trust boundaries are where threats originate; data flow diagrams as the substrate. Stub doc — expand on use.

## Full content (starter — expand when first persona uses)

### STRIDE — systematic threat enumeration

For each component / data flow, ask:

| Letter | Threat | Example |
|--------|--------|---------|
| **S** | Spoofing | Attacker pretends to be another user |
| **T** | Tampering | Attacker modifies data in transit or at rest |
| **R** | Repudiation | Attacker denies performing an action; no audit trail |
| **I** | Information disclosure | Attacker reads data they shouldn't see |
| **D** | Denial of service | Attacker exhausts resources, blocks legitimate users |
| **E** | Elevation of privilege | Attacker gains capabilities they shouldn't have |

Match each to defense:
- S → Authentication
- T → Integrity (signing, hashing, TLS)
- R → Logging + non-repudiation (signed logs)
- I → Authorization + encryption
- D → Rate limiting + autoscaling + isolation
- E → Least privilege + privilege separation

### Attack trees

Goal-oriented modeling. Root = attacker's goal (e.g., "exfiltrate user PII"). Children = ways to achieve it. Leaves = atomic actions.

Useful for prioritization: branches with low-cost leaves are highest-risk.

### Threat actor profiles

| Actor | Motivation | Capability | Typical defense bar |
|-------|-----------|-----------|---------------------|
| Script kiddie | Boredom, status | Low (off-the-shelf tools) | Patching + WAF |
| Insider (negligent) | Mistakes | Variable | Access reviews + DLP |
| Insider (malicious) | Money, revenge | High (privileged access) | Audit + separation of duties |
| Cybercriminal | Money | Medium (custom tools) | Defense in depth |
| Nation-state | Geopolitical | High (zero-days, persistence) | Specialized — requires gov-grade controls |

Most products defend through "cybercriminal"; nation-state defense is its own discipline.

### Trust boundaries

Every system has trust boundaries — where data crosses from less-trusted to more-trusted zones. Attackers operate at the boundary. Map them explicitly:
- Internet → DMZ
- DMZ → application tier
- Application tier → database
- Service A → Service B (different teams = different trust zones)

### Data flow diagrams (DFDs)

The substrate for threat modeling:
- **External entities** (users, third-party services)
- **Processes** (application code)
- **Data stores** (databases, caches, files)
- **Data flows** (HTTP requests, queue messages, file writes)
- **Trust boundaries** (lines crossing between zones)

For each data flow crossing a trust boundary, run STRIDE.

### Common pitfalls

- Threat modeling done once at design time, never revisited
- Modeling defends against script-kiddies when actor profile demands more
- "We have a firewall" assumed sufficient (defense in depth)
- Auth without authz (authenticated users can do anything)
- No incident response plan (detection without response is theater)

### Related KB docs (planned)

- `kb:security-dev/auth-patterns`
- `kb:security-dev/owasp-top-10`
- `kb:security-dev/incident-response`
