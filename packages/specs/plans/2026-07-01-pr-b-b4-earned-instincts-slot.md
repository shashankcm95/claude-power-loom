# PR-B B4 — the spawn-context `## Earned instincts` fail-open slot (SHADOW)

Status: pre-build. Date 2026-07-01. Wave B4 of PR-B (scope `research/2026-06-30-pr-b-rubicon-scope.md` §3).
B1 (#474) / B2 (#475) / B3 (#477) merged. B4 wires B3's recall retriever into the runtime spawn-context
builder as a 4th, fail-open context class.

## 0. What B4 is (and is NOT)

**Is:** a 4th context class `## Earned instincts` in `packages/runtime/orchestration/build-spawn-context.js`
that invokes B3's CLI (`world-anchored-recall-cli.js`) via `invokeNodeJson` (SUBPROCESS — the SAME pattern
the file already uses for its 3 sub-primitives), renders the surfaced instincts, and **fails OPEN** (a recall
miss / B3 error / empty result degrades to today's behavior — the section renders "(none)" and the spawn
context is still produced; recall is enrichment, never a gate on whether the spawn happens).

**Is NOT:** a runtime→lab `require`. The call is a subprocess (`node <B3-cli> ...`), so the layer boundary
stays clean — there is still ZERO runtime→lab import (confirmed: `grep` runtime for a lab require → none).

**Is NOT:** a task→trigger_class classifier. B4 passes NO `trigger_class` (B3 then ranks by weight — a valid
degenerate mode). The detector's signal vocab does NOT align with the frozen `TRIGGER_CLASS` (only
`state-mutation` overlaps; `module-boundary` ≠ `boundary-contract`), so a task→trigger bridge would be a lossy
1-of-4 mapping. The real classifier is the INSTINCT GAP (gap-map item 4) — deferred with a named residual.

**SHADOW:** B3 resolves no keys + `LIVE_SOURCES` frozen-empty → `retrieveWorldAnchoredInstincts` returns
`instincts: []` on every dev/CI box → the section always renders "(none)". B4 changes NO trust property.

## 1. Runtime Probes (firsthand, HEAD `9219444`)

| Claim | Probe → observed |
|---|---|
| build-spawn-context already invokes sub-primitives via `invokeNodeJson`/`invokeNodeText` (subprocess, fail-open per ADR-0001) | Read `build-spawn-context.js:58,77,107,112,130` |
| the file SELF-EXECUTES at module scope (CLI runs on require; no `require.main` guard) → not requirable for a unit test | Read `build-spawn-context.js:249-287` (parseArgs + buildContext + console.log at top level) |
| the file has NO `module.exports` (HT.1.9 dropped 3 as 0-consumer) | Read `build-spawn-context.js:289-294` |
| the detector signals do NOT match `TRIGGER_CLASS` (no clean task→trigger bridge) | `grep` detector: `state-mutation` (:180) present, but `module-boundary` (:257) ≠ `boundary-contract`; TRIGGER_CLASS = boundary-contract/data-parse/api-shape/state-mutation |
| runtime orchestration CLIs are tested via `spawnSync(process.execPath, argv)` | `tests/unit/runtime/orchestration/quality-factors-backfill-validation.test.js:28,95` |
| B3 CLI contract: single JSON `{instincts, ranked, shadow_empty, diagnostics}` to stdout; no keys → empty | `world-anchored-recall-cli.js`; B3 test SHADOW proof |
| ZERO runtime→lab require today (B4's subprocess keeps it that way) | `grep -rE "require\(['\"][^'\"]*\.\./lab/" packages/runtime` → none |

## 2. Design

**Modify `packages/runtime/orchestration/build-spawn-context.js`:**

1. `RECALL_PATH` = `packages/lab/causal-edge/world-anchored-recall-cli.js` (a new hardcoded path constant,
   mirroring `DETECTOR_PATH`/`ADR_PATH`/`KB_RESOLVER_PATH`). **Hardcoded, NOT env-overridable** (an
   env-injectable script path fed to `node <path>` is an RCE seam — the hacker lens's concern; keep it a
   constant like its 3 siblings).
2. `fetchEarnedInstincts({ limit })` → `object[]`: `invokeJson(RECALL_PATH, ['--limit', String(limit)])`;
   returns `result.instincts` when it's an array, else `[]` (fail-open: null on B3 error/timeout → `[]`).
   NO `trigger_class` arg (item-4 deferral). Bounded `limit` (default 5).
3. `buildContext` adds `earned_instincts: fetchEarnedInstincts({ limit: EARNED_LIMIT })` to the ctx object.
4. `formatEarnedInstincts(instincts)` (PURE) → section lines: for each, `- <lesson_body> [trigger:
   <trigger_class>, weight <w>]`; empty → `## Earned instincts: (none — no world-anchored lessons surfaced)`.
   `formatText` calls it; `formatJson` already emits `ctx.earned_instincts` (it stringifies the whole ctx).
5. **Enabling refactor (testability):** wrap the module-scope CLI block (`build-spawn-context.js:249-287`) in
   `if (require.main === module) { ... }` and add `module.exports = { formatEarnedInstincts }` (a REAL test
   consumer — not the speculative 0-consumer exports HT.1.9 dropped). This also fixes a latent gap: the file
   currently cannot be required without self-executing + `process.exit`.

**Fail-open chain (three layers, none blocks the spawn):** `invokeNodeJson` returns null on any B3
error/timeout (ADR-0001) → `fetchEarnedInstincts` maps null→`[]` → `formatEarnedInstincts([])` renders
"(none)" → the existing top-level `try/catch` (`:283-287`) is the final net. A B3 failure NEVER throws out of
`buildContext`.

## 3. Test plan (`tests/unit/runtime/orchestration/build-spawn-context-earned-instincts.test.js`, new)

- **SHADOW-empty end-to-end (the load-bearing wire test):** `spawnSync(build-spawn-context --task "..." --format json)`
  with a pinned-empty `LOOM_LAB_STATE_DIR` → exit 0, `earned_instincts: []`, and the text format shows
  `## Earned instincts: (none...)`. Proves: B4 calls the REAL B3 CLI (subprocess), gets empty in SHADOW, and
  produces the context without error. A genuine runtime→lab dogfood.
- **Fail-open:** even if B3 were absent/broken, the spawn context is still produced (exit 0, section "(none)").
  (Simulate via a task that yields no signals; assert the section is present + empty + the rest of the context
  renders.)
- **`formatEarnedInstincts` (pure unit, via the new export):** synthetic instincts → renders `lesson_body` +
  `trigger` + `weight` lines; `[]` → the "(none)" line. Proves the post-arming rendering shape.
- **Layer:** assert (grep) build-spawn-context.js does NOT `require` a lab module (the wire is subprocess-only).

## 4. Residual + open questions for the VERIFY board

- **#273 UNCHANGED** — B4 surfaces nothing in SHADOW (B3 empty); no new trust surface. Closes at B5-arming.
- **Q-QUERY (architect):** pass no `trigger_class` (recommended — defer the classifier to item-4) vs a partial
  `state-mutation`-only bridge (inconsistent 1-of-4). Recommend defer.
- **Q-REFACTOR (architect/reviewer):** is the `require.main` guard + single `formatEarnedInstincts` export the
  right testability enabler, or should the wire be tested subprocess-only (no export)? Recommend the guard
  (it fixes a real requirability gap + gives pure-renderer coverage with no RCE seam).
- **Q-FAILOPEN (hacker):** confirm no path where a B3 subprocess error/hang/huge-output blocks or crashes the
  spawn-context build (invokeNodeJson has a timeout + returns null; the section + top-level catch are the nets).

## Drift Notes
- The scope's B4 line asked "resolve whether the read is keyed on target persona" — recon answered it: NO
  honest bridge exists (detector vocab ≠ lesson taxonomy), so defer. Another "recon re-probes the scope" data point.

## Pre-Approval Verification (VERIFY board — 3-lens, 2026-07-01)

architect **SHIP** + code-reviewer **SHIP** + hacker **NEEDS-REVISION**, converging on ONE substantive
fold: **B4 is the code that renders `lesson_body` into a spawned-agent prompt, and it must sanitize it.**

### Board findings + disposition

| # | Lens | Sev | Finding | Fold |
|---|---|---|---|---|
| 1 | hacker | HIGH (architect MED) | `formatEarnedInstincts` renders raw `lesson_body` (attacker-controllable ≤4096 via same-uid co-forge, admits at B2 until B5 deploy-close). A body `\n\n## SYSTEM OVERRIDE\n…` forges a section header + injects into a spawned agent's prompt at B5-arming. SHADOW hides it + no SHADOW-empty test exercises the render-a-body path → ships dark + un-probed | **V1** — sanitize at the render sink (SINK-appropriate, NOT a blocklist — kb design-pushback): strip control chars, FLATTEN all whitespace/newlines to a single space, hard length-clamp (independent of the store's 4096). Build NOW (B4 authors the sink). Test: a `## OVERRIDE`-bearing synthetic instinct → the render has NO newline + opens NO new markdown section |
| 2 | hacker | LOW | `formatEarnedInstincts` is exported; a future caller could hand it `ranked`/a hand-built array with a weight-0 body | **V2** — defensively drop `!(weight > 0)` entries at the renderer entry (belt on the export seam) |
| 3 | architect | LOW | pin B3's exact ranked-item shape as the render contract | **V3** — the pure-render test uses a synthetic item with B3's exact keys (`node_id, lesson_signature, trigger_class, lesson_body, verdict, source, weight`) |
| 4 | reviewer | LOW | `fetchEarnedInstincts` null/shape guard under-specified (`result.instincts \|\| []` would pass a non-array) | **V4** — `Array.isArray(result && result.instincts) ? result.instincts : []`; belt `Array.isArray` at the renderer entry too |
| 5 | reviewer | LOW | the `formatText` insertion point is unstated | **V5** — insert `## Earned instincts` AFTER the `## Active ADRs` block, BEFORE the `=== END SPAWN CONTEXT ===` push (`build-spawn-context.js:222`) |
| 6 | reviewer | LOW | no named "require does not self-execute" test | **V6** — a test that requires the module with no CLI args and asserts no throw/exit (pins the §2.5 requirability fix) |
| 7 | reviewer | LOW | B3 subprocess timeout inherits 5000ms default | **V7** — PROBED: B3 CLI SHADOW wall-clock = **40ms** (`/usr/bin/time`), vast headroom under 5000ms. No change; documented |
| 8 | architect | build-caveat | the `require.main` guard must wrap the ENTIRE exec block incl. `parseArgs`/usage/`process.exit`, not just the `try` | **V8** — build accordingly |
| 9 | architect | build-caveat | `limit` must be a bounded integer CONSTANT, never caller-threaded (else the render could be dialed to a large weight-0 enumeration once live) | **V9** — `EARNED_LIMIT = 5` constant |

Q-QUERY (defer classifier), Q-REFACTOR (require.main + single export), Layer (subprocess = 0 runtime→lab
imports), Fail-open (4 independent nets): ALL confirmed by the board against the code. RCE-seam / DoS / hang /
output-confusion / require-refactor / gate-off: all PROBED-and-HELD by the hacker.

## VALIDATE result (post-build 2-lens board, 2026-07-01) — BOTH SHIP

hacker (Rule-2a, 7 live probe scripts) **SHIP** + code-reviewer **SHIP**. The prompt-injection defense is
"airtight for its threat model" — the load-bearing insight is the **bullet-prefix invariant** (`- ` prepended
to every sanitized body → no attacker input ever opens at column 0, so a forged `##`/sentinel stays trapped).
All newline-class vectors (LF/CRLF/U+2028/U+2029/VT/FF/TAB) neutralized; SHADOW-empty + fail-open confirmed on
the real wire; the export exposes only `formatEarnedInstincts`.

Folds (all LOW/MED — the sink is security-sensitive, so hardened now):
- **W1** (reviewer MED + hacker LOW): the `slice(0, 240)` clamp was UTF-16-unit based → an astral char at the
  boundary split into a lone surrogate that stdout mangles to U+FFFD. Fixed → CODE-POINT clamp (`Array.from`).
  Test: utf8 round-trip lossless at the boundary.
- **W2** (hacker LOW, "extend-the-fix-to-siblings"): the char-loop stopped at 0x7F → C1 controls (NEL U+0085)
  + Unicode format chars (ZWSP/BOM/soft-hyphen) survived raw. Fixed → the sanitizer now uses a Unicode-property
  regex `[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]` (comprehensive; `\p{}` doesn't trip `no-control-regex`). Test: NEL/ZWSP/BOM.
- **W3** (hacker LOW, export-seam only, unreachable via the JSON wire): a hand-built hostile item with a
  throwing getter propagated out of `formatEarnedInstincts` → `main()` catch → `process.exit(1)`, losing the
  WHOLE context (fail-CLOSED). Fixed → whole-body try/catch → fail-OPEN to "(none)". Test: throwing getter.
- Reviewer LOWs (unconditional subprocess per buildContext; JSDoc field list): NOTED — the ~40ms SHADOW cost is
  fine; revisit an opt-out param at B5 when recall is real. No change now.

Post-fold gate: B4 test **12/0**, runtime **27/0**, kernel+lab **0 failed**, eslint/signpost clean,
`install --hooks --test` **129/0**, smoke-h8 build-spawn-context **3/3** (with `SCRIPT_DIR` set).

### RESOLVED DESIGN (as-built)

**`formatEarnedInstincts(instincts)` (PURE, exported):**
- `list = (Array.isArray(instincts) ? instincts : []).filter(it => it && Number.isFinite(it.weight) && it.weight > 0)` (V2+V4).
- empty → `## Earned instincts: (none — no world-anchored lessons surfaced)`.
- else → header `## Earned instincts (world-anchored, N)` + per-item `- ${sanitizeLine(lesson_body)} [trigger: ${sanitizeLine(trigger_class)}, weight ${weight}]`.
- `sanitizeLine(s)` (V1, sink-appropriate): `String(s ?? '')` → replace `[ -]+` (ALL control chars incl `\n\r\t`) with a space → collapse `\s+` to one space → trim → clamp to `MAX_LINE = 240` chars (`+ '...'` if longer). Flattening kills the newline the header/sentinel forge needs; the clamp bounds the line. Applied to BOTH `lesson_body` and `trigger_class` (defense-in-depth, though trigger_class is a closed enum from B3).

**`fetchEarnedInstincts()` → `object[]`:** `invokeJson(RECALL_PATH, ['--limit', String(EARNED_LIMIT)])` → `Array.isArray(r && r.instincts) ? r.instincts : []`. NO `trigger_class` (item-4 defer). `RECALL_PATH` hardcoded (V-hacker HELD).

**`buildContext`** adds `earned_instincts: fetchEarnedInstincts()`; **`formatText`** inserts the section per V5;
**CLI block** wrapped in `if (require.main === module) { … }` (V8) + `module.exports = { formatEarnedInstincts }`.
