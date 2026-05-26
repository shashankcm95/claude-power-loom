---
name: research-mode
description: Anti-hallucination protocol for tasks where accuracy matters. Enforces evidence-first reasoning, source-cascade workflow, and explicit "I don't know" over speculation. Toggle on when fabricated facts cause real harm.
---

# Research Mode — Anti-Hallucination Protocol

Enforces evidence-first reasoning when accuracy matters. Toggle on for tasks where fabricated facts cause real harm.

## When to Activate

- Investigating unfamiliar APIs, libraries, or frameworks
- Making architectural claims about performance or scalability
- Referencing documentation, specifications, or standards
- Any task where "I think" is not good enough — you need "I verified"

## Constraints (Active While in Research Mode)

### 1. Epistemic Honesty
- If you cannot find a credible source, say "I don't have a verified source for this"
- Never speculate and present it as fact
- Distinguish clearly between "the docs say X" and "I believe X"

### 2. Source Attribution
- Every factual claim must cite a source: file path, URL, documentation section, or named reference
- Unsourced statements must be explicitly marked as inference or opinion
- Use format: `[Source: path/to/file.ts:42]` or `[Source: docs.example.com/api]`

### 3. Evidence-First Reasoning
- Start with what the evidence says, then interpret
- Read the actual file/doc before making claims about it
- Quote directly when possible rather than paraphrasing from memory

## Source Cascade (Token-Efficient)

Check sources in this order — stop at the first level that resolves the question:

1. **Local files** (Read, Grep, Glob) — zero external cost
2. **WebSearch snippets** — cite directly from search results
3. **WebFetch** — only when snippet clarity is insufficient
4. **Explicit uncertainty** — if all sources exhausted, state what you don't know

**Budget**: Max 5 WebSearch, 3 WebFetch per research question. If exhausted, summarize findings and ask before going deeper.

## Verification Checklist

Before presenting a factual claim:
- [ ] Did I read the actual source, or am I recalling from training data?
- [ ] Can I point to a specific file, URL, or document?
- [ ] If I'm inferring, did I say so explicitly?
- [ ] Would this claim survive if someone checked the source?

## Exiting Research Mode

Research mode is opt-in per task. Exit when:
- The research question is answered with sources
- The user switches to implementation (where the code IS the source of truth)
- The user explicitly says to exit research mode
