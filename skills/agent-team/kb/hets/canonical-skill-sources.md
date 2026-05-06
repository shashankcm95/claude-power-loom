---
kb_id: hets/canonical-skill-sources
version: 1
tags: [hets, skill-forge, canonical-sources, evolution-loop-l2]
---

## Summary

Authoritative-source registry for skill-forge. Maps skill-name → official documentation URL. When `/forge <skill>` runs, it consults this registry FIRST and uses the canonical source as the primary reference; falls back to generic internet research only when no canonical source exists. L2 of the evolution-cycle vision (H.6.7): better INPUTS to the substrate produce higher-quality forged skills, faster trust accumulation, faster L3 selection signal. Editable — add an entry when a new tech stack lands.

## Full content

### Why a registry, not "search the internet"

Tech skills (React, Kubernetes, Spring Boot) have authoritative documentation that's structurally better than generic blog posts:
- Maintained by the project owners; tracks current API surface
- Canonical syntax and patterns (not "12 Stack Overflow answers from 2018")
- Comprehensive (covers the long tail, not just hot-path examples)
- License-clear (most projects publish docs under permissive licenses)

A skill forged from `react.dev/reference` will encode the React team's idioms; one forged from "react best practices 2024" search results encodes whichever blog ranked highest that month. The registry trades discovery cost for authority — and discovery cost is one-time per skill.

### Schema

Each entry: skill-name → `{ url, type, notes }`:

- **`url`** — primary documentation URL. Prefer reference docs over tutorials (more comprehensive surface area).
- **`type`** — what kind of source. Values:
  - `reference` — comprehensive API reference (highest authority; preferred when available)
  - `getting-started` — official tutorial / quickstart (use when no comprehensive reference exists)
  - `spec` — language / protocol specification (the most authoritative form for languages and standards)
  - `book` — official book / handbook (e.g., TypeScript Handbook)
- **`notes`** — anything that changes how skill-forge uses the source (e.g., "use the v18 docs only; v17 has known deprecations").

### Registry

#### Web / Frontend

```yaml
react:
  url: https://react.dev/reference/react
  type: reference
  notes: Always v18+; the reference (not the learn section) covers the full hooks + concurrent-rendering surface. Skip the deprecated reactjs.org docs.

typescript:
  url: https://www.typescriptlang.org/docs/handbook/intro.html
  type: book
  notes: Handbook is the canonical reference for type-system semantics; the cheat sheets section is also useful for pattern lookup.

tailwind:
  url: https://tailwindcss.com/docs
  type: reference
  notes: v3 docs are stable; cross-reference utility classes with the source-of-truth in the docs (avoid third-party cheatsheets that drift across versions).

next-js:
  url: https://nextjs.org/docs
  type: reference
  notes: Always App Router (post-13.4) unless task explicitly says Pages Router. The "App Router" docs are the canonical surface today.

vue:
  url: https://vuejs.org/guide/
  type: reference
  notes: v3 (Composition API) is the canonical version. Refer to the Options API section only when the task says legacy.
```

#### Backend / Server

```yaml
node-backend-development:
  url: https://nodejs.org/docs/latest/api/
  type: reference
  notes: Latest LTS API docs; cross-reference event-loop + async-hooks docs for runtime semantics. Don't rely on package-specific blogs for runtime guarantees.

express:
  url: https://expressjs.com/en/4x/api.html
  type: reference
  notes: 4.x is current; 5.x is in development. Middleware ordering + error handling are the load-bearing sections.

spring-boot:
  url: https://docs.spring.io/spring-boot/index.html
  type: reference
  notes: Use the latest GA version's docs; auto-configuration + actuator + production-ready features are the Spring-Boot-specific surface (vs vanilla Spring).

python-backend-development:
  url: https://docs.python.org/3/
  type: reference
  notes: Standard library reference. For async patterns specifically, asyncio + concurrent.futures docs are the canonical source.

fastapi:
  url: https://fastapi.tiangolo.com/
  type: reference
  notes: Tutorial + Advanced User Guide together cover the canonical surface. Pydantic v2 integration is the modern path.

nest-js:
  url: https://docs.nestjs.com/
  type: reference
  notes: Decorators + dependency injection + module structure are the load-bearing concepts; understand these before peripheral features.
```

#### Mobile

```yaml
swift-development:
  url: https://www.swift.org/documentation/
  type: reference
  notes: Language reference + The Swift Programming Language book. For Apple-platform-specific work cross-reference https://developer.apple.com/documentation/swift.

kotlin:
  url: https://kotlinlang.org/docs/home.html
  type: reference
  notes: Reference covers language; coroutines have their own dedicated section. For Android-specific work cross-reference https://developer.android.com/kotlin.

react-native:
  url: https://reactnative.dev/docs/getting-started
  type: getting-started
  notes: The Components and APIs sections are the closest thing to a reference; cross-reference with the host platform docs (iOS for Swift bridge / Android for Kotlin bridge).
```

#### Data / ML

```yaml
pytorch:
  url: https://pytorch.org/docs/stable/index.html
  type: reference
  notes: Tensor + nn + optim + autograd are the load-bearing modules. For training loops the Lightning docs are pragmatic but not canonical.

pandas:
  url: https://pandas.pydata.org/docs/
  type: reference
  notes: User Guide for idioms; API reference for exact signatures. Performance section explains when to fall through to numpy.

postgresql:
  url: https://www.postgresql.org/docs/current/
  type: reference
  notes: Tutorial + SQL Language + Server Administration are the three core sections. Index + EXPLAIN + transaction-isolation docs are critical for engineering work.

redis:
  url: https://redis.io/docs/
  type: reference
  notes: Commands reference + Reference (data-types, persistence, replication) are canonical. Avoid version-specific blog posts; commands have evolved across major versions.

airflow:
  url: https://airflow.apache.org/docs/
  type: reference
  notes: Always Airflow 2.x docs (1.x deprecated since 2021). Concepts (DAGs, tasks, executors, sensors) + Best Practices are load-bearing. For provider operators see https://airflow.apache.org/docs/apache-airflow-providers/. Added H.6.9 via niko's extend-canonical-sources request from Task 5 ETL run.
```

#### Infra / DevOps

```yaml
kubernetes:
  url: https://kubernetes.io/docs/home/
  type: reference
  notes: Concepts + Tasks + Reference are the three pillars. For YAML manifests the API reference (https://kubernetes.io/docs/reference/kubernetes-api/) is the source of truth.

docker:
  url: https://docs.docker.com/
  type: reference
  notes: Manuals (Engine, Compose, Buildx) and Reference (CLI, Dockerfile, API) are canonical. Avoid third-party "best practices" — they drift fast on a moving target.

terraform:
  url: https://developer.hashicorp.com/terraform/docs
  type: reference
  notes: Language docs + CLI docs + Cloud-platform-specific provider docs (AWS, GCP, Azure each have their own canonical reference URL).
```

#### Security

```yaml
security-audit:
  url: https://owasp.org/www-project-top-ten/
  type: reference
  notes: OWASP Top 10 is the canonical starting surface. Cross-reference https://cwe.mitre.org/ for specific weakness IDs and https://cheatsheetseries.owasp.org/ for engineering-actionable defenses.

penetration-testing:
  url: https://owasp.org/www-project-web-security-testing-guide/
  type: reference
  notes: WSTG is the methodology canonical source. Tool-specific docs (Burp, OWASP ZAP) are secondary.
```

### Lookup convention (for skill-forge)

```
1. Read the skill name passed to /forge
2. Look up the name in this registry
3. If found:
     - Use the `url` as the primary source
     - Note the `type` (reference > getting-started > getting-started+blog) to scope research depth
     - Apply `notes` field to the forge prompt as additional context
4. If not found:
     - Proceed with generic internet research (existing skill-forge behavior)
     - At task end, surface "should this skill be added to the canonical registry?" via missing-capability-signal
```

### Failure modes

1. **Stale URLs** — projects relocate their docs (React did it; Node did it). Counter: each entry's `notes` field can mention version pinning; periodic audit (`kb-resolver scan` + manual check) refreshes URLs. Quarterly cadence works in practice.
2. **Wrong canonical source picked** — picking `expressjs.com` when the user actually meant Express.js the company (a Java framework). Counter: skill-name conventions are `<skill-name>` not `<plugin>:<skill>`; the registry only covers skill-name as forged through skill-forge.
3. **Missing entry blocks forge** — registry omits a skill, skill-forge falls back to generic search. NOT a regression — falls back to existing behavior.
4. **Documentation availability gap** — some skills (in-house tools, niche stacks) have no canonical source. Counter: leave them out of the registry; existing internet-research path is the right answer.
5. **Licensing** — official docs are usually permissively licensed but not always (e.g., some commercial DBs). Counter: skill-forge already records sources per claim; copyright check happens at /review time.

### When to add an entry

- A skill is forged for the first time AND has an authoritative source — add at task end via missing-capability-signal request `type: extend-canonical-sources`
- An existing entry's URL has stale (project relocated docs) — bump `version` + update `url` + add note
- Cross-reference shifts (e.g., Apple moves Swift docs from swift.org to developer.apple.com) — update `notes` to clarify

### When NOT to add

- One-off skills that won't recur ("script-for-this-specific-CSV") — bloat the registry without value
- Internal-tool skills (no public canonical source exists)
- Skills where multiple-sources is intentional (e.g., "css" — depends on browser; canonical is MDN but spec is W3C)

### Coverage today (H.6.7 v1)

This is a starter set covering the 13 builder personas' skill domains. Expected to grow as new stacks land in the toolkit:

```
Web / Frontend:        react, typescript, tailwind, next-js, vue           (5 entries)
Backend / Server:      node-backend-development, express, spring-boot,
                       python-backend-development, fastapi, nest-js        (6 entries)
Mobile:                swift-development, kotlin, react-native              (3 entries)
Data / ML:             pytorch, pandas, postgresql, redis                   (4 entries)
Infra / DevOps:        kubernetes, docker, terraform                        (3 entries)
Security:              security-audit, penetration-testing                  (2 entries)
─────────────────────────────────────────────────────────────────────────
TOTAL:                                                                      23 entries
```

### Related KB docs

- [stack-skill-map](stack-skill-map.md) — maps stacks → required skills (this registry maps skills → their canonical sources)
- [spawn-conventions](spawn-conventions.md) — the convention sub-agents follow when surfacing canonical-source updates back to root
