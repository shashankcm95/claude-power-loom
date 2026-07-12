# `tests/integration/` — the real-component integration tier

Integration tests exercise a **cross-module flow with real components** (real stores, real files, a real CLI
subprocess), where the unit tier tests each unit in isolation. Established by Track C1 of the
external-readiness checkpoint.

## Naming convention (load-bearing — the CI job keys on it)

| Pattern | Runs in CI? | Constraints | Example |
|---|---|---|---|
| `*.integration.js` | **Yes** — the `integration-tests` CI job | **Self-contained + CI-safe**: only Node built-ins + repo source. No network, no LLM, no `npx`/downloads. Imperative-assert (`assert.*` throws → non-zero exit); no swallowing `try/catch`. | `world-anchor-export-seam.integration.js` |
| `*.integration.sh` | No — **manual** | May need external tools (e.g. `npx eslint@9`). Run on demand / pre-push. | `lint-gate-prepush.integration.sh` |
| `*.e2e.js` / `tests/e2e/` | No — **gated** (LIVE, C2) | Real external boundaries (`claude -p`, network, sandbox). Opt-in only (`RUN_E2E=1`); must NOT run on every push. Deliberately OUTSIDE the `integration-tests` find so it is never swept. | `tests/e2e/real-e2e-actor-dogfood.e2e.js` (see `tests/e2e/README.md`) |

**Why `*.e2e.js` is reserved separately:** the `integration-tests` job runs
`find tests/integration -name '*.integration.js'` on **every push**. A gated real-actor e2e that named itself
`*.integration.js` would be swept onto every push, and its clean skip-when-unavailable (exit 2) would be read
by the CI loop as a failure. C2's gated e2e therefore uses a distinct suffix/dir the C1 find never matches.

## The CI contract

The `integration-tests` job runs each file as its own process: `node "$f"; rc=$?`. A test signals failure by
letting an `assert.*` throw (uncaught → non-zero exit) — **not** `node --test` (which false-greens on
imperative-assert files) and **not** a `try/catch` that swallows the error. A `count == 0 → exit 2`
vacuous-pass guard fails the job if the tier ever globs empty (a deleted last member must also remove the job).

## Running locally

```bash
# a single integration test
node tests/integration/world-anchor-export-seam.integration.js

# the whole CI-run tier (mirrors the CI find)
find tests/integration -name '*.integration.js' -type f -print0 | xargs -0 -n1 node
```
