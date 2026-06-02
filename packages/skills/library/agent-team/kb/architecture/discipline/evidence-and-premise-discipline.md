---
kb_id: architecture/discipline/evidence-and-premise-discipline
version: 1
tags:
  - discipline
  - epistemics
  - verification
  - foundational
  - anti-hallucination
sources_consulted:
  - "Richard Feynman, 'Cargo Cult Science' (1974 Caltech commencement address) — 'you must not fool yourself, and you are the easiest person to fool' (calteches.library.caltech.edu/51/2/CargoCult.htm) [web-verified]"
  - "Karl Popper, Conjectures and Refutations (1963) — falsifiability as the criterion of scientific status [web-verified]"
  - "Andrew Hunt & David Thomas, The Pragmatic Programmer (1999; 20th anniv. 2019) — Tip 27 'Don't Assume It — Prove It'; rubber-duck debugging [web-verified]"
  - "David Hume, A Treatise of Human Nature (1739–40) Book III, Part I, Sect. I — the is–ought gap ('Hume's guillotine') [web-verified]"
  - "Taiichi Ohno, Toyota Production System: Beyond Large-Scale Production (1988) — the 5 Whys / root-cause discipline [web-verified]"
  - "John Ousterhout, A Philosophy of Software Design (2nd ed. 2021) — understand the design before you change it; comments describe what isn't obvious [web-verified]"
related:
  - architecture/discipline/trade-off-articulation
  - architecture/discipline/error-handling-discipline
  - architecture/discipline/stability-patterns
  - architecture/discipline/reliability-scalability-maintainability
  - architecture/crosscut/single-responsibility
  - architecture/crosscut/dependency-rule
  - security-dev/threat-modeling-essentials
  - infra-dev/observability-basics
status: active+enforced
---

## Summary

**Principle (Feynman)**: "You must not fool yourself — and you are the easiest person to fool." A claim is only as trustworthy as the evidence linked to it.
**Discipline**: a premise — even a "sounds-right" one from a plan, a prior doc, or your own reasoning — is a HYPOTHESIS to verify against the artifact/runtime, not a fact. Read the primary source before asserting. Separate IS from OUGHT. Cite the exact location. Declare what you did NOT verify.
**Test**: for each load-bearing claim, can you point to the probe (file:line, grep, runtime invocation, test output) that grounds it? If not, it is a conjecture, not a finding.
**Sources**: Feynman (Cargo Cult Science) + Popper (falsifiability) + Pragmatic Programmer (Tip 27) + Hume (is–ought) + Ohno (5 Whys) + Ousterhout (PoSD).
**Substrate**: Runtime-Claim Probe discipline; `drift:plan-honesty`; "probe the premise, not the convenient test"; code-reviewer's file:line + >80%-confidence floor; honesty-auditor's negative attestation.

## Quick Reference

**Principle**: A claim's trust = the evidence linked to it. A premise is a hypothesis until probed. Read the source first. Separate is from ought. Cite the line. Declare what you did not check.

**Five sub-disciplines** (each maps to a HETS lens):

| Sub-discipline | One-liner | Primary lens |
|---|---|---|
| Premise-probing | A "sounds-right" premise from a plan/doc/your-own-reasoning is a hypothesis to verify | architect |
| Cite-or-it-didn't-happen | Every finding carries `file:line` (or source); no citation → not a finding | code-reviewer |
| Confidence floor | Only assert at `>80%` confidence; below that, flag as uncertain, don't claim | code-reviewer |
| Proof-over-theory | Demonstrate the exploit/behavior; a theoretical claim is not a confirmed one | hacker |
| Is-not-ought | Report what the code DOES (is), separately from what it SHOULD do (ought) | codebase-analyzer |
| Read-the-source-first | Never describe a file/contract from memory — read it, then assert | codebase-analyzer |
| Trace-the-actual-control-flow | Follow the real call path, not the documented/assumed one | codebase-analyzer |
| Negative attestation | State explicitly what you did NOT verify; do not imply full coverage | honesty-auditor |

**Top smells**:

- A factual claim with no source / probe attached ("the hook fires on Z" — says who?)
- Confidence asserted, not earned ("clearly", "obviously", "definitely" with no grounding)
- Describing a file's contents from memory instead of reading it
- An ought smuggled in as an is ("the function validates input" when it doesn't — that's a wish)
- "Looks fine" / "no issues" with no statement of what was actually checked (implied-total-coverage)
- Trusting a self-asserted value (a record's own claim about itself) instead of re-deriving it

**The probe forms** (cheapest sufficient evidence):

| Claim shape | Probe |
|---|---|
| "file X exists" | `ls` / `test -f` |
| "Y is called from Z" | `grep` the call site → read it |
| "the hook fires on event E" | runtime invocation / log / test output |
| "the field is set" | read the producer line that sets it |
| "this is exploitable" | a working PoC, not prose |

**Apply when**: any assertion about current state, an API/contract, a runtime behavior, a security property, or a "merged/done" claim. **Skip** for: future-state claims (clearly marked), claims already backed by a same-session probe, pure-design claims with no runtime referent.

**Substrate examples**:

- Runtime-Claim Probe: a plan claim about current state must cite a probe (grep/ls/test) before impl acts on it; `/verify-plan` Check #9 FLAGs un-probed runtime claims.
- `drift:plan-honesty`: plan prose about an existing module's contract is a premise to PROBE, not a fact (the "PROMOTE = git merge" claim was wrong — the kernel cherry-picks a delta).
- "Probe the premise, not the convenient test": a verified design's conclusion rested on an unprobed harness premise; a `claude -p` probe overturned it.
- code-reviewer: `file:line` + `>80%` confidence floor is a persona-contract requirement.
- honesty-auditor: claim-vs-evidence reconciliation + negative attestation (what was NOT checked).

## Intent

Most wrong conclusions don't come from bad logic — they come from a true-sounding premise that nobody checked. The reasoning is valid; the input was a guess. A plan says "the spawn carries `tools[]`," three reviewers bless the design built on it, and impl discovers the spawn carries no such thing — the substrate nearly bricks. Nobody lied; everybody trusted a premise.

The fix is not "reason more carefully." It is to treat every load-bearing premise as a **hypothesis** and link it to **evidence** before acting. Multi-reviewer blessing verifies internal logic against the *code as described*; it does not verify the *premise against reality*. Confidence has to be earned by grounding, not asserted by tone.

This discipline converts "I'm pretty sure X" into "X — `path/to/file.js:142`" or, honestly, "I could not verify X." Both are acceptable. An unsourced confident claim is the only failure.

## The Principle

> "The first principle is that you must not fool yourself — and you are the easiest person to fool." — Richard Feynman, *Cargo Cult Science* (1974 Caltech commencement address)

Feynman's companion instruction is the operational core: *"If you're doing an experiment, you should report everything that you think might make it invalid — not only what you think is right about it."* That is negative attestation, stated as scientific integrity forty years before it became a code-review convention.

Reformulated for engineering:

- **A claim is only as trustworthy as the evidence linked to it.** No evidence link → conjecture, not finding.
- **A premise is a hypothesis.** "Sounds right" (from a plan, a prior doc, or your own reasoning) is the start of verification, not the end of it.
- **Read the primary source before asserting.** Never describe a file or contract from memory.
- **Separate IS from OUGHT.** What the code *does* is an observation; what it *should* do is a judgment. Do not let the second masquerade as the first.
- **Confidence is earned, not asserted.** Cite the location; declare what you did not check.

## Premise-probing (the architect lens)

Karl Popper's contribution (*Conjectures and Refutations*, 1963): "the criterion of the scientific status of a theory is its falsifiability." A claim that cannot be tested cannot be trusted — and the discipline is to actively try to *refute* it, because a single counter-example settles the matter where no amount of agreement does.

Applied to a premise: don't ask "does this sound plausible?" (which seeks confirmation). Ask "what observation would prove this false, and have I made that observation?" The Pragmatic Programmer states the same as Tip 27 — **"Don't Assume It — Prove It"**: prove your assumptions in the actual environment, with real data and boundary conditions.

The dangerous premises are the comfortable ones:

- "This module already does X" (recon absorbed it from a prior PR; the repo has since moved)
- "The harness injects Y per-spawn" (an abstract capability nobody invoked)
- "PROMOTE merges the branch" (plan prose; the code cherry-picks a delta — no merge path exists)

Each is a hypothesis. The probe is one line — a `grep`, an `ls`, a `claude -p` invocation, a test run. The probe is cheap; the un-probed premise is a mid-flight design change or a substrate-bricking near-miss.

## Read the source first; trace the actual control flow (the analyzer lens)

Ousterhout (*A Philosophy of Software Design*) frames the obligation as understanding before changing: comments — and assertions — should describe what is actually there, not what the author assumed. The analyzer lens makes this concrete:

- **Read-the-source-first**: open the file and read the relevant lines before saying anything about its contents. A claim sourced from memory is a guess wearing the costume of a fact.
- **Cite-the-line**: attach `file:line` to each claim, so a reader can re-verify in one click. An assertion you cannot locate is one you cannot defend.
- **Trace-the-actual-control-flow**: follow the *real* call path — from the actual call site, through the actual dispatch — not the documented flow, not the flow you'd expect. Documentation drifts; the code is the runtime truth.

The failure this prevents: confidently describing the *intended* behavior of a system whose code diverged from its docs months ago.

## Is vs Ought (Hume's guillotine)

David Hume (*A Treatise of Human Nature*, 1739–40, Book III, Part I, Sect. I) observed that writers slide imperceptibly from "is" and "is not" to "ought" and "ought not" without justifying the leap — the **is–ought gap**, or "Hume's guillotine." You cannot derive an *ought* from an *is* without smuggling in a value premise.

In code analysis the gap runs the other way and is just as dangerous: an *ought* gets reported as an *is*.

- IS (observation): "`validateInput()` is called at line 42 and returns the raw value unchanged."
- OUGHT (judgment): "`validateInput()` should sanitize the value before returning it."

Collapsing the two produces the most insidious analysis error — "the function validates input" — which is neither a true observation (it doesn't) nor an honest recommendation (it should). The discipline: report what the code *does* as a grounded observation; state what it *should* do as a clearly-labelled judgment; never let the wish describe itself as the fact.

## Root cause vs symptom (the 5 Whys)

Taiichi Ohno's 5 Whys (*Toyota Production System*, 1988) is premise-probing applied to causation. "By repeating *why* five times, the nature of the problem as well as its solution becomes clear." Stopping at the first plausible cause treats a symptom; the true premise lies several "why"s deeper.

Ohno's canonical example — a machine stops; *why?* the fuse blew; *why?* the bearing wasn't lubricated; *why?* the pump under-pumped; *why?* the shaft was worn; *why?* no strainer, so scrap got in — shows the gap between the *convenient* cause (replace the fuse) and the *real* one (add a strainer). "Five" is a heuristic: fewer and you're likely still on a symptom; more and the chain gets too abstract to act on.

This is the methodological core of **"probe the premise, not the convenient test."** A read-only test spawn that no-ops *looks* like a resolver failure; the deeper why ("a read-only spawn makes no delta, so the harness removes the worktree, so there is nothing to observe") reveals the no-op is correct. Stop at the first "why" and you redesign a working system.

## Substrate-Specific Examples

### The Runtime-Claim Probe discipline

The substrate's load-bearing form of this principle. When a plan contains a claim about *current* substrate state — "file X exists", "hook Y fires on Z", "the spawn carries `tools[]`", "the directory is empty" — the plan MUST cite a probe (a one-line `grep`, a runtime invocation, a test output, or a file `ls`) that verifies the claim against the actual repo/runtime BEFORE impl acts on it. The form is inline: `Probe: <command> → <observed result>`. The `/verify-plan` architect spawn (Check #9) FLAGs un-probed runtime claims and marks the plan NEEDS-REVISION if any FAIL. Skipped only for clearly-marked future-state claims and claims already backed by a same-session probe.

### `drift:plan-honesty` — plan prose is a premise, not a fact

Plan prose absorbs premises from recon, prior PRs, or architect/reviewer reasoning — and premises decay as the repo moves. The graduating instance: the plan (and MEMORY) once asserted "PROMOTE = `git merge` the branch," but the kernel primitive **cherry-picks a `delta_sha`** — there is no merge path at all. The discipline: re-probe even "sounds-right" API/contract claims against the actual source before building. **Multi-reviewer blessing is NOT runtime verification** — it confirms the logic is consistent with the *described* contract, not that the contract is real.

### "Probe the premise, not the convenient test"

A provenance design plus three independent read-only lenses (all APPROVE) concluded "safe auto-merge is harness-blocked by undetectable spawn nesting." A firsthand `claude -p` *harness* probe found that nesting is structurally *impossible* — every spawn is genesis-from-main — which reframed a "blocked" problem into buildable kernel work. The verified design's *conclusion* rested on an *unprobed harness premise*. Recurrence: the P3b "Case E `transaction_id`" fallacy was blessed "mechanical" by a recon sub-agent; only the firsthand premise-probe caught that the chain edge is `post_state_hash`, not `transaction_id`.

### code-reviewer: file:line + the >80% confidence floor

The `03-code-reviewer` persona contract requires each finding to carry an exact `file:line` location and to be raised only at **greater-than-80%** confidence; lower-confidence observations must be flagged as uncertain, not asserted as defects. This is cite-or-it-didn't-happen plus the confidence floor, enforced as a persona contract — a finding without a location is not a finding, and a guess dressed as a defect wastes the author's iteration.

### honesty-auditor: claim-vs-evidence + negative attestation

The honesty-auditor lens reconciles every claim against its linked evidence and requires **negative attestation** — an explicit statement of what was NOT verified — rather than an implied-total-coverage "looks fine." In the live dogfood arc, the auditor's discipline forced statements like "HEAD untouched in every arm; all git test artifacts cleaned" to be backed by the actual `git worktree list` / ref state, and forced a premature "premise falsified" call to be **corrected in-session** once the evidence (read-only spawns make no delta) was actually examined.

### Never trust a self-asserted value (INV-22)

The substrate refuses to trust a record's own claim about itself: an `idempotency_key` is a **verified content-address** — `deriveIdempotencyKey(record)` re-derives it from the record body, and the store rejects a self-inconsistent incoming key and skips a forged stored key. This is "cite-or-it-didn't-happen" at the data layer: identity is *re-derived from evidence*, never accepted on assertion, because the store is not a sandbox.

## Tension with Other Principles

### Evidence discipline vs Velocity

Probing every premise costs time. For high-throughput trivial work, a probe per claim is overhead that exceeds its value.

**Heuristic**: probe proportional to *blast radius*. A claim that, if wrong, causes a mid-flight redesign or a substrate-bricking near-miss earns a probe every time. A claim whose failure is cheap to discover and reverse (a typo, a local-only edit) does not. The Runtime-Claim Probe skip-list encodes exactly this: future-state and same-session-already-probed claims are exempt.

### Evidence discipline vs Trust / Authority

A senior architect (or a respected prior doc) asserts a premise; the team trusts. Re-probing can feel like distrust.

**Resolution**: the probe targets the *premise*, not the *person*. "Multi-reviewer blessing verifies internal logic, not the harness/premise" is a statement about epistemics, not competence. Even a correct senior call benefits from a one-line probe that converts trust into a citable fact for the next reader.

### Is-not-ought vs Actionability

Pure observation ("the code does X") without judgment ("…and that's a bug") can read as non-committal — a reviewer who only describes is unhelpful.

**Resolution**: report *both*, clearly separated. The IS is the grounded evidence; the OUGHT is the labelled recommendation. The discipline is not to withhold judgment — it is to never let the judgment *impersonate* the observation.

### Negative attestation vs Confidence projection

Stating "I did not verify the concurrency path" can read as weakness next to a peer's confident "looks solid."

**Resolution**: per Feynman, reporting what might invalidate your result *is* the integrity, not a hedge. An honest scope statement is more trustworthy than unbounded confidence — and it tells the next person exactly where to look.

## When to use this principle

- Any claim about **current state** (a file exists, a hook fires, a field is set, a directory is empty)
- Any claim about an **API or contract** ("this module does X", "PROMOTE merges")
- Any **runtime/harness behavior** claim ("the spawn carries Y", "`updatedInput` is honored")
- Any **security property** claim — demonstrate it (proof-over-theory), don't theorize it
- Any **"merged" / "done" / "passing"** claim — verify via `gh` / test output before recording it
- Before recording a conclusion to durable memory (MEMORY.md, a snapshot, an ADR)

## When NOT to use this principle (or apply with caveat)

- **Clearly-marked future-state claims**: "PR 3 will introduce K9" describes intent, not current state; no probe is owed (only its eventual implementation owes one).
- **Already-probed-this-session claims**: a premise backed by a same-session probe logged in the plan need not be re-probed per reference.
- **Pure-design claims with no runtime referent**: "the simplest factoring is X" is a judgment, not a falsifiable state-claim; it earns a *rationale* (see trade-off-articulation), not a `grep`.
- **Reversible, low-blast-radius work**: a local-only edit whose failure surfaces instantly and reverts cleanly does not need a premise audit.

## Failure modes when applied incorrectly

- **Probe theater**: pasting a `grep` that doesn't actually test the claim (greps the wrong file, or a substring that co-occurs by accident). Solution: the probe's *observed result* must directly entail the claim, not merely co-locate with it.
- **Verification paralysis**: probing claims whose failure is trivially cheap, blocking forward motion. Solution: scope probing to blast radius; use the skip-list.
- **False precision**: citing `file:line` for a line that says something adjacent to — but not exactly — the claim. Solution: the cited line must literally support the assertion when read in isolation.
- **Attestation as alibi**: listing "did not verify" for everything, converting honesty into a refusal to commit. Solution: negative attestation scopes the *gaps in otherwise-real coverage*; it is not a substitute for doing the verification you can do.
- **The catch-22 of self-modifying tools**: when the thing you're probing is the prober itself (a routing scorer scoring a change to the routing scorer), the current-state probe may be biased by the not-yet-changed state. Solution: name the catch-22 explicitly and escalate to human judgment rather than trusting the self-referential score.

## Tests / verification

- **Citation audit**: sample the load-bearing claims in a finding/plan — does each carry a `file:line`, a probe line, or an explicit "not verified"? An un-cited confident claim fails.
- **Re-derivation test**: can a second reader follow the cited probe and reach the same observation independently? If the probe isn't reproducible, it wasn't evidence.
- **Is/ought separation test**: scan recommendations — is any *ought* phrased as a bare *is* ("the function validates")? Rephrase to separate observation from judgment.
- **Negative-attestation presence**: does the deliverable state what was NOT checked, or does its silence imply total coverage? Implied-total-coverage fails the honesty-auditor lens.
- **Premise-decay re-probe**: for claims carried from a prior session/PR, was the premise re-verified against *current* repo state, or assumed to still hold?

## Related Patterns

- [architecture/discipline/trade-off-articulation](trade-off-articulation.md) — the sibling discipline: articulation grounds the *ought* (why a choice is favorable) as evidence discipline grounds the *is*; both convert "feels right" into a defensible statement.
- [architecture/discipline/error-handling-discipline](error-handling-discipline.md) — fail-closed on uncomputable evidence (the hashing entry points throw rather than fabricate) is evidence discipline at the error boundary.
- [architecture/discipline/stability-patterns](stability-patterns.md) — verifying a "failure" by exercising the success path before concluding is the stability analogue of probe-the-premise.
- [architecture/discipline/reliability-scalability-maintainability](reliability-scalability-maintainability.md) — claims about which R/S/M axis dominates are premises to ground in measurement, not intuition.
- [architecture/crosscut/single-responsibility](../crosscut/single-responsibility.md) — "this module does one thing" is itself a claim to verify by reading the source, not asserting from the name.
- [security-dev/threat-modeling-essentials](../../security-dev/threat-modeling-essentials.md) — proof-over-theory: a threat is confirmed by a demonstrated path, not a hypothesized one.

## Sources

Authored by multi-source synthesis of (each web-verified at authoring time):

1. **Richard Feynman, "Cargo Cult Science"** (1974 Caltech commencement address). The canonical statement of self-deception as the primary epistemic hazard — "you must not fool yourself, and you are the easiest person to fool" — and of negative attestation as integrity ("report everything that you think might make it invalid"). Verified against the Caltech library transcript (`calteches.library.caltech.edu/51/2/CargoCult.htm`).
2. **Karl Popper, *Conjectures and Refutations*** (1963). Falsifiability as the criterion of a claim's trustworthiness; the asymmetry that a single counter-example refutes where no amount of confirmation verifies.
3. **Andrew Hunt & David Thomas, *The Pragmatic Programmer*** (1999; 20th anniv. 2019). Tip 27, "Don't Assume It — Prove It": prove assumptions in the actual environment with real data and boundary conditions. Rubber-duck debugging as a forcing function for confronting your own premises.
4. **David Hume, *A Treatise of Human Nature*** (1739–40), Book III, Part I, Sect. I. The is–ought gap ("Hume's guillotine") — the discipline of separating what *is* from what *ought* to be, applied here to separating code observation from code judgment.
5. **Taiichi Ohno, *Toyota Production System: Beyond Large-Scale Production*** (1988). The 5 Whys: root-cause discipline as iterated premise-probing; the convenient cause vs the real one.
6. **John Ousterhout, *A Philosophy of Software Design*** (2nd ed. 2021). Understand the design before changing it; comments (and assertions) describe what is actually there, not what was assumed — the basis of read-the-source-first.

Substrate examples cite the Runtime-Claim Probe discipline (`/verify-plan` Check #9), the `drift:plan-honesty` drift-class and its "PROMOTE merges" graduating instance, the "probe the premise, not the convenient test" lesson (the P-PROV harness probe + the P3b Case-E fallacy), the `03-code-reviewer` `file:line` + `>80%` confidence-floor contract, the honesty-auditor negative-attestation discipline, and the INV-22 re-derived-content-address (`deriveIdempotencyKey`).

## Phase

Authored: kb authoring batch (v3.1 Runtime Foundation closed; pre-Phase-3 detour). Multi-source synthesis from 6 web-verified sources spanning philosophy of science (Feynman, Popper, Hume), pragmatic engineering (Hunt/Thomas, Ousterhout), and operations discipline (Ohno). Substrate examples emphasize the Runtime-Claim Probe as the load-bearing in-substrate form, `drift:plan-honesty` as the recurring failure-class, and the HETS lens contracts (code-reviewer cite/confidence, honesty-auditor negative attestation) as enforcement. The substrate's own correction history — premature "premise falsified" calls reversed in-session by examining the actual evidence — is the exemplar of the discipline.
