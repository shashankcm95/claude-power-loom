---
date: 2026-06-01T16:20:51Z
researcher: root
git_commit: 228b137
branch: feat/v3.1-pr-p2b-shadow-producer-wiring
repository: power-loom
topic: "gstack (garrytan) comparison + cross-model review as grounded advisory — design synthesis for v6 fold-in"
tags: [research, design-synthesis, cross-model-review, advisory-verification, gstack, byzantine, handoff]
status: complete
lifecycle: persistent
last_updated: 2026-06-01
last_updated_by: root
---

# gstack ↔ Power Loom + Cross-Model Review as Grounded Advisory

> **Genre note.** This is a **design-synthesis / hand-off artifact**, not a documentary "describe-the-codebase-as-is" research doc (so it intentionally makes proposals and judgments, unlike the `/research` documentary convention in this dir's `README.md`). It follows the proposal-flavored format of [`v3.1-v3.2-field-survey-debt.md`](v3.1-v3.2-field-survey-debt.md). **It is not an approved plan.** It is meant to be handed to an independent working session that will re-review it and fold the *relevant* parts into the v6 design record / phase plans where appropriate. Runtime claims about current substrate state are listed for re-probing in **Part E**.

## TL;DR for the downstream session

1. **gstack and Power Loom are not competitors** — they sit on opposite sides of Power Loom's own generation↔containment thesis. gstack is a *generation/process* layer (23 role-skills, ship-fast); Power Loom is a *containment/governance* substrate. Most of gstack is orthogonal to the kernel; the parts worth borrowing land in the **Runtime / Lab** layers.
2. **The one substantive borrow is "cross-model review,"** and it is an **instance of the advisory-finding class v6 already governs** — the **GPT-1.C attestation-vs-stochastic-content split** (`v6-substrate-synthesis.md:504`) was authored for R-primitive advisory findings in general; a cross-vendor finding is one such finding. It composes with **Axiom 3b** (advisory may be LLM-mediated), **Axiom 6** (snapshot), and **Axiom 10** (evidence-linked admission). It is **advisory-only** — it does **not** gate promote/reject.
3. **Correction carried in from the design conversation:** earlier phrasing called grounding "the one blocking gate." Per **Axiom 3a/3b** that is imprecise — grounding is a **pure-function sanitizer on the advisory finding stream**: fabricated-citation findings *are* dropped (so it *is* a deterministic filter on that stream), but it is **not a *promote*-gate**. The promote/reject decision stays exactly where it is today (K9 structural + K14 scope + K5 validators). See **B2**.
4. **Three policy clauses** make it shippable without violating the cost or honesty anchors: a **stakes-trigger** (fire only on load-bearing decisions, never mechanical churn), an **escalation ladder** (deterministic gate → same-family review → cross-vendor → empirical probe), and a **soft-fail availability policy** (missing API key never blocks; degrade + attest honestly).
5. **Security gate (hacker lens, Part F):** this introduces a new outbound-egress + secret-adjacent surface. **The delta is Byzantine input to the reviewer AND may carry user secrets to a third party.** A mandatory fail-closed pre-egress secret scrubber (T1), reviewer-injection defense (T2), and a positive review-status attestation (T4) are **C1 launch requirements**, not deferrable. The worktree is not a sandbox (P-WriteScope), so this cannot be assumed away.

---

## Part A — gstack ↔ Power Loom (condensed comparison)

### What gstack is (sourced)

[garrytan/gstack](https://github.com/garrytan/gstack) — *"Garry Tan's exact Claude Code setup: 23 opinionated tools that serve as CEO, Designer, Eng Manager, Release Manager, Doc Engineer, and QA."* ~66K GitHub stars in weeks; MIT. Skills are Markdown (template-generated from `commands.ts` at build time) running on Claude Code's existing skill mechanism. It turns Claude Code into a virtual *product org* across a think → plan → build → review → test → ship → reflect lifecycle.

Its **one real runtime is a persistent Chromium daemon** for browser QA (CLI → Bun HTTP server → Chromium via CDP). Per its own `ARCHITECTURE.md`: *"No transaction boundaries or rollback… No isolation guarantees between sessions… Server exits on Chromium disconnection. CLI detects dead server, auto-restarts. No self-healing attempts."* Its safety story is **prompt-level** (`/careful`, `/freeze`, `/guard`) plus a sophisticated **6-layer prompt-injection defense** on the browser sidebar agent (datamarking → hidden-element strip → local ONNX BERT classifier → Haiku transcript classifier → canary token → ≥2-classifier ensemble).

### The generation↔containment mapping

gstack optimizes **breadth of roles + velocity**; Power Loom optimizes **depth of containment + determinism**. gstack's "team" is a *delivery org* (CEO/Designer/QA); Power Loom's 16 HETS personas are a *verification board* (architect / code-reviewer / hacker / honesty-auditor). They are on opposite sides of the line Power Loom names in its README: *"as models improve, the bottleneck shifts from generation to governance/containment."* gstack is the strongest existence-proof of the generation side; Power Loom is a bet on the containment side. **In principle gstack's roles could run on top of Power Loom's transaction loop** — generate broadly, contain atomically.

### Similarity / divergence

| Concept | gstack | Power Loom | Verdict |
|---|---|---|---|
| Multi-role agent team | 23 org-function skills | 16 engineering/verification personas | convergent (product roles vs review roles) |
| Planning discipline | `/plan-*-review` | `planner` + `/build-plan` + `/verify-plan` | convergent |
| Security audit | `/cso` (OWASP+STRIDE) | `security-auditor` + `hacker` | convergent |
| Persistent memory | GBrain (internals undocumented) | library / `MEMORY.md` / reputation | convergent |
| Self-improvement loop | `/learn` + JSONL preamble | auto-loop + ghost-protocol | strongly convergent |
| Byzantine verification | `/codex` (cross-vendor 2nd opinion) | multi-reviewer (same model family) | **partial — the borrow (Part B)** |
| Doc freshness | `SKILL.md.tmpl` gen + CI `--dry-run` | validators (docs have drifted: PRs #183/#184) | gstack ahead |
| Transaction / rollback | **none (explicit)** | the entire kernel | **divergent — PL's moat** |
| Capability enforcement | prompt-level (`/guard`) | static `tools:` + reconciliation validator | **divergent — PL's moat** |
| Browser QA / runtime exec | Chromium daemon, `/qa` | none (pure-fn gates over FS) | **divergent — gstack's moat** |
| Design / Release / Deploy roles | `/design-*`, `/ship`, `/canary` | none | **gstack-only** |

### Strengths / weaknesses (honest)

- **gstack strengths:** proven demand; complete ideation→deploy coverage; near-zero friction; multi-platform (8 agents); real browser QA; design + cross-model review as first-class; battle-tested by an extreme-volume dogfooder.
- **gstack weaknesses:** no containment (no transaction/rollback/isolation for FS effects); safety is discipline-based not mechanism-based; productivity claims are marketing-flavored and unverified; quality is prompt-dependent not gate-enforced.
- **Power Loom strengths:** real containment (atomic promote/reject, out-of-scope-write detection, rollback, replayable envelopes); determinism + provenance; capability-based role enforcement; pure-function gates with no LLM in the blocking path; exceptional engineering honesty.
- **Power Loom weaknesses:** alpha, not adoption-proven; heavy per-change ceremony; much of the kernel is dormant; narrow surface (a substrate, not a shipping tool); the core thesis is an admitted wager.

### Strategic read

Treat gstack's adoption curve as a **falsifiable signal on Power Loom's core wager.** ~66K GitHub stars (a demand signal, not an install count) accrued to a tool with zero containment, and the audience doesn't appear to miss it — either the containment gap isn't *felt* yet (PL's bet: it will be as autonomy grows), or it's smaller than assumed. The cleanest validation path is the **integration story**: Power Loom as the containment layer beneath gstack-style delivery roles.

---

## Part B — Cross-Model Review as Grounded Advisory (the design)

**Source of the idea:** gstack's `/codex` (an OpenAI second opinion). **Why it fits PL:** Pillar 2 treats the LLM as Byzantine; PL's current multi-reviewer uses the *same* model family (correlated failure modes). A *different-vendor* reviewer buys genuinely independent failure modes — the cheapest real independence available.

### B1 — Core mechanism: grounding converts an LLM finding into an attestable claim

A reviewing LLM's worst failure mode is the **hallucinated finding** (*"bug on line 142"* when line 142 says something else). Require every finding to cite the exact `file` + `line_start`/`line_end` + the verbatim bytes it judges, and a **pure function** can deterministically check whether that citation resolves against the actual delta.

This is **not a new principle for v6** — it is the existing **attestation-vs-stochastic-content split** (`v6-substrate-synthesis.md:504`, LOCK Patch GPT-1.C): the *fact that a finding was emitted with a specific citation* is an **Attestation** (deterministic, verifiable); the *claim itself* (*"this is a bug"*, severity) is a **Stochastic Sample**. Cross-model review is an *instance* of the class that split already governs (the split was authored for advisory findings in general; a cross-vendor finding is one such finding), and an instance of **Axiom 10 — Evidence-Linked Admission** (`:453`): the grounding *is* the evidence link.

```
// ILLUSTRATIVE PSEUDOCODE (not yet implemented).
// Advisory finding (Runtime, Axiom 3b) — produced once, then frozen into the envelope:
finding = {
  finding_id,
  reviewer: { vendor, model, version },   // attestation: who/what emitted it
  file, line_start, line_end,
  cited_sha,                              // hash of the delta blob at that span
  cited_text,                             // verbatim snippet claimed to be present
  claim, severity, category               // STOCHASTIC content — never treated as fact
}

// Grounding SANITIZER (pure-fn over the delta) — NOT a promote-gate (see B2):
verifyGrounding(finding, delta):
  blob = delta.fileAt(finding.file)               // must be in-scope (K14 territory)
  if !blob:                       return DROP("file not in delta")
  span = blob.lines[line_start .. line_end]
  if sha(span) != finding.cited_sha
     or !span.includes(finding.cited_text):
                                  return DROP("citation does not resolve — fabricated grounding")
  return KEEP(finding)            // grounding is real; the CLAIM is still unproven
```

The sanitizer deterministically drops findings whose *grounding* is fabricated. It does **not** judge whether the *claim* is correct — that stays stochastic content, surfaced as advisory.

**Canonicalization is load-bearing for replay (per architect MED-1).** For a frozen `cited_sha` to re-verify deterministically on replay, `sha(span)` must pin the same canonicalization §4.3 mandates for `GENESIS_HASH` (`v6-substrate-synthesis.md:617`): line-ending normalization (CRLF/LF), trailing-whitespace handling, UTF-8 encoding, and inclusive-vs-exclusive `line_start`/`line_end` semantics. Without it the same delta hashes differently across platforms and a frozen KEEP silently becomes a replay DROP — corrupting the recorded advisory set. The grounding primitive must specify this exactly as §4.2/§4.3 do.

### B2 — Layer mapping (and the Axiom 3a/3b correction)

| Mechanism | Layer | Touches promote/reject? | v6 anchor |
|---|---|---|---|
| Multi-model routing (which external vendor reviews) | Runtime | no | §6.1.2 runtime primitives; §6.2 capability model (`:1145`) |
| Grounding sanitizer (drop fabricated citations) | Kernel (pure-fn) | **no — sanitizes the advisory stream only** | Axiom 3a/3b (`:377`/`:381`); A10 (`:453`) |
| Cross-model findings (the review itself) | Runtime (advisory) | **no** | **Axiom 3b** (`:381`); GPT-1.C split (`:504`); R13 advisory-findings |
| Ensemble consensus / confidence tier | Lab (advisory) | **no** | E14-adjacent derived view (`:1165`); A6 snapshot (`:397`) |

**The correction (load-bearing for the downstream session).** In the design conversation grounding was described as "the one blocking gate / the only blocking piece." Re-checked against **Axiom 3a** (*gating verification must be pure AND semantically adequate*) and **Axiom 3b** (*advisory verification may be LLM-mediated*), that framing is **imprecise and should not be carried into v6**:

- Cross-model review is **advisory** (Axiom 3b). Its findings **never** gate the transaction. Letting a finding's severity (`CRITICAL`) block promote would mean a *stochastic* label gating the blocking path — a direct Axiom 3a violation.
- The grounding check is a **pure-function sanitizer on the advisory stream**, not a promote-gate. It improves the *quality of advisory data* (no hallucinated citations reach the record); it does not change what gets promoted.
- The **promote/reject decision is unchanged**: K9 structural gate + K14 scope + K5 validators, exactly as today. Cross-model review adds *recorded advisory signal*, not a new gate.

**A finding is a scout, not a gate (per architect).** A cross-model finding can never gate the transaction — but it can legitimately *motivate adding* a separate, deterministic, A3a-semantically-adequate gate (e.g. a finding "line 142 reintroduces string-concat SQL" could justify a pure taint-check that then blocks on its own authority). The finding points; any resulting gate must stand on its own pure legs. C1 readers must not "promote" a high-signal finding directly into a blocker — that is the A3a trap.

**INV-CMR-NoLiveReputationRead (per architect HIGH-1, promote from OQ to invariant).** Cross-model consensus MAY inform reviewer reputation, which MAY influence future *routing* — but **only** through the A6 snapshot (frozen to axiom-class at spawn-init), never a live read. v6 already governs this: the A6 transitive-path clause (`v6-substrate-synthesis.md:410`, *"Kernel never reads live advisory_findings in a gating decision"*) + the §0a.3.1 No-Amplification carve-out (`:179`). Consensus stays observational; it MUST NOT widen capability scope (cf. field-survey B3 / `INV-A6-NonAuthorizing`).

**How it enters the kernel without breaking replay (Axiom 6 pattern, `:397`).** The non-deterministic LLM call happens **once**, in Runtime; its grounded findings + `reviewer.{vendor,model,version}` + a `verification.tier` are **frozen into the transaction-record envelope** (§4.2, `:526`). Replay re-checks the *recorded* findings with the pure sanitizer; it never re-calls the model. This is the same discipline as reputation entering via an explicit snapshot — cross-model review enters as a frozen attestation, never a live call. Routing must therefore be a **static, deterministic table** (random routing breaks replay).

**No `ContainerAdapter` dependency — for *execution* isolation only.** Reviewing a delta is *read-files-and-send-text*, not *execute-Byzantine-code* — so unlike a test/browser execution gate, cross-model review needs no sandbox to be safe from code execution. **But it is NOT "free of isolation concerns":** the delta crosses the user's trust boundary to a third-party vendor, and the worktree is not a security sandbox (P-WriteScope), so a spawn can stage secrets into its own delta. That makes a pre-egress secret scrubber + data-governance clause a launch requirement (see **B6/T1**), not an afterthought. (The rejected browser idea is recorded in **B5**.)

**Integration seam — it rides existing hardware, but the dispatch lives in Runtime (per architect HIGH-2).** The seam hangs off the **PR-3b spawn-close resolver** (`packages/kernel/hooks/post/spawn-close-resolver.js`), which already observes the worktree delta at `PostToolUse:Agent`/`Task` close in shadow. **The LLM-dispatching producer must NOT live in `packages/kernel/**`** — Axiom 2 forbids kernel code calling LLMs, and Layer 1 is "no LLM in the trust path." The correct seam:

```
resolver (kernel; observes + materializes delta, emits a close event)
   → cross-model producer (RUNTIME; routes + dispatches the vendor call + datamarks delta)
   → grounding sanitizer (KERNEL pure-fn; drops fabricated citations)
   → frozen into the transaction-record envelope + resolver journal
```

Only the **pure sanitizer** may live in kernel; the vendor dispatch is Runtime. **The §4.2 envelope has no `verification` field today** — this is a schema-additive change (tolerated by `INV-K2-SchemaForwardCompat`, `:528`); name the new field explicitly (`verification: {tier, reviewer, review_status, findings[]}`) rather than implying the envelope already carries it. Shadow-first, fail-soft, same discipline as the rest of the resolver.

### B3 — Stakes-trigger + escalation ladder

The discriminator is **reversibility × blast-radius**, not "importance" — and it is *consistent with PL's thesis*: PL already makes mechanical errors cheap to catch/reverse, so the expensive external call is wasted there. Spend it only on the error class PL's deterministic gates are **structurally blind to: a wrong load-bearing premise that passes every gate** (the `transaction_id`-keying and nesting-impossible premises that survived multi-reviewer review of the *code* but not primary-source probing).

**Trap to encode:** *"mechanical" means low-blast-radius-if-wrong, NOT small-diff.* A one-line change can be maximally load-bearing (e.g. the M1 forward-coupling invariant). Gate on stakes, never on lines.

| Tier | Check | Cost | Fires on |
|---|---|---|---|
| 0 | Deterministic gates (scope / lint / schema / typecheck) | ~free | **every** change |
| 1 | Same-family multi-reviewer (Claude personas) | cheap | routed substantive changes (`route-decide` ≥ borderline) |
| **2** | **Cross-vendor grounded review** | **expensive** | **load-bearing decisions** — kernel / contract / schema / axiom / capability-surface deltas |
| 3 | Empirical probe vs primary source / `claude -p` runtime | most expensive | load-bearing *premises* that brick the substrate if false |

**Honest placement:** Tier 2 is *more independent* than Tier 1 but is **not** the gold standard — what actually saved the substrate twice was **Tier 3** (an empirical probe). A second LLM improves the odds on a wrong premise; it does not prove it. Escalate the highest-stakes premises to Tier 3.

**The trigger itself must be deterministic and cheap** (no LLM deciding whether to call the LLM). Fire on the **union of**: (a) **structural load-bearing paths** — touches `packages/kernel/**`, any `*.contract.json` / schema / envelope, an ADR/axiom, a gate's blocking logic, or the capability/egress/secret surface (deterministic from changed-paths); and (b) **author-flagged unprobeable premises** — a plan claim a `Probe:` line can't close (a *judgment* premise, not a file-exists check). Ship this as a **sibling module `stakes-decide.js`** that reuses `route-decide.js`'s classifier *scaffolding* — NOT an axis bolted onto `route-decide` itself (per architect MED-2: the two score different things — convergence_value vs reversibility × blast-radius — and merging them is an SRP violation).

**The structural leg is authoritative and not down-flaggable (per hacker T7).** Author flags may only *escalate* (add review), never *suppress* it — otherwise a malicious spawn flags a load-bearing delta "mechanical" to skip Tier-2 (B3's own catastrophic case). The premise source (OQ-CMR-4) MUST be a location the reviewed spawn cannot edit.

**Asymmetry → bias.** A false negative (load-bearing change misclassified as mechanical → review skipped) is the catastrophic case; a false positive is just money. So bias toward firing on uncertainty — affordable because load-bearing decisions are rare by nature.

### B4 — Availability / soft-fail policy

Reviewer availability (i.e. access to a vendor API key) is a **soft-fail, never a hard block** — which is automatic, because the whole layer is advisory: no reviewer → no findings → the transaction proceeds on Tier-0/1 coverage. Matches the resolver's existing "fail-soft on every path, never break a spawn" rule.

**Degradation ladder (honestly labeled):**

| Rung | Reviewer | Independence | External key? |
|---|---|---|---|
| Full | cross-vendor (Claude author → GPT / Gemini) | independent failure modes | yes |
| Degraded | same-vendor, different member (Opus ↔ Sonnet) | **partial** — different checkpoint, *shared* pretraining/RLHF → correlated blind spots | no |
| Minimal | same model, fresh context / re-prompt | near-zero | no |
| Manual | user runs their own model, pastes findings | as good as what they ran | no |
| Skip | none available, user declines | none — recorded as a gap | — |

**Hold the line on honesty:** a same-vendor fallback is a fine pragmatic substitute but must **never be recorded as cross-vendor**. The degradation is **first-class metadata** — a **negative attestation** (the roadmap's E1): *"cross-vendor review SKIPPED (no key); fell back to Opus↔Sonnet; independence: partial."* The `verification.tier` reflects the rung; a same-vendor fallback cannot earn a full-independence confidence score. A degraded-but-honest verdict outranks a fake green check.

**"Surface and let the user decide" splits by execution context** (the ADR-0012 headless lesson):

- **Interactive:** synchronous prompt — *paste a key* / *I'll run it myself* / *fall back to same-vendor (degraded)* / *skip + record the gap*. Optionally persist the choice as standing policy.
- **Headless (auto-fired close hook):** no user to prompt (a synchronous prompt hangs, exactly like `EnterPlanMode` did). Apply a **pre-set policy** + record the degradation + surface it **asynchronously** in the journal summary. Never block.

**Recommended default (configurable):** on a Tier-2 delta with no external key → **fall back to same-vendor + attest the degradation**, surface async so the user can escalate to manual/Tier-3. (On non-load-bearing deltas the reviewer never fired, so the policy only bites at Tier-2+.)

**Two closures (both hardened by the hacker lens):** (1) **manual / pasted findings go through the same grounding sanitizer** — a human isn't trusted more than a model; their `{file, line, cited_text}` is verified against the delta bytes. But the sanitizer only checks the *citation*, not *who reviewed* — so a paste must carry `reviewer.source: manual-paste` and is **capped below machine-attested cross-vendor independence** (T5: nothing binds a pasted `reviewer` block to a real vendor call, so it must never self-assert a full-independence `verification.tier`). (2) **Key isolation, not just presence-detection.** Availability *detection* is a presence check that touches no secret — but that is the wrong question. The vendor key MUST live **out-of-process in the MCP server**, never an env var the reviewed spawn can `printenv` (T3 — this is the load-bearing argument *for* MCP routing over a Bash shell-out), and a **redaction pass** must scrub key-shaped tokens / `Authorization` headers from anything written to the journal or envelope. Restate the guarantee as: *neither detection, dispatch, nor journaling exposes the key to the reviewed spawn or to disk.*

### B5 — Honest constraints + recorded non-goals

- **Not a correctness oracle — and the gap is adversarially exploitable (per hacker T6).** The sanitizer drops *fabricated* citations; a grounded-but-wrong finding still reaches advisory. The adversarial version: an attacker emits findings that cite *real* bytes but mislead — flooding the stream with 50 grounded LOW nits to bury one real CRITICAL, or citing a real line with a false-benign interpretation. All pass the sanitizer (grounding ≠ correctness ≠ relevance). Bound it: cap findings-per-delta, dedupe, and keep consensus **strictly observational** so finding *volume* never raises a confidence tier or reputation score. This makes review findings *checkable and independent, not correct* — same honesty anchor as the whole project.
- **Consensus cannot hard-block** (Axiom 3a). It gates a *confidence tier* and feeds reputation only.
- **New trust + secret surface.** Non-Anthropic keys, egress, a second-vendor dependency. Subject to the security rules + the egress audit (`packages/kernel/observability/network-egress-audit.js`). The on-architecture egress path is a vendor **MCP tool listed in the reviewer persona's `tools:`** (capability-enforceable per ADR-0012), not a Bash shell-out (which lands in the advisory egress-audit lane).
- **REJECTED — real-browser / runtime-execution gate (do not re-litigate).** A live browser in the blocking path violates determinism (Axiom 1/3a), replay (A6), and the "not an output-scoring vendor" non-goal. Any execution-based ground truth (even deterministic tests) is **blocked on `ContainerAdapter`** because it means executing Byzantine code in the verify path. Browser QA belongs in the generation/runtime layer where it already exists (Claude-in-Chrome MCP, gstack); PL's job is to *contain* its edits, not rebuild it. Recorded here so a future reader does not retrace it.

### B6 — Threat model (hacker lens) + launch requirements

This introduces a new **outbound-egress + secret-adjacent** surface against a substrate where two facts are empirically established: **(a) the worktree is not a security sandbox** (`packages/specs/spikes/p-writescope-findings.md` — a spawn writes to the parent repo / `/tmp` / sibling repos and reads arbitrary files with zero prompts), and **(b) the egress audit is Bash-only and evadable** (`network-egress-detect.js` covers 8 Bash verbs; interpreter-egress and the proposed MCP reviewer channel both bypass it). The existing secret validator (`validate-no-bare-secrets.js`) is a `PreToolUse:Write` hook — it scans files *entering* the worktree, **not the delta leaving it**.

| ID | Sev | Threat | Required mitigation |
|---|---|---|---|
| **T1** | **CRIT** | **Delta-to-vendor secret exfiltration.** A spawn reads `~/.aws/credentials` / `.env` / a key, stages the bytes into its own delta, and the Tier-2 review ships them verbatim to OpenAI/Gemini — through a channel no existing control sees. | **Mandatory fail-closed pre-egress secret/PII scrubber** on the materialized delta (reuse `validate-no-bare-secrets.js` `scanContent`; if confident redaction isn't possible → skip + attest, never ship raw). + a **data-governance clause** (delta crosses the trust boundary; require user opt-in; prefer no-retention/no-train endpoints). |
| **T2** | **CRIT** | **Reviewer prompt-injection → forged ALL-CLEAR.** The delta is Byzantine input to the reviewer; embedded instructions steer it to emit `findings: []` or downgrade a real CRITICAL. The sanitizer can't detect a *suppressed* finding. | **Datamark + content-isolate** the delta before dispatch (gstack L1–L3 equivalent: "untrusted data, never instructions"); require **structured-only output**; treat malformed/empty as *degraded*, not clean; optional canary. |
| **T3** | HIGH | **API key exposure to the reviewed spawn.** If the key is an env var, the spawn can `printenv` it; it can also leak via the plaintext journal, error stack traces, or the envelope. | Key lives **out-of-process in the MCP server** (the load-bearing argument for MCP routing); redaction pass on journal/envelope. |
| **T4** | HIGH | **"0 findings" ≡ "review suppressed" (repudiation).** A clean review and an injected/failed one produce identical empty-findings envelopes. | First-class **positive attestation**: `review_status ∈ {completed, degraded, failed, skipped}` + `response_well_formed` + coverage descriptor. Only `completed` earns a full `verification.tier`. |
| **T5** | MED | **Manual-paste provenance forgery.** A paste self-asserts `reviewer.{vendor,model}` to mint cross-vendor independence for a review never run. | Cap pasted reviews below machine-attested (B4 closure 1). |
| **T6** | MED | **Grounded-but-misleading flooding.** Bury a real CRITICAL under 50 grounded LOW nits. | Cap findings-per-delta; dedupe; consensus strictly observational (B5). |
| **T7** | MED | **Stakes-trigger down-flagging / routing gaming.** Flag a load-bearing delta "mechanical" to skip Tier-2; steer routing to the weakest vendor. | Structural leg authoritative + escalate-only flags; premise source non-spawn-writable; static routing table (B3). |
| **T8** | LOW | **Envelope/journal tampering.** "Frozen" = write-once, not tamper-evident; a local actor edits `verification.tier` `degraded`→`full`. | Content-hash the findings block into the content-addressed record-store; hash mismatch ⇒ attestation void (OQ-CMR-7). |

**Highest-priority — T1 chained with T3 (the one true blocker).** Everything else degrades *quality* or *honesty* of an advisory signal; T1 leaks **user secrets to a third party** through a channel the substrate sanctions and pays for. Because the layer is soft-fail and advisory, **not** running the review is always safe — so the correct default when the scrubber is uncertain is **skip-and-attest**, which the architecture already supports. That makes T1's mitigation cheap to adopt and removes the only true blocker.

**C1 launch requirements (non-deferrable):** T1 scrubber + data-governance opt-in; T2 datamark + structured-only output; T4 positive review-status attestation. These are not "open questions" — they gate the first build.

---

## Part C — What to fold into v6 (actionable)

Each item uses the field-survey rubric. **These are candidates, not commitments.**

### C1 — Cross-model review as advisory primitive (the substantive borrow)

- **Gap:** PL's adversarial verification is same-model-family (correlated failure modes). No cross-vendor independence; no grounding requirement on advisory findings.
- **Proposed mechanism:** a **Runtime** advisory producer (NOT kernel — architect HIGH-2) consuming a resolver close-event, emitting grounded findings (B1) frozen into a new `verification` field on the §4.2 envelope; a **Kernel pure-fn** grounding sanitizer; routing as a static table; consensus/confidence as a Lab derived view.
- **Launch requirements (non-deferrable, per hacker B6):** pre-egress secret scrubber + data-governance opt-in (T1); reviewer datamark + structured-only output (T2); positive `review_status` attestation (T4); MCP-held key isolation (T3).
- **v6 anchors:** Axiom 3b (`:381`); GPT-1.C split (`:504`); A6 snapshot (`:397`) + the A6 transitive-path clause (`:410`) for `INV-CMR-NoLiveReputationRead`; A10 evidence-linked admission (`:453`); §4.2 transaction-record (`:526`); R13 advisory-findings; E14-adjacent (`:1165`).
- **Target release:** v3.2 (Runtime decomposition — advisory producers) for the grounded-finding + sanitizer + routing; v3.3 (Lab) for consensus/reputation. **Do not** put it in v3.1 (the static-capability + record-store arc is the priority).
- **Effort (rough):** M–L. Sanitizer + finding schema ~S; resolver producer + static routing ~M; MCP reviewer wiring ~S; consensus/Lab view ~M (v3.3).
- **Pillar served:** Pillar 2 (Byzantine — independent failure modes + grounded inputs).

### C2 — Stakes-trigger on a reversibility axis (B3)

- **Gap:** `route-decide` scores implementation-complexity / convergence_value, not reversibility × blast-radius. No deterministic "is this load-bearing?" classifier to gate expensive verification.
- **Proposed mechanism:** a deterministic stakes classifier over changed-paths + author-flagged premises, shipped as a **sibling module `stakes-decide.js`** reusing `route-decide.js`'s scaffolding (NOT a route-decide axis — architect MED-2). Structural leg authoritative; author flags escalate-only; premise source non-spawn-writable (hacker T7).
- **Target release:** v3.2 (pairs with C1 — it is C1's trigger).
- **Effort:** S–M.
- **Pillar served:** Pillar 2 + Pillar 3 (advisory, cost-bounded).

### C3 — Doc-gen-from-source + CI freshness (the cheap, unambiguous win)

- **Gap:** persona/command/hook docs drift (PRs #183/#184 were drift fixes). gstack generates `SKILL.md` from source at build time with a CI `--dry-run` freshness check.
- **Proposed mechanism:** generate persona/command/hook doc sections from the contracts (`packages/runtime/contracts/*.contract.json`) + a CI freshness validator. PL already has the validator culture.
- **Target release:** v3.2 or opportunistic (low-risk, high-leverage).
- **Effort:** S–M.
- **Pillar served:** operational hygiene (no direct pillar; reduces honesty-drift surface).

### C4 — Negative-attestation surfacing for degraded verification (B4)

- **Gap:** no first-class record when verification ran at a *reduced* independence tier.
- **Proposed mechanism:** the E1 negative-attestation (already on the roadmap) as the carrier for "cross-vendor skipped → same-vendor fallback"; `verification.tier` in the envelope.
- **Target release (SPLIT — architect MED-3):** the `verification.tier` field + the "fell-back-to-same-vendor" negative attestation ship **WITH C1 at v3.2** — a Tier-2 review that silently degrades is a Pillar-3 honesty violation the moment C1 ships, so the honesty carrier cannot lag a release behind. Richer E1 incident/postmortem integration stays **v3.3**.
- **Effort:** S (the v3.2 field is schema-additive; the v3.3 E1 integration composes with E1).
- **Pillar served:** Pillar 3 (auditable) + Pillar 2.

### C5 — Product/delivery personas (lower priority; the gstack role gap)

- **Gap:** PL's 16 personas are all engineering/verification lenses; no product-interrogation / design / release-manager roles.
- **Proposed mechanism:** add gstack-style delivery personas to `packages/runtime/personas/` — riding the containment substrate (the novel combination). **Runtime-layer only; no kernel change.**
- **Target release:** v3.3+ (after the verification arc; this is breadth, not depth).
- **Effort:** L (persona + contract authoring).
- **Pillar served:** Pillar 4 (role-separation) — extends coverage, not mechanism.

### Do NOT fold

- Browser / runtime-execution as a **kernel gate** (B5 — rejected).
- Any design that lets cross-model findings **gate promote/reject** (Axiom 3a violation).
- Same-vendor fallback recorded **as if** cross-vendor (honesty violation).

---

## Part D — Open questions for the plan phase

1. **OQ-CMR-1 — Routing table shape.** Is per-task-class routing (`security → vendor X`, `perf → vendor Y`) worth the config surface, or is "any vendor ≠ author" sufficient for v1? *(Architect affirmed the YAGNI instinct: "any vendor ≠ author" is the recommended v1 decision; per-class specialization is speculative config.)*
2. **OQ-CMR-2 — RESOLVED → promoted to invariant.** Consensus feeding reputation/routing is now governed by `INV-CMR-NoLiveReputationRead` (B2): consensus is observational and may influence routing only via the A6 snapshot (`:410`), never a live read; it MUST NOT widen capability scope.
3. **OQ-CMR-3 — RESOLVED → C1 launch requirement.** Delta-as-Byzantine-input to the reviewer is no longer "likely yes" — datamarking + content-isolation + structured-only output is a non-deferrable C1 launch requirement (B6/T2).
4. **OQ-CMR-4 — Premise source (now with a constraint).** Where does the stakes-trigger read "author-flagged premises" — plan-file `## Runtime Probes` section? a frontmatter field? Still needs a concrete source, **and that source MUST be one the reviewed spawn cannot edit** (hacker T7).
5. **OQ-CMR-5 — Budget reconciliation.** v3.2/v3.3 row totals in §6.11 were not updated for this; if folded, the LOCK review needs row expansion (same caveat as the v6 HD-3 disclosure).
6. **OQ-CMR-6 — Data-governance / retention policy (NEW, from T1).** Which vendors/endpoints are allowed for cross-vendor dispatch? Is a no-retention/no-train contractual setting required? What is the user opt-in granularity (per-repo? per-session? standing policy)? The delta crosses the trust boundary to a third party — this is a policy decision, not a code decision.
7. **OQ-CMR-7 — What does "frozen" enforce? (NEW, from T8).** Does freezing findings into the envelope mean write-once or tamper-evident? Recommendation: content-hash the findings block into the content-addressed record-store so replay detects post-hoc edits (hash mismatch ⇒ attestation void). Lean on the existing content-addressed store; don't over-build.

---

## Part E — Runtime claims to re-probe (state moves)

The downstream session should re-verify these against the repo at its commit (probed here at `228b137`):

- `packages/kernel/hooks/post/spawn-close-resolver.js` exists and observes the worktree delta at close (PR-3b seam for C1).
- `packages/kernel/algorithms/route-decide.js` exists (C2 reuse target).
- `packages/kernel/_lib/k9-promote-deltas.js`, `quarantine-promote.js`, `packages/kernel/spawn-state/stage-promote.js` exist (the unchanged promote path).
- `packages/kernel/observability/network-egress-audit.js` exists (the egress-audit lane for B5).
- `v6-substrate-synthesis.md` line anchors cited above (`:377` 3a, `:381` 3b, `:397` A6, `:453` A10, `:504` GPT-1.C, `:526` §4.2, `:1145` §6.2, `:1165` §6.4) — verify they still point at the same sections after any v6 re-numbering.
- The "ADR-0012: PreToolUse `updatedInput` is inert on Agent/Task spawns" claim underpins B4's headless reasoning — treat as established (ADR-0012) but re-confirm the ADR is unsuperseded.

---

## Part F — HETS cross-validation appendix

*Populated after the architect / honesty-auditor / hacker lens pass. Each lens ran read-only against this doc. Verdicts and how findings were resolved are recorded below.*

Three read-only HETS lenses ran in parallel against this doc (and against `v6-substrate-synthesis.md` as primary source). Each finding's disposition is recorded below — **Applied** = folded into this doc; **Deferred (OQ)** = carried to the plan phase as an open question; **Affirmed** = lens confirmed the doc was already correct.

### Verdicts

| Lens | Verdict | Headline |
|---|---|---|
| **architect** | APPROVE-WITH-CHANGES | Affirmed the Axiom 3a/3b correction as correct + load-bearing; caught a layer-boundary bug (LLM dispatch sited in kernel). |
| **honesty-auditor** | A− (MINOR-OVERCLAIMS) | 34/34 load-bearing claims source-compliant; the "composes natively / direct application" framing was the one overclaim worth fixing. |
| **hacker** | NEEDS-THREAT-MODEL-SECTION | Found an unmodeled CRITICAL (T1 delta-to-vendor secret exfiltration); the worktree is not a sandbox, the egress audit can't see the MCP channel. |

### Architect — disposition

| Finding | Sev | Disposition |
|---|---|---|
| Axiom 3a/3b correction is correct + is the doc's real contribution | AFFIRM | ✓ Affirmed (kept as TL;DR §3 + B2) |
| A finding can't gate but can *motivate* a separate pure A3a gate ("scout") | note | ✅ Applied (B2 "scout, not a gate") |
| HIGH-1 — state A6-snapshot reputation path as an invariant (`:410` + `:179`) | HIGH | ✅ Applied (`INV-CMR-NoLiveReputationRead`, B2) |
| HIGH-2 — LLM dispatch must live in Runtime, not `packages/kernel/**`; name the new envelope field | HIGH | ✅ Applied (B2 seam redraw + C1) |
| HIGH-3 — elevate delta-injection defense to a C1 launch requirement | HIGH | ✅ Applied (B6/T2 + C1) |
| MED-1 — pin `cited_sha` canonicalization or replay has a hole | MED | ✅ Applied (B1) |
| MED-2 — ship stakes classifier as sibling `stakes-decide.js`, not a route-decide axis | MED | ✅ Applied (B3 + C2) |
| MED-3 — pull `verification.tier` + negative-attestation forward to v3.2 with C1 | MED | ✅ Applied (C4 split) |
| YAGNI — "any vendor ≠ author" sufficient for v1 routing | LOW | ✅ Applied (OQ-CMR-1) |

### Honesty-auditor — disposition

| Finding | Sev | Disposition |
|---|---|---|
| F1 — "composes natively / direct application of GPT-1.C" overclaims inevitability | MED | ✅ Applied (reworded to "instance of the class the split governs", TL;DR §2 + B1) |
| F2 — tighten "not a gate" so a reader doesn't conclude "no gating at all" | MED | ✅ Applied (TL;DR §3) |
| F7 — "66K developers adopted" launders stars into installs | LOW | ✅ Applied ("~66K stars, a demand signal not an install count") |
| F8 — label the B1 code block as illustrative | LOW | ✅ Applied (B1 code comment) |
| F3 — same-vendor independence honestly scoped (partial, not equivalent) | — | ✓ Affirmed (no change) |
| F4 — browser correctly marked REJECTED not deferred | — | ✓ Affirmed |
| F5 — effort estimates honestly hedged as estimates | — | ✓ Affirmed |
| F6 — Part E runtime claims honestly flagged for re-probe (and currently true) | — | ✓ Affirmed |

### Hacker — disposition

| Finding | Sev | Disposition |
|---|---|---|
| T1 — delta-to-vendor secret exfiltration (the one true blocker) | CRIT | ✅ Applied (B6/T1 + C1 launch req); residual policy → OQ-CMR-6 |
| T2 — reviewer prompt-injection → forged ALL-CLEAR | CRIT | ✅ Applied (B6/T2 + C1; resolves OQ-CMR-3) |
| T3 — API key exposure to the reviewed spawn | HIGH | ✅ Applied (B4 key isolation + B6/T3) |
| T4 — "0 findings" indistinguishable from "review suppressed" | HIGH | ✅ Applied (B6/T4 `review_status` + C1) |
| T5 — manual-paste provenance forgery | MED | ✅ Applied (B4 closure 1 cap) |
| T6 — grounded-but-misleading flooding | MED | ✅ Applied (B5 adversarial bound) |
| T7 — stakes-trigger down-flagging / routing gaming | MED | ✅ Applied (B3 + C2 escalate-only; OQ-CMR-4 constraint) |
| T8 — envelope/journal tamper-evidence | LOW | ↪ Deferred (OQ-CMR-7) |

**Net:** every CRITICAL/HIGH was folded in; two findings became invariants (`INV-CMR-NoLiveReputationRead`) or resolved OQs; one LOW (T8) and several policy questions are carried to the plan phase as OQs. The doc's central thesis — advisory-only, grounding-as-sanitizer-not-gate, frozen-attestation replay — survived all three lenses intact.

---

## Sources

- gstack repo + README — <https://github.com/garrytan/gstack>
- gstack `ARCHITECTURE.md` — <https://github.com/garrytan/gstack/blob/main/ARCHITECTURE.md>
- Third-party analysis (strengths/limitations) — <https://www.augmentcode.com/learn/garry-tan-gstack-claude-code>
- HN discussion — <https://news.ycombinator.com/item?id=47355173>
- Power Loom v6 synthesis — `packages/specs/rfcs/v6-substrate-synthesis.md`
- Field-survey-debt format analog — `packages/specs/research/v3.1-v3.2-field-survey-debt.md`
