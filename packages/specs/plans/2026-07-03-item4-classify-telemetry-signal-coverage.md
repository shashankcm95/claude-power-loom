---
lifecycle: persistent
status: PLANNED — item-4 W1-next (classifier signal-coverage + telemetry); SHADOW/additive; low-risk
created: 2026-07-03
plan-type: lab-experiment (SHADOW, advisory — gates nothing)
title: item-4 W1-next — classify-telemetry aggregator + conservative signal-coverage widening
depends-on: packages/lab/persona-experiment/issue-classifier.js (#443, merged 2a4c1d7) ; packages/lab/persona-experiment/live-draft-run.js (the artifact writer)
---

# Plan — item-4 W1-next: classify-telemetry + signal-coverage

## Context (what already exists — verified on origin/main)

Item-4's classifier + materializer shipped in **#443 (`2a4c1d7`)**, SHADOW-wired behind
`LOOM_PERSONA_MATERIALIZE` (default off). `classifyIssue(record) -> {persona, classify_signal, matched}`
is deterministic/total; `classify_signal ∈ {matched, no-keyword-match, ambiguous-tie, matched-no-brief,
classify-threw}`. Each live artifact (`draft-<id>.json`) carries top-level `{persona, classify_signal,
matched}` (spread via `classifyFields` in `live-draft-run.js:272`). The gap-map's "item-4 MISSING" note
was stale (a `drift:recon-depth` instance); the classifier is built.

**The genuinely-open W1-next delta** (from the design-exploration architect): the classifier's behaviour
is per-artifact but NOT aggregatable (you cannot query "what fraction of live issues abstained/tied"),
and its 9-persona signal table is thin. This wave adds (1) a read-only telemetry aggregator and (2) a
conservative, audited signal widening. Still SHADOW — gates nothing, hardens no trust.

## Scope

1. **`classify-telemetry.js`** — a PURE `summarizeClassifications(artifacts[])` fold + a thin read-only
   CLI. NEW; no existing code changes shape.
2. **`issue-classifier.js` `PERSONA_SIGNALS`** — MODIFY: add a small set of high-confidence, audited
   domain phrases per persona. Table-only change; no signature/logic change.
3. **Docs** — refresh the stale item-4 status in the gap-map (dated accretion, per the status-decay rule).

## Design

### The aggregator (pure core + thin shell)

`summarizeClassifications(artifacts)` -> `{ total, matched, abstained, tied, matched_no_brief, threw,
unknown, inconsistent, per_persona }`:
- One counter per `classify_signal` value; `no-keyword-match -> abstained`; an artifact whose
  `classify_signal` is missing/legacy/unrecognized -> `unknown` (backward-compat; never throws).
- `per_persona[<persona>]` counts artifacts with a non-null `persona`.
- **Expected invariant of a well-formed stream (tested):** `sum(per_persona) === matched + tied` —
  because `ambiguous-tie` ALSO returns a non-null persona (the priority winner), not just `matched`. (The
  design-exploration spec said "sums to matched"; that is wrong — a tie yields a persona too.) The
  aggregator does not TRUST this — it reads persisted files — so it also emits `inconsistent`, a self-check
  that increments when a recognized signal and the persona-present bit disagree (added at VALIDATE).
- **Prototype-pollution safe (added at VALIDATE/CodeRabbit):** `per_persona` and `SIGNAL_BUCKET` are both
  `Object.create(null)`, so a hostile/legacy `persona`/`classify_signal` key (`__proto__`/`constructor`/
  `hasOwnProperty`) is a normal own key / a clean miss, never inherited-member corruption.
- Pure, total, idempotent; `Array.isArray` guard -> empty summary on a non-array (no NaN/throw).
- **Residual (accepted):** multi-word/hyphenated phrases (`node.js`, `parquet file`, `scikit-learn`) use
  substring match, not the single-token boundary regex — a pre-existing `wordMatch` design (changing it
  risks the intentional `uv`-trailing-space and `node.js` semantics); the space/hyphen makes an
  inside-a-word hit unlikely.

The CLI: read `<artifactsDir>/draft-*.json` (SKIP `run-report.json` + any parse error), fold, print the
summary JSON. Read-only; touches no trust weight; never writes.

### Signal widening (conservative, audited)

Add per-persona phrases ONLY when ALL hold (the architect's sharpest-risk guard):
- **word-boundary safe** — a single alnum token is matched via the existing `wordMatch` boundary regex
  (cannot hit inside a longer word); a multi-word/dotted phrase stays a substring.
- **not a real English word** even word-bounded (the `spark`/`hibernate`/`poetry` trap) — prefer
  unambiguous proper-noun/compound tokens (`fastapi`, `pydantic`, `nextjs`, `pytorch`, `owasp`) over
  ambiguous single words; a risky single word is SKIPPED or made multi-word.
- **no cross-persona collision** — the phrase is discriminative for exactly one builder persona.
- Every added phrase gets a RED-then-green test: (a) it classifies its intended persona, (b) a
  chosen near-miss word does NOT hit it (boundary), (c) it does not steal a sibling persona's issue.

## Deliverables

1. `packages/lab/persona-experiment/classify-telemetry.js` (pure fn + CLI).
2. `packages/lab/persona-experiment/issue-classifier.js` (PERSONA_SIGNALS additions only).
3. `tests/unit/lab/persona-experiment/classify-telemetry.test.js` (table-driven over the fold).
4. `tests/unit/lab/persona-experiment/issue-classifier.test.js` (append: per-new-phrase RED/green +
   the per_persona==matched+tied invariant is exercised via the aggregator test).
5. `packages/specs/research/2026-06-25-autonomous-sde-lifecycle-gap.md` (dated status-refresh).

## Named residuals / deferred

- **Real recall tuning needs a LABELED real-issue corpus** — without one, widening is principled-guess,
  not measured. This wave adds only high-confidence phrases + the aggregator that MAKES the distribution
  measurable; a corpus-driven tuning pass is deferred.
- **Materializer behavioral ACTIVATION** (does the injected block change the solve) — deferred, needs a
  live A/B gated on item-5 (unchanged from #443's named residual).
- **No aggregation persistence** — the CLI computes on demand from artifacts; a stored rollup is YAGNI.

## Sharpest risk (for the VALIDATE board)

A widened phrase that is a real English word (even word-bounded) silently corrupts the SHADOW dataset by
mis-classifying benign issues; and a phrase overlapping a sibling persona lets keyword-stuffing steer the
classifier. Both are harmless under SHADOW (gates nothing) but become load-bearing if a future wave
promotes the persona to gating. The hacker should: fuzz each added phrase for a real-word/near-word
false-positive, and confirm a keyword-stuffed body still logs `ambiguous-tie` (visible laundering), not a
clean `matched`. The aggregator's risk is a miscount that makes a bad distribution look clean — test the
`per_persona == matched + tied` invariant + the `unknown` bucket for legacy records.

## Routing / process

`route-decide` returns `root` on this lab-tier additive change (substrate-meta lexicon miss); by judgment
this is a small, well-scoped SHADOW wave — TDD build (aggregator pure-first) -> 2-lens VALIDATE
(code-reviewer correctness + hacker for the signal/injection surface; honesty-auditor only if the
widening ROI claim needs it) -> PR. NOT a kernel/security/data-mutation diff, so the full 3-lens tier is
not mandatory (persona-selection Rule 2).

## VALIDATE result (2-lens, 2026-07-03) — SHIP-WITH-NOTES; all confirmed findings folded

Board: code-reviewer (correctness) + hacker (Rule-2a live re-probe). Both SHIP-WITH-NOTES. The board
earned its keep — it caught a hole in my own real-word audit + two aggregator hardening gaps.

**Folded (confirmed):**
- **[hacker MEDIUM] `parquet` + `ansible` are real English words** — `parquet` (hardwood flooring / a CSS
  tiling pattern), `ansible` (a standard SF FTL term). My audit comment falsely claimed all added phrases
  passed the "not a real word" test; the hacker's probes mis-classified a CSS issue -> data-engineer and a
  sci-fi issue -> devops-sre. FIXED: scoped to `parquet file` / `ansible playbook`; audit comment corrected;
  a regression test pins the bare forms as null and the multi-word forms as classifying.
- **[hacker MEDIUM] aggregator prototype pollution** — `per_persona[persona]` with a hostile/legacy persona
  key (`__proto__`/`constructor`/`hasOwnProperty`). FIXED: `per_persona` is now `Object.create(null)`; a test
  pins the three hostile keys as normal own keys with a null prototype.
- **[hacker MEDIUM] CLI symlink follow** — a `draft-*.json` symlink was read via `fs.readFileSync`. FIXED:
  `lstatSync` (no-follow) + `isFile()` gate skips symlinks/dirs (the repo's own no-follow discipline); a test
  plants a symlink and asserts the target is not read.
- **[code-reviewer MEDIUM / hacker LOW] the invariant was documented as "load-bearing" but not enforced** —
  the aggregator counted persona and signal independently. FIXED: an `inconsistent` self-check counter fires
  when a recognized signal and the persona-present bit disagree, so a corrupt distribution surfaces instead
  of miscounting silently; the comment now states the aggregator DETECTS violations.

**Accepted residuals (named, not folded):**
- **[code-reviewer LOW] `scikit-learn` (hyphenated) uses substring match** — same class as the pre-existing
  `node.js`; SHADOW-only noise. A future wave can word-bound hyphenated tokens in `wordMatch`.
- **[hacker LOW] single-persona keyword-stuffing classifies as that persona under a clean `matched`** —
  inherent to a keyword scorer; `matched` is confidence in the KEYWORD SCORE, not evidence of a single-domain
  issue. Harmless under SHADOW; if the persona ever gates a spawn, add a multi-domain signal. Documented.

**Post-fold gates:** aggregator 11/11; issue-classifier 42/42; persona-experiment suite 16/16 (no
regression); eslint + signpost clean; the `inconsistent` counter + CLI symlink-skip verified by live smoke.
