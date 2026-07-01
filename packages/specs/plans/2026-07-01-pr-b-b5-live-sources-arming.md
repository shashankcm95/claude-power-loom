---
lifecycle: persistent
---

# PR-B B5 — the Rubicon: the deploy-gated `LIVE_SOURCES` flip + custody-key-mandatory arming (ships DARK)

Status: pre-build (plan → VERIFY board → TDD build → VALIDATE → PR). Date 2026-07-01. Branch off fresh `origin/main` (`eeaf6c4`, B4 merged). The final PR-B wave. Autonomous-SDE gap-map **item 5** — the FIRST place a lab-derived weight can gate a REAL substrate decision.

> **The wave that builds the crossing, but does NOT cross.** B5 ships the ARMING MECHANISM for the world-anchored HARDEN gate. It stays **dark on every box — including this deployed one** — until an operator sets a STRICT arming flag AND the deploy-provisioned custody keys resolve. No production change on any un-armed box. #273 NARROWS (mechanism complete); it CLOSES only on a DEPLOYED + ATTESTED cross-uid broker actually signing live edges (OQ-NS-6 ceiling: only accumulated real merges HARDEN trust — no code closes that).

## 0. Runtime Probes (recon re-probed firsthand against HEAD `eeaf6c4` — the scope §3 has DECAYED)

The scope doc (`research/2026-06-30-pr-b-rubicon-scope.md` §3 B5) was written 2026-06-30 against `c04f519`, BEFORE B2/B3/B4 were built. Re-probing the actual merged state:

| Claim | Probe | Result |
|---|---|---|
| B2 already refuses-on-absent-key | `admit-world-anchor-node.js:100` | `if (!isNonEmptyString(o.edgeVerifyKey) \|\| !isNonEmptyString(o.brokerVerifyKey)) return refuse('no-verify-key')` — YES, the consumer already owns this gate |
| B2 already enforces `commitment_verified===true` + excludes OQ3-5 grandfather | `admit-world-anchor-node.js:154-176` | Steps 5-7: `loadMergeOutcome(jkid)` (grandfather `''` derives a different jkid → null → excluded structurally); `outcome.lesson_commitment !== lc` → refuse. YES, already done |
| The mint should stay observable-SHADOW-skip, NOT flip to refuse-on-absent | `world-anchor-mint.js:47-54` | Header: "the fail-closed boundary correctly lives at the CONSUMER (PR-B)… When NO verifyKeyPem is supplied… the mint proceeds un-authenticated SHADOW BUT emits". PR-A2a F-CR1 already closed present-but-invalid. **Scope §3 bullet 2 is DECAYED — no mint change.** |
| B3 recall CLI resolves NO keys today | `world-anchored-recall-cli.js:41-42` | `retrieveWorldAnchoredInstincts(query, {})` — no keys → `no-verify-key` → mock → empty. This is the surface B5 arms. |
| B3's `admitWeightForRanking` has NO injection seam (frozen-empty default) | `world-anchored-recall.js:91-95` | `admittedWeight(item)` calls the gate with NO opts → frozen `LIVE_SOURCES`. The flip MUST be the module constant, not an opts injection (B3 CRITICAL closed that). |
| This box has BOTH custody keys deployed (the scope's "dev box has no key" assumption FAILS here) | `stat /etc/loom/{edge-verify,verify}.pem` | `edge-verify.pem` root:wheel 0644; `verify.pem` root:wheel 0644 — BOTH present + root-readable. **B5 must gate key RESOLUTION behind the flag, or this box would not ship dark.** |
| `verify.pem` is the APPROVAL broker key; `edge-verify.pem` is the edge-signer key | `approve-cli.js:180`; `weight-gate-rfc-arc` deploy note | `verify.pem` = broker(610) approval verify key → `brokerVerifyKey`; `edge-verify.pem` = edge-signer(612) → `edgeVerifyKey` |
| Canonical ownership-vetted key reader to mirror | `approve-cli.js:194 readVerifyKeySafe` | O_NOFOLLOW + fstat-the-fd + owner=operator-or-root + not-group/world-writable. NOT exported → B5 mirrors it lab-side |
| Standing records → armed run still empty (non-vacuous "mechanism live, still dark" dogfood) | `node -e listLiveNodes/listWorldAnchorEdges` | 2 live nodes, **0 world-anchor edges** → admission fails step 1 `no-authenticated-edge` even armed |
| No dam constrains the CLI reading `/etc/loom/*.pem` via fs | `shadow-import-graph.test.js:64-192` | The dams (`LIVE_IMPORT_RE`/`EDGE_IMPORT_RE`/`READER_CALL_RE`) constrain world-anchor STORE imports only; a custody-key fs read in the CLI opens no dam |
| STRICT vs LENIENT parse pair | `host-claude-guard.js:69 normalizeBool` (STRICT) / `:82 isDeployFlagSet` (LENIENT) | ARM direction uses STRICT (a typo → false → dark); LENIENT is misconfig-detect only |

## 1. The corrected B5 delta (three deliverables, all deploy-gated dark)

**The security model (unchanged from scope §2, but the flag now also gates key resolution):** a world-anchored weight moves a real ranking ONLY when ALL hold — (1) the STRICT arming flag is set; (2) the custody edge+broker verify keys resolve from the pinned `/etc/loom/*.pem` (`allowEnvFallback` never — direct pinned-path read, ownership-vetted); (3) B2's full-tuple crypto verify passes (`commitment_verified`, signed-edge membership, unique join). The flag is a STRICT belt; the crypto is load-bearing. On this box (keys present) the flag is what keeps it dark; on CI/clean-dev the absent keys ALSO keep it dark (two independent gates).

### D1 — `weight-source-gate.js`: flag-gated `LIVE_SOURCES` flip (the belt)
- Today: `const LIVE_SOURCES = Object.freeze([]);` (`:37`).
- B5: `LIVE_SOURCES` becomes the reviewed frozen literal `['world-anchor']` **iff** the STRICT arming flag `LOOM_WORLD_ANCHOR_ARM` is set at module load; else frozen `[]`. Frozen either way (the `Object.freeze([])`-not-`Set` immutability invariant preserved). A typo/unset → `[]` → dark (STRICT fail-closed for ARM).
- The token is a reviewed literal `'world-anchor'` (matches the gate header `:34` "SHIP A NEW frozen literal" intent). A test pins it byte-equal to `WORLD_ANCHOR_SOURCE` (the single source of truth in `world-anchor-edge-store.js:62`) so the two can never drift — WITHOUT a cross-dir import into the pure gate.
- **Open design Q for the board (Q-FLIP):** where the module-load STRICT arming read lives. Option (a) inline strict-parse in `weight-source-gate.js` (updates its "PURE: no I/O" header to "pure compute + one module-load arming read"); option (b) a tiny factored arming helper the gate imports. Lean (a) with a parity test against `normalizeBool`. The board decides.

### D2 — `world-anchored-recall-cli.js`: flag-gated custody-key resolution (the load-bearing gate)
- Today: passes `{}` (no keys).
- B5: `const armed = normalizeBool(process.env.LOOM_WORLD_ANCHOR_ARM)`. **Un-armed → pass `{}` (byte-identical to today → dark).** Armed → resolve `edgeVerifyKey` from `/etc/loom/edge-verify.pem` + `brokerVerifyKey` from `/etc/loom/verify.pem` via a NEW ownership-vetted lab reader (mirrors `readVerifyKeySafe`: O_NOFOLLOW, fstat-the-fd, owner∈{self,root}, reject group/world-writable, regular-file). A resolve failure (absent/unreadable/wrong-owner/symlink) → that key is `undefined` → `admitWorldAnchorNode` refuses `no-verify-key` → mock → dark (refuse-on-absent). **NEVER reads `process.env.LOOM_EDGE_VERIFY_KEY`** (the `edge-attestation.js:74` self-pwn surface stays absent).
- **The flag gates the resolution ATTEMPT, never substitutes for the crypto** — even armed, an absent/invalid key refuses. STRICT flag so a typo → un-armed → dark. This is why gating resolution behind the flag does NOT reintroduce the scope §2 lenient-flag-fails-open bug (that was `isDeployFlagSet` deriving the admitted SOURCE; here the flag only decides whether to READ the pinned key, and the crypto verify is still the boundary).
- New module `packages/lab/world-anchor/custody-verify-key.js` (`resolveCustodyVerifyKey(path, selfUid) -> string|null`, fail-closed, never throws) — unit-testable, reused for both keys.

### D3 — the load-bearing test matrix (per scope §3: "the test matrix proving the gate stays closed is the load-bearing part")
On THIS box the key IS present, so the critical proof is **"armed-or-not, the gate stays dark when a precondition is missing"** — non-vacuous here because the keys are real:
- flag UNSET + keys present → CLI passes `{}` → dark (the belt holds on a deployed box).
- flag SET + keys present + **0 signed edges** (real disk state) → `no-authenticated-edge` → dark (mechanism resolves REAL keys, still dark — the Rule-2a-corollary real-path dogfood).
- `LIVE_SOURCES` frozen-`[]` when unarmed; frozen-`['world-anchor']` when armed; immutable (push/add throws) in both.
- The OQ3-5 grandfather (`lesson_commitment=''`) never admits through the full recall path even when armed with real keys (B2 structural exclude, re-proven end-to-end).

## 2. What B5 does NOT do (scope-decay + explicit non-goals)
- **No mint change** (D-probe: the consumer owns refuse-on-absent; the mint's observable-SHADOW-skip is deliberate). **Honest framing (VALIDATE honesty-auditor MED):** scope §3's "flip the mint to refuse-on-absent" was **DECLINED, not "already done"** — the mint (`world-anchor-mint.js:417-421`) STILL mints un-authenticated shadow records + emits `world-anchor-mint-unauthenticated` un-armed; the fail-closed boundary is the **B2 ADMISSION consumer** (+ the CLI un-armed `{}`), never the mint. The item-8 builder must NOT wire a consumer that trusts the mint's output as pre-filtered.
- **No new `commitment_verified` enforcement** (B2 already owns it; B5 only tests it end-to-end).
- **No dam relaxation** (B3 already opened the single-consumer exemption; the CLI's fs key-read opens none).
- **Does NOT cross into LIVE on this box** — the flag is unset; MECHANICS FREEZE pre-live (the beta mandate).
- **Does NOT close #273** — same-uid co-forge survives; closes only on a DEPLOYED+ATTESTED cross-uid broker signing live edges + the arming wave (gap-map item 8). B5 is mechanism.
- **Does NOT arm the live loop** (item 8, separate wave).

## 3. TDD test list (write first; the failing set is the behavioral contract)

`tests/unit/lab/causal-edge/weight-source-gate-arming.test.js` (NEW):
- unarmed (flag unset / '' / '0' / typo 'ture') → `LIVE_SOURCES` deep-equals `[]`, frozen, `admitWeightForRanking({source:'world-anchor',weight:1})===0`.
- armed (`1`/`true`/`yes`/`on`) → `LIVE_SOURCES` deep-equals `['world-anchor']`, frozen (push throws), `admitWeightForRanking({source:'world-anchor',weight:1})===1`; a `'mock'` source still 0.
- the arming token equals `WORLD_ANCHOR_SOURCE` (byte-parity pin, no drift).
- parity: the inline strict parse matches `normalizeBool` across the arming token space (if Q-FLIP=inline).
- (module-load env is read via a subprocess or `delete require.cache` re-require harness.)

`tests/unit/lab/world-anchor/custody-verify-key.test.js` (NEW):
- absent path → null; empty/non-string path → null; a symlink → null (O_NOFOLLOW); wrong-owner (synthetic fixture) → null; group/world-writable → null; a valid regular self/root-owned file → its contents. Never throws.

`tests/unit/lab/causal-edge/world-anchored-recall-cli-arming.test.js` (NEW):
- unarmed → the CLI invokes `retrieve` with `{}` (no keys) → SHADOW-empty (spy/subprocess).
- armed + injected fixture key dir → resolves both keys + threads them.
- armed + missing key file → that key undefined → refuse path → empty (never throws).
- REAL-KEY dogfood (this box, VALIDATE): `LOOM_WORLD_ANCHOR_ARM=1` subprocess resolves the real `/etc/loom/*.pem` and still yields empty (0 edges) — mechanism live, output dark. Guard with a skip when the files are absent (CI).

`tests/unit/lab/causal-edge/world-anchored-recall.test.js` (EXTEND): end-to-end armed-with-fixtures → a fully-admitted node surfaces ONLY when LIVE_SOURCES armed AND keys resolve AND commitment verifies; the grandfather never surfaces.

## 4. HETS Spawn Plan

Routing: `route-decide` returned `root` on a `stakes` lexicon miss (substrate-meta catch-22, `[ROUTE-META-UNCERTAIN]` class) — escalated to a full board by JUDGMENT per `route-decide.js:11-13` and workflow Rule 2 (this is the highest-stakes kernel/security SHADOW→LIVE-mechanism diff of the whole arc).

- **VERIFY (pre-build, read-only 3-lens, parallel):** `architect` (design soundness of the two-independent-gates model + Q-FLIP) + `code-reviewer` (correctness/immutability/fail-closed seams) + `hacker` (adversarial: can an un-armed box admit? can a lenient-token arm it? can the key-read be redirected/symlinked/env-faked? can a co-forged node surface?). Free-text findings (avoid the StructuredOutput retry-cap SCAR).
- **Build:** delegated `node-backend`, `isolation:worktree`, TDD (tests first, RED, then impl).
- **VALIDATE (post-build, Rule-2a, 3-lens):** `hacker` LIVE probes against the BUILT code + the real-key dogfood (armed subprocess, real `/etc/loom/*.pem`, still-dark proof) + `code-reviewer` + `honesty-auditor` (no over-claim of #273/LIVE).
- **Rule 4:** record the VALIDATE board verdicts into the Lab verdict-attestation store IF the build was delegated (subject = the builder spawn `agentId`).

## 5. #273 status after B5-merge (honest)
NARROWS to "mechanism-complete; the world-anchored HARDEN gate exists and is armable." CLOSES the same-uid co-forge leg only when a DEPLOYED + ATTESTED cross-uid edge broker actually SIGNS live edges (conds 2+3 satisfied for the KEY; the signing is the arming wave) AND the loop is armed (item 8). Per OQ-NS-6, B5 does NOT touch the trust ceiling — only accumulated real merges through a live gate HARDEN trust, and no code closes that. B5 must not claim otherwise.

## Runtime Probes
(All in §0 above — inline `Probe → result` table. No un-probed runtime/harness claim in this plan.)

## Arming contract (architect MED-2 — the two-flag AND for gap-map item 8)
The world-anchored HARDEN admits a weight ONLY when BOTH deploy flags are set (independent gates, documented at both read sites):
- `LOOM_EDGE_REQUIRE_UID_SEP` (B1, `edge-signer-resolve.js:39`) — arms the MINT signer ROUTING, so real cross-uid SIGNED edges exist.
- `LOOM_WORLD_ANCHOR_ARM` (B5, new) — arms the weight ADMISSION (the `LIVE_SOURCES` flip + custody-key resolution).
A box with only `LOOM_WORLD_ANCHOR_ARM=1` + no signed edges is dark-by-evidence (`no-authenticated-edge`). Item 8 (the live loop) does not re-derive this; it sets both on a deployed+attested box.

## Pre-Approval Verification (3-lens VERIFY board, 2026-07-01)

**Board:** architect NEEDS-REVISION (2 HIGH DRY-on-security, 2 MED, 1 LOW) + code-reviewer NEEDS-REVISION (0 CRIT, 2 HIGH, 3 MED, 2 LOW) + hacker **SHIP** (0 CRIT, 2 HIGH build-contract, 3 MED, 1 LOW; 6 live probes, 0 bypasses). Strong cross-lens convergence. All folds below.

| # | Lens(es) | Sev | Finding | Fold |
|---|---|---|---|---|
| 1 | architect / reviewer / hacker | HIGH | Two independent flag reads (D1 gate + D2 CLI) = split-brain divergence seam; hand-rolled parser risk | **FOLDED** — new `lab/_lib/world-anchor-arming.js` → `isWorldAnchorArmed()` (reuses blessed STRICT `normalizeBool`), the SINGLE source; both D1+D2 consume it |
| 2 | reviewer / hacker / architect | HIGH | New custody reader must FAIL-CLOSED on `selfUid===null` (not copy `readVerifyKeySafe`'s accept-on-skip — B5 has no downstream owner re-verify) | **FOLDED** — `resolveCustodyVerifyKey` fails closed on null uid; explicit test |
| 3 | architect | HIGH | Don't "mirror" `readVerifyKeySafe` (copy-paste security FS guard = DRY-drift); extract to shared `kernel/_lib`, rewire approve-cli | **PARTIALLY FOLDED (reasoned)** — standalone lab reader + full independent security tests (all 5 fd-checks) + a cross-ref header naming the one deliberate difference. **Declined the approve-cli extract** to keep the LIVE kernel-egress approval path frozen (MANDATE: MECHANICS FREEZE pre-live; minimal blast radius on a pre-live wave). Drift-weakening is caught by the lab copy's own security tests. Extraction stays a cheap follow-up if VALIDATE/USER prefers. |
| 4 | hacker | HIGH | New resolver must NEVER read `process.env.LOOM_EDGE_VERIFY_KEY` (the `edge-attestation.js:74` self-pwn) | **FOLDED** — reads ONLY the pinned path via the fd reader; test: env key set + pinned absent → dark |
| 5 | reviewer / architect / hacker | MED | Arming tests via `delete require.cache` are leak-prone (sticky module-load env) | **FOLDED** — subprocess harness (`spawnSync` with `env:`) for all arming tests |
| 6 | reviewer | MED | Resolve both keys independently (never short-circuit); let B2's dual-refuse AND-gate | **FOLDED** — two unconditional `resolveCustodyVerifyKey` calls; test: one-present-one-absent → clean refuse |
| 7 | reviewer | MED | Reader returns RAW string (no PEM validation — that's B2/kernel's crypto job) | **FOLDED** — ownership/symlink/perm only; test: garbage-but-readable owned file → raw string |
| 8 | hacker / architect | MED/LOW | Hard-constant paths — no `--key-path`/`--key-dir` flag; pin `/etc/loom/*.pem` as CLI consts | **FOLDED** — literal path consts at the CLI composition root; test: no arg/env redirects the path |
| 9 | hacker | MED | STRICT `normalizeBool` gates BOTH D1+D2; `isDeployFlagSet` only for a misconfig emit | **FOLDED** — `isWorldAnchorArmed()` is STRICT; a `world-anchor-arm-misconfigured` stderr emit on a typo (never-fail-silent) |
| 10 | hacker | MED | Preserve closure-over-internal-`const` immutability (isLiveSource reads the const, not the export) | **FOLDED** — flip binds the internal `const`; test: reassigning `gate.LIVE_SOURCES` does not change `admitWeightForRanking`, push throws in both arms |
| 11 | reviewer | LOW | Grandfather real-key dogfood can't distinguish "no edges" from "grandfathered" (both empty) | **FOLDED** — tighten prose; the fixture test proves the OQ3-5 exclude; the dogfood proves key-resolution + zero-edge refusal |
| 12 | hacker | LOW | Env inherits into the B3 subprocess (by-design; the operator's arm flag must reach the CLI) | **NOTED** — documented as intended, not an oversight |

**Verdict: cleared to build** (hacker SHIP; the two reviewers' NEEDS-REVISION are precision folds, all resolved above — no design defect). The one reasoned divergence (fold #3) is documented for USER/VALIDATE review.

## VALIDATE result (3-lens board, 2026-07-01 — post-build, Rule-2a)

**Board: unanimous SHIP on the code.**
- **hacker (Rule-2a live probes): SHIP** — 15 probe families / ~60 hostile inputs against the BUILT diff on this deployed box (real `/etc/loom/*.pem`), **0 bypasses**. Dark-by-default held (keys present + flag unset → 0 instincts); every hostile flag token (`ture`/`0x1`/`[object Object]`/`2`/`-1`/…) stayed dark (STRICT); the key reader closed symlink/FIFO(no-hang)/wrong-owner/null-uid/world-writable + stayed env-blind; M3 export-reassign never reached the closure; armed-on-box = mechanism LIVE (both real keys resolved, `LIVE_SOURCES=['world-anchor']`) yet dark (`no-authenticated-edge`, 0 signed edges); #273 adds NO new co-forge surface (an attacker keypair verifies only against its own pubkey, not the pinned root-owned custody key); no `build-spawn-context.js` diff (the render sink is untouched).
- **code-reviewer: SHIP** — 0 CRIT/HIGH/MED, 4 LOW (all probed + cleared). fd always closed (live 2000+500-iter fd-stress, steady count); frozen-either-way + closure-over-internal-const; un-armed byte-identical (`git log --follow -p`); both keys resolved independently; misconfig→stderr-only; tests non-vacuous (subprocess module-load + real dogfood). Judged the standalone-reader fold (#3) **defensible**; recommends the kernel-egress extract as a post-freeze follow-up (chip-tracked).
- **honesty-auditor: code SOUND to merge SHADOW** (Grade B; NEEDS-REVISION on **documentation only**, all folded): (a) the plan now travels with the branch [HIGH-1 resolved]; (b) §2 sharpened — the mint-flip was DECLINED, not "done"; refuse-on-absent lives at the consumer; (c) the stale `admit-world-anchor-node.js:19` "PR-B3 (the Rubicon)" label refreshed to PR-B5.

**Named honest residual (honesty claim-5, by necessity):** no test exercises a REAL signed-edge → B2 admit → positive weight on live data, because no real signed world-anchor edge exists yet (the signer is deployed but no real merge has minted one). The positive-admit path is proven at unit-composition (`world-anchored-recall-arming-composition.test.js`, synthetic source injection) + B2's own admit suite; the real-key dogfood proves key-resolution + still-dark. The real signed-edge → positive-weight leg is the arming wave's (item 8) territory.

**Local gates:** 36 new tests (5 suites) + regression (kernel 109 / lab 120 suites) all green; eslint 0; signpost regenerated + clean; markdownlint clean; new source ASCII-clean. Built root (not delegated) → Rule 4 records nothing (only a delegated builder spawn is a legal subject).
