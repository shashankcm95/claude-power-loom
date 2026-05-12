# Stability Commitment (v2.x)

> Returns to README: [../../README.md](../../README.md)


power-loom shipped **v2.0.0 on 2026-05-12** after the H.9.x substrate-hardening track (chaos findings closure at H.9.15 + drift-notes resolution at H.9.16 + release-ceremony at H.9.17). Within v2.x, the substrate commits to:

**Stable (frozen — no breaking changes):**

- Plugin manifest schema (`.claude-plugin/plugin.json`)
- Hook contracts (input JSON shape from Claude Code; output `decision: approve|block` shape per ADR-0001 fail-soft hook invariants)
- Install paths (plugin marketplace + legacy installer)
- Public CLI surface (`agent-identity {assign|stats|recommend-verification|breed}`; `pattern-recorder record`; `route-decide`; `contract-verifier`; `contracts-validate`; `kb-resolver`; `adr`)
- The `tierOf` formula at `agent-identity.js:98-105` (binary cliff at `passRate ≥ 0.8` AND `verdicts ≥ 5`) — preserved byte-for-byte per the H.4.2 audit-transparency commitment
- ADR-0002 substrate-fundament `_lib/*` carve-out (per-phase pre-approval gate required for shared-helper changes)
- ADR-0006 fix-don't-suppress invariant 5 (0 `eslint-disable` directives across substrate; suppression-detection active in CI)
- drift-note 80 vigilance (HT-state.md surgical Python cutover pattern; 0 duplicate top-level YAML keys enforced via PreToolUse `validate-yaml-frontmatter.js` since H.9.11)

**Evolving (under explicit version fields):**

- Trust formula weights (`WEIGHT_PROFILE_VERSION`; today `"h7.0-multi-axis-v1"`; refit triggers when sample size justifies)
- Persona contracts (schema-additive only; never delete fields; `_backfillSchema` handles legacy reads)
- Route-decide thresholds (`weights_version`; today `"v1.1-context-aware-2026-05-07"`; calibration ongoing)
- Validator extensions (HARD-block + SOFT-advisory checks may be added additively; existing checks may not weaken without ADR amendment per ADR-0006)

**Experimental (explicitly not stable):**

- Breeding mechanics (`agent-identity breed`) — manual subcommand today; auto-mode deferred to H.7.5+
- Drift triggers (recalibration thresholds) — theory-driven defaults, refit when ≥3 high-trust identities have ≥30 verdicts
- New trust axes (`recency_decay_factor`, `qualityTrend`) — observable today; not score-affecting until empirical thresholds met

Schema migrations are additive within v2.x (per H.6.6 `_backfillSchema` pattern). Breaking changes to the stable surface require v3. See [CHANGELOG.md](../../CHANGELOG.md) for version history.

## v2.0.0 → v2.x roadmap

**Forward-deferred with codified activation criteria** (NOT v2.0.0 scope; closed via DEFER-with-criteria at H.9.16):

- **drift-note 79** (CONFIG_GUARD_BOOTSTRAP env-var for `config-guard.js` first-creation bypass): activation if a 2nd config-bootstrap scenario emerges (1st was H.9.7 eslint.config.js bootstrap via Bash heredoc one-time workaround at commit `7e0aa1b`) OR if a substrate consumer reports config-guard blocking a legitimate workflow. Defer rationale: no active fault; new bypass-surface security risk; substrate maintenance burden; alternative pattern exists.
- **drift-note 81** (ESLint v10 globals re-validation cohort): activation at ESLint v10 release; substrate phase intending major-version migration spawns ~30 min focused re-validation phase. Defer rationale: ESLint v10 does not exist (current v9.39.4); cannot validate proactively against a non-existent target; future-proofing without trigger creates dead code.

**v2.1+ minor candidates** (not committed; not blocking):

- Marketplace clone-staleness automation (drift-note candidate from H.9.14.1)
- Node.js 20 → 24 GitHub Actions runner upgrade (non-blocking CI annotations; June 2026 GitHub-side deadline)
- Per-hook deep-dive docs for the 7 validators currently lacking dedicated `docs/hooks/<validator>.md` files (only `error-critic.md` ships at v2.0.0)
- Forward documentation (RELEASE.md, CONTRIBUTING-detailed.md) if substrate gains external contributors

**v3 trigger conditions** (would require breaking-change major bump):

- Removal or rename of any "Stable (frozen)" surface above
- Hook contract change (e.g., output shape beyond `decision: approve|block` per ADR-0001)
- `tierOf` formula change (byte-frozen commitment broken)
- Removal of ADR-0001/0002/0006 invariants

At v2.0.0 ship, substrate state was strongest pre-release posture: 99/99 install.sh smoke + 67/67 _h70-test + 17-baseline contracts-validate + 0 OPEN drift-notes (4 CLOSED: 78(a) + 78(b) + 80 + 82; 2 DEFERRED-with-activation-criteria: 79 + 81) + all 20 chaos findings CLOSED at H.9.15 + soak gate counter 8/5+ STRENGTHENED ×3 (overshoots 5+ threshold by 60%).

