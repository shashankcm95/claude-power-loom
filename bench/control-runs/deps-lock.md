# deps-lock.md — Pinned versions per run

Per-run capture template. Before starting each new control-run, fill in this template under the run's directory (e.g., `v2.8.3-run1/deps-lock.md`).

## Why pin

Library/runtime drift introduces noise that looks like toolkit behavior. A "regression" might be:
- Node 22.10 → 22.11 V8 behavior change
- pdf-parse v2.4.5 → v2.5.0 API shift
- Next.js 14.2.5 → 14.2.7 webpack-RSC tweak
- npm 11.x → 12.x lockfile format

Without pinning, two runs of the same toolkit version on the same brief can produce divergent project code for reasons that have nothing to do with the toolkit.

## Capture commands

Run these at the start of each control-run and paste the output into `<run-dir>/deps-lock.md`:

```bash
# Runtime
echo "node: $(node --version)"
echo "npm: $(npm --version)"
echo "uname: $(uname -a)"
echo "os: $(sw_vers 2>/dev/null || lsb_release -a 2>/dev/null | head -5)"

# Package manager state (snapshot)
cp ~/Documents/Textbook_to_Tutorial/package-lock.json bench/control-runs/<run-dir>/package-lock-end-of-phase-1.json 2>/dev/null

# Plugin version (the toolkit under test)
ls ~/.claude/plugins/cache/power-loom-marketplace/power-loom/

# Toolkit-repo git commit (for tag drift detection)
git -C ~/Documents/claude-toolkit/ rev-parse --short HEAD
git -C ~/Documents/claude-toolkit/ describe --tags --always
```

## Recommended pinning strategy

| Layer | How to pin |
|---|---|
| Node version | `volta pin node@22.X.Y` in the project root, OR `nvm use 22.X.Y` documented in the run |
| npm packages | `package-lock.json` committed AND captured to the run dir at end of Phase 1 |
| Plugin version | Plugin cache only has the installed version; capture `~/.claude/plugins/cache/power-loom-marketplace/power-loom/<X.Y.Z>/.claude-plugin/plugin.json` to the run dir |
| OS state | Document `sw_vers` (macOS) or `lsb_release -a` (Linux) |
| Toolkit source commit | `git rev-parse --short HEAD` from `~/Documents/claude-toolkit/` (must match the installed plugin version's tag) |

## Run template (copy into `<run-dir>/deps-lock.md`)

```markdown
# Run: v<toolkit-version>-run<N> deps-lock

**Captured at**: <ISO-8601 timestamp>

## Runtime
- node: vXX.X.X
- npm: XX.X.X
- OS: <output of sw_vers or lsb_release>
- uname -a: <output>

## Plugin under test
- Installed version: <X.Y.Z>
- Plugin manifest: <copy of plugin.json>
- Toolkit-repo HEAD: <git short-sha + describe>

## Project dependencies
- package-lock.json: see `package-lock-end-of-phase-1.json` in this dir
- Notable major versions:
  - next: XX.X.X
  - react: XX.X.X
  - typescript: XX.X.X
  - drizzle-orm: X.X.X
  - pdf-parse: X.X.X
  - openai / @anthropic-ai/sdk: X.X.X

## Deviations from prior run
(Any version differences from the most recent prior run on the same toolkit version. If none, write "none — matches v<prior-run>'s deps-lock.")

## Deviations from latest baseline
(Any version differences from v2.8.2-run1. Important for cross-version comparisons — if Node or npm changed across the v2.8.X span, attribute findings carefully.)
```

## What to do if you can't pin

If a run can't be pinned (e.g., Docker isn't installed on this machine — see v2.8.2-run1 Drift P1-3), capture the deviation in the run's `notes.md` and `aggregate.py` will exclude that metric from cross-run comparison automatically (if the `deviation` field is populated in metrics.json).
