# MV-W2 — wire the HARDEN verdict → trust-weight → the advisory boundary

**Phase:** v-next trust-hardening · **Wave:** MV-W2 (follows MV-W1 #336)
**Date:** 2026-06-16
**Status:** PLAN (pre-VERIFY)

## What this wave is (and is NOT)

MV-W1 shipped `evaluateHardenGate(armCounts, edges, opts) -> { verdict, reasons }` — PURE, **stops at the
verdict** ([lesson-merge-lift.js:106](../../lab/causal-edge/lesson-merge-lift.js)). MV-W2 is the next link:
turn a `HARDEN` verdict into a **source-gated trust-weight** and **wire it to the lesson retriever's
`opts.weights` slot** — a Lab `_spike` surface, OUT of the live K4 recall path
([retrieve-signature.js:7](../../lab/attribution/_spike/retrieve-signature.js)) — proving the *mechanism*
end-to-end with a MOCK signal. (NOT a production recall change; see the Drift notes.)

**MECHANICS, not TRUST (OQ-NS-6 — the binding frame).** A mock NARROWS; it never hardens. So even a
`HARDEN` verdict *derived from a mock signal* must be **inert on any real decision**. MV-W2 proves the wire
carries a qualifying verdict to the advisory and that a real (live-sourced) weight would flow *identically* —
while the mock-sourced weight is **structurally barred** from moving a real ranking. No real trust hardens
until the live external-PR beta (months out; the actual unlock).

## The honest ceiling (verbatim from the carry)

> a mock-derived weight must never carry the `source==='verdict-attestation'` mis-wire marker.

That marker lives in exactly one place — `reputation-gate.js` — and is the firewall this wave must respect.

## Runtime Probes (claims verified against the repo, not prose)

| Claim | Probe → observed |
|---|---|
| `reputation-gate` is **narrowing-only** (no boost path) | `recommendNarrowing` returns only `proceed`/`down-weight`/`reroute` ([reputation-gate.js:43-144](../../lab/reputation/reputation-gate.js)) |
| its lane check is a **mis-wire guard, not crypto auth** | `if (!reputation \|\| reputation.source !== SOURCE \|\| ...) return proceedAll(cands,'unauthenticated-lane')` ([reputation-gate.js:67](../../lab/reputation/reputation-gate.js)); `SOURCE='verdict-attestation'` ([project.js:31](../../lab/reputation/project.js)) |
| `reputation-gate` is **persona**-scoped | keyed by `reputation.personas[].persona` ([reputation-gate.js:76](../../lab/reputation/reputation-gate.js)) — NOT lesson/cell |
| the **lesson retriever already takes a trust-weight** | `retrieveBySignature(query, nodes, opts)` reads `opts.weights` keyed by `lesson_signature -> recurrence_count_confirmed`, used as a rank tie-breaker ([retrieve-signature.js:54-67](../../lab/attribution/_spike/retrieve-signature.js)) |
| the retriever is a **`_spike`**, OUT of the live K4 recall path | header: "Lab spike, OUT of the live K4 recall-CLI path (MAJOR-protected, untouched)" ([retrieve-signature.js:7](../../lab/attribution/_spike/retrieve-signature.js)) |
| the **source-firewall precedent** exists and is content-bound | `hardening-signal-store.js`: `SOURCE_MOCK='mock'` folded into the content-address; mock-only on read+write ([hardening-signal-store.js:40,49-61,90](../../lab/persona-consumer/hardening-signal-store.js)) |
| the **trust-weight lane** for a live surface is `authenticatedEdgeIds` | C-W1 signed lane, fail-closed; "do NOT wire into consolidation/ranking until W2 re-mints" ([lesson-confirm.js:103-125](../../lab/causal-edge/lesson-confirm.js)) |
| no consumer imports LML yet | `grep lesson-merge-lift` → only its own test (no live consumer) |

## The scope fork (genuine — surfaced for the VERIFY board)

The carry names "reputation-gate," but a `HARDEN` verdict is **(lesson_signature × cell)**-scoped while
`reputation-gate` is **persona**-scoped, and the gate has **no boost path** (narrowing-only by design). Two
readings:

- **(F-a) Consume into `reputation-gate`** — add a "harden" axis. *Cost:* breaks the explicit narrowing-only
  contract (proceed/down-weight/reroute, NEVER boost) AND forces a lesson→persona subject bridge that does
  not exist. *Against KISS + the gate's stated semantics.*
- **(F-b, RECOMMENDED) Consume into the subject-matched lesson surface** — the verdict→weight feeds
  `retrieveBySignature`'s existing `opts.weights` slot (lesson-scoped, the natural subject), and the
  `reputation-gate` `source==='verdict-attestation'` marker is the **cross-consumer firewall guardrail** the
  matrix proves a mock weight cannot wear. This honors the carry's *honest ceiling* (the mis-wire marker)
  without overturning reputation-gate's narrowing-only contract or inventing a lesson→persona bridge.

**Recommended resolution: F-b.** The carry's "reputation-gate" = the *guardrail being respected*, not a new
persona axis. The board should pressure-test this; if it prefers F-a, that is a USER-surface scope change.

## The design (under F-b)

Three small, single-responsibility units — all PURE / Lab-layer, no live K4 path touched:

### 1. `lessonTrustWeight(verdict, source)` — the verdict→weight map (PURE)
`packages/lab/causal-edge/lesson-merge-lift.js` (extend the existing module — same subject).
- `HARDEN` → a positive weight; `WITHHOLD | INSUFFICIENT-N | EXCLUDED` → `0`.
- Returns `{ weight, source }` carrying the `source` tag through **verbatim** — it never *mints* a source.
- **The firewall invariant (the honest ceiling):** the function NEVER stamps `'verdict-attestation'`. The
  source is whatever the *signal* carried (`'mock'` in MV-W1). A caller cannot launder a mock verdict into a
  real-lane weight via this function.

### 2. A source-gated weight admission for the advisory (PURE)
A thin `admitWeightForRanking(weightRecord, { allowSources })` (or fold into the retriever wire): a weight is
eligible to move a **real** ranking ONLY if `source` ∈ the live-allow-set (`'verdict-attestation'` /
the future live source). A `source==='mock'` weight → admitted to a SHADOW/record lane only → **weight 0 in
the real ranking** (OQ-NS-6 inert-mock). Fail-closed on a missing/unknown source.

### 3. The wire into `retrieveBySignature` (read-side adapter; the retriever itself UNCHANGED where possible)
The retriever already accepts `opts.weights`. The wire builds that map from LML verdicts **through the
source gate** — so a mock run produces a `weights` map that is provably all-zero in the real ranking, while a
(future) live run would populate real tie-breaker weights. The retriever stays a `_spike`; no live K4 change.

### 4. The verification matrix (THE PROOF — mirrors MV-W1's matrix discipline)
`tests/unit/lab/causal-edge/lesson-trust-weight.test.js`:
- HARDEN → positive weight; every non-HARDEN verdict → 0.
- `source` carried verbatim; **never** auto-stamped `'verdict-attestation'`.
- a `source==='mock'` weight is **0 in the real ranking** (inert) — fed to `retrieveBySignature`, it does NOT
  change the top result vs no-weights (the OQ-NS-6 inert-mock proof).
- a `source==='verdict-attestation'` weight *would* break a tie (the mechanism-responds proof — using a
  synthetic live-sourced weight, NOT a real signal; this is mechanics).
- the `reputation-gate` firewall: a mock weight object handed to `recommendNarrowing` returns
  `unauthenticated-lane`/proceed (it cannot narrow OR boost) — the mis-wire marker holds.
- fail-closed: missing/unknown/empty `source` → inert.

## Build order (TDD: red → green)
1. Write `lesson-trust-weight.test.js` (the matrix) — RED.
2. Implement `lessonTrustWeight` + the source gate — GREEN.
3. Wire the source-gated `weights` map into a `retrieveBySignature` driver path; prove inert-mock vs
   live-breaks-tie.
4. Full gate (`install.sh --hooks --test` + kernel + lab suites).

## Files
- `packages/lab/causal-edge/lesson-merge-lift.js` — ADD `lessonTrustWeight` + the source gate (export both).
- `tests/unit/lab/causal-edge/lesson-trust-weight.test.js` — NEW matrix.
- (read-side wire — minimal; prefer a driver/adapter over editing the MAJOR-protected retriever spike.)
- this plan accretes `## VERIFY result` / `## VALIDATE result`.

## HETS Spawn Plan

Routing: substrate trust-boundary work (data-mutation-adjacent: it governs what can move a trust signal) →
escalate past route-decide's documented `root` stakes-lexicon miss by judgment.

- **VERIFY (pre-build, 3-lens parallel):** `architect` (resolve the F-a/F-b scope fork + design soundness) +
  `hacker` (laundering: can a mock weight reach a real ranking or wear `verdict-attestation`? source-gate
  bypass? null-proto/`__proto__` weight-key poisoning of the retriever map?) + `honesty-auditor` (is the
  OQ-NS-6 mechanics-not-trust framing honest, or does the wire overclaim hardening?). Fold before building.
- **VALIDATE (post-build, 3-lens parallel):** `code-reviewer` + `hacker` (Rule 2a LIVE re-probe of the BUILT
  wire — feed it real store-loaded weights, attempt the mock→real leak against the actual code) +
  `honesty-auditor` (claim-vs-diff). Read-only personas only.

## Drift / honesty notes
- The retriever is a `_spike`; wiring "into the advisory" means the spike's `opts.weights`, NOT a production
  recall change. State this plainly — do not let "wired into the advisory" read as a live-path activation.
- This wave produces a weight that is **inert in production** by construction (empty live-allow-set). Its
  value is the *proof the mechanism responds* — a real signal needs zero new machinery. Anything stronger
  overclaims.

---

## VERIFY result (2026-06-16, 3-lens board `wf_a4436c1c-d85` — architect + hacker + honesty)

**Verdict: PROCEED-WITH-FOLDS. Fork F-b confirmed unanimously** (the verdict is lesson×cell-scoped;
reputation-gate is persona-scoped + narrowing-only, so F-a would overturn its no-boost contract and invent a
lesson→persona bridge). The board found **2 CRITICAL** design flaws (both folded below into a stronger design)
+ 4 HIGH + 6 MEDIUM. The folded design supersedes the design sketch above wherever they differ.

### The two CRITICALs and their joint resolution
- **CRIT-1 (hacker) — `source` as a free caller arg defeats the firewall.** `evaluateHardenGate` returns only
  `{verdict, reasons}` (no source), so `lessonTrustWeight(verdict, source)` would accept any caller string —
  "never auto-mints" is vacuous; a caller hands it `'verdict-attestation'` by typo/copy-paste/malice. The
  #273 third face (self-asserted field vs authenticated minter).
- **CRIT-2 (hacker + honesty HIGH-1) — inert-ness is NOT structural in the retriever.** `retrieveBySignature`
  has no `source` concept; a byte-identical weights map ranks identically regardless of provenance. So
  "structurally barred" rested on a single procedural gate call that any future caller could skip.
- **Joint fold:** (a) `lessonTrustWeight(verdict)` takes **no source arg** and returns a **plain number** — it
  cannot stamp any provenance. (b) The **production live-allow-set is EMPTY** in MV-W2 — *no* source value
  (`mock`, `verdict-attestation`, anything) can move a real ranking; the mechanism is proven ONLY via a
  test-injected allow-set. This makes inert-ness structural (there is no production source that admits) AND
  satisfies the honest ceiling trivially (the forbidden marker is not admitted either).

### The folded design (the build contract — 3 PURE units, retriever UNTOUCHED)
1. **`lessonTrustWeight(verdict) -> number`** in `lesson-merge-lift.js` (same subject — the verdict's
   downstream). Total function, **`>= 0` always**: `HARDEN -> 1`; `WITHHOLD | INSUFFICIENT-N | EXCLUDED |
   unknown/garbage -> 0` (fail-closed; never negative — a negative weight is finite, survives
   `nullProtoWeights`, and would *suppress* a sibling node, a different failure mode). No `source`.
2. **NEW module `packages/lab/causal-edge/weight-source-gate.js`** (SRP: owns the OQ-NS-6 source-admission
   policy, whose reason-to-change — the allow-set grows in MV-W3 — is independent of the verdict lattice;
   mirrors how `hardening-signal-store` keeps the firewall in its own module):
   - `LIVE_SOURCES = Object.freeze(new Set())` — **EMPTY in MV-W2** (no live lesson source exists yet; the
     live source is the C-W1 signed lane, bound in MV-W3 — see forward contract). A prominent comment states
     this and that `'verdict-attestation'` is the *persona* track's marker, NOT a lesson-lane live source.
   - `admitWeightForRanking({ source, weight }, { liveSources = LIVE_SOURCES }) -> number` — admits `weight`
     iff `liveSources.has(source)` via **exact `Set.has`, NO trim/toLowerCase** (an allow-list firewall must
     reject any non-canonical byte sequence; normalization is identity-dedup, NOT authorization — do NOT copy
     the maintainer-login normalization at `lesson-merge-lift.js:95`). Fail-closed on missing/unknown/array/
     object source. `liveSources` injectable is the MV-W1 `opts.minN` discipline (test-only; the real driver
     pins the empty default).
   - `buildRankingWeights(items, opts) -> { [lesson_signature]: number }` — the **SOLE constructor** of the
     number-keyed map the retriever consumes. `items: [{ lesson_signature, verdict, source }]` (source comes
     from the SIGNAL's provenance lane, attached by the driver — never inferred). Runs each through
     `lessonTrustWeight(verdict)` then `admitWeightForRanking({source, weight}, opts)`; emits a **null-proto
     map of plain numbers** — the `source` tag is consumed and **discarded here**, never reaching the
     retriever (the retriever stays source-blind by construction).
3. **The retriever is NOT edited** (hard invariant — it is a MAJOR-protected `_spike` and `opts.weights`
   already exists). The wire is `buildRankingWeights` -> pass the map as `retrieveBySignature(..., {weights})`.

### The verification matrix (THE PROOF — folds every finding)
`tests/unit/lab/causal-edge/` (split per module):
- `lesson-trust-weight.test.js`: a row per verdict (`HARDEN->1`; `WITHHOLD/INSUFFICIENT-N/EXCLUDED/unknown
  ->0`); assert `>= 0` always.
- `weight-source-gate.test.js`:
  - **allow-set rows:** `'mock'->0`, `undefined/null/''->0`, `['verdict-attestation']->0`, `{toString:()=>...}
    ->0`, `' verdict-attestation '->0`, `'Verdict-Attestation'->0` (the no-normalization regression guards);
    with an injected `liveSources:Set(['signed-lane-token'])`, `'signed-lane-token'->weight`.
  - **structural-inert (CRIT-2):** feed a **mock-sourced** HARDEN through `buildRankingWeights` -> the map
    entry is `0` -> pass that map to the **ACTUAL `retrieveBySignature`** over an **equal-score two-node**
    setup (identical trigger/repo match; node_ids ordered so the "wrong" node wins without a weight) -> top
    result **unchanged vs no-weights** (the gate produces the zero, not the absence of input).
  - **mechanism-responds:** same equal-score setup, an **injected-allow-set** live-sourced HARDEN ->
    non-zero -> **flips `.top`**. Labeled: "proves the retriever+gate consume a live-tagged weight; does NOT
    prove a mock can acquire that tag."
  - **honest-ceiling (honesty HIGH-2):** assert there is **no input** to `lessonTrustWeight`/`buildRankingWeights`
    (incl. an item literally carrying `source:'verdict-attestation'`) that admits a non-zero weight under the
    **empty production default** -> inert. ('verdict-attestation' is not in the lesson live-allow-set.)
  - **reputation-gate cross-contamination (honesty MED, reframed):** a lesson-weight object handed to
    `recommendNarrowing` is **shape-rejected** (no `personas` array) -> `unauthenticated-lane`/proceed. This
    confirms the two consumers do not cross-contaminate — it is NOT a provenance proof (the marker is a
    documented mis-wire guard, `reputation-gate.js:20-24`).

### Resolved: provenance ambiguity + MV-W3 forward contract (architect MED)
- The legitimate **live lesson source is the C-W1 `authenticatedEdgeIds` signed lane** (an authenticated
  minter — the #273-correct provenance), NOT reputation-gate's `'verdict-attestation'` persona marker. MV-W2
  does not thread it (the allow-set stays empty).
- **Forward contract (frozen seam):** MV-W3 swaps in the live signal by (a) deriving each item's `source` from
  signed-lane membership (`authenticatedEdgeIds`) and (b) adding that one signed-lane token to `LIVE_SOURCES`.
  `lessonTrustWeight`, `admitWeightForRanking`, `buildRankingWeights`, and the retriever are **frozen** — "a
  real signal needs zero new machinery" holds because the only deltas are a source-derivation and one
  allow-set entry.

### Non-issues confirmed (no action)
- `__proto__`/`constructor` weight-key poisoning: `lesson_signature` is always `'lesson:'`-prefixed
  (`safeEnumKey`) AND the retriever rebuilds the map null-proto — belt+suspenders; the builder keeps null-proto.

---

## VALIDATE result (2026-06-16, 3-lens board `wf_f484fe79-68f` — code-reviewer + hacker live-reprobe + honesty)

**Verdict: SHIP-WITH-FOLDS.** One load-bearing bug (CRITICAL/HIGH, agreed by two lenses, reproduced
end-to-end) + 1 MED design fold + doc-only honesty folds. All folded; full gate green after.

### Folded (code changes)
- **CRIT (code-reviewer) / HIGH (hacker) — `Object.freeze(new Set())` is FAKE immutability.** A frozen Set's
  `.add()/.delete()/.clear()` still mutate it; since `LIVE_SOURCES` was exported AND the prod-default
  fallback, any in-process importer could `LIVE_SOURCES.add('mock')` and permanently poison the allow-set —
  the hacker reproduced a `source:'mock'` HARDEN flipping the REAL `retrieveBySignature` top after one
  `.add()`. This defeated the wave's whole "structurally inert" claim and is the #273 third face (a mutable
  shared field as the trust anchor). The matrix missed it (asserted `size===0` at load, before mutation —
  the Rule-2a-corollary gap). **Fix:** `LIVE_SOURCES = Object.freeze([])` (a frozen ARRAY truly blocks
  push/index-set in strict mode); membership via a private `isLiveSource`; + a **tamper-proof regression
  test** (`push` throws; the default stays inert after a tamper attempt). MV-W3 adds the live token by
  shipping a new frozen literal in source (a reviewed change), NEVER by mutating a runtime singleton.
- **MED (code-reviewer) — duplicate-signature asymmetry.** `buildRankingWeights` only wrote on `admitted>0`,
  so a HARDEN-then-WITHHOLD for one signature left the stale HARDEN. **Fix:** **last-wins** (`else delete
  out[sig]` — a later WITHHOLD/unadmitted evicts a prior HARDEN); + a symmetric dedup test. (Inert in MV-W2;
  removes a forward footgun for MV-W3's multi-signal driver.)

### Folded (documentation — no code change)
- **MED (honesty) — "MV-W3 needs zero new machinery"** is PLAUSIBLE-BUT-UNVERIFIED, not demonstrated: MV-W2
  proves the gate+builder respond to an injected source/allow-set; the MV-W3 source-DERIVATION (signed-lane
  membership -> `item.source`) is net-new and unexercised here. The forward contract above stands as a *plan*,
  not a proven property.
- **MED (hacker) — sole-constructor not enforced at the retriever.** The retriever is source-blind and moves
  a ranking on ANY raw numeric map; the firewall holds ONLY while `buildRankingWeights` is the sole map
  constructor. Documented as a forward invariant in the module (the MV-W3 live driver must route ALL
  weight-map construction through `buildRankingWeights` — a single chokepoint, never a hand-built literal).
- **LOW (honesty) — "structural" scope:** structural *within the `buildRankingWeights` path*; the retriever
  stays source-blind. Test name tightened (the reputation-gate row is a shape-rejection, not a provenance
  proof — the marker alone would not bounce it).
- **LOW (hacker) — no weight upper bound:** DEFERRED to MV-W3. The only in-wave producer is
  `lessonTrustWeight` (binary `0|1`), so nothing reaches an unbounded magnitude through the sole constructor;
  the cap *value* is an undecided semantic (binary flag vs `recurrence_count_confirmed`) best fixed when the
  live weight meaning lands.

### Positive attestations (verified, recorded)
- `lessonTrustWeight`'s no-source-arg + never-negative guarantees were independently re-derived against the
  ACTUAL retriever (a negative weight WOULD survive `nullProtoWeights` and suppress a sibling — the test
  guards exactly that). The HONEST CEILING test (empty default -> a `verdict-attestation`-tagged item is
  inert) is the real firewall and is correctly green.

**Gate after folds:** 125/125 install (eslint + yaml + markdownlint + drift gates) · 73 kernel files · 66 lab
files — all clean.
