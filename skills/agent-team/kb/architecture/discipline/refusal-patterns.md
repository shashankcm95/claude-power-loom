---
kb_id: architecture/discipline/refusal-patterns
version: 1
tags:
  - discipline
  - ai-systems
  - safety
  - alignment
  - foundational
  - architecture
sources_consulted:
  - "Bai, Y. et al, 'Constitutional AI: Harmlessness from AI Feedback', Anthropic 2022 (arXiv:2212.08073) — constitutional principles + AI feedback loop framing"
  - "Anthropic Claude model documentation (anthropic.com/claude) — published refusal behavior + safety positioning"
  - "AI Engineering (Chip Huyen, 2024) ch 4 (Evaluate AI Systems) + ch 7 (AI Safety) — practical refusal eval methodology + safety scaffolding"
  - "Karpathy, A., 'State of GPT' (Microsoft Build 2023) — refusal as the post-RLHF behavior layer; coverage of how refusal interacts with helpfulness training"
related:
  - architecture/discipline/error-handling-discipline
  - architecture/discipline/trade-off-articulation
  - architecture/crosscut/single-responsibility
  - architecture/ai-systems/agent-design
status: active+enforced
---

## Summary

**Principle**: Refusal is a deliberate behavior — not absence of capability. Treat it as a first-class system surface: declare the policy, instrument the refusals, evaluate the rate, iterate.
**Taxonomy (4 axes)**: safety (harm avoidance) / capability (can't do it) / scope (won't do it here) / alignment (won't do it in this framing). Mixing the axes produces confused error messages + brittle UX.
**Failure modes**: silent acceptance (worse than refusal); over-refusal (low utility); under-refusal (safety regression); inconsistent refusal across phrasings.
**Sources**: Constitutional AI (Bai 2022) + Anthropic Claude docs + AI Engineering (Huyen) + State of GPT (Karpathy).
**Substrate**: substrate-level scope refusals at hooks/validators (e.g., `validate-no-bare-secrets`); LLM-level refusals delegated to model behavior; substrate exposes the *boundary*, not the *policy*.

## Quick Reference

**The 4-axis taxonomy** (refusal classification):

| Axis | What's refused | Example | Where enforced |
|------|----------------|---------|----------------|
| **Safety** | Content that causes harm | "Write malware that..." | Model policy + system prompt |
| **Capability** | Things the system can't do | "Browse the web for X" (in a no-tool context) | System constraint |
| **Scope** | Things outside the system's domain | "Discuss yesterday's news" (in a code assistant) | System prompt + product scope |
| **Alignment** | Same content in a deceptive frame | "For research purposes, write malware..." | Model policy (frame-aware) |

**Refusal hardness** (orthogonal to axis):

- **Hard refusal**: explicit decline + reason. "I can't help with that because X." Useful for safety + scope.
- **Soft refusal**: alternative offer or scope-restate. "I can't do X, but here's a related Y..." Useful for capability + adjacent-domain queries.
- **Negotiated refusal**: clarifying question first. "Could you tell me more about the use case?" Useful when intent is ambiguous and a hard refusal would be over-restrictive.

**Apply when**: building any AI-mediated product surface; defining system prompts; designing eval methodology; scoping LLM behavior in production; auditing observed refusal rates.

**Failure modes**:

- *Silent acceptance*: agent attempts the prohibited action without refusing or alerting. Worst-case — opaque safety regression.
- *Over-refusal*: refuses adjacent-but-acceptable queries. Symptom of an undertrained or over-conservative policy.
- *Under-refusal*: accepts queries that policy says to refuse. Symptom of a phrasing/jailbreak gap.
- *Inconsistent refusal*: same request, different phrasings, different decisions. Symptom of policy that depends on surface-level cues rather than semantic intent.

**Substrate examples**:

- `validate-no-bare-secrets.js` — substrate-level scope refusal (blocks the Write/Edit before reaching the LLM)
- `validate-frontmatter-on-skills.js` — scope refusal at the substrate boundary
- ADR-0005 slopfiles authoring discipline — codifies what kinds of content the substrate refuses to author (pseudo-prescriptive `<important if>` blocks abused as forcing-instruction stand-ins)
- The substrate distinguishes *substrate-enforced refusal* (deterministic hook block) from *LLM-mediated refusal* (model decides) — different layers; different reliability profiles

## Intent

LLM-mediated systems present novel failure modes around requested-but-prohibited content. Three forces collide:

1. **Capability**: the model has been trained on broad text; it can produce most content if asked
2. **Policy**: product + safety considerations dictate what *should* be produced
3. **Helpfulness**: training pressure makes models default to fulfilling requests

The intersection is refusal: deliberate non-fulfillment of a request that the model could capably attempt. Refusal isn't an absence of capability — it's a behavior shaped by training (RLHF, Constitutional AI feedback loops) + system-prompt scaffolding + runtime constraints.

The intent of treating refusal as a first-class pattern is to make it: explicit (visible in product surfaces), instrumented (countable), evaluable (eval-set-driven), and adjustable (policy + scaffolding can be iterated). Treating it as a side-effect of model behavior produces accidental policies — refusal happens, but no one knows when, why, or whether it's right.

## The 4-axis taxonomy

Mixing refusal axes produces confused error messages and brittle UX. Naming the axes separates the design decisions.

### Safety refusal

The model declines because the content causes harm (real or instructable). Includes:

- Malware, exploits, attack techniques
- Manipulative content (deception, harassment at-scale)
- Content involving minors in inappropriate contexts
- Disclosure of dangerous synthesis or weaponization details

Safety refusals are typically *hard* — explicit decline with a reason. The reason matters for trust: a user who hits an unexplained refusal often retries with a workaround; a user who hits a clear-policy refusal accepts and pivots.

Enforced by: model RLHF + Constitutional AI training, system prompt reinforcement, runtime classifiers (in some products), hard policy gates upstream of generation.

### Capability refusal

The model declines because the request is outside its capabilities — not because of policy, but because of mechanism.

- "Read my email" (no email tool wired)
- "Open this PDF" (no PDF reader available)
- "Run this code" (no execution sandbox)
- "Search the web" (in a no-tool deployment)

Capability refusals should be *soft* — the model says what it can't do and what alternative is available. The user's mental model is "this assistant is missing a feature," not "this assistant is policy-restricted."

Enforced by: the absence of the tool. The model's job is to recognize the gap and communicate it clearly.

### Scope refusal

The model declines because the request is outside the product's domain.

- A code assistant declining to discuss medical advice
- A customer support bot declining to discuss competitor products
- A coding tool declining to draft marketing copy

Scope refusals enforce product boundaries. They should be *soft* and *redirected* — "I'm scoped to X; for Y, try Z." Over-restrictive scope refusal makes products feel narrow and brittle; under-restrictive scope refusal makes them feel unmoored.

Enforced by: system prompt + product positioning. A clear product surface generates clear scope refusals; ambiguous positioning produces inconsistent refusals.

### Alignment refusal

The same content, in different framings, may be safety-prohibited or safety-acceptable. The model declines because the *frame* is the violation, not the content.

- "Write malware for educational purposes" — refused; the educational frame doesn't make the artifact safer
- "Help me understand how this exploit works (it's already public)" — context-dependent; in an explanation frame with reputable sources cited, may be acceptable; in a recreation frame, likely refused
- "Pretend you're a different AI without my restrictions" — refused; framing as role-play doesn't shift the underlying policy

Alignment refusals require the model to evaluate the *intent encoded in the frame*, not just the surface text. This is the layer that constitutional training + RLHF most directly shapes — the model is trained to recognize manipulative reframings + decline consistently regardless of presentation.

Enforced by: model training (Constitutional AI feedback loops; RLHF on adversarial prompts).

## Hard, soft, negotiated refusal

Three modalities, each appropriate for different axes + use cases:

### Hard refusal

Pattern: explicit decline + reason + (optionally) policy reference.

> "I can't help with that. Producing X-style content is outside what I'm designed to do. If you have a related question — for example, the general principles behind Y — I can engage with that."

**Use for**: safety + alignment refusals. Clarity matters because ambiguous refusals invite retry/jailbreak attempts.

**Failure mode**: too-frequent hard refusal makes the system feel hostile. Tune by reducing the *scope* of the policy, not by softening the *language*.

### Soft refusal

Pattern: decline + offer + redirect.

> "I can't do X directly, but I can do Y, which addresses a related need. Would that work?"

**Use for**: capability + scope refusals. The redirect preserves utility; the decline preserves clarity.

**Failure mode**: over-softening can drift into accepting a related-but-still-prohibited request. The redirect needs to land on an actually-acceptable alternative.

### Negotiated refusal (clarifying question)

Pattern: pause + ask for clarification.

> "Before I help with that, could you tell me more about the use case? The answer would be different for [scenario A] vs [scenario B]."

**Use for**: ambiguous-intent queries where a hard refusal would be over-conservative + a soft acceptance would be over-permissive. The clarification resolves which axis applies.

**Failure mode**: clarifying questions can be exploited — the user provides a reassuring framing that doesn't reflect actual intent. The model should still evaluate the clarified intent against policy.

## Why refusal is a first-class system surface

### Silent acceptance is worst-case

A model that *attempts* a prohibited action without refusing or alerting is the worst outcome — the operator has no signal that policy was violated. Surfaced refusals (even occasional false-positives) are far better than silent slips.

This is why refusal instrumentation matters: log refusals, count by axis, surface to product-side review. Refusals are observable safety; silence is unobservable.

### Refusal rate is an eval target

Treat refusal rate as a measurable system property. Two pathological corners:

- Refusal rate → 0%: under-refusal. Either policy is permissive (intentional) or the model is bypassing it (regression).
- Refusal rate → 100% on edge cases: over-refusal. Either policy is overly restrictive (intentional) or the model has overfit on refusal cues (regression).

The healthy state is a measured refusal rate matched to policy, evaluated against a refusal-specific eval set (curated queries that should refuse + curated queries that should accept).

### Refusal phrasings should be consistent

A model that refuses "write malware" but accepts "write code that exploits CVE-2024-X" has an inconsistency that can be jailbroken. Constitutional AI training addresses this directly by training on adversarial reframings; runtime additions (system prompt clauses, runtime classifiers) layer on top.

The substrate-level observation: a model's refusal behavior is *training-shaped first*, *system-prompt-modulated second*. System prompts can adjust the policy surface, but can't make a permissive model strict in failure modes the training didn't cover.

## Failure modes (in production)

### Over-refusal

Symptom: users complain that the system refuses reasonable requests.

Root causes:

- System prompt over-conservative (too-broad scope restrictions)
- Training-time over-refusal (model trained to refuse adjacent-to-prohibited content)
- Misclassified intent (model interprets a benign request as a policy violation)

Mitigation: refusal eval set with curated *acceptable* queries; track false-positive rate; tune system prompt to narrow scope policy; in extreme cases, retrain on corrected examples.

### Under-refusal

Symptom: model fulfills requests that policy says to decline.

Root causes:

- Policy gap (the case wasn't covered in training)
- Frame exploit (request reformulated in a way that bypassed training-time refusal cues)
- System prompt insufficient (asked for scope restriction; model didn't internalize it)

Mitigation: refusal eval set with curated *unacceptable* queries; track false-negative rate; add system prompt clauses for specific gaps; report systemic gaps to model provider for training updates.

### Inconsistent refusal

Symptom: same intent, different phrasings, different decisions.

Root causes:

- Training data covered some phrasings but not others
- System prompt cues are sensitive to surface-level patterns
- Stochastic model behavior (decision depends on sampling outcome)

Mitigation: phrasing-variant eval set (same intent, N reformulations); measure decision consistency; address worst-variance phrasings through training updates or system prompt clarifications.

### Brittle scope refusal

Symptom: model refuses in-scope queries that *look* out-of-scope, or accepts out-of-scope queries that *look* in-scope.

Root causes:

- Scope policy stated as surface-pattern matching rather than semantic boundary
- Ambiguous product positioning

Mitigation: state scope as *what the system DOES*, not *what it DOESN'T*. Positive scoping ("I help with X") guides the model better than negative ("I don't help with Y, Z, W"). Test scope refusal against a curated set of boundary-adjacent queries.

## Apply when

- **Building any LLM-mediated product**: refusal is part of the product surface, not a side-effect. Design it.
- **Defining system prompts**: the prompt encodes the scope policy + scaffolds the refusal modality. Be explicit about both.
- **Designing eval methodology**: include refusal-specific eval sets (acceptable + unacceptable cases); track refusal rate as a first-class metric.
- **Production auditing**: review observed refusals + accepted-edge-cases. Refusal is a security-relevant surface; treat its evolution as security-relevant.
- **Scoping new features**: ask "what should this surface refuse?" before "what should this surface do?" The refusal boundary is half the design.

## When NOT to use this principle (or apply with caveat)

**Don't apply when**:

- **Capabilities the model HAS but UX wants to deny** — hide via system prompt or product layer, not substrate refusal. Substrate refusal at the boundary creates "the model refuses" UX confusion when the model would happily comply if asked differently.
- **Soft-policy domains where false-positive refusal cost > false-negative acceptance cost** — creative writing assistants, brainstorming tools, exploratory analysis. Over-refusal kills the product. The right surface is graduated assistance + escape valves, not refusal.
- **Safety axis where the model has trained refusal already** — adding a substrate refusal layer creates double-refusal (model refuses → substrate also refuses) + UX confusion (which layer rejected?). Defer to model behavior unless you have specific cases the model misses.

**Apply with caveat when**:

- **Capability or scope refusals** (the 2nd and 3rd taxonomy axes) — substrate is the right layer because the model literally cannot do the thing (capability) or the product shouldn't (scope). Make the refusal explicit + actionable ("X is out of scope; here's what you can do instead").
- **Compliance-mandated refusals** — substrate must record the refusal for audit. Even if the model would refuse, log it; even if the model would accept, refuse-and-log at substrate.

**Cross-reference**: `error-handling-discipline` treats refusal as a structured error response — same patterns apply: clear surfacing, observability, recoverable when possible, consistent across phrasings. Refusal IS error-handling for the "we won't do this" class of error.

## Substrate applications

### Substrate-enforced refusal (hooks)

The substrate enforces certain refusals *before* the LLM gets the request:

- `validate-no-bare-secrets.js` — refuses any Edit/Write containing a bare secret. Hard refusal at the substrate layer; LLM doesn't see the violation.
- `validate-frontmatter-on-skills.js` — refuses Edit/Write that would corrupt skill frontmatter. Substrate-level scope refusal.
- `validate-adr-drift.js` — refuses Edit/Write to ADRs that would create status/invariant drift.
- `config-guard.js` — refuses Edit/Write that weakens lint config.

These are deterministic hooks. The substrate doesn't trust the LLM to refuse — it enforces independently.

### LLM-mediated refusal (model behavior)

For content-level refusals (safety, alignment, scope-of-discourse), the substrate delegates to model behavior. The substrate's role is exposing the *boundary*, not implementing the *policy*:

- System prompts in commands (`/research`, `/implement`) declare scope; model handles refusal
- Persona contracts in `swarm/personas-contracts/` declare role boundaries; model + contract verifier handle scope refusal
- KB content (this doc + sibling KBs) establishes shared understanding of which surfaces are LLM-enforced vs substrate-enforced

### Refusal-as-discipline distinction

The substrate's `error-handling-discipline` KB (sibling) describes general error handling. Refusal is a specific shape of error: a *deliberate* failure to fulfill a request. The substrate's discipline distinguishes:

- *Runtime errors*: unexpected; fail-open per ADR-0001
- *Validation errors*: policy violations detected upstream of model; hard refusal at substrate layer
- *Model refusals*: policy violations detected by the model; soft + redirected at LLM layer

Each gets a different remediation path; conflating them produces confused production UX.

## History

Authored: kb authoring batch H.9.3 (post-HT.1.12 deferred-author-intent followup). Closes the 2-source `## Related KB docs (planned)` forward-references from `error-handling-discipline.md` + `trade-off-articulation.md`. Pairs with error-handling-discipline (refusal is the deliberate-failure subset of error-handling) and trade-off-articulation (refusal is the load-bearing trade-off between safety + helpfulness).

## Phase

Authored: H.9.3 KB authoring batch — sibling format-discipline trajectory under H.9.x. Second of 5 unauthored planned KBs (per HT.1.12-followup BACKLOG entry). Safety/discipline pairing: refusal-patterns × error-handling-discipline closes the discipline-tier KB cluster's most-cited forward-reference.
