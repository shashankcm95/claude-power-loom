# Build/CI/plugin substrate — `install.sh`, eslint, manifests, `hooks.json`, CI

> This cluster is the **substrate's packaging, install, and gate layer** — the connective tissue that turns the kernel/runtime/lab/skills source trees into a deployable Claude Code plugin and keeps the four "release surfaces" honest. None of these files are themselves the enforced kernel; rather they *wire up* the kernel (`packages/kernel/hooks.json` registers the enforced hook chain), *define the install path* (`install.sh` is the legacy fallback to the canonical `/plugin install` route), and *gate merges* (`.github/workflows/ci.yml` runs the smoke + property + lint + contracts checks). The config files (`eslint.config.js`, `.markdownlint.json`, `config-guard-patterns.json`, `.coderabbit.yaml`) encode the lint/review discipline; the manifests (`plugin.json`, `marketplace.json`) declare the plugin to Claude Code; `entities.json` is a trivial metadata stub. Treatment-wise this is mostly **best-effort / CI-time** (lint, install, release), with one genuinely **enforced** artifact: `hooks.json`, the manifest the harness loads to install the PreToolUse / PostToolUse / lifecycle hook chain.

## Directory contents & nesting

| File | Folder | Purpose (one line) |
|---|---|---|
| `install.sh` | repo root | Legacy/CI installer; copies components into `~/.claude/`; runs hook smoke tests. |
| `eslint.config.js` | repo root | ESLint v9 flat-config; hand-rolled `eslint:recommended` (zero-dependency); `_`-prefix ignore calibration. |
| `package.json` | repo root | pnpm workspace root; `test`/`test:unit`/`test:smoke` scripts; `node>=18` engine. |
| `pnpm-workspace.yaml` | repo root | Declares `packages/*` as the workspace member glob. |
| `.claude-plugin/plugin.json` | `.claude-plugin/` | Plugin manifest: name/version + `skills`/`commands`/`hooks` path fields. |
| `.claude-plugin/marketplace.json` | `.claude-plugin/` | Marketplace listing wrapping the single `power-loom` plugin at `source: "./"`. |
| `packages/kernel/hooks.json` | `packages/kernel/` | **The enforced hook chain** — SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/PreCompact/Stop registrations via `${CLAUDE_PLUGIN_ROOT}`. |
| `packages/kernel/settings-reference.json` | `packages/kernel/` | Reference `~/.claude/settings.json` snippet for the **legacy** install path (uses `HOME_DIR` placeholder). |
| `packages/kernel/config-guard-patterns.json` | `packages/kernel/` | Filename regex patterns that `config-guard.js` + `validate-config-redirect.js` block from edit. |
| `.github/workflows/ci.yml` | `.github/workflows/` | The PR/push gate: smoke + contracts + roster + signpost + doc-paths + JSON + per-layer unit tests + dormancy + advisory layer-boundary. |
| `.github/workflows/auto-release-on-tag.yml` | `.github/workflows/` | On `v*` tag push: create a GitHub Release from the tag annotation. |
| `.github/workflows/phase-tag-version-check.yml` | `.github/workflows/` | On `phase-H.*` tag push: assert `plugin.json` version was bumped vs `HEAD~1`. |
| `.markdownlint.json` | repo root | Markdownlint config; lenient (many stylistic rules disabled) but `MD037`/`MD004`/`MD056` stay on via `default:true`. |
| `.coderabbit.yaml` | repo root | CodeRabbit `path_instructions` encoding the plans-are-living / ADRs-RFCs-immutable lifecycle policy. |
| `entities.json` | repo root | Trivial metadata stub: `people` + `projects` arrays. |

No `_lib/`/`_spike/` subfolders exist *within this cluster's scope* — the scope is root-level config plus two `packages/kernel/*.json` data files and three workflow YAMLs. `install.sh` *references* nested trees it copies (`packages/kernel/{hooks,validators,_lib,recall,spawn-state,algorithms,schema}`, `packages/runtime/{orchestration,contracts,personas,schema}`) and the `tests/smoke-*.sh` sourced files, but those live outside this section.

## Per-file analysis

### `install.sh`

- **Purpose** — Legacy/fallback installer (canonical path is `/plugin install power-loom@power-loom-marketplace`). Copies agents/rules/hooks/commands/skills into `~/.claude/`, mirrors the `packages/kernel` + `packages/runtime` trees to `~/.claude/packages/`, installs back-compat entrypoints + `_lib` helpers, and optionally runs the bash hook smoke suite. Retained for shell-only setups and CI smoke testing.
- **Imports / consumes** — `BASH_SOURCE`, `$HOME`; reads `$SCRIPT_DIR/{agents,packages/skills/{rules,commands,library},packages/kernel,packages/runtime,scripts}/...`; sources `$SCRIPT_DIR/tests/smoke-*.sh` (12 files). Env: `set -euo pipefail`.
- **Consumers** — `.github/workflows/ci.yml` (`bash install.sh --hooks --test`); `README.md` / `docs/install/legacy-installer.md`; human operators. Not imported by JS.
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes (files/refs/stdout) | state changes / side effects |
|---|---|---|---|---|---|
| `usage` | internal | Print help + exit | none | stdout help text | `exit 0` |
| `backup_existing` | internal | Snapshot existing install before overwrite | reads `$CLAUDE_DIR/{agents,rules,hooks,commands,skills}` | `$CLAUDE_DIR/backups/backup-<ts>/` | `mkdir`, `cp -r` (filesystem write) |
| `diff_component` | internal | Dry-run diff of one src vs dest file | `$1` src, `$2` dest, `$3` label; `diff -u` | stdout (MODIFIED/NEW + truncated diff) | none (read-only) |
| `install_agents` | internal | Copy `agents/*.md` → `$CLAUDE_DIR/agents/` | `$SCRIPT_DIR/agents/*.md`; `$DRY_RUN` | `$CLAUDE_DIR/agents/`; stdout count | `mkdir`, `cp` |
| `install_rules` | internal | Copy `packages/skills/rules/*` → `$CLAUDE_DIR/rules/toolkit/` | `$SCRIPT_DIR/packages/skills/rules`; `$DRY_RUN` | `$CLAUDE_DIR/rules/toolkit/` | `mkdir`, `cp -r` |
| `install_hooks` | internal | Mirror kernel + runtime substrate to `~/.claude/packages/` + back-compat shims | `$SCRIPT_DIR/packages/{kernel,runtime}/...`, `scripts/`; `$DRY_RUN` | `$CLAUDE_DIR/packages/{kernel,runtime}/`, `$CLAUDE_DIR/scripts/`, `$CLAUDE_DIR/_lib/`; stdout | `mkdir`, `cp`/`cp -r`, `chmod +x`, `shopt nullglob` toggles |
| `install_commands` | internal | Copy `packages/skills/commands/*.md` → `$CLAUDE_DIR/commands/` | `$SCRIPT_DIR/packages/skills/commands`; `$DRY_RUN` | `$CLAUDE_DIR/commands/`; stdout count | `mkdir`, `cp` |
| `install_skills` | internal | Copy `packages/skills/library/*` → `$CLAUDE_DIR/skills/` | `$SCRIPT_DIR/packages/skills/library`; `$DRY_RUN` | `$CLAUDE_DIR/skills/` | `mkdir`, `cp -r` |
| `run_smoke_tests` | internal | Source the 12 `tests/smoke-*.sh` files; tally `passed`/`failed`; honest exit code | `$SCRIPT_DIR/tests/smoke-*.sh`; `local passed/failed` | stdout `Results: N passed, M failed` | mutates `passed`/`failed`; `return 1` if any failed |
| (top-level script body) | cli | Arg-parse (`--all`/`--agents`/.../`--diff`/`--backup`/`--test`); dispatch installers | `$@`; the booleans | stdout banner / Done | sets `INSTALL_*`/`DRY_RUN`/`BACKUP`/`RUN_TESTS`; calls installers |

- **File-level notes** — `run_smoke_tests` relies on **bash dynamic scope**: `local passed=0`/`local failed=0` are declared in the function, and the sourced `smoke-*.sh` files mutate them in-place (the smoke files document this contract). The lines 385-395 comment documents a *fixed* inverted-exit-code bug (the old trailing `[ "$failed" -gt 0 ] && echo` returned 1 under `set -e` on the all-pass path). The `--test`-without-`--hooks` case (line 454-458) only *warns*, then still runs `run_smoke_tests` against possibly-absent installed hooks — a documented H.7.8/H.7.9 CI trap. Sections 7b/7c are explicitly transitional back-compat scaffolding flagged for eventual removal. File is **468 lines** — under the 800 max; `install_hooks` is the one outsized function (~190 lines, well over the 50-line guideline — see findings).

### `eslint.config.js`

- **Purpose** — ESLint v9 flat-config. Hand-rolls the `eslint:recommended` rule set (60 rules captured from `@eslint/js@9.39.4`) inline to preserve the substrate's zero-runtime-dependency property. Declares Node CommonJS + modern-runtime globals and the `_`-prefix ignore calibration on `no-unused-vars`.
- **Imports / consumes** — none (`"use strict"`, `module.exports`). No requires.
- **Consumers** — the `npx --yes eslint` smoke harness (Test 84, run via `install.sh --hooks --test` smoke files) and any local `eslint`. Auto-discovered by ESLint at repo root.
- **Functions** — none (pure config array export).
- **File-level notes** — Two config objects: rules block + an `ignores` block (`node_modules`, `.git`, `swarm/run-state`). Self-protected: `config-guard.js` blocks edits to `eslint.config*` (the file documents its own heredoc-bootstrap exception, drift-note 79). The "60 rules total" comment is a *manual* snapshot — ADR-0006 invariant 4 requires re-syncing on a v10 bump; the count is not machine-verified, so drift between the comment's claim and the actual `@eslint/js` recommended set is possible but only on a major bump (low risk, documented process).

### `package.json`

- **Purpose** — pnpm workspace root manifest. `private:true`, version `0.0.0` (the *plugin* version lives in `plugin.json`, not here). Scripts: `test` = `pnpm -r test && bash tests/smoke-ht.sh`; `test:unit` = `pnpm -r test`; `test:smoke` = `bash tests/smoke-ht.sh`. `engines.node >=18`.
- **Imports / consumes** — none (declarative). pnpm reads `pnpm-workspace.yaml`.
- **Consumers** — pnpm; CI does **not** call `pnpm -r test` for real coverage (see note); humans running `pnpm test`.
- **Functions** — none.
- **File-level notes** — **`pnpm -r test` is effectively a no-op for coverage**: every per-package `test` script is an `echo '...deferred...' && exit 0` stub (verified across `packages/{kernel,runtime,lab,skills,specs}/package.json`). Real unit-test execution happens only in the dedicated CI jobs (`kernel-property-tests`, `runtime-contracts-tests`, `lab-tests`, `aux-unit-tests`) that loop `node <file>` directly. So `pnpm test` at the root runs only `tests/smoke-ht.sh` for substance — a person trusting `pnpm test` as "the test suite" gets a false sense of coverage (smell, documented in the CI comments but not in `package.json` itself).

### `pnpm-workspace.yaml`

- **Purpose** — One line: `packages: - 'packages/*'`. Declares the five workspace members.
- **Imports / consumes** — none.
- **Consumers** — pnpm. Also **config-guard-protected** (`pnpm-workspace\.ya?ml$` is in `config-guard-patterns.json`), so Edit/Write to it is blocked by the kernel hook.
- **Functions** — none.
- **File-level notes** — Trivial; no findings.

### `.claude-plugin/plugin.json`

- **Purpose** — The Claude Code plugin manifest. `name: power-loom`, `version: 3.11.0`, path fields `skills`/`commands`/`hooks` (advisory per the `_phase0Comment`), plus author/homepage/repository/license/keywords. No `agents` field (relies on auto-discovery — correct per the H.7.22.3 lesson in MEMORY).
- **Imports / consumes** — declarative; `$schema` pins `json.schemastore.org/claude-code-plugin-manifest.json`.
- **Consumers** — Claude Code plugin loader; `scripts/validate-release-surface.js` (HARD surface `plugin.json:version`); `phase-tag-version-check.yml` (`jq -r '.version'`); `scripts/library-migrate.js`, `packages/kernel/_lib/toolkit-root.js` (root resolution); `json-validate` CI job.
- **Functions** — none.
- **File-level notes** — The `version` is the **canonical** release version (the four-surface gate keys off it). `homepage`/`repository` point at `github.com/shashankcm95/claude-power-loom` while the author URL is `github.com/shashankcm95` — these are inert metadata. The `_phase0Comment` warns the path fields are advisory and that discovery may fall back to top-level symlinks; that contingency is untested in this scope.

### `.claude-plugin/marketplace.json`

- **Purpose** — Marketplace listing. Single plugin entry `power-loom` at `source: "./"` (relative to marketplace root — the established correct form per MEMORY's H.7.22 lesson). Carries its own description/category/tags.
- **Imports / consumes** — declarative.
- **Consumers** — `/plugin install power-loom@power-loom-marketplace`; bench probes (`plugin-upgrade-over-probe.sh`); `json-validate` CI job. **Not** a release surface — `validate-release-surface.js` explicitly notes marketplace.json has no version field.
- **Functions** — none.
- **File-level notes** — Description/tags here drift independently from `plugin.json`'s description (two hand-maintained copies of similar prose) — a minor DRY smell, not load-bearing.

### `packages/kernel/hooks.json`

- **Purpose** — **The enforced hook manifest.** Declares the full hook chain the harness installs when the plugin is enabled, all paths resolved via `${CLAUDE_PLUGIN_ROOT}`. This is the *only* truly-enforced artifact in this cluster.
- **Imports / consumes** — `${CLAUDE_PLUGIN_ROOT}` env placeholder (harness-substituted). Each entry names a `node ...js` command + timeout.
- **Consumers** — Claude Code harness (loads it via `plugin.json`'s `hooks` field). Tested by `tests/unit/runtime/contracts/plugin-hook-deployment.test.js` and referenced by several lab/kernel tests that assert the registered chain.
- **Functions / hook entries** (the manifest *registers* these; each target is a hook-entry script outside this scope):

| event | matcher | target script | timeout | role |
|---|---|---|---|---|
| SessionStart | `*` | `lifecycle/session-reset.js` | 3 | reset fact-force tracker |
| SessionStart | `*` | `lifecycle/catalog-reconcile-session.js` | 6 | catalog reconcile |
| UserPromptSubmit | `*` | `lifecycle/prompt-enrich-trigger.js` | 3 | vague-prompt forcing instruction |
| PreToolUse | `EnterPlanMode` | `pre/redirect-plan-mode-in-headless.js` | 3 | deny EnterPlanMode in headless |
| PreToolUse | `ExitPlanMode` | `pre/verify-plan-gate.js` | 5 | block exit if HETS plan lacks verification |
| PreToolUse | `Agent\|Task` | `pre/route-decide-on-agent-spawn.js` | 6 | route-decide log (always approves) |
| PreToolUse | `Agent\|Task` | `pre/contract-reminder-on-agent-spawn.js` | 5 | contract reminder |
| PreToolUse | `Read\|Edit\|Write` | `pre/fact-force-gate.js` | 5 | must-Read-before-Edit gate |
| PreToolUse | `Edit\|Write` | `pre/config-guard.js` | 5 | block config-file edits |
| PreToolUse | `Edit\|Write` | `validators/validate-yaml-frontmatter.js` | 5 | dup-key YAML check |
| PreToolUse | `Edit\|Write` | `validators/validate-no-bare-secrets.js` | 5 | block secret-shaped literals |
| PreToolUse | `Edit\|Write` | `validators/validate-frontmatter-on-skills.js` | 5 | skill frontmatter gate |
| PreToolUse | `Edit\|Write` | `validators/validate-adr-drift.js` | 5 | ADR drift advisory |
| PreToolUse | `Edit\|Write` | `validators/validate-kb-doc.js` | 5 | KB doc validation |
| PreToolUse | `Bash` | `validators/validate-config-redirect.js` | 5 | block redirect to protected config |
| PostToolUse | `Bash` | `post/error-critic.js` | 5 | error critique |
| PostToolUse | `Bash` | `observability/network-egress-audit.js` | 5 | advisory egress audit |
| PostToolUse | `Agent\|Task` | `post/kb-citation-gate.js` | 5 | citation gate |
| PostToolUse | `Agent\|Task` | `spawn-state/spawn-record.js` | 5 | capture L_spawn record |
| PostToolUse | `Agent\|Task` | `post/spawn-close-resolver.js` | 10 | observe-only resolver (shadow) |
| PostToolUse | `Edit\|Write` | `validators/validate-plan-schema.js` | 5 | plan-schema gate |
| PostToolUse | `Edit\|Write` | `post/catalog-reconcile-write.js` | 5 | catalog reconcile on write |
| PreCompact | `*` | `lifecycle/pre-compact-save.js` | 10 | checkpoint + snapshot nudge |
| Stop | `*` | `lifecycle/console-log-check.js` | 5 | console.log warning |
| Stop | `*` | `lifecycle/auto-store-enrichment.js` | 10 | capture enriched-prompt blocks |
| Stop | `*` | `lifecycle/session-end-nudge.js` | 3 | nudge /self-improve |
| Stop | `*` | `lifecycle/context-size-warn-stop.js` | 5 | context-size warning (last in chain) |

- **File-level notes** — A long `_comment` tombstone (lines ~61) preserves the ADR-0012 lesson that `pre-spawn-tool-mask` was inert; the matcher slot is reused for `route-decide-on-agent-spawn.js`. **Divergence from `settings-reference.json`** (see next): `hooks.json` registers far MORE hooks (catalog-reconcile, contract-reminder, the 5 validators, network-egress-audit, spawn-record, spawn-close-resolver, validate-plan-schema, catalog-reconcile-write, context-size-warn-stop) than the legacy reference file lists. A legacy installer following `settings-reference.json` gets a **materially weaker** hook chain. The `EnterPlanMode` deny hook (`redirect-plan-mode-in-headless.js`) and `validate-config-redirect.js` / `validate-yaml-frontmatter.js` / `validate-kb-doc.js` / `catalog-reconcile-session.js` are present here but absent from the reference — see findings.

### `packages/kernel/settings-reference.json`

- **Purpose** — A reference `~/.claude/settings.json` `hooks` block for the **legacy / shell-only** install path. Uses literal `HOME_DIR` placeholder (the comment instructs the user to replace it).
- **Imports / consumes** — declarative. `install.sh` `install_hooks` copies it verbatim to `$CLAUDE_DIR/packages/kernel/settings-reference.json` but does **not** merge it into `settings.json` (it prints "Hook configuration must be manually merged").
- **Consumers** — humans on the legacy path; docs (`docs/install/legacy-installer.md`, `docs/reference/project-structure.md`); install.sh copies it.
- **Functions** — none.
- **File-level notes** — **Stale relative to `hooks.json`** (the canonical manifest). It lists 11 hook entries vs the 27 in `hooks.json`, omitting the entire PostToolUse chain (error-critic, kb-citation-gate, spawn-record, spawn-close-resolver, validate-plan-schema, catalog-reconcile-write, network-egress-audit), the EnterPlanMode redirect, the contract-reminder spawn hook, three `Edit|Write` validators (yaml-frontmatter, kb-doc, config-redirect), and `context-size-warn-stop`. It also still references `session-self-improve-prompt.js` under UserPromptSubmit — a hook NOT present in `hooks.json`. A legacy-path user gets a different, weaker, partially-broken set. Two hand-maintained hook manifests that have drifted = DRY/consistency smell with real correctness impact (finding).

### `packages/kernel/config-guard-patterns.json`

- **Purpose** — The data file of filename regex patterns that `config-guard.js` (PreToolUse:Edit|Write) and `validate-config-redirect.js` (PreToolUse:Bash) block. Comment documents the contract: each pattern is auto-anchored with `(?:^|/)` and matched case-insensitively.
- **Imports / consumes** — declarative JSON `{ "_comment", "patterns": [...] }`.
- **Consumers** — `packages/kernel/hooks/pre/config-guard.js` (lines 32-33: tries `../config-guard-patterns.json` then `./config-guard-patterns.json`); `packages/kernel/validators/validate-config-redirect.js` (lines 54-55, same dual-path). `install.sh` copies it to `$CLAUDE_DIR/packages/kernel/`.
- **Functions** — none.
- **File-level notes** — Verified: `config-guard.js:46` builds `new RegExp('(?:^|\\/)(?:' + p + ')', 'i')` — the anchoring + case-insensitivity in the comment is **true in code**. The list covers eslint/prettier/biome/tsconfig/editorconfig/babel/swc/vite/vitest/jest/webpack/rollup/esbuild/parcel/turbo/nx/npmrc/yarnrc/`pnpm-workspace`/nvmrc/commitlint/lint-staged/husky/pre-commit/markdownlint/cspell/playwright/cypress/karma/ava/mocha/storybook/tailwind/postcss. Note: `package.json` and `package-lock.json` are **not** protected (intentional — they're project files, not lint config), and notably **`.coderabbit.yaml`, `.github/workflows/*`, and `hooks.json`/`plugin.json` are not protected** — so the kernel does not guard its own hook manifest or CI from edits (by design, but worth flagging as a trust boundary).

### `.github/workflows/ci.yml`

- **Purpose** — The merge gate on push/PR to `main`. Eight jobs: `smoke` (install.sh smoke + contracts + roster + signpost + doc-paths), `markdown-lint`, `json-validate`, `kernel-property-tests`, `runtime-contracts-tests`, `lab-tests`, `aux-unit-tests`, `dormancy-assertion-k3b`, `dormancy-assertion-k1`, `layer-boundary-advisory`.
- **Imports / consumes** — `actions/checkout@v4`, `actions/setup-node@v4` (node 20); apt `shellcheck`; `npx markdownlint-cli2`; `python3 -m json.tool`; `node` per-file loops over `tests/unit/{kernel,runtime,lab}` + catch-all; `grep` for dormancy. Env: `LOOM_CI_DENY_COMBINED_BYPASS: "1"`.
- **Consumers** — GitHub Actions; the merge gate. Not imported.
- **Functions / jobs**

| job | kind | purpose | consumes | writes/asserts | state / exit |
|---|---|---|---|---|---|
| `smoke` | ci-job | install hooks + run smoke; contracts; roster; signpost; doc-paths | `install.sh`, `contracts-validate.js`, `generate-persona-agents.js --check`, `generate-signpost.js --check`, `validate-doc-paths.js` | `/tmp/smoke.log`, `/tmp/contracts.log`; anchored grep gates | non-zero on any sub-step fail |
| `markdown-lint` | ci-job | lint `**/*.md` minus excludes | `npx markdownlint-cli2`, `.markdownlint.json` | stdout | non-zero on lint fail |
| `json-validate` | ci-job | validate every `*.json` (minus node_modules/.git/run-state) | `python3 -m json.tool` over `find` | `INVALID: <f>` lines | `exit $fail` |
| `kernel-property-tests` | ci-job | run each `tests/unit/kernel/**/*.test.js` | `node "$f"`; `find -print0` | `Ran N; failures: M`; vacuous-pass guard | `exit $failed`; `exit 2` if count==0 |
| `runtime-contracts-tests` | ci-job | run each `tests/unit/runtime/**/*.test.js` | same pattern | same | same |
| `lab-tests` | ci-job | run each `tests/unit/lab/**/*.test.js` | same pattern | same | same |
| `aux-unit-tests` | ci-job | run `tests/unit/**/*.test.js` outside kernel/runtime/lab | `find` with `-not -path` excludes | same | same |
| `dormancy-assertion-k3b` | ci-job | assert zero prod importers of `context-envelope` | `grep -rE` over `packages/` minus `/tests/` + the module itself | `::error::` on hit | `exit 1` on hit |
| `dormancy-assertion-k1` | ci-job | assert zero prod importers of `worktree-allocator` | same pattern | same | `exit 1` on hit |
| `layer-boundary-advisory` | ci-job | advisory cross-layer import lint | `layer-boundary-lint.js` | stdout | `continue-on-error: true` (non-blocking) |

- **File-level notes** — Strong, defensively-authored CI. The per-layer test jobs encode hard-won lessons: the `count -eq 0` vacuous-pass guard (jade/nova round-1/2), `-print0` + `read -d ''` whitespace-safety, anchored `^...$` grep on the result line (GH #228), and explicit `working-directory`. The `smoke` job *relies on* `install.sh`'s non-zero exit as the primary gate and adds the anchored grep as defense-in-depth. The two dormancy regexes correctly exclude the real module paths (`packages/kernel/_lib/context-envelope.js`, `packages/kernel/worktree/worktree-allocator.js` — both verified present). `aux-unit-tests` is the catch-all that auto-gates any new `tests/unit/<dir>`. **One gap**: `eslint` (Test 84), `yaml` (Test 83), `shellcheck` (Test 81), `jsonlint` (Test 80), `markdownlint` (Test 80/MD-via-smoke) are run inside the *bash smoke suite* via `install.sh --hooks --test`, not as standalone CI jobs — so a smoke-harness refactor that drops one of those tests would silently remove a lint gate without an obviously-named missing CI check (smell). `markdown-lint` excludes `packages/specs` and `swarm`, so spec-doc markdown rot is not gated.

### `.github/workflows/auto-release-on-tag.yml`

- **Purpose** — On `refs/tags/v*` push, create a GitHub Release using the annotated-tag message as release notes (falls back to the commit message for lightweight tags). Phase tags (`phase-H.*`) deliberately excluded.
- **Imports / consumes** — `actions/checkout@v4` (`fetch-depth:0`); `git fetch --tags --force --prune`; `git for-each-ref --format='%(contents)'`; `gh release create`. `secrets.GITHUB_TOKEN`. `permissions: contents: write`.
- **Consumers** — GitHub Actions on tag push.
- **Functions / steps**

| step | kind | purpose | consumes | writes | side effects |
|---|---|---|---|---|---|
| Fetch annotated tags | ci-step | ensure tag objects local | `git fetch` | — | network fetch |
| Extract tag info | ci-step | read `TAG_NAME` + annotation; warn on empty | `GITHUB_REF`, `git for-each-ref`, `git log` | `$GITHUB_OUTPUT` (tag_name, annotation_file=mktemp) | writes temp file |
| Determine release title | ci-step | first non-blank annotation line → title | annotation file, `grep -m1` | `$GITHUB_OUTPUT` (title) | — |
| Create GitHub Release | ci-step | `gh release create` (skip if exists) | `steps.*.outputs.*`, `GH_TOKEN` | a GitHub Release object | **creates a public Release**; idempotent skip on existing |

- **File-level notes** — **Script-injection surface** (finding): in the "Create GitHub Release" step, `TITLE="${{ steps.title.outputs.title }}"` and `TAG="${{ steps.tag.outputs.tag_name }}"` are GitHub Actions *expression interpolations* spliced directly into the `run:` shell before execution. `title` is derived from the first line of a git tag **annotation** — freeform, attacker-influencable by anyone who can push a tag. A crafted annotation first line such as `"; <command>; "` breaks out of the double-quoted assignment and executes arbitrary shell in a job that holds `contents: write` + `GITHUB_TOKEN`. The mitigation is to pass these through `env:` and reference `"$TITLE"` rather than interpolating `${{ }}` into the script body. The `tag_name` is comparatively constrained by git ref naming but still flows the same unsafe way. (Severity tempered by: only users with push access to tags can exploit it on a private/solo repo — but the pattern is the canonical GHA injection anti-pattern and should be fixed.)

### `.github/workflows/phase-tag-version-check.yml`

- **Purpose** — On `refs/tags/phase-H.*` push, assert `.claude-plugin/plugin.json`'s `version` differs from `HEAD~1` (i.e. the phase tag corresponds to a manifest bump). Preventative alarm (drift-note 37).
- **Imports / consumes** — `actions/checkout@v4` (`fetch-depth:2`); `jq` (apt-installs if missing); `git show HEAD~1:...`.
- **Consumers** — GitHub Actions on phase-tag push.
- **Functions / steps**

| step | kind | purpose | consumes | writes | side effects |
|---|---|---|---|---|---|
| Compare version | ci-step | fail if `HEAD` version == `HEAD~1` version | `plugin.json` at HEAD + `HEAD~1`, `jq` | `::error::` lines | `exit 1` on no-bump; installs jq |

- **File-level notes** — Correct logic. Uses an emoji checkmark (`✓`) in an `echo` (line 63) — that's *inside a YAML string in a workflow*, not a `.js` source edit, so the repo's ASCII-only-in-source-edits rule does not bite it, but it is non-ASCII in a tracked file (cosmetic). The `PARENT_VERSION` fallback to `(unknown)` on a missing parent means a tag on a root commit would compare `<real>` vs `(unknown)` and *pass* (treats can't-read-parent as "bumped") — a minor fail-open in an edge case (orphan/initial commit), acceptable for the preventative intent.

### `.markdownlint.json`

- **Purpose** — Markdownlint config. `default:true` (all rules on) then disables 23 stylistic rules (MD001/009/012/013/022/024/025/026/028/029/031/032/033/034/036/040/041/046/049/050/058/060). Critically **keeps** `MD037` (no-space-in-emphasis), `MD004` (ul-style consistent), `MD038`, `MD056` (table-pipe) on — these are the rules the global rules-doc disciplines target.
- **Imports / consumes** — `$schema` pins the markdownlint config schema.
- **Consumers** — `markdown-lint` CI job (`npx markdownlint-cli2`); local smoke (Test 80); auto-discovered at repo root. Also config-guard-protected (`\.markdownlint` pattern).
- **Functions** — none.
- **File-level notes** — Consistent with the `MD037`/`MD004` discipline codified in the global rules. No findings; the disabled set is deliberate and documented.

### `.coderabbit.yaml`

- **Purpose** — CodeRabbit config. Sole purpose: `reviews.path_instructions` telling the bot that `packages/specs/plans/**` are LIVING (don't flag in-place edits as immutability violations) while `packages/specs/adrs/**` and `packages/specs/rfcs/**` ARE immutable/canonical. Encodes the recurring-false-positive fix (PRs #269/#270/#293).
- **Imports / consumes** — `$schema` pin (coderabbit v2). Declarative.
- **Consumers** — CodeRabbit's PR-review bot. Not config-guard-protected (`.coderabbit` is not in the patterns list).
- **Functions** — none.
- **File-level notes** — Mirrors the CLAUDE.md plans-are-living policy. Accurate to the documented lifecycle. No findings.

### `entities.json`

- **Purpose** — Trivial metadata stub: `{ "people": ["Shashank..."], "projects": ["claude-toolkit"] }`.
- **Imports / consumes** — none.
- **Consumers** — No production code requires it; only spec/research/bench markdown reference the string "entities.json" (no live importer found via grep). Validated by the `json-validate` CI job.
- **Functions** — none.
- **File-level notes** — Missing trailing newline (line 8 ends without one) — purely cosmetic. Appears to be dead/orphaned data — no JS reads it; candidate for removal or documentation of intent (smell). Not load-bearing.

## Findings (bugs / logical fallacies / optimizations)

| severity | level | type | location (file:line) | description |
|---|---|---|---|---|
| HIGH | file | security | `.github/workflows/auto-release-on-tag.yml:104` (also `:102`, `:85-86`) | **GitHub Actions script injection.** `TITLE="${{ steps.title.outputs.title }}"` (and `TAG="${{ steps.tag.outputs.tag_name }}"`) interpolate an expression — ultimately derived from a freeform git **tag annotation** first line — directly into the `run:` shell. A pushed tag whose annotation begins with `"; <cmd>; "` escapes the quoted assignment and runs arbitrary shell in a job holding `contents: write` + `GITHUB_TOKEN`. Fix: pass values via `env:` and reference `"$TITLE"` instead of `${{ }}` in the script body. Canonical GHA injection anti-pattern. |
| MEDIUM | file | smell | `packages/kernel/settings-reference.json:1-183` vs `packages/kernel/hooks.json:1-295` | **Two hand-maintained hook manifests have drifted.** `settings-reference.json` (the legacy-path template install.sh copies) lists ~11 hooks; `hooks.json` (canonical) registers ~27. The reference omits the entire PostToolUse chain (spawn-record, spawn-close-resolver, validate-plan-schema, kb-citation-gate, error-critic, network-egress-audit, catalog-reconcile-write), the EnterPlanMode-headless deny, the contract-reminder spawn hook, and 3 Edit/Write validators (yaml-frontmatter, kb-doc, config-redirect). A legacy-install user therefore gets a materially weaker, partially-different enforcement set. |
| MEDIUM | file | bug | `packages/kernel/settings-reference.json:32-42` | References `lifecycle/session-self-improve-prompt.js` under UserPromptSubmit — a hook NOT registered in the canonical `hooks.json`. A legacy user merging this reference wires a hook that the plugin path does not run (and that may not exist at the resolved path), producing a spurious/broken hook on the legacy path. |
| MEDIUM | function | smell | `install.sh:111-304` (`install_hooks`) | Function is ~190 lines — far over the 50-line guideline and the single hardest-to-audit unit in the cluster. It mixes 8 distinct copy phases (kernel hooks, validators, _lib, recall/spawn-state/algorithms/schema, kernel JSON, runtime, root scripts, back-compat shims). Candidate to decompose into `install_kernel`, `install_runtime`, `install_backcompat` helpers (KISS/SRP). |
| MEDIUM | substrate | smell | `package.json:7-9` + `packages/*/package.json` | **`pnpm -r test` is a coverage no-op.** Every per-package `test` script is `echo '...deferred...' && exit 0`. Root `pnpm test` therefore runs only `tests/smoke-ht.sh` for substance; real unit coverage lives only in the dedicated CI `node`-loop jobs. A developer trusting `pnpm test` locally as "the suite" gets near-zero coverage with a green exit. Document this in `package.json`/README or wire the per-package scripts to the real test dirs. |
| LOW | file | smell | `.github/workflows/ci.yml:37-53` | The eslint/yaml/shellcheck/jsonlint lint gates run *inside* the bash smoke suite (`install.sh --hooks --test`), not as named standalone CI jobs. A future smoke-harness refactor that drops one of those test bodies would silently remove a lint gate without a visibly-missing required check. Consider promoting eslint to its own job. |
| LOW | file | logical-fallacy | `.github/workflows/phase-tag-version-check.yml:48-53` | `PARENT_VERSION` falls back to `(unknown)` when `git show HEAD~1:...` fails (orphan/initial commit). The equality check then compares `<real>` vs `(unknown)`, which is unequal, so the gate **passes** — a fail-open on the can't-read-parent edge case. Acceptable for the preventative intent but worth an explicit "missing parent → fail or skip" branch. |
| LOW | file | bug | `.github/workflows/auto-release-on-tag.yml:51,73` | `echo "tag_name=$TAG_NAME" >> "$GITHUB_OUTPUT"` and the annotation handling use the legacy single-line `key=value >> $GITHUB_OUTPUT` form. A `TAG_NAME` (constrained by git refs, low risk) or a multi-line value would corrupt the output map; the title step already mitigates via a file, but the tag_name line is the unguarded one. Prefer the heredoc delimiter form for robustness. |
| LOW | function | smell | `install.sh:454-460` | `--test` without `--hooks` only *warns* then still calls `run_smoke_tests`, testing possibly-absent installed hooks at `$CLAUDE_DIR/...`. This is the documented H.7.8/H.7.9 trap; the warning does not prevent the misleading run. Consider returning early (or requiring `--hooks`) instead of warn-then-proceed. |
| LOW | file | smell | `.claude-plugin/marketplace.json:11` vs `.claude-plugin/plugin.json:9` | Two independently hand-maintained `description`/`tags` copies of similar prose; they can drift. Minor DRY smell; not load-bearing. |
| INFO | file | smell | `eslint.config.js:20-23,81-82` | The "60 rules total" recommended-set snapshot is a manual capture from `@eslint/js@9.39.4` with no machine check that it still matches; drift is possible (only on a v10 major bump, with a documented re-sync process). Could add a CI assertion comparing against `require('@eslint/js').configs.recommended.rules` to make ADR-0006 invariant 4 self-enforcing. |
| INFO | file | smell | `entities.json:1-8` | Orphaned data file — no production code reads it (grep finds only spec/research/bench mentions of the *string*). Missing trailing newline. Candidate for removal or a comment documenting its consumer. |
| INFO | substrate | smell | `packages/kernel/config-guard-patterns.json:3-51` | `config-guard` protects lint/build configs but NOT the kernel's own `hooks.json`/`plugin.json`/`.coderabbit.yaml`/`.github/workflows/*`. By design (these are project artifacts, not lint config), but it means the enforcement substrate does not guard its own enforcement manifest from edits — a trust-boundary worth noting. |
| INFO | function | logical-fallacy | `install.sh:385-395` (`run_smoke_tests`) | The exit-code comment documents a *previously inverted* exit (the old trailing `&&` returned 1 on the all-pass path under `set -e`). The current code is correct (`return 1` only when `failed>0`, else `return 0`). Noted as resolved — the comment's claim matches the code. No action; included for completeness of the audit checklist (error-swallow / fail-open class). |
