---
kb_id: hets/stack-skill-map
version: 1
tags: [hets, stack, skills, mapping, analyzer]
---

## Summary

Stack → required-skills mapping for the [tech-stack-analyzer](../../patterns/tech-stack-analyzer.md). Read by the analyzer skill to translate "I'm building a Next.js + Tailwind site" into a concrete skill requirements list. Personas are picked from the persona-skills mapping (each persona's `skills.required` overlaps the requirements). Editable — add a stack here when a new project domain emerges.

## Full content

### Schema

Each stack entry maps to:
- **`required`**: skills the team MUST have for the work
- **`recommended`**: skills that materially improve quality (proceed-without is OK)
- **`personas`**: persona ids whose `skills.required` overlap the required set
- **`rationale`**: 1-line note on WHY this stack — used in the analyzer's plan-review gate

Naming follows the contract convention:
- Bare name (e.g., `swift-development`) = locally-authored skill
- `<plugin>:<skill>` (e.g., `engineering:debug`) = marketplace skill
- Either form may have status `not-yet-authored` (resolved at runtime via `kb-resolver list`)

### Stacks

#### Web — marketing / static site
```yaml
required: [react, typescript, tailwind, next-js]
recommended: [engineering:code-review, engineering:debug, design:accessibility-review, engineering:deploy-checklist]
personas: [09-react-frontend]
rationale: Static-export friendly, low ops overhead, strong a11y story, edge-functions when interactivity is needed
```

#### Web — interactive dashboard / SPA
```yaml
required: [react, typescript]
recommended: [engineering:code-review, engineering:debug, engineering:testing-strategy, design:accessibility-review]
personas: [09-react-frontend, 11-data-engineer]
rationale: SPA + WebSockets/SSE for realtime; data-engineer if ingest pipelines are part of scope
```

#### Web — Server-Side Rendered app (Next.js / Remix)
```yaml
required: [react, typescript, next-js]
recommended: [engineering:system-design, engineering:code-review, design:accessibility-review, engineering:testing-strategy]
personas: [09-react-frontend, 07-java-backend]
rationale: SSR for SEO + perf; backend persona joins if API surface is non-trivial
```

#### Mobile — iOS native
```yaml
required: [swift-development]
recommended: [swiftui, xcode-debugging, app-store-deployment, core-data, engineering:debug, engineering:testing-strategy]
personas: [06-ios-developer]
rationale: Apple-platform-native; Swift idioms + SwiftUI for new screens; Core Data unless backend-driven
```

#### Backend — JVM service
```yaml
required: [spring-boot]
recommended: [jpa-orm, jvm-tuning, kafka, postgres-engineering, engineering:system-design, engineering:debug, engineering:testing-strategy]
personas: [07-java-backend, 11-data-engineer]
rationale: Spring Boot is the JVM service default; data-engineer joins for DB-heavy domains
```

#### Backend — Python service
```yaml
required: [python-web-framework]
recommended: [engineering:system-design, engineering:code-review, engineering:debug, engineering:testing-strategy]
personas: [07-java-backend]
rationale: 07-java-backend persona is the closest match for general backend work; python-web-framework skill is not-yet-authored (bootstrap path applies). Long-term: warrants its own 14-python-backend persona — track in BACKLOG.
```

#### Backend — Node / Express / NestJS service
```yaml
required: [node-backend-development]
recommended: [express, nest-js, typescript, postgres-engineering, engineering:system-design, engineering:debug, engineering:testing-strategy, engineering:deploy-checklist, engineering:code-review]
personas: [13-node-backend]
rationale: Async-first runtime, single-threaded event loop, JS/TS ecosystem. 13-node-backend persona has Node-specific kb_scope (node-runtime-basics + express-essentials); skills are aspirational (not-yet-authored — bootstrap path applies). Closes the H.6.1 routing gap where Express tasks couldn't be coherently routed.
```

#### Data — ETL pipeline
```yaml
required: [airflow]
recommended: [dbt, snowflake, kafka, data-modeling, data:sql-queries, data:explore-data, data:validate-data, engineering:debug]
personas: [11-data-engineer]
rationale: Airflow for orchestration; dbt for transformations; data-modeling for schema design
```

#### Data — Analytics / BI
```yaml
required: [data:sql-queries, data:explore-data]
recommended: [data:statistical-analysis, data:validate-data, data-modeling, snowflake]
personas: [11-data-engineer]
rationale: Marketplace data plugin covers most analytics needs; data-engineer for warehouse / modeling
```

#### ML — Training pipeline
```yaml
required: [ml-pipelines, pytorch]
recommended: [model-evaluation, model-deployment, data:sql-queries, data:explore-data, data:validate-data, data:statistical-analysis, engineering:debug, engineering:testing-strategy]
personas: [08-ml-engineer, 11-data-engineer]
rationale: PyTorch for modeling; ml-pipelines for orchestration; data-engineer if dataset prep is part of scope
```

#### ML — Inference / serving
```yaml
required: [model-deployment]
recommended: [pytorch, model-evaluation, kubernetes, prometheus]
personas: [08-ml-engineer, 10-devops-sre]
rationale: Serving is more an infra problem than ML problem; devops-sre joins for k8s + observability
```

#### Infra — Kubernetes deployment
```yaml
required: [kubernetes]
recommended: [terraform, prometheus, engineering:incident-response, engineering:deploy-checklist, engineering:standup]
personas: [10-devops-sre]
rationale: K8s + Terraform for declarative infra; observability + incident-response for prod readiness
```

#### Infra — Serverless (AWS Lambda / Cloudflare Workers)
```yaml
required: [terraform]
recommended: [engineering:deploy-checklist, engineering:incident-response, kubernetes]
personas: [10-devops-sre]
rationale: Terraform for IaC; less k8s emphasis (functions, not pods)
```

#### Security — Application audit
```yaml
required: [security-audit, penetration-testing]
recommended: [engineering:code-review, cryptography, iam, compliance-frameworks, legal:compliance-check]
personas: [12-security-engineer]
rationale: Audit-class work; penetration-testing skill is not-yet-authored but security-audit covers most static analysis
```

### Default fallback (no stack matched)

When the user task doesn't match any of the above:
- `required: []`
- `recommended: [engineering:code-review, engineering:debug, research-mode]`
- `personas: [04-architect]`  # Architect can shape the task into something matchable
- `rationale: No stack inferred — architect persona will scope the task and propose a refined stack in their findings`

### How the analyzer uses this

1. Analyzer parses user task → extracts intent + domain signals
2. Looks up best-matching stack from this doc (substring match on rationale + persona overlap)
3. Returns `{ stack, required, recommended, personas, rationale }` to user
4. User redirects (different stack, additional skills, persona swap) OR confirms
5. On confirmation, analyzer queries `kb-resolver list` to mark each skill as `available` / `marketplace` / `not-yet-authored`
6. For `not-yet-authored` skills, analyzer surfaces the [skill-bootstrapping](../../patterns/skill-bootstrapping.md) prompt

### Maintenance

- **When a new persona ships** → add it to relevant stacks above + add a new stack section if the persona unlocks a new domain
- **When marketplace plugins change** → update `marketplace:` references; broken refs surface via `kb-resolver scan` warnings
- **When the team converges on a stack we don't have** → add it (this doc is supposed to grow)
