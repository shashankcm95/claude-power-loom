# 50 — Agent personas (`agents/*.md`)

The `agents/` directory holds the **Agent-tool persona definitions** — the top
layer of the toolkit's intentional **3-layer persona split**. Each file is a
thin Markdown agent definition whose YAML frontmatter (`name`, `description`,
`tools:`, `model`, `color`) is what the Claude Code Agent/Task tool reads to
spawn a sub-agent by `subagent_type` (a.k.a. `agentType`). Per **ADR-0012**, the
frontmatter `tools:` field is the **single source of capability truth** — the
harness honors it statically at spawn time, and a build-time reconciliation
validator (`packages/runtime/orchestration/contracts-validate.js`,
`agent-contract-capability-reconcile`) binds each numbered persona contract's
declared traits back to this `tools:` floor. The body of most files is a
deliberately minimal **delegation stub** pointing at the authoritative identity
brief in `packages/runtime/personas/NN-<name>.md` and the persona contract in
`packages/runtime/contracts/NN-<name>.contract.json`. Two files (`architect.md`,
`planner.md`, and to a lesser degree `code-reviewer.md`, `optimizer.md`,
`security-auditor.md`) carry full inline bodies instead of delegating, because
they predate or sit outside the numbered HETS persona roster.

The 3-layer split is **canonical and must not be "deduped"** (per `CLAUDE.md`
and the migration-rot arc #251–#258): `agents/<name>.md` (spawn shim + capability
floor) → `packages/runtime/personas/NN-<name>.md` (full identity brief, the
"wisdom") → `packages/runtime/contracts/NN-<name>.contract.json` (required
skills, `kb_scope`, budget, `functional` + `antiPattern` verification checks +
capability traits).

## Directory contents & nesting

```text
agents/                          (19 files, all tracked; no README, no subdirs)
├── architect.md                 read-only  · opus   · design lens (FULL BODY, 225 ln)
├── code-reviewer.md             read+Bash  · sonnet · correctness lens (FULL BODY, 126 ln)
├── codebase-analyzer.md         read-only  · opus   · deep-read analyst
├── codebase-locator.md          read-only  · opus   · file/symbol finder
├── codebase-pattern-finder.md   read-only  · opus   · DRY/anti-pattern detector
├── confused-user.md             read-only  · opus   · usability adversary
├── data-engineer.md             WRITE      · opus   · ETL/warehouse builder
├── devops-sre.md                WRITE      · opus   · k8s/observability builder
├── hacker.md                    read+Bash  · opus   · offensive-security lens
├── honesty-auditor.md           read-only  · opus   · claim-vs-evidence lens
├── ios-developer.md             WRITE      · opus   · Swift/SwiftUI builder
├── java-backend.md              WRITE      · opus   · JVM/Spring builder
├── ml-engineer.md               WRITE      · opus   · ML/LLM-integration builder
├── node-backend.md              WRITE      · opus   · Node/TS backend builder
├── optimizer.md                 read+Bash+Edit · sonnet · harness/config optimizer (FULL BODY, 114 ln)
├── planner.md                   read-only  · opus   · planning specialist (FULL BODY, 165 ln)
├── python-backend.md            WRITE      · opus   · Python backend builder (NEW #353)
├── react-frontend.md            WRITE      · opus   · React/Next UI builder
└── security-auditor.md          WRITE      · sonnet · security remediation (FULL BODY, 107 ln)
```

### 3-layer correspondence (the load-bearing map)

| `agents/<name>.md` | `runtime/personas/NN-` | `contracts/NN-…contract.json` | Notes |
|---|---|---|---|
| `architect` | `04-architect` | `04-architect` | full inline body (Layer 1+2 principle ref) |
| `code-reviewer` | `03-code-reviewer` | `03-code-reviewer` | full inline body |
| `codebase-analyzer` | `15-codebase-analyzer` | `15-codebase-analyzer` | delegation stub |
| `codebase-locator` | `14-codebase-locator` | `14-codebase-locator` | delegation stub |
| `codebase-pattern-finder` | `16-codebase-pattern-finder` | `16-codebase-pattern-finder` | delegation stub |
| `confused-user` | `02-confused-user` | `02-confused-user` | delegation stub |
| `data-engineer` | `11-data-engineer` | `11-data-engineer` | delegation stub |
| `devops-sre` | `10-devops-sre` | `10-devops-sre` | delegation stub |
| `hacker` | `01-hacker` | `01-hacker` | delegation stub |
| `honesty-auditor` | `05-honesty-auditor` | `05-honesty-auditor` | delegation stub |
| `ios-developer` | `06-ios-developer` | `06-ios-developer` | delegation stub |
| `java-backend` | `07-java-backend` | `07-java-backend` | delegation stub |
| `ml-engineer` | `08-ml-engineer` | `08-ml-engineer` | delegation stub |
| `node-backend` | `13-node-backend` | `13-node-backend` | delegation stub |
| `python-backend` | `17-python-backend` | `17-python-backend` | NEW (#353), W4a subject persona |
| `react-frontend` | `09-react-frontend` | `09-react-frontend` | delegation stub |
| `security-auditor` | `12-security-engineer` | `12-security-engineer` | **NAME MISMATCH** (alias-bound) |
| `optimizer` | *(none)* | *(none)* | agent-only — no Layer 2/3 |
| `planner` | *(none)* | *(none)* | agent-only — no Layer 2/3 |

Reconciliation coverage boundary (from `contracts-validate.js`): the `write`
axis (`Edit`/`Write` → `worktree_writable` trait) is bound **both** directions
(floor-missing + over-grant); the `subprocess` axis (`Bash` →
`bash_test_runner`) binds only the over-grant direction; the `network` axis is
**deliberately un-reconciled** (no Claude Code `tools:` referent — egress is
audited at runtime by `kernel/observability/network-egress-audit.js`). The
un-numbered template contracts `challenger.contract.json` and
`engineering-task.contract.json` plus their `_lib/trait-resolve.js` and
`traits/_registry.json` are skipped by the gate (no single agent.md floor).

## Per-file catalog

### Read-only review/verify lenses (no `Edit`/`Write` — compliant with persona-selection Rule 3)

- **`architect.md`** — `["Read","Grep","Glob"]`, opus. System-design lens for
  trade-offs, ADRs, scalable patterns. **Full inline body** (225 lines) — the
  canonical Layer 1+2 reference for foundational principles (SOLID/DRY/KISS/YAGNI),
  the KB canonical-references section, the strict `kb:<id>` citation-format
  convention enforced by the `kb-citation-gate` PostToolUse hook, and the
  requirements-checklist output contract. Other persona stubs cross-reference
  `agents/architect.md §Citation format` for the gate-passing convention, so this
  file is load-bearing beyond its own spawn.
- **`code-reviewer.md`** — `["Read","Grep","Glob","Bash"]`, **sonnet**.
  Correctness/quality/security/perf review lens; `Bash` for running checks. Full
  inline body (126 lines).
- **`honesty-auditor.md`** — `["Read","Grep","Glob"]`, opus. Claim-vs-evidence
  rater; re-rates scorecards/shipping claims against artifacts. Delegation stub →
  `05-honesty-auditor`.
- **`hacker.md`** — `["Read","Grep","Glob","Bash"]`, opus. Offensive-security
  lens (SSRF/IDOR/injection/auth-bypass); `Bash` for live PoC probes — matches
  the Rule-2a "re-probe the BUILT code" discipline. Delegation stub →
  `01-hacker`.
- **`planner.md`** — `["Read","Grep","Glob"]`, opus. Planning specialist for
  multi-file/phased work. **Full inline body** (165 lines) with hard-rule,
  principle-audit, plan-template, and red-flags sections. **No Layer 2/3** (no
  numbered persona/contract).
- **`confused-user.md`** — `["Read","Grep","Glob"]`, opus. Usability adversary;
  reads docs/errors/UI from a newcomer's perspective. Delegation stub →
  `02-confused-user`.
- **`codebase-locator.md`** — `["Read","Grep","Glob"]`, opus. "Where is X?"
  file/symbol/reference finder. Delegation stub → `14-codebase-locator`.
- **`codebase-analyzer.md`** — `["Read","Grep","Glob"]`, opus. Deep-read analyst
  (what does it do, who calls it, deps). Delegation stub → `15-codebase-analyzer`.
- **`codebase-pattern-finder.md`** — `["Read","Grep","Glob"]`, opus. Cross-file
  duplication / anti-pattern / missing-abstraction detector. Delegation stub →
  `16-codebase-pattern-finder`.

### Write-capable builder personas (`Edit`/`Write` present → must carry `worktree_writable`)

- **`node-backend.md`** — full write tools, opus. Node/Express/NestJS/TS backend
  builder. Delegation stub → `13-node-backend`. (Note the known `13-node-backend`
  vs bare `node-backend` key-fragment seam in the verdict-attestation / reputation
  tracks — a documented laundering lever, not a bug here.)
- **`python-backend.md`** — full write tools, opus. **Newest persona** (#353,
  ③.1-W4a) — the real-corpus subject for the persona experiment. Delegation stub →
  `17-python-backend`.
- **`react-frontend.md`** — full write tools, opus. React/Next/TS UI builder
  (Server Components, a11y). Delegation stub → `09-react-frontend`.
- **`ios-developer.md`** — full write tools, opus. Swift/SwiftUI builder; pairs
  with the `swift-development` on-demand skill. Delegation stub → `06-ios-developer`.
- **`java-backend.md`** — full write tools, opus. JVM/Spring/Kafka builder.
  Delegation stub → `07-java-backend`.
- **`ml-engineer.md`** — full write tools, opus. ML pipelines / LLM integration /
  eval harness builder. Delegation stub → `08-ml-engineer`.
- **`data-engineer.md`** — full write tools, opus. ETL/warehouse/dbt/Airflow
  builder. Delegation stub → `11-data-engineer`.
- **`devops-sre.md`** — full write tools, opus. k8s/Helm/Terraform/observability
  builder. Delegation stub → `10-devops-sre`.
- **`security-auditor.md`** — `["Read","Write","Edit","Bash","Grep","Glob"]`,
  **sonnet**. The one **Write-capable security** persona (remediation, not
  read-only review). **Full inline body** (107 lines). Maps to
  `12-security-engineer` via the **name alias** in `contracts-validate.js`
  (`AGENT_NAME_ALIASES = { 'security-engineer': 'security-auditor' }`). Per the
  persona-selection discipline this persona must NOT be wired into a read-only
  review pass (use `hacker` for adversarial review).
- **`optimizer.md`** — `["Read","Grep","Glob","Bash","Edit"]` (`Edit` but **no
  `Write`**), **sonnet**. Harness/config optimizer (agent perf, hook efficiency,
  context budget, MCP health). **Full inline body** (114 lines). **No Layer 2/3**
  (no numbered persona/contract). Its `Edit`-without-`Write` grant is the only
  partial-write capability set in the directory.

## Findings

| Severity | Level | Type | Location | Description |
|---|---|---|---|---|
| MEDIUM | component | smell | `CLAUDE.md` (signpost table) | Stale persona counts: signpost says `personas/ (16 bodies)`, `contracts/ (20)`, `agents/*.md (18)`. Actual: **17** personas, **19** contracts (17 numbered + 2 templates), **19** agent files. All three drifted by one when `python-backend` (`17`) was forged in #353 (`43fd29d`); the contract `(20)` figure also never matched (always 19). Update to 17 / 19 / 19. |
| LOW | file | smell | `agents/security-auditor.md` vs `runtime/personas/12-security-engineer.md` | Cross-layer **name mismatch**: the agent file is `security-auditor` but its Layer 2/3 slot is `security-engineer`. Handled by an explicit alias (`AGENT_NAME_ALIASES`) so the capability-reconcile gate binds correctly, and documented in `contracts-validate.js`, but it is a standing footgun — the only persona where the basename diverges from its numbered slot. A rename (or a documented invariant note in an `agents/README.md`) would remove the special case. |
| LOW | component | smell | `agents/optimizer.md`, `agents/planner.md` | Two **agent-only personas with no Layer 2/3** (no `runtime/personas/NN-` brief, no `NN-contract.json`). They are silently skipped by `agent-contract-capability-reconcile` (no numbered contract → no floor to bind), so their `tools:` grants are **unreconciled** — `optimizer`'s `Edit` capability in particular has no contract `worktree_writable` cross-check. Intentional today, but undocumented; worth an explicit note that the numbered roster is HETS-only and these two are standalone Agent-tool personas. |
| LOW | component | gap | `agents/` (directory root) | **No `agents/README.md`.** The directory is the top layer of a canonical 3-layer split and the single source of capability truth (ADR-0012), yet there is no in-directory index explaining the delegation pattern, the 17-vs-19 count, the `security-auditor`↔`security-engineer` alias, or the agent-only `optimizer`/`planner`. `CLAUDE.md` carries a one-line pointer but it is the stale-count source above. A short README would localize the invariant and reduce the count-drift recurrence. |
| LOW | file | optimization | `agents/architect.md` (body) | The five full-inline-body files (`architect` 225 ln, `planner` 165 ln, `code-reviewer` 126 ln, `optimizer` 114 ln, `security-auditor` 107 ln) break the otherwise-uniform "thin delegation stub" pattern (the other 14 files are ~39–40 ln and defer to the persona brief). `architect`/`code-reviewer`/`security-auditor` DO have Layer 2/3 briefs, so their inline content partially duplicates the authoritative brief — a consolidation/dedup opportunity (move body content into `runtime/personas/NN-` and leave a stub), with the caveat that `architect.md §Citation format` is cross-referenced by other stubs and must remain reachable at that path if moved. |
| INFO | component | smell | `agents/*.md` (frontmatter) | **Capability grants are consistent with the persona-selection discipline.** All four review/verify lenses (`architect`, `code-reviewer`, `honesty-auditor`, `hacker`) are read-only (Rule 3 compliant); `security-auditor` and the domain builders are Write-capable (correctly NOT used in read-only review passes). No capability drift or over-grant detected against the discipline. Model split: 16 opus / 3 sonnet (`code-reviewer`, `optimizer`, `security-auditor` are sonnet). |
| INFO | function | smell | `agents/*.md` (body, line ~11) | All 14 delegation stubs reference the Agent tool's "`subagent_type` requirement". The always-on rules and workflow docs use the term `agentType` for the same field. Both name the same selector, but the terminology is inconsistent across surfaces — harmless, noted for a future glossary pass. |
