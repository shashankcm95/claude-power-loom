# ③.0-W2 — secret-scrub for the beta's own credential classes

**Phase:** ③.0 (foundation-hardening) · **Date:** 2026-06-17 · **Status:** BUILT — VERIFY + VALIDATE
done; PR #343 (post-VALIDATE routable-PAT fold applied; unmerged) ·
**Charter:** `2026-06-16-test-phase-live-beta-charter.md` ③.0-W2 · **Follows:** ③.0-W1 (#342, merged)

## Goal

Before any beta path mints/handles a GitHub token (`gh auth`, `git push`, the PR-egress kernel), the
substrate's secret defenses must cover the credential classes the beta itself uses. Today two
secret-pattern lists drift and both miss beta-relevant classes. Close the coverage gap + make the two
lists provably non-drifting. **Pure hardening; all SHADOW; trust moves zero (OQ-NS-6).**

## Runtime Probes (actual current state — verified, not the review's summary)

The whole-substrate review said "two lists drift; both miss `github_pat_`, `ghs_/ghr_`, `glpat-`,
`AIza`." Reading the actual code refines that:

1. **`scrubSecrets` / `SECRET_PATTERNS` — `spawn-record.js:110-121`** (the COARSE redaction net; reused
   by `sanitize.js:87-94` `sanitizeForJsonl`; redacts completion text in spawn records). Has: AKIA,
   aws-assign, broad `sk-`, JWT, `ghp_`, `gho_`, slack, stripe `sk_/rk_(live|test)`, URL-password.
   **MISSING: `github_pat_` (fine-grained PAT — what `gh auth`/`git push` mint now), `ghu_`/`ghs_`/`ghr_`
   (incl. `ghs_` = the GitHub App/Actions installation token), `glpat-` (GitLab), `AIza` (Google).**
2. **`SECRET_PATTERNS` — `validate-no-bare-secrets.js:55-92`** (the edit-BLOCKING gate; rich shape
   `{id, regex, description, [valueGroup]}` + a `PLACEHOLDER_VALUES` skip set; FP-tuned). Has: `sk-ant-`,
   openai `sk-(proj-)?`, stripe live, slack, **`gh[posur]_[A-Za-z0-9]{36,}` (covers ALL classic gh*:
   p/o/u/s/r)**, **`github_pat_[A-Za-z0-9_]{82,}`**, AKIA, JWT, PEM, literal `*_SECRET/_KEY/_TOKEN`
   assignment. **MISSING: `glpat-`, `AIza`.**
3. **`network-egress-detect.js`** only *references* `scrubSecrets`'s "coarse net" posture in a comment
   — it has NO own secret list (egress-host detection is a separate concern). NOT in scope.
4. **Real token formats (Runtime-Claim Probe — do NOT guess; VERIFY hacker confirms each):**
   - `github_pat_` + 82 `[A-Za-z0-9_]` (GitHub fine-grained; validator already `{82,}`).
   - `ghs_`/`ghr_`/`ghu_`/`ghp_`/`gho_` + 36 `[A-Za-z0-9]` (classic family; `gh[posur]_` covers all).
   - `glpat-` + 20 `[A-Za-z0-9_-]` (GitLab PAT).
   - `AIza` + 35 `[A-Za-z0-9_-]` (Google API key, 39 total).
   All are HIGH-PRECISION prefixes (don't occur in normal code/prose) → safe for BOTH coarse redaction
   and strict blocking (low FP risk — to be confirmed by running the validator against the repo).

So the drift is real + bidirectional: the scrubber is the leaner list (4 missing classes); the
validator misses only `glpat-`/`AIza`; and the two use different SHAPES + serve different purposes
(scrub over-match = safe; block FP = costly).

## Design

### The tension (why NOT one identical merged list)

The scrubber is a coarse defense-in-depth net (broad patterns like `sk-[...]{20,}` are fine; redacting
a non-secret is harmless). The validator BLOCKS edits, so it is delicately FP-tuned (openai-after-
anthropic ordering, `valueGroup`, `PLACEHOLDER_VALUES`, word boundaries). Forcing the scrubber's coarse
patterns into the validator would add FPs; forcing the validator's tuned/validator-only patterns into
the scrubber is pointless. **A single one-size list is the wrong abstraction.**

### Chosen: a shared CANONICAL high-precision class set + per-consumer extras + an anti-drift cross-test

- **NEW `packages/kernel/_lib/secret-patterns.js`** — the single source of truth for the
  HIGH-PRECISION, prefix-anchored token classes that BOTH a coarse scrubber and a strict validator
  agree on (no FP risk, identical intent): `gh[posur]_` classic, `github_pat_` fine-grained, `glpat-`
  GitLab, `AIza` Google, `sk-ant-` Anthropic, slack `xox`, stripe `sk_live_`/`rk_live_`, AKIA, JWT.
  Exported as `CANONICAL_SECRET_CLASSES = [{ id, regex, description }]` (rich shape; the validator's
  native shape). Each `regex` is authored fresh-per-getter or the module documents the
  global-flag/`lastIndex` reuse hazard (a shared `/g` regex object carries mutable `lastIndex` across
  `.test()`/`.replace()` calls — VERIFY hacker check; likely export a factory or per-class fresh regex).
- **`validate-no-bare-secrets.js`** imports `CANONICAL_SECRET_CLASSES` and spreads it into its
  `SECRET_PATTERNS` alongside its VALIDATOR-ONLY entries (PEM, literal-assignment+valueGroup, the
  openai-tuned `sk-(proj-)?`). Net: it GAINS `glpat-` + `AIza`; its existing classic/fine-grained
  GitHub coverage now comes from the shared set (de-duplicated).
- **`spawn-record.js` `scrubSecrets`** uses `CANONICAL_SECRET_CLASSES.map(c => c.regex)` PLUS its
  SCRUBBER-ONLY coarse patterns (broad `sk-`, URL-password, aws-assignment, stripe `test`). Net: it
  GAINS `github_pat_`, `ghu_/ghs_/ghr_` (via `gh[posur]_`), `glpat-`, `AIza`.
- **Cross-test** (`tests/unit/kernel/_lib/secret-patterns-crosstest.test.js`): a shared fixture of ONE
  realistic sample per canonical class; assert for EACH that (a) `scrubSecrets(sample)` redacts it
  (no original token substring survives) AND (b) `validate-no-bare-secrets` flags it. If either list
  later drops a canonical class, this test fails — the anti-drift guarantee the review asked for.

### Considered + rejected

- **Full DRY (one identical list both consume):** rejected — regresses the validator's FP profile +
  pollutes the scrubber; the two genuinely differ in purpose (cross-test over shared-canonical is the
  right DRY granularity).
- **Cross-test only, no shared module:** rejected — leaves two hand-maintained copies of the canonical
  classes; the shared module makes "add a class once" real, the cross-test guards the seam.

## Test plan (TDD — red first)

- `secret-patterns.test.js` (NEW): each `CANONICAL_SECRET_CLASSES` regex matches a real-shaped sample
  + does NOT match an obvious non-secret; no shared-`lastIndex` bleed across repeated `.test()`.
- `secret-patterns-crosstest.test.js` (NEW): the per-class scrub-AND-block cross-assert (above).
- Extend `spawn-record` scrub tests: `github_pat_`, `ghs_`, `ghr_`, `ghu_`, `glpat-`, `AIza` samples are
  redacted; existing classes still redacted (regression).
- Extend `validate-no-bare-secrets` tests: `glpat-`, `AIza` samples flagged; existing FP-tuning intact
  (the placeholder skips + literal-assignment valueGroup unchanged); **no NEW false positive on the
  repo's own tracked content** (run the validator across the repo, assert clean).

## Gate

`bash install.sh --hooks --test` (esp. the validate-no-bare-secrets smoke + eslint/yaml/markdownlint) +
the full kernel suite, all green. ASCII-only; zero eslint-disable. Run the validator against the whole
repo post-change to catch any new FP on existing fixtures/docs.

## Routing Decision

```json
{ "recommendation": "route", "rationale": "kernel/security multi-file change (new shared _lib module + 2 secret-defense consumers + cross-test) on the credential-handling path; earns the 3-lens board (hacker lens load-bearing for token-format correctness + FP/bypass) despite route-decide scoring substrate work 'root' on a stakes-lexicon miss." }
```

## HETS Spawn Plan

- **VERIFY (pre-build, 3 read-only lenses, parallel):** architect (is the shared-canonical + per-consumer-
  extras split the right abstraction? module boundary; regex `lastIndex`/global-flag reuse hazard) ·
  hacker (are the new regexes CORRECT per real token formats? `glpat-`/`AIza` length+charset; any BYPASS
  — a token the beta uses that still slips both; any FP that would block legit edits or over-redact) ·
  honesty-auditor (does the plan's drift map match the code? is "both miss X" honest now that the
  validator already covers the gh* family + github_pat_?).
- **BUILD:** orchestrator-direct TDD (small, tightly-coupled security surface).
- **VALIDATE (post-build, 3 lenses, parallel):** code-reviewer (correctness/DRY of the shared module +
  both consumers) · hacker (Rule-2a LIVE re-probe of the BUILT regexes — feed real `ghs_`/`github_pat_`/
  `glpat-`/`AIza`/embedded-in-prose/adjacent-token samples through the actual `scrubSecrets` +
  `validate-no-bare-secrets` modules; hunt a bypass or an FP) · honesty-auditor (claims-vs-diff: did
  both lists actually gain the classes; is the cross-test a real guard or vacuous).

## VERIFY result + folds (2026-06-17)

3-lens board `wf_1389c15b-3f9` (architect + hacker + honesty). **All three PROCEED-WITH-CHANGES** — the
shared-canonical + per-consumer-extras + cross-test abstraction is the right shape (full-DRY correctly
rejected); the drift map is honest (the validator already covers gh*+github_pat_; only the SCRUBBER had
the 4-class gap). Folds (all pre-build):

1. **(arch HIGH + hacker MED, both PROVEN) `/g` lastIndex → FACTORY.** `secret-patterns.js` exports
   **`getCanonicalSecretClasses()`** returning a FRESH array of freshly-constructed `{id, regex,
   description}` per call — NOT a shared mutable RegExp-object array (`Object.freeze` does not freeze a
   RegExp's writable `lastIndex`; a shared `/g` object's `.test()`/`.exec()` bleeds state → a real token
   intermittently slips = security false-negative). Each consumer calls the factory ONCE at module load
   (owns its own instances); the validator keeps its `pat.regex.lastIndex = 0` reset. Module header
   documents WHY (no future "optimize to a const array").
2. **(hacker HIGH, PROVEN) `glpat-` floor + `\b`.** Author GitLab as `/\bglpat-[A-Za-z0-9_-]{20,}/g`
   (FLOOR, not bare `{20}` — a >20-char token's tail otherwise survives `.replace` into the
   world-readable envelope; same trap the validator's `github_pat` comment records). `AIza` →
   `/\bAIza[A-Za-z0-9_-]{35,}/g` (floor + `\b` to cut the mid-base64 FP without breaking `KEY=AIza…`).
3. **(hacker HIGH, bypass) PEM → CANONICAL.** Move the PEM-private-key class
   (`/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/g`) from validator-only INTO the shared canonical set so
   the SCRUBBER gains it too — an SSH / RSA / GitHub-App private key (the beta's `git push` + App-token
   path) otherwise egresses unredacted. Zero FP (literal banner) → belongs in canonical.
4. **(hacker, DECISION) npm_/pypi- = OUT OF SCOPE.** The ③.0/③.1 dry-run flow solves issues + the USER
   pushes PRs — it does NOT publish to npm/PyPI, so registry-publish tokens are not a beta credential
   class yet. Stated here (not a silent gap); add to canonical only if a ③.2 publish path ever appears.
5. **(honesty HIGH + arch MED) cross-test must NOT be vacuous.** The scrubber's broad `sk-[…]{20,}` /
   AKIA / JWT / stripe SHADOW several canonical classes, so "scrubSecrets redacts the sample" stays
   green even if the canonical class is deleted. Fix: the cross-test isolates the shared set —
   (a) scrub each REAL-LENGTH fixture (embedded `prefix <TOKEN> suffix`) using ONLY
   `getCanonicalSecretClasses()` and assert the token literal is gone + `[REDACTED]` present +
   surrounding text preserved (no over-redaction); (b) on the validator side assert the reported finding
   `id` equals the expected canonical class id (not merely "some pattern matched"); (c) a deletion of a
   canonical class fails (a). Plus a `.test()`-twice-on-the-same-token lastIndex regression.
6. **(arch HIGH) validator ordering.** Wire `SECRET_PATTERNS = [...getCanonicalSecretClasses(),
   ...VALIDATOR_ONLY]` (VALIDATOR_ONLY = openai `sk-(proj-)?`, literal-assignment) so canonical
   `sk-ant-` PRECEDES validator-only openai (the documented `\bsk-` precedence). Regression test: a
   `sk-ant-…` literal reports id `anthropic-api-key`, not `openai-api-key`.
7. **(hacker LOW) residual FP.** Document the AIza-mid-base64 + `glpat-`-kebab-slug FPs in the
   validator's existing base64-policy comment (SEC block); run `validate-no-bare-secrets` across the
   whole tracked repo post-change and assert ZERO new finding (Gate already requires this).
8. **(honesty LOW) doc fix.** `sanitize.js` + `network-egress-detect.js` live under
   `packages/kernel/_lib/`, not `spawn-state/` (line refs were accurate; dir implied wrong).

Canonical set (high-precision, shared, no-FP): `gh[posur]_` classic · `github_pat_` fine-grained ·
`\bglpat-` · `\bAIza` · `sk-ant-` · slack `xox` · stripe `sk_live_`/`rk_live_` · `\bAKIA` · JWT · PEM.
Scrubber-only extras: broad `sk-`, URL-password, aws-assignment, stripe `test` variant. Validator-only
extras: openai `sk-(proj-)?`, literal `*_SECRET/_KEY/_TOKEN` assignment (with `valueGroup`).

## VALIDATE result (2026-06-17)

3-lens board `wf_336b8495-db3` (code-reviewer + hacker Rule-2a live re-probe + honesty).
**reviewer SHIP-WITH-NITS · hacker SHIP-WITH-NITS · honesty SHIP (Grade A, NO-OVERCLAIM).** The hacker
require()'d the BUILT modules and attacked: EVERY current-format beta class (gh classic, github_pat_,
glpat-, AIza, PEM) is both redacted by the scrubber AND blocked by the validator; the H1 tail-leak is
FIXED (variable floors fully consumed); the factory gives provably independent RegExp instances (200
interleaved + 1000 consecutive calls, no /g lastIndex cross-bleed); the require.main guard kills the
import-hang; no ReDoS; **the hacker's own repo-wide scan of all 1145 files = 0 new-class FPs**. The
hacker RECANTED an initial "github_pat_ slip" — it was a synthetic artifact (a '-' injected into a body
real PATs never contain). Honesty verified all 4 load-bearing claims against the code. All findings
LOW/MED, all folded:

- **H-NIT-1 (hacker MED):** github_pat_/classic charset is base62(+_) — narrower than glpat-/AIza by
  design (each matches its real token alphabet), forward-brittle if GitHub changes format. **Folded:** a
  CHARSET NOTE at the secret-patterns.js def to re-confirm on a format change (kept the charset — it
  covers every real current token, proven).
- **LOW-1 (reviewer):** canonical AKIA/JWT are marginally narrower than the old scrubber hand-list.
  **Folded:** an intentional-narrowing comment at the scrubber spread site.
- **LOW-2 (reviewer):** the require.main block body was unindented. **Folded:** re-indented (parse +
  hook-test + require-no-hang re-verified).
- **H-NIT-2 (hacker MED):** registry-publish tokens (npm_, pypi-, dckr_pat_, crates) are covered by
  neither consumer. **Folded (decision restated):** OUT OF SCOPE for ③.0/③.1 — the dry-run solves
  issues + the USER pushes via gh/git; it does NOT publish to a registry. Add these only when/if a ③.2
  publish path appears.
- **honesty H2 (LOW):** make the FP count re-verifiable. **Folded:** the scan command is
  `git ls-files | <scanContent each>`; result = 1145 files, **0 gitlab-pat/google-api-key findings**;
  the only finding is the PRE-EXISTING `pem-private-key` at `tests/smoke-ht.sh:1068` (a literal RSA
  banner in the H.9.15 Test-96 fixture; PEM was already a validator class — the canonical move changes
  WHERE pem is defined, not WHETHER it flags).

Post-fold gate: tests/unit 188/0; install.sh --hooks --test 125/0 (SIGNPOST regenerated for the new
module); the FP scan re-run clean. Build was orchestrator-direct (not delegated) → no Rule-4 subject.

## Post-VALIDATE fold — GitLab routable-PAT suffix (2026-06-17, USER side-finding)

After the VALIDATE board + green CI/CodeRabbit (PR not yet merged), the USER flagged that the
`gitlab-pat` regex `\bglpat-[A-Za-z0-9_-]{20,}` MISSES GitLab's 17.x+ routable PAT format
(`glpat-<base>.XX.YYYYYYY`, e.g. `…BD.01.6z70tqjnm`): `.` is not in `[A-Za-z0-9_-]`, so the base
redacts but the dotted routing tail SURVIVES `.replace()` into the world-readable envelope — an
EXTENSION of the H1 tail-leak class this wave exists to close. PROBED + confirmed
(`lead [REDACTED].01.6z70tqjnm trail`). **Fix:** widen to
`\bglpat-[A-Za-z0-9_-]{20,}(?:\.[a-z0-9]{2}\.[a-z0-9]{7,})?` — mirrors GitLab's own secret-detection
rule `glpat-[A-Za-z0-9_-]{27,300}(\.[a-z0-9]{2}\.[a-z0-9]{7})?` but keeps the looser `{20,}` base floor
+ a `{7,}` final-segment FLOOR (the observed example's final run is 9 chars > GitLab's documented 7) +
an unbounded upper, so a redaction net NEVER leaves a partial token. Suffix is OPTIONAL → legacy
non-routable tokens still match. Re-verified: routable (7- and 9-char finals) + legacy all fully
redacted; FP re-scan 0 new across 1144 files; tests/unit 188/0; install 125/0. Tests updated
(secret-patterns + cross-test + spawn-record + validator now use the routable fixture). Reusable: a
prefix-anchored secret class with `.`-delimited structure needs the structured suffix in the regex, or
the dot-separated tail survives a charset-only match.

## Honest frame

Pure defensive hardening of the secret surface. No shadow→live flip, no weight change. The scrubber
stays a coarse defense-in-depth net (NOT a primary control — a real secret-management discipline + the
③.2 PR-egress pre-scrubber remain the primary controls); this wave closes its coverage of the beta's
OWN token classes + removes the two-list drift so a future class is added once. CodeRabbit gate on the
PR will also re-verify CodeRabbit recovered from the 06-17 App/Reviews outage.
