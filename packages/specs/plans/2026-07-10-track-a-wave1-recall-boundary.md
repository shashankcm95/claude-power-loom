---
title: "Track A, Wave 1 — the cross-uid recall-inject boundary (SHADOW half)"
status: PLAN (authored 2026-07-10; awaiting /verify-plan + USER approval before build)
created: 2026-07-10
lifecycle: persistent
derives_from:
  - packages/specs/research/2026-07-10-plugin-learning-wire-blueprint.md   # the design + board + FORK RESOLVED
  - docs/phases/phase-external-readiness.md                                 # Track A, the L2 wire
  - packages/specs/plans/2026-07-10-external-readiness-checklist.md         # A1 gate row
---

# Track A, Wave 1 — the cross-uid recall-inject boundary (SHADOW half)

## Context

The external-readiness checkpoint's **learning wire** (recall a CONFIRMED lesson INTO the next solve) is
missing — `grep recall` in the live-solve path returns 0 (the crux). The blueprint's review board opened two
CRITICALs (F1: wiring recall into the drafter trips the deliberate `drafter-recall-disjointness` dam; H1: the
world-anchored lane is integrity-not-provenance until a cross-uid deploy), and the USER resolved both with one
structural move: a **boundary module** (`recall-inject-boundary.js`) — the single audited bridge between the
drafter and the recall lane, which invokes recall as a **cross-uid subprocess** rather than a static import.

This plan is **Wave 1's SHADOW half only** — the boundary module + the updated dam + the wire + tests, all
buildable now and **byte-identical to the bare prompt until an operator deploys the cross-uid custody holder**.
The live recall round-trip closes at operator arming (out of scope here). It is the first reviewable PR of
Track A; the persona-context pins (A2) and the Embers export seam (A3) are later waves.

Per OQ-NS-6, nothing here HARDENS trust; recall is advisory DATA that gates nothing and never mutates the
graded record.

## Routing Decision

```json
{
  "task": "Track A Wave 1 — cross-uid recall-inject boundary (SHADOW half)",
  "route-decide": { "recommendation": "borderline", "score_total": 0.337, "confidence": 0.125 },
  "resolution": "ESCALATE to route (architect + full 3-lens verify). Judgment override of the borderline score: this is a cross-uid provenance boundary + an injection channel into a live external-repo actor prompt, #273-adjacent. The dam-exemption mechanics and the fail-closed-detection model are genuine design tradeoffs, and the security class mandates the hacker lens (rules/core/workflow Rule 2 / Rule 2a). Borderline-not-root because the score's stakes lexicon under-weights 'injection channel' / 'cross-uid boundary'."
}
```

## HETS Spawn Plan

Pre-approval (`/verify-plan`, this plan) and post-build (VALIDATE, the diff) both run the security tier — the
change is a cross-uid boundary + a live-actor injection channel + a security-dam edit:

- **architect** (read-only) — the boundary/dam/wire design: is the dam "extended not relaxed"? is the
  fail-closed-detection model sound? are the seams (SRP/OCP) right?
- **code-reviewer** (read-only) — correctness of the dam-update logic (the spawn-literal exemption must not
  create a false-negative hole), the flag parse, the sanitizer composition, fd/subprocess handling.
- **hacker** (read-only, VALIDATE on the BUILT diff per Rule 2a) — attack the exemption: can an author now
  hide a lane require in the boundary? can the subprocess be made to spawn same-uid / return unsanitized
  content / leak a weight? does a typo'd flag fail OPEN? build live probes against the built module.

Pre-build: architect + code-reviewer (this `/verify-plan`). Post-build VALIDATE: all three, on the diff.

## Principle Audit

- **SRP** — the boundary is ONE responsibility: bridge drafter→recall across a uid boundary and return a
  sanitized advisory block or empty. It holds no recall logic (subprocess) and no weight logic.
- **OCP** — the dam is EXTENDED (a scoped exemption + new assertions), never rewritten; its existing
  detectors stay intact. New behavior is added alongside.
- **DRY** — reuse the existing `world-anchored-recall-cli.js` (subprocess target), `renderLesson` +
  `renderFencedBoundedBlock` (sanitizers), `isWorldAnchorArmed()` / `custody-arming.js` (arming detection),
  the asymmetric strict-truthy flag parser. Invent NO new hasher, sanitizer, arming signal, or CLI.
- **KISS** — a thin execFile boundary; no new abstraction layer.
- **YAGNI** — SHADOW half only. No persona pins, no export, no cross-uid deployment code (operator's job),
  no live round-trip. Each is a named later wave.

## Files To Modify

| File | Action | What |
|---|---|---|
| `packages/lab/persona-experiment/recall-inject-boundary.js` | **NEW** | the audited bridge: read a cross-uid-deployed signal (asymmetric strict); if not deployed → return empty (fail-closed, observable emit); else execFile `world-anchored-recall-cli.js` under the custody holder, parse its nodes, sanitize (`renderLesson`→`renderFencedBoundedBlock` + unicode guard), return ONLY a fenced advisory DATA block or empty. Never a weight, never a record mutation. |
| `tests/unit/lab/persona-experiment/drafter-recall-disjointness.test.js` | **UPDATE (extend, not relax)** | (a) exempt `recall-inject-boundary.js` from the `literal-spawn-path` token scan (the ONE audited file allowed to name the recall CLI); (b) KEEP the resolved-require + computed-require bans on it (subprocess-only, no static lane import); (c) NEW asserts: boundary is in the drafter closure, does not statically require the lane, fail-closes to empty with no deployed signal, and its output goes through the sanitizer. |
| `packages/lab/persona-experiment/live-draft-run.js` | **WIRE** | at `:127-132`, set `extraContext` from `[personaBlock, recallBlock].filter(Boolean).join('\n\n')` (null when empty), `recallBlock` from the boundary, behind a NEW `LOOM_RECALL_INJECT` flag (asymmetric strict-truthy; typo fails CLOSED to the bare prompt). Import ONLY the boundary — never the recall lane. |
| `tests/unit/lab/persona-experiment/recall-inject-boundary.test.js` | **NEW** | fail-closed-empty (no deployed signal), sanitization (control-char/unicode strip + fence defang), injection-only (never a weight/mutation), byte-identical-bare-prompt-when-empty, asymmetric-flag (typo → closed). |

**Reuse, do NOT modify:** `world-anchored-recall-cli.js`, `grounding-slice.js` (`renderLesson`),
`_lib/render-fenced-bounded-block.js`, `world-anchor-arming.js`, `custody-arming.js`, `custody-verify-key.js`.

## Phases

1. **Boundary module** — `recall-inject-boundary.js`: the deployed-signal read (fail-closed + observable
   emit), the cross-uid execFile of the recall CLI, node parse, the H5 sanitizer composition
   (`renderLesson` stripControlChars → `renderFencedBoundedBlock`) + the H7 unicode-category guard
   (bidi/zero-width), injection-only output.
2. **Dam update** — extend `drafter-recall-disjointness.test.js` per Files To Modify (exempt the boundary
   from the spawn-literal scan; keep require-bans; add the four new asserts). Re-prove non-vacuity: the
   exemption must NOT let a real lane require through the boundary.
3. **Wire** — `live-draft-run.js:127-132` combine behind `LOOM_RECALL_INJECT` (asymmetric strict).
4. **Tests** — the new boundary test suite + confirm the dam is green + the full disjointness suite passes.

## Verification Probes

Grounded against current `main` (2026-07-10, post-#565, 7 commits fresh):

- Probe: `grep recall` in `live-draft-run.js` / `live-solve-one.js` → 0 (the wire is missing — the crux).
- Probe: `world-anchored-recall-cli.js` EXISTS (`packages/lab/causal-edge/`, 4480 bytes; flags `--trigger-class <str>` + `--limit <int>`; `main(process.argv.slice(2))`) — the subprocess target is real.
- Probe: `live-draft-run.js:127-132` → `extraContext` is assembled from the persona block only (`m.block`); the recall block slots here.
- Probe: `renderLesson` at `grounding-slice.js:99` (calls `stripControlChars` :83); `renderFencedBoundedBlock({header,lines,maxBytes})` at `persona-experiment/_lib/render-fenced-bounded-block.js:57` (defangs fences, header newline-collapse) — the sanitizers exist; compose in that order (H5).
- Probe: `drafter-recall-disjointness.test.js` (224 lines) checks the TRANSITIVE closure of `DRAFTER_ENTRY` + `EGRESS_ENTRY`; `FORBIDDEN_LITERAL_TOKENS` includes `world-anchored-recall`; `findLaneReference` flags ANY closure string literal containing that token → **the boundary naming the CLI trips this unless exempted** (the load-bearing dam-update detail).
- Probe: `isWorldAnchorArmed()` reads `LOOM_WORLD_ANCHOR_ARM` (strict-truthy); `custody-arming.js` `armingDecision()` is the both-or-neither gate that EMITS observably before a dark return; `resolveCustodyVerifyKey` fails closed on no-uid/foreign-owned. The recall CLI ALREADY calls `isWorldAnchorArmed()` — the boundary reuses this arming model, inventing no new signal.
- Probe: `weight-source-gate.js:55` → `LIVE_SOURCES = Object.freeze(isWorldAnchorArmed() ? [WORLD_ANCHOR_SOURCE] : [])` — SHADOW dam is a two-gate AND; the recall CLI returns empty (weight 0 → `instincts:[]`) until arming, so even a spawned subprocess yields empty in SHADOW.

## Out of Scope (Deferred)

- **The cross-uid subprocess DEPLOYMENT** — provisioning the custody uid + the deployed cross-uid signer is
  OPERATOR arming (never Claude; never touches `/etc/loom`, an arming flag, or `--attested-cross-uid`).
- **The live recall round-trip** — recall actually influencing a solve is arming-gated by construction.
- **A2 (persona-context pins + persona-into-signed-basis + `recall_graph_root`)** — blueprint Waves 2-3, a later PR.
- **A3 (the toolkit→Embers export seam + byte-parity)** — blueprint Wave 4, a later PR (cross-repo coordination).
- **KB-body inlining** and the **`LOOM_PERSONA_MATERIALIZE` flip** — named behavioral changes, separate waves.
- **`(repo × trigger_class)` hard-filtering** — board A2/M1: Wave 1 recall is `trigger_class`-sort-preference
  only, explicitly NOT project-scoped; hard-filtering + the Embers `kindle` read-back is a later wave.

## Drift Notes

- route-decide returned `borderline` on this security-class task — the stakes lexicon under-weights
  "injection channel" / "cross-uid boundary". Escalated by judgment (candidate: dictionary-expansion).
- The recon MISSED the dam once already (blueprint F1, `drift:recon-depth`). This plan re-probed the dam
  firsthand against current main and centers the design on satisfying it.

## Open questions (resolve in /verify-plan)

1. **Deployed-signal mechanism** — does the boundary (a) spawn the CLI only when a configured custody-uid +
   the arming decision indicate cross-uid deployment (fail-closed-empty otherwise, never spawning in SHADOW),
   or (b) always attempt the subprocess and rely on the CLI's own empty-until-armed return? Recommendation:
   (a) — gate the spawn on the deployed signal so SHADOW/CI never spawns, and the reject is observable.
2. **Dam-exemption safety** — is exempting the boundary from the spawn-literal scan (while keeping the
   require + computed-require bans) sufficient to preserve the invariant? The hacker lens must confirm no new
   false-negative (an author cannot smuggle a lane import through the one exempted file).
3. **H7 unicode guard scope** — which categories (bidi controls, zero-width) beyond `stripControlChars`, and
   is the guard in the boundary or pushed into `renderLesson` (shared)?

## Pre-Approval Verification

A 3-lens board (architect + code-reviewer + hacker, security tier per Rule 2), each premise-probing the plan
against the tree with live PoCs. **Verdicts: architect SOUND-WITH-NOTES; code-reviewer NEEDS-REVISION; hacker
NEEDS-REVISION.** The structure is sound (boundary module, subprocess-not-import, dam extended-not-relaxed,
byte-inert-until-armed) — but four load-bearing corrections must be folded before build. **This section is
AUTHORITATIVE over the body above where they conflict.** Every finding below was re-confirmed firsthand.

### CRITICAL / HIGH — fold before build

- **[CRITICAL] The dam exemption is a laundering hole (hacker CRITICAL-1 + code-reviewer HIGH-1, firsthand-confirmed).**
  A FILE-level skip of the boundary from the `literal-spawn-path` scan (a) silently permits the OTHER three
  forbidden tokens (`weight-source-gate`, `admit-world-anchor-node`, `build-spawn-context`) in that file, and
  (b) opens an absolute/bare-specifier lane-`require` hole: the dam's `relativeRequires` matches only `.`-prefixed
  requires (probed: 0 matches on an absolute path), and `firstComputedRequire` matches only non-quote args, so an
  `require('/abs/.../world-anchored-recall.js')` in the exempted file evades ALL detectors. **Resolution:** scope
  the exemption to the EXACT token `world-anchored-recall` at the `execFile` callsite ONLY (keep the other 3 tokens
  live on the boundary); ADD an absolute/bare-specifier lane-basename require detector for the boundary file (close
  the V4 residual there); re-prove non-vacuity (a smuggled lane require of ANY form in the boundary still trips RED).
- **[HIGH] `renderLesson` / `stripControlChars` are NOT exported (all 3 lenses, firsthand-confirmed).** The plan's
  "reuse renderLesson, do NOT modify grounding-slice.js" is contradictory, and importing `grounding-slice.js` drags
  its store-touching closure into the drafter (latent dam coupling). **Resolution:** extract a pure shared leaf
  `packages/lab/persona-experiment/_lib/strip-and-render-lesson.js` (control-char strip + the H7 unicode guard +
  single-line render), consumed by BOTH the boundary and `grounding-slice.js` (which is refactored to use it —
  moved INTO Files-To-Modify). Mirrors the existing `render-fenced-bounded-block.js` extraction.
- **[HIGH] The spawn-gate is grounded on the wrong layer (architect #2 + hacker HIGH-2, firsthand-confirmed).**
  `custody-arming.js` / `LOOM_WORLD_ANCHOR_ARM` govern the CLI's internal WEIGHT/key gate; gating the SPAWN on the
  armed-decision fires SAME-UID on a same-uid armed box → reopens the H1 co-forge surface the boundary exists to
  close (and `LOOM_WORLD_ANCHOR_ARM` is same-uid-settable). **Resolution (OQ1 resolved):** gate the spawn on
  cross-uid-launcher PRESENCE via the `host-claude-guard.js` model (`resolveCrossUidPresence` / `actorKeyMarkerPresent`
  = `/etc/loom/actor-anthropic.key` + a deploy fact), absent in SHADOW → fail-closed-empty; assert boundary-level
  emptiness INDEPENDENT of the CLI's downstream emptiness. Name the cross-uid mechanism: the deployed `sudo -n -u`
  launcher (`crossUidJudgeArgs` via `loom-actor-launch`, lazy-loaded only on a deployed box); in SHADOW it is
  absent so the boundary never spawns.
- **[HIGH] Bidi / zero-width / format chars survive `stripControlChars` (hacker HIGH-1, architect-confirmed).**
  It keeps every codepoint >= 0x20, so U+202A-202E / U+2066-2069 / U+200B-200D / U+FEFF pass into the actor prompt
  (prompt-injection surface). **Resolution (OQ3 resolved):** the H7 guard strips the Unicode `Cf` category + bidi
  isolates BEFORE render, IN the shared `_lib` leaf, so both arm-C and the boundary inherit it. `defangFences` does
  not help (fence sentinels only).

### MEDIUM — fold into the build/test plan

- **Subprocess hardening (hacker MEDIUM-2):** `execFileSync` with an argv ARRAY (never `sh -c`), the CLI path an
  ABSOLUTE constant from `__dirname` (never CWD/env), explicit `timeout` + `maxBuffer`. `--trigger-class` from
  attacker-controlled issue text must reach the CLI as an argv element (re-validated at `world-anchored-recall-cli.js:38`).
- **Emit taxonomy (hacker MEDIUM-1, the `drift:fail-silent` class):** emit ONLY on reason-bearing/tamper rejects
  (deploy-signal-set-but-spawn-failed, CLI non-zero exit, `JSON.parse` throw, timeout); SILENT on the benign
  clean-SHADOW empty (mirror `custody-arming.js:49-50`).
- **Subprocess-failure tests (code-reviewer #5):** explicit cases — subprocess throws / times out / malformed-or-truncated
  JSON / non-zero exit → all return empty.
- **Combination-logic regression test (code-reviewer #6):** `live-draft-run.js`'s `extraContext` refactor (persona ×
  recall, on/off × on/off) needs a test proving the `LOOM_PERSONA_MATERIALIZE` byte-identical-when-off guarantee
  survives; the current path is untested.

### LOW — note

- **Flag parser (code-reviewer #7 / hacker charge #3 HELD):** `LOOM_RECALL_INJECT` reuses `normalizeBool` (STRICT:
  only `1/true/yes/on`) so a typo fails CLOSED to the bare prompt (probed: `normalizeBool('ture')=false`). Never wire
  the LENIENT `isDeployFlagSet` onto the enable branch.
- Recon-completeness: the board confirmed the SECOND dam (`shadow-import-graph.test.js`, store-import + admission-fn)
  does NOT trip (the boundary imports no store, calls no admission fn) — state this in the build (blueprint F1 got
  burned once by missing a dam).

### Held-by-design (no change)

- #273 (hacker charge #6): the boundary is injection-only, gates nothing, never mutates the graded record, reads no
  `weight`/`ranked` field — it does not derive trust from existence. The residual (a co-forged body can reach the
  prompt post-arming) is tolerable ONLY because recall gates nothing; VALIDATE must confirm the built boundary reads
  no weight/ranked field as a decision input.

### Net

**NEEDS-REVISION → resolved here.** The four CRITICAL/HIGH resolutions change what the module imports (the shared
leaf), what signal it gates on (cross-uid presence, not weight-arming), and how the dam exempts it (token-scoped +
absolute-require detector). All are surgical, not a redesign; the boundary-module structure stands. The MEDIUM/LOW
items fold into the build + test plan. Per Rule 2a, the **hacker lens re-probes the BUILT diff at VALIDATE** (the
dam exemption, the same-uid spawn gate, the sanitizer, argv-hardening) — a green suite is not proof. Ready to build
on USER approval.

## VALIDATE result (post-build 3-lens, on the BUILT diff)

Security-tier board (code-reviewer + hacker + honesty-auditor), each premise-probing the built code with
live probes per Rule 2a. **Verdicts: code-reviewer NEEDS-REVISION; hacker NEEDS-REVISION; honesty-auditor
MINOR-OVERCLAIMS (A-, 9/9 load-bearing resolutions confirmed in code).** All findings folded; re-probed.

### Folded (with re-probe evidence)

- **[CRITICAL/HIGH] Backtick + string-concat require evaded the dam** (code-reviewer HIGH + hacker C1/H1,
  empirically proven: appending `` require(`../causal-edge/world-anchored-recall.js`) `` to the real boundary
  kept the suite 8/8 GREEN while statically importing the lane). `boundaryLaneRequire`'s regex was quote-only;
  `relativeRequires` + the computed-require ban likewise. **Fix:** all require-scanners are now
  backtick/concat/interpolation/whitespace-aware; `boundaryLaneRequire` is import-transparent (any non-plain
  static require in the boundary is refused); `laneLiteralHit` strips comments first and exempts ONLY the exact
  CLI-path shape (`/world-anchored-recall-cli(\.js)?$/`), so the recall MODULE literal still trips. **Re-probed
  on the real boundary: both a backtick and a string-concat lane require now drive the dam RED** (dam test 9).
- **[MEDIUM] C1 controls (U+0080-009F: NEL, CSI) leaked through the sanitizer** (hacker M1). **Fix:**
  `stripControlChars` now drops 0x80-0x9f; the new leaf test + the boundary H7 test cover it.
- **[MEDIUM] exec hardening untested** (code-reviewer): added a test capturing the exec options (asserts
  `timeout`/`maxBuffer`/`encoding` are threaded).
- **[MEDIUM] no standalone leaf test** (code-reviewer): added `strip-and-render-lesson.test.js` (C0/DEL/C1 +
  Cf/bidi + truncation), all vectors built via `String.fromCharCode` (pure-ASCII source).
- **[LOW/honesty] wire "byte-identical" test asserted only mark-absence** (honesty-auditor): strengthened to
  `p === buildActorPrompt(record)` (the load-bearing SHADOW invariant is now a real equality check).
- **[LOW/honesty] "byte-inert" comment overstated** (honesty-auditor): precised - the flag-OFF default returns
  before any launcher/stat; only the flag-ON-clean path stats the deploy marker.

### Held SOUND (positive evidence)

Same-uid spawn (execFn never fires; `present`-without-injected-builder fails closed + emits), the asymmetric
flag (all typos fail closed), the observability taxonomy (benign clean silent; every reason-bearing reject
emits a distinct token), injection-only / #273 (reads no weight/ranked field; block is identical with/without
weights). Verified by live probe, not just the suite.

### Residuals (named, not silent)

- **VS / homoglyph (hacker L1, LOW):** variation selectors (category Mn) survive - stripping Mn broadly would
  corrupt legitimate combining marks in non-ASCII lesson text, so it is NOT stripped. Cosmetic; noted for the
  arming review. Recall is SHADOW/advisory and gates nothing, so the blast radius is bounded.
- **grounding-slice consumer:** the shared leaf's sanitize contract is tested directly (the leaf test); arm-C
  routes through `renderLessonLine` (verified by its 17 green tests + the diff), so it inherits the fix.

### Gates

Track A suites all green (leaf 4/0, boundary 16/0, wire 6/0, dam 9/0), persona-wire regression 21/0,
grounding-slice green; eslint clean (0 disables); zero non-ASCII in source; signpost + markdownlint +
release-surface clean. One unrelated pre-existing lab failure (`live-loop-run.js` vacuity-trap) is
host-dependent (actor-key + docker-attestation present) and fails IDENTICALLY on pristine origin/main -
proven via a worktree; out of scope for this PR.
