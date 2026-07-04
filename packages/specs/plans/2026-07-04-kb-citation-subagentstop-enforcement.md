# Plan — Restore async KB-citation enforcement via a SubagentStop gate (follow-up 1 of #508)

- **Date**: 2026-07-04
- **Branch**: `feat/kb-citation-subagentstop-enforcement` (off fresh `origin/main` @ `a93fc77`, includes #508)
- **Class**: kernel hook (enforced layer) — new PostToolUse-sibling on the `SubagentStop` event. Fail-soft (ADR-0001).

## Problem (the #508 coverage gap)

PR #508 fixed the false-positive by making `kb-citation-gate.js` (PostToolUse:Agent) SKIP async-launch stubs — because that hook only ever sees the launch ack for async spawns, never the response. Correct, but it left async architect responses **unenforced** (a tracked coverage gap). Async is the common case, so KB-citation enforcement was effectively dark for architects.

This restores enforcement via the completion event PostToolUse can't substitute for: **`SubagentStop`**.

## Runtime Probes (firsthand — isolated `claude -p` spikes + docs cross-check)

| Claim | Probe | Result |
|---|---|---|
| SubagentStop fires for subagents | isolated settings.json + real subagent spawn | ✅ fires (sync) |
| SubagentStop fires for **async/background** subagents | forced `run_in_background:true` spawn | ✅ fires (probe 2, event #1) even though PostToolUse only saw the `async_launched` stub |
| Payload carries the response text | dumped stdin | ✅ `last_assistant_message` = the subagent's final message verbatim (no transcript parse needed) |
| Payload carries the agent type | dumped stdin | ✅ `agent_type` (e.g. `general-purpose`; plugin agents → `plugin:name`) |
| Can it BLOCK, and what does block do | capture hook emitted `{decision:'block',reason}` | ✅ **self-correcting**: the subagent CONTINUED and appended the missing `## KB Sources Consulted`; the corrected text reached the parent (probe 2, event #2) |
| Loop guard | observed re-fire | ✅ `stop_hook_active` flips to `true` on the block-induced re-fire → block only when `false` gives exactly ONE forced retry (docs: 8-block cap, `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`) |
| Plugin can register SubagentStop | code.claude.com/docs plugins-reference | ✅ DOCUMENTED — plugin `hooks.json` supports `SubagentStop`, same shape as the existing `Stop`/`PostToolUse` entries |
| Matcher | docs | agent type; plugin-scoped `^plugin:agent$` regex supported (we filter in-code with `matcher:"*"` for robustness) |
| `last_assistant_message` complete for a LONG reply? | probe 3b (9.6KB reply, ONE sample) | ✅ untruncated at `msg_len:9630`, trailing `## KB Sources Consulted\n- kb:…` present, `has_kb:true`. Truncation boundary (if any) uncharacterized; a truncated-but-nonempty message would false-block → self-correct once → yield. No transcript-tail fallback; fail-soft on empty. |

Full payload shape (SubagentStop): `{session_id, transcript_path, cwd, prompt_id, permission_mode, agent_id, agent_type, hook_event_name:'SubagentStop', stop_hook_active, agent_transcript_path, last_assistant_message, background_tasks, session_crons}`.

## Design — `kb-citation-subagent-stop.js` (new hook, self-correcting)

New PostToolUse-sibling on `SubagentStop`. Logic:

1. Read payload. If `hook_event_name !== 'SubagentStop'` → `{}` (defensive).
2. **Loop guard**: if `stop_hook_active === true` → emit `{}` (already forced one retry; allow stop). FIRST, before any check.
3. Normalize `agent_type` (plugin-prefix split). If not in `KB_REQUIRED_SUBAGENTS` (architect) → `{}`.
4. Run the SAME compliance check as the PostToolUse gate on `last_assistant_message`: `## KB Sources Consulted` heading + ≥1 `kb:` ref.
5. Compliant → `{}` + log pass. Non-compliant → `{decision:'block', reason:'[KB-CITATION-MISSING] … append the ## KB Sources Consulted section with ≥1 kb: ref before finishing.'}` + log block (self-corrects the subagent).
6. Fail-soft: any error → `{}` (allow stop). Never brick a subagent close.

**DRY the compliance semantic.** Extract the shared "what is a compliant KB citation" logic (heading regex + `kb:` ref match + `KB_REQUIRED_SUBAGENTS` + `normalizeSubagentType`) into `packages/kernel/hooks/_lib/kb-citation-check.js`, imported by BOTH `kb-citation-gate.js` (PostToolUse) and the new SubagentStop hook — so the two gates can never diverge on what "compliant" means. (Architect VERIFY to confirm DRY-vs-duplicate; the repo has a deliberate-duplication precedent in `spawn-record.js`, but a compliance semantic that MUST match across two enforcers is the DRY case.)

### Interaction with the PostToolUse gate (compose, don't double-block)

Timeline (probe 1): SubagentStop fires ~50ms BEFORE PostToolUse:Agent. So:
- **Sync architect**: SubagentStop self-corrects FIRST → PostToolUse:Agent then sees the corrected response → approves. No double-block. If self-correction is exhausted (stop_hook_active cap) and still KB-less, PostToolUse's existing sync block is the backstop.
- **Async architect**: PostToolUse skips the stub (#508); SubagentStop enforces. Gap closed.

Net: **additive**. The PostToolUse gate is unchanged (keeps its sync backstop); SubagentStop adds the primary self-correcting enforcement for both sync and async. (Consolidating to a single enforcer is a possible future simplification — noted, not done, to avoid reverting fresh #508 work.)

## Test plan (TDD)

New `tests/unit/hooks/kb-citation-subagent-stop.test.js` (piping SubagentStop envelopes through the hook binary via stdin, hermetic log via `LOOM_KB_CITATION_LOG_PATH`):
1. architect, KB-less `last_assistant_message`, `stop_hook_active:false` → **block** (reason has `[KB-CITATION-MISSING]`).
2. architect, compliant `last_assistant_message` → `{}` (approve/allow-stop).
3. architect, KB-less, `stop_hook_active:TRUE` → `{}` (loop guard — do NOT block a second time). LOAD-BEARING.
4. non-architect (general-purpose), KB-less → `{}` (not KB-required).
5. plugin-prefixed `power-loom:architect`, KB-less → block (normalization).
6. missing/empty `last_assistant_message` → fail-soft `{}` (don't block on absent data).
7. malformed stdin / non-SubagentStop event → `{}`.
8. numbered heading `## 7. KB Sources Consulted` → approve (same tolerance as the PostToolUse gate — via the shared module).
9. Shared-module unit tests for `isKbCompliant` + `normalizeSubagentType` (the extracted semantic).
Plus: after extraction, re-run the existing `kb-citation-gate.test.js` (must stay 20/20 — the PostToolUse gate's behavior is unchanged).

## hooks.json

Add a `SubagentStop` block to `packages/kernel/hooks.json` (matcher `*`), registering `kb-citation-subagent-stop.js`. `timeout` small (≤5s). A `_comment` documenting the self-correcting-block + stop_hook_active guard + the #508 relationship.

## Pre-Approval Verification (architect VERIFY — APPROVE-WITH-CHANGES; all folds applied)

- **F1 (CRITICAL)** — SubagentStop is Stop-CLASS output: allow = `{}`, block = `{decision:'block',reason}`. The hook has its OWN `emitAllow()`/`emitBlock()`; it does NOT reuse the PostToolUse `emit()` (which emits `{decision:'approve'}`, invalid on Stop). Test S2 asserts `decision===undefined` on allow.
- **F2 (HIGH)** — persona read from the top-level `agent_type` (NOT `tool_input.subagent_type`). Test S10 is the inertness guard: an envelope with `tool_input.subagent_type='architect'` but no `agent_type` must ALLOW (proves the hook keys on `agent_type`), or the hook would be shipped-but-dark (ADR-0012 class).
- **F3** — extracted ONLY the compliance semantic (`isKbCompliant`/`normalizeSubagentType`/`KB_REQUIRED_SUBAGENTS`) to `_lib/kb-citation-check.js`; `extractResultText`/emit/async-stub logic stay per-hook. The PostToolUse gate re-uses the shared semantic (20/20 preserved). The "two gates agree" cross-fixture test makes the no-divergence invariant executable.
- **F5** — loop guard `stop_hook_active === true` (strict) FIRST; a malformed/absent value falls through to block-eligible (safe direction; harness 8-block cap backstops). Test S3 load-bearing.
- **F6a** — `last_assistant_message` run through a content-array-safe extractor (never `String()` an object). Tests S9a/S9b.
- **F6b** — empty message → `{}` + `skip-empty-message` log (`compliant:null`, not false). Test S6.
- **F6e** — literal `plugin:architect` shape tested (S5b).
- **F7** — keep-both-additive confirmed; PostToolUse gate unchanged (sync backstop). Cross-gate agreement + composition covered.
- **F6c (known limitation, deferred)** — a legitimate `n/a —` meta-edit architect response (heading present, 0 `kb:` refs per architect.md:189) is `compliant:false` → blocked → the self-correction could push a fabricated `kb:` ref. Pre-existing in the PostToolUse gate; SubagentStop makes it self-correcting rather than parent-flagged. NOT auto-fixed here (would change the shared semantic + #508 gate behavior; YAGNI absent frequency evidence). See Drift Notes + Follow-ups.

## VALIDATE result

**Real-path dogfood** (isolated `claude -p`, real hook registered as a SubagentStop hook, custom `architect` subagent):
- Fire 1 (`stop_hook_active:false`, KB-less architect): real hook emitted `{decision:'block', reason:'[KB-CITATION-MISSING]…append this section now…'}` ✅
- Fire 2 (`stop_hook_active:true`): real hook emitted `{}` ✅ (loop guard — one forced retry, no infinite loop)
- The revised final reply reaching the parent contained a `## KB Sources Consulted` heading ✅ — BUT honestly: the subagent CONTESTED the requirement at fire 2 ("the contract doesn't apply here … stands as-is") and added an n/a-style body, NOT genuine `kb:` grounding. This is a live instance of the F6c ambiguity (**shape-compliant, body-contested**). It did not fabricate a `kb:` ref that run, but the block forces the section SHAPE, not real grounding (see the presence-only note in `_lib/kb-citation-check.js`).

**Ordering probe** (honesty-lens fold): SubagentStop fired **53ms before** PostToolUse:Agent in the one sync sample (probe 1) — this is *observed* behavior, not a guaranteed contract; the "no double-block" composition rests on it, with the exhausted-retry case falling back to PostToolUse's sync block.

**3-lens VALIDATE**: code-reviewer APPROVE-WITH-CHANGES (2 LOW, inherited/deferred; confirmed the DRY refactor byte-identical, all 52 tests green, exactly-one-emit). hacker APPROVE-WITH-CHANGES (security-critical properties HELD — loop guard bounded, injection-clean, no hang; findings are enforcement false-negatives INHERITED byte-for-byte from #508). honesty-auditor APPROVE-WITH-CHANGES (claim-precision folds, below). Folded: `.trim()` in `normalizeSubagentType` (hacker LOW); presence-only note (hacker MEDIUMs, documented not changed — inherited + best-effort, not a security boundary); over-claim corrections (this section + hook comment); ordering probe row; F6c rationale corrected (below).

Suites: shared module 16/16; SubagentStop hook 16/16 (incl. cross-gate agreement); PostToolUse gate 20/20 (unchanged); full `tests/unit/hooks/` + kernel 118/118 GREEN; eslint clean; hooks.json valid; signpost regenerated.

## Drift Notes
- **F6c** — a legitimate `n/a — <justification>` meta-edit architect response (architect.md:189: allowed ONLY when the edited path is under `agents/`/`packages/runtime/personas/`/`packages/runtime/contracts/`/`swarm/run-state/` — a **structural, path-based criterion**) has the heading but 0 `kb:` refs → `compliant:false` → blocked, and the SubagentStop hook then pressures the subagent to satisfy a citation it is exempt from. **Corrected deferral rationale** (honesty-lens): the reason to defer is NOT "no frequency evidence" (it is a structurally-defined class, not speculative) — it is that `isKbCompliant` sees only the TEXT, not the edited path, so it CANNOT apply architect.md's structural test. A blanket `n/a —`-body tolerance would therefore be a BROAD bypass (any architect dodges with `n/a — excuse`), strictly worse than the narrow false-block (bounded to one retry; degrades to a contested-but-shape-compliant response; no fabrication observed). The correct fix needs the spawn's write-scope in the SubagentStop payload (not currently present), so it is deferred pending that — NOT a cheap regex change.

## Follow-ups
- Follow-up 2 of #508 (spawn-record.js async-stub blindness) — next.
- **Real-grounding hardening (hacker MEDIUMs, INHERITED from #508):** the compliance check is presence-only — it does not strip code fences (a fenced/illustrative `## KB Sources Consulted` example counts), does not `\b`-anchor the `kb:` token (`mykb:foo` matches), and does not verify ids resolve against the kb catalog. Harden the shared `isKbCompliant` (fence-strip + `\bkb:` + optional kb-resolver id validation) in a dedicated PR — it changes the shared semantic + #508's merged gate, so out of scope here.
- **Log-path hardening (hacker LOW):** `LOOM_KB_CITATION_LOG_PATH` is written without a within-root check (path traversal). Inherited + operator-scoped (unset in prod → default). Lift a shared, `checkWithinRoot`-guarded log writer that both gates adopt at once.
- **F6c write-scope fix:** add the spawn's edited-path write-scope to the SubagentStop enforcement so a legitimate structural `n/a —` meta-edit is exempted WITHOUT opening the blanket bypass.
- Possible future: consolidate PostToolUse + SubagentStop KB enforcement into one path.
