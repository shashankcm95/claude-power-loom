# Power Loom — Product Requirements Document

**v0.1 · 2026-07-04**

> A fault-tolerance layer for probabilistic software engineering: an autonomous SDE that fixes a real
> external issue and earns a real maintainer's merge, where **no self-assertion by the machine — however
> fluent or well-tested — can launder itself into trust**. Only a world-anchored merge hardens the loop.

| Field | Value |
|---|---|
| Current phase | **③.2 LIVE-BETA** — the fork→cross-repo-PR mechanism is complete; every lab weight is SHADOW |
| Mode | **SHADOW** — every score/weight is advisory; nothing gates an irreversible action |
| Trust-hardening signals | **1 world-anchored external merge** (spec-kitty#2137, merged by an independent maintainer 2026-06-25) |
| Anchor of record | this PRD (PM view) defers to [`north-star`](../packages/specs/rfcs/2026-06-11-north-star-autonomous-sde-trust.md) for the deep, amend-deliberately invariants |
| Build state | 3-tier substrate (kernel / runtime / lab) built + coherent; `bash install.sh --hooks --test` + the kernel suite are the pre-push gate |

> This PRD is the blueprint **anchor** (what / why / principles / phase order). It sits above the per-wave
> task lists ([`packages/specs/plans/`](../packages/specs/plans/)) and the decision records
> ([`docs/ADRs/`](ADRs/) bridging [`packages/specs/adrs/`](../packages/specs/adrs/)), and defers to the north
> star for the load-bearing invariants. Keep it **true**: when a phase reveals reality has diverged, the fix is
> a dated update *here* (or an amendment to the north star), so the anchor never goes stale.

## 1. The problem

An LLM writing software is **probabilistic**: a fluent, confident, fully-tested patch can still be subtly
wrong, and a green test suite is a *hypothesis about the path it mocks*, never proof the real path works. The
open problem is not "can a model write a fix" — it demonstrably can — but **"can anyone trust the fix without
a human re-doing the work."** Today the answer is no: the machine's own signals (its judges, its test runs,
its self-assessment) are all self-asserted, and a self-asserted signal can be gamed, over-fit, or simply wrong
in a way no internal check catches. Trust that rests on the machine grading itself is trust that launders
self-assertion into legitimacy.

## 2. Vision

**Divide the labor of trust.** The machine bears *mechanical certainty* (the fix is self-consistent, contained,
non-bypassing, provenance-tracked); a **real external human** bears the *trust-burden* (an independent
maintainer merging the fix into their own repo is the only signal that hardens the loop). Power Loom gates the
*seams* of the autonomous-SDE pipeline — it does not replace the model doing the work. The apex event is an
**external maintainer merging an autonomously-delivered PR**; every internal signal below that is advisory until
a world-anchored merge confirms it.

**The trust fractal.** The same shape repeats at every level: a claim is untrusted until *disjoint, human- or
world-accountable* evidence confirms it. A judge's verdict, a persona's reputation, a lesson's weight — each is
SHADOW until an out-of-band anchor (a merge, a signed attestation from an authenticated minter) grounds it.

## 3. Goals & non-goals

**Goals**

- Take one real external GitHub issue and deliver a draft PR through the full pipeline (classify → materialize a
  persona → contained solve → grade → capture → emit), end to end.
- Make the apex signal *real*: an external maintainer's merge, world-anchored, is the only thing that hardens a
  weight from SHADOW toward live.
- Keep every mechanism **fail-closed and observable** — a rejected security decision must surface, not silently
  return `{ok:false}`.
- Keep the human the sole gate for every irreversible or outward-facing action until a world-anchored signal
  earns the lift (PATH-1: human-sole-gate).

**Non-goals**

- Replacing the LLM's engineering judgment, or claiming the machine's own signals are trustworthy on their own.
- Auto-merging, auto-arming, or letting any actor-controlled text reach a privileged path.
- Hardening trust from a backtest or engineered signal — **OQ-NS-6: a backtest narrows; only a world-anchored
  merge hardens** (see the north star).

## 4. Principles (load-bearing)

1. **SHADOW by default.** Every lab weight is advisory; nothing gates an irreversible action until an authenticated,
   world-anchored signal earns the lift. The mechanism ships first, dark and byte-identical, behind an operator arming flag.
2. **Integrity is not provenance.** A store that verifies a record on read proves it is self-consistent, never that
   the legitimate producer made it; a trust input needs an authenticated minter, never a store re-hash (the #273 family).
3. **The human gate is load-bearing, with evidence.** The internal judges *advise*; they do not catch. A clean mock
   suite is a hypothesis; a live dogfood on the real path gates any "it works" claim.
4. **Fail closed, and be observable.** A privileged flag parses asymmetrically (a typo fails closed); a fail-closed
   decision emits a signal, so an attack and a misconfiguration are both visible.
5. **The operator, not the machine, arms the live path.** Claude never sets an arming flag, touches deploy paths, or
   runs the cross-uid signer — those are operator-only.

## 5. Where we are (dated status — keep true)

- **③.2 LIVE-BETA.** The `fork → cross-repo PR` mechanism is complete and merged, **all SHADOW/dormant** (the fork
  target is never populated; egress is gated OFF). The single-issue entry point `live-solve-one` ships (issue →
  SHADOW draft PR, dry by construction).
- **First world-anchored merge:** spec-kitty#2137 (manual fork PR, merged by an independent maintainer 2026-06-25) —
  the apex signal exists once; autonomous delivery of that signal is under build.
- **Open frontier:** Part B (the SHADOW→LIVE crossing, deploy-gated + held per-step) and the authenticated
  edge-minter that closes #273. The autonomous-SDE lifecycle gap-map (below) is mechanism-complete through item-8
  Part A, all SHADOW.

## 6. Roadmap (phase order — the anti-drift spine)

The operative charter is [`packages/specs/plans/2026-06-10-combined-roadmap.md`](../packages/specs/plans/2026-06-10-combined-roadmap.md);
the destination is the [north star](../packages/specs/rfcs/2026-06-11-north-star-autonomous-sde-trust.md). Phase task-lists +
their VERIFY/VALIDATE folds live under [`packages/specs/plans/`](../packages/specs/plans/); live status is
[`docs/ROADMAP.md`](ROADMAP.md). The autonomous-SDE lifecycle is a dep-ordered ladder:

| Rung | Item | State |
|---|---|---|
| 1–3 | egress join-key → merge-observer → live-lesson mint | mechanism-complete, SHADOW |
| 4 | issue → persona materializer | SHADOW (`LOOM_PERSONA_MATERIALIZE` off) |
| 5 | authenticated edge-minter (closes #273) | open — deploy-gated cross-uid signer |
| 6 | reputation / breaker spawn-select | SHADOW |
| 8 | world-anchored weight → recall HARDEN gate | Part A complete (SHADOW); Part B held per-step |

**New rungs surfaced by the ③.2 live dogfooding (not yet scheduled) — see [`docs/phases/`](phases/):**

- **Intake gate:** pre-check that a candidate repo *accepts external PRs* (interaction limits / collaborators-only)
  before investing in a solve. A collaborators-only repo can never produce the apex merge signal.
- **Review-feedback loop:** ingest an external PR review back into the persona (revise → re-push). Today only the
  *merge* boolean flows back; a review comment has no ingestion path.
- **Disposal:** a candidate that never merges is retained only as an inert pending artifact; an explicit
  disposal/GC policy for dead-ends is unbuilt.

## 7. Success criteria

- An autonomously-delivered PR is merged by an external maintainer, world-anchored, with the whole lab track honest
  and SHADOW until that merge.
- Every irreversible action stayed behind the human gate; no actor text ever reached a privileged path.
- The mechanism was proven internally (real-path dogfood, multi-lens adversarial review) *before* it was called done.

## 8. Defers to the north star

The deep, amend-deliberately invariants — the trust fractal, OQ-NS-6, the enforcing-vs-advisory ceiling, the
`#273` authenticated-minter requirement — live in the [north star](../packages/specs/rfcs/2026-06-11-north-star-autonomous-sde-trust.md).
This PRD is the PM-view anchor; when a decided direction changes, amend the north star with a dated rationale and
record an ADR — never let the build quietly diverge from the anchor.
