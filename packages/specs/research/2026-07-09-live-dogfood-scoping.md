# 2026-07-09 — Live external-repo dogfood: scoping synthesis

> Scoping doc (not yet a build plan). Synthesizes a grounded recon of the
> `live-solve -> emit -> external-merge` pipeline into a **rung ladder** for the
> north-star milestone: a live end-to-end dogfood that drives toward a real
> maintainer merge (the only signal that HARDENS trust, OQ-NS-6). Produced after
> the persona-depth arc (the last pure-internal build). Recon: one deep grounded
> lens (`live-solve-pipeline`, all facts `file:line`-cited + `verified:true`) plus
> direct confirmation reads of the egress chokepoint and the north-star RFC.

## The apex + the binding law (grounded)

- **Apex (RFC Side A, line 109):** *"External maintainer merges our PR"* — the only
  signal that is both **world-anchored** and **adversarially independent**.
- **OQ-NS-6 (RATIFIED 2026-06-11, binding law, RFC line 380):** the solve/grade/draft/emit
  stack only **NARROWS** trust; **HARDENING** comes ONLY from a world-anchored merge —
  *"external maintainer, **or the USER**."* The "or the USER" clause is load-bearing for
  target selection (see Rung 1).
- **Honest-gap-1 (RFC line 304):** the apex signal is *slow, sparse, noisy* — merges take
  days-to-weeks; good PRs die for reasons unrelated to quality. **The plan CANNOT promise a
  merge.** Claude drives up to emit + engagement; the merge is the world's verdict.

## Current state (grounded, `file:line`-cited)

**The solve -> stage-draft half is dogfood-ready NOW (runs LIVE, shadow-dry egress):**

- Entry: `node packages/lab/persona-experiment/live-solve-one.js <owner>/<repo>#<issue>
  [--materialize --model --max-budget-usd --json]`
  ([live-solve-one.js:10-16,154](../../lab/persona-experiment/live-solve-one.js)).
- Pipeline: `parseTarget -> fetchOneIssueRecord` (real `gh` reads; hard-refuses a non-PR-capable
  repo, non-permissive license, or a PR-number) `-> runLiveDraftLoop`
  ([live-puller.js:333-379](../../lab/issue-corpus/live-puller.js)).
- The solve is a **real Docker-contained `claude -p`**: `prepareClone -> runActorInContainer ->
  captureActorDiff`; fatal without an actor key + attested containment
  ([live-draft-run.js:112-150](../../lab/persona-experiment/live-draft-run.js)).
- Classify (`issue-classifier.js`), tool-less blind grade, weight-inert lesson capture, then
  `emitFn(data, {})` **with empty opts** -> killswitch reads ON -> no token -> `emitted:false`.
  **Shadow-dry by construction** — no argv/env can arm from the CLI
  ([live-draft-run.js:338](../../lab/persona-experiment/live-draft-run.js);
  [emit-pr.js:358-369](../../kernel/egress/emit-pr.js)).

**The emit -> external-mergeable-PR half is operator-gated and (for strangers) partly unbuilt:**

- `isKillswitchOn` returns true unless a **custody-owned ARM file** holds the literal `ARMED`
  token; the live seam `armedEmit -> gh-emit` is otherwise real
  ([emit-pr.js:358-365](../../kernel/egress/emit-pr.js)). A live emit needs killswitch-off +
  custody token + disposition `live` + a **valid signed human approval** (`isEmitArmed`).
- **Same-owner emit** (a repo the custody identity owns) is **BUILT** behind that gate
  (③.2.5c flipped the throw to a real DRAFT-PR creation). No fork path needed.
- **Cross-repo / stranger emit** needs the **fork path**: F-W1/W2/W3 machinery is built but
  **DORMANT** (`isForkMode` is always false in production — `emitPR` never populates `forkRepo`),
  and **F-W4 is UNBUILT** — `OBJECT_SHARING_PROBE_RECORDED = false` is a hard kernel constant and
  `armedEmit` **fail-closes on any populated `forkRepo`**
  ([emit-pr.js:469,500-503](../../kernel/egress/emit-pr.js);
  [gh-emit.js:469-473](../../kernel/egress/gh-emit.js)).

**The colophon#27 lesson (the first live-issue dogfood):** ran end-to-end SHADOW/dry ($0.39),
solved in-container, but hit a **collaborators-only wall** (schmug/colophon restricts PR creation
to collaborators — invisible pre-submit; `interaction-limits` is admin-only 403). The internal
blind judges **refused** (deployed-unconfigured) and caught nothing; a **human** produced the
correct fix. Two durable lessons:
1. **Target must accept external contributions** — the strongest readable signal is
   `hasExternalMergeHistory` (has the repo ever merged an external-contributor PR? colophon: 0
   all-OWNER; spec-kitty: 5). Currently SHADOW/advisory
   ([live-puller.js:210,227-236](../../lab/issue-corpus/live-puller.js)).
2. **Grade-oracle gap** — without a configured out-of-band oracle the pipeline cannot autonomously
   self-verify a diff before emit.

## The rung ladder (recommended shape)

| Rung | What | Merge HARDENS? | New build? | Operator arming? | Reachable |
|---|---|---|---|---|---|
| **0** | Keep running SHADOW `live-solve-one` dogfoods on real mergeable stranger repos | no (shadow) | none | none | **now** |
| **1** | Live emit to a **USER-owned** repo; the USER merges | **yes** (OQ-NS-6 "or the USER") | **none** — same-owner emit is built | killswitch + custody + approval (operator) | **now, on operator arming** |
| **2** | Live emit to a **stranger** upstream; an external maintainer merges | **yes** (full apex) | **F-W4 fork path** + review->revise loop | fork-bot PAT + F-W4 probes + arming | deferred (build-when-arming) |

**Rung 0** is free friction-finding and already proven (colophon surfaced the three world-contact
rungs that mock suites could not). Keep it running regardless of the rung-1/2 choice.

**Rung 1 is the minimal viable apex and needs NO new build** — only operator arming of the
same-owner emit. It is the FIRST live exercise of the egress emit path against real GitHub (③.2
egress has been "done-DARK" — built + unit-proven but never run live). Honest caveat: a USER-merge
is world-anchored but of **lower adversarial-independence** than a stranger maintainer; it is a
ratified hardening signal, but the full apex (a stranger merge) remains Rung 2.

**Rung 2** is the far milestone. Per the USER's build-when-arming posture (2026-07-08: build the
authenticated minter / arming mechanism WHEN arming, not speculatively), **do NOT build F-W4 until
committing to a stranger dogfood.**

## End-to-end flow — actor split (Rung 1, the recommended first real merge)

| # | Step | Actor | Mechanism | Status |
|---|---|---|---|---|
| 1 | Select a USER-owned repo + a real, self-contained issue | claude + user | issue triage | needs user pick |
| 2 | Fetch + classify + contained solve + grade + stage draft | **claude** | `live-solve-one <owner>/<repo>#<issue>` | **live (shadow-dry)** |
| 3 | Present the diff for review | **claude** | draft artifact + diff | live |
| 4 | Review the diff; arm killswitch (custody ARM file) | **operator** | custody ARM file = `ARMED` | needs-arming |
| 5 | Pin custody GH token + disposition `live` | **operator** | custody token path | needs-arming |
| 6 | Sign the human approval binding {repo, issueRef, diff} | **operator** | `approve-cli.js` | needs-arming |
| 7 | Run the armed same-owner emit -> real DRAFT PR opens | **operator** | armed-emit entry (non-empty opts) | built, needs-arming |
| 8 | The USER merges the PR | **world (user)** | GitHub merge | **external — the hardening signal** |

**Claude's autonomous boundary:** steps 1-3 (select, solve, stage, present). Everything from step 4
(arming) onward is operator/world. **Claude NEVER touches `/etc/loom` or `/opt/loom`, sets an arming
flag, writes the killswitch ARM file, or runs `--attested-cross-uid`** (task_d722450d).

## Operator arming checklist (read-only description — Claude never executes)

For **Rung 1** (same-owner, no fork path):
1. Review Claude's staged diff for correctness.
2. Write the custody-owned killswitch ARM file with the literal `ARMED` token (disarm).
3. Pin the custody GitHub token + set disposition `live`.
4. Sign the human approval at the `approve-cli.js` gate (binds {repo, issueRef, diff}).
5. Run the operator armed-emit entry (the path that passes non-empty custody opts to `emitPR`).

Additional for **Rung 2** (stranger upstream):
6. Provision a dedicated throwaway fork-bot account + a **classic `public_repo` PAT** (fine-grained
   PAT and GitHub App tokens **cannot** open a cross-repo PR to an unowned upstream).
7. Run the operator-gated F-W3/F-W2 live probes on a throwaway sandbox; record the object-sharing
   probe result; then Claude builds + the operator arms **F-W4**.

## Blockers (ranked)

| Sev | Blocker | Resolution |
|---|---|---|
| HIGH | Operator arming not done (killswitch/custody/approval) — gates ALL live emit | operator arms (Claude never does) — gates Rung 1 + Rung 2 |
| HIGH (R2) | F-W4 fork path unbuilt + fork-bot token unprovisioned | build F-W4 + provision PAT **when** committing to a stranger dogfood; N/A for Rung 1 |
| MEDIUM | Grade oracle: internal judges refused unconfigured (colophon) -> no autonomous self-verify | Rung 1: the USER is the reviewer (human covers it). Full autonomy: configure an out-of-band oracle |
| MEDIUM (R2) | No review->revise loop (Gap-8 SHADOW/gates-nothing; `emitPR` create-only, no re-push) | Rung 1 tolerates first-shot merge. Build the revise loop before scaling to strangers |
| HIGH (R2) | colophon-class collaborators-only wall (invisible pre-submit) | `hasExternalMergeHistory` target signal; N/A for Rung 1 (user owns -> can always merge) |

## Trust-hardening truth (OQ-NS-6, plainly)

The entire solve -> grade -> draft -> emit stack **only NARROWS** trust. **HARDENING comes ONLY
from a world-anchored merge** (external maintainer, or the USER), post-PR. This plan cannot promise
a merge (honest-gap-1). The first reachable hardening signal is a **USER-merge on a USER-owned repo
(Rung 1)**; the full adversarially-independent apex (a stranger maintainer merge) is **Rung 2**.

## Decisions for the USER

1. **First move** — Rung 1 (a first real hardening merge on a USER-owned repo; operator arms the
   same-owner emit now, no new build), keep Rung 0 shadow-only for now, or commit to Rung 2 (build
   F-W4 toward a stranger merge)?
2. **If Rung 1** — which USER-owned repo + issue? (A real, self-contained bug/feature in a repo you
   control.)
3. **Arm now vs stay shadow** — are you ready to do the operator arming (steps 4-7), or keep
   everything shadow this session?

## Recommendation

**Rung 1 on a USER-owned repo**, with Rung 0 continuing as free friction-finding. It is the minimal
viable apex, needs no new build (only operator arming), and is the first live exercise of the egress
path against real GitHub — exactly the mock-vs-real gap where bugs hide. Defer F-W4 / Rung 2 until
you choose to cross the stranger Rubicon (build-when-arming). Claude drives select + solve + stage +
present; you arm and merge.
