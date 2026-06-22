---
rfc_id: north-star-autonomous-sde-trust
title: "The North Star — Power Loom as a fault-tolerance layer for probabilistic software engineering"
status: DRAFT — captured from the 2026-06-11 USER design conversation; pending USER ratification + a verify panel
created: 2026-06-11
author: orchestrator + USER (design conversation, 2026-06-11)
amends: nothing — this is the DESTINATION; the combined roadmap stays the operative charter and derives toward this
supersedes: null
related:
  - packages/specs/plans/2026-06-10-combined-roadmap.md            # the operative charter (derives backward from this)
  - packages/specs/plans/2026-06-10-predictive-persona-program.md  # the lesson/calibration loop this RFC anchors to a real signal
  - packages/specs/rfcs/v6-substrate-synthesis.md                  # the blueprint (mechanisms); this RFC is the WHY
  - packages/specs/rfcs/2026-06-04-enforcing-vs-advisory-identity.md # the human-gated ceiling; this RFC says when it lifts
  - docs/ACTIVATION-LEDGER.md                                      # producer-consumer phasing + the evidence ledger
lifecycle: persistent
---

# The North Star — a fault-tolerance layer for probabilistic software engineering

> **Status note.** This is a vision/north-star RFC — the destination, captured so the roadmap can be
> derived backward from a written target instead of from a chat thread. It states the WHY the mechanisms
> serve, and it **proposes** a re-scoping of two spine kickoffs (v3.7 + v3.9) that must be routed
> through the charter's own gate — it does NOT unilaterally re-sequence the ratified spine (a 2026-06-11
> adversarial panel corrected an earlier "introduces no new mechanism" over-claim; see the Verification
> record). Several of its mechanisms are **net-new and unbuilt** — flagged inline. DRAFT pending USER
> ratification of the open questions + the corrections folded 2026-06-11.

## Status update (2026-06-22) — the "ContainerAdapter unknown" framing below is superseded

Two things landed AFTER this 2026-06-11 capture, so the ContainerAdapter references in this RFC
(§Principle 6; §"What this RFC does NOT claim"; the breaker/promotion deferrals at the lines marked
`[UPDATE 2026-06-22 …]`) read as more open than they now are:

- The "real sandbox" this RFC calls an unbuilt wall **is built + containment-attested** — the Docker
  backend behind the ContainerAdapter seam (#346, real fs/net/proc isolation) and the write-isolated
  actor sandbox (#391 / ③.2.2b, host-write confinement attested via a `/proc/self/mountinfo` oracle plus
  a live escape probe).
- The "harness-wrap go/no-go **unknown**" is **resolved**: a `claude -p` agent runs write-confined in a
  container, proven this arc (the v3.9 RFC had deferred any live-repo WRITE path to v4.x; it shipped early).

**Still future — by design, not unbuilt:** the *autonomous-promotion wiring* that lifts the human from
the loop (v4.x; ③.2 is human-sole-gate), and R13 (the network-enforcer *beyond* default-deny, v4.x). So
read the ContainerAdapter references below as **"the containment machinery exists + the unknown is
answered; only the autonomous USE of it is deferred."**

## Problem statement

The industry wants agents to do software engineering, and the two common bets both fail the same way:
a single prompt "builds the app," or a swarm of agents converse until an answer emerges. Both
**amplify** error — each agent's small mistake convolves with the next until the aggregate is
unreliable. Human organizations do not work like this. Shipping production code is wrapped in process
(review, ownership, staged promotion, track record) refined over decades. Per DDIA, those systems are
not *truly reliable* — they are **fault-tolerant**: unreliable components (flaky disks, lying nodes,
partitioned networks) composed into a system whose *aggregate* behavior is trustworthy. The reliability
is engineered at the **system layer**; the components never stopped being unreliable.

**The agent is the unreliable component.** A probabilistic model is a disk that returns the right bytes
most of the time and plausible-but-wrong bytes some of the time, with no parity bit of its own. You
cannot make it reliable — that is its design, not a maturity gap. So Power Loom is the DDIA
fault-tolerance layer, but for a *stochastic actor* instead of a flaky disk: gates are checksums,
blast-radius containment is bulkheads, reputation is the track record that sets the replication factor,
the human merge is the quorum commit.

## Thesis: the management layer is permanent, not scaffolding

The obvious objection is "won't a better model make this obsolete?" It will not, and the reason falls
out of the framing: **reliability is a system property, not a component property.** A better disk still
goes in a RAID array. Even at the AGI limit a model is a blob of *all possible* actions, not
specialized to *this* company's context — and two identical tokens mean different things in different
contexts, so a disambiguation-and-containment layer is needed at every capability level. The model
improving does not remove the need for the management layer; it only **moves the trust thresholds**
(how much the system reviews before it trusts). Power Loom is therefore a durable product, not a
stop-gap until models get good.

## The architecture has two sides of one curtain

### Side A — the external signal (the apex of correctness)

The truest signal of correctness is **a PR we generated being merged by a maintainer who has no stake
in Power Loom.** It is the only signal that is *both* world-anchored *and* adversarially independent —
it breaks, in one stroke, the N=1 self-grading circularity, the same-model-confirmation trap, and the
"we graded our own homework" bias. This yields a **signal hierarchy by independence** (an explicit
ordering on what may harden a belief — the sharpened form of the predictive-persona world-anchoring
law, `INV-28-WorldAnchoredHardening` — cite the FULL name; "INV-28" alone collides with v6's locked
`INV-28-K13K14SerialClosure`, a number clash flagged for renumbering before either ships as enforced):

| Signal | World-anchored | Independent of us | Use |
|---|---|---|---|
| Model self-assessment / model-vs-model agreement | no | no | **forbidden as a hardening source** (same-prior confirmation) |
| Tests pass | weak (gameable) | no | low |
| USER (maintainer-operator) merges our PR | yes | no (invested in the system) | strong |
| **External maintainer merges our PR** | **yes** | **yes** | **apex** |
| Orchestrator absorbs an agent's commit into the PR | partial | no (same-system judgment) | **intermediate (internal)** |
| 3-lens review verdict | no (model-on-model) | no | weakest — narrows, never hardens |

**Cold-start MITIGATION (partial; panel-corrected — it does not "resolve").** The intermediate internal
signal lets reputation *begin accruing* before any external merge — but it may only NARROW, never harden
(see Fractal trust). So on a brand-new project the first persona runs at **FULL rigor** (unproven =
full 3-lens, NOT ungated) until world-anchored signal accrues — early on the system is *more* expensive,
not less. The unconditional win at cold-start is **amplification-control** (the thin-PM bulkhead, which
needs no track record); "the human gets freed" is the *lagged* reward, earned from the apex signal.

### Side B — the internal factory (this side of the curtain)

On an inbound issue, the substrate runs a staged pipeline — **almost every stage already has a
primitive**; the few new pieces are noted:

1. **Intake** (NEW): understand the problem statement + repo structure; solidify requirements.
2. **Architect** -> implementation doc -> review (`/build-plan` + `/verify-plan`).
3. **HETS personas** (agent-team + persona 3-layer + identity registry + E4/A6 reputation), each
   working **atomically in its own branch** (worktree isolation + `stage-candidate` candidate refs),
   under review rigor scaled by reputation (see Fractal trust).
4. **Orchestrator** orders dependent spawns (DAG decomposition) and acts as a **thin PM** (see below).
5. **Assemble** -> the human-mergeable PR (`integrator` -> `loom/integration`).
6. **Merge signal** (NEW observability): on external merge, solidify memory + promote reputation; on
   correction/rejection, retrace (see below).

### The thin-PM bulkhead (the answer to amplification)

The orchestrator must **never ingest each agent's full reasoning** — it sees **diffs + verdicts, not
context.** That is the bulkhead that stops an agent's confusion from convolving into the orchestrator's
judgment (the amplification failure that kills the naive swarm). Decisions are made at **commit
granularity**: the orchestrator verifies a commit's diff ("is this what we want") and absorbs or
rejects it as a *unit* — never picking *within* a commit (line-level cherry-pick re-imports the bloated
context and produces a "Frankenstein" PR of hallucinated chunks). **Commits-absorbed / commits-produced
per agent** is the graded internal reputation signal.

## The absorb decision is a STACK of narrowing filters (filtering != hardening)

"Absorb this commit" is not one judgment — it is a stack, and the BUILT integrator implements only
**Layer 0**. It is the senior-engineer move made explicit (CI-green + read-the-diff + addresses-the-ticket):

| Layer | The judge | Catches | Runs on | Built? |
|---|---|---|---|---|
| 0 mergeability | the integrator (`merge-tree`) | textual conflict | per-candidate | YES — all "absorb" means today |
| 1 build/test gate | the project's own tests | cross-file / semantic incoherence | the ASSEMBLED tree | NO — OQ-NS-7; safe-exec-gated |
| 2 reviewer verdict | a `code-reviewer` persona on the diff | per-commit quality tests miss | per-candidate | machinery exists (`verification-policy.js` / 3-lens) |
| 3 coverage | requirement -> commit reconciliation | incompleteness (silent drop) | the assembled set | NO — needs intake |

**The load-bearing separation (the C1 clarity): filtering != hardening.** The stack decides WHAT enters
the PR — it runs every time and only **NARROWS**. **HARDENING** (earning reduced scrutiny / autonomy)
comes ONLY from the world-anchored merge (OQ-NS-6), post-PR. A quality gate makes the PR *better*; it
NEVER lets an agent earn a skip. C1's bug was treating the absorb-FILTER as a HARDENING signal — they
are orthogonal. So "absorb = clean-merge" is unalarming: clean-merge is the WEAKEST filter layer, and
the REJECT events (real structural failures) are the meaningful kernel-attested signal.

**The filter is the fault-tolerance pattern recursing:** the reviewer persona (Layer 2) is itself an
unreliable component, so it is a FILTER not an oracle — stack several (the 3-lens) for recall, DDIA
redundancy one level down. It never becomes truth; it raises the odds bad work is caught before the
human, who + the external merge remain the judges.

**Phasing (the layering IS the phasing):** v3.7 = **Layer 0** (the reject-event ledger; mechanical; the
breaker's denial source). **Layer 2** (reviewer-verdict absorb-filter) reuses `verification-policy.js`
-> v3.8-ish, narrows-only. **Layer 1** (build/test gate) is safe only on CONTROLLED projects (the beta)
or behind the ContainerAdapter for untrusted ones. **Layer 3** (coverage) is post-intake. None harden.

## Reconciliation — a rejection is an obligation, never a silent drop

When the orchestrator absorbs some commits and rejects others, the rejected work represents requirement
pieces that are now unmet. Dropping them silently yields **silent incompleteness** — a partially-done
task that *looks* done. Two distinct failure modes hide here:

- **Mechanical incoherence** (an absorbed commit depended on a rejected one) is **only PARTIALLY**
  auto-caught (panel BREAKS finding, 2026-06-11): the integrator deterministically quarantines a
  TEXTUALLY-OVERLAPPING conflict — but a **cross-file or non-overlapping semantic dependency merges
  CLEAN** (probed: a caller importing a never-merged helper, or referencing an undefined symbol, yields
  a clean merge-tree + a runtime `ImportError`/`NameError`, NO quarantine). So this is **NOT** "no new
  mechanism" — cross-file/semantic dependency MUST be caught by a **NEW build/test gate on the assembled
  tree** (OQ-NS-7). Textual overlap is the only free deterministic catch.
- **Semantic incompleteness** (the requirement a rejected commit was meant to satisfy is now unmet) is
  NOT mechanical — it needs a coverage ledger.

**The missing primitive: a requirement -> commit coverage map.** Intake decomposes the issue into
requirements; each spawn is dispatched FOR a requirement, so its commits inherit that tag (cheap
provenance). At assembly the orchestrator reconciles by **set-difference over tags** (not by re-reading
the code — thin-PM preserved): every requirement must end in exactly ONE terminal state —
**absorbed** (a tagged commit was taken), **re-dispatched** (the obligation is re-issued), or
**waived-with-reason** (explicitly recorded — the agent over-built / scope-trimmed). Never silently
gone. A PR is "ready for the merge gate" only when no requirement is open; open obligations **BLOCK**
the PR. The waiver path is the honesty valve.

**Re-dispatch at REQUIREMENT granularity, not commit.** If a commit serving requirement R is rejected,
R is re-issued WHOLE; absorbed commits that leaned on R's rejected work mechanically conflict and fold
into R's re-dispatch — so the dependency cascade is handled by the integrator, not by the orchestrator
reasoning about inter-commit dependencies (thin-PM preserved).

**Routing redo-vs-reassign is signal-informed — and gives the breaker a live internal job.** A fixable
reject -> **redo**: a FRESH spawn of the same persona, seeded with the original task, the rejected diff,
and the rejection reason (the old spawn is ephemeral, but the deltas carry everything that mattered — the
same closure as the retrace). Repeated rejects on a task -> **reassign** to a different/more-trusted
persona. Crucially, **the orchestrator's commit-rejection events WILL BE the delta-promote denial source
the v3.7 VERIFY found missing** — once v3.7 W1 builds the durable journal (today the integrator's
run-report is in-memory only; the ledger is UNBUILT, panel CRITICAL). **The absorb/reject event MUST be
MINTED by the assembly path itself** — the integrator's stack-vs-quarantine decision, bound to the
kernel-attested candidate — **never caller-asserted** (the current `recordVerdict` accepts a
caller-supplied verdict+agentId with no kernel-attest -> absorb-forgery; panel CRITICAL H-ATK-1). So the
loop closes (once the minted ledger exists):

> v3.7 builds the **absorb/reject ledger** (one producer) -> reputation consumes the **absorb-rate**
> (trust-up) -> the breaker consumes the **reject-rate** (trust-down: demote a persona whose rejects
> spike + reassign). Two consumers, one producer.

This means the breaker is NOT teeth-less pre-autonomy: it bounds the internal re-dispatch loop NOW
(a persona stuck burning cycles on a task it cannot satisfy is a named failure mode with a real source).
Only its AUTONOMOUS-promotion job still waits for the ContainerAdapter. `[UPDATE 2026-06-22: the ContainerAdapter machinery is BUILT (#346 + #391); what still waits is the autonomous-promotion WIRING, not the sandbox — see Status update.]`

## Fractal trust — review depth is itself a reputation function

The trust loop is **nested**, and that nesting is what makes the factory *scale*:

- **External loop:** the human (then the repo owner) reviews the *PR*, at a depth set by the
  contributor's track record.
- **Internal loop:** the orchestrator reviews each *agent commit*, at a depth set by that persona's
  track record on *this* repo.

If the orchestrator must fully 3-lens every junior spawn, it becomes the bottleneck — the same ceiling
as human-per-PR, one level down. So **review depth must itself be reputation-gated**: a persona's first
commit on a repo gets full rigor; a persona with a track record gets a lighter pass. This is precisely
how a senior engineer scales attention across many juniors — calibrated scrutiny, not uniform scrutiny.

**The §0a.3.1 resolution (panel-convergent; RATIFIED 2026-06-11, OQ-NS-6).** "Lighter pass for a track record" must
NOT collapse to trust-by-frequency, which §0a.3.1 forbids. The discipline that keeps it clean — and
makes the apex signal load-bearing — is a **narrows-vs-hardens split**:

- The **absorb-rate** (a same-system, our-own-judgment signal) may only **NARROW** — *force MORE* review
  on a high-reject persona. It may **never HARDEN** — never *unlock a skim*. (It is also display /
  re-dispatch-routing input; see Reconciliation.)
- **Only a world-anchored merge** (external maintainer, or the USER) may **HARDEN** — unlock reduced
  scrutiny. You earn a skim from *independent* acceptance of your work, never from self-grading.

This is `INV-28-WorldAnchoredHardening` applied to review-depth itself, and it is elegant: it keeps
§0a.3.1 clean, it makes the cold-start honest (a new persona runs at FULL rigor until external signal
accrues — see the signal note), and it makes "the human gets freed" a thing you *earn from the world*,
not assert internally. **RATIFIED 2026-06-11 (USER) — this is now a binding law of the trust model:
the absorb-rate NARROWS only; only a world-anchored merge HARDENS.**

**The intern analogy fixes the reference class.** Competence is context-bound: a persona trusted on a
Python web service is not trusted by default on a Rust storage engine. The reputation key is therefore
**(individual x model x project x task-type)**, not global — global reputation is exactly the channel
that would let a persona launder credibility across domains.

## The retrace — turning a correction into a localized lesson

When an external correction returns (the gold case: rejected-*with-a-fix*, not merely ignored), blame
splits into two layers of very different trustworthiness:

- **Blame-to-SPAWN is deterministic at COMMIT granularity** (panel-corrected). A PR line maps to the
  one spawn `delta_sha` that wrote it — the substrate records this. But provenance is **spawn/commit
  level, not line level**: `materializeDelta` squashes the spawn's whole trajectory into ONE commit, so
  you can blame the *spawn*, not an intra-spawn *checkpoint*. **Blame-to-CHECKPOINT — the trajectory the
  bisection below walks — is UNBUILT** (today delta capture fires ONCE per spawn at close; the
  per-create/change-point trajectory needs a NEW intra-spawn capture mechanism, e.g. a
  `PostToolUse:Write|Edit` checkpoint commit — OQ-NS-5). So the bisection is a *design target*, not a
  current capability; until it is built, blame stops at the spawn.
- **Blame-to-DECISION is bisected, not re-judged.** We do NOT need the agent's reasoning. We need the
  fork point — the checkpoint where the trajectory first diverged. **Anchor the bisection to the
  correction-diff, NEVER to a re-evaluation of the problem statement** (re-judging "does this checkpoint
  hold" is itself an LLM inference at every step, and is non-monotonic: a wrong choice at checkpoint 2
  can still "hold" until an edge case manifests it at checkpoint 7, forking you at the *symptom*, not
  the *decision*). The mechanical procedure: take the lines the maintainer changed (ground truth),
  trace *those lines* backward through the delta-trajectory to the checkpoint where they first took
  their wrong form. That checkpoint is the fork. Omissions (a maintainer *adds* a guard) localize to the
  checkpoint that introduced the unguarded path.

**Checkpoints are file-delta snapshots at create/change points** — not extensive, not reasoning logs.
The closure that makes this sufficient: *anything that affected the PR left a file delta; anything that
left no delta cannot be the defect.* The impl-doc is a file too, so design choices leave deltas.

**The constructed memory is evidence-graded, split down the middle:** `bug = confirmed-external`
(a real maintainer fixed exactly these lines) but `attribution = inferred` (which decision produced
them is a hypothesis). The inferred half MUST NOT harden as if it carried the maintainer's authority —
that is `INV-28-WorldAnchoredHardening` applied to the retrace itself. Get this wrong and the system
confidently learns fiction.

## Forgetting — the retention boundary is the external signal, not internal completion

You cannot discard a task's trajectory at internal done-ness: a PR that merges clean today can return
with a correction weeks later, and the retrace needs the breadcrumbs. So: **retain the delta-trajectory
(cheap, structural) until the external signal SETTLES** (merged-and-stable past a correction window);
only then collapse it to the lesson and shed the scaffolding. The verbose planning prose is discarded
earlier — the deltas are the reconstruction substrate, the prose was scratch. Forgetting is gated by the
same world-anchor as learning, so the system holds exactly what is still "in flight" and sheds what the
world has finished judging.

## Honest gaps (named now, before they bite)

1. **The apex signal is slow, sparse, and noisy.** Merges take days-to-weeks; many good PRs die for
   reasons orthogonal to correctness (maintainer busy, scope, project politics, "no AI PRs"). The
   non-merge must be CLASSIFIED — rejected-with-correction (a labeled error, the learning signal),
   ignored (missing data, NOT negative), closed-for-scope (no signal). Only the correction-diff teaches.
2. **Attribution must survive time.** By merge time the `run_id` has rotated (`sha256(session)`, dies at
   compaction) and the session is gone. Provenance `issue -> spawn -> PR -> merge-event` must key on a
   durable anchor (PR URL / head commit sha), never anything session-scoped.
3. **Goodhart at scale.** If merge-rate is the fitness function, the cheap win is trivial safe PRs that
   merge easily. The signal must be **difficulty-weighted** (a merged 3-line typo fix is worth far less
   than a merged 200-line bug fix on a contested file) — the sharpness idea applied to reputation.
4. **The observability layer is a genuine BUILD,** not a reuse: tracking PRs across external repos,
   polling state (open/merged/closed/commented), capturing correction-diffs, measuring latency. Its own
   component.
5. **OSS citizenship is a design constraint.** Real maintainers spend real review time. Disclose
   AI-generated provenance, respect `CONTRIBUTING.md`, rate-limit per project, never spam — a system
   that floods maintainers gets the approach banned, and "merged" stops being a clean signal the moment
   a maintainer starts auto-rejecting the bot.
6. **The ContainerAdapter wall stands for the autonomous end.** `[UPDATE 2026-06-22: the real sandbox is now BUILT + containment-attested (#346 fs/net/proc isolation; #391 write-isolation) — the remaining "wall" is the autonomous WIRING, not the sandbox; see Status update.]` "Agents push freely to their own branch
   but cannot corrupt main" needs a real sandbox — worktree isolation is same-uid and not a security
   boundary. BUT the beta routes around it: while a HUMAN is the merge gate, the human is the
   containment, so the GitHub pipeline runs on already-built machinery. The sandbox is required only when
   the human steps out of the loop (full autonomy).

## How the roadmap derives backward from this

**This is a PROPOSED re-scoping of two spine kickoffs, to be routed through the charter's gate — not a
unilateral re-sequence** (panel-corrected: the spine's committed v3.7 is delta-promote *activation*, not
ledger-building; E-EXT is post-beta P7; so the derivation below DOES re-scope v3.7 and forward-pull
E-EXT, and that diff must go through the combined-roadmap's own kickoff process, not be assumed). The
proposed derivation:

- **v3.7 (proposed re-scope)** produces the **absorb/reject ledger** (which agent's commit was absorbed
  vs rejected / quarantined, tagged to its requirement). This is the one producer two trust consumers
  read. (This addresses the v3.7 EC3 debate AND finds the breaker's missing denial source: the reject
  events are what the breaker bounds — but note the committed v3.7 plan is delta-promote *activation*;
  adding the ledger is a re-scope to ratify, and the ledger is UNBUILT. The breaker's INTERNAL
  reject-bounding job comes with it; only its AUTONOMOUS-promotion job defers to the ContainerAdapter.) `[UPDATE 2026-06-22: the ContainerAdapter machinery is BUILT (#346 + #391); the deferral is the autonomous-promotion WIRING — see Status update.]`
- **v3.8** wires both consumers: **reputation** reads the absorb-rate (trust-up); the **breaker** reads
  the reject-rate (trust-down: demote a degrading persona + reassign).
- **v3.9 sharpens** from "install for a cooperative cohort" to the concrete, better beta: **the GitHub
  issue -> PR pipeline, the USER as the merge gate, the external-merge signal feeding the trust ledger.**
  This makes **E-EXT the spine of how trust is earned, not a post-beta validation footnote.**
- **v4.x** lifts the human from per-PR to spot-audit (the breaker becomes the trust-DOWN auto-demotion
  valve once there is autonomous promotion to halt), gated on the ContainerAdapter for the autonomous
  push. `[UPDATE 2026-06-22: the ContainerAdapter machinery is BUILT (#346 + #391); the v4.x gate is the autonomous-promotion WIRING, not the sandbox — see Status update.]`

## What this RFC does NOT claim

- It does not make the model reliable (it makes the *system* fault-tolerant around an unreliable model).
- The apex signal is the best-available world-anchor, not ground truth — maintainers merge imperfect PRs
  and reject good ones; it is *strong evidence*, graded, never *proof* (`validated-external (n=1)` is a
  floor).
- It does not resolve the ContainerAdapter unknown (Track 2 / `P0.0` harness-wrap probe remains the
  autonomy go/no-go). `[UPDATE 2026-06-22: RESOLVED — the harness-wrap unknown is answered: a claude -p agent runs write-confined in a container, proven (#346 + #391); the autonomy go/no-go is no longer this unknown but the autonomous-promotion WIRING — see Status update.]`
- The retrace's decision-attribution is a hypothesis layer over a deterministic provenance layer; only
  the provenance layer is authoritative.

## Open questions (for ratification)

1. **OQ-NS-1** — the non-merge classifier: how is rejected-with-correction distinguished from
   ignored/scope at scale (maintainer-comment NLP? a heuristic on whether a correction-diff touched our
   lines)? The learning signal depends entirely on this split.
2. **OQ-NS-2** — difficulty-weighting: what is the difficulty estimator for a merged PR (diff size?
   file contestedness? issue labels?), and does it itself become a Goodhart target?
3. **OQ-NS-3** — the durable attribution schema: the exact `issue -> spawn -> PR -> merge` key and where
   it is stored so it survives `run_id` rotation + compaction.
4. **OQ-NS-4** — intake: how much requirements-solidification is automatable vs needs a human
   confirm-gate before the architect spawns (a wrong requirement poisons the whole tree).
5. **OQ-NS-5** — the requirement -> spawn -> commit tagging schema: how a requirement is identified and
   carried as provenance so assembly-time reconciliation is a clean set-difference; how a re-dispatched
   requirement's lineage links to its prior failed attempt; AND the **per-checkpoint intra-spawn capture
   mechanism** the retrace bisection needs (today provenance is commit-level only). **Tag-integrity
   (panel CRITICAL H-ATK-2):** a caller-supplied tag alone is forgeable -> a forged tag fakes coverage
   and silent-drops through the no-silent-drop gate; require a SECOND code-anchored signal (a test mapped
   to the requirement) before a requirement is marked `absorbed`.
6. **OQ-NS-6 — RATIFIED 2026-06-11 (USER).** The narrows-vs-hardens grading is now a binding law: the
   same-system absorb-rate may only NARROW review (never harden a skim); only a world-anchored merge
   (external maintainer, or the USER) may HARDEN (unlock reduced scrutiny). This is the load-bearing
   §0a.3.1 decision underneath cold-start, never-signal, and the whole trust-up direction. Every
   downstream consumer (reputation, the Fractal-trust skim function) MUST honor it.
7. **OQ-NS-7** — the build/test gate on the assembled tree: the integrator catches only TEXTUAL
   conflicts; cross-file/semantic dependency-incoherence needs a NEW build/test gate before a PR is
   "ready for the merge gate." What gate, and how is it bounded (it cannot run arbitrary external build
   systems safely pre-ContainerAdapter)?
8. **OQ-NS-8** — signal authentication + anti-gaming: (a) the apex merge-event must be read from the
   forge's AUTHENTICATED API with the merging actor asserted NOT-us (else self-merge spoofing,
   H-ATK-4); (b) a poisoned/noisy maintainer needs N>1-signal or a maintainer-trust weight before a
   reject HARDENS a demotion (NS-5); (c) the reject-rate breaker must trip only on EVIDENCE-LINKED
   rejects (kernel-attested structural failure), not internal opinion, or it is a DoS weapon against a
   good persona (H-ATK-6); (d) the Goodhart sleeper-climb needs a MINIMUM rigor floor + STAKE-aware
   scrutiny (never zero-lens on a high-stakes diff), since track-record alone does not stop it (H-ATK-5).

## Verification record (2026-06-11 adversarial panel)

A 9-agent workflow (4 firsthand ground-truth probers + a 5-lens panel: architect coherence, hacker
gaming, honesty overclaim, failure-mode skeptic, canon-contradiction) stress-tested this RFC for
end-to-end coherence against the actual substrate. **Unanimous verdict: COHERENT-WITH-GAPS** — the
architecture composes, ADR-0012 is clean, the thin-PM bulkhead and the reputation system are real and
built; but several confident claims were over-stated. Corrections folded above:

| Class | Finding (panel-convergent) | Fold |
|---|---|---|
| Over-claimed determinism | "mechanical incoherence caught deterministically, no new mechanism" — FALSE for cross-file/semantic deps (probed: clean merge + runtime error, no quarantine) | Reconciliation downgraded; OQ-NS-7 build/test gate |
| Over-claimed determinism | "every PR line maps to the spawn with certainty" — provenance is COMMIT-level; intra-spawn checkpoint trajectory is UNBUILT (single squash) | Retrace downgraded; OQ-NS-5 capture mechanism |
| Over-claimed continuity | "re-prioritizes, does not re-sequence the spine" — FALSE (re-scopes v3.7, forward-pulls E-EXT) | Status note + roadmap section reframed as a PROPOSED re-scope through the charter's gate |
| Unbuilt + forgeable | the absorb/reject ledger ("ARE emitted") is UNBUILT; `recordVerdict` is caller-forgeable | Present-tense -> future; MUST be minted by the assembly path, kernel-attested |
| §0a.3.1 tension | absorb-rate hardening reputation / "fiftieth clean-merged commit gets a skim" = trust-by-frequency on a same-system signal | The narrows-vs-hardens split (Fractal trust); OQ-NS-6 |
| Cold-start | "resolved" inverts the bottleneck (unproven = MAXIMAL review; human freed only lagged) | Re-titled MITIGATION (partial); amplification-control is the unconditional win |
| Apex unbuilt | external-merge signal has no producer + no authentication; latency vs `run_id` rotation breaks attribution | OQ-NS-8 (auth) + OQ-NS-3 (durable key); flagged UNBUILT |
| Smaller | DAG-ordering is caller-convention not a computed primitive; "few new pieces" understates (~6-7 net-new); INV-28 number collision | Relabeled / honest tally / full-name cited |

**Strongest part (panel-named):** the DDIA fault-tolerance thesis + the thin-PM bulkhead as the answer
to error-amplification — these survived every lens. **Net:** the skeleton holds; the joints asserted as
"already built / deterministic" are the work, and the §0a.3.1 narrows-vs-hardens split (OQ-NS-6) is the
one decision that makes the whole trust model honest.
