---
lifecycle: persistent
status: BUILT + VALIDATED — PR #447 (awaiting USER merge)
phase: ③.2 autonomous-SDE ladder — basis-strengthening (re-scoped from PR-A2)
routing: route (kernel egress chokepoint; security/data-mutation diff)
---

# The egress join-key (gap-map item 1) — anchor the world-anchor basis to the kernel egress emission

## Problem

The autonomous-SDE ladder's "strengthen the basis first" choice resolves to a **skipped
prerequisite**, not the cross-uid signer (the original "PR-A2").

**Condition → Failure mode → Resolution:**

- **Condition.** A `world-anchored-by` edge binds a `world_anchored` node → `to_delta_ref =
  att.diff_hash`. Today `att.diff_hash = sha256(local diff-file bytes)` ([cli.js:243](../../lab/world-anchor/cli.js:243)),
  content-sealed into the attestation but **lab-computed**. `record-merge` takes
  `--merge-sha` as an **operator-supplied CLI arg** ([cli.js:101](../../lab/world-anchor/cli.js:101)),
  not gh-verified in-process. The whole merge-observer chain is same-uid forgeable.
- **Failure mode.** Even a deployed cross-uid signer would sign over a **lab-asserted value**:
  it narrows *who can forge a signature* but not *whether the bound value is trustworthy*. An
  allowlisted same-uid caller could bind a node to an arbitrary `diff_hash`. The basis is
  integrity-sealed, never provenance-authentic.
- **Root cause (the dependency inversion).** The gap-map's bridge plan is dependency-ordered
  ([gap-map:141-155](../research/2026-06-25-autonomous-sde-lifecycle-gap.md)): **item 1 (the
  egress join-key) is the named prerequisite for item 2 (the record-merge observer)**, and the
  gap-map calls it "the Prerequisite for every world-anchored signal" / the "[BLOCKER] Stage 6 →
  Stage 5" gap. #439 built **item 2 without item 1** — the lab-side `resolveAnchorForPr` join
  ([world-anchor-store.js]) plus the observer, but its `emit-pr.js` change was **doc-only**
  (commit 2f1ab38 body: "Doc-only emit-pr.js stale-comment cleanup"). So the observer joins on a
  lab-backfilled attestation, never on what the kernel egress actually emitted.
- **Resolution.** Build the skipped item 1: `emitPR` (the kernel egress chokepoint) persists a
  **kernel-authoritative join-key** at emit-success, sealing the PR identity to
  `approvalHash = computeEmissionHash(draft)` — the content-address of *exactly the bytes that
  shipped* under a valid broker-signed human approval. A later merge-observer (PR-2) joins on
  this instead of the lab backfill, so the world-anchor basis becomes provenance-anchored to the
  approved egress emission rather than a free-floating local-file hash.

**MEMORY status correction (status-decay).** MEMORY records "item 1 DONE (#439 join-key)". That
conflates the **lab-side join** (`resolveAnchorForPr`, built) with the gap-map's **kernel egress
join-key** (NOT built). The kernel-authoritative anchor was never written. (Update MEMORY at PR.)

## Scope — this is PR-1 of a re-scoped mini-arc

- **PR-1 (this plan).** The kernel egress join-key: a fail-closed verify-on-read join store +
  `emitPR` writes the join-key at emit-success (additive, non-reverting). SHADOW — no consumer
  reads it yet; moves trust zero.
- **PR-2 (next).** The lab merge-ingress joins on the egress join-key: `record-merge` /
  `resolveAnchorForPr` looks up the join-key by `pr_url`, binds the edge's `to_delta_ref` to the
  kernel `approvalHash`, and **fail-closed refuses** a merge with no matching join-key (an
  un-emitted-by-us PR is not world-anchorable).
  - **Forward-contract caveat (VERIFY Q4).** That fail-closed refuse is a real BEHAVIOR CHANGE (not
    shadow) and would **orphan the one existing live node `ca648110`** — its backfill-2137 attestation
    ([cli.js:237](../../lab/world-anchor/cli.js:237)) was written with NO kernel join-key. PR-2 must
    either re-emit #2137 through the kernel egress to mint a real join-key, OR carry a documented,
    narrow legacy-exemption for the pre-join-key attestation. Flagged HERE so PR-1's basis-strengthening
    does not silently break the existing live signal. Out of PR-1 scope; named so PR-2 cannot miss it.
- **PR-3 (deferred — the original cross-uid signer).** Once the basis is kernel-anchored, the
  off-host EDGE-domain signer signs over a *provenance-authentic* value. This is the deferred
  "PR-A2"; it returns AFTER the basis is strengthened.

## Runtime Probes (claims this plan rests on — verified against the repo this session)

| Claim | Probe → observed |
|---|---|
| emitPR holds the content-address of the emitted bytes at success | [emit-pr.js:408](../../kernel/egress/emit-pr.js:408) `approvalHash = computeEmissionHash(draft)`; draft frozen `{repo(normalized), issueRef, title, touched_paths, diff(scrubbed)}` :399-405 |
| emitPR holds gh-assigned PR identity at success | [emit-pr.js:423](../../kernel/egress/emit-pr.js:423) `pr = armedEmitFn(...)`; ghEmit returns `{pr_url: pr.html_url, number: pr.number, branch}` at **both** [gh-emit.js:627](../../kernel/egress/gh-emit.js:627) (normal) AND [gh-emit.js:614](../../kernel/egress/gh-emit.js:614) (dedup-reconcile, `+deduped:true`) |
| the join-key write site is reachable only on a real, approved, broker-signed emit | [emit-pr.js:411-427](../../kernel/egress/emit-pr.js:411) — gated by `disposition.mode==='live' && token && !killswitchOn` AND `readVerifiedApproval(...).ok`; the additive record sites (recordEmit/recordEmitted/consumeApproval) are :424-426 |
| base_sha is known inside the emit but returned by NEITHER ghEmit site | gh-emit `commitMessage` embeds `base-commit: ${baseSha}` [gh-emit.js:398](../../kernel/egress/gh-emit.js:398); `baseCommitSha` resolved ~:509-512; **both** returns (:614, :627) omit it → must thread to BOTH (VERIFY FAIL Q5) |
| the existing fail-closed content-addressed store pattern to mirror | `approval-store.js` (O_NOFOLLOW + fstat-same-fd + size-cap + foreign-uid reject + verify-on-read), hardened across #439/#446 |
| the disposition-key guard to reuse for joinKeyMeta | `DISPOSITION_KEY_SET` [emit-pr.js:181](../../kernel/egress/emit-pr.js:181) (incl. `__proto__`/`constructor`/`prototype`, lowercased); `assertDataIsPolicyFree` :186 |
| #439 emit-pr.js change was doc-only (no join-key) | `git show 2f1ab38 -- packages/kernel/egress/emit-pr.js` run THIS session → comment edits only (firsthand-observed); independently, `grep -rn 'node_id\|lesson_signature\|join_key' packages/kernel/egress` = 0 |
| the gap-map's stale-egress-comment caveat (:20/:39/:51/:352) is ALREADY resolved | verified this session — those lines are current (#439 cleaned them); the honesty-auditor flagged from the pre-#439 gap-map. No comment fix needed in this PR |
| HARNESS/DEPLOYMENT claim (re-probe at deploy, not here) | the join-key is kernel-authoritative *to the degree the egress broker is deployed cross-uid*; same-uid dev = NARROWS not closes (same caveat as the whole trust fractal) |

## Design

### 1. New store: `packages/kernel/egress/join-key-store.js`

Mirrors `approval-store.js` hardening exactly (do not invent a new pattern):

- **Record shape** (closed-set keys, exact-set validated on read). **Field names verbatim to
  `world-anchor-store.js` ATT_FIELDS** ([:71-74](../../lab/world-anchor/world-anchor-store.js))
  so PR-2's join is a field-name-identical lookup, not a rename-map (VERIFY Q3a):
  - **Kernel-authoritative** (the trust core): `repo` (normalized), `issueRef` (positive int),
    `pr_number` (gh-assigned), `pr_url` (gh `html_url`), `approval_hash` (= `computeEmissionHash`,
    HEX64), `base_sha` (HEX40, from gh-emit), `emitted_at`.
  - **Recorded-claim** (orchestrator-supplied provenance metadata, clearly delineated — NOT
    trusted, just recorded): `built_by`. Absent-initially: `node_id`, `lesson_signature` (the
    gap-map's honest caveat: "first merges have built_by/base_sha but no lesson_signature yet").
- `deriveJoinKeyId(rec)` — `sha256` over a canonical IDENTITY basis `{repo, issueRef, pr_number,
  approval_hash}`. **NOTE (VERIFY Q3b): `repo`+`issueRef` are redundant — both are already inside
  `approval_hash` (`computeEmissionHash` over `{repo, issueRef, diff}`); the minimal identity is
  `{pr_number, approval_hash}`.** Kept belt-and-suspenders to mirror the existing store's
  `{repo, issueRef, diff_hash}` basis shape; the redundancy is harmless (a re-emit produces the
  same id either way).
- **`bodiesEqual` fields** (the dedup-collision check): `pr_url` IS in `bodiesEqual` (a divergent
  `pr_url` for the same id is a real conflict → COLLIDE-refuse, fail-closed). `built_by` and
  `emitted_at` are NOT in `bodiesEqual` (recorded metadata; a re-record with new metadata dedups).
  (Mirrors the #446 C2 lesson: only identity-relevant fields gate dedup.)
- `writeJoinKey(rec, {dir, selfUid})` — fail-closed; validates `approval_hash`=HEX64,
  `base_sha`=HEX40, `pr_url` matches the gh PR-URL regex BEFORE write; mkdir 0o700
  **validate-before-mutate** (lstat/symlink/foreign BEFORE chmod — the #446 C1 lesson); never throws.
- `loadJoinKey(id, {dir})` — addresses BY the derived id; full verify-on-read:
  `O_NOFOLLOW|O_NONBLOCK` + fstat-same-fd + foreign-uid reject + `readBoundedText` size-cap BEFORE
  parse (the #446 C3 lesson) + re-derive id from body + exact-set closed-shape + observable emit on
  every reject.
- `resolveJoinKeyForPr({repo, pr_number, pr_url}, {dir})` — the PR-2 join. Because `pr_url` is NOT
  in the id basis, this is an **ENUMERATE-and-exact-set-filter** (list the store, filter on `repo`
  AND `pr_number` AND `pr_url` all matching — never a subset/`includes`), mirroring
  `resolveAnchorForPr` ([world-anchor-store.js:275-297](../../lab/world-anchor/world-anchor-store.js:275)).
  Each enumerated record is verify-on-read'd; a non-unique match fails closed.
- `assertRecordedClaim(joinKeyMeta)` — the metadata gate (VERIFY hacker FAIL: the helper must be
  SPECIFIED, it did not exist). Returns the allowlisted `{built_by}` or throws:
  - if `joinKeyMeta` is absent → returns `{}` (no recorded claim; the join-key omits `built_by`).
  - if present, must be a plain object (non-array) — else throw.
  - run the `DISPOSITION_KEY_SET` check ([emit-pr.js:181](../../kernel/egress/emit-pr.js:181)) over
    its keys; a disposition/token/`__proto__`-shaped key → throw (the #273 exact-set lesson).
  - `built_by`, if present, must be a bounded plain string (≤256 chars, no control chars) — else
    throw. Returns ONLY `{built_by}` (no other key is forwarded into the record).

### 2. `emitPR` writes the join-key at emit-success (additive, non-reverting)

At [emit-pr.js:424-426](../../kernel/egress/emit-pr.js:424) (alongside recordEmit/recordEmitted/
consumeApproval, AFTER `armedEmitFn` succeeds):

```
// pr.deduped === true => a PRIOR emit already wrote THIS join-key (idempotent); skip the re-write
// (also sidesteps the reconcile-path wrong-base hazard — VERIFY FAIL Q5).
if (typeof opts.custodyJoinKeyDir === 'string' && pr && !pr.deduped) {
  try {
    const { built_by } = assertRecordedClaim(opts.joinKeyMeta);   // throws on a policy-shaped/oversized key
    writeJoinKey({
      repo: draft.repo, issueRef: draft.issueRef,
      pr_number: pr.number, pr_url: pr.pr_url,
      approval_hash: approvalHash, base_sha: pr.base_sha,
      ...(built_by ? { built_by } : {}),
      emitted_at: new Date(now).toISOString(),
    }, { dir: opts.custodyJoinKeyDir, selfUid: opts.selfUid });
  } catch (e) { emitEgressAlert('egress-join-key-write-failed', { pr_url: pr && pr.pr_url, reason: (e&&e.message)||'error' }); }
}
```

- **ADDITIVE / non-reverting.** The PR already shipped; a join-key write failure (incl. a thrown
  `assertRecordedClaim`) must NEVER revert the emission. It is observable (emit on failure) but
  non-fatal. (Mirrors the world-anchor edge mint's additive-failure isolation, D2.)
- **Skip on dedup (VERIFY FAIL Q5).** `pr.deduped === true` (the [gh-emit.js:614](../../kernel/egress/gh-emit.js:614)
  reconcile path) means a prior emit already wrote the join-key; re-writing is at best a no-op
  dedup and at worst seals a *re-resolved current* base_sha that differs from the PR's real parent.
  Skip it — the first write is authoritative.
- **No policy injection.** `opts.joinKeyMeta` is custody/orchestrator-supplied. `built_by` is
  recorded-claim ONLY (the join-key's AUTHORITY is `approval_hash` + `pr_url`, both kernel-derived;
  `built_by` is metadata). `assertRecordedClaim` runs the `DISPOSITION_KEY_SET` check; a
  disposition-shaped key is fail-closed rejected (the #273 exact-set lesson). **Add `custodyJoinKeyDir`
  and `joinKeyMeta` to `DISPOSITION_KEYS` ([emit-pr.js:162](../../kernel/egress/emit-pr.js:162))** so
  neither can be injected via the untrusted `data` object (VERIFY Q6b).
- **Write site is reachable only on `emitted:true`** — never on awaiting-approval/refused/cap/
  etiquette paths. The join-key's mere existence attests "a real, approved, broker-signed emission
  happened with this approval_hash."
- **base_sha threading (VERIFY FAIL Q5).** `ghEmit` gains `base_sha` on **BOTH** return sites
  ([:627](../../kernel/egress/gh-emit.js:627) normal AND [:614](../../kernel/egress/gh-emit.js:614)
  dedup), surfaced from the `baseCommitSha` it already resolves for the commit message. `armedEmit`
  passes the whole `pr` through unchanged, so `pr.base_sha` resolves. Existing callers unaffected
  (additive field). The deduped-path base_sha would be a re-resolved current base — which is why
  the write is skipped on dedup (above), so that value is never persisted.

### 3. What this does NOT do (the SHADOW boundary)

- No consumer reads the join-key yet (PR-2 wires the lab join). `grep` for a reader = 0.
- `LIVE_SOURCES` untouched. `deriveWorldAnchorSource` still returns `'mock'`. Moves trust zero.
- Does not gh-verify the merge (PR-2's observer concern). Does not close #273 (the cross-uid
  deployment + the signer remain; this NARROWS the basis to "what the kernel emitted").

## Security invariants (the kernel/egress class — all must hold)

1. **Additive-failure isolation** — a join-key write failure never reverts the emission, never
   throws out of emitPR's success path.
2. **Verify-on-read, content-addressed** — `loadJoinKey` re-derives the id from the body and
   rejects a mismatch (#273: verify content, not just the key); O_NOFOLLOW + fstat-same-fd +
   size-cap-before-parse + foreign-uid reject.
3. **Exact-set join** — `resolveJoinKeyForPr` requires repo AND pr_number AND pr_url, never a
   subset.
4. **Fail-closed-must-be-observable** — every reject path emits a high-visibility alert (no silent
   `{ok:false}`).
5. **No policy in metadata** — `joinKeyMeta` cannot carry a disposition/token-shaped key; the
   authoritative fields are kernel-derived, `built_by` is recorded-claim.
6. **Integrity ≠ provenance (honest framing)** — the store proves a join-key is self-consistent
   AND that an emission occurred via the approved path; it does NOT prove the cross-uid broker was
   deployed. NARROWS, hardens only on deployment.
7. **Non-vacuous guards** — each guard's failure path is exercised (a planted symlink, an oversize
   file, a foreign-uid file, a policy-shaped metadata key) and asserted RED before the fix.

## Test plan (TDD — write the suite first, against the new behavior)

- **Store unit:** write/read round-trip; dedup (re-emit same identity → one file); verify-on-read
  rejects a tampered body (re-derive mismatch), a symlink, a foreign-uid file, an oversize file;
  `resolveJoinKeyForPr` exact-set (subset must NOT match; non-unique → fail-closed); observable
  emit on each reject.
- **Collision (VERIFY Q3b):** same `{repo, issueRef, pr_number, approval_hash}` id with a DIVERGENT
  `pr_url` → COLLIDE-refuse (pr_url is in `bodiesEqual`); same id with new `built_by`/`emitted_at`
  → dedups (metadata not in `bodiesEqual`).
- **emitPR integration:** join-key written ONLY on `emitted:true`; NOT written on
  awaiting-approval / refused / cap-exceeded / etiquette paths; **NOT written on `pr.deduped===true`**
  (VERIFY FAIL Q5 — assert no second file, no null-base_sha write); additive-failure isolation (an
  injected throwing `writeJoinKey` AND a throwing `assertRecordedClaim` each still return
  `emitted:true` + emit the alert).
- **assertRecordedClaim (VERIFY hacker FAIL — non-vacuous):** a disposition-shaped
  `joinKeyMeta` key → throws, emission still `emitted:true`; an array / oversized-string / control-char
  `built_by` → throws; absent `joinKeyMeta` → join-key omits `built_by`, write succeeds.
- **base_sha (VERIFY FAIL Q5):** ghEmit returns base_sha on BOTH return sites; the join-key seals
  it; a non-HEX40 base_sha → `writeJoinKey` reject (non-vacuous field validation).
- **Deny-list:** `custodyJoinKeyDir`/`joinKeyMeta` as keys in the untrusted `data` object →
  `assertDataIsPolicyFree` rejects the emit (VERIFY Q6b).
- **Non-vacuous:** the symlink/oversize/foreign/policy/base_sha guards each fire RED on a planted
  violation, then pass on revert.
- **SHADOW dam:** a grep/import test asserting ZERO production reader of the join-key store.

## HETS Spawn Plan

- **VERIFY (pre-approval, this plan):** 3-lens parallel board — **architect** (design soundness:
  is the join-key the right kernel-authoritative anchor? is additive-write the right coupling?),
  **hacker** (adversarial: same-uid co-forge of a join-key; policy injection via joinKeyMeta;
  TOCTOU on the write site; can a forged join-key launder a non-emission?), **honesty-auditor**
  (claim-vs-evidence: the "kernel-authoritative" / "NARROWS not closes" framing; the MEMORY
  status-correction). Required per the kernel/security/egress 3-lens rule.
- **BUILD (delegated):** `node-backend` (TDD: suite-first, then minimal impl). Record the Rule-4
  board verdict (delegated builder subject) at VALIDATE.
- **VALIDATE (post-build):** 3-lens — `code-reviewer` (correctness), `hacker` **live-probe of the
  BUILT store + emitPR path** (a clean suite is NOT proof — attempt a real same-uid co-forge,
  confirm NARROWED), `honesty-auditor` (the shipped framing). Then the 4 drift gates +
  pre-PR CodeRabbit lens.

## Drift Notes

- The original "PR-A2" (cross-uid signer) is **deferred to PR-3**: recon proved it would sign a
  lab-asserted value, so the basis must be strengthened first (the USER's chosen direction).
- The gap-map's dependency order (item 1 before item 2) was inverted by #439 — a real
  build-order drift worth a session-end note (`drift:dependency-order-skipped`?).
- PR naming: this is the gap-map's **item 1**, NOT "PR-A.2" (the merged wire) nor "PR-A2" (the
  deferred signer). Title accordingly to avoid the one-dot collision the recon architect flagged.

## Pre-Approval Verification (3-lens board, 2026-06-28)

Board: **architect** (design) NEEDS-REVISION · **hacker** (adversarial) NEEDS-REVISION ·
**honesty-auditor** (claim-vs-evidence) PASS. The design DIRECTION was ratified by all three
(the approval_hash anchor, the additive-at-emit-success coupling, the new store's single-
responsibility vs `world-anchor-store.js`, and the SHADOW/NARROWS-not-closes framing all PASS).
The two NEEDS-REVISION carried build-correctness fixes, now folded in:

| # | Lens / sev | Finding | Resolution (in-plan) |
|---|---|---|---|
| 1 | architect FAIL Q5 | `ghEmit` has TWO return sites (:614 dedup, :627 normal); base_sha threaded to neither → a deduped emit writes `base_sha=undefined` (store rejects, silent) AND the reconcile path's base may be a wrong (re-resolved current) base | base_sha added to BOTH returns; the join-key write **skips on `pr.deduped===true`** (first write authoritative). Design §2 + test. |
| 2 | hacker FAIL | `assertRecordedClaim` referenced but undefined; `assertDataIsPolicyFree` guards an object key-set, not a string → undefined symbol OR an open policy-injection hole | `assertRecordedClaim` fully specified (object-only, `DISPOSITION_KEY_SET` check, bounded `built_by` string), with a non-vacuous RED test. Design §1. |
| 3 | architect FLAG Q3b | id basis over-specified; `resolveJoinKeyForPr` join semantics + collision unspecified | redundancy noted (`{pr_number, approval_hash}` minimal); `resolveJoinKeyForPr` = enumerate+exact-set-filter; `pr_url` in `bodiesEqual` → divergent-pr_url collision test added. |
| 4 | architect FLAG Q6b | `custodyJoinKeyDir`/`joinKeyMeta` not on the deny-list | both added to `DISPOSITION_KEYS`; deny-list test added. |
| 5 | architect/honesty FLAG Q4 | PR-2's fail-closed refuse orphans the live node `ca648110` (backfill-2137 has no join-key) | forward-contract caveat added to the PR-2 scope bullet (re-emit or legacy-exemption). |
| 6 | architect FLAG Q3a | field names must match `ATT_FIELDS` so PR-2's join needs no rename-map | record-shape note pins verbatim names. |
| 7 | honesty FLAG Q3 | Runtime Probe row 2 cited stale `gh-emit.js:133` (= `isAlreadyExists`) | corrected to :627 (+ :614 dedup); base_sha row corrected to "neither return". |
| 8 | honesty rec | git-history claim (2f1ab38 doc-only) not re-run in the lens | confirmed firsthand THIS session (`git show`) + the grep=0 independently confirms; noted in probes. |
| 9 | honesty rec | gap-map's stale-comment caveat (:20/:39/:51/:352) | verified ALREADY resolved by #439 — no fix needed; noted in probes. |

VALIDATE (post-build) carries forward: the hacker **live-probes the BUILT store** (a real same-uid
co-forge via the exported `writeJoinKey` → confirm `loadJoinKey` accepts it → NARROWED-not-closed,
Rule 2a); the SHADOW dam is a real import/grep test, not a comment.

## VALIDATE result (post-build 3-lens board, 2026-06-28 — PR #447)

Board: **code-reviewer** (correctness/resource-safety) PASS · **hacker** (adversarial, live-probe)
PASS · **honesty-auditor** (claim-vs-evidence) PASS. No FAIL, no CRITICAL/HIGH. The hacker built
throwaway probes against the BUILT modules and **live-confirmed** the documented residual (a forged
join-key for a never-emitted PR is accepted by `loadJoinKey`; an in-basis-field tamper re-derives a
mismatching id and is rejected) — NARROWS-not-closes, honestly framed. Three non-blocking FLAGs
folded before commit:

| FLAG | Resolution |
|---|---|
| hacker: `base_sha`/`pr_url`/`built_by`/`emitted_at` are OUT of the content-address basis (in-place same-uid tamper accepted on read), yet presented as kernel-authoritative + read by PR-2 | store-header SEALED-vs-RECORDED note added: only `approval_hash` + the id basis are sealed; PR-2 MUST bind `to_delta_ref` to `approval_hash`, never `pr_url`/`base_sha`. (No basis change — `pr_url` is deliberately out-of-basis so a divergent pr_url is a collision.) |
| code-reviewer: `emitted_at` used bare `Date.parse` (accepts `'2026'`) | tightened to a strict `ISO_8601_UTC` regex paired with the existing `Date.parse` calendar check. |
| honesty: an unused `name` param in the shadow-dam test harness | turned into a real improvement (named failures: `catch → console.error(\`FAIL: ${name}\`)`). |

Firsthand verification (verify-by-execution, Rule 2a-corollary): `join-key-store` 25, `join-key-shadow`
4, `emit-pr` 51, `gh-emit` 57 — all green; full egress suite 18/18; **full kernel suite 107 suites,
0 failures**; eslint + markdownlint clean; release-surface clean. Honesty note: the builder reported
"+10" emitPR item-1 tests; the firsthand-verified total is `emit-pr.test.js` = 51 passed (was 46).

## CodeRabbit fold (async-bot gate, 2026-06-28 — the #439 SCAR pattern)

The retriggered CodeRabbit review (the earlier pass was rate-limited) posted **5 findings, all
premise-probed REAL** — the async-bot complemented the 3-lens board (which PASSED), catching two
security Majors it missed:

| # | sev | finding | fix |
|---|---|---|---|
| 1 | Major (fail-silent) | `writeJoinKey`'s collision/write-failed `{ok:false}` paths skip the alert; the emit-pr write-site only caught throws | write-site captures `jk` + emits `egress-join-key-write-failed` on `jk.ok===false` |
| 2 | Major (security) | `loadJoinKey`/`listJoinKeys` read from `opts.dir` with no symlink/foreign check (write path's `ensureStoreDir` validates; read path didn't) | new `validateReadDir` (lstat; `absent`→silent, `symlink`/`foreign`/`not-a-dir`→alert) at the top of both readers |
| 3 | Minor | the non-throwing-failure test discarded `alerts` | assert the `egress-join-key-write-failed` alert |
| 4 | Major (security) | the SHADOW dam grepped literal call-tokens → an aliased import (`{loadJoinKey: read}`) bypassed it | import-graph-aware dam: parse each `require('…join-key-store')` destructure, gate the SOURCE binding names under any alias |
| 5 | Minor | the fast-fail null test didn't assert "no fs touch" | spy `openSync`/`readSync`/`fstatSync`/`readdirSync` → assert zero record-fs calls |

The **sibling `world-anchor-edge-store`** has the identical #2 read-dir gap — tracked separately (out
of this PR's scope; a `spawn_task` chip). Post-fold firsthand: `join-key-store` **29**, `join-key-shadow`
**6**, `emit-pr` 51, `gh-emit` 57; full kernel **107** green; eslint + signpost clean. Rule-2a live
probe of the BUILT #2 fix: a symlinked read-root → null/`[]` + 2 observable `read-dir` alerts; an absent
store → silent null/`[]`.
