---
lifecycle: persistent
created: 2026-06-24
status: PLANNED — pre-build. #412 follow-on (#430). Security/custody substrate (host-side `claude -p` containment).
---

# #430 — judge/labeler host-`claude -p` residual (the #412 actor-uid-separation follow-on)

> The uid-611 arc (#425-429) moved the **resolution actor** (`runActorTrajectory`) off the operator uid +
> under the #422 armed-refusal guard. Three SIBLING host-side `claude -p` spawns over attacker-influenced
> text were named as a carried residual the #412 VERIFY boards required tracked before #412 is declared
> closed. This closes (or explicitly accepts) that residual.

## §0 Threat model (the vector #430 closes)

A prompt-injected judge/labeler that reaches a shell while running as the operator uid (501, broker-allowlisted)
could `sudo -n -u loom-broker <wrapper>` and mint an egress approval — the SAME class #412 closed for the
resolution actor. Two windows:

- **Armed window** (a live emit is armed): ANY host-side `claude -p` is dangerous (it could mint the approval
  the armed emit is waiting on). The clean close: REFUSE to spawn it — mirror the #422 guard.
- **Disarmed window**: a compromised judge can't mint *right now* (no armed emit), but defense-in-depth says it
  should still not run as a broker-allowlisted, shell-capable uid.

## §1 Runtime Probes (firsthand — @ `20371f5`)

- **P1 — FOUR chokepoint FUNCTIONS, each `spawnSync('claude', ['-p', ...])` as uid-501, NO armed guard, NO
  cross-uid routing.** CONFIRMED (read + call-graph grep; corrected from "three" by the VERIFY honesty HIGH —
  see §8):
  - `packages/lab/causal-edge/trajectory-friction-run.js:187` — `claudeOnce` (the friction labeler; via `makeFrictionLabeler`). Prompt on STDIN.
  - `packages/lab/causal-edge/calibration-issue-run.js:127` — `claudeOnce` (blind judge leg B via `makeBlindSemanticJudge` + reference teacher leg C via `makeReferenceTeacher`). Prompt on STDIN. **Leg C (`makeReferenceTeacher`) takes NO `toolless` param + is called un-pinned (`earned-grounding-run.js:343`) — it runs TOOL-BEARING and is the ONLY judge that MAY see `accepted_diff`.**
  - `packages/lab/causal-edge/calibration-run.js:93` — `claudePJudge` (rung-2 semantic judge; via `makeClaudePJudge`). **Prompt is a POSITIONAL argv (`['-p', renderPrompt(...)]`) with `input:''` — NOT stdin (the contract the other three use).**
  - `packages/lab/causal-edge/_spike/lesson-capture-rerun.js:44` — `claudeOnce` (the lesson deriver; via `makeLessonDeriver`/`runCaptureRerun`). **LIVE despite the `_spike/` path** — `earned-grounding-run.js:284,347` ("the canonical real leg") + `bootcamp-capture.js:22` invoke it over attacker-influenced text. `_spike/` only keeps it out of the CI unit-glob. Prompt on STDIN.
- **P2 — the pattern to mirror lives in `runActorTrajectory`** (`trajectory-friction-run.js:112-161`): the #422
  armed guard (`:119-125`, fail-closed `catch{armed=true}`, observable `emitEgressAlert`) THEN the #428
  launch resolution (`:126-161`, `defaultActorLauncher`, fail-closed-on-deployed polarity). `defaultIsEmitArmed`
  (`:42-50`) + `defaultActorLauncher` (`:58-73`) are the seam primitives. CONFIRMED (read).
- **P3 — the cross-uid wrapper is ACTOR-shaped, NOT judge-shaped.** `scripts/loom-actor-deploy-macos.sh:222`:
  `exec ${CLAUDE_BIN} -p --output-format stream-json --verbose --model "$1" --allowedTools Read,Grep,Glob,Edit,Write`.
  A judge routed through it gets **stream-json** (breaks the judge's `JSON.parse(stdout)`) + **Edit/Write** it
  does not need. So part 2 (cross-uid routing) is NOT a drop-in reuse of `crossUidActorArgs` — it needs a
  judge-shaped path (a second wrapper / a `--tools ""` plain-output exec). CONFIRMED (read).
- **P4 — the live-loop judge/labeler ALREADY pin tool-less** (`toollessArgs(toolless)`, the ③.2.2c fold);
  `makeBlindSemanticJudge` / `makeFrictionLabeler` thread `toolless`. The chokepoints DEFAULT `toolless=false`
  (the sealed-corpus grading path) and `claudePJudge` sets NO `--allowedTools` at all. CONFIRMED (read).
- **P5 — route-decide: `root` (0.075).** A focused pattern-mirror, not a HETS team spawn. The security
  3-lens VERIFY + 4-lens VALIDATE boards STILL apply (kernel/custody-diff rule), independent of route-decide.
- **P6 — mitigation today (NOT a live hole).** PATH-1 human approve-CLI is the real authorization boundary
  (hash+TTL+nonce-bound to the emission the human SEES); the live judge is tool-less; egress is SHADOW until armed.

## §2 The design

### PR-1 — the armed-window guard (REQUIRED; mirrors #422; pure / fail-closed / SHADOW-safe)

Extract a shared leaf helper `packages/lab/_lib/host-claude-guard.js` (DIP — depends only on the
kernel `isEmitArmed`, lazily) exporting `assertHostClaudeAllowed({ isEmitArmedFn, spawn, alertToken })`:

- returns `{ allowed: true }` when not armed; `{ allowed: false, reason }` when armed, where the caller passes its
  own `alertToken` (the actor keeps `host-actor-refused-while-armed`; the judges use the
  `host-judge-refused-while-armed` default); **fail-CLOSED** (`catch => armed`), emits
  `emitEgressAlert(alertToken, { spawn })` (observable).
- The security-critical fail-closed polarity lives in ONE place (it must NOT diverge across copies).

Apply it at the top of all FOUR chokepoints (`claudeOnce` ×3 — friction labeler + calibration judge + lesson
deriver — and `claudePJudge` ×1) BEFORE the spawn — return
the existing fail-closed shape (`{ ok:false, reason }` / `{ supported:false, fallback_reason }`). Refactor
`runActorTrajectory`'s inline #422 guard to call the shared helper (NO behavior change — byte-identical when
unset). SHADOW-safe: unset env => not armed => unchanged.

### PR-2 — cross-uid judge routing (the disarmed-window structural close; "lean B" — DECISION §3)

Mirror the #428 seam for the 3 judge/labeler chokepoints, REUSING the `loom-actor` uid (no new uid, no second
sudoers entry — minimal deploy delta):

1. **`loom-actor-launch.js` — a `crossUidJudgeArgs({ actorUser, wrapperPath })` builder** that emits
   `sudo -n -u <actorUser> <wrapper> --loom-judge` (a NEW sentinel, parallel to `--loom-actor-version-probe`).
   No model arg is appended via the actor-model allowlist path — the judge model is pinned inside the chokepoint
   prompt-builder, and the wrapper's judge branch sets the judge recipe. (Exact-set sentinel; an unknown arg THROWS.)
2. **`loom-actor-deploy-macos.sh` wrapper — a judge-mode branch** parallel to the version-probe sentinel:
   `if [ "$1" = "--loom-judge" ]; then exec ${CLAUDE_BIN} -p --tools "" --strict-mcp-config --disallowedTools LSP; fi`
   (tool-less recipe per the LSP-leak catch + memory `capability-free-claude-headless`; PLAIN output, NOT
   stream-json — the judge parses `JSON.parse(stdout)`). The prompt rides STDIN (the existing chokepoint contract).
3. **Route the 3 chokepoints** through a shared `resolveJudgeLaunch` (the SAME fail-closed-on-deployed polarity as
   `defaultActorLauncher`): `direct` (unset/clean — byte-identical existing path) | `cross-uid` (deployed) |
   `refuse` (deployed-unconfigured / launcher-threw / unknown-mode). The judge's tool-less pin is KEPT in the
   DIRECT path too (defense-in-depth — B ⊇ the tool-less-only option).

DRY: `resolveActorLaunch` / `resolveJudgeLaunch` share `defaultActorLauncher`'s env-resolution + polarity; only the
arg-builder (`crossUidActorArgs` vs `crossUidJudgeArgs`) and the wrapper branch differ.

## §3 DECISION (2026-06-24, USER + recommendation) — option B (cross-uid), implemented "lean B"

**Locked: B (full cross-uid routing), lean variant** — reuse the `loom-actor` uid + extend its wrapper with a
judge-mode branch (no second wrapper/uid). The tool-less pin is KEPT as the inner layer (B ⊇ A). Rationale:
**structural uid-separation does not rest on a `claude -p` capability flag** (the class that bit ADR-0012 +
the LSP-leak), it is **symmetric with #412's actor treatment** for the same mint threat, and it strictly
dominates the tool-less-only option. A was the lean alternative; C (defer) was rejected — #412 wants the
residual closed, not carried.

## §4 VERIFY plan (pre-build, 3-lens — REQUIRED, security/custody)

`architect` (the shared-helper factoring + the seam-mirror soundness) + `hacker` (can a chokepoint still spawn
while armed? a bypass of the shared guard? the fail-closed polarity) + `honesty-auditor` (does PR-1 actually
close the armed-window for all 3? is "tool-less => no mint" honest, or is there a non-tool shell path?).

## §5 VALIDATE plan (post-build, 4-lens — REQUIRED)

`code-reviewer` + `hacker` (LIVE re-probe the BUILT code per Rule 2a — actually drive a chokepoint with a
mocked-armed `isEmitArmedFn` and assert NO spawn; assert tool-less is non-overridable if option A) + `honesty` +
`architect`. The hacker builds throwaway probes against the built modules, not just the plan.

## §6 Residuals

- **CORRECTED (VERIFY honesty HIGH):** `_spike/lesson-capture-rerun.js:44` `claudeOnce` is NOT a spike — it is a
  LIVE fourth chokepoint (P1). It is IN SCOPE for PR-1 + PR-2.
- `_spike/dogfood-derive-sample.js:68` (`runCaptureRerun`) is a genuine dogfood spike (manual one-off, no live
  caller) — out of scope; it routes through the now-guarded `makeLessonDeriver`/`runCaptureRerun` anyway.
- **Fixed-input canaries (VALIDATE hacker/honesty LOW; allowlisted in the PR-1 CI invariant):**
  `_lib/claude-headless.js` (`verifyToollessRuntime`) + `issue-corpus/_spike/live-draft-dogfood.js:45` (`legP`) are
  host-side `claude -p` spawns NOT behind the armed guard — but both probe with the FIXED constant `'hi'` (never
  attacker-influenced text), so neither carries the prompt-injection-to-mint vector §0 scopes. A defense-in-depth
  follow-on MAY gate `verifyToollessRuntime` (it runs at the top of `runLiveDraftLoop`, a live emit-path loop) for
  the broader "no host `claude -p` while armed" intent — carried to PR-2 consideration.
- Custody-real stays a DEPLOYMENT property (the broker key custody + the uid-611 deploy) — unchanged by #430.
- A FUTURE always-on `claude -p` built-in tool would leak past the tool-less denylist until added (the
  `claude-headless.js:17-19` residual) — the STRUCTURAL uid-separation (PR-2), not the tool-less flag, is the
  load-bearing close; tool-less is the documented inner layer.

## §7 Routing Decision

```json
{ "recommendation": "root", "bare_score_total": 0.075, "weights_version": "v1.3-dict-expanded-2026-06-12",
  "note": "focused pattern-mirror, not a HETS team spawn; security 3-lens VERIFY + 4-lens VALIDATE still apply per the kernel/custody-diff rule" }
```

## HETS Spawn Plan

N/A — route-decide returned `root` (§7). The required review rigor is the §4 VERIFY + §5 VALIDATE security boards
(persona-selection Rule 2), not a PM->Senior->Mid->Junior build tree.

## §8 Pre-Approval Verification (3-lens VERIFY board — recorded 2026-06-24, workflow `wf_21115fdb`)

**Verdicts:** architect `APPROVE-WITH-NITS`, hacker `NEEDS-REVISION`, honesty `NEEDS-REVISION`. The lean-B approach
SURVIVES (architect: "the simplest sound one for the threat"; no kill finding) — the revisions below are concrete
defects folded into §1/§2/§6 + carried as VALIDATE live-probes.

### FOLDED into the build contract (premise-probed firsthand)

- **[honesty HIGH] 4th chokepoint** — `lesson-capture-rerun.js:44` is LIVE, not a spike (grep-confirmed: callers
  `earned-grounding-run.js:284,347` + `bootcamp-capture.js:22`). §1 P1 + §6 corrected; PR-1 guards all FOUR.
- **[hacker CRITICAL] `claudePJudge` argv-vs-stdin** — it passes the prompt as POSITIONAL argv + `input:''`
  (`calibration-run.js:95,99`), incompatible with the stdin `--loom-judge` wrapper contract. **PR-2 sub-step 0:
  normalize `claudePJudge` to ride the prompt on STDIN** (`input: renderPrompt(...)`, `args:['-p']`) BEFORE routing
  it cross-uid. VALIDATE live-probe: a cross-uid judge gets its prompt on stdin (never argv).
- **[hacker HIGH] leg C un-pinned** — add `toolless` (+ `maxBudgetUsd`) to `makeReferenceTeacher` + thread
  `toollessArgs(toolless)` into its `claudeOnce` (mirror `makeBlindSemanticJudge`); pass `toolless:true` at
  `earned-grounding-run.js:343` + spikes. (PR-2; leg C is the highest-value chokepoint — it may see `accepted_diff`.)
- **[architect HIGH] helper token + leaf shape** — the shared helper is a LEAF: it decides armed/not-armed with the
  fail-closed polarity (`catch => armed`) and returns `{ allowed, reason }` ONLY (NO `ok`/`supported`/`events`
  knowledge, NO mode/shape param). Each call site (a) emits its OWN `emitEgressAlert` token and (b) maps to its
  native fail-closed shape. **`runActorTrajectory` KEEPS its exact token `host-actor-refused-while-armed` +
  `{ok:false,reason,events:[]}` return — byte-identical** (the judges use `host-judge-refused-while-armed`).
- **[hacker MEDIUM] guard in the FUNCTION body + spawnFn seam** — the guard lands in `claudeOnce` (×3) +
  `claudePJudge` bodies BEFORE the spawn (NOT the factories — a factory guard is vacuous for an armed window that
  opens later). Add a `spawnFn` injection seam to all four (they lack it today; `runActorTrajectory:137` has it) so
  VALIDATE asserts mocked-armed => `spawnFn` NEVER called (non-vacuity at the spawn boundary).
- **[hacker MEDIUM] wrapper fail-closed dispatch** — the `--loom-judge` branch goes BEFORE the `--model "$1"`
  exec, plus a final `else { echo 'unrecognized mode' >&2; exit 2; }` so an unknown `$1` FAILS CLOSED (never runs
  the tool-bearing actor recipe with attacker input as `--model`). (PR-2.)
- **[hacker LOW] `crossUidJudgeArgs` via the validated base** — build it through `crossUidSudoArgs({brokerUser:
  actorUser, wrapperPath, sudoPath})` (so `USERNAME_RE` + abs-path validation hold) + append ONLY a frozen
  `JUDGE_SENTINEL` constant (never an attacker arg / leading dash). Unit test: a leading-dash actorUser THROWS.

### Carried as VALIDATE live-probes (NOT blessed on assertion)

- **[hacker HIGH] tool-less is an UNPROVEN harness-capability claim** (ADR-0012 / LSP-leak class). The plain-output
  judge wrapper can't be runtime-verified by the existing `verifyToollessRuntime` (it reads the stream-json init
  `tools[]`). VALIDATE-hacker: run the judge wrapper with `--output-format stream-json` appended (probe-only
  variant) as the actor uid and assert init `tools==[]`. The §3 headline stands: the LOAD-BEARING close is the
  uid-separation (doesn't rest on the flag); tool-less is the documented inner layer.
- **[honesty MEDIUM] scope the tool-less claim** — "current-recipe / denylist-residual / runtime-gate-not-wired-in-
  the-judge-branch", not "provably no shell path." Done in §6.

### Deploy-ordering + symmetry (PR-2 design notes)

- **[architect MEDIUM] PR-2 inert until the wrapper is RE-DEPLOYED** — the `--loom-judge` branch lives in the
  root-owned host-unwritable wrapper; a box on the OLD wrapper routes cross-uid into a wrapper that treats
  `--loom-judge` as a `--model`. Forward-Contract: `resolveJudgeLaunch` routes cross-uid ONLY when the wrapper is
  confirmed judge-aware (a probe sentinel, below) — else fail-closed `refuse`. Runbook: PR-2 REQUIRES a wrapper
  re-deploy. ("no new uid / no new sudoers entry" stays true — sudoers authorizes the command PATH, not argv; but
  the wrapper BODY re-install is a real operator step.)
- **[architect/honesty MEDIUM] `--loom-judge` exec-liveness** — add a `--loom-judge-version-probe` sentinel +
  `crossUidJudgeProbeArgs` + a `loom-actor-custody-verify` C5 leg (parallel to the actor C3), which ALSO doubles as
  the judge-aware-wrapper confirmation for the deploy-ordering Forward-Contract above. (Full #412 symmetry.)
- **[architect/honesty LOW] tool-less recipe DRY-drift** — cross-reference comment in BOTH the wrapper body and
  `claude-headless.js` (`TOOLLESS_CLAUDE_ARGS`) as a recipe-sync pair; the C5 custody-verify init-`tools[]` assert
  is the empirical guard against drift.

### Build order (revised)

PR-1 (armed-window guard, 4 chokepoints + leaf helper + spawnFn seams; pure / fail-closed / SHADOW-safe) FIRST.
PR-2 (claudePJudge stdin-normalize -> leg C toolless -> `crossUidJudgeArgs`/`JUDGE_SENTINEL` -> the wrapper judge
branch with fail-closed dispatch -> `resolveJudgeLaunch` routing -> custody-verify C5 + Forward-Contract -> runbook) SECOND.

## §9 PR-2 build spec (refreshed probes @ `b6f50f93` post-PR-1 + firmed design) — pre-VERIFY

> PR-1 (#431) merged: the four chokepoints now carry `assertHostClaudeAllowed` + a `spawnFn` seam, so the §1
> line numbers shifted. Re-probed firsthand this session; the design below is the input to the §10 PR-2 VERIFY board.

### §9.1 Refreshed runtime probes (firsthand)

- **The seam to mirror** = `runActorTrajectory` (`trajectory-friction-run.js:102-157`): armed guard (`:111-112`) THEN
  `defaultActorLauncher()` (`:48-63`) -> `{mode}` -> lazy `crossUidActorArgs` (`:131-132`) -> `spawn`. Modes:
  `cross-uid` | `direct` (byte-identical existing) | `refuse`/unknown (fail-closed + `emitEgressAlert`).
- **The validated argv base** = `crossUidSudoArgs({brokerUser,wrapperPath,sudoPath})` (`loom-broker-launch.js:50-64`):
  `USERNAME_RE` + absolute/no-dotdot/no-control-char; returns `{command:'sudo', args:['-n','-u',user,wrapper]}`.
  `crossUidActorArgs` (`loom-actor-launch.js:51-58`) reuses it + appends an exact-set-allowlisted model.
- **The four chokepoints (post-PR-1):** `claudeOnce` in `trajectory-friction-run.js:174` (friction labeler; STDIN;
  `{isEmitArmedFn,spawnFn}` seam), `claudeOnce` in `calibration-issue-run.js:128` (leg B blind + leg C teacher;
  STDIN; seam), `claudePJudge` in `calibration-run.js:99` (rung-2; **argv `['-p', renderPrompt]` + `input:''`** —
  the PR-1 comment `:104-106` flags the PR-2 stdin-normalize), `claudeOnce` in `_spike/lesson-capture-rerun.js:45`
  (lesson deriver; STDIN; seam; **NO `toolless`/extraArgs param at all**).
- **Tool-bearing-in-direct-path chokepoints:** leg C `makeReferenceTeacher` (`calibration-issue-run.js:180` — calls
  `claudeOnce(bin,prompt,timeout)` no extraArgs; sees `accepted_diff` at `:191`) + the deriver `makeLessonDeriver`
  (`lesson-capture-rerun.js:65` — sees `accepted_diff`+`candidate`+`failed_patch`). Both un-pinned. Leg B
  (`makeBlindSemanticJudge`) + friction (`makeFrictionLabeler`) ALREADY thread `toolless` (default false).
- **The tool-less recipe** = `TOOLLESS_CLAUDE_ARGS` (`claude-headless.js:21`) = `--tools "" --strict-mcp-config
  --disallowedTools LSP`; `verifyToollessRuntime` (`:38-59`) = the real-`-p`-init-`tools[]` gate (the C5 shape).
- **The wrapper** (`loom-actor-deploy-macos.sh:216-223`) = `#!/bin/sh`, `PATH=<node>:/usr/bin:/bin`, an
  `if --loom-actor-version-probe -> claude --version; fi`, then `export ANTHROPIC_API_KEY=$(cat KEY)` +
  `exec claude -p --output-format stream-json --verbose --model "$1" --allowedTools Read,Grep,Glob,Edit,Write`.
- **custody-verify C3** (`loom-actor-custody-verify.js:88-92,183-190`) = `crossUidActorVersionProbeArgs` -> `claude
  --version` as 611, `{ran,exitZero}`. C5 mirrors it but runs the judge probe sentinel + asserts init `tools==[]`.
- **Live callers to pin** (`toolless:true`): `earned-grounding-run.js:342-344,347` (the canonical real leg — TODAY
  passes NO toolless to ANY leg), spikes `real-e2e-actor-dogfood.js:82-84`, `e7-live-dogfood.js:148-150`,
  `bootcamp-capture.js:67` (via `runCaptureRerun`). Leg B/friction already pinned at `live-draft-run.js:189-190` +
  `live-draft-dogfood.js:79`.

### §9.2 Firmed design (the build contract — modulo VERIFY folds)

1. **`claudePJudge` stdin-normalize** (`calibration-run.js`): `const args=['-p']; if(model) args.push('--model',model);`
   spawn with `input: renderPrompt(promptSpec, edge)` (was the positional argv + `input:''`). Prereq for cross-uid.
2. **kernel `loom-actor-launch.js`** — add `crossUidJudgeArgs({actorUser,wrapperPath,sudoPath})` (reuse
   `crossUidSudoArgs`, append frozen `JUDGE_SENTINEL='--loom-judge'` — NO model arg; model pinned in the wrapper) +
   `crossUidJudgeProbeArgs` (append `JUDGE_PROBE_SENTINEL='--loom-judge-version-probe'`). Both export.
3. **lab leaf `host-claude-guard.js`** — add `normalizeBool` + `defaultJudgeLauncher()` + `resolveJudgeLaunch({judgeLauncherFn})`
   (the routing polarity + lazy `crossUidJudgeArgs`, in ONE place). `resolveJudgeLaunch` returns
   `{mode:'direct'}` | `{mode:'cross-uid',command,args}` | `{mode:'refuse',reason}` (a build/launcher throw + an
   unknown mode -> refuse + `emitEgressAlert`). **Forward-Contract polarity (`defaultJudgeLauncher`):**
   - `LOOM_ACTOR_USER` + `LOOM_ACTOR_WRAPPER` set + `LOOM_JUDGE_REQUIRE_UID_SEP` truthy -> `cross-uid` (reuse the
     loom-actor uid + wrapper — lean B). The judge flag is the operator's "I re-deployed the judge-aware wrapper +
     C5 passed" confirmation (the wrapper can't be probed per-spawn).
   - actor user+wrapper set but judge flag NOT truthy -> `refuse:'judge-wrapper-unconfirmed'` (a box on the OLD
     actor-only wrapper must NOT route `--loom-judge` into a `--model` slot — fail-closed).
   - exactly one of user/wrapper -> `refuse:'half-configured'`.
   - both unset + any deployed-signal (judge flag OR `LOOM_ACTOR_REQUIRE_UID_SEP` OR the key marker) ->
     `refuse:'deployed-unconfigured'`; else `direct`.
4. **Route all FOUR chokepoints** through `resolveJudgeLaunch` AFTER the armed guard: `direct` keeps the existing
   spawn (toolless pin retained); `cross-uid` spawns the returned `command,args` with the prompt on STDIN (no model
   / no extraArgs / no budget flag — the wrapper owns the recipe); `refuse` returns each site's native fail-closed
   shape (`{ok:false,reason}` / `{supported:false,fallback_reason}`). A `judgeLauncherFn` test seam mirrors the
   `actorLauncherFn` seam.
5. **Wrapper dispatch -> `case "$1"`** with fail-closed: `--loom-actor-version-probe) claude --version` (free, no
   key) | `--loom-judge-version-probe) export KEY; claude -p <TOOLLESS> --model M --output-format stream-json
   --verbose` | `--loom-judge) export KEY; claude -p <TOOLLESS> --model M` (PLAIN output) | `-*) echo unrecognized
   >&2; exit 2` (leading-dash fails closed, never falls to `--model`) | `*) export KEY; <existing actor model exec>`.
6. **custody-verify C5** — `gatherActorCustodyFacts` runs `crossUidJudgeProbeArgs` (an actual but cheap `-p` with `input:'hi'`),
   parses init `tools[]`, `assessActorCustody` adds a `C5-judgeless` check (PASS only on a parsed empty array;
   fail-closed on no-init / not-array / leaked / non-zero). C5 ALSO empirically confirms the wrapper is judge-aware
   (the Forward-Contract's out-of-band half). `--claude-bin`/`--node-bin` already required; C5 needs no new required flag.
7. **leg C + deriver toolless** — add `toolless`(+`maxBudgetUsd`) to `makeReferenceTeacher` + a `toolless`/extraArgs
   param to the deriver's `claudeOnce` + `makeLessonDeriver`; pin `toolless:true` at the canonical live leg
   (`earned-grounding`) + spikes. (Direct-path defense-in-depth; cross-uid already tool-less via the wrapper.)

### §9.3 Open questions for the §10 VERIFY board

- **Q1 (Forward-Contract signal):** is `LOOM_JUDGE_REQUIRE_UID_SEP` (a SECOND explicit operator flag, set only
  post-C5) the right judge-aware confirmation, vs reusing the actor's signals? (rationale: the runtime cannot probe
  the wrapper per-spawn; an explicit post-C5 flag is the honest mechanism; fail-closed if absent on a deployed box.)
- **Q2 (model DRY-drift):** the wrapper pins `--model claude-sonnet-4-6` (matching `DEFAULT_MODEL`/`JUDGE_MODEL`),
  duplicated in a shell artifact. Cross-ref comment + the C5 init-probe is the drift guard. Acceptable?
- **Q3 (budget cap lost in cross-uid):** the exact-set `--loom-judge` sentinel carries no `--max-budget-usd`; a
  runaway cross-uid judge burns the loom-actor key. Hardcode a conservative cap in the wrapper, or accept + name it?
- **Q4 (all four vs three):** §2 said "3 judge/labeler chokepoints"; §6 corrected the deriver to a LIVE 4th. Route
  ALL FOUR (consistent with PR-1)? Confirm the two refuse-shape variants.
- **Q5 (scope of the direct-path toolless pin):** §8 named leg C + the deriver. `earned-grounding` ALSO leaves leg B
  with friction un-pinned today. Pin all four legs there (small, consistent), or hold PR-2 to leg C + deriver?

## §10 PR-2 VERIFY board (3-lens, recorded 2026-06-24) + the FOLDED build contract

**Verdicts:** architect `APPROVE-WITH-NITS`, hacker `NEEDS-REVISION` (2 must-fix), honesty `APPROVE-WITH-NITS` (5 binding
conditions). Lean-B SURVIVES — no kill finding (architect: "the simplest sound design, symmetric with #412"; the
load-bearing close does NOT rest on a `claude -p` flag — the ADR-0012/LSP-leak class is avoided).

### MUST-FIX before/at build (premise-probed firsthand)

- **[hacker CRITICAL C1] wrapper `case "$1"` fail-OPENs an empty/whitespace `$1` into the tool-bearing actor arm.**
  REPRODUCED firsthand (`/tmp` `/bin/sh` probe): the spec'd `--loom-judge) | -*) exit2 | *) actor` lets `""`, `" "`,
  and `evil` fall to `*) --model "$1" --allowedTools Edit,Write`. **FOLD:** the wrapper actor arm is an EXPLICIT
  allowlisted-model match `claude-sonnet-4-6|claude-opus-4-8|claude-haiku-4-5) <actor exec>` with a fail-closed `*)
  echo unrecognized >&2; exit 2` default. Verified firsthand: `""`/`" "`/`-rf`/`evil`/`"model x"` ALL fail-closed;
  only the 3 models + the 3 sentinels dispatch. (This ALSO hardens the EXISTING merged actor wrapper, which has the
  same latent fail-open masked only by `crossUidActorArgs`'s validation — defense-in-depth at the wrapper layer.)
  Cross-ref `ALLOWED_ACTOR_MODELS` (`loom-actor-launch.js:28`); drift is fail-SAFE (a JS-ahead model -> wrapper `*)`
  -> fail-closed until re-deploy).
- **[hacker HIGH H1 / architect #3] deploy-ordering: old wrapper + judge-flag set.** `--loom-judge` into an OLD
  actor-only wrapper's `--model "$1"` slot. **FOLD:** (a) the C1 allowlisted-model arm means a stray `--loom-judge`
  can never reach a tool-bearing exec on the NEW wrapper; (b) the `--loom-judge` sentinel is dash-leading by design
  so an OLD wrapper's `--model "--loom-judge"` is rejected by claude (fail-noisy -> `judge-unavailable`); (c) the
  runbook REQUIRES custody-verify C5 green BEFORE the operator sets `LOOM_JUDGE_REQUIRE_UID_SEP`. C5 + the wrapper
  fail-closed dispatch are the load-bearing VALIDATE probes (NOT assertion-blessed).
- **[architect HIGH #1/#6/#2] single-home the launch polarity.** Extract `resolveCrossUidPresence({actorUser,
  wrapperPath, deployedSignal})` into the leaf `host-claude-guard.js` (returns `present|half-configured|
  deployed-unconfigured|clean`); BOTH `defaultActorLauncher` (refactor `trajectory-friction-run.js:48-63` to consume
  it — its truth-table test `:152-177` guards byte-identity) AND `defaultJudgeLauncher` use it. **architect #2 GAP
  CLOSED:** the judge `deployedSignal` set INCLUDES `LOOM_JUDGE_REQUIRE_UID_SEP` truthy, so judge-flag-set +
  presence-pair-UNSET -> `refuse:deployed-unconfigured` (never silent `direct` as 501).
- **[architect #4] model is a wrapper LITERAL, not a `$2` passthrough.** `crossUidJudgeArgs` args end EXACTLY
  `[-n,-u,user,wrapper,--loom-judge]`; the wrapper pins `--model claude-sonnet-4-6` as a literal.
- **[hacker M3 / honesty F5] C5 reuses `verifyToollessRuntime`'s EXACT init-`tools[]` ladder** (first-init-
  authoritative; fail-closed on no-init / not-array / leaked / non-zero) — NOT C3's weaker `{ran,exitZero}`.
- **[architect #8 / honesty F3 / Q5] `claudePJudge` gets a toolless seam too** (B superset A in the direct path — it
  is the one chokepoint with no tool-less inner layer today). Pin all four legs `toolless:true` at `earned-grounding`
  (the canonical live leg) + spikes.

### Q-answers (locked)

- **Q1:** `LOOM_JUDGE_REQUIRE_UID_SEP` is acceptable ONLY because a mis-set flag is forced fail-closed (the wrapper's
  C1 allowlist + the dash-leading sentinel + C5-as-runbook-gate); the flag itself proves nothing (honesty F4).
- **Q2:** wrapper-literal model (pull the recipe DOWN into the wrapper); the cross-ref comment is the SOLE model-drift
  guard — **C5 does NOT cover model drift** (it asserts `tools[]`, not the model — honesty F6 correction).
- **Q3:** hardcode a conservative `--max-budget-usd` LITERAL in the wrapper judge branch (non-overridable; the
  cross-uid path has no caller seam — `security.md` hard-constant-not-overridable-default).
- **Q4:** route ALL FOUR (the deriver is the confirmed live 4th; a routed-3/guarded-4 split leaves it as 501).
  Refuse-shapes: `{ok:false,reason}` (the three `claudeOnce`) + `{supported:false,fallback_reason}` (`claudePJudge`).
- **Q5:** pin all four legs at `earned-grounding` + add the `claudePJudge` seam.

### Claim-scoping folds (honesty F1/F2/F3/F4 — into shipped comments + the runbook, NOT just the plan)

- "structural close" -> "**structural ONCE the judge-aware wrapper is deployed + `LOOM_JUDGE_REQUIRE_UID_SEP` set +
  C5 attested**"; until then the box runs `direct` and the residual is held by the PR-1 armed guard + PATH-1 human
  gate + tool-less (NOT closed).
- "tool-less -> no host-action blast radius" -> scope to the ENUMERATED toolset; the load-bearing close is
  uid-separation, tool-less is the documented inner layer (enumerative-denylist residual per `claude-headless.js:17`).
- "C5 confirms judge-awareness" -> C5 confirms the PROBE sentinel branch is tool-less; the `--loom-judge` plain-output
  branch is proven by the operator dogfood (named residual). "611 cannot mint" is OS/sudoers-enforced + deploy-
  contingent (not "kernel-enforced" — honesty F2 nit).

### Carried to §5 VALIDATE live-probes (NOT blessed on assertion — Rule 2a)

- C1 wrapper fail-closed dispatch: drive the built wrapper body with `""`/`" "`/`-x`/`evil` -> exit 2 (never actor arm).
- Armed-window ordering at ALL FOUR sites: mocked-armed `isEmitArmedFn` -> BOTH `judgeLauncherFn` AND `spawnFn`
  uncalled (hacker M1 — assert the launcher-uncalled too, not just the spawn).
- cross-uid `claudePJudge`: `args===['-p']` + prompt on STDIN (never argv); a multi-line + fenced-decoy stdin ->
  fail-closed `parse-failure` (never decoy extraction).
- C5 `tools==[]` RED-fire: a stubbed leaked-tool init -> C5 FAIL; an un-probeable box -> C5 FAIL (non-vacuous).
- `crossUidJudgeArgs` throws on leading-dash actorUser / relative / `..` wrapperPath (-> caught -> refuse).

### Re-deferred (honesty F6, with reason)

- `verifyToollessRuntime` + `live-draft-dogfood.js legP` stay UN-gated by the armed guard: both spawn with the FIXED
  constant `'hi'` (never attacker text) so neither carries the §0 prompt-injection-to-mint vector. Allowlisted in the
  PR-1 CI invariant; gating them for the broader "no host `claude -p` while armed" intent is a NAMED future
  defense-in-depth, not a #430 requirement.

## §11 PR-2 VALIDATE board (4-lens, post-build @ `c7b5b09`) — result + folds

**Verdicts:** hacker `APPROVE` (11 attack classes, **0 bypasses** — the C1 wrapper fail-closed + the claudePJudge
stdin-normalize re-probed LIVE in the BUILT code per Rule 2a; 3 LOW nits all fail-safe), architect
`APPROVE-WITH-NITS` (build faithfully implements §9/§10; **`defaultActorLauncher` refactor confirmed byte-identical**;
no drift / no #428 regression), honesty `A / NO-OVERCLAIM` (all 8 §10 claim-scoping conditions honored in shipped
artifacts), code-reviewer `Warning` (1 HIGH + 1 MEDIUM + 2 LOW). No CRITICAL, no kill.

### FOLDED (premise-probed firsthand)

- **[code-reviewer HIGH] `runIssueCalibration` built its legs un-pinned.** The public live-run API
  (`calibration-issue-run.js`) constructed `makeBlindSemanticJudge`/`makeReferenceTeacher`/`makeFrictionLabeler`
  WITHOUT `toolless:true` (the earned-grounding pin missed this separate construction path). FOLDED — pin all three
  (the cross-uid path is tool-less via the wrapper regardless; this restores the direct-path inner layer).
- **[code-reviewer MEDIUM] `makeLessonDeriver` lacked `maxBudgetUsd` parity.** §9.2-7 said add `toolless(+maxBudgetUsd)`;
  only `toolless` landed. FOLDED — the deriver's `claudeOnce` + `makeLessonDeriver` now thread `maxBudgetUsd` (direct
  path appends `--max-budget-usd`); +2 unit tests.
- **[code-reviewer LOW] em-dash in the generated wrapper `echo` line.** The `*) echo ... refusing` em-dash lands a
  non-ASCII byte in the installed wrapper. FOLDED to `--` (ASCII). (`.sh` is not eslint-gated, but the runtime artifact
  is now ASCII-clean; the file's pre-existing comment em-dashes are left consistent with its style.)
- **[code-reviewer LOW] C5 NOTE comment inaccurate.** The gather ALWAYS produces a non-null `judgeProbe` (a build/spawn
  throw => `ran:false` => C5 FAIL, not NOTE), so the NOTE is programmatic-caller-only (mirrors C3). FOLDED — comment
  corrected.
- **[honesty LOW] inherited "kernel-enforced" wording.** PR-1 lines (`loom-actor-launch.js:8`, `loom-actor.md:35`)
  called the sudoers runas gate "kernel-enforced"; PR-2's own surfaces correctly say "OS/sudoers-enforced". FOLDED for
  consistency (both files were already in the diff). The commit/plan test-count corrected (C5/assessInitTools = 8).

### NOT folded (fail-safe / accepted at VERIFY — with reason)

- **[hacker L1] whitespace-`LOOM_ACTOR_USER` + flag => `half-configured`** (not `deployed-unconfigured`). Still a
  REFUSE (never `direct`/501) — a less-precise diagnostic reason, NOT a security hole. The hacker rated "no fix
  required."
- **[hacker L2 / architect] wrapper model-allowlist drift vs `ALLOWED_ACTOR_MODELS`** — fail-SAFE (a JS-ahead model
  hits `*)` => exit 2 until re-deploy) + documented cross-ref; accepted at VERIFY Q2 as the agreed guard.
- **[hacker L3] cross-uid budget cap is a wrapper literal** — the CORRECT hard-constant-not-overridable posture
  (`security.md`); the cross-uid path deliberately carries no caller arg.

### VALIDATE live-probes RUN (Rule 2a — all HELD)

The hacker BUILT + ran probes against the committed modules: the wrapper `case` dispatch (every garbage `$1` => exit
2; only the 3 models + 3 sentinels dispatch; `--loom-judge` genuinely tool-less), armed-window de-correlation at all
four (armed => neither launcher nor spawn reached), cross-uid argv (exactly `[-n,-u,user,wrapper,--loom-judge]`,
prompt on STDIN never argv), `crossUidJudgeArgs` injection (bad user/wrapper THROW => refuse), C5 non-vacuity (leaked
/ not-array / no-init / leaked-first all `{ok:false}`; a leaked/non-zero/not-run probe FAILs the verdict), a 672-combo
launcher env sweep (0 silent-501 holes), and the broker sudoers cross-check (611 cannot reach the broker). The
orchestrator independently re-confirmed the C1 wrapper fail-closed + the judge-vs-actor recipe split against the
generated wrapper body.

**Gate after folds:** kernel 105/0, lab 94/0, smoke 129/0, eslint + shellcheck + markdownlint clean,
SIGNPOST/doc-path/release-surface OK.

### §11.1 Pre-PR CodeRabbit lens (5 findings — ALL premise-probed firsthand + folded)

The VALIDATE-stage `coderabbit review --agent` (secret-free tree, run BEFORE the PR) returned 5 findings; all valid,
none false-positive — two were real gaps the 4-lens board under-weighted:

- **[major] resolver-throw was a SILENT fail-closed reject.** `resolveJudgeLaunch`'s `catch` returned
  `refuse:judge-launch-resolver-threw` with NO `emitEgressAlert` — the ONE refuse path without telemetry (the other
  three emit). `security.md`: a fail-closed security decision MUST be observable (same class as the #431 SCAR). FOLDED.
- **[major] typo-fails-OPEN in the deployed-signal.** A garbage `LOOM_ACTOR_REQUIRE_UID_SEP`/`LOOM_JUDGE_REQUIRE_UID_SEP`
  token (operator typo) on a presence-unset box ran `direct` (501) under the strict `normalizeBool` deployed-signal —
  contradicting the "a typo fails CLOSED" claim. The 4-lens hacker's 672-combo sweep used only VALID tokens, so it
  missed this. FOLDED via a new LENIENT `isDeployFlagSet` (any non-falsey token, incl. a typo, => deployed => refuse),
  while `normalizeBool` (STRICT) stays the cross-uid ENABLE gate. Both launchers single-home it. +tests (actor + judge).
- **[major] C5 trusted `toolsResult.ok` without verifying the array.** `assessActorCustody` is pure over arbitrary
  facts; a forged `{ok:true, tools:['LSP']}` would PASS. Tightened to require `Array.isArray(tools) && length===0`
  (#273 verify-don't-trust). +tests (forged toolsResult).
- **[major] `runCaptureRerun` dropped `maxBudgetUsd`.** The public driver built the deriver without threading the cost
  cap (the MEDIUM fold was incomplete). FOLDED.
- **[minor] `normalizeBool` coerced a boolean to false.** Added a boolean passthrough. FOLDED.

Re-gate after the CodeRabbit folds: kernel 105/0, lab 94/0, smoke 129/0, eslint clean (routing test 33/0,
custody-verify 28/0, friction 15/0). **The async-bot-gate held: the green pre-review status was not trusted — the
findings surface was read + every finding premise-probed before folding.**
