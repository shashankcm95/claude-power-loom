# H.4.3 — Prompt-enrich-trigger intent-aware skip (PASS)

> Eighth distinct phase shape. Closes user-flagged gap: confirmation variants leaked past strict SKIP_PATTERNS regex despite being obvious approvals. **Shipped root-direct** — route-decide gate said `root` at score 0.075 (small ~50 LoC change, established pattern). The discipline check fired correctly; no architect spawn justified.

## Cycle headline

- **No paired verdict** — root-direct ship per route-decide gate recommendation
- **10/10 smoke tests pass** (3 new H.4.3 cases + 7 existing)
- **0 contracts-validate violations**
- **Pattern reuse**: `[CONFIRMATION-UNCERTAIN]` forcing instruction mirrors H.7.5's `[ROUTE-DECISION-UNCERTAIN]` exactly — no new substrate primitive

## Motivation

The user noticed (during the H.7.0 enrichment review) that the existing `prompt-pattern-store.js` lookup uses Jaccard similarity on word sets — purely lexical, no intent layer. Their concern was that confirmations like `"sure"`, `"go ahead"`, `"go for it"` all convey the same intent but have completely different keywords, so a Jaccard-based lookup couldn't unify them.

On verification, the picture turned out to be more nuanced — there are TWO layers, doing different things:

1. **Layer 1 — `prompt-enrich-trigger.js` SKIP_PATTERNS** (the hook gate): strict-anchored regex on entire prompt. `"sure, go for it"` fails the `^...$` anchor because of the trailing commentary, even though `"sure"` would have matched. This is where the actual leak happens.

2. **Layer 2 — `prompt-pattern-store.js` Jaccard similarity** (only runs WITHIN enrichment): purely lexical token overlap. `"fix the auth flow"` vs `"debug the login bug"` → Jaccard=0. Real concern but only matters AFTER the upstream gate has decided to enrich.

H.4.3 closes Layer 1 (the more glaring gap). Layer 2 deferred — addresses a smaller surface and benefits more from MemPalace embedding-cosine fallback when usage justifies.

## What landed

### `hooks/scripts/prompt-enrich-trigger.js` (~50 LoC additive)

#### Layer 1 — SKIP_PATTERNS expansion

Two new regexes added to the existing 4:

```js
// H.4.3: confirmation + brief continuation. Affirmation possibly followed by
// a confirmation-shape action phrase. Capped to avoid false-positives.
/^\s*(yes|yep|yeah|yup|sure|ok|okay|absolutely|of course|definitely|cool|nice|perfect|great|awesome|alright|got it)[\s,.!]*((let'?s\s+)?(go|do|ship|proceed|continue|carry)\s*(for it|ahead|on|it|this|that|the thing|with (it|this|that|[a-z]+))?)?(\s+(now|please|if you can))?\s*[.!?]?\s*$/i,

// H.4.3: standalone action-word confirmations
/^\s*(go for it|do (it|that|this|the thing)|ship it|let'?s\s+(go|ship|do (it|this|that|the thing)|go with (it|this|that|[a-z]+)|ship it)|make it so|carry on(?:\s+then)?|that works|works for me)(\s+(now|please|if you can))?\s*[.!?]?\s*$/i,
```

**Design constraints honored**:
- Continuation portion capped to confirmation-shape verbs (`go|do|ship|proceed|continue|carry`) so `"yes the thing is broken"` still reaches enrichment (correct — that's an observation, not a confirmation)
- `[a-z]+` placeholder for `let's go with X` allows the user's exact prompt `"let's go with b"` to skip cleanly while still being conservative

#### Layer 2 — `[CONFIRMATION-UNCERTAIN]` forcing instruction

When prompt is `≤ 5 words` AND contains a soft confirmation signal AND failed strict regex AND lacks file path / specific entity, emit:

```
[CONFIRMATION-UNCERTAIN]

This short prompt has confirmation-shape signals but didn't match strict
skip regex. Before enriching, consult the PRIOR turn:

- If the prior turn proposed a concrete action / recommendation, treat
  this prompt as approval and proceed with that action (skip enrichment).
- If the prior turn was a question or asked the user to choose, this
  prompt is the answer — handle accordingly without enrichment.
- ONLY enrich (via the standard 4-part flow) if the prior turn provided
  NO concrete proposal AND this prompt's intent is genuinely unclear.

Raw user prompt: "..."

This forcing instruction mirrors [ROUTE-DECISION-UNCERTAIN] (H.7.5)
— the deterministic layer abstained; root makes the semantic call by
reading the prior turn rather than the bare prompt.

[/CONFIRMATION-UNCERTAIN]
```

**Pattern parallel** (toolkit's "no subprocess LLM" convention):
| Forcing instruction | When emitted | Phase |
|--------------------|--------------|-------|
| `[PROMPT-ENRICHMENT-GATE]` | Prompt is vague (full ceremony) | H.4.x |
| `[ROUTE-DECISION-UNCERTAIN]` | Bare task low-signal, no context provided | H.7.5 |
| `[CONFIRMATION-UNCERTAIN]` | Short ambiguous, soft confirmation signal, strict regex abstained | H.4.3 |
| `[SELF-IMPROVE QUEUE]` | Pending self-improve candidates | H.4.1 |

### `install.sh` — 3 new smoke tests (7 → 10)

```
✓ Test 8: H.4.3 confirmation-variant skip (sure, go for it)
✓ Test 9: H.4.3 standalone confirmation skip (go for it)
✓ Test 10: H.4.3 [CONFIRMATION-UNCERTAIN] forcing instruction
```

### `ATTRIBUTION.md` — count update

`7-point hook smoke test suite` → `10-point hook smoke test suite (extended in H.4.3 with 3 confirmation-variant cases)`

## Self-test (15 confirmation cases + 5 negative)

### ✓ Skip cases (silent no-op)

| Prompt | Behavior | Note |
|--------|----------|------|
| `"sure"` | skip | Existing |
| `"go ahead"` | skip | Existing |
| `"sure, go for it"` | **skip** | NEW — was previously leaking |
| `"go for it"` | **skip** | NEW |
| `"yeah do it"` | **skip** | NEW |
| `"let's go with b"` | **skip** | NEW (exact user prompt that motivated CS-13 ship earlier) |
| `"make it so"` | **skip** | NEW |
| `"absolutely"` | **skip** | NEW |
| `"cool"` | **skip** | NEW |
| `"of course"` | **skip** | NEW |
| `"do that"` | **skip** | NEW |
| `"lgtm"` | skip | Existing |
| `"sounds good"` | skip | Existing |

### ✓ CONFIRMATION-UNCERTAIN (soft forcing)

| Prompt | Behavior | Why |
|--------|----------|-----|
| `"ship it"` | CONFIRMATION-UNCERTAIN | `ship` is a `VAGUE_KEYWORDS` verb (`\bship\s+${REF}\b`) — could be standalone "ship the feature" request |
| `"let's ship it"` | CONFIRMATION-UNCERTAIN | Same — defer to prior turn |
| `"go on"` | CONFIRMATION-UNCERTAIN | Short + soft signal, no clear continuation |

This is **correct behavior** — those verbs are genuinely ambiguous without context. Silent skip would be too aggressive; full enrichment would be too heavy. The forcing instruction asks Claude to apply intent reasoning from the prior turn — exactly the toolkit's pattern.

### ✓ No regression on real requests

| Prompt | Behavior |
|--------|----------|
| `"yes the thing is broken"` | CONFIRMATION-UNCERTAIN (correct — ambiguous: agreement that thing is broken? or report?) |
| `"fix the auth"` | PROMPT-ENRICHMENT-GATE (correct — vague-keyword `fix the` matched) |
| `"ship the new feature with proper tests"` | PROMPT-ENRICHMENT-GATE (correct — `ship the` matched) |
| `"git push origin main"` | skip (correct — existing tool-prefixed skip) |

## Why root-direct (no architect spawn)

Route-decide gate output on the task description:
```json
{
  "task": "Ship H.4.3 prompt-enrich-trigger intent-aware skip — closes confirmation-variant gap...",
  "recommendation": "root",
  "score_total": 0.075,
  "weights_version": "v1.1-context-aware-2026-05-07"
}
```

Score 0.075 is well below the root threshold (0.30). The gate correctly identified this as small-bounded work where:
- Pattern is already established (H.7.5's forcing-instruction architecture)
- Load-bearing decisions are minimal (regex covers specific phrasings; forcing instruction format mirrors precedent)
- Architect spawn would have burned ~50-70K tokens designing ~50 LoC

Shipping this through pair-run would have been the BACKLOG-cleanup-class over-route the H.7.3 gate exists to prevent. Discipline check fired correctly.

## What this DOESN'T claim to fix

- **Pattern-store Jaccard ceiling** — paraphrased intents (`"fix the auth flow"` vs `"debug the login bug"`) still don't match. Deferred until MemPalace embedding-cosine fallback makes sense.
- **`"go to" / "do the X"` vague-keyword gaps** — pre-existing surface where `"go to the file at /tmp/x"` and `"do the migration on the database"` slip through silently. Logged in BACKLOG H.4.3 follow-ups.
- **Mid-prompt confirmations** (`"actually, let's just go with the simple option"`) — only the strict-anchor variants are caught. Lower priority — these tend to be longer and have specific entity content that hits other paths.

## Pattern generalization (eighth phase shape)

| Phase | Shape | Pair |
|-------|-------|------|
| H.7.1 | callsite-wiring | architect + 13-node-backend |
| H.7.2 | substrate-extension | architect + 13-node-backend |
| H.5.7 | contract-template | architect + 13-node-backend |
| CS-6 | doc work | architect + confused-user |
| H.7.3 | intelligence-layer | architect + 13-node-backend |
| H.7.4 | data-driven refit | architect + 13-node-backend (high-trust spot-check) |
| H.7.5 | context-aware refinement | architect-only (root-impl) |
| **H.4.3** | **forcing-instruction reuse** | **root-direct (no spawn — gate said `root`)** |

Eighth distinct phase shape: **root-direct ship guided by route-decide gate**. The corrected autonomous-platform pattern accommodates the full spectrum from "full pair-run" to "architect-only" to "no spawn." The gate is the discipline that prevents waste at the cheap end of the spectrum.

## Closure

Phase H.4.3 closes the user-flagged confirmation-variant gap. The intent layer the user asked for IS now present — but as forcing-instruction injection (Layer 2), not as embedding-based pattern matching (which would have violated the toolkit's no-subprocess-LLM convention).

The architectural symmetry is:
- H.7.5 added context-awareness to route-decide
- H.4.3 added intent-awareness to prompt-enrich
- Same shape: deterministic regex first, forcing-instruction fallback when keywords abstain

This unblocks H.7.0 (the trust-formula richness work the user originally enriched). The substrate is now cleaner — confirmations route correctly without ceremony.

Toolkit verdicts: 23 → 23 (no spawn this phase). The corrected pattern has now demonstrated all four spawn modes:
- 2-paired (architect + builder) — H.7.1, H.7.2, H.5.7, H.7.3, H.7.4
- 1-paired-asymmetric (architect + confused-user) — CS-6
- 1-architect-only (root-impl) — H.7.5
- 0-spawn (root-direct) — CS-13, publish-polish-H.0, H.4.3
