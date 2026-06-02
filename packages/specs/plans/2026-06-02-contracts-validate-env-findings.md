---
date: 2026-06-02
status: complete
lifecycle: ephemeral
topic: "Resolve the 2 environment-dependent contracts-validate findings (post-#206 diagnosis)"
related:
  - packages/runtime/orchestration/contracts-validate.js
  - packages/runtime/contracts/08-ml-engineer.contract.json
  - tests/smoke-h7.sh   # Test 38 (H.7.24) — must stay green
---

# Plan — clean up the 2 env-dependent contracts-validate findings

Diagnosing the 26 `contracts-validate` violations (post-#206) showed all 26 are pre-existing +
environment-dependent (identical on main; 0 in CI / in-session). Two are worth resolving so a bare
`node contracts-validate.js` on a real install reports a clean 0.

## Finding A — `contract-plugin-hook-deployment: 25` (`hook-not-deployed`)

**Cause** (verified): from a bare shell, `CLAUDE_PLUGIN_ROOT` is unset, so the validator can't take
its `isPluginLoaded` auto-pass; `settings.json` exists with empty `hooks` (the plugin is enabled via
`enabledPlugins`, hooks injected by the loader, never written to settings.json). The H.7.24 branch
deliberately does NOT auto-pass on `enabledPlugins` truthy (could mask a broken cache), so it counts
all 25 plugin hooks as "not deployed."

**Fix (COMPLETES H.7.24, does NOT reverse it):** when `enabledPlugins` shows power-loom enabled +
`CLAUDE_PLUGIN_ROOT` unset, *verify the real install* before counting. Read
`~/.claude/plugins/installed_plugins.json` → the `power-loom@power-loom-marketplace` entry's
`installPath` → confirm `installPath/packages/kernel/hooks.json` exists. If present, the plugin
loader will deploy the hooks at session start → return `[]` (pass) with an informational note. If the
install record / cache hooks.json is ABSENT (broken/failed install) → fall through to the existing
settings.json check, which surfaces the hooks as not-deployed. This is strictly BETTER than the
current "always count in this mode" — it actually detects a broken cache instead of always-counting,
which is exactly the concern H.7.24 documented.

- Keep the existing `enabledPlugins shows ... enabled` informational stderr verbatim (smoke-h7
  Test 38 greps for it).
- CI path (settings.json absent → early `return []`) and in-session path (`CLAUDE_PLUGIN_ROOT` set →
  auto-pass) are untouched.

## Finding B — `contract-skill-status-values: 1` (`marketplace-skill-missing`)

**Cause** (verified): `08-ml-engineer` declares the *recommended* skill `claude-api` with status
`marketplace:anthropic-skills/claude-api`. `anthropic-skills` is **not a known marketplace** (known:
claude-plugins-official, knowledge-work-plugins, power-loom-marketplace) and no installed marketplace
carries a `claude-api` skill — the reference is aspirational / resolves nowhere. It's the only
`anthropic-skills` reference in the repo.

**Fix:** change the `claude-api` status from `marketplace:anthropic-skills/claude-api` to
`not-yet-authored` (the honest "referenced but not available; promise mode" status per
`contract-format.md`). `claude-api` stays a *recommended* skill (the persona's inference-API path);
it just degrades gracefully instead of pointing at a phantom marketplace. Keep the `_scope_note`.

## Runtime Probes (verified before editing)

- `installed_plugins.json` → `power-loom@power-loom-marketplace[0].installPath =
  ~/.claude/plugins/cache/power-loom-marketplace/power-loom/3.1.0`; `installPath/packages/kernel/hooks.json`
  EXISTS. (the loader's real path.)
- `known_marketplaces.json` → `anthropic-skills` NOT present.
- No `claude-api` SKILL.md in any installed marketplace (`find` → none).
- `smoke-h7.sh` Test 38 asserts the `enabledPlugins shows.*enabled` substring under a mock HOME with
  NO install record → my change must keep emitting it AND fall through (mock has no real install). ✓
- `hooks.json` declares exactly 25 command hooks → matches the 25 violations.

## TDD arc

1. NEW unit test `tests/unit/runtime/contracts/plugin-hook-deployment.test.js` (currently only the
   bash smoke covers this validator): mock-HOME synthetic roots —
   - enabledPlugins truthy + installed_plugins.json present + cache hooks.json present + CLAUDE_PLUGIN_ROOT
     unset → 0 violations (NEW pass path).
   - enabledPlugins truthy + NO installed_plugins.json → violations present + informational stderr
     (preserved fall-through; mirrors smoke Test 38).
   - settings.json absent → 0 (CI path).
   Run red (the confirmed-install pass doesn't exist yet) → impl → green.
2. Add the `confirmInstalledPluginHooks()` helper + the early-return in the H.7.24 branch.
3. Finding B: one-line status change in `08-ml-engineer.contract.json`.

## Verification

- `node tests/unit/runtime/contracts/plugin-hook-deployment.test.js` → pass.
- `bash tests/smoke-h7.sh` Test 38 → still green.
- `node contracts-validate.js` on THIS real install → totalViolations 0 (was 26).
- Full kernel suite + all runtime/contracts tests + `install.sh --hooks --test` → green.

## Outcome

Both findings resolved; `node contracts-validate.js` on this real install: **26 → 0**.

- **Finding A** — final design (hardened per code-review Finding 1, below): `readInstalledPluginHooks()`
  resolves the installed cache hooks.json; a shared `enumerateTriples()` derives triples for BOTH the
  repo and the cache; the H.7.24 branch compares them. Full coverage → `return []` (deployed). A
  present-but-STALE cache (missing repo hooks) → flag exactly the missing delta
  (`hook-not-in-installed-cache`, fix = run /plugin update). No confirmable install → fall through to
  the settings.json check (broken/absent install). Verified: repo hooks.json == installed cache
  (sha `f21cc1f`) on this machine → 0.
- **Finding B** — `08-ml-engineer` `claude-api` → `not-yet-authored`.

### Code-review pass (Warning → all folded in)

A `code-reviewer` spawn found a real **HIGH false-pass**: the first cut only checked the cache
hooks.json was *non-empty*, so a STALE cache (repo added a hook, user hasn't run /plugin update) would
auto-pass and silently hide the undeployed hook — defeating the validator's drift-detection purpose.
Fixed by the triple-coverage comparison above (flag the delta, don't blind-pass). Also folded in:
the missing stale-cache **test case** (Finding 3) and a `process.env.HOME` guard (Finding 4). Finding 2
(consistency) is resolved — the cache path now verifies MORE (triple coverage) than the
`isPluginLoaded` auto-pass, not less.

- Gates: new test **5/5** (pass / stale-delta / corrupt-empty / no-record / no-settings);
  all runtime/contracts tests (64); kernel 44/44; eslint clean;
  `install.sh --hooks --test` **118/0** (smoke-h7 Test 38 H.7.24 ✓ within it).

**Process note** — `bash tests/smoke-h7.sh` run STANDALONE fails 3 tests with `cjs/loader:1386`
(`$SCRIPT_DIR` is unset, so `require('$SCRIPT_DIR/packages/...')` → `require('/packages/...')`).
smoke-h7.sh is **sourced** by install.sh (`install.sh:355`), which sets `SCRIPT_DIR` = repo root; run
that way (or with `SCRIPT_DIR` exported) all tests pass. Pre-existing harness quirk, unrelated to this
change — verified identical on pristine main via stash.

## Out of scope

- Persona-depth item 1 (the ~10 KB-gaps) — separate follow-up.
- smoke-h7.sh could guard `SCRIPT_DIR` (default to its own repo-root derivation when unset) so it runs
  standalone — minor DX nit, not addressed here.
