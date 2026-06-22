# Project Structure

> Returns to README: [../../README.md](../../README.md)

Since Phase 0 (ADR-0008), the repo is a pnpm workspace organized into `packages/` by the
three-layer kernel / runtime / lab model. `CLAUDE.md` at the repo root is the authoritative
router over this layout; this is the walkthrough.

```
claude-toolkit/
├── agents/                      # 19 Agent-tool persona defs (architect, code-reviewer, hacker, …) with YAML frontmatter
├── packages/
│   ├── kernel/                  # Tier 1 — the enforced, deterministic substrate
│   │   ├── hooks/               #   lifecycle/ + pre/ + post/ + _lib/ hook scripts
│   │   ├── validators/          #   K5 schema / secret / config / frontmatter validators
│   │   ├── egress/              #   the PR-egress chokepoint (emit-pr.js, policy.js, scrub.js) — armedEmit() THROWS
│   │   ├── spawn-state/         #   spawn-record, post-spawn-resolver, integrator, recovery-sweep
│   │   ├── enforcement/         #   K10 escape-hatch, K13 serial enforcer
│   │   ├── recall/              #   the K4 recall-CLI (loom-recall.js)
│   │   ├── algorithms/          #   route-decide.js (the A4 kernel algorithm library)
│   │   ├── observability/       #   network-egress-audit (advisory)
│   │   ├── _lib/                #   record-store, transaction-record, weight-minter, path-canonicalize, …
│   │   ├── gc/  schema/  worktree/
│   │   ├── hooks.json           #   the wired hook manifest (29 registrations across 6 lifecycle events)
│   │   └── settings-reference.json  # hook-config template for the legacy installer
│   ├── runtime/                 # Tier 2 — HETS orchestration (best-effort)
│   │   ├── orchestration/       #   contracts-validate, kb-resolver, borderline-resolver, …
│   │   ├── personas/            #   17 persona bodies (01-hacker … 17-python-backend)
│   │   ├── contracts/           #   19 contract files (17 personas + challenger + engineering-task)
│   │   └── decomposition/  verify/  test-runners/  traits/  schema/
│   ├── lab/                     # Tier 3 — the Evolution Lab (advisory / shadow)
│   │   ├── attribution/  reputation/  circuit-breaker/  manage-proposal/  verdict-attestation/
│   │   └── causal-edge/  issue-corpus/  trace-emitter/  negative-attestation/  persona-experiment/  …
│   ├── skills/                  # the instruction-following layer SOURCE
│   │   ├── rules/               #   core/ (7 always-on rules) + typescript/ + web/
│   │   ├── commands/            #   14 slash-command definitions
│   │   ├── library/             #   21 skill workflow guides (SKILL.md per skill)
│   │   └── agent-team/patterns/ #   reusable HETS architectural patterns
│   └── specs/                   # the design record (canonical)
│       ├── adrs/                #   ADRs 0001–0017
│       ├── rfcs/  plans/        #   the v6 synthesis RFC + living per-wave plans
│       └── research/  spikes/  bench/  architecture-substrate/
├── swarm/run-state/             # live + resumable HETS run state (gitignored)
├── scripts/                     # library.js + library-migrate.js + generate-signpost.js + status/diagnostic probes
├── tests/unit/                  # {kernel, runtime, lab, hooks, agents, …} unit suites
├── examples/                    # runnable demos (delta-promote-demo.js)
├── docs/                        # this documentation tree
├── bin/                         # migrate-to-plugin.sh
├── install.sh                   # legacy installer (--all, --hooks, --rules, --test, --schedule-heartbeat, …)
├── CLAUDE.md                    # the router/index (signpost, not memory)
├── README.md  CHANGELOG.md  CONTRIBUTING.md  ATTRIBUTION.md  LICENSE
└── .claude-plugin/plugin.json   # the plugin manifest (power-loom 3.11.0)
```

---
