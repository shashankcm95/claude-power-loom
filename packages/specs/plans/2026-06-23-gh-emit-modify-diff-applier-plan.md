# gh-emit modify-diff post-image applier (#405)

## Context

`gh-emit.js` (③.2.5c) reconstructs post-images for **new-file adds only** — a modify-hunk fails closed
(`cannot-reconstruct-postimage`). A real good-first-issue almost always produces a **modify** diff, so this is
the gating blocker (#405) to emitting a *useful* external PR. This wave adds a **fail-closed base+hunk applier**:
fetch each modified file's base content (gh contents API at the resolved base commit), apply the approved
**scrubbed** hunks, and emit the full new content — refusing on any context/removed-line mismatch (a moved base).

## Routing Decision

`route-decide.js` → `root` (score 0) — the **known Router-V2 catch-22** (the frozen lexicon matches none of these
substrate-meta/egress tokens; recurs exactly as #402/#403). Verbatim: `{"recommendation":"root","confidence":0.4,"score_total":0}`.

**Override: `--force-route`.** Kernel-tier + security + **live network egress** (the emitted bytes go to a real
repo). The fail-closed hunk applier is the riskiest code in the egress path. Full 3-lens VERIFY board REQUIRED.

## HETS Spawn Plan

VERIFY board (pre-build, read-only, Workflow): **architect** (the parser/applier/ghEmit-base-fetch shape; the
pure-parser + pure-applier + impure-fetch split), **hacker** (the applier is the attack surface: a malicious diff
that produces wrong post-image bytes; base-path traversal in the fetch; line-count/oldCount lies; CRLF/binary;
the Forward-Contract — emit exactly the approved diff applied), **honesty-auditor** (does it honestly honor the
Forward-Contract; is the moved-base refuse honest; scope claims). VALIDATE board (post-build): code-reviewer +
hacker (LIVE-probe the built applier with adversarial diffs, Rule 2a) + honesty.

## Files To Modify

| Path | Action | Risk | Notes |
|---|---|---|---|
| `packages/kernel/egress/gh-emit.js` | modify | **HIGH** | replace `reconstructPostImages` (new-file-only) with a pure `parseDiffStanzas` + a pure fail-closed `applyHunks`; `ghEmit` fetches base content per modified file (gh contents API at the base commit) and applies. The trees-emit side is UNCHANGED (a modify is the same `{path,mode,content}` inline-content tree entry as an add). |
| `tests/unit/kernel/egress/gh-emit.test.js` | modify | medium | add modify-diff cases (clean apply; a moved-base context mismatch → refuse; oldCount/newCount lies → refuse; a `+`/`-`/context interleave; CRLF; no-trailing-newline; binary → refuse). Keep the new-file cases (now routed through the same applier with an empty base). The mock `runGh` gains a `contents?ref=` responder returning base64 base content. |

> **REVISION 2 (post-VERIFY-board):** folds 1 CRITICAL (cross-hunk positional ambiguity — a count-check is not
> exact-reconstruction) + the scrub/old-side interaction + per-side no-newline + size caps + the post-image-honesty
> residual + path-provenance. The applier is now **exact positional reconstruction**, not a count check. (Architect
> lens died on an API drop — re-run at VALIDATE on the built code.) See `## Pre-Approval Verification`.

## Phases

#### Phase 1 — `parseDiffStanzas(scrubbedDiff)` (pure) (Risk: HIGH)
Parse the scrubbed diff into per-file stanzas: `{ pathB, type:'add'|'modify', mode, hunks:[{oldStart,oldCount,newStart,newCount,lines:[{op,text}]}] }`. `op` ∈ {` `,`+`,`-`}. **Non-op lines (board MED):** a `\ No newline at end of file` marker is parsed as a **per-side flag on the immediately-preceding line** (record `oldNoNL`/`newNoNL` separately — git emits it mid-hunk, qualifying only that line's side), EXCLUDED from the op-counts; an empty diff body line (`''`) is a **blank context line** (`op:' ', text:''`, advances base). Refuse (fail-closed) on: path divergence (`diff --git b/` ≠ `+++ b/`); a rename/copy/**delete** stanza (DEFERRED); an unparseable `@@`; a hunk whose old-side (` `+`-`) count ≠ `oldCount` or new-side (` `+`+`) count ≠ `newCount`; a `\` marker in an unexpected position; a path containing `?`/`#`/`%` (the contents-URL query/fragment-injection surface, board MED). New-file = a `new file mode` stanza (`type:'add'`, base empty, hunk old-side `-0,0`).

#### Phase 2 — `applyHunks(baseText, hunks)` (pure, FAIL-CLOSED, EXACT positional reconstruction) (Risk: HIGH — the CRITICAL)
**NOT a line-count check (board CRITICAL — a count is satisfied by many byte-strings).** Reconstruct positionally with exact-shape invariants, REFUSE (`cannot-apply-hunk`) on any violation:
1. **hunks strictly ascending + non-overlapping by `oldStart`** — refuse if `hunk[i+1].oldStart <= hunk[i].oldStart + hunk[i].oldCount`.
2. **each `newStart` === `1 + Σ(prior newCount) + Σ(prior gap lengths)`** — refuse on mismatch (catches a `newStart` that lies about position).
3. build = for each hunk: emit `gap(base[prevEnd .. oldStart-1])` verbatim, then per line — ` ` → assert `base[k]===text`, emit, advance; `-` → assert `base[k]===text`, advance (no emit); `+` → emit text; then the `tail(base[lastEnd..])`.
4. **the enforced old-side guarantees** (REVISION 3 — the VALIDATE honesty lens corrected an over-claim here): each hunk consumes EXACTLY `oldCount`; no gap and no ` `/`-` line runs PAST base EOF (a distinct refuse reason). The TRAILING unchanged region is carried VERBATIM from the base — it is correct unified-diff semantics, NOT an `=== base.length` assertion (a literal "refuse on a longer base" would brick every real modify diff, which has trailing context). The reconstruction is still EXACT: a moved base mismatches a ` `/`-` line and refuses.
5. trailing-newline derived from the **NEW-side** `newNoNL` flag of the FINAL emitted line (independent of the old side).
6. **size caps:** refuse if `base > MAX_BASE_BYTES` or the produced post-image `> MAX_POST_IMAGE_BYTES` (kernel constants) — a tiny diff against a big base amplifies (board HIGH).
- Probe: the fixture applied to `line1\nline2\nline3\n` → `line1\nLINE-TWO-CHANGED\nline3\nline4-added\n`; `line2`→`lineX` base → REFUSE; out-of-order/overlapping hunks → REFUSE; a `newStart` lie → REFUSE.

#### Phase 3 — `ghEmit` base-fetch + wire (Risk: HIGH)
`validateEmitInputs`: parse via `parseDiffStanzas`; **derive the validated path set from `parseDiffStanzas` itself** (single parser — board LOW two-parser-drift) and still cross-check membership in `parseDiffPaths(diff)` (emit-pr's upstream gate) + `isEgressDeniedPath`. NO content for modifies yet. In `ghEmit`, after `baseCommitSha`: `add` → `applyHunks('', hunks)`; `modify` → `GET repos/{repo}/contents/{path}?ref={baseCommitSha}` using the **SAME validated `stanza.pathB` object** (never re-parsed), REFUSE if `encoding!=='base64'` (a `>1MB` base returns `encoding:'none'` → honest refuse, board MED) or a NUL byte (binary), base64-decode, `applyHunks(base, hunks)` → `{path,mode,content}`. Then the existing tree→commit→ref→pull (UNCHANGED).
- Probe: a mock `runGh` `contents?ref=` responder → emits the applied content; a context-mismatch base → refuse, no tree POST; an `encoding:'none'` base → refuse.

#### Phase 4 — tests + the Forward-Contract self-check
The hash binds the scrubbed **diff**; the applier faithfully realizes it against the live base, or refuses. Keep `computeEmissionHash(draft)===approvalHash`. Tests cover every refuse path below.

## Scrub interaction (honest scope — board HIGH)
`scrub.js` Pass-1/Pass-2 redact secret-shaped / base64-decoding tokens on **every** line, INCLUDING ` `context and `-`removed lines (only Pass-3 entropy is `+`-gated). The live base holds the **un-redacted** token, so a modify diff whose old-side line was scrub-touched produces a `[REDACTED]`-bearing context/removed line that **won't match the live base → `applyHunks` REFUSES** (and emitting it would *corrupt* the file by writing `[REDACTED]` over real content). This never bit new-file adds (all `+`, no old-side compare). **Disposition: accept as an honest fail-closed refuse** (the safe egress philosophy — never emit a guessed/corrupting post-image). The headline scope is therefore "emit MODIFY diffs **whose old-side lines weren't scrub-ALTERED**" (REVISION 3 — the precise predicate is "altered", not "touched": a scrub pass that inspects but does not change a line's bytes still applies; only a redaction that CHANGES the old-side bytes trips the moved-base refuse). A dedicated test asserts this.

## Forward-Contract honesty (board HIGH — residual, stated not silent)
The hash binds the scrubbed **diff**; for a MODIFY the emitted bytes are `live-base + approved-hunks` — **the human approved the DIFF, not the post-image**. The exact context-match (Phase 2.3) + the exact-reconstruction invariants (Phase 2.1-2.4) bound divergence to "the approved hunks applied at the approved positions," and a moved base **refuses** rather than emitting an unreviewed join — but the inter-hunk gap/tail come from the emit-time base, which the approver did not render. Tolerable because the PR is **DRAFT-only + human-merge-gated** (PATH-1). A future arming step may bind the resolved `baseCommitSha` into the approval / record it in the PR body so the `(base, diff)` pair is attestable. (The honest analog of approval.js:19-25's own "integrity not provenance.")

## Verification Probes

| Probe | Pass criterion |
|---|---|
| 1 | a modify-diff fixture → emitted content === base + hunks applied (the probed example) |
| 2 | a moved base (context line differs) → `applyHunks` refuses; ghEmit emits zero bytes |
| 3 | **cross-hunk:** out-of-order / overlapping `oldStart`, or a `newStart` that lies → refuse (the CRITICAL) |
| 4 | an `oldCount`/`newCount` that lies about the hunk body → parse refuses |
| 5 | **per-side no-newline:** marker on old-only / new-only / both / base-no-NL-but-new-adds-one → correct trailing-newline |
| 6 | **blank context line** (`''`) inside a hunk → treated as context, advances base |
| 7 | binary base (NUL) / non-base64 / `encoding:'none'` (>1MB) → refuse |
| 8 | **size caps:** base > MAX_BASE_BYTES or post-image > MAX_POST_IMAGE_BYTES → refuse, no tree POST |
| 9 | **scrub-touched old-side line** → refuse, zero bytes (the honest-scope test) |
| 10 | a stanza path containing `?`/`#`/`%` → refuse before any contents GET |
| 11 | new-file adds still work (empty-base path) — no regression of the ③.2.5c hardening |
| 12 | base-fetch uses the SAME validated `stanza.pathB`; no `-f`/`-F`; `--input -` unchanged |
| 13 | full kernel suite + install gate 129/0 |

## Out of Scope (Deferred)

- **Rename / copy / delete stanzas** — fail-closed (delete via `sha:null` is trivial but un-dogfooded; rename needs detection).
- **Fuzzy/offset hunk application** — we require an EXACT context match at the stated position; a moved base refuses.
- **Multi-base / 3-way merge** — single base commit (the resolved default branch HEAD) only.
- **Base files > ~1MB** — the contents API returns `encoding:'none'`; the applier refuses (fail-closed). Large-base modify needs the Blobs/raw API, deferred.
- **A scrub-touched OLD-SIDE line** — refuses (see Scrub interaction); re-scrubbing the fetched base to compare is a trust-model change deferred to its own review.

## Drift Notes
- Router-V2 catch-22 recurs (root score 0 on an egress wave) — force-route, as #402.
- The applier is fail-closed-on-mismatch BY DESIGN: an egress must never emit a guessed post-image. A moved base is a refuse, not a fuzz.

## Why this is the right shape
- **Pure parser + pure applier + impure fetch:** the dangerous logic (apply) is a pure function unit-testable against adversarial fixtures in isolation; the network (base fetch) is the only impure part, injectable via the mock `runGh`.
- **The trees-emit side is unchanged:** a modify is the same inline-`content` tree entry as an add — only the content *source* differs (base+hunks vs all-`+`). Minimal blast radius on the proven emit path.
- **Fail-closed-on-moved-base** preserves the Forward-Contract: emit exactly the approved diff applied to the current base, or refuse — never a guessed/stale post-image.

## Runtime Probes (firsthand, 2026-06-23)
- `reconstructPostImages` is new-file-only today (read `gh-emit.js:140-199`).
- gh contents API: `gh api repos/{repo}/contents/{path}?ref={sha}` → `{encoding:'base64', content, size}` → base64-decode → base text (probed against octocat/Hello-World).
- A real git modify-diff: `@@ -1,3 +1,4 @@` with ` `context / `-`removed / `+`added lines (probed via a throwaway local repo).
- The trees API accepts a modify as the same `{path,mode:'100644',type:'blob',content:<full new file>}` inline entry (base_tree preserves unlisted) — confirmed in ③.2.5c.

## Phase
Planned ③.2.5d / issue #405 (2026-06-23). Builds on #402 (gh-emit) merged.

## Pre-Approval Verification

3-lens VERIFY board (Workflow `wf_8f4f960c-22c`, pre-build) — **architect lens DIED** (API connection dropped mid-response; its structural-factoring view is deferred to the VALIDATE board on the built code). hacker **NEEDS-REVISION** (1 CRITICAL + 4), honesty **APPROVE-WITH-FOLDS** (5). All folded into REVISION 2 above.

| # | Sev | Lens | Finding | Disposition |
|---|---|---|---|---|
| C1 | CRITICAL | hacker | a line-COUNT post-condition isn't exact-reconstruction — out-of-order/overlapping hunks or a lying `newStart` emit a post-image the approved diff never described (#273 exact-set class) | FOLDED — Phase 2 is now exact positional reconstruction (ascending+non-overlapping; `newStart`===running-offset; old-side-consumed===base.length). |
| H1 | HIGH | honesty | scrub redacts secret-shaped tokens on context/removed lines too → a `[REDACTED]` old-side line won't match the live base → refuse (never bit new-file adds) | FOLDED — "Scrub interaction" section; accepted as honest fail-closed refuse; scope reworded; probe 9. |
| H2 | HIGH | hacker | the `\ No newline` marker is a per-side mid-hunk qualifier, not a stanza boolean | FOLDED — Phase 1 parses it per-side; Phase 2 derives trailing-NL from the NEW-side flag; probe 5. |
| H3 | HIGH | hacker | unbounded base fetch + uncapped post-image (a tiny diff against a big base amplifies) | FOLDED — `MAX_BASE_BYTES`/`MAX_POST_IMAGE_BYTES`; >1MB `encoding:'none'` refuse; probes 7-8. |
| H4 | HIGH | hacker (+honesty) | the hash binds the DIFF not the BASE — the post-image = live-base + hunks, which the human didn't render | FOLDED — "Forward-Contract honesty" residual stated; exact-reconstruction bounds divergence; DRAFT-only gates it. |
| M1 | MED | hacker | the contents-fetch path must be the SAME validated stanza object + reject `?`/`#`/`%` (URL query/fragment injection) | FOLDED — Phase 1 rejects `?`/`#`/`%`; Phase 3 reuses `stanza.pathB`; probe 10. |
| M2 | MED | honesty | count-assert vs git's real format — exclude the `\` marker from counts; handle a blank (`''`) context line | FOLDED — Phase 1 non-op-line handling; probe 6. |
| M3 | MED | honesty | >1MB base = `encoding:'none'` undisclosed scope cut | FOLDED — Out of Scope + probe 7. |
| L1 | LOW | honesty | two-parser drift (`parseDiffStanzas` vs `parseDiffPaths`) | FOLDED — derive the validated set from `parseDiffStanzas`, cross-check membership; probe 12. |

## VALIDATE result (post-build, REVISION 3 — the 4-lens board on the BUILT code)

4-lens board, read-only personas, in parallel. The **architect** lens (which died at VERIFY on an API drop) was re-run here per the plan.

| Lens | Verdict | Headline |
|---|---|---|
| architect | NEEDS-REVISION | reconstruction model confirmed SOUND (incl. U3 context + pure-insertion); 2 MED (refusal mis-attribution; header-scan whitelist) + bind baseCommitSha. |
| code-reviewer | CLOSEABLE | 1 MED (`old mode`/`new mode`+content silently loses the exec bit) + 3 LOW (dead guard, untested marker-first, unguarded `applyHunks([])`). |
| hacker (LIVE re-probe, Rule 2a) | NEEDS-REVISION | **C1 CRITICAL** — `mode` had no allowlist: a `new file mode 120000` ADD lands a SYMLINK (`160000` a gitlink) in the emitted tree. + H1/H2 (forward-contract/mode residuals, DRAFT-gated) + M1/M2 (path denylist→allowlist; env not-sanitized). |
| honesty | B (minor over-claims) | **HIGH-1** invariant-4 docstring/plan claimed a "refuse on longer base" assertion that doesn't exist (verbatim tail-carry) — maintenance hazard. Forward-Contract residual ACCURATE; 23/23 refuse tests non-vacuous; 12/13 probes test-backed. |

**FOLDED this revision** (all in the diff): C1 mode allowlist `{100644,100755}` (+ a tree-build defense-in-depth re-assert); mode-change stanza refuse; header-scan whitelist (unrecognized header line → refuse; binary → refuse); positive path allowlist `[A-Za-z0-9._/-]` (replaces the `?#%` denylist); env credential-key check (M2); distinct "past base EOF" refuse reason; `baseCommitSha` bound into the commit message + PR body (attestability); invariant-4 docstring + Phase-2.4 wording corrected (HIGH-1); "scrub-touched"→"scrub-altered" precision; dead `stanzas.length===0` guard removed; `applyHunks([])` guard; probe 5d added. 10 new tests (41 → 51).

**Deferred residuals (DRAFT-only + human-merge gated; the hacker explicitly permits acknowledging these):**
- **H1 forward-contract** — the approval binds the DIFF, not the post-image; for a MODIFY the inter-hunk gap/tail come from the emit-time base. `baseCommitSha` is now bound into the PR body (attestable); binding it into the APPROVAL BASIS (so a moved base invalidates the approval) is a future arming step. Stated in code (`gh-emit.js` header + `prBody` comment) + plan.
- **H2 modify exec-bit** — a MODIFY tree entry uses mode `100644`; modifying a `100755` base drops the +x bit (FAIL-SAFE — removes capability, never grants; visible in the DRAFT). Base-mode preservation via the trees API is a follow-up issue. C1 + mode-change-refuse close the dangerous direction (granting symlink/exec).

**Gate (run firsthand, 2026-06-23 — closes honesty MED-3 "129/0 unprovenanced"):** `gh-emit.test.js` **51 passed, 0 failed, 0 skipped**; full kernel suite **101 files, 0 failures**; `eslint` clean (0 `eslint-disable`); `install.sh --hooks --test` **129 passed, 0 failed** (SIGNPOST in sync). **C1 must close before any EXTERNAL PR (it did, here); all findings were bounded by the PATH-1 human-merge gate regardless.**
