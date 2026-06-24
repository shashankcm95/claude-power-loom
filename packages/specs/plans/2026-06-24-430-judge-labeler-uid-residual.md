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
