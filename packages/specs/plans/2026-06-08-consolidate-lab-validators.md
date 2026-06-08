# Follow-up: consolidate the Lab-store validators to `kernel/_lib` (carry-2 + the hasControlChars dedup)

> **Status:** PLAN 2026-06-08. The named follow-up from v3.5 Wave 3b.2's VALIDATE (#265). A **behavior-preserving refactor** of duplicated SECURITY validators into shared `kernel/_lib` leaves. Lab-only; SHADOW; no kernel/runtime behavior change. Cycle: plan -> VERIFY (architect — the leaf design) -> refactor (existing suites are the regression net + a leaf test) -> VALIDATE (code-reviewer + hacker — security preservation) -> PR.

## Context — why now

Wave 3b.2's VALIDATE surfaced that the two Lab stores duplicate two security validators, and that the duplication **demonstrably drifts**:

- **carry-2** (deferred from 3b.2, architect-ruled "its own PR"): `causal-edge/enums.js:55,77` DEFINES its own `normalizeAsciiEnum`/`validateEnum` — byte-identical to the shared `kernel/_lib/enum-validate.js` leaf except the error-prefix. `manage-proposal/enums.js:22` already imports the leaf; causal-edge is the lone hold-out. The leaf's own header names this migration as "a NAMED follow-up."
- **the `hasControlChars` drift** (hacker MEDIUM-1, #265): both stores define a byte-identical `hasControlChars` — and it **drifted** this session (the `U+FEFF`/BOM gap had to be fixed in BOTH copies). A security validator that must be patched in two places is the exact "two copies of a sanitizer drift" anti-pattern the enum-validate extraction already resolved once.

Same reasoning, same fix: a SECURITY validator must have ONE source of truth.

## Decisions

- **D1 (carry-2):** migrate `causal-edge/enums.js` to `require('../../kernel/_lib/enum-validate')` + re-export, deleting its local `normalizeAsciiEnum`/`validateEnum` defs (the `manage-proposal/enums.js` shape). **MUST preserve BOTH `validateEnum` + `normalizeAsciiEnum` re-exports** (`causal-edge/store.js:49` imports `validateEnum`; `walker.js` imports the enum CONSTANTS, which stay local; `faithfulness.js` does not import `./enums`). The only behavior change is the error-prefix `causal-edge:` -> `enum-validate:` (by design — the leaf uses a neutral prefix; confirmed ZERO prefix-coupled tests in `tests/unit/lab/causal-edge/`).
- **D2 (free-string leaf):** a NEW `kernel/_lib/free-string-checks.js` leaf exporting `hasControlChars` (the byte-identical, security-critical, drift-prone control/format-char detector — C0/DEL+C1/U+2028/U+2029/U+FEFF) + `nonEmptyString` (the trivial co-located companion). Both Lab stores import it. **NOT `sanitize.js`** — that leaf TRANSFORMS (strips/replaces for JSONL emission, a narrower codepoint set); the Lab stores REJECT (fail-closed, broader set incl. the BOM). Different semantics, different philosophy (scrub vs reject) -> a distinct leaf, mirroring `enum-validate.js`.
- **D3 (behavior-preserving):** the validators are byte-identical, so the existing store suites (manage-proposal + causal-edge) are the regression net — they MUST stay green unchanged (except the carry-2 enum-error-prefix, if any test asserted it — probed: none do). Add a focused unit test for the new leaf (the control/format codepoints incl. the BOM; the nonEmptyString boundary).
- **OPEN Q (architect to rule):** does `validateFreeString` ALSO get extracted (with a `prefix`/`maxLen` param), or stay per-store? **Lean: stays per-store.** Its error-prefix is the store's identity (`manage-proposal:` vs `causal-edge:`), and the byte-cap is conceptually per-store; extracting it with a prefix param adds coupling for modest gain. Extract only the SHARED PRIMITIVES (`hasControlChars` + `nonEmptyString`); each store composes its own `validateFreeString` (prefix + byte-cap + the shared primitives). The byte-cap (`Buffer.byteLength > MAX_FIELD_LEN`) is a 1-line check, low drift risk — leave it.

## Runtime Probes (firsthand-verified 2026-06-08)

| Claim | Probe -> result |
|---|---|
| causal-edge defines its own enum validators; manage-proposal imports the leaf | `grep`: `causal-edge/enums.js:55,77` `function`; `manage-proposal/enums.js:22` `require('.../enum-validate')` |
| the two `hasControlChars` are byte-identical | `diff` of the two function bodies -> IDENTICAL |
| `sanitize.js` is a TRANSFORM, not a reject-validator | `sanitize.js` `sanitizeForJsonl` strips `\0\n\r` + C0->space, preserves non-ASCII; no BOM/U+2028 reject -> different semantics |
| no causal-edge test asserts the `causal-edge:` enum-error prefix | `grep -rn "causal-edge:" tests/unit/lab/causal-edge/` -> 0 |
| who imports the causal-edge enum exports | `store.js:49` imports `validateEnum` + consts; `walker.js:32` imports CONSTANTS only. (`faithfulness.js` does NOT `require('./enums')` — it mirrors values as inline literals; architect VERIFY correction.) -> the re-export must keep BOTH the fns AND the consts |
| layer legality | new leaf under `kernel/_lib`; lab -> kernel/_lib = K12-legal (outer->inner) |

## Build

1. **`kernel/_lib/free-string-checks.js`** (NEW) — `hasControlChars(v)` (verbatim from the stores, incl. the BOM) + `nonEmptyString(v)`. PURE, side-effect-free, no I/O at import/call (the `enum-validate.js` discipline). Header documents the reject-not-scrub semantics + the `sanitize.js` distinction.
2. **`manage-proposal/store.js`** — delete the local `hasControlChars` + `nonEmptyString`; import from the leaf. `validateFreeString` stays (composes the leaf primitives + the `manage-proposal:` prefix + the byte-cap).
3. **`causal-edge/store.js`** — same: delete local `hasControlChars` + `nonEmptyString`; import from the leaf. `validateFreeString` stays (`causal-edge:` prefix).
4. **`causal-edge/enums.js`** — delete local `normalizeAsciiEnum`/`validateEnum`; `require` + re-export from `kernel/_lib/enum-validate` (preserve BOTH fn exports + the local CONSTS).
5. **`tests/unit/kernel/_lib/free-string-checks.test.js`** (NEW) — the leaf unit: rejects each control/format codepoint (C0 sample, DEL, a C1, U+2028, U+2029, **U+FEFF**), accepts ordinary non-ASCII + ASCII; `nonEmptyString` boundary (''/non-string -> false, 'x' -> true). ASCII-source (`String.fromCharCode` for the codepoints).
6. **signpost** — new `.js` headers -> regenerate `docs/SIGNPOST.md`.

## Test plan (regression-net + leaf)

- The existing manage-proposal + causal-edge suites stay GREEN UNCHANGED (behavior-preserving) — incl. the BOM tests added in #265 (now exercising the shared leaf through `validateFreeString`).
- NEW leaf test (step 5).
- carry-2: the causal-edge suite stays green; if any enum-error test asserted the `causal-edge:` prefix, update to `enum-validate:` (probed: none).
- Full gate: lab + kernel + runtime suites + lint 121/0 + K12 0 + signpost up-to-date.

## Traps

1. **carry-2 re-export completeness** — `causal-edge/store.js` imports `validateEnum` from `./enums`; the migration MUST keep that export live (re-export the leaf's `validateEnum` + `normalizeAsciiEnum`), AND keep the local enum CONSTANTS (`RELATIONS` etc.) that `store.js` + `walker.js` import. Dropping either breaks an importer.
2. **Don't fold `hasControlChars` into `sanitize.js`** — opposite semantics (transform vs reject); the stores need fail-closed rejection of a BROADER set (BOM, U+2028/9). A new leaf, not sanitize.js.
3. **Behavior-preserving means byte-identical extraction** — the leaf's `hasControlChars` must be the EXACT current function (incl. the `0xfeff` clause); no "improvement" mid-extraction (any change is a separate, tested decision).
4. **K12** — the leaf lives in `kernel/_lib`; lab importing it is legal. The leaf must import nothing from `lab/` (it's a pure inner primitive). `layer-boundary-lint.js` asserts 0 findings.

## HETS Spawn Plan

- **VERIFY (pre-build):** 1 architect (read-only) on this plan — rule the OPEN Q (extract `validateFreeString` with a prefix param vs leave per-store), confirm the leaf name/contents + the carry-2 re-export completeness, catch any importer the migration would break. Fold before building.
- **VALIDATE (post-build):** code-reviewer (correctness of the extraction — every importer still resolves; behavior byte-identical) + hacker (security — the homoglyph + control-char + BOM defenses are PRESERVED exactly, no new bypass via the shared leaf). Read-only personas. (A 2-lens tier, not 3: it is a behavior-preserving refactor, not a new data-mutation surface — honesty-auditor's claim-vs-evidence lens is lower-value here; code-reviewer covers the "behavior-identical" claim.)
- **Gate + PR + USER merge.** Sequenced AFTER PR #266 (rules) at the user's discretion; branches off main independently.

## Drift Notes

- This is the **6th + 7th extract-to-`kernel/_lib`** (canonical-json / recency-decay / jsonl-read / evolution-snapshot-read / enum-validate / + free-string-checks). The pattern is now strong enough that the repo's own architecture docs (an ADR or `docs/ARCHITECTURE.md`) should name it — but that codification is a PROJECT-doc concern, deliberately NOT globalized to the toolkit rules (the `/self-improve` triage ruled it project-specific).

## Post-Build VALIDATE — 2-lens verdict (2026-06-08)

A 2-lens tier (behavior-preserving refactor, not a new data-mutation surface). **code-reviewer: APPROVE** (byte-identical extraction; every importer resolves; leaf pure; no residual dup) + 1 LOW (the plan named the leaf `free-string-validate` while the committed file is `free-string-checks` — FOLDED, the plan now matches). **hacker: 0 CRITICAL/0 HIGH/0 MEDIUM regression — every defense PRESERVED** (an exhaustive `0x00..0x10000` codepoint sweep confirmed the reject set is byte-identical incl. the BOM; the enum re-export is identity-true — `validateEnum === the leaf fn`, not a copy; the leaf is inert at import so it cannot perturb the stores' ENV-BEFORE-REQUIRE `LOOM_LAB_STATE_DIR` resolution; the reject-not-scrub boundary holds — empirically, folding into `sanitize.js` would have lost 7/10 control/format codepoints, validating D2). Gate: kernel 760/0, runtime 188/0, lab green, lint 121/0, K12 0, signpost up-to-date.
