---
lifecycle: persistent
plan: item-3-live Half B — the emit-side attest-from-capture producer
status: VALIDATE-complete — folds applied; awaiting USER merge
date: 2026-06-28
---

# item-3-live Half B — the EMIT-side attest-from-capture producer (SHADOW)

The write half of the captured-lesson merge wire. #455 (PR-2) built the MINT (read) half:
the world-anchor mint selects a captured `live_pending` lesson IFF an attestation carries
that lesson's `lesson_signature`. Today the ONLY attestation producer (`cli.js backfill2137`)
hardcodes `LESSON_2137`'s signature, so the captured-floor branch never fires. Half B adds a
producer that **sources `att.lesson_signature` from a captured lesson** at emit, completing
the wire MECHANISM (the test path); **production stays inert** (leg 1 + weight-inertness remain — see §3).

Stays SHADOW / weight-INERT. Completing the legit producer does NOT make production live: the
floor is still empty (leg 1 — `lessonLegFn=null`, the real deriver leg is a separate deferred
rung), and `LIVE_SOURCES = Object.freeze([])`. The honest one-liner: Half B builds the
emit-side wire mechanism; it does NOT make a captured lesson world-anchor in production
(leg 1 + weight-inertness remain). The authenticated cross-uid edge minter (PR-A2) is the
hard #273 close.

## 0. Runtime probes (ground-truthed 2026-06-28)

| Claim | Probe → observed |
|---|---|
| The only attestation producer hardcodes the static sig | `cli.js:140-145` `backfill2137` → `lesson = buildWorldAnchorLesson(LESSON_2137); attestation.lesson_signature = lesson.lesson_signature` |
| `emit-pr.js` writes the join-key ONLY (no attestation at emit) | `join-key-store.js:29-30` "emit-pr.js remains the WRITER ONLY" |
| The lab CANNOT read the kernel join-key (dam) | `join-key-shadow.test.js` REQUIRE_ALLOWLIST = `{emit-pr.js, merge-observer.js}` → a lab `require('join-key-store')` FAILS the dam |
| The join-key carries the emit context (but is dam-forbidden) | `join-key-store.js:88` CORE_KEYS = `[repo(slug), issueRef, pr_number, pr_url, approval_hash, base_sha, emitted_at]` (+`built_by`) — NO `diff_hash`, NO `branch` |
| The attestation needs lesson_signature + diff_hash + branch beyond the join-key fields | `world-anchor-store.js:71-74` ATT_FIELDS adds `branch, diff_hash, lesson_signature` |
| The mint joins captured.repo via `repoSlug` (slug-vs-URL) | `world-anchor-mint.js` `repoSlug()` (#455) — attestation repo is a slug, captured lane is a URL |
| `parsePrUrl` already yields {repo(slug), pr_number, pr_url} | `cli.js:51` + `parse-pr-url.js` |
| The captured lane carries the lookup keys | `live-pending-store.js:67` BASIS = `[provenance, repo(URL), issue_ref, candidate_patch_sha, lesson_signature]`; `listLivePendingLessons` is TOTAL |

**Must probe at BUILD:** the EXACT field-by-field sourcing of the existing `backfill2137`
attestation (so `attest-from-capture` produces a byte-compatible attestation the mint +
merge-outcome join both accept), and that `recordAttestation`'s `validateAttestation` accepts
the slug-form repo the producer writes.

## 1. The design — a lab-side, args-driven `attest-from-capture` CLI

The dam forbids the lab from reading the kernel join-key, and `emit-pr.js` writes no
attestation. So the producer mirrors `backfill2137`: a CLI command taking the emit context as
ARGS + sourcing the `lesson_signature` from the captured lane.

**New `cli.js` subcommand `attest-from-capture`:**
- Args: `--pr-url` (→ `parsePrUrl` → repo slug + pr_number + pr_url), `--issue-ref`,
  `--diff <path>` (→ re-derive `diff_hash` from the bytes, like backfill), `--approval-hash`,
  `--base-sha`, `--branch`, `--built-by`, `--emitted-at`, and optionally `--candidate-patch-sha`
  (the disambiguator).
- **Lesson lookup:** `listLivePendingLessons()` filtered to
  `repoSlug(rec.repo) === <slug from pr-url> && rec.issue_ref === <issue-ref>`
  (+ `rec.candidate_patch_sha === <candidate-patch-sha>` when supplied). Require **EXACTLY ONE**:
  0 → refuse `no-captured-lesson` (emit); >1 → refuse `ambiguous-captured-lesson` (emit, pass
  `--candidate-patch-sha` to disambiguate); 1 → use its `lesson_signature`.
- **Build the attestation:** `{ repo: <slug>, issueRef, pr_url, pr_number, branch, base_sha,
  diff_hash, lesson_signature: <from capture>, built_by, approval_hash, emitted_at }` →
  `recordAttestation`. The repo is stored as a **slug** (matching the merge-outcome + the mint's
  `resolveAnchorForPr`), so the wire joins.
- TOTAL/observable: every refuse returns `{ok:false, reason}` + an emit; never throws.

**`repoSlug` sharing (D3):** the producer's captured-lesson lookup and the mint's floor join
MUST use the SAME slug normalization or they can diverge (a producer that stored a form the mint
won't match = a silently broken wire). Extract `repoSlug` from `world-anchor-mint.js` into a tiny
shared `world-anchor/repo-slug.js` imported by both. (One definition; cannot drift. This is a
join-correctness predicate shared on both sides — the one place sharing beats deliberate-duplication.)

## 2. Open questions for the VERIFY board

- **D1 (vehicle):** CLI-args producer (mirrors `backfill2137`) vs any auto emit-time wire. The dam
  and the no-attestation-at-emit fact force the CLI-args path — confirm there is no cleaner allowlisted
  vehicle (e.g., should the merge-observer or emit-pr write it? — no: emit-pr is kernel-tier + writes
  the join-key only; the observer runs at merge, too late).
- **D2 (candidate selection):** exactly-one-or-refuse on `(repoSlug, issue_ref [, candidate_patch_sha])`.
  Is `--candidate-patch-sha` the right disambiguator? Should it be REQUIRED (not optional) so a
  multi-solve issue never silently picks the wrong lesson?
- **D3 (repoSlug sharing):** extract to a shared module vs duplicate. (Recommend extract — see §1.)
- **D4 (backfill relationship):** keep `backfill2137` as-is (the spec-kitty grandfather) + add
  `attest-from-capture` as a separate command, or refactor a shared attestation-builder? (Recommend
  separate command; a shared private `buildAttestationBody` helper if it cleanly DRYs the field
  assembly without coupling.)
- **D5 (#273 widening):** does Half B widen the ATTACK surface beyond #455? (Hypothesis: NO — #455
  already let the mint READ the open-writable lane, so a same-uid attacker already co-forges both a
  captured lesson AND an attestation directly; Half B adds the LEGIT producer path, not a new attack
  lever. Confirm with the hacker.)

## 3. #273 framing (still weight-inert; the attack surface was opened by #455)

- Half B adds a legitimate emit-side producer. The co-forge attack surface (a same-uid writer driving
  the mint via a forged captured lesson + forged attestation) was ALREADY opened by #455 (the mint
  reads the open-writable lane). Half B does not add a new attack lever — it adds the legit path.
- Still **weight-inert** (`LIVE_SOURCES=Object.freeze([])` + zero trusting readers) AND **leg-1-inert**
  (the floor is empty until the real deriver leg). Half B removes the static-signature leg (leg 2) of
  inertness; leg 1 + weight-inertness remain.
- A world-anchored merge proves DIFF-ACCEPTANCE, not LESSON-CORRECTNESS. The authenticated cross-uid
  edge minter (PR-A2) is the hard close before any `LIVE_SOURCES` flip.

## 4. Files

> **NOTE: this table is the ORIGINAL §1 sketch. §B (Pre-Approval Verification) SUPERSEDED it** — the
> lookup helper went into `world-anchor-mint.js` (no `repo-slug.js`), `cli.js` never reads the lane, and
> **the dam test was NOT touched** (it stays at one reader). The rows below are annotated to match what
> actually shipped, so a cold reader is not misled.

| File | Change (as shipped) |
|---|---|
| `packages/lab/world-anchor/world-anchor-mint.js` | NEW exported `resolveCapturedSignatureForAttest` (the two-check selection; reuses the in-module `repoSlug` + `listLivePendingLessons`) |
| `packages/lab/world-anchor/cli.js` | NEW `attest-from-capture` subcommand + `runAttestFromCapture` + `validateAttestArgs`; calls the mint helper (NOT a direct lane read); emit-arg validation; usage string |
| ~~`packages/lab/world-anchor/repo-slug.js`~~ | **NOT SHIPPED (§B)** — `repoSlug` stays in `world-anchor-mint.js`; no separate module |
| `tests/unit/lab/world-anchor/attest-from-capture.test.js` | NEW: the two-check selection; emit-arg refuses; the DEL/C1 band; the REAL-stores join-probe (origin captured, not LESSON_2137); deny-not-substitute |
| `tests/unit/lab/world-anchor/cli.test.js` | extend: the new subcommand dispatch + the non-widening (cli.js is not a lane importer/reader) assertion |
| ~~(dam) `live-pending-store-shadow.test.js`~~ | **NOT TOUCHED (§B)** — the dam stays at one reader (`world-anchor-mint.js`); it passing UNCHANGED IS the non-widening assertion |

## 5. HETS Spawn Plan (3-lens VERIFY — REQUIRED, #273-widening trust surface)

route-decide → `root` (substrate-meta under-scored on the short prompt); escalated by judgment to
`route`. Spawn architect + hacker + honesty-auditor in parallel (read-only) on D1-D5 + the §3 framing.
Fold into `## Pre-Approval Verification`, then USER go for BUILD.

## Drift Notes
- The PR-2 SCAR applied: plan written DIRECTLY in the worktree (not the main checkout) to avoid the
  untracked-in-main pull-abort.
- The dam-widening was AVOIDED by the VERIFY board's better factoring (the lookup helper lives in
  `world-anchor-mint.js`, the existing admitted reader, so `cli.js` never reads the lane directly — the
  dam stays at ONE reader, unchanged). See Pre-Approval Verification §B below.

## Pre-Approval Verification (3-lens VERIFY board, 2026-06-28)

A Workflow-orchestrated 3-lens board (architect / hacker / honesty-auditor, schema'd) reviewed this plan.
All three: **PROCEED-WITH-FOLDS** (honesty grade A-). The board materially improved the design — two
HIGH catches (the cross-layer ambiguity + the dam-widening) are folded into the corrected design below,
which **supersedes §1/§4 where they differ**.

### A. The cross-layer ambiguity (architect HIGH + hacker HIGH) — the design crux

The producer selects a captured node, but the **#455 mint re-joins the lane on `(repoSlug, issueRef,
lesson_signature)` ONLY** (`candidate_patch_sha` is NOT in `collectCapturedCandidates`'s join). The
captured-node basis is `[provenance, repo, issue_ref, candidate_patch_sha, lesson_signature]`, so two
nodes can share `(repo, issue_ref, lesson_signature)` differing only by `candidate_patch_sha` (→ the mint
sees >1 → `ambiguous-floor-lesson`), AND two nodes can share `(repo, issue_ref, candidate_patch_sha)`
differing only by `lesson_signature` (two axes from one patch). So a producer that picks "exactly one by
cps" does NOT guarantee the mint mints exactly one.

**FOLD (the corrected selection):** the producer must guarantee **producer-success ⟺ the mint will mint
exactly-one**. Two fail-closed checks, both mirroring the mint's exact-set discipline (compute-set,
require-empty-missing — never `.find()`/`[0]`/first-wins):
1. **`--candidate-patch-sha` is REQUIRED** (hacker's stronger call — once leg 1 lands, multi-solve is the
   common case; an optional disambiguator that silently works only for single-solve is a footgun). Filter
   the lane to `(repoSlug, issue_ref, candidate_patch_sha)`; require **EXACTLY ONE** (0 → `no-captured-lesson`;
   >1 → `ambiguous-captured-patch` [two axes, one patch]). This yields one `lesson_signature`.
2. **Then verify `(repoSlug, issue_ref, that lesson_signature)` is EXACTLY ONE in the lane** (the mint's
   precondition) — else refuse `ambiguous-captured-lesson` (the mint would refuse anyway; attesting it is
   meaningless). Only then attest.

### B. The dam — AVOID widening it (honesty HIGH + hacker MEDIUM); put the lookup in the mint module

The original plan made `cli.js` a new direct reader of `listLivePendingLessons` → the shadow dam flags it on
BOTH the IMPORTER scan AND the reader-CALLER scan (cli.js is in `world-anchor/`, walked by the test), and a
green-suite claim that edited only one allowlist would be dishonest. **Better factoring (adopted):**
- Add an **exported `resolveCapturedSignatureForAttest({repoSlug, issueRef, candidatePatchSha}, opts)`** to
  `world-anchor-mint.js` (the existing admitted lane reader) — it does the two-check selection in §A and
  returns `{ok, lesson_signature}` or `{ok:false, reason}`. It REUSES the in-module `repoSlug` + the same
  `listLivePendingLessons` the mint's Branch B uses (so the producer's lookup and the mint's join CANNOT
  diverge — they are the same module; this also resolves D3 with **no separate `repo-slug.js`**).
- `cli.js` already imports `world-anchor-mint.js` (`mintFromMergeOutcome`), so it just calls the new helper —
  `cli.js` never imports/reads `live-pending-store`. **The dam is UNCHANGED** (one reader: `world-anchor-mint.js`).
- Information-hiding note: `world-anchor-mint.js` gains a SECOND export, but it is a READ-ONLY lookup (returns
  a coarse-bucket signature string) — it exposes no trust-bypass (the mint's binding stays gated by its own
  exact-set). VALIDATE to confirm.

### C. Emit-arg validation (architect MEDIUM + hacker MEDIUM)

Every emit arg is **RECORDED-not-TRUSTED** (the kernel `record.approval_hash` is the sole binding source; the
mint's att-vs-record cross-check stays ADVISORY — do NOT add a fatal gate, it would be a same-uid denial
lever). Folds: (1) **validate `--base-sha` is HEX40/HEX64 at the producer boundary** with a clean refuse (not
the downstream `bad-attestation`); (2) **re-derive `diff_hash` from `--diff` bytes** (never a `--diff-hash`
arg), like `backfill2137`; (3) **`--pr-url` must be byte-identical** to the kernel-sealed `pr_url` for
`resolveAnchorForPr` to join — document it in the usage string, surface the stored `att.pr_url` in the success
output for eyeball-matching, and test that a trailing-slash/case-variant yields an observable no-match-class
refuse; (4) bound `--built-by`/`--branch` to no control chars (mirror `isBoundedPlainString`). Every refuse
observable; never throws.

### D. #273 framing (architect LOW + honesty MEDIUM) — production-REACHABLE for the first time

§3 tightened: Half B makes the captured-floor branch **PRODUCTION-REACHABLE for the first time** (it removes
the static-signature leg of inertness). It remains **weight-inert** (`LIVE_SOURCES=Object.freeze([])` + zero
trusting readers) and **leg-1-inert** (the empty real-deriver floor). **No NEW attack lever vs #455** (the
mint already reads the open-writable lane; a same-uid attacker already co-forges node + attestation via the
exported derive fns — Half B adds the legit path, not a new primitive). The TOCTOU plant-to-deny race is a
NAMED forward-contract (deny-not-substitute; the mint's independent exactly-one re-resolution is the real
gate; PR-A2 closes the DoS lever).

### E. Build exit gates (folded, hard)

1. **The join-probe is a VALIDATE gate, not an assertion** (honesty MEDIUM / Rule-2a-corollary): an
   INTEGRATION test against REAL (dir-injected, not mocked) stores — mint a captured `live_pending` node →
   run `attest-from-capture` → drive `mintFromMergeOutcome` → assert Branch B resolves EXACTLY the captured
   lesson (`origin:'captured'`, the captured body, not `LESSON_2137`). Until it runs green, "the producer
   joins the mint" is UNVERIFIED.
2. Tests: §A two-check selection (0 / one / >1-by-patch / >1-by-signature → the right refuse, observable);
   `--base-sha` malformed → observable refuse; `--pr-url` trailing-slash/case → no-match-class; the
   repoSlug URL/slug/`.git` triad resolves identically on both sides; the deny-not-substitute e2e (plant a
   competing node → mint refuses ambiguous, never the wrong body); the dam suite stays GREEN unchanged
   (proving cli.js did NOT become a lane reader — the non-widening is the assertion).
3. The full per-wave gate: kernel green, lab + new suites green, eslint/yaml/markdownlint/release-surface/
   signpost clean, `install.sh --hooks --test`.

### Honest title (honesty board)

`feat(lab/world-anchor): attest-from-capture producer for the captured-lesson floor (SHADOW, production-inert)`

## VALIDATE result (3-lens board on the BUILT diff, 2026-06-28)

Workflow-orchestrated 3-lens board on the built worktree diff. **code-reviewer SHIP-WITH-FOLDS** (0 CRIT;
1 HIGH = the 50-line ceiling); **hacker SHIP-WITH-FOLDS** (27 live probes, 1 confirmed bypass [the C0-only
control band] + 1 named weight-inert #273 residual; weight-inertness empirically held — minted node has no
`source` token, edge unsigned, `LIVE_SOURCES` empty, zero trusting readers; deny-not-substitute held);
**honesty grade A-** (every load-bearing claim verified against the built code; the dam confirmed
byte-identical + passing UNCHANGED).

Folds applied to the built diff:
- **code-reviewer HIGH** — extracted `validateAttestArgs` so `runAttestFromCapture` is under the 50-line ceiling.
- **hacker MEDIUM** — `isBoundedPlainString` now rejects DEL (0x7f) + the C1 band (0x80-0x9f), not just C0
  (`<0x20`); a NON-VACUOUS test (`fromCharCode` fixtures, RED on the old band) proves it. NAMED kernel-layer
  forward-contract: the same `<0x20` band in `join-key-store.js` + `emit-pr.js` (a LIVE network sink) should
  be tightened in a kernel PR.
- **LOW×3** — reworded the "⟺ mint mints exactly-one" claim to "the mint's CARDINALITY precondition is met
  (the taxonomy gate is the mint's separate authority)" in the helper JSDoc + the cli comment; added a
  DEDUP-not-AUTHZ #273 cross-reference to the helper JSDoc; added `shadow:true`/`production_inert:true`
  markers to the producer's success output; annotated the stale §4 table (above).

Gates after folds: attest-from-capture **21** + cli 20 + mint 19 + captured-floor 13 + **dam 10 UNCHANGED**;
eslint clean; the test file confirmed pure-ASCII (no raw control byte in source). The full per-wave gate
(kernel + install.sh --hooks --test + signpost + release-surface) re-run before the PR.

Status: **VERIFY + BUILD + VALIDATE complete → folds applied → awaiting USER merge.**
