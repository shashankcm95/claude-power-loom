# Beta-Readiness Checklist — the gate before the live external-PR beta

**Purpose (drift-guard):** these are the items that MUST be resolved before Power Loom touches the live
external-PR beta (③.2.3). This doc is the canonical tracker so we do not drift onto beta work while a
BLOCKER is open. Each item is a GitHub issue; this doc is the index + the honest "where we stand."

**Rule:** no real external PR (③.2.3) until every **BLOCKER** below is closed. The MAJOR items are
SHADOW-tolerable to *start* ③.2.3 (the grade/loop stay advisory under PATH-1) but must be measured during it.

> Status note (2026-06-23): this checklist supersedes the stale "5c unbuilt / armedEmit throws" framing in
> the older `phase-3.2-live-beta-arc` memory topic + ROADMAP. **Firsthand-corrected reality below.**

## Where we stand (firsthand-probed 2026-06-23)

- **The egress machine is COMPLETE and the network path is PROVEN live.** ③.2.5c is merged (#402); `armedEmit`
  delegates to `gh-emit` (`return ghEmit(...)`, [emit-pr.js:322](../../kernel/egress/emit-pr.js)) — it does NOT throw.
  The own-repo egress dogfood (#403, since closed) emitted a real gated DRAFT PR with a byte-faithful post-image.
- ③.0 foundation · ③.1 dry-run · Router-V2 — phase-closed. ③.2.0–③.2.5c — merged, SHADOW.
- **PATH-1 holds:** the human is the sole gate; every lab weight stays SHADOW (no production consumer of
  `verifyMintedWeight`). Mechanics-freeze declared (③.2.3); persona state is wipeable / fresh-install clean-slate.
- **The cross-uid loom-broker is BUILT but NOT DEPLOYED** (no `loom-broker` user, no `/etc/loom`, no sudoers —
  probed firsthand; uid 600 is PACT's `pact-broker`, a different trust domain). So the signed approval is
  INTEGRITY-only today; the human-gate is not yet a real authorization boundary.

## The gate (must close before ③.2.3)

| # | Item | Severity | Issue | Status |
|---|---|---|---|---|
| 1 | Deploy the cross-uid loom-broker (provenance follow-on) — deploy helper + operator deploy + custody-verify + re-dogfood | **BLOCKER** | [#404](https://github.com/shashankcm95/claude-power-loom/issues/404) | ▶ in progress |
| 2 | `gh-emit` modify-diff post-image applier (new-file-add only today) | **BLOCKER** | [#405](https://github.com/shashankcm95/claude-power-loom/issues/405) | queued (after #404) |
| 3 | ③.2.3 the first real EXTERNAL PR (the launch gate) — depends on #404 + #405 | **BLOCKER** | [#406](https://github.com/shashankcm95/claude-power-loom/issues/406) | blocked |
| 4 | OQ-21 — calibrate the real-LLM judge on live stranger code | MAJOR | [#407](https://github.com/shashankcm95/claude-power-loom/issues/407) | open (measure during ③.2.3) |
| 5 | Measure K13 close-path lock contention at real spawn scale | MAJOR | [#408](https://github.com/shashankcm95/claude-power-loom/issues/408) | open |
| 6 | Reconcile actor-clone W1/W2 path divergence (size-cap + maxBuffer) | MAJOR | [#409](https://github.com/shashankcm95/claude-power-loom/issues/409) | open |
| 7 | Verify the LSP-tool-leak fix (#396) in a REAL actor-in-container runtime | MAJOR | [#410](https://github.com/shashankcm95/claude-power-loom/issues/410) | open |

## Explicitly NOT gating (so they don't re-surface as drift)

- **A maintainer MERGE** is the only OQ-NS-6 trust *hardener* — but it is an EXTERNAL, unschedulable outcome,
  not a task we resolve. The deliverable is the armed machinery + the user-pushed PR; the merge is the signal.
- **P2 (the signed-edge reader) + the two-axis weight lane** are DEFERRED-by-design under PATH-1 (no lab weight
  gates an action). They become required only at the named trigger "a lab weight first GATES" — a future phase.

## Sequence

1. **#404 provenance follow-on** (in progress) — makes the human-gate a real authorization boundary.
2. **#405 modify-diff applier** — makes a real (non-trivial) good-first-issue emittable.
3. **#407–#410** measured/closed (can overlap with #406 since the grade/loop are SHADOW).
4. **#406 the first real external PR** — only once #404 + #405 are closed.

## Phase

Created 2026-06-23, immediately after the ③.2.5c egress-arming arc + the own-repo first-egress dogfood.
