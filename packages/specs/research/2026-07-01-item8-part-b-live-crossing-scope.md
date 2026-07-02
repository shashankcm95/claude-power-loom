# Item-8 Part B — the SHADOW->LIVE crossing (gate-ladder scope)

> **STATUS: SCOPE ONLY. Nothing here is authorized.** This document maps the ordered
> gates ("rungs") that stand between today's mechanism-complete SHADOW substrate and the
> first time a lab-derived weight influences a real spawn. Each rung carries its **own
> go-ahead** — Part B was deliberately held for "its own gate + per-step go-aheads," and
> this doc exists to make those per-step decisions concrete, not to pre-approve them.
> Producing this doc crosses nothing live.
>
> Author: continuation session 2026-07-01. Predecessors: the arming-wave scope
> `2026-07-01-item8-arming-wave-scope.md` (Part A/B split) and the Rubicon scope
> `2026-06-30-pr-b-rubicon-scope.md` (the B1-B5 mechanism). Part A (the SHADOW live-loop
> scheduler A-W1/A-W2/A-W3, #481/#483/#484) is MERGED and mechanism-complete.

## What "the crossing" actually is

Today: `LIVE_SOURCES = Object.freeze([])` (`weight-source-gate.js:55`, gated on the STRICT
`LOOM_WORLD_ANCHOR_ARM`). No lab-derived weight is admitted anywhere. The B1-B5 mechanism
(signer routing -> commitment-gated admission -> recall retriever -> spawn-context slot ->
deploy-gated arming) is fully built and merged, all SHADOW/dark. The crossing is the moment
the two arm flags are set on a deployed+attested box, a real merge mints a **signed** edge,
that edge is admitted by the fail-closed crypto gate, and the recalled lesson reaches a
spawned agent's `## Earned instincts` prompt slot.

### The safety property that bounds this whole ladder (load-bearing)

An armed world-anchor weight's **only** production sink is **fail-open, sanitized
prompt-enrichment text** (`build-spawn-context.js` `## Earned instincts`, the B4 slot with
`sanitizeLine` + the bullet-prefix invariant). It is **never** an egress action. So the
worst case of an armed-but-co-forged weight is a **poisoned instinct in a spawn prompt**,
backstopped by `emitPR`'s human-approval gate — a bounded, sanitized prompt-injection
surface, not a forged PR. **Name that gate (the emitPR human approval), not blast-radius
smallness, in the rung-3 trust judgment.** This is why the crossing is lower-stakes than
"a weight gates a real decision" first implied — but it is still the first crossing, so it
gets the full ladder.

## The gate ladder

Each rung is independently gated. **Claude executes only the code/probe rungs and only on
an explicit go-ahead; the operator executes every deploy/attest/arm rung.** Claude will
NEVER, in any rung: write or read under `/etc/loom`, run any `--attested-cross-uid` path,
run `install.sh --schedule-liveloop`, or set an arm flag. Those are operator actions.

### Rung 0 — pre-crossing hardening (SHADOW, code-only, Claude-run)

**What:** edge-parity to the merged #480 (`3567ff9`) cwd-neutralization. `loom-edge-custody-verify.js:200`
runs the C3 cross-uid sign-probe (`signer(probeBasis, ctx)`) without neutralizing the
process cwd; the actor twin got `NEUTRAL_PROBE_CWD='/'` on its C3/C5 probes in #480, which
touched only `loom-actor-custody-verify.js`. Confirmed firsthand (grep: no `NEUTRAL_PROBE_CWD`
in the edge or broker verifier; `git show --stat 3567ff9` = actor file only).

**Why it belongs before the crossing:** `loom-edge-custody-verify.js` is exactly the
host-observable probe Claude runs at rung 2 to confirm the operator's deploy. If it inherits
the operator's cwd, a hostile cwd could influence the cross-uid launch during attestation.
It is SHADOW today (the edge signer is unarmed), so it can land any time; it wants to land
before rung 2.

**Open design point (for the rung-0 plan, not settled here):** the actor fix put `cwd` on
direct `spawnSync` calls; the edge C3 probe calls an injected `signer` **function**, so the
fix vehicle is either (a) thread a neutral cwd through the launcher (`crossUidLoomEdgeSigner`),
or (b) neutralize at the probe. A rung-0 plan + 2-lens VERIFY settles which. Also check
whether the broker `loom-custody-verify.js` C3 has the same gap (grep found no spawn there;
it may verify differently — probe before asserting).

**Go-ahead needed:** "do rung 0" -> a small SHADOW hardening PR, full per-wave rigor.
**Rollback:** trivial (SHADOW, no behavior change on the un-armed path).

### Rung 1 — B-block-1: headless-auth (401) fix (environment, operator-run; Claude verifies)

**What:** the live loop cannot run headless on this box — real `claude -p` returns `401
Invalid authentication credentials` (an environment-level auth failure, reproduces in a
full-PATH shell, independent of PATH). This blocks the **solve** phase (`live-draft-run.js`
`runActorInContainer`) and the judge/heartbeat path. It does **not** touch the egress path
(`emit-pr.js` / `gh-emit.js` never exec `claude`), so it is a live-run prerequisite, not an
emission blocker.

**Fix (per the phase-3.2 arc):** the Max subscription does not containerize
(`CLAUDE_CODE_OAUTH_TOKEN` -> 401 invalid bearer in a clean container); the working path is
an Anthropic API key at `~/.config/loom/anthropic-api-key` (gitignored, chmod 600, outside
the repo), injected as `-e ANTHROPIC_API_KEY` into the actor container. VERIFIED in the
③.2.2b arc that an `sk-ant-*` key auths `claude -p` in-container. So rung 1 is largely
"provision/confirm the actor API key + confirm a headless completion," not new code.

**Claude's role:** run a read-only probe that confirms `claude -p` returns a completion (not
401) once the operator has provisioned the key — the exact "`--version` passing != the judge
emits" lesson from the ghost-heartbeat 401. **Never** dump the key; parse only presence.
**Go-ahead needed:** "do rung 1" -> Claude writes the probe/runbook; operator provisions.
**Acceptance:** a real headless `claude -p` completion on the box, cost captured.

### Rung 2 — B-block-2: deploy + attest the cross-uid signer (operator-run; Claude host-verifies after)

**What:** a deployed, uid-separated, out-of-band-attested cross-uid edge signer so a real
merge mints a **signed** edge (not the unsigned `mock`-source shadow edge).

**Current state (from the arc memory, NOT re-probed — Claude must not touch `/etc/loom`):**
the edge signer (uid 612) was DEPLOYED + custody-attested on this box 2026-06-30 (5/5
host-observable PASS + operator out-of-band `id`/`ls -l`/`cat->EACCES`). **But** the deploy
helper re-stages the whole kernel into `/opt/loom`, and A-W1/A-W2/A-W3 have merged since —
so the staged tree is **stale relative to current main**. Rung 2 therefore includes an
operator **re-deploy to refresh `/opt/loom` to current main, then re-attest**, plus
confirming the broker (uid 610) is current.

**Division of labor (unchanged from the deploy arc):** the OPERATOR runs `sudo bash
scripts/loom-edge-deploy-macos.sh --apply` + the by-hand sudoers + the out-of-band
`--attested-cross-uid` (root + human-attested + hard-to-reverse). Claude runs the
host-observable `loom-edge-custody-verify.js` AFTER (which returns only
`hostObservableChecksPassed` + `requiresOutOfBandUidConfirmation`, never `custodyVerified`).
**Rung 0 should land first** so that verifier is cwd-hardened.

**Go-ahead needed:** "do rung 2" -> Claude prepares the runbook + the host-verify command;
operator executes the privileged steps. **Rollback:** the signer stays unarmed until rung 4.

### Rung 3 — B-block-3: the #273 same-uid trust judgment (a DECISION, not code)

**What:** the go-live judgment on the #273 residual. On a same-uid box the co-forge of a
byte-self-consistent record survives (integrity != provenance). A deployed+attested cross-uid
signer (rung 2) raises the forgery bar to a key-holder for **signed** edges — but the
judgment to make is: **is arming acceptable given that (a) the signer is deployed+attested,
and (b) the armed weight's only sink is the fail-open, sanitized `## Earned instincts` prompt
slot, backstopped by the `emitPR` human-approval gate?**

**Frame the judgment on the named gate, not on blast-radius smallness.** The honest ceiling
(OQ-NS-6): a host-unreadable key proves the legit minter signed THIS edge (provenance), NOT
that the diff genuinely merged (world-anchored trust). Only accumulated REAL merges harden
trust (rung 5). Rung 3 is the USER's explicit sign-off that the provenance floor + the
bounded sink are sufficient to arm.

**Go-ahead needed:** the USER makes this judgment. Claude's role is to lay out the decision
(this section) and answer questions, not to make it.

### Rung 4 — the live crossing itself (operator arms; Claude runs the single dogfood after)

**What:** set both arm flags — `LOOM_EDGE_REQUIRE_UID_SEP` (STRICT, B1 signer routing) AND
`LOOM_WORLD_ANCHOR_ARM` (STRICT, D1+D2 admission) — which the A-W1 both-or-neither preflight
(`custody-arming.armingCoherence`) requires be coherent. Enable the live loop
(`LOOM_LIVE_LOOP_ENABLED=1`, the A-W2/A-W3 run-gate) and, separately, the real emit path if
and when a live emission is in scope (emission is its OWN later decision — the first crossing
should stay draft/observe-only if possible). Then a SINGLE real merged PR flows
`observe-merge -> signed edge mint -> commitment-gated admission -> recall -> spawn-context`,
observed end-to-end, monitored, rollback-ready.

**Rollback (must be pre-staged):** the touch-file killswitch
`~/.claude/checkpoints/live-loop.disabled`, `LOOM_LIVE_LOOP_DISABLED=1`, unset the two arm
flags (either alone re-darkens: un-armed -> `LIVE_SOURCES` frozen `[]` and/or custody keys
unresolved), and `install.sh --unschedule-liveloop`.

**Go-ahead needed:** per-step, after rungs 0-3. The operator sets the flags; Claude runs the
single monitored dogfood and reports. **This is Rubicon-2.**

### Rung 5 — accumulation (OQ-NS-6; operator-maturity, not a build)

Over time, real merges accumulate through the live gate; trust hardens through accumulated
evidence, not single-merge gating. No code closes OQ-NS-6. This rung is ongoing operation +
observation, and it is where the "#273 CLOSES" line is actually earned (a deployed+attested
cross-uid broker signing an accumulating body of live edges).

## What Claude will never do in Part B (invariants)

- Never write or read anything under `/etc/loom` (host custody surface).
- Never run any `--attested-cross-uid` path (operator + out-of-band only).
- Never set an arm flag (`LOOM_WORLD_ANCHOR_ARM`, `LOOM_EDGE_REQUIRE_UID_SEP`) or run
  `install.sh --schedule-liveloop`.
- Never `security ...-g` or otherwise dump a token/key; parse presence/expiry only.
- Never proceed to the next rung without an explicit per-step go-ahead.

## Runtime probes (firsthand, this session)

- `weight-source-gate.js:55` = `LIVE_SOURCES = Object.freeze(isWorldAnchorArmed() ? [WORLD_ANCHOR_SOURCE] : [])`.
  Probe: grep. Confirms the D1 flip is a single module-load read.
- `world-anchor-arming.js` is the SOLE reader of `LOOM_WORLD_ANCHOR_ARM`, STRICT `normalizeBool`.
  Probe: recon `arming-lane` reader + memory. (Not re-grepped this turn; carried.)
- Edge C3 cwd gap: `loom-edge-custody-verify.js:200` calls `signer(probeBasis, ctx)` with no
  cwd override; `grep -n NEUTRAL_PROBE_CWD` = actor file only; `git show --stat 3567ff9` =
  `loom-actor-custody-verify.js` (+test) only. Probe: grep + git show. CONFIRMED.
- 401 does not touch egress: `emit-pr.js` / `gh-emit.js` do not exec `claude` (they exec `gh`).
  Probe: recon `emission-401` reader (child_process not imported in emit-pr; gh-emit uses
  execFileSync for gh only).

## Open questions for the USER (gate the sequencing)

1. **Rung 0 now, or fold into rung 2?** The edge C3 cwd fix is a clean SHADOW hardening; it
   can ship independently (or as a task chip) or ride the rung-2 prep. Recommend: ship it
   first, standalone, so the rung-2 verifier is already hardened.
2. **Does the first crossing emit, or stay draft/observe-only?** Recommend the first live
   crossing be observe/draft-only (emit OFF) — arm the weight lane, keep egress dark — so the
   first real signed-edge admission is proven with zero outward action, then emission is its
   own later go-ahead.
3. **Rung entry criteria / sign-off:** who declares 401 "fixed enough," broker "attested
   enough," trust "judged enough"? Recommend: the USER, per-rung, with Claude presenting the
   evidence for each.
4. **Is the deployed signer (2026-06-30) still current,** or does rung 2 assume a fresh
   re-deploy to pick up A-W1/A-W2/A-W3? (Claude cannot probe `/etc/loom`; the operator
   confirms.)

## Recommendation

Author this scope (done). Then take **at most one rung at a time**, each on its own go-ahead.
The cheapest, safest, fully-in-substrate next step is **rung 0** (the edge C3 cwd hardening),
which crosses nothing live and de-risks the rung-2 attestation. Everything from rung 1 onward
depends on operator/deploy/trust decisions that are the USER's to make.
