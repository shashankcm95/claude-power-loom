---
kb_id: hets/usability-adversary
version: 1
tags:
  - hets
  - usability
  - documentation
  - heuristics
  - lens
  - foundational
  - quality-baseline
sources_consulted:
  - "Jakob Nielsen — 10 Usability Heuristics for User Interface Design (Nielsen Norman Group, nngroup.com/articles/ten-usability-heuristics) — developed 1990 w/ Rolf Molich, refined 1994 via factor analysis of 249 problems, language refresh 2020"
  - "Cognitive Walkthrough — Clayton Lewis et al. (1990) + Wharton, Rieman, Lewis & Polson, 'The Cognitive Walkthrough Method: A Practitioner's Guide' in Nielsen & Mack (eds.) Usability Inspection Methods (Wiley, 1994); NN/g — Evaluate Interface Learnability with Cognitive Walkthroughs (nngroup.com/articles/cognitive-walkthroughs)"
  - "Steve Krug — Don't Make Me Think (New Riders, 2000) + Don't Make Me Think, Revisited (2014) — Krug's First Law of Usability ('self-evident'); scanning / satisficing / muddling through; the trunk test"
  - "Don Norman — The Design of Everyday Things (Basic Books, 1988; revised & expanded 2013) — affordances (after J.J. Gibson), signifiers (added 2013), mapping, feedback, constraints, conceptual model, the Gulfs of Execution and Evaluation"
  - "Colin Camerer, George Loewenstein & Martin Weber — 'The Curse of Knowledge in Economic Settings: An Experimental Analysis', Journal of Political Economy 97(5):1232-1254 (1989) — coined 'curse of knowledge'; Elizabeth Newton (1990) tappers-and-listeners study; popularized by Heath & Heath, Made to Stick (Random House, 2007)"
  - "Tim Neusesser & Evan Sunwall — Error-Message Guidelines (Nielsen Norman Group, 2023, nngroup.com/articles/error-message-guidelines) — human-readable, precise, constructive, non-blaming, visible, low interaction-cost recovery"
related:
  - web-dev/accessibility-essentials
  - architecture/discipline/error-handling-discipline
  - architecture/discipline/evidence-and-premise-discipline
  - architecture/discipline/refusal-patterns
  - hets/spawn-conventions
  - design-pushback/_index
status: active
---

## Summary

**Principle**: A doc / error / flow is **broken** if a first-time reader with zero author-context cannot succeed at the task — the same defect class as a crash, not a polish pass. The default failure is the **curse of knowledge** (Camerer/Loewenstein/Weber 1989): the author cannot un-know what they know, so they skip the rung the newcomer needs.
**The frame (Nielsen 1994)**: the 10 usability heuristics are the reflexive checklist; **match the real world**, **recognition over recall**, **help recognize/recover from errors**, **help & documentation** are the load-bearing four for prose/CLI artifacts.
**The method (Lewis 1990 / Wharton 1994)**: the **cognitive walkthrough** — step the task as a newcomer and ask, at each step: (1) will they try the right thing? (2) will they notice the action is available? (3) will they connect the action to their goal? (4) after acting, will they see progress?
**The test (Krug 2000)**: is each step **self-evident**? Users **scan, satisfice, and muddle through** — they do not read carefully, so anywhere the reader must *guess, backtrack, or read source to proceed* is a friction smell.
**Sources**: Nielsen 10 Heuristics + Cognitive Walkthrough (Lewis/Wharton) + Krug *Don't Make Me Think* + Norman *Design of Everyday Things* + curse-of-knowledge (Camerer et al.) + NN/g error-message guidelines.
**Substrate**: the canonical referral for the `02-confused-user` HETS persona (the usability adversary) — closes its six self-declared KB-gap instincts (read-as-a-first-timer, unexplained-jargon, first-run-friction, the-undocumented-step, friction-smell, two-readers).

## Quick Reference

**Nielsen's 10 Usability Heuristics** (Jakob Nielsen, NN/g, 1994; verbatim names) — the heuristics that bite hardest on docs / errors / CLI are starred:

| # | Heuristic | One-line for a doc/CLI/error artifact |
|---|-----------|----------------------------------------|
| 1 | Visibility of system status | The reader always knows what state they're in and what just happened (build running? done? failed?). |
| 2 | Match between system and the real world ⭐ | Use the reader's words, not internal jargon; follow real-world conventions. |
| 3 | User control and freedom | A clearly-marked "undo" / exit / way back from a wrong step. |
| 4 | Consistency and standards | The same word means the same thing everywhere; follow platform conventions. |
| 5 | Error prevention | Make the wrong action hard to take in the first place (constraints, confirmations). |
| 6 | Recognition rather than recall ⭐ | Show the option; don't make the reader hold it in their head from three steps ago. |
| 7 | Flexibility and efficiency of use ⭐ | Shortcuts for the expert that don't get in the newcomer's way (the `two-readers` tension). |
| 8 | Aesthetic and minimalist design | Cut the irrelevant — every extra word competes with the load-bearing one. |
| 9 | Help users recognize, diagnose, recover from errors ⭐ | Error says **what** went wrong, **why**, and the **next action** — in plain language. |
| 10 | Help and documentation ⭐ | Searchable, task-focused, concrete steps; ideally the reader never needs it. |

**The Cognitive Walkthrough four questions** (Lewis 1990; Wharton/Rieman/Lewis/Polson 1994) — ask at **every** step of the task, as the newcomer:

1. Will the user try to achieve the right effect? *(do they even know this is the step?)*
2. Will the user notice the correct action is available? *(is it visible / discoverable?)*
3. Will the user associate the correct action with the effect they want? *(does the label/name map to intent?)*
4. After the action, will the user see that progress was made toward the goal? *(feedback — Norman's Gulf of Evaluation)*

**Krug's First Law** (Krug 2000): *"Don't make me think"* — each step should be **self-evident**. Corollary facts about real readers: they **scan** (F-pattern, not full reads), **satisfice** (click the first plausible option, not the best), and **muddle through** (never read the manual). Design for that reader.

**Norman's vocabulary** (Norman 1988/2013) — name the mechanism when you flag it:

| Term | Meaning | Doc/CLI failure when absent |
|------|---------|------------------------------|
| Affordance | what an object *lets* you do | a step that's possible but the artifact never reveals you can do it |
| Signifier (2013) | the perceivable cue that the affordance exists | the flag exists but nothing tells the reader it does |
| Mapping | relationship between control and effect | command name doesn't map to what it does |
| Feedback | confirmation that an action took effect | run a command, get silence — did it work? |
| Conceptual model | the reader's mental model of how it works | doc never gives one, so the reader can't predict the next step |
| Gulf of Execution | gap between intent and knowing what to do | "I want X but can't tell how to start" |
| Gulf of Evaluation | gap between system state and the reader understanding it | "it printed something but I can't tell if I succeeded" |

**Top friction smells** (any one is a finding):

- The words **"simply" / "just" / "obviously" / "of course"** — reliably mark the spot the author found easy and therefore skipped.
- An **undefined term, acronym, or `code-token`** on first use — a wall the reader can't even ask their way past (curse of knowledge made literal).
- An error that names a condition but **no remedy** — strands the reader (violates Heuristic 9).
- A gap between step N and N+1 where the **author's hands fill in an unwritten move** (the-undocumented-step).
- An **unstated prerequisite** (install, env var, account) before step 1 — a guaranteed cold-start dead-stop.
- Anywhere the reader must **guess, backtrack, or read the source** to proceed.

**Apply when**: reviewing any newcomer-facing artifact — README, install/setup path, CLI help, error strings, onboarding flow, tutorial.
**Skip when**: the artifact is an internal note for an audience that genuinely shares the author's context (an ADR for maintainers, a code comment) — there, shared jargon is correct, not friction.

## Intent

Most unusable docs and dead-end errors are not written by authors who *decided* to confuse the reader — they are written by authors who **cannot simulate not knowing what they know**. That is not a character flaw; it is a measurable cognitive bias. Camerer, Loewenstein and Weber named it the *curse of knowledge* in 1989, and Elizabeth Newton's 1990 tappers-and-listeners study made it vivid: people tapping a famous song's rhythm predicted listeners would recognize it ~50% of the time; listeners actually got ~2.5%. The tapper hears the melody in their head and cannot un-hear it. The author of a setup guide hears the implicit `npm install` step in their head and cannot un-hear it — so they don't write it down, and the newcomer hits a wall the author literally cannot perceive.

The usability-adversary lens exists to supply, by procedure, the empathy the curse of knowledge denies the author. It is not taste or opinion; it is a **repeatable inspection** built from three load-bearing techniques: Nielsen's **heuristic evaluation** (does the artifact violate a known rule of thumb?), the **cognitive walkthrough** (step the task as the newcomer and ask the four questions at each step), and Krug's **self-evidence test** (would the average scanning, satisficing reader know what this is and what to do, without thinking?). The output is not "I don't like this" — it is "a first-timer gets stuck *here*, because of *this* named mechanism, and the fix is *that*."

The goal is to convert "the docs are confusing" from a vague complaint into a set of **checkable, sourced, severity-graded findings** that an author can act on before the artifact ships to people who can't ask them what they meant.

## The Principle

> "If you have room in your head for only one usability rule, this should be it ... When I look at a Web page it should be self-evident. Obvious. Self-explanatory." — Steve Krug, *Don't Make Me Think* (2000)

And the cognitive-bias root cause it is fighting:

> The curse of knowledge: "better-informed agents are unable to ignore … private information even when it is in their interest to do so." — Camerer, Loewenstein & Weber, *Journal of Political Economy* 97(5), 1989

Reformulated for the lens:

- **You are not the reader.** Your environment is pre-warmed, your jargon is fluent, the implicit steps live in your hands. The newcomer has none of that. Drop *all* author-context before reading; if you only understand a step because you already know the answer, it is not written for a newcomer.
- **Heuristics catch the known failure shapes.** Nielsen's 10 are a factor-analyzed checklist (derived from 249 real usability problems) — running an artifact against them surfaces violations *without* a user test. They are the cheapest first pass.
- **The walkthrough catches the path failures.** Heuristics evaluate the artifact statically; the cognitive walkthrough traces the *task*, asking at each step whether the newcomer forms the right intent, finds the action, maps it to their goal, and sees the result. It is purpose-built for **learnability** — exactly the newcomer's concern.
- **Self-evidence is the bar; scanning is the reality.** Krug's readers don't read — they scan (F-pattern), satisfice (first plausible click), and muddle through (never read help). An artifact that only works if read carefully and completely has already lost.
- **Name the mechanism (Norman).** When you flag a friction point, attribute it: a missing signifier, a bad mapping, an absent feedback loop, a Gulf of Evaluation. Naming makes the finding legible and the fix obvious.

## Named instincts for the confused-user lens

These six instincts are the `02-confused-user` persona's self-declared **KB-gaps** (`packages/runtime/personas/02-confused-user.md` names them verbatim as "no doc yet"). This section is their canonical referral: when the lens fires one of these instincts on an artifact, cite the heuristic/method here rather than re-deriving it.

### read-as-a-first-timer (the cognitive walkthrough)

Approach the doc/UI with **zero prior context** and run Lewis/Wharton's cognitive walkthrough: step the task the way your non-technical coworker would, and at each step ask the four questions — will they try the right thing, notice the action, connect it to their goal, and see progress afterward? The instinct's discipline is *dropping author-context*: if a step only parses because you already know the outcome, it fails Q1/Q3 for a real newcomer. Quote the exact step where the walkthrough breaks and name which of the four questions failed.

### unexplained-jargon (the curse of knowledge, made literal)

Flag every term, acronym, or `code-token` that is neither common knowledge nor **defined on first use**. This is the curse of knowledge at its most concrete (Camerer et al. 1989) and a direct violation of Nielsen Heuristic 2 (*match between system and the real world* — "use words familiar to the user"). An undefined term is worse than a hard concept: the reader can't even formulate the question to ask, because they lack the word for the gap. Quote the first naked occurrence and state what context the author assumed the reader already had.

### first-run-friction (the cold-start path is where users churn)

The **install / setup / first-use path** is the single highest-stakes surface, because it's where a newcomer with the least context meets the most unstated state — and where they abandon. The author's machine is pre-warmed (deps installed, env vars set, accounts created); the newcomer's is bare. Trace the **cold start on a clean machine**, not the author's warm one. Every unstated prerequisite (Nielsen Heuristic 5, *error prevention*, failing *upstream*) is a guaranteed dead-stop. This is the instinct most worth running first on any onboarding artifact.

### the-undocumented-step (the implicit move the author's hands fill in)

Between step N and step N+1, find the **unwritten rung** the author performs by reflex and never wrote down — the `cd` into the right directory, the "restart the server," the "now reload the page." This is the curse of knowledge expressed as an *omission* rather than a confusing presence: the author's hands do it automatically, so it is invisible to them and a chasm to the reader (Norman's Gulf of Execution — the reader knows the goal but the bridge to the action is missing). Name the missing rung and where it belongs.

### friction-smell (anywhere the reader must guess, backtrack, or read source)

A generalized detector: anywhere the reader has to **guess** which option is right, **backtrack** after a wrong turn, or **read the source code** to learn what a doc should have told them. The reliable lexical marker is the hedge word — **"simply," "just," "obviously," "of course"** — which authors deploy precisely at the step they found easy and therefore under-explained. The deeper signal is any violation of Krug's self-evidence bar: if the average scanning, satisficing reader would pause to *think*, that pause is the smell. Krug's **trunk test** is the operational form — dropped onto any page/screen cold, can the reader tell where they are and what they can do?

### two-readers (serve the first-timer without boring the expert)

A single artifact often serves **both** a first-timer and an expert at once — and an artifact tuned for only one loses the other (dense shorthand strands the newcomer; over-explanation insults the expert). This is the tension Nielsen Heuristic 7 (*flexibility and efficiency of use*) resolves: **accelerators for the expert that stay out of the newcomer's way.** The pattern: optimize the *default* reading path for the first-timer's success (linear, complete, self-evident), and provide expert shortcuts as *skippable* layers (a "TL;DR" / quick-start block up top, collapsible "advanced" sections, a cheat-sheet appendix) the newcomer can ignore. Krug's scanning model is the reconciler — good headings and visual hierarchy let the expert *skip to* their part while the newcomer reads straight through. The failure is forcing one reader to pay the other's cost.

## Substrate-Specific Examples

> **Honest scope note**: Power Loom is a CLI/kernel substrate with a large surface of newcomer-facing prose (READMEs, install path, CLI help, error strings, ROADMAP, KB docs). The usability-adversary lens applies to *those artifacts* — it is a **clarity/legibility** gate, distinct from (and complementary to) technical accessibility (`web-dev/accessibility-essentials`) and from code correctness.

### `02-confused-user` — this doc is the lens's missing KB

The `02-confused-user` persona (`packages/runtime/personas/02-confused-user.md`) is *the* usability adversary: it "read[s] documentation, error messages, and UI flows as someone unfamiliar with the system." Its `## Mindset` enumerates eleven named instincts, and its `Instinct → KB referral` block explicitly lists six as **KB-gaps** ("no doc yet — usability has thin KB coverage"): read-as-a-first-timer, unexplained-jargon, first-run-friction, the-undocumented-step, friction-smell, two-readers. This doc closes exactly that gap — the persona's other five instincts already referral to existing KB (`error-handling-discipline` for opaque-error-message/dead-end-detection; `refusal-patterns` for happy-path-assumption-exposure; `design-pushback/_index` for doc-vs-reality/hidden-prerequisite), and this file is the named referral for the six that had none.

### The install / first-run path is the substrate's highest-friction surface

The codified pre-push ritual `bash install.sh --hooks --test` and the "fresh CI checkout" dogfood discipline (the H.7.15 / H.7.8 install-bug class in the workflow rules) are *exactly* the `first-run-friction` instinct applied to this repo: bugs shipped because "the original phases never ran the new infrastructure against a fresh environment" — the author's warm machine hid an unstated-prerequisite dead-stop that only a cold-start trace would catch. The usability adversary reading `install.sh`'s docs would flag the same gap the CI bug later proved.

### Error strings as a Heuristic-9 / `error-handling-discipline` gate

The substrate's hooks emit forcing instructions and block reasons (e.g. `[KB-DOC-INVALID]`, `[ROUTE-DECISION-UNCERTAIN]`). The usability-adversary lens reads each as a newcomer hitting it cold: does it say **what** failed, **why**, and the **next action** (NN/g 2023 + Nielsen Heuristic 9)? The `[KB-DOC-INVALID]` reason is a positive example — it names the violated field, cites `_PRINCIPLES.md` line numbers, and states the fix plus the bypass env var. That is the constructive, non-blaming, low-interaction-cost recovery the guidelines prescribe; an error that printed only `record-uncomputable` with no remedy would fail the same gate.

### Distinct from accessibility (the complementary lens)

`web-dev/accessibility-essentials` already draws this boundary from the other side: a button labeled "Process" passes a name-role-value *accessibility* check but fails the *clarity* check (process **what?**); an error with `aria-live="assertive"` is technically perceivable yet still strands the user if it says "Error 0x4." Accessibility owns machine-perceivability (POUR); this lens owns human-understandability. They overlap at WCAG's *Understandable* edge (helpful errors, predictable labels) but neither subsumes the other — run both on user-facing UI.

## Tension with Other Principles

### Self-evidence (newcomer) vs efficiency (expert) — the two-readers tension

Making everything self-evident for the first-timer can bloat the path the expert wants to fly through. **Resolution**: Nielsen Heuristic 7 — accelerators that don't penalize the novice. Optimize the default linear path for the newcomer; layer expert shortcuts as skippable (quick-start block, collapsible advanced sections). Krug's scanning model lets the expert skip *to* their part via headings while the newcomer reads straight through. This is a `trade-off-articulation` decision: state which reader the default serves and how the other is accommodated, don't silently pick one.

### Completeness vs aesthetic-and-minimalist design

The instinct to document every step collides with Nielsen Heuristic 8 (*minimalist design* — "every extra unit of information competes with the relevant units"). **Resolution**: the bar is the cognitive walkthrough, not exhaustiveness. Document the steps a newcomer's walkthrough actually needs (the unwritten rungs, the prerequisites); cut the steps that are genuine common knowledge for the artifact's real audience. Padding is itself a friction smell — it buries the load-bearing instruction.

### Clarity-adversary vs evidence discipline (don't invent friction)

An over-eager usability adversary "finds" confusion a real reader wouldn't hit, generating noise. **Resolution**: the persona's own >80%-confidence rule, which is `evidence-and-premise-discipline` applied to clarity — quote the *exact* passage, trace the claim to the source that produces the behavior (never critique from the artifact's own summary), and rate accuracy against what the system *actually* does. A false friction-accusation is noise, and a confident-but-wrong "this is unclear" is itself a curse-of-knowledge failure in the reviewer.

### Jargon-flagging vs audience-appropriate shorthand

Not every undefined term is a defect — an ADR for maintainers *should* use `post_state_hash` without re-defining it. **Resolution**: the test is the artifact's *real* audience (Nielsen Heuristic 2 — match the *user's* world). For newcomer-facing artifacts, define on first use; for genuinely internal artifacts, shared jargon is correct. Misjudging the audience in either direction is the failure.

## When to use this framing

- **Any newcomer-facing artifact before it ships** — README, install/setup guide, CLI `--help`, onboarding tutorial, error strings, a first-run flow.
- **When "the docs are confusing" surfaces** — convert the vague complaint into a heuristic-graded, walkthrough-traced finding list.
- **Reviewing error messages and dead-end states** — run each against Heuristic 9 + the NN/g error guidelines (what/why/next-action, non-blaming, low-cost recovery).
- **Cold-start / fresh-environment changes** — install scripts, CI bootstrap, "getting started" paths: trace the bare machine, not the warm one.

## When NOT to use this framing (or apply with caveat)

- **Genuinely internal artifacts for a context-sharing audience** — an ADR, a code comment, a maintainer-only note. Shared jargon is correct there; flagging it is theater (and itself an audience-misjudgment failure).
- **Code correctness / security / performance** — those are the architect / hacker / code-reviewer lenses. The usability adversary owns *clarity*, not whether the code is right or safe. Don't stretch it to cover defects it isn't built for.
- **Machine-perceivability (assistive tech)** — that is `web-dev/accessibility-essentials` (POUR). Adjacent and complementary, but a different gate; a label can be programmatically perfect and humanly useless, and vice versa.
- **When you'd be inventing friction** — if you can't quote the exact passage and name a real newcomer who'd get stuck, you're below the >80%-confidence bar; stay silent rather than add noise.

## Failure modes when applied incorrectly

- **Critiquing from memory / the artifact's own summary** — rating a doc confusing without reading the passage that produces the behavior. *Fix*: quote the `file:line`; trace the claim to source (the persona's hard constraint).
- **Inventing confusion a real reader wouldn't hit** — friction theater that drowns the real findings. *Fix*: the >80%-confidence rule; name the specific reader and the specific stuck-point.
- **Author rebuttal as resolution** — "but it's obvious" is the curse of knowledge talking; the author is the *least* able person to judge newcomer-obviousness. *Fix*: trust the walkthrough/the test reader over the author's intuition.
- **Heuristics as a box-tick** — listing all 10 heuristics with no concrete violation. *Fix*: heuristics are a *lens to find* violations; report the violation + the stuck-point, not the checklist.
- **Optimizing for one reader only** — dense shorthand that strands the newcomer, or over-explanation that insults the expert. *Fix*: the two-readers pattern (default for the newcomer, skippable layers for the expert).
- **Confusing clarity with accessibility** — "fixed the a11y" by adding `aria-label="Process"` while the *word* "Process" is still humanly meaningless. *Fix*: run both lenses; they don't subsume each other.

## Tests / verification

A heuristic pass catches a floor; the cognitive walkthrough and a real test reader catch the path failures heuristics miss.

**Static (the floor)**:

- **Heuristic evaluation** — read the artifact against Nielsen's 10; report each *violation* with the exact passage and the heuristic number. Cheapest first pass; no test user required.
- **Jargon sweep** — list every term/acronym/`code-token` and mark each *defined-on-first-use* / *common-knowledge* / **naked**. Every naked one (for a newcomer audience) is a finding.
- **Hedge-word grep** — search for "simply" / "just" / "obviously" / "of course"; inspect each as a candidate skipped step.

**The walkthrough (the path)**:

- **Cognitive walkthrough** — pick the artifact's primary task; step it as a newcomer; at *each* step record whether Q1–Q4 hold. The first step where one fails is the friction point; name which question failed.
- **Cold-start trace** — for any install/setup/first-run artifact, follow it on a *bare* environment (or simulate one explicitly): every step that assumes pre-existing state is a `first-run-friction` finding.

**The reader (the truth)**:

- **The load-bearing test** — *can a person who has never seen this complete the primary task using only the artifact, without asking the author?* If not, it is broken for newcomers — a HIGH finding, the severity of a crash, not a nit.
- **Krug's trunk test** — drop onto any single page/screen/CLI output cold: can the reader tell where they are, what this is, and what they can do next? Failure = a `dead-end` / lost-context finding.
- **Severity grading** (the persona's scale): HIGH = a reader gives up or does the wrong thing; MEDIUM = a reader guesses but probably guesses right; LOW = a clarity nit.

## Related Patterns

- [web-dev/accessibility-essentials](../web-dev/accessibility-essentials.md) — the complementary lens: machine-perceivability (POUR) vs this doc's human-understandability; overlap at WCAG *Understandable*, neither subsumes the other.
- [architecture/discipline/error-handling-discipline](../architecture/discipline/error-handling-discipline.md) — what a good error owes the reader (cause, context, next action); the referral for the persona's opaque-error-message / dead-end-detection instincts (Nielsen Heuristic 9).
- [architecture/discipline/evidence-and-premise-discipline](../architecture/discipline/evidence-and-premise-discipline.md) — the >80%-confidence, quote-the-source rule that keeps friction-finding honest; trace the claim, don't invent confusion.
- [architecture/discipline/refusal-patterns](../architecture/discipline/refusal-patterns.md) — the off-happy-path behavior the happy-path-assumption-exposure instinct probes; graceful failure is a usability property.
- [hets/spawn-conventions](spawn-conventions.md) — the output-format + frontmatter contract for the `02-confused-user` spawn that consumes this doc.
- [design-pushback/_index](../design-pushback/_index.md) — the proactive-critique catalog; the referral for the persona's doc-vs-reality / hidden-prerequisite instincts.

## Sources

Authored by multi-source synthesis of verified, canonical usability literature (each web source verified during authoring):

1. **Jakob Nielsen — 10 Usability Heuristics for User Interface Design** (Nielsen Norman Group, nngroup.com/articles/ten-usability-heuristics). Developed 1990 with Rolf Molich; refined to the canonical 10 in 1994 via a factor analysis of 249 usability problems; language refresh 2020. All ten names quoted verbatim. The default heuristic-evaluation checklist for surfacing usability problems without a user test.
2. **Cognitive Walkthrough** — introduced by **Clayton Lewis and colleagues (1990)** for walk-up-and-use systems (kiosks, ATMs), refined by **Cathleen Wharton, John Rieman, Clayton Lewis & Peter Polson, "The Cognitive Walkthrough Method: A Practitioner's Guide,"** in Nielsen & Mack (eds.), *Usability Inspection Methods* (Wiley, 1994). The four per-step questions are quoted from NN/g's *Evaluate Interface Learnability with Cognitive Walkthroughs* (nngroup.com/articles/cognitive-walkthroughs). The method targets **learnability** — the newcomer's exact concern.
3. **Steve Krug — *Don't Make Me Think*** (New Riders, 2000) and *Don't Make Me Think, Revisited* (2014). Krug's First Law of Usability ("self-evident / obvious / self-explanatory"); the empirical reader model — users **scan** (F-pattern), **satisfice** (first plausible click), and **muddle through**; and the **trunk test** for cold-context legibility.
4. **Don Norman — *The Design of Everyday Things*** (Basic Books, 1988; revised & expanded 2013). Affordances (borrowed from J.J. Gibson's ecological psychology), **signifiers** (added in the 2013 edition to clarify affordances), mapping, feedback, constraints, conceptual model, and the **Gulfs of Execution and Evaluation** — the vocabulary for naming *which* mechanism a friction point breaks.
5. **Colin Camerer, George Loewenstein & Martin Weber — "The Curse of Knowledge in Economic Settings: An Experimental Analysis,"** *Journal of Political Economy* 97(5):1232–1254 (1989). Coined *curse of knowledge*: better-informed agents cannot ignore their private information when judging the less-informed. Vivified by **Elizabeth Newton's (1990)** Stanford tappers-and-listeners study and popularized by **Chip & Dan Heath, *Made to Stick*** (Random House, 2007) + their 2006 *Harvard Business Review* article. The root-cause bias the entire lens compensates for.
6. **Tim Neusesser & Evan Sunwall — Error-Message Guidelines** (Nielsen Norman Group, 2023, nngroup.com/articles/error-message-guidelines). Error messages must be **human-readable** (no jargon), **precise** (concretely describe the issue), **constructive** (offer a remedy at low interaction cost), **non-blaming** (positive tone), and **visible** (adjacent to where the error occurred). The operational backing for the Heuristic-9 checks.

Substrate grounding cites the live persona definition `packages/runtime/personas/02-confused-user.md` (the usability adversary; its eleven named instincts and the six KB-gaps this doc closes) and its contract `packages/runtime/contracts/02-confused-user.contract.json`, plus the install/CI cold-start discipline codified in the workflow rules (H.7.8 / H.7.15 fresh-environment bug class).

## Phase

Authored: kb authoring batch (single-lens KB-gap harvest, v3.1-era). The canonical usability/clarity referral for the `02-confused-user` HETS persona — closes the six named instincts the persona file explicitly flags as having "no doc yet" (read-as-a-first-timer, unexplained-jargon, first-run-friction, the-undocumented-step, friction-smell, two-readers). Multi-source synthesis from six verified canonical sources spanning heuristic evaluation (Nielsen), inspection method (Lewis/Wharton cognitive walkthrough), web usability (Krug), interaction design (Norman), the root-cause cognitive bias (Camerer/Loewenstein/Weber), and error-message practice (NN/g). Deliberately scoped as a **clarity/legibility** gate, explicitly distinguished from technical accessibility (`web-dev/accessibility-essentials`, the complementary POUR lens) and from code-correctness lenses. Serves the usability-adversary lens; pairs with `error-handling-discipline` (Heuristic 9), `evidence-and-premise-discipline` (the honest-finding bar), and `design-pushback/_index` (proactive critique).
