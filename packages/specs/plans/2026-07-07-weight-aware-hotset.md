# Plan — weight-aware scored hot-set (Phase 2 slice 1)

lifecycle: persistent

## Scope (this slice)

Phase 2's FIRST slice: make `scripts/memory.js` `hotSet` **weight-aware** — a scored hot-cache that unifies the
two signals currently kept SEPARATE (hotSet = recency+refs; check = importance+bytes). Design north-star (ADR-0018
shared-kernel / Q1): a scored hot-set = **recency-decay x importance x log(refs)**, with **invariant-class blocks
PINNED** (GDSF cost-aware + the Generative-Agents importance-protector).

**Deferred to later slices (NOT this PR):** the scar block-cache materialization + "split-by-origin". The "dup `24.`"
note is **grep-negative in `memory.js`** (stale / misattributed — likely a MEMORY.md or topic-file entry, not this
code); left out until re-identified against a concrete file.

## Runtime probes (verified against the real code, 2026-07-07)

- `hotSet` (`scripts/memory.js:252-259`) sorts by `last_ref` (recency) THEN `refs`; reads ONLY the heat sidecar
  `{last_ref, refs}` per anchor. Importance-blind. Signature: `hotSet(file, n=5, {liveAnchors})`.
- `importanceOf(sectionTitle)` (`:269-275`) -> `{cls, weight, protected}`: invariant w3/protected; project w2;
  reference w1; historical w0. Classifies an **H2 section title** (regex on the title).
- `importanceOf` is consumed ONLY in `cmdCheck` (`:375`, demote ranking) — disconnected from `hotSet` ("orphaned").
- `parseBlocks(text, {level})` (`:81-126`) does NOT record an H3 block's enclosing H2 section; an H2 heading just
  CLOSES the current H3 block. So a scar block (`### SCAR-NN`) has no `section` field today.
- `recency-decay.js` leaf EXISTS: `computeRecencyDecayAt(history, nowMs)` reads `entry.ts` (ISO), returns mean
  `exp(-ageDays/30)` in (0,1] or null. Reusable for the recency term (heat `last_ref` -> `{ts: last_ref}`).
- Test contract `tests/unit/scripts/memory-cli.test.js` (25 tests): s7 (hotSet recency-LRU, ties by refs), s8
  (hotSet caps at N), s9 (importanceOf protects invariant, ranks historical lowest), s11 (cmdCheck demote list).
  s7/s8 pin the CURRENT recency-only ordering — the back-compat constraint.

## Proposed design (for the VERIFY board to pressure-test)

- **Score** `= recencyDecay(last_ref, now) x importanceWeight(block) x log2(1 + refs)`. Reuse `recency-decay.js`.
- **Invariant-pinning**: an invariant-class block is ALWAYS in the hot-set (never evicted), regardless of score /
  even with zero heat. So the hot-set = `pinned_invariant_blocks ∪ top-(n - |pinned|) by score`.
- **Back-compat**: keep the recency-only path as the default (no importance resolver) so s7/s8 stay green; the
  scored+pinned behavior is opt-in when the caller supplies importance. `cmdHeat` wires the scored path.

## OPEN DESIGN QUESTIONS (the reason for the VERIFY board — resolve before building)

1. **Importance for an H3 block** = its enclosing H2 section's `importanceOf`. Source it via (a) a NEW mapping
   helper (parse H2 sections + H3 blocks, map by line-range — additive, leaves parseBlocks untouched), or (b)
   enhance `parseBlocks` to emit a `section` field (single-source, but touches the parseBlocks contract + its
   tests)? Lean (a) for blast-radius; confirm.
2. **hotSet signature / pinning source**: pinning needs the block-list (a pinned block may have zero heat), which
   hotSet does not currently take. New shape `hotSet(file, n, {liveBlocks, importanceFor, now})` where `liveBlocks`
   supplies pin candidates + `importanceFor(anchor)->weight`? Or split into `hotSet` (unchanged, recency-only) +
   a new `scoredHotSet(...)` so the old contract is untouched? Which keeps s7/s8 honest without a shim?
3. **Formula details**: `log2(1+refs)` vs `log(1+refs)`; reuse recency-decay's 30-day tau or a memory-specific
   half-life; how does `weight=0` (historical) interact — score 0 => never hot (correct?) or a small floor? Does a
   pinned invariant with 0 heat crowd out a hot reference block when n is small (pin-starvation)?
4. **Where the scored path lives**: is this pure logic a candidate for a `_lib` leaf (mirroring recency-decay), or
   does it stay in `scripts/memory.js` (single consumer, ADR-0016 YAGNI = keep local)? Lean: keep local (one
   consumer); confirm against the ADR-0016 gate.

## TDD order

1. Rewrite/extend the hot-set tests describing the NEW scored+pinned behavior (invariant pinned even at 0 heat;
   score orders recency x importance x refs; historical sinks). Keep s7/s8 GREEN (recency-only default path).
2. RED. 3. Build per the resolved design. 4. GREEN + full memory-cli suite + kernel suite.

## Files (est.)

- EDIT `scripts/memory.js` (hotSet scoring + importance mapping + cmdHeat wiring)
- EDIT `tests/unit/scripts/memory-cli.test.js` (new scored/pinned tests)
- (maybe) NEW `packages/kernel/_lib/*.js` IF the VERIFY board says the scoring is a reuse-worthy leaf (else local)

## Pre-Approval Verification (2026-07-07 — architect + code-reviewer board)

RESOLVED design (both lenses converged); all 4 open questions answered:

- **Q1 → new `blockImportances(text,{level})`** — composes two `parseBlocks` passes (level-2 sections + level-`level`
  targets), maps each target to the enclosing H2 by line-range; `importanceOf('')` (no enclosing H2) → reference/w1.
  parseBlocks UNTOUCHED (7 consumers, hardened by s2/s3/s12/s25).
- **Q2 → separate pure `scoredHotSet(entries,n,{now})`**, NOT an overloaded `hotSet`. `hotSet` stays **byte-identical**
  (s7/s8/s17/s22 green with zero regression surface). `entries` are built from the **block-list** (so 0-heat invariant
  pins are present); `cmdHeat` does the I/O + merge under an OPT-IN `--scored` flag (default path unchanged).
- **Q3 → score = `recency(last_ref,now) × weight × log2(1+refs)`**; reuse the 30-day recency leaf; weight-0 (historical)
  → score 0, NO floor (intentional shedding). **Pinning ADDITIVE-BEYOND-n** (invariants are a separate always-resident
  tier; `n` budgets the scored tier on top) — avoids pin-starvation. Total comparator: `score desc → last_ref desc →
  refs desc → anchor asc` (deterministic even on an all-zero set).
- **Q4 → LOCAL to `memory.js`** (one consumer; ADR-0016 gate unmet — the same false-DRY this workstream corrected in
  ADR-0020). Reuse the existing `recency-decay.js` leaf only; no new `_lib`.

Build-traps the board flagged (all fold into the impl/tests):

1. **Additive slice, not `slice(0, n-|pinned|)`** — cap the NON-pinned tier at `slice(0, n)` independently; the
   negative-index footgun (`[..].slice(0,-k)`) never arises. (reviewer HIGH-1)
2. **0-heat pins** — enumerate candidates from `parseBlocks` block-list, never `Object.keys(heat)`. (reviewer HIGH-2)
3. **Thread `now`** through `cmdHeat` → `scoredHotSet`; and **scored tests MUST inject `now` near the fixture epoch**
   (`last_ref` is ISO ~1970 for `now:1000`; a real `Date.now()` → `exp(-693)`=0 → silent all-zero pass). (arch + HIGH-3)
4. **Explicit `?? 0`** on `computeRecencyDecayAt` null; guard `heat[a] || {}` for a hand-edited `null` value. (MEDIUM-1)
5. Extra tests: a **demoted invariant does NOT resurrect** as a pinned ghost (entries from fresh parse); **`cmdHeat
   --scored` ordering** with a pinned `now`; **`importanceOf('')`** lock (SCARS fixture has no H2). (MEDIUM-3, LOW)

Verdict: directionally sound, back-compat strategy protects s7/s8/s17/s22; proceed to TDD build with the traps folded.

## VALIDATE result (2026-07-07 — code-reviewer + honesty-auditor on the built diff)

- **code-reviewer:** Approve. 0 CRITICAL/HIGH/PRINCIPLE. `hotSet` verified byte-identical; additive-beyond-n +
  0-heat pins + fresh-parse (no resurrect) all confirmed. 2 MEDIUM (both FOLDED): `scoreOfEntry` didn't coerce
  `refs` — a hand-edited sidecar `"refs":"10"` string-concats to `log2(110)`, and `refs:-1` → `log2(0)` → NaN
  (breaking the total-order comparator). Fixed: coerce `refs` to a non-negative finite number.
- **honesty-auditor:** B → REVISE (all findings FOLDED → now GREENLIGHT-equivalent). Plan claims verified TRUE
  (byte-identical hotSet, local-not-leaf, additive pinning, 0-heat pins). **HIGH (the important catch):** the
  recency factor was a NO-OP in every test — I complied with the underflow warning by injecting `now` near the
  fixture epoch, but that saturated recency to ~1 for every entry, so deleting/inverting recency shipped green.
  The "weight-aware" score was proven for weight+refs but UNVERIFIED for recency (the factor the ADR-0016 reuse
  rests on). Plus 2 MEDIUM: s28 name overclaimed a recency tension; no test isolated weight-0 shedding by the
  zero (vs the budget).
- **Fold:** `scoreOfEntry` refs-coercion (code); renamed s28 to its real scope (catches a recency-only
  regression); **NEW s31** — recency LOAD-BEARING (a recent-weak block beats an old-strong one over a 2d-vs-50d
  gap; **mutation-proven**: without recency the winner flips old-strong, so s31 genuinely requires it); **NEW
  s32** — weight-0 shed by the multiplicative zero, not the budget (a sum formula would admit it); **NEW s33** —
  refs coercion (quoted-numeric + negative). Result: 33/33 green, kernel 119/119, eslint clean.

Root-built diff → no verdict-attestation record (Rule 4). The recency-saturation HIGH is a keeper lesson: a
green suite is a HYPOTHESIS — complying with the *letter* of an underflow warning re-opened the mirror-image
blind spot; only a test where the discriminating variable actually VARIES proves the factor is scored.
