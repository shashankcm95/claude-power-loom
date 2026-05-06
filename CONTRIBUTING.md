# Contributing — Git Workflow

Going-forward conventions for the claude-toolkit repo. Adopted post-H.2.7 after the user noted that the H.1 → H.2.7 phase work had landed directly on `main` without branching, tagging, or PR review. **All prior phase commits are now retroactively tagged** (`phase-H.1` through `phase-H.2.7`); the conventions below apply to new work.

## Branch model

- `main` — protected. Direct commits only for trivial doc fixes (typos, README link tweaks). Anything substantive goes through a feature branch.
- Feature branches:
  - **Phase work**: `feat/phase-H.x.y-short-name` (e.g., `feat/phase-H.2.8-budget-extensions`)
  - **Bug fixes**: `fix/short-description` (e.g., `fix/verifier-regex-extension-length`)
  - **Refactors**: `refactor/short-description`
  - **Docs**: `docs/short-description`
- One branch per logical change. Don't bundle unrelated fixes — they should be separate branches + separate PRs for separate reviews.

## Commit conventions

Conventional commits, same as before:

```
feat(phase-H.2.8): on-demand budget extensions

[Body — what changed and why]

[Optional footer — Co-Authored-By, BREAKING CHANGE notes]
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`.

For phase work, scope is `phase-H.x.y` so commits remain auditable across the H.2 trajectory.

## Tagging policy

- **Phase tags**: every phase that ships gets an annotated tag at the merge commit.
  - Format: `phase-H.x.y` (matches commit scope; e.g., `phase-H.2.8`)
  - Annotated (`-a` flag), with one-line description in the message
  - Apply at the moment the phase's branch merges to main
- **Release tags** (future): `v0.1.0`, `v0.2.0`, etc. Adopt semver once we have a stable surface (~Phase H.3+).

## PR workflow

The remote is `github.com/shashankcm95/claude-skills-consolidated`. Use `gh pr create` for every feature branch:

```bash
git checkout -b feat/phase-H.2.8-budget-extensions
# ... do work, commit ...
git push -u origin feat/phase-H.2.8-budget-extensions
gh pr create --title "feat(phase-H.2.8): on-demand budget extensions" --body "$(cat <<'EOF'
## Summary
- New scripts/agent-team/budget-tracker.js
- Extension request/approve flow
- Per-spawn token audit trail

## Test plan
- [ ] E2E probes for budget tracking
- [ ] Verify pattern-recorder integration

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

PR review checklist (self-review when working solo):
- [ ] All E2E probes documented in commit message + actually green when re-run
- [ ] No secrets in code (env vars only)
- [ ] Spec docs updated if schema changed (contract-format.md)
- [ ] BACKLOG.md follow-ups added for known limitations
- [ ] SKILL.md phase-status entry reflects what shipped

## Merge policy

- **Squash-and-merge** for small features (1-3 commits on the branch). Keeps main history linear.
- **Merge with `--no-ff`** for substantial features (4+ commits, multiple distinct changes). Preserves the branch story.
- Never `git rebase` shared branches. Never force-push to `main`.

## Tagging at merge

After PR merge, tag the merge commit:

```bash
git checkout main
git pull
git tag -a phase-H.2.8 -m "Phase H.2.8: on-demand budget extensions"
git push origin phase-H.2.8
```

## Retroactive tagging — the snapshot at H.2.7

After CONTRIBUTING.md adoption, all prior phase commits were tagged in place (annotated tags pointing at the existing main commits):

| Tag | Commit | Phase |
|-----|--------|-------|
| `phase-H.1` | `d2c3554` | HETS pattern foundation |
| `phase-H.2-bridge` | `947c31d` | Patterns library + identity model + verifier fixes |
| `phase-H.2-bridge.2` | `845d370` | Shared KB + content-addressed refs |
| `phase-H.2.1` | `8cc383b` | First builder persona vertical slice |
| `phase-H.2.2` | `15ef4cf` | Builder family complete + marketplace integration |
| `phase-H.2.3` | `97dc736` | Asymmetric challenger spawning |
| `phase-H.2.4` | `c3fdfa0` | Trust-tiered verification depth (LATENCY-CRITICAL) |
| `phase-H.2.5` | `7e80b53` | Tech-stack analyzer + skill-bootstrapping wiring |
| `phase-H.2.6` | `782be51` | invokesRequiredSkills verifier check |
| `phase-H.2.7` | `0a06cec` | Full pattern contracts (third leg of triple defense) |
| `phase-H.2.8` | `5f59375` | On-demand budget extensions (first PR-flow phase) |
| `phase-H.2.9` | `c3e3256` | chaos-test --pattern simulation runner |
| `phase-H.3.0` | `6397b4e` | contracts-validate.js |
| `phase-H.3.1` | `7a9504b` | Quick-wins bundle (5 fixes) |
| `phase-H.3.2` | `e99ca90` | Shared withLock + kb-resolver path traversal |
| `phase-H.3.3` | `47b4533` | install.sh sync + post-phase install convention |
| `phase-H.3.4` | `03c4e5b` | Structural checks opt-in (7 builder contracts) |
| `phase-H.3.5` | `a7b3f19` | Resolve all 29 contracts-validate violations |
| `phase-H.3.6` | `f3e9bda` | CS-2 regression bundle (5 fixes) |
| `phase-H.4.0` | `181eb6c` | kb_scope enforcement (closes top architect-unmoved item) |
| `phase-H.4.1` | `36bfab2` | Auto self-improve loop (multi-trigger + threshold promotion + batched approval) |
| `phase-H.4.2` | `b0a3e6d` | Validator-subdir hooks + trust-formula transparency |
| `phase-H.5.0` | `4ff1aee` | Official Claude Code plugin packaging (anti-slop differentiation in README) |
| `phase-H.5.1` | `1103137` | Pattern status sync (9 → active) + KB exemption documentation (CS-3 Track 1 fixes) |
| `phase-H.5.2` | `24630d6` | CS-3 CRIT bundle (5 fixes: kb_scope provenance, secrets validator hardening, README consistency) |
| `phase-H.5.3` | `cbb577f` | Self-improve-store hardening + frontmatter BOM (6 CS-3 HIGHs) |
| `phase-H.5.4` | `8f6fd28` | Remaining CS-3 HIGH cluster (filePath regex + CLAUDE_PLUGIN_ROOT verification + README clarity) |
| `phase-H.5.5` | `fe290a7` | Architectural cleanup (aggregator location decided + _lib/runState.js extracted) |
| `phase-H.5.6` | `9ef1b5b` | First builder dogfood run (12-security-engineer.mio authors auditor kb_scope; verdict PASS) |
| `phase-H.6.0` | `8dd2b44` | Spawn-recorder for orchestration-test visibility (foundational for H.6.x) |
| `phase-H.6.1` | `712bdad` | First abstract-task orchestration walkthrough (7 gaps surfaced; spawn aborted) |
| `phase-H.6.2` | `08eb0a2` | Stack-skill-map extension (Backend — Node entry; pointers for 14-python-backend) |
| `phase-H.6.4` | `08eb0a2` | New 13-node-backend persona + contract + 2 KB docs (closes H.6.1 routing gap) — same SHA as H.6.2 (shipped together) |
| `phase-H.6.3` | `8cfc4ca` | `agent-identity assign` surfaces `forgeNeeded` field at assign-time (closes last H.6.1 gap) |
| `phase-H.6.5` | `c604d60` | Missing-capability-signal pattern (sub-agents diagnose; root acquires) — autonomous platform extension |
| `phase-H.6.6` | `32f1872` | Lifecycle primitives (soft-retire + specialist-tag + L3-forward schema) — first L1 substrate of evolution loop |
| `phase-H.6.7` | `60f7991` | Canonical-source registry (23 entries: skill-name → official-docs URL) — L2 of evolution loop |
| `phase-H.6.8` | `6ba5406` | First post-H.6.7 orchestration test — 13-node-backend.kira PASS on rate-limiting task (H.6.1 closed) |
| `phase-H.6.9` | `7e771ce` | Full post-H.6.7 orchestration cycle: 5 tasks / 5 PASS / 5 personas / 5 forged skills / 6 builder verdicts toolkit-wide (H.6.x cycle CLOSED) |
| `phase-H.7.0-prep` | `1c5f7e5` | Hybrid quality factors + validation_sources registry — observability layer for H.7.0 evolution loop (5 axes captured per verdict; trust formula unchanged) |
| `phase-H.7.1` | (TBD) | Asymmetric-challenger callsite wired into /build-team Step 7 — first phase via corrected autonomous-platform pattern (architect + 13-node-backend pair-run; convergence axis captured) |

`d166add` (README refresh through H.2.4) and `90b87ac` (chat-scan BACKLOG additions) were doc-only commits — no tags (matches "trivial docs allowed direct on main" rule).

## What this changes vs prior practice

| Before (H.1 → H.2.7) | After (H.2.8 onwards) |
|----------------------|----------------------|
| All commits direct to `main` | Feature branches per phase / fix |
| No tags | `phase-H.x.y` tag at every merge |
| Self-merged via single push | PR via `gh pr create` (self-review checklist) |
| No clear release boundary | Each tag is a navigable boundary; `git checkout phase-H.2.4` reproduces that state |

## When to skip the workflow

- **Hotfix on main**: a single-line typo fix in a doc — direct commit + push is fine.
- **Experimental scratch**: spike branches that won't merge — no PR needed, but DO NOT name them `feat/` (use `spike/` or `wip/`).
- **Work-in-progress sync**: pushing to your own feature branch mid-work to back up. No PR until ready for review.

## Post-phase install convention (H.3.3)

The toolkit ships in two locations:

1. The toolkit repo at `~/Documents/claude-toolkit/` (canonical source — what you edit + commit + PR)
2. The installed view at `~/.claude/` (what Claude Code actually loads — slash commands, skills, agents, hooks)

When a phase ships content that affects the user-invocable surface (commands, skills, agents, rule docs, hooks), **the installer must be re-run** to sync the new content into `~/.claude/`. Until that happens, the new commands/skills exist in the repo but are NOT discoverable by Claude Code.

CS-1 confused-user.sam caught this gap concretely: after H.2.5 shipped `commands/build-team.md` + `skills/tech-stack-analyzer/SKILL.md`, **neither was installed** — the user-facing story was undelivered for any installer who hadn't re-run install.sh since H.2.4. H.3.3 fixed this and adopts the convention below.

### Post-phase install convention

Run after every PR merge that touches `commands/`, `skills/`, `agents/`, `rules/`, or `hooks/scripts/`:

```bash
cd ~/Documents/claude-toolkit
./install.sh --diff --commands --skills --agents --rules --hooks  # preview
./install.sh --commands --skills --agents --rules --hooks         # install
```

Restart Claude Code to pick up the changes (or wait for the next session — each session re-loads the available-skills set).

### What's safe to skip

Phases that touch ONLY `scripts/agent-team/`, `swarm/`, or `skills/agent-team/{patterns,kb}/` don't need the installer — those paths aren't synced into `~/.claude/`. The HETS scripts (per the manual-sync convention earlier in this CONTRIBUTING doc) are copied into `~/.claude/scripts/agent-team/` separately, by the per-script `cp` step that each phase commit explicitly runs.

### Periodic reconciliation

Even when no phase ships user-facing content, run `./install.sh --diff --all` quarterly. If anything's drifted, re-install. (A future phase could add this as a CI check or a `chaos-test` pre-flight per CS-1's H.2.x discipline-check section.)

## Related

- [README.md](README.md) — top-level project structure
- [skills/agent-team/SKILL.md](skills/agent-team/SKILL.md) — phase status + roadmap
- [skills/agent-team/BACKLOG.md](skills/agent-team/BACKLOG.md) — deferred work
