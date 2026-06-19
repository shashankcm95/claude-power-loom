# Plan — v-next Minter M-1: opt-in freshness window (SHADOW, default-off)

- **Date:** 2026-06-19
- **Wave:** v-next, follow-on to the authenticated-minter P0 (PR #360, merged `2757654`).
- **Worktree:** `claude-toolkit-worktrees/minter-m1-freshness` on `feat/vnext-minter-m1-freshness` — isolated from the other session's shared checkout.
- **Scope:** add an **opt-in** freshness window to `verifyMintedWeight`. **Default-off → SHADOW preserved** (no behavior change for any current caller; nothing gates). Reserves the P2 stale-mint-replay defense as a real, tested capability.

## Why (provenance — design pre-vetted, no new VERIFY board)

The P0 VALIDATE hacker **proved** the stale-mint replay (finding **H4 / M-1**, `/tmp/probe7`): `minted_at` is signed (inside `minted_id`, so it is tamper-evident) but **nothing checks it against a now-window**, so a genuinely-minted weight verifies forever. Inert in SHADOW (nothing gates), but once a value gates (P2) a captured favorable mint replays past a later demotion. The P0 board prescribed the fix verbatim: *"the P2 consumer-flip MUST enforce a freshness window OR a policy re-run."* This wave lands the **freshness window** half as an opt-in capability so P2 can simply turn it on. The design was already vetted at P0 — this is the prescribed implementation, so a fresh architect/hacker VERIFY board is skipped; the post-build 3-lens VALIDATE still runs (Rule 2, kernel-security).

## Runtime Probes (firsthand, against the merged P0)

| Claim | Probe | Result |
|---|---|---|
| `minted_at` is signed (tamper-evident), so a freshness check reads an authenticated field | P0 `verifyMintedWeight` re-derives `minted_id` (incl. `minted_at`) + verifies sig | Confirmed — tampering `minted_at` already → false (P0 test "tampering any signed field"). |
| A legit mint always has a parseable ISO `minted_at` | P0 mint sets `minted_at = opts.now (trimmed, non-blank) || new Date().toISOString()` (CR-3 fold) | Confirmed — `Date.parse` succeeds; a hand-crafted garbage `minted_at` (e.g. the test sentinel `'t'`) → `NaN` → fail-closed. |
| No current caller passes `maxAgeMs` | grep: the minter has no production caller at all (P0 F4) | Confirmed — default-off is a true no-op for every existing path. |

## Design — `verifyMintedWeight(weight, { maxAgeMs, nowMs })`

Inserted **after** the sig check (freshness applies only to an authentic weight — `minted_at` is only trustworthy once the sig verifies):

- `opts.maxAgeMs === undefined` → **no freshness check** (current behavior; SHADOW default; the no-op path).
- `opts.maxAgeMs` present → **enforce, fail-closed**:
  - `maxAgeMs` must be a positive finite number, else `false` (a garbage knob must **not silently disable** the check — RFC §5.5 "no silent downgrade").
  - `nowMs` = `opts.nowMs` (finite number) else `Date.now()`; a non-finite injected `nowMs` → `false`.
  - `mintedMs = Date.parse(minted_at)`; non-finite → `false` (unparseable signed field).
  - Accept iff `minted_at` is within a **symmetric** window of now: `|nowMs - mintedMs| <= maxAgeMs` — rejects both a **stale** mint (too old → replay) and an **implausibly-future** mint (clock-skew bound), while tolerating small skew. Else `false`.
- Sig invalid → `false` regardless (unchanged). NEVER throws (`Date.parse` does not throw; numeric guards are pure).

This is ~12 lines + the JSDoc/header note. The oracle defense, INV-MINT, allowlist, and append-only registry are untouched.

## Non-goals (explicit)

- **NOT** flipping any gating consumer (`evolution-snapshot-read` / `spawn-record` / `circuit-breaker`) — that is the P2 wave and depends on **OQ-2** (the gating-set freeze, still open). This wave only *makes the capability available*.
- **NOT** the policy-re-run alternative (the other half of the P0 prescription) — the freshness window is the lighter, consumer-decoupled half; policy-re-run stays a P2 option.
- No change to mint-side `minted_at` semantics (already correct post-CR-3).

## Test plan (TDD — RED first)

1. Default (no `maxAgeMs`) → a freshly-minted weight verifies true (no behavior change).
2. `maxAgeMs` set + fresh weight (mint `now` == verify `nowMs`) → true.
3. Stale: `nowMs` = mint time + 2×maxAgeMs → **false**.
4. Implausibly-future: `nowMs` = mint time − 2×maxAgeMs → **false**.
5. Within-window skew (`|delta| < maxAgeMs`) → true.
6. Garbage `maxAgeMs` (0, negative, NaN, non-number) with an otherwise-valid weight → **false** (no silent disable).
7. Unparseable `minted_at` (a forged weight with `minted_at:'t'`) + `maxAgeMs` → **false**; never throws.
8. Freshness does NOT rescue a bad sig (stale window irrelevant if sig invalid → false).

## VALIDATE (post-build, Rule 2 — kernel-security)

3-lens parallel on the diff: `code-reviewer` (correctness, the symmetric-window + fail-closed completeness), `hacker` (live-probe: can freshness be bypassed? does default-off truly preserve SHADOW? clock-skew abuse? `Date.parse` quirks / locale strings?), `honesty-auditor` (is it really default-off/no-op for current callers + fail-closed on the garbage-knob path; does it match the M-1 prescription).

## VALIDATE result (2026-06-19 — 3-lens board, ALL APPROVE / APPROVE-WITH-NITS, 0 blockers)

`code-reviewer` + `hacker` (5 live probes) + `honesty-auditor` (grade **A, NO-OVERCLAIM**). Core contract held under live probing: default-off is byte-identical to P0, every garbage `maxAgeMs` (12 variants) + non-finite `nowMs` fail-closed, sig runs strictly before freshness, SHADOW preserved. **Folded (all in this diff + tests, 29/29):**
- **H1 (hacker, MED) — TZ-ambiguity:** `Date.parse` interprets a tz-less `minted_at` in the *verifier's* local zone (reproduced an 8h swing). Closed at BOTH ends via a canonical-UTC round-trip guard (`isCanonicalUtcIso`): mint refuses to SIGN a tz-ambiguous `opts.now` (falls back to canonical now), and the freshness block rejects a non-canonical `minted_at` fail-closed. Honest mints are always canonical (`new Date().toISOString()`).
- **M1-T1 (reviewer, MED) — vacuous test:** the "unparseable minted_at" case fired on the bad sig (`'AAAA'`), never reaching the `Date.parse` guard. Now uses a `signWeight()` helper (valid sig over a garbage/tz-less `minted_at`) so the guard is genuinely exercised.
- **M1-N1 (reviewer, LOW):** pinned the inclusive boundary (`delta == maxAgeMs` → true; `+1` → false) + JSDoc.
- **H2 (hacker, LOW) — naming:** the symmetric window's effective span is `2*maxAgeMs`. Kept symmetric (code-reviewer endorsed it over one-sided — it also rejects implausibly-future mints) but documented the `±maxAgeMs` span in the JSDoc so a P2 caller sizes it correctly. Knob-split (a separate small forward-skew bound) deferred to P2 if it needs a tight one-sided age.
- **honesty H2 (LOW):** JSDoc tightened to "non-positive/non-finite `maxAgeMs`".

**P2 reminder (honesty H3):** the M-1 header note's "inert — nothing gates" parenthetical is enforced by the F4 SHADOW grep-test; when P2 wires a gating consumer it MUST turn on `maxAgeMs` (or a policy re-run) in the same commit.

## Drift Notes

- Scaled the ceremony: skipped the pre-build VERIFY board because the design was *already* adversarially vetted at P0 (H4 proof + explicit prescription). Kept the post-build 3-lens VALIDATE (kernel-security is non-negotiable per Rule 2). Noting the scaling decision, not a gap.
