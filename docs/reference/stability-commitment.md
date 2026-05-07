# Stability Commitment (v1.x)

> Returns to README: [../../README.md](../../README.md)


power-loom adopts SemVer at v1.0.0. Within v1.x:

**Stable (frozen — no breaking changes):**

- Plugin manifest schema (`.claude-plugin/plugin.json`)
- Hook contracts (input JSON shape from Claude Code; output `decision: approve|block` shape)
- Install paths (plugin marketplace + legacy installer)
- Public CLI surface (`agent-identity {assign|stats|recommend-verification|breed}`; `pattern-recorder record`; `route-decide`; `contract-verifier`; `contracts-validate`)
- The `tierOf` formula at `agent-identity.js:98-105` (binary cliff at `passRate ≥ 0.8` AND `verdicts ≥ 5`) — preserved byte-for-byte per the H.4.2 audit-transparency commitment

**Evolving (under explicit version fields):**

- Trust formula weights (`WEIGHT_PROFILE_VERSION`; today `"h7.0-multi-axis-v1"`; refit triggers when sample size justifies)
- Persona contracts (schema-additive only; never delete fields; `_backfillSchema` handles legacy reads)
- Route-decide thresholds (`weights_version`; today `"v1.1-context-aware-2026-05-07"`; calibration ongoing)

**Experimental (explicitly not stable):**

- Breeding mechanics (`agent-identity breed`) — manual subcommand today; auto-mode deferred to H.7.5+
- Drift triggers (recalibration thresholds) — theory-driven defaults, refit when ≥3 high-trust identities have ≥30 verdicts
- New trust axes (`recency_decay_factor`, `qualityTrend`) — observable today; not score-affecting until empirical thresholds met

Schema migrations are additive (per H.6.6 `_backfillSchema` pattern). Breaking changes to the stable surface require v2. See [CHANGELOG.md](CHANGELOG.md) for version history.

