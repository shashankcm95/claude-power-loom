---
lifecycle: persistent
topic: persona-jardin, proto-design, epistemics, two-lane-trust, falsifiability, belief-lifecycle, new-project
date: 2026-06-17
status: PROTO-DESIGN — REVIEWED (red-team wf_044ffbd0-236 §4 + blue-team wf_60680d9f-10b §5) → VERDICT: do NOT build standalone (collapses to prior-art + a label in the SDE/CI-oracle domain = the plugin). Extract the survivor as a Power Loom MODULE (§5.5). NOT on the ③ critical path.
---

# Persona Jardin — proto-design blueprint (for critical research)

> Origin: a 2026-06-17 chat thought-experiment that grew from the ClawSouls "Soul-Driven
> Interaction Design" paper review. This is a **separate-project** exploration, deliberately
> *off* the Power Loom ③ critical path. The point of this doc is to be **stress-tested**: every
> claim/assumption/design-move below is tagged so a research board can try to break each one.

## 1. Product vision (one paragraph)

A system to **mint, cultivate, and export grounded, base-model-powered personas.** A persona is a
**thin, personal, context-scoped overlay** on any base model. It learns along **two lanes**: a
*malleable* lane (taste/style, fed by user interaction, shapes the persona toward the user, claims
no truth) and a *hard* lane (facts, fed by external confirmation, earns provisional truth). Unlike
ClawSouls (all-declared "art", forgeable) or RLHF/fine-tuning (bakes taste into weights,
unauditable), a Jardin persona is **two-lane, bound-tracked, provenance-gated, auditable, and
exportable** — you can see, and hand someone, *exactly how much of it is earned vs chosen.* The
Power Loom plugin is claimed to be *one instance* of this substrate (SDE domain, PR-merge as the
hardening signal); Jardin generalizes it via a **swappable confirmation signal** + a
mint/cultivate/export surface.

## 2. The decomposed blueprint (claim / assumption / design-move — each individually testable)

### A. Epistemic core
- **A1** (claim): Knowledge splits via a **falsifiability gate** into three — *falsifiable+survived*
  → fact (science/hard); *falsifiable+refuted* → wrong (negative); *non-falsifiable* → taste/value
  (art/perspective/soft). Most perspectives are non-falsifiable and CANNOT become facts. [Popper]
- **A2** (claim): Facts harden by surviving **independent, severe external** falsification attempts;
  confirmation is weak, refutation decisive (asymmetry: one counterexample > 100 confirmations).
- **A3** (design-move): truth-weight = **breadth of independent** survived refutation; correlated
  re-tests discount toward 1 (independence is the gameable variable, not count).
- **A4** (design-move): a fact is a **bounded band** `P ∈ [lower, upper]` (lower=provably/observably
  solid floor; upper=widest not-yet-broken claim), domain-scoped, confidence **decays past the
  tested domain**. [analogy to CS bounds: matrix-mult ω∈[2,~2.37], approximation ratios, undecidability]
- **A5** (claim): facts are **context-bound AND time-bound**; even bedrock (Newton near *c*) fails at
  domain edges. Context-boundedness ≠ relativism — *the boundary is itself an objective, checkable fact.*
- **A6** (design-move): **bounded hysteresis** — a hardened fact resists demotion proportional to
  corroboration, but the demotion bar is *equal currency* (independent severe counter-evidence ≥ the
  support), NOT escalating goalposts (escalating = unfalsifiable = dogma). A single decisive
  *replicated* counterexample suffices. [Lakatos sophisticated falsificationism]
- **A7** (design-move): a counterexample has **two readings** — refutation (false) OR
  boundary-discovery (true-but-local → re-scope). Corroborated facts usually **shrink domain**, not
  get deleted (Newton → low-energy limit of relativity).

### B. Two-lane architecture + signals
- **B1** (design-move): two lanes — **malleable** (user interaction → narrows toward user, no
  inertia) + **hard** (external confirmation → sticky/corrigible).
- **B2** (claim): the substrate is **signal-agnostic** — narrow/harden attach to any trigger;
  PR-merge (SDE) and user-validation+domain-checks (personal) are instances of one
  `WorldAnchoredConfirmation` interface. [OQ-NS-6 generalization]
- **B3** (claim): **"narrows" = pull the upper bound down** (rule out tested failure modes);
  **"hardens" = raise the lower bound** (prove a new floor). A backtest can only narrow (it can't
  raise the floor; not world-anchored). Only a world-anchored confirmation hardens.
- **B4** (design-move): the hardening **floor is external CHECKABILITY**, not consensus-as-authority.
  Scientific consensus = a high-prior *index of pre-checked facts*; the persona stays **corrigible**
  to new checkable evidence (even vs consensus) and **shows the check**. (Anti-conformity-engine.)
- **B5** (claim): **user-as-validator** with a *consequential* act (e.g. "I'll send this email") is
  world-anchored → can harden; **user-as-pleased** (affect/thumbs-up) → only narrows. (Sycophancy quarantine.)
- **B6** (design-move): an **adversarial grounded validator** (grounded in falsifiable facts +
  the user's own stated meta-intent, NOT in other perspectives) checks the user's validation to
  prevent rabbit-holes. It gates what **hardens** (advisory), never what the user can **do** (control).

### C. Persona-as-artifact (product + economics)
- **C1** (design-move): a persona is a **thin overlay** — the base carries school-level world
  knowledge (improving for free); the persona stores only the **delta**: context-selectors +
  base-lacking facts + style. NOT a knowledge base.
- **C2** (claim): **preferences index into facts, they don't compete with them.** Choosing Gmail
  (preference) doesn't make "gmail.com" subjective; it *selects the active context* within which
  facts are objective. ("Is it fact or perspective" = two questions: *which context* + *what's
  checkable-true in it*.) [truth ⊥ relevance]
- **C3** (design-move): exportable bundle = archetype + malleable subgraph (labeled perspective) +
  hardened fact-core (with provenance + bounds). The differentiator vs ClawSouls / RLHF.
- **C4** (economics/claim): malleable lane is **cheap+dense** (every interaction); hard lane is
  **expensive+sparse** (real external checks + provenance). A real persona is **mostly-taste around a
  small hard core** — honest *iff* the audit never lets cheap-dense masquerade as expensive-sparse.
- **C5** (claim): **"train a persona" = cultivate a retrievable confirmed-lesson corpus**
  (CBR/ACT-R, retrieval) — NOT gradient descent / weights.

### D. Belief lifecycle: retention + maintenance
- **D1** (design-move): **three retention lanes** — *active* (true+in-context), *dormant*
  (true+out-of-context: **archived not deleted**, re-activatable), *negative* (false: kept as
  what-not-to-do). Stale ≠ false.
- **D2** (design-move): periodic **maintenance/refresh** re-validates beliefs vs the world
  (truth-decay from world-drift — Gmail changes under you — distinct from relevance-decay).
- **D3** (claim): refresh cadence driven primarily by **volatility** (rate of world-change), strength
  secondary; **volatility is learnable from refresh history** (self-calibrating). [TMS / cache-TTL /
  continuous verification]
- **D4** (design-move): refresh must **re-touch the world** (introspection can't refresh); costs
  budget → prioritize by *volatility × stakes × staleness* (bounded resource).

### E. Provenance / security
- **E1** (claim): once a hardened weight **gates** an action, each survived-test is forgeable capital
  → needs an **authenticated minter** (signed provenance); until then advisory/narrowing only. [#273]
- **E2** (claim): provenance guards **both directions** — can't forge support to harden a false fact;
  can't forge a counterexample to demote a true one.

### F. Meta-frame
- **F1** (positioning): **not a pivot** — the plugin IS Jardin for the SDE domain (PR-merge signal);
  Jardin = the same substrate + swappable signal + mint/cultivate/export.
- **F2** (stance): **augmentation over automation** — the user authors durable grounded artifacts
  rather than passively consuming agent output.

## 3. Tensions I already suspect (seed the red-team — do not treat as exhaustive)

1. **Duhem–Quine / holism:** you can never falsify a single hypothesis in isolation (it's always
   hypothesis + auxiliary assumptions). Does A1–A7's clean "falsify the claim" survive this? Is the
   "independent severe test" operationalizable for an LLM, or hand-wavy?
2. **Can an LLM actually falsify?** B4/D4 require the persona to *reach the world and run a real
   check*. LLM tool-use is unreliable and hallucinates "checks." If the check itself is unreliable,
   the whole hard lane is sand.
3. **Are humans good validators?** B5/B6 lean on user-as-validator. Automation bias / rubber-stamping
   say humans approve badly under load. Does "consequential approval" actually separate from affect
   in practice, or is that a hopeful distinction?
4. **The economics may gut the value prop (C4):** if the hard lane is 5% of a real persona, Jardin is
   ~95% ClawSouls-with-extra-steps. Is there a first domain with *dense* falsifiers AND *consequential*
   approval AND enough users?
5. **Does it already exist?** MemGPT/Letta, generative-agents memory, character.ai, constitutional AI,
   TMS, AGM belief revision, CBR — is "two-lane auditable grounded persona" a real gap or reinvention?
6. **Base-model drift (C1):** "thin overlay on an improving base" — but the base also *changes*; a
   persona's hardened deltas may conflict with a new base, or the base may already know (then the
   delta is redundant) — is the overlay stable?
7. **The CS-bounds analogy (A4):** CS bounds are *proven* (eternal); ours are *evidential* (provisional).
   Is importing the representation a clean move or a category error that smuggles false rigor?
8. **Coherence of hysteresis vs falsification (A2 vs A6):** "one counterexample disproves" vs "resist
   demotion proportional to corroboration" — is the Lakatos reconciliation actually stable, or does it
   hide a knob (the demotion threshold) that, set wrong, becomes either dogma or hysteria?

## 4. Research findings + coherence verdict + gap list

8-lens hostile research board `wf_044ffbd0-236` (web-verified). **Verdict: the vision is
directionally coherent but survives as a NARROW FEATURE, not the novel product/substrate it claims.**
6/8 clusters WEAKENED, 2 COHERENT-WITH-GAPS, 0 BROKEN, 0 COHERENT. The board's explicit
recommendation: **do not build the substrate; run two go/no-go probes first** (§4.6).

| Cluster | Verdict | Headline |
|---|---|---|
| epistemology | WEAKENED | A1 falsifiability-gate REFUTED (demarcation problem); A3 severity = "rigor-flavored placeholder"; A6 cites Lakatos backwards |
| two-lane-signal | WEAKENED (→BROKEN at root) | B1 REFUTED (Popper demarcates science≠fact-vs-value); B3 REFUTED (dilation *widens* bands); B6 circular/Goodhart |
| llm-feasibility | WEAKENED | B4 the external check is among the LEAST reliable LLM ops; C1 "improving base" empirically false (GPT-4 97.6%→2.4% drift) |
| hci-validator | WEAKENED | humans rubber-stamp (5–36% automation-bias flips); B6 already-exists + reactance; C4 audit can *increase* misplaced trust |
| memory-systems | WEAKENED | D1–D4 = re-derived TMS/AGM/CBR/Cho-2003; "never delete" collides with the CBR swamping problem |
| security-provenance | COHERENT-WITH-GAPS | no import-trust model (CRITICAL); no privacy lane; E2 symmetry broken by *suppression* attacks |
| market-priorart | WEAKENED | A4 calibrated band is UNCOMPUTABLE by an LLM (FermiEval); economics worse than "ClawSouls+steps"; no moat/buyer |
| coherence-redteam | COHERENT-WITH-GAPS | **PRIOR-ART COLLAPSE: the core ships today in Cursor Bugbot + Letta.** Survives as a feature, not a substrate |

### 4.1 The three load-bearing problems

1. **The epistemic apparatus (A1–A7) is over-claimed and must be DEMOTED from "mechanism" to "UI
   metaphor."** A1's single falsifiability gate is the *textbook unsolved demarcation problem*
   (astrology is falsifiable; string theory isn't). The blueprint is *simultaneously* falsificationist
   (A1/A2/A6) and Bayesian-confirmationist (A3/A4) without noticing they're opposite sides of a live
   statistics war. A3 borrows Mayo's word "severe" without her error-probability machinery and leaves
   *both* "independent" and "severe" operationally undefined — **yet A3 is the function that produces
   every downstream number.** A6 reads Lakatos *backwards* (his hard core is *protected* from single
   counterexamples). A4's CS-bounds analogy is a category error (proven ≠ evidential bounds) **and**
   the band is *uncomputable*: LLMs cannot produce calibrated `[lower,upper]` intervals (FermiEval),
   so for an "auditable confidence" product the numeric band is *actively harmful* (manufactures false
   trust). B1 mis-routes math / historical / normative facts into the "no-truth taste" lane.

2. **The hard lane rests on two UNSOLVED problems treated as one-bullet design-moves.**
   (a) **A trustworthy external CHECK** — "run a real external check" is among the *least* reliable LLM
   operations (no frontier model >56% on τ-bench; research agents fabricate 3–13% of cited URLs). A
   fabricated check doesn't just fail — it **launders a hallucination into provenance-stamped truth**,
   inverting the value prop. (b) **Duhem–Quine attribution** — A6 demotion / A7 re-scope both require
   blaming a failed test on *one* conjunct, which confirmation holism says is impossible without a
   versioned-auxiliary control protocol the doc lacks.

3. **PRIOR-ART COLLAPSE — the "novel core" already ships.** The two-lane learning + consequential-act-
   as-signal + candidate→confirmed promotion loop is **Cursor Bugbot, in production at scale**
   ("each review is a natural experiment"; learns from whether the dev *acted*; promotes
   candidate→active; disables on negative signal). The persona-overlay memory + export substrate is
   **Letta/MemGPT** (memory blocks, hot/warm/cold tiers, cross-agent sharing). The belief lifecycle is
   **AGM belief revision + TMS** (1970s–80s; entrenchment already formalizes A6's "resist demotion",
   and TMS already solved A6's thrashing). C5 is **CBR/Memento** (settled, +4.7–9.6 pts). B6 is
   **cognitive forcing functions** (Buçinça/Gajos CSCW'21). B2 is **RLVR**. E1 is **Sigstore/SLSA**.
   The provenance/supersede story is **Zep/Graphiti/XMem**.

### 4.2 What genuinely survives (the only honest novelty)

A **per-claim "earned-by-EXTERNAL-world-confirmation vs declared" provenance label, carried into the
export** — distinct from XMem's "user-said-so" entrenchment. That's real and defensible. **It is a
feature, not a moat** (any incumbent — Letta, Bugbot — can add it). The board's reframe: *Power Loom
is the product; Jardin is a conjecture that the pattern generalizes.*

### 4.3 Top-5 existential risks (red-team — each with its fatal-evidence test)

- **R1 — no dense-falsifier domain.** FATAL IF a measured 5-domain screen finds *only* SDE clears
  {facts-the-base-lacks + a cheap check + a consequential act}. **This is the go/no-go.**
- **R2 — the check is an LLM.** FATAL IF the only checker for action-gating facts is a same-class LLM →
  provenance signs hallucinations. Fix: a **non-LLM / out-of-band oracle** (CI, typed API assertion,
  deterministic test, human-with-consequence) wherever a fact gates; LLM-asserted "I verified X" may
  **never** harden.
- **R3 — no moat.** FATAL IF the delta-table vs Bugbot/Letta shows ≤3 non-incumbent rows (the moat is
  a feature).
- **R4 — Duhem–Quine makes A6/A7 unimplementable.** FATAL IF no versioned-auxiliary attribution
  protocol → true facts get spuriously demoted by flaky tools.
- **R5 — human rubber-stamps.** FATAL IF, on a seeded rabbit-hole benchmark, B6 (itself an LLM) can't
  beat a no-op baseline at catching enthusiastic-cultivator over-approval.

### 4.4 Must-fix gaps (CRITICAL), with the convergent fixes

- **Pick ONE epistemic engine + define severity/independence concretely.** The buildable choice:
  Mayo-style error-statistics severity = a *pre-registered, machine-checkable pass-condition a wrong
  claim would have failed*. NOT a confirmation count.
- **Gate hardening on check-reliability tiers.** Deterministic/tool-of-record (compiler, signed API,
  PR-merge) may harden; LLM-asserted checks **never** harden → they only narrow, with an ABSTAIN path.
- **Drop the numeric `[lower,upper]` band; use a discrete external-check ledger** ("confirmed by N
  independent external checks — here are the links"; counts + provenance, no synthetic number).
- **Per-user/per-domain validator error model.** Estimate false-accept/false-reject vs a ground-truth
  oracle on planted gold items; propagate into the hardening math. (Adds a 4th launch-domain
  requirement — a *cheap ground-truth oracle* — which affect-domains least satisfy and SDE/PR-merge meets.)
- **Import-side trust model.** An imported fact-core enters **dormant/advisory, hardness RESET**, and
  must re-earn its floor against the *importer's* checks (exporter provenance ≠ local truth).
- **Versioned-auxiliary attribution + base-version binding.** Bind every delta to the base
  model+version; on base change, re-probe (redundant→demote, conflicting→flag); a failed re-test
  re-runs the *auxiliaries* (was it the tool/harness?) before blaming the fact.
- **Privacy lane.** Personal-fact-core export-excluded/redacted/encrypted by default (prior art: Opal/MIRIX).

### 4.5 Meta-validation: the plugin IS the surviving instantiation

The board independently confirms the Power Loom plugin is the one domain that clears the bar SDE
supplies dense *private* falsifiers (code lessons the base lacks), a **cheap non-LLM oracle**
(CI/tests/the harness-computed `BEHAVIORAL_PASS`, never LLM-self-asserted), and a **consequential,
rubber-stamp-resistant** act (the external maintainer merge). Our standing discipline is *exactly*
what the critique prescribes: OQ-NS-6 ("only a world-anchored merge HARDENS"), advisory-until-it-gates
(E1), the authenticated minter (#273), the per-wave oracle gate. The critique even validates our
*humility*: "the project's own OQ-NS-6 says even PR-merge only narrows" — and demands a *second*
world-anchored signal that *provably hardens* before B2's "swappable signal" generalization can be claimed.

### 4.6 Recommendation (the board's, adopted)

**Do NOT build the Jardin substrate.** Before any build, run two cheap probes as a hard go/no-go:
1. **R1 domain-screen** — score 5 candidate domains on real data: (i) fraction of useful facts the
   current base does NOT know, (ii) availability of a *cheap non-LLM* check, (iii) a consequential
   approval act that resists rubber-stamping, (iv) payer count. If *only* SDE clears it → Jardin is a
   renaming of the plugin; stop.
2. **R3 delta-table** — rows = {two-lane, act-as-signal, candidate→confirmed, share/export, fact-vs-
   taste typing, provenance/independence, bounded-band} × cols = {Bugbot, Letta, TMS/AGM, ours}. If
   ≤3 rows are non-incumbent, the moat is a feature.

Only if *both* pass: prototype ONLY the **typing + provenance overlay** on Letta memory blocks, with a
**non-LLM checker** (R2) + a **versioned-auxiliary attribution protocol** (R4), and **benchmark B6
against a no-op** (R5) before it gates anything. Demote A1–A7 (Popper/Lakatos/CS-bounds) from
mechanism to UI metaphor.

**Net for our actual roadmap:** this stays a thought-experiment, OFF the ③ critical path. Its real
yield is (a) confirming the plugin is the defensible instantiation, and (b) sharpening one reusable
principle worth importing back into Power Loom: **only an out-of-band, non-LLM, consequential oracle
may HARDEN; everything an LLM asserts can only NARROW** — the cleanest statement yet of OQ-NS-6.

## 5. Construction attempt (blue-team) — can the critics SAVE it?

Board `wf_60680d9f-10b`: the same 7 lenses flipped from red-team to **constructive engineer**
(strongest workarounds to their own findings) + a synthesis architect. **Result: the construction
attempt PROVES §4's verdict rather than asserting it — and proves it more strongly, because the experts
who *wanted* to save it couldn't without collapsing it.** Cluster verdicts: **5/7 COLLAPSES-TO-PLUGIN**
(epistemology, two-lane-signal, hci-validator, memory-systems, market-moat-domain); **2/7
FIXABLE-WITH-COST** (llm-feasibility, security-provenance) where *the cost IS the collapse*.
**Synthesis: RECONSTITUTES = COLLAPSES-TO-PRIORART-PLUS-LABEL.**

### 5.1 The fixes do NOT compose — four pairs actively break each other
- the calibrated validator must be **mandatory-to-gate XOR dismissable-for-reactance** (an internal impossibility);
- the **privacy scrub** and the **honest audit** each independently empty the saleable export;
- **import-reset** forces a trusted-verifier *registry* onto exactly the terrain market proved has no moat;
- **base-binding + suppression-proof mandatory-refresh** compound into a standing cost that negates the "free knowledge" economics.

### 5.2 …but every fix CONVERGES on one engine (the strong positive signal)
Seven independent engineers arrived at the SAME surviving object: an **append-only, oracle-gated
"hardening-of-record" ledger** + a per-edge **earned-by-non-LLM-oracle vs declared** provenance TYPE,
on a *borrowed* temporal-KG memory substrate (Letta/Graphiti: supersede-not-delete + sleep-time
revalidation + half-life decay). Four invariants survive every fix at once: (1) only a **non-LLM
out-of-band oracle** may move an edge to "earned"; LLM-asserted → NARROW + **ABSTAIN by default**; (2)
hardness **provably decays** when world-re-touch stops (suppression costs hardness); (3) the earned tag
is the sort-key for eviction + AGM entrenchment + a stakes-gated min-refresh floor; (4) **import RESETS
hardness to zero**. The convergence is the evidence the surviving shape is real, not arbitrary — but it
is a FEATURE any incumbent adds in a sprint, whose one defensible home is the plugin we already ship.

### 5.3 What survives keeps one thing, gives up everything that made it a "substrate"
- **KEEPS:** the single honest novelty (earned-vs-declared provenance label, carried into export) +
  OQ-NS-6 verbatim.
- **GIVES UP:** generality (signal-agnostic dies — only the CI-oracle family hardens; even
  policy-as-code is an SDE *sibling*, not a second world), the A1–A7 apparatus (→ UI metaphor), the
  "free knowledge" economics (→ a standing oracle bill), the P2P "hand anyone a hardened persona" (→ a
  trusted-verifier registry = incumbent turf), and the saleable export (privacy-scrub + honest-audit →
  a mostly-"UNVERIFIED" humility UI). **In every affect domain the "earned" column is permanently empty
  → observationally identical to Letta/ClawSouls.**

### 5.4 The biggest remaining risk is our OWN open #273
Even in the survivor, the earned tag proves **INTEGRITY, not PROVENANCE**: a co-forged edge inflates
the confirmed weight (v3.11 W3's third face). Tolerable only while shadow/advisory; **the moment it
GATES (the ③.2 trigger) it REQUIRES the authenticated minter** (#360 / a signed or kernel-owned
writer), not a store re-hash. The blue-team independently re-derived our standing residual as the
load-bearing risk.

### 5.5 Recommendation (adopted)
1. **Do NOT build standalone Jardin** — now proven both by demolition (§4) and by failed construction (§5).
2. **Extract the survivor as a MODULE inside Power Loom:** the oracle-gated *hardening-of-record*
   ledger + the earned-vs-declared provenance type, counting ONLY the harness `BEHAVIORAL_PASS` /
   external-maintainer merge, with an explicit ABSTAIN (LLM-asserted → NARROW only). Buildable now;
   the moat is the plugin's workflow-embedding, not the label.
3. **Close integrity≠provenance (the minter) before that ledger gates** — the ③.2 precondition.
4. **Treat the consumer/affect-persona vision as KILLED** (the "earned" column is permanently empty there).
5. If testing generality at all: add the **calibration-oracle as a 4th R1 screen condition**;
   policy-as-code/IaC-security is the only non-SDE probe candidate, pursued as a dev-tooling SKU, **not**
   as evidence the pattern generalizes.
6. **Import the reusable principle regardless** (costs nothing):
   > **OQ-NS-6, sharpest form:** a check may HARDEN only up to its *measured, pre-registered false-pass
   > rate against a non-LLM oracle*; absent that measurement it may only NARROW.
