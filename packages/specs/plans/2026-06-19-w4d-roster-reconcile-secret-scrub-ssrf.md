# ③.1-W4d — final dry-run-closing wave: roster reconcile + secret-scrub + SSRF allowlist + phase-close

- **Status:** VALIDATED — built + 3-lens VALIDATE PASS + CodeRabbit folded (re-review clean); [PR #362](https://github.com/shashankcm95/claude-power-loom/pull/362) awaiting USER merge → `/phase-close ③.1`. (See `## Build + VALIDATE result` below.)
- **Wave:** ③.1-W4d (the FINAL ③.1 sub-wave; closes the LIVE-EXTERNAL-PR-BETA dry-run → produces the Router-V2 corpus)
- **Track:** SHADOW / DRAFT-only / trust ZERO (OQ-NS-6 — the apparatus NARROWS, it does not harden trust)
- **Branch:** `feat/w4d-roster-reconcile-secret-scrub-ssrf` (built off `origin/main` @ `98ae2cc` after rebase)

## Context / Goal

W4c (#357) proved the earned-grounding apparatus end-to-end. W4d closes ③.1 by paying down the
remaining dry-run-close debt + folding the audit's **Finding A1** (the `real-solve` host-side SSRF)
into the same wave (USER decision 2026-06-19). After this merges + `/phase-close ③.1` signs off,
③.1 is closed and the routing corpus is ready for the queued Router-V2 wave.

**Routed here, NOT in this wave** (handoff `packages/specs/findings/2026-06-19-handoff-real-solve-ssrf-and-agentid-premise.md`):
- **Finding B** (`computeContentHash` `agentId`-uniqueness premise) → a **kernel session** (MAJOR-protected kernel arc, probe-first); re-routed, not built here.
- **P1 / P2** (trust-domain key separation + minter consumer flips) → the **v-next authenticated-minter session** (continues #360); not this track.

## Routing Decision

```json
{
  "scorer": { "recommendation": "root", "confidence": 0.167, "score_total": 0.25,
    "matched": { "compound_strong": ["verdict-attestation"] },
    "miss": "stakes lexicon matched nothing — 'SSRF', 'auth-key reconcile', 'secret-scrub', 'writes to real refs' carry no stakes token" },
  "decision": "route (OVERRIDE by judgment)",
  "rationale": "Documented substrate under-scoring (MEMORY: route-decide scores substrate work root/borderline on a stakes-lexicon miss). This wave touches a LIVE host-side SSRF clone path (security), a content-addressed lesson/recall-graph persistence path (secret-scrub + hash invariants), and a record-time auth-key grouping (data-mutation) — squarely the kernel/security/data-mutation class that MANDATES the 3-lens VALIDATE tier (code-reviewer + hacker + honesty-auditor). Same call as W4c."
}
```

## Runtime Probes

Every current-state claim below was probed firsthand by the W4d recon (5 parallel `codebase-analyzer`
reads of current `main`, 2026-06-19). The probes **reshaped the wave** — two items collapsed to no-ops.

| Claim (from MEMORY / the brief) | Probe | Result |
|---|---|---|
| "`reapOrphans` is only in a finally; add a batch-start call" | Read `earned-grounding-run.js` main() | **FALSIFIED.** Batch-start reap ALREADY present at `:331-332` (best-effort `try{reapOrphans({dockerBin})}catch{}`), landed W4c #357. Module header `:30` + MEMORY predate it → stale premise. **DROPPED from build scope.** |
| "the reconcile must write a `canonicalPersonaKey` normalizer" | Grep `canonicalPersonaKey` | **Already exists** — `persona-experiment/canonical-persona-key.js:88` (strips `^\d+-`, validates vs `agents/*.md` basenames, returns null for unknown; 16 tests). Reconcile = WIRE it, don't write it. |
| "the secret-scrub deferral is at `arm-loop.js:20`" | Trace solveFn content flow | **Comment mislocated.** arm-loop routes content through `digest()` only (`:146`) + bounded scalar attrs (`clampScalar :57`) — already leak-safe. Real leak surface = `causal-edge/lesson-capture.js` (candidate-patch bytes `:77` + LLM `lesson_body` `:89`, both persisted unscrubbed). |
| "`personaOf` fail-back should be `\|\| 'unknown'`" | Read `reputation/project.test.js` fixtures | **MUST be `\|\| raw`.** Existing tests use synthetic personas (`pA`/`pB`/`pX`) not in `agents/*.md` → `canonicalPersonaKey` returns null → `\|\| 'unknown'` would COLLAPSE unrelated personas + break the suite. `\|\| raw` only collapses the KNOWN numbered/bare pair. |
| "the SSRF allowlist is a no-op for the corpus" | Read `docker-backend.test.js:188` | **Breaks one test.** `:188` asserts `assertSafeRepo('https://example.com/r.git')` PASSES; a github-only allowlist REJECTS it. Acceptance criteria (`findings:25`) want allow(github)/deny(other) tests → that test MUST change. No-op for corpus DATA (already github-only), real behavior change for the guard. |
| "`assertSafeRepo` is the shared chokepoint for both clone paths" | Grep `assertSafeRepo` callers | **Confirmed.** `prepareClone:96` (grader) + `real-solve.js:153` (actor) both route through it → one fix covers both. W4c's `assertGithubRepo` (`earned-grounding-run.js:68`) is a stricter SIBLING that stacks on top at `:174/:365` only. |
| "write-side normalization interacts with the H-1 mislabel guard" | Read `verdict-attestation/store.js:243-247` | **Confirmed — and VERIFY corrected the design.** A fresh store sees no false-fire, BUT on a mixed-era store the guard compares the raw on-disk `13-node-backend` against the normalized input → FALSE mislabel-throw (F1). Resolution: normalize BOTH sides of the comparison (Item 1c); do NOT change the stored value. `node-backend` vs `ml-engineer` (Test 13) still trips it. |
| "no `http://` caller relies on `assertSafeRepo` before the global https-tighten" | Grep `assertSafeRepo` callers (VERIFY architect) | **Confirmed safe.** Only `prepareClone:96` (grader) + `real-solve.js:153` (actor) route through it; both clone github.com https corpus repos. The https-only tighten breaks ONLY `docker-backend.test.js:188`'s `example.com` fixture (changed in the test contract). |

## Scope

Four build items + one documented decision + the phase gate. **MEMORY's "record-time" label is imprecise**:
the lever-close is achieved **read-side** (necessary + sufficient for existing on-disk rows); write-side
is additive defense-in-depth (a plan-honesty note — the existing C2 fork-1 design `canonical-persona-key.js`
is a *read-side* normalizer).

### Item 1 — C2 roster reconcile (close the `13-node-backend` vs `node-backend` laundering lever)

Wire the EXISTING `canonicalPersonaKey(raw) || raw` (fail-soft to raw) at four sites. ~no-op migration
(pure read-side normalization for the consumers; ZERO stored-row rewrite AND ZERO stored-value change —
honors "do not re-record legacy v3.4-W6 rows").

- **1a (read-side, PRIMARY):** `reputation/project.js` `personaOf` (`:51-53`) → `return canonicalPersonaKey(raw) || raw;` + import. Every downstream bucket (`:91`,`:99`) + emitted `row.persona` (`:115`) inherits the canonical key. Update the module header (`:7` "PURE … one ledger read, no other I/O") — `canonicalPersonaKey` adds a memoized `readdirSync(agents/)`; keep the doc honest.
- **1b (read-side, PRIMARY):** `circuit-breaker/project.js` `personaOfVerdict` (`:73-75`) — same one-line change. Sibling reader of the SAME store; leaving it raw = a partial fix (the breaker still fragments). Its dedup key at `:108` (`JSON.stringify([personaOfVerdict(r), idKey])`) shifts intentionally (numbered+bare under one agentId collapse). **F5 test:** two fail records for one agentId (`13-node-backend` + `node-backend`) → exactly ONE dedup group.
- **1c (write-side — H-1 guard normalization, NOT a stored-value change | folds F1 + architect-A1):** the write-side job is **NOT** lever-close (read-side does that) — it is preventing a **false H-1 mislabel-throw** on a numbered/bare collision. The H-1 guard (`verdict-attestation/store.js:243-247`) compares the on-disk `r.subject.persona` (e.g. legacy `13-node-backend`) against the input `subject.persona`; if only the input were normalized, `13-node-backend !== node-backend` would **falsely throw mislabel** on a mixed-era store (the F1 bug — Runtime-Probe row 5's "desired" was a fresh-store artifact). Fix: normalize **BOTH sides** of the comparison only — `(canonicalPersonaKey(r.subject.persona) || r.subject.persona) !== (canonicalPersonaKey(subject.persona) || subject.persona)`. **Do NOT change the stored value** (`recordVerdict:224` writes the raw input verbatim — keeps disk byte-stable forward + backward). `attestation_id` basis (`:218`) excludes persona → dedup unaffected. **Tests:** write `13-node-backend` then `node-backend` for one agentId → no throw (coexist); Test 13 (`node-backend` vs `ml-engineer`) → still throws.
- **1d (read-side CLI symmetry | folds architect-A4):** `reputation/cli.js` `--persona`/`--personas` filter token (`:49`/`:71`/`:122`) — canonicalize the token (`canonicalPersonaKey(tok) || tok`) so a `--persona 13-node-backend` query still matches the now-canonical emitted rows. Same one helper; keeps the read/query path coherent with 1a.

**Load-bearing:** immutability — `personaOf` only READS `r.subject.persona` (rows are deep-frozen at `store.js:97`); never assign. 1c builds NO new object — it only normalizes inside the comparison expression.

**Accepted residual (folds hacker-M1 — plan-honesty):** `canonicalPersonaKey(raw)||raw` collapses the numbered/bare lever ONLY for ON-ROSTER personas (in `agents/*.md`). An OFF-ROSTER name (`foo`, `13-foo`, `99-foo`) returns null → falls through to distinct raw keys → still fragments. This is NOT a regression (off-roster was always distinct) and `|| raw` is the correct null-policy (`|| 'unknown'` collapses the synthetic test personas + breaks the suite; fail-closed breaks `cli.test.js`'s off-roster `p` record — both confirmed in fixtures). The TOTAL close is record-time roster-membership enforcement at the producer — explicitly out of scope for the dry-run. Add a coexistence test asserting off-roster numbered/bare do NOT collapse (documents the accepted residual).

### Item 2 — real-content secret-scrub (the lesson-capture persistence path)

arm-loop is already leak-safe → its only change is **fixing the mislocated `:20` comment** to point at lesson-capture. The scrub lands in `causal-edge/lesson-capture.js` (the single persistence chokepoint).

- **2a (shared scrubber-only export + NEW lab helper | folds F2 + hacker-H1):** the scrub MUST match spawn-record's FULL surface = **canonical classes + the four `SCRUBBER_ONLY_PATTERNS`** (URL-embedded password, coarse `sk-`, Stripe TEST `sk_test_`, AWS-secret assignment) — `spawn-record.js:117-137`. Canonical-only is **strictly weaker** (hacker live-probed: `sk-proj-…`, bare `sk-…`, `https://u:pw@host`, `aws_secret_access_key=…` all SURVIVE it). DRY-correct fix (avoid the two-drifting-copies anti-pattern): add an ADDITIVE `getScrubberOnlyClasses()` factory to `kernel/_lib/secret-patterns.js` (fresh `/g` instances per call — same factory rationale as the canonical set), **refactor `spawn-record.js` to consume it** (behavior-preserving; guarded by the kernel suite + `secret-patterns-crosstest`), then new `packages/lab/_lib/scrub-lab-secrets.js`: `const REGEXES = [...getCanonicalSecretClasses(), ...getScrubberOnlyClasses()].map(c=>c.regex);` → `scrubLabSecrets(text)` returns a NEW string (`if(!text) return text; let out=String(text); for(const p of REGEXES) out=out.replace(p,'[REDACTED]'); return out;`). lab→kernel/_lib import is legal (precedent: `candidate-sidecar.js:27`). _(This is the one place the wave reaches into kernel `_lib` — the SSOT for secret scrubbing; additive + behavior-preserving.)_
- **2b (candidate-patch bytes | folds F4 + A3):** scrub `candidate_patch` into a **single `const scrubbedCandidate`** consumed by ALL THREE downstream sites so the two-site-sha is structurally guaranteed (not convention): `deriveLesson` (`:64` — scrub BEFORE the LLM contrast; the derive input is the most privacy-sensitive path) **and** `sidecarSha` (`:76`) **and** `writeCandidate` (`:77`). For `usableFailed` (the failed-patch trap seam): it is a **one-site sha** (the sha comes from `writeCandidate`'s `fw.sha`, no standalone `sidecarSha`) — apply `usableFailed = scrubLabSecrets(usableFailed)` right after its assignment (`:61`), before `writeCandidate` (`:84`).
- **2c (lesson prose):** scrub `lesson_body` BEFORE `buildWorkedExampleNode` (`:89`): `const safeLesson = { ...d.lesson, lesson_body: scrubLabSecrets(d.lesson.lesson_body) };` then pass `lesson: safeLesson`. **MUST precede the node build** — `lesson_body` ∈ `LESSON_HASH_FIELDS` (`recall-graph.js:153`) → folded into `lesson_content_hash` (`:219`); scrubbing after would bind the hash to the unscrubbed body (verify-on-read would still expose it). **A3 stability test:** scrubbing `lesson_body` must NOT alter `trigger_class`/`gotcha_class`/`corrective_class` (the enum fields drive `lesson_signature`/`node_id` — scrub touches only the free-text body, so node identity stays patch-stable; assert it).
- **2d (0700 dir-perms — defense-in-depth amplifier-close | folds hacker-H1 store-dir note):** the scrub's threat model is "secret survives → lands in a **world-readable** dir." `candidate-sidecar.js:62` + `recall-graph-store.js:111` create the lab-state dirs with bare `mkdirSync` (no mode). Add `mode: 0o700` at those two named sites (no-op on Windows; matches the `lab-store-dir 0700` carry + the ③.0-W4 per-uid-0700 precedent). Scope ONLY to those two sites; if dir creation turns out scattered, the scrub (2a-2c) is the primary fix and 2d can narrow.

**Load-bearing:** hash-ordering (2c) + structural single-const two-site-sha (2b) + immutability (spread, don't mutate `d.lesson`). The existing `lessonLeaks` guard (`lesson-derive.js:60`) is an anti-cheat against the *accepted_diff*, NOT a secret scan — a secret echoed from the *candidate* diff passes it (the precise gap this item closes).

### Item 3 — Finding A1: SSRF host-allowlist in `assertSafeRepo` + DRY collapse of `assertGithubRepo`

- **3a:** `issue-corpus/_clone-lifecycle.js` — add `DEFAULT_REPO_HOST_ALLOWLIST = Object.freeze(['github.com'])` (near `:32`) + a CALL-TIME `resolveHostAllowlist()` reading `LOOM_CLONE_HOST_ALLOWLIST` (comma-split → trimmed-lowercase Set; empty/absent/unknown → **fail-safe to default, never fail-open**; mirror `circuit-breaker/project.js:193-200`). Replace the bare `:57 if (/^https?:\/\//.test(repo)) return repo;` with, **in this order** (ordering is load-bearing): (1) the raw-string parser-differential guard `if (/[@\\]/.test(repo) || /[^\x21-\x7e]/.test(repo)) throw` (BEFORE `new URL` — `new URL` normalizes `\@` away); (2) `new URL(repo)` in try/catch; (3) `url.protocol === 'https:'` (TIGHTEN from http-OR-https); (4) `(allowlist).has(url.hostname)` (`hostname` not `host` — no port differential). Keep the leading-`-` (`:56`) + local/`allowLocal` (`:58-60`) branches. **Value-redact every throw** (messages flow into `residuals` → the serialized report; reconcile the existing branches at `:56/:59/:60` which currently echo the value).
- **3b (DRY | folds F3 + A2):** make `earned-grounding-run.js` `assertGithubRepo` (`:68-89`) a **thin delegate**: `return assertSafeRepo(repo, { allowLocal: false, hostAllowlist: ['github.com'] });` (an explicit `hostAllowlist` param overriding the env — caller-injected-override precedence, mirror `weight-source-gate.js:39-43`). **F3:** explicitly REMOVE the now-redundant direct `assertSafeRepo(record.repo)` call at `:365`, keeping only `assertGithubRepo(record.repo)` — else the direct call uses the env allowlist while the delegate pins `['github.com']`, a silent misalignment if the env is ever widened. **A2 message-coupling:** the delegate's throws are message-coupled — `assertSafeRepo`'s new throws MUST preserve the substrings the 6 existing tests match (`/host must be exactly github.com/`, `/scheme must be https/`, `/userinfo\/backslash/`, `/non-empty string/`) OR update those 6 regexes in the same diff. The plan's "stay green via delegation" is only true if the messages carry over.
- **L1 (spec note, no code):** `github.com:<port>` is intentionally PERMITTED (`url.hostname` strips the port — the correct anti-port-differential choice; a non-default port cannot redirect to a different host). Documented so a reviewer does not flag it.
- **Test contract:** change `docker-backend.test.js:188` (`example.com` → `github.com`) + add allow(github.com)/deny(other-host)/deny(non-https)/deny(`@`-differential)/deny(`github.com.evil.com`)/deny(IDN-punycode) cases on `assertSafeRepo` (acceptance `findings:25`). `earned-grounding-run.test.js:87-119` (the 6 `assertGithubRepo` cases) must stay green via delegation (per the message-coupling note).

### Item 4 — Finding A2: `--solve` operator-trust DECISION (documented, no code)

**Decision: ACCEPT as operator-trust (status quo).** `--solve` (`cli.js:47-55`, flag `:64`) is an operator-typed CLI flag injecting the real `claude -p` driver; the `OPERATOR-TRUST WARNING` (`:19-22`) already discloses in-process execution of operator-supplied code; the path is NOT attacker-influenced (operator-controlled, never corpus data). Per `findings:30-31` this is by-design + lower-priority than A1. `resolveSolveFn` already fails cleanly on a non-function/unloadable module. **No code change.** (If `--solve` ever became non-operator-controlled, the mitigation is to bound `path.resolve` to an allowlisted root before `require` — documented for the future, not built now.) Acceptance = this documented decision (`findings:32`).

### Item 5 — `/phase-close ③.1`

After Items 1-4 merge, run `/phase-close ③.1` — the 3-lens phase gate (PM-honesty + Principal-SDE + architect) over the INTEGRATED dry-run vs its exit criteria. Catches cross-PR drift the per-wave VALIDATE can't see. Writes the `## Phase-close sign-off` record (ROADMAP + a `toolkit/phase-close` library volume).

## Out of scope (probed no-ops / re-routed)

- **`reapOrphans` batch-start** — ALREADY DONE (#357, `earned-grounding-run.js:331`). Premise falsified; no change.
- **Finding B** (kernel `agentId` premise) — re-routed to a kernel session (probe-first; MAJOR-protected).
- **P1 / P2** (minter trust-domain keys + consumer flips) — the v-next minter session.
- **CLI filter symmetry** (`reputation/cli.js --persona` token canonicalization) — advisory/minor; defer unless VERIFY flags it.

## HETS Spawn Plan

**VERIFY (pre-build, read-only lenses, parallel):** the security + data-mutation class → 3-lens.
- `architect` — design soundness: read-side-vs-write-side reconcile split (is 1c worth the new fs-reach on the store write path?); SSRF delegation shape; scrub placement vs hash-ordering.
- `code-reviewer` — correctness: the `|| raw` fail-soft, immutability at all sites, the two-site-sha + hash-ordering invariants, the breaking-test contract.
- `hacker` — adversarial: can the allowlist be bypassed (parser-differential ordering, `host` vs `hostname`, env fail-open)? can a secret survive the scrub (class coverage, ordering, the candidate-vs-accepted leak-guard gap)? can the reconcile be abused (does `|| raw` reintroduce a laundering path for off-roster personas)?

Fold VERIFY corrections into this plan, then `/verify-plan` (append `## Pre-Approval Verification`), then USER approval before any edit.

**BUILD (TDD, test-first):** three INDEPENDENT concerns (disjoint files) → decompose the DAG.
- Builder A (`node-backend`): Item 1 (reconcile — reputation + circuit-breaker + verdict-attestation store).
- Builder B (`node-backend`): Item 2 (secret-scrub — new helper + lesson-capture + arm-loop comment).
- Builder C (`node-backend`): Item 3 (SSRF — `_clone-lifecycle` + `assertGithubRepo` delegate + tests).
- Item 4 (doc decision) + Item 5 (phase-close) are orchestrator-side.

**VALIDATE (post-build, parallel 3-lens over the INTEGRATED diff):** `code-reviewer` + `hacker` (re-probes the BUILT code per Rule 2a — live probes against the scrub + the allowlist, not just the design) + `honesty-auditor` (claim-vs-evidence on the diff + this plan). Fold, full gate (`bash install.sh --hooks --test` + full kernel + lab suites + SIGNPOST), then PR for the USER merge gate.

## Pre-Approval Verification

3-lens VERIFY board (read-only personas, parallel; 2026-06-19) premise-probed the plan against current `main`.
**Verdicts:** architect **FLAG** · code-reviewer **NEEDS-REVISION (2 HIGH)** · hacker **FLAG (1 HIGH)**.
All load-bearing premises (cited `file:line`, the two collapsed no-ops, the `||raw` null-policy, the two-site-sha + hash-ordering invariants, the SSRF parser-differential ordering, the caller-override precedent, the 6 `assertGithubRepo` regression tests) re-confirmed firsthand. Every finding folded BELOW; the revised plan clears all HIGHs.

| ID | Lens | Sev | Finding | Resolution (folded) |
|---|---|---|---|---|
| F1 | code-reviewer | HIGH | Item 1c normalized only the input → H-1 **false-fire** on legacy `13-node-backend` rows | Item 1c redesigned: normalize **both sides** of the H-1 comparison; **no stored-value change**. Coexistence + Test-13 tests added. |
| F2 | code-reviewer | HIGH | scrub "mirror EXACTLY" omits the 4 `SCRUBBER_ONLY_PATTERNS` | Item 2a: shared `getScrubberOnlyClasses()` in `secret-patterns.js`, consumed by both `spawn-record` + `scrub-lab-secrets`. |
| H1 | hacker | HIGH | (same as F2) canonical-only scrub leaks `sk-proj-`/bare-`sk-`/URL-pw/`aws_secret_access_key=` into a world-readable dir | Item 2a breadth fix + Item 2d `0700` dir-perms on the two lab-state sites. |
| A1 | architect | MED | Item 1c mis-framed as "defense-in-depth"; real job is the H-1 fix | Re-framed in 1c; rationale = prevent the latent H-1 false-fire. |
| F3 | code-reviewer | MED | DRY collapse leaves a redundant `assertSafeRepo` double-call at `:365` | Item 3b: explicitly REMOVE the direct call; keep only `assertGithubRepo`. |
| F4 | code-reviewer | MED | `usableFailed` ordering ambiguous; scrub-before-`deriveLesson`? | Item 2b: single `scrubbedCandidate` const feeds `deriveLesson`+`sidecarSha`+`writeCandidate`; `usableFailed` one-site, scrubbed at `:61`. |
| A2 | architect | LOW | delegate is **message-coupled** to 6 tests; https-tighten is global | Item 3b: preserve the 4 message substrings (or update regexes); `http://`-caller probe added (none). |
| A3 | architect | LOW | make two-site-sha structural; assert enum-class stability | Item 2b single-const; Item 2c A3 stability test. |
| A4 | architect | LOW | Item 1a changes emitted `row.persona` → CLI `--persona` filter could mismatch | Item 1d: canonicalize the CLI filter token. |
| F5 | code-reviewer | LOW | circuit-breaker dedup-key shift untested | Item 1b: F5 dedup test added. |
| M1 | hacker | MED | the fail-soft fallback leaves off-roster numbered/bare fragmentable | Item 1 accepted-residual note + coexistence test; total close (record-time roster enforcement) explicitly out of scope. |
| L1 | hacker | LOW | `github.com:<port>` permitted (hostname strips port) | Item 3 L1 spec note (intentional; benign). |

**Board conclusion:** no CRITICAL; the two HIGHs (F1, F2/H1) are clean, well-scoped fixes now folded. The SSRF guard ordering PASSED every parser-differential probe the hacker ran (suffix/prefix/trailing-dot host, credential-`@`, backslash differential, IPv6, hex-IP, IDN/punycode, control chars, non-https; env resolver fails-SAFE on every malformed env). Plan is **build-ready** pending USER approval.

## Build + VALIDATE result

**Built** (TDD, 3 parallel `node-backend` builders in an isolated worktree off `origin/main`@`98ae2cc`, after the concurrent #361 minter merge). **Gate:** `install.sh --hooks --test` **125/0** · full kernel **81/81** · full lab **81/81** (eslint, markdownlint, SIGNPOST drift, contracts all clean).

**A real gap the build caught (query-side bypass):** the full-suite run failed `cross-store-loop.test.js` — surfacing that the reconcile canonicalized the breaker *projection* (`personaOfVerdict`) but NOT the `evaluate()` *query*, so `evaluate({persona:'13-node-backend'})` would miss the canonicalized records and report a false "clear" — a **query-side bypass of a halt** (the same laundering lever on the read API). Fixed: `evaluate()` now canonicalizes its query persona (`circuit-breaker/project.js`), with a dedicated bypass test (`verdict-source.test.js` #12: a halted on-roster persona trips under BOTH the numbered + bare query) + the cross-store assertion that numbered/bare resolve identically. (Rule-2a-corollary: the per-builder scope's green tests didn't probe this; the full suite did.)

**Post-build 3-lens VALIDATE** (parallel; hacker ran live probes against the BUILT code per Rule 2a):
- **code-reviewer → PASS** (no findings): spawn-record refactor behavior-preserving (5 classes, fresh `/g`); lesson-capture single-const two-site-sha + hash-ordering correct; reconcile consistent + fail-soft `||raw`, no frozen-row mutation; SSRF ordering + delegate + removed double-call correct.
- **hacker → PASS** (1 LOW): 21 SSRF payloads + 9 env perms + 16 secret classes + 10 evasions + reconcile probes — no bypass, no surviving secret, scrub provably precedes the content-hash AND sidecar sha, query-canon closes the halt-evasion. **H1 (LOW, folded):** `mkdirSync(mode)` is a no-op on a pre-existing dir → added an explicit `chmodSync(0o700)` after the mkdir at `candidate-sidecar.js` + `recall-graph-store.js` (+ a tightening test), so the Item-2d amplifier is real on a loose pre-existing leaf.
- **honesty-auditor → PASS / Grade A**: every plan item + folded VERIFY finding present in the BUILT code with a real (non-tautological) backing test; the "behavior-preserving" + "~no-op migration" claims SUPPORTED. **W4d-H-03 (LOW, folded):** added a spawn-record-side `scrubSecrets` test for `sk_test_`/`rk_test_`/coarse `sk-`/aws-secret-assign so an SSOT regression is caught consumer-side too.

**NIT plan-prose drifts the auditor flagged (acknowledged; code + tests are coherent, no code change):** the design prose above predates the build, so a few coordinates drifted from the shipped code — (a) `earned-grounding-run.js` lives in `persona-experiment/` (the Item-3 prose omits the dir); (b) the removed double-call shipped at `:355`, not `:365`; (c) the scrubber-only surface is **5 classes** (Stripe TEST split `sk_test_` + `rk_test_`), not "4"; (d) the A2 message-coupling was satisfied by **updating the 6 test regexes** to the shipped throws (`/host not in the clone allowlist/`, `/repo required/`), the plan's own stated alternative, not by preserving the original substrings. These are documentation coordinates only — the delivered code/tests agree.

**Status: VALIDATED — build-ready for the USER merge gate.** Next: `/phase-close ③.1` after merge.
