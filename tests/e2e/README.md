# `tests/e2e/` — the GATED end-to-end tier

End-to-end tests that exercise **real external boundaries** (`claude -p`, the network, the macOS `sandbox-exec`
containment, python3/pytest). Established by Track C2 of the external-readiness checkpoint. These are **opt-in
and never run by CI** — the reserved `*.e2e.js` slot is deliberately OUTSIDE the `integration-tests` CI find,
and each e2e additionally requires `RUN_E2E=1`.

## Running (on a capable box: macOS + a real `claude` binary + network)

```bash
RUN_E2E=1 node tests/e2e/real-e2e-actor-dogfood.e2e.js
```

**Two different "sandboxes" — do not conflate them:**

- Disable the **agent/harness network sandbox** (so the `git clone` + `claude -p` + the containment self-check
  reach the network). If you run this through a wrapper that sandboxes network, disable *that*.
- The **loom `sandbox-exec` containment** (the behavioral grading leg, which runs the stranger repo's pytest)
  **stays ON**. Do **NOT** set `LOOM_SANDBOX_BACKEND=none` — that runs the stranger's tests uncontained. If loom
  containment is present but not attested, the harness **fails closed (exit 1)** rather than run uncontained.

## Exit contract

| Exit | Meaning |
|---|---|
| **2** | **SKIPPED** — `RUN_E2E` not `1`, OR a prerequisite genuinely absent (no `claude` binary, no macOS `sandbox-exec`, network unreachable). A clean skip, never a failure. |
| **0** | **Ran + graded** — the harness completed. The actor's verdict is a **SHADOW datum** (N=1, stochastic), NOT a pass/fail gate. |
| **1** | **FAIL** — loom containment present-but-broken (a real regression on a capable host), or the harness itself threw. |

The pure gate decision (`decideGate`) is unit-tested at `tests/unit/e2e/real-e2e-gate.test.js` — every
skip/fail/run branch is proven deterministically without a real run.

## SHADOW-dry (weight-inert — load-bearing)

The produced worked-example node is `provenance='backtest'` (baked into `populateRecallGraph`; provenance is in
the node_id content-address basis, so it can never collide with a live node) + written through `writeNode`
(which REJECTS any non-`backtest` provenance — the OQ-7 firewall) into a **fresh 0700 `mkdtemp` dir** (never the
persistent `~/.claude/lab-state` store) + **no live consumer** reads it. This is NOT `LIVE_SOURCES` (a separate
world-anchor weight-gate subsystem). A promoted e2e must preserve all three.

## Named residuals (NOT faked)

- **The actor-solve on a DEPLOYED box requires operator cross-uid arming.** On a box carrying the operator's
  `/etc/loom/actor-anthropic.key` deploy marker (or a `LOOM_ACTOR_REQUIRE_UID_SEP` flag) with cross-uid config
  incomplete, the `host-claude-guard` FAIL-CLOSES the `claude -p` actor + judge launches (`deployed-unconfigured`)
  — by design. The end-to-end actor-solve then needs the operator to complete arming (`LOOM_ACTOR_USER` +
  `LOOM_ACTOR_WRAPPER` + `LOOM_JUDGE_REQUIRE_UID_SEP`), OR a clean/un-deployed box for a direct run. The harness
  runs + the fail-closed gate works regardless; the actor-solve success is this residual.
- **The real-`gh` PR-observation half** is ABSENT from this e2e — it stops at the recall node; opening/observing a
  PR is the operator's `gh` boundary.
- **The true external merge** (a maintainer merging the actor's PR) is the OQ-NS-6 hardener — unschedulable, never
  a test.

## Convention

| Pattern | CI? | Constraints |
|---|---|---|
| `tests/e2e/*.e2e.js` | **No — gated** | Real boundaries; `RUN_E2E=1` opt-in; clean exit-2 skip when a prerequisite is absent. |
| `tests/integration/*.integration.js` | Yes | Self-contained, CI-safe (see `tests/integration/README.md`). |
