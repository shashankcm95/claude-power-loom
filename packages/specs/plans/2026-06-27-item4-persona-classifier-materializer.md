# Item 4 — issue->persona classifier + persona-prompt materializer (shadow-wired + materialization-proven)

Wave plan. Ladder item 4 of the autonomous-SDE bridge
(`packages/specs/research/2026-06-25-autonomous-sde-lifecycle-gap.md`). Items 1-3 DONE
(#439 egress join-key + record-merge observer; #441 live-lesson mint -> first
`world_anchored` lesson). USER scope decision (2026-06-27): **classify + materialize,
shadow** — build both modules, prove internally on held-out issues, thread into the
live Docker actor behind a reversible shadow flag, record the chosen persona but gate NO
trust weight. The `built_by` attribution + `ORCHESTRATOR_LESSONS` extension stays DEFERRED.
**Naming (post-VERIFY honesty fold H1/H2): this wave proves MATERIALIZATION (the persona
block is well-formed, bounded, instinct-PROSE-bearing), NOT behavioral ACTIVATION (the
contained actor solves differently) — the latter is an explicitly-named residual needing a
live A/B this wave does NOT run.**

## Context

The live external-issue actor (`live-draft-run.js:89`) gets a BARE `buildActorPrompt(record)`
with no persona, no instincts, no `agentType` — the "NOT a bare headless claude" anti-pattern
the north-star names. This wave builds the two grep-confirmed-MISSING modules — a deterministic
classifier mapping an ingested issue record to a persona, and a materializer that INLINES that
persona's instinct PROSE into the contained actor's prompt (mandatory because per ADR-0012 a
top-level `claude -p` cannot take an `agentType`, and the Docker actor can't Read host persona
files — they are not mounted) — and threads them on the live path behind a reversible shadow
flag. It closes the classifier-EXISTENCE gap and proves the MATERIALIZATION mechanism; per the
gap-map's own definition the activated-solve blocker (full skill/kb inlining + a behavioral
demonstration) stays OPEN by design (honesty H2). Posture is observe-first: the classification
is always recorded, the prompt INJECTION is behind a reversible flag (default off), and nothing
feeds a trust weight.

## Runtime Probes (firsthand, 2026-06-27 — re-probed the 2-day-old gap-map)

| Claim | Probe | Result |
|---|---|---|
| The live actor is Docker-contained and CAN Read (not tool-stripped); host persona files are NOT mounted | recon reader[4] + `docker-actor-backend.js:50,94` | CONFIRMED — `ACTOR_TOOLS=[Read,Grep,Glob,Edit,Write]`; mounts only `/work`. WHY-unreadable = not-mounted, not tools-stripped. So INLINE is mandatory. |
| A persisted live issue record carries only `{id,repo,base_sha,problem_statement}`; title+body merged, language/labels dropped | recon reader[3] + `live-puller.js:121,136` + `corpus.js:23` | CONFIRMED — classifier input is `{repo, base_sha, 64KiB free-text problem_statement}`. Pushes deterministic-keyword over the free text (LLM deferred). |
| `buildActorPrompt(record, extraContext)` appends `extraContext` after the ISSUE block | Read `trajectory-friction-run.js:98-104` | CONFIRMED — `if (extraContext) prompt += '\n\n' + String(extraContext)`. Additive seam; live call passes none. |
| The live call site is `buildActorPrompt(record)` inside `solveLiveIssueContained`; `solveGradeDraftOne` has `record` in scope | Read `live-draft-run.js:89,134-143` | CONFIRMED — classifier call belongs in `solveGradeDraftOne`; persona threads into `solveLiveIssueContained`. |
| `writeArtifact` payload + `recordOutcome` are where a chosen persona is recorded | Read `live-draft-run.js:55,167-170` | CONFIRMED — add a `persona` field to both (the shadow record). |
| `canonicalPersonaKey(raw)` validates ref->bare, returns null on unknown; `BARE_SHAPE` is the CWE-22 guard; NO bare->numbered resolver exists | Read `canonical-persona-key.js` (full) | CONFIRMED — must BUILD a bare->NN brief resolver. `canonicalPersonaKey` is the output validator (never a guess). |
| lab->runtime ban is on IMPORTING runtime modules, not reading data files | Read `canonical-persona-key.js:17-21` | CONFIRMED — "NO import from packages/runtime ... lab->runtime is a sideways coupling." It globs `agents/*.md` (repo-root) as DATA. The materializer reading `runtime/personas/*.md` as DATA is the open architect question (probe says data-read != code-import). |
| The instincts live in `runtime/personas/NN-*.md` (## Mindset prose) + `contracts/NN-*.contract.json` (`interface.instincts[]`), NOT `agents/*.md` (0/19) | recon readers[1,2,4] + `13-node-backend.md:8`, `13-node-backend.contract.json:89` | CONFIRMED — the materializer's source exists in Layers 2+3; `agents/*.md` is a MIX (node-backend=41-line stub, code-reviewer/architect=full). |
| 19 `agents/*.md` but only 17 numbered briefs (optimizer/planner have none) | recon reader[2] (glob) | CONFIRMED — classifier label space = personas with a resolvable numbered brief; the rest fall back to null (no injection). |

## Routing Decision

`route-decide.js` scored this `root` at 0.0 — the documented **stakes-lexicon miss** (MEMORY:
*"scores substrate work root/borderline on a stakes lexicon miss; escalate by judgment"*).
Escalated by judgment to `route`: two NEW modules on the live actor path + an attacker-text ->
persona -> file-path security surface (CWE-22) + a non-obvious lab->runtime boundary = genuinely
architect-shaped.

```json
{
  "task": "implement the issue->persona classifier and the persona-prompt materializer for the live external-issue actor path (ladder item 4)",
  "recommendation": "root",
  "bare_score_total": 0,
  "low_signal": true,
  "context_provided": true,
  "reasoning": "Score 0.000 -> root, context (+0.000, mult=0.5).",
  "weights_version": "v1.3-dict-expanded-2026-06-12",
  "escalation": "route (by judgment) — stakes-lexicon miss; NEW modules on the live path + a CWE-22 attacker-text->path surface + the lab->runtime boundary are architect-shaped"
}
```

## HETS Spawn Plan

3-lens VERIFY (pre-build, read-only personas), one delegated builder, 3-lens VALIDATE
(post-build) — the kernel/security/data-mutation tier (attacker text flows to a file-path
resolution, so the `hacker` lens is REQUIRED, not optional).

| Persona | Lens | Stage | Why |
|---|---|---|---|
| 04-architect | design | VERIFY | module placement + the lab->runtime data-read boundary + the classifier/materializer interface + the shadow-flag default |
| hacker | adversarial-security | VERIFY | CWE-22 path traversal (problem_statement -> persona key -> file path); byte-cap; fail-closed; confirm no trust-weight leak |
| honesty-auditor | claim-vs-evidence | VERIFY | does "shadow-proven" actually prove ACTIVATION (instinct-bearing, not nominal), and is it truly non-gating + reversible? |
| node-backend | build | BUILD | the 2 modules + the wire + the TDD suite + the dogfood proof (delegated, delta-bearing -> Rule-4 recordable) |
| code-reviewer | correctness | VALIDATE | edge cases, fail-soft, immutability, the wire's backward-compat |
| hacker | adversarial-security | VALIDATE | re-probe the BUILT path-traversal + byte-cap with LIVE probes (Rule 2a — a green TDD suite is not proof) |
| honesty-auditor | claim-vs-evidence | VALIDATE | the shadow/reversible/non-gating claims vs the actual diff |

## Files To Modify

| Path | Action | Risk | Notes |
|---|---|---|---|
| `packages/lab/persona-experiment/persona-brief-map.js` | create | medium | the bare->NN alias map built ONCE from each `contracts/NN-*.contract.json` `persona` field (D3); the SINGLE source of truth for "a builder persona with a materializable brief"; exports the builder allowlist (D2) |
| `packages/lab/persona-experiment/issue-classifier.js` | create | medium | deterministic keyword classifier; `matched` = fixed table phrase; output in the builder allowlist (D2) validated via `canonicalPersonaKey` BEFORE any path use; total + outcome-pure |
| `packages/lab/persona-experiment/persona-prompt-materializer.js` | create | medium | reads `runtime/personas/NN-*.md` + `contracts/NN-*.json` as DATA via the alias map; re-validates the key; non-overridable byte cap; compose-after-all-reads; fail-closed -> null |
| `packages/lab/persona-experiment/_lib/render-fenced-bounded-block.js` | create | low | extracted shared primitive (whole-line byte-cap under a reserved closing-fence budget + fenced block); the materializer calls it (D-2). Refactoring grounding-slice.js to also call it = OPTIONAL follow-up (only if its suite stays green; else defer to bound blast radius) |
| `packages/lab/persona-experiment/live-draft-run.js` | modify | high | the live actor path: thread `classifyIssue` + `materialize` behind a shadow flag; record persona+classify_signal+matched on artifact + outcome. Backward-compatible (default off = byte-identical PROMPT; the artifact gains additive keys, proven downstream-safe) |
| `tests/unit/lab/persona-experiment/persona-brief-map.test.js` | create | low | the alias map resolves security-auditor->12-security-engineer; builder allowlist excludes non-builders + optimizer/planner |
| `tests/unit/lab/persona-experiment/issue-classifier.test.js` | create | low | classification correctness + builder-only emit + `matched`=table-phrase (never attacker span) + multi-signal tiebreak + CWE-22-shaped input -> null + classify-threw totality |
| `tests/unit/lab/persona-experiment/persona-prompt-materializer.test.js` | create | low | resolution incl `security-auditor` non-null; instinct-PROSE-bearing; non-overridable cap (no opts param); fail-closed on malformed contract JSON + missing `## Mindset`; CWE-22 RED-then-green; never a partial fence |
| `tests/unit/lab/persona-experiment/live-draft-persona-wire.test.js` | create | low | flag-off = bare prompt + persona recorded; flag-off + classifier-throws = stage/ok/reason/verdict/cost byte-identical, persona=null; flag-on = injected; artifact additive-only; non-vacuous |

## Design decisions (revised post-VERIFY — folds detailed in `## Pre-Approval Verification`)

- **D1 — Classifier is DETERMINISTIC (keyword over `problem_statement`+`repo`), not LLM.** KISS, TDD-able, avoids a second attacker-text LLM surface. `matched` is the FIXED `PERSONA_SIGNALS` table phrase (a closed enum), NEVER an echoed `problem_statement` span (hacker M1). Multi-signal tiebreak is deterministic + total: highest distinct-phrase count -> a fixed persona-priority order -> null on a tie (attacker keyword-stuffing must not steer selection; hacker open-Q). LLM classifier deferred.
- **D2 — Output is an EXACT-SET BUILDER allowlist, not "any persona with a brief".** Legal emit set = `{node-backend, python-backend, java-backend, react-frontend, ios-developer, ml-engineer, data-engineer, devops-sre, security-auditor}` — personas that should drive a code-SOLVE actor. Non-builder lenses (architect, code-reviewer, hacker, honesty-auditor, confused-user, codebase-locator/analyzer/pattern-finder) + the brief-less optimizer/planner all -> null (no injection). The allowlist is intersected with the resolvable-brief set (D3) and passed as `opts.knownPersonas` to `canonicalPersonaKey` (hacker H1, honesty H3). Never a guessed/wrong persona.
- **D3 — Bare->NN brief resolution is an EXPLICIT ALIAS MAP, not a `^\d+-<persona>.md$` glob.** The glob silently nulls `security-auditor` (its brief is `12-security-engineer.md`; architect D-1 + hacker H1, convergent). Build the map ONCE from each `contracts/NN-*.contract.json`'s `persona` field (the authoritative agentType<->brief binding) — the SINGLE source of truth shared by the classifier emit-set and the materializer (architect D-4). The real partition is 16 name-matched + 1 aliased (security-auditor) + 2 absent (optimizer, planner), NOT "17 resolvable". A test asserts `materialize('security-auditor')` is non-null + instinct-bearing.
- **D4 — Materializer inlines instinct PROSE, byte-capped by a NON-OVERRIDABLE const.** Reads (as data, fail-closed) Layer 2 `## Identity` + the verbatim `## Mindset` instinct PROSE (NOT just instinct names — names-only is the hollow-stub failure mode; honesty H1) + Layer 3 `output_schema.required` + skill NAMES. The cap is a module-private `const`, NO `opts` override (hacker H2; security.md soft-default rule). REUSE grounding-slice's whole-line byte-cap + fenced-block discipline (extract a shared `_lib/render-fenced-bounded-block.js`; architect D-2). Compose the fence ONLY after ALL reads + the contract `JSON.parse` succeed; never emit a partial fence; ANY read/parse/missing-section error -> null (hacker M2). Re-validate the persona key via `canonicalPersonaKey` as the FIRST line + regex-escape the bare key (hacker L1).
- **D5 — The wire: classify ALWAYS (TOTAL + OUTCOME-PURE); INJECT only behind `LOOM_PERSONA_MATERIALIZE` (default off).** `classifyIssue` runs inside the existing per-record try/catch, is TOTAL (never throws -> `{persona:null, signal:'classify-threw'}`), and is OUTCOME-PURE (only adds artifact fields; never gates parse/solve/grade/emit; architect D-5, honesty H4). Default-off -> the actor PROMPT is byte-identical; the artifact gains `persona`+`classify_signal`+`matched` keys UNCONDITIONALLY -> prove additive-only + that no `draft-${id}.json` consumer breaks (honesty H4). The recorded persona feeds NO trust weight (never `built_by`/reputation/`LIVE_SOURCES`).
- **D6 — Module placement: both modules in `packages/lab/persona-experiment/`, reading `runtime/personas`+`contracts` as DATA via a path constant.** The lab->runtime DATA-read (not code-import) is RULED ACCEPTABLE by all 3 lenses (the ban is on importing runtime CODE; reading source as data is the shipped precedent — `canonical-persona-key.js` reads `agents/`). Conditions: a single `__dirname`-relative path constant; content treated as data (never `require`/`eval`); fail-closed -> null on any read/parse error; memoize the dir enumeration once-per-process.
- **D7 — `classify_signal` is a recorded closed-enum**: `{matched, no-keyword-match, ambiguous-tie, matched-no-brief, materialize-failed}` — so the shadow data distinguishes weak-classifier vs missing-brief vs broken-materializer (architect D-6). Persisted on the artifact + outcome alongside `persona` + `matched`.
- **D8 — Security (reaffirmed):** attacker `problem_statement` is only keyword-MATCHED, never path-interpolated; the persona KEY (alias-map-validated) is the ONLY thing reaching a path. Exact-set, never raw interpolation (the #215/CWE-22 discipline). The CWE-22 guard is NON-VACUOUS (a RED-then-green traversal test).
- **D9 — Forward-contract note (architect D-7):** the inline-materializer's NECESSITY is contingent on the `/work`-only Docker mount (`docker-actor-backend.js:94`, probed 2026-06-27). If a later wave mounts persona briefs read-only into the container, the inline path is superseded by a Read path and should be RETIRED, not kept in parallel.

## Phases

#### Phase 1: VERIFY (pre-build, 3-lens) — no edits yet
- Spawn architect + hacker + honesty-auditor in parallel against this plan.
- Fold findings BEFORE build. Append a `## Pre-Approval Verification` record.
- Probe: the architect rules on D5 (lab->runtime data-read); the hacker confirms the D6 CWE-22 closure is sound in design.

#### Phase 2: BUILD (delegated node-backend, TDD)
1. **`issue-classifier.js`** — `classifyIssue(record, opts) -> {persona|null, signal, matched}`. A `PERSONA_SIGNALS` table (persona -> phrase set); lowercased phrase-aware scan of `problem_statement`+`repo`; output via `canonicalPersonaKey` restricted to the resolvable-brief set; null on no-match. PURE (no net/LLM/exec).
   - Probe: `node -e` classify a python issue -> `python-backend`; a react issue -> `react-frontend`; a garbage/no-signal issue -> null; an injection-shaped `problem_statement` ("../../etc/passwd") -> null (never a path).
2. **`persona-prompt-materializer.js`** — `materialize(persona, opts) -> {block, bytes}|null`. Re-validate the key; glob `runtime/personas/*.md` for `^\d+-<persona>.md$` (memoized); read `## Identity`+`## Mindset` + the contract `output_schema.required` + skill names; compose a fenced PERSONA-ACTIVATION block; hard byte-cap. null on unresolvable/missing/read-error.
   - Probe: `materialize('node-backend')` -> a block containing a named instinct, under the cap; `materialize('optimizer')` (no brief) -> null; `materialize('../evil')` -> null.
3. **Wire into `live-draft-run.js`** — `solveGradeDraftOne` calls `classifyIssue(record)` (always), threads `persona` into `solveLiveIssueContained`; the latter, IF `LOOM_PERSONA_MATERIALIZE` truthy AND persona resolved, calls `buildActorPrompt(record, materialize(persona).block)`, else `buildActorPrompt(record)`. Record `persona` on the `writeArtifact` payload + `recordOutcome`. Injectable `classifyFn`/`materializeFn` deps for tests.
   - Probe: flag-off run -> prompt byte-identical to today + artifact carries `persona`; flag-on -> prompt contains the persona block.
4. **TDD suites** (the 3 test files) — written FIRST per the test-first discipline where behavior changes.

#### Phase 3: VALIDATE (post-build, 3-lens) + full gate
- code-reviewer + hacker (LIVE re-probe of the BUILT path-traversal + byte-cap) + honesty-auditor.
- Full pre-push gate: `bash install.sh --hooks --test` green + the lab + kernel suites green.
- Rule-4: record the delegated node-backend build's VALIDATE board into verdict-attestation.

#### Phase 4: Internal proof (MATERIALIZATION-proven, not activation) + PR
- A dogfood over the REAL corpus distribution (python-dominant — architect D-3 / honesty H1): feed held-out issue descriptions (the #2137 python issue + representative builder cases) -> assert (a) the classifier picks the expected builder persona or null, and RECORD the full (issue -> persona) distribution HONESTLY (a python-only stream proving `python-backend`+null IS the honest result, not a multi-persona showcase); (b) the materialized block contains the VERBATIM `## Mindset` instinct PROSE + `output_schema.required`, is bounded, and is well-formed. This proves MATERIALIZATION; behavioral ACTIVATION (the contained actor solves differently) is a NAMED residual requiring a live A/B not run here.
- PR for the USER merge gate.

## Verification Probes

| Probe | Pass criterion |
|---|---|
| 1 | `classifyIssue` over a held-out set picks the expected BUILDER persona per case; no-keyword-match -> null; a non-builder/brief-less match -> null; an injection-shaped statement -> null; `matched` is always a table phrase, never an echoed input span |
| 2 | `materialize('node-backend')` AND `materialize('security-auditor')` both return an instinct-PROSE-bearing block under the byte cap; a no-brief persona (optimizer) / a malformed key / a malformed contract JSON / a missing `## Mindset` -> null; never a partial fence |
| 3 | Path-traversal: no persona-key-derived value reaches `path.join` without `canonicalPersonaKey`+`BARE_SHAPE` validation INSIDE `materialize()`; `materialize('../evil')`, `materialize('13-../../etc')`, embedded-NUL -> null (hacker live probe, RED-then-green, NON-VACUOUS) |
| 4 | Flag-off: the live actor PROMPT is byte-identical to pre-change AND a classifier that THROWS leaves stage/ok/reason/verdict/cost byte-identical (only `persona`=null differs); the artifact `persona`/`classify_signal`/`matched` keys are additive-only and no `draft-${id}.json` consumer breaks; non-vacuous (flip the flag, the fenced block appears) |
| 5 | No trust-weight leak: grep the diff — the recorded persona never reaches `built_by` / reputation / `LIVE_SOURCES` |
| 6 | The byte cap is a module-private const with NO `opts` override reachable from `materialize(persona)` (security.md soft-default) |
| 7 | `bash install.sh --hooks --test` green + lab + kernel unit suites green; zero eslint-disable |
| 8 | Plan matches the template's mandatory sections + carries `## Runtime Probes` and `## Pre-Approval Verification` |

## Out of Scope (Deferred)

- **LLM-backed classifier** — deterministic keyword first; LLM (tool-less `claude -p` over the free text) deferred.
- **Full skill-body + kb-doc inlining** — named only in v1 (byte budget); full bodies a tunable follow-up.
- **`built_by` attribution + extending `ORCHESTRATOR_LESSONS`** — option-2 scope; a later wave (depends on the egress join-key being wired into `emitPR`, which it is NOT today).
- **Plumbing language/labels through `buildPublicRecord`** — a corpus-contract change; out of scope.
- **optimizer/planner personas** — no numbered brief -> not in the classifier label space.
- **Actually driving live trust** — the flag stays off by default; this wave PROVES the mechanism, it does not harden trust (only a world-anchored merge hardens — OQ-NS-6).

## Drift Notes

- **Drift-note A**: `route-decide` again scored a clearly-architect-shaped substrate task `root` at 0.0 (the stakes-lexicon miss — "writes to the live actor path" / "attacker-text->file-path" carry no stakes token). Recurring; the `recon-depth`/dictionary-expansion candidate. Escalated by judgment, as the rule prescribes.
- **Drift-note B**: the gap-map doc (2 days old) had FOUR stale/refuted claims (tools-stripped; structured issue fields; 0/18; emitPR join-key). The runtime-claim-probe pass caught all four before they shaped the build — the discipline paid for itself pre-plan.
- **Drift-note C (scope guard)**: resisted folding the `built_by` attribution wire into this wave (it is the natural "while we're here"); kept it deferred per the USER's option-1 choice. The `scope-creep` converged candidate is live; this is the deliberate counter.

## References / reuse (not modifying)

- `packages/lab/persona-experiment/canonical-persona-key.js` — `canonicalPersonaKey` (output validator) + `BARE_SHAPE` (CWE-22 guard) + the lab->runtime-ban precedent.
- `packages/lab/persona-experiment/arm-compose.js` — the existing (insufficient) injector; reads the `agents/*.md` delegation layer (a thin stub for builder personas like node-backend; full prose for code-reviewer/architect). The materializer instead reads the authoritative `## Mindset` prose in `runtime/personas/NN-*.md`.
- `packages/lab/persona-experiment/grounding-slice.js` — the fenced-DATA discipline (reuse if any externally-derived text is ever inlined).
- `packages/runtime/personas/13-node-backend.md` + `03-code-reviewer.md`; `contracts/13-node-backend.contract.json` — the materializer's source shape.
- `packages/lab/causal-edge/trajectory-friction-run.js:98` — `buildActorPrompt` (the `extraContext` seam).

## Pre-Approval Verification

3-lens pre-build VERIFY (2026-06-27, parallel workflow): **architect**, **hacker**
(adversarial-security — REQUIRED, attacker text reaches a file-path resolution), **honesty-auditor**.
All three: **APPROVE-WITH-FOLDS**. No CRITICAL, no NEEDS-REVISION. All folds below are
FOLDED INTO the design above (D1-D9) before build.

**Unanimous ruling — lab->runtime DATA-read is ACCEPTABLE** (architect + hacker + honesty): the
ban (`canonical-persona-key.js:17-21`) is on IMPORTING runtime CODE; reading source files as DATA
is the shipped precedent (`canonical-persona-key.js` globs `agents/`; `arm-compose.js` reads
`agents/<persona>.md`). Conditions captured in D6.

| Fold | Lens(es) | Severity | Resolution (in design) |
|---|---|---|---|
| Resolver `^\d+-<persona>.md$` glob silently nulls `security-auditor` (brief = `12-security-engineer.md`); real partition 16+1+2 | architect D-1 + hacker H1 (convergent) | HIGH | D3: explicit alias map from each contract's `persona` field; test `materialize('security-auditor')` non-null |
| Materializer re-implements grounding-slice's byte-cap + fenced-block (DRY/KISS; invites a weaker copy) | architect D-2 | HIGH | D4: extract shared `_lib/render-fenced-bounded-block.js`; materializer calls it (grounding-slice refactor = optional follow-up) |
| "shadow-PROVEN" proves the MECHANISM (string-present), not ACTIVATION; downstream #273-class laundering risk if item 5 inherits a "proven" nominal persona | honesty H1+H2 | HIGH | Title/Context renamed to MATERIALIZATION-proven; inline instinct PROSE not names; behavioral activation = named residual (Phase 4) |
| Byte cap copied from grounding-slice is caller-OVERRIDABLE (`opts.maxBytes`) -> violates D3 non-overridable-const | hacker H2 | HIGH | D4: module-private const, NO opts override; Probe 6 |
| Known-set derived in 3 places (canonicalPersonaKey glob / classifier / materializer) -> drift | architect D-4 | MEDIUM | D2+D3: the alias map is the single source; classifier emits from it; `opts.knownPersonas` = the intersection |
| Label space includes non-builder lenses (confused-user, honesty-auditor, codebase-*) -> category error + capability-confusion lever | hacker open-Q + honesty H3 | MEDIUM | D2: exact-set BUILDER allowlist |
| Live/corpus stream is python-dominant -> a 17-way classifier emits ~only python-backend|null; "proven" must be honest about distribution | architect D-3 | MEDIUM | Phase 4: record the REAL (issue->persona) distribution; a python-only result IS honest |
| "classify ALWAYS" adds an always-on call on the high-risk live loop + a new artifact key | architect D-5 + honesty H4 | MEDIUM | D5: total + outcome-pure inside the per-record try/catch; Probe 4 (classifier-throws byte-identical; artifact additive-only, consumer-safe) |
| `matched`/`signal` could echo an attacker `problem_statement` span (reopens injection for items 5/6) | hacker M1 | MEDIUM | D1: `matched` = FIXED table phrase (closed enum), never an input span |
| Fail-closed must wrap BOTH file reads + the contract `JSON.parse`; never emit a partial fence | hacker M2 | MEDIUM | D4: one try/catch -> null; compose-after-all-reads |
| Bare null collapses 3+ distinct null causes -> shadow data un-analyzable | architect D-6 | LOW | D7: `classify_signal` closed-enum |
| Re-validate the key INSIDE `materialize()` + regex-escape the bare key | hacker L1 | LOW | D4 |
| Inline-materialize's necessity is contingent on the `/work`-only mount | architect D-7 | LOW | D9 forward-contract note |
| Multi-signal/keyword-stuffing must not steer selection | hacker open-Q | (folded) | D1: deterministic total tiebreak |
| "reads the stub" imprecise (agents/*.md is a mix) | honesty H6 | LOW | References reworded; the probe table itself is firsthand-verified accurate |

**Honesty lens GRADE: B (minor-overclaims-present)** — pre-fold; the framing was honest, the verb
"proven" was inflated on activation. Post-fold the verb is scoped to materialization throughout.

## VALIDATE result

Post-build 3-lens VALIDATE (2026-06-27, parallel workflow against the BUILT worktree diff):
**code-reviewer**, **hacker** (live re-probe, Rule 2a), **honesty-auditor**. All three:
**APPROVE-WITH-FOLDS**. No CRITICAL, no BLOCK.

**Security spine verified by LIVE probe (the headline claims hold):**
- CWE-22 path-traversal guard is NON-VACUOUS + validate-first: 10/10 traversal payloads (`../evil`, `13-../../etc/passwd`, embedded NUL/newline, `%2e%2e%2f`, a 41-char overflow) -> null, with **ZERO file reads on a rejected key** (instrumented), while the controls produce a real block (proves the path works, so the guard isn't passing vacuously).
- The byte cap is non-overridable from both `materialize()` (arity 1) and the exported `_materializeWithDeps`.
- The classifier `matched` is a strict closed enum (no attacker `problem_statement` span ever echoed).
- NO trust-leak: the recorded persona reaches only `recordOutcome` + the `writeArtifact` payload, never `built_by` / reputation / `LIVE_SOURCES` (grepped across the diff).
- Materialization is GENUINE: the block carries the VERBATIM `## Mindset` instinct prose (cross-checked against `13-node-backend.md` + `12-security-engineer.md`), not a hollow stub.

**Folds applied (post-VALIDATE round, same delegated builder, TDD):**

| Fold | Lens | Sev | Resolution |
|---|---|---|---|
| Substring-unsafe signal phrases (`ios`->"scenarios", `pip`->"pipeline", `hook`/`component`/`injection`/`spring`/`embedding`/`inference`) corrupt the shadow dataset | code-reviewer F1+F3 | HIGH | `wordMatch` (word-boundary lookaround for single alnum tokens); `injection`/`hook`/`component` removed; `nest`->`nestjs`; `spring`->`spring boot`/`spring framework`; `embedding`/`inference`->`model ...` |
| Render `break` drops the instructions after a long line; cap can silently truncate the tail | code-reviewer F2 + honesty F1 | MED | `break`->`continue` + a `truncated` flag; cap 6000->8000 headroom; a late-instinct regression test for both shipped personas |
| Fence sentinels unescaped (parser-differential, currently unreachable) | hacker H-1 | MED | `defangFences` neutralizes embedded sentinels before accumulation; RED-then-green test |
| Flag parses leniently (a typo fails OPEN toward injecting) | hacker M-1 | MED | strict `['1','true','yes','on']` allowlist (typo -> bare prompt, security.md asymmetric rule) |
| Non-integer cap silently -> empty | code-reviewer F5 | LOW | `Number.isFinite` + `Math.floor` |
| Loop-level catch drops the classify fields | code-reviewer F4 | LOW | stamp `persona:null, classify_signal:'classify-threw', matched:null` -> the invariant is unconditional |
| CWE-22 test doesn't isolate the L1 builder-gate | honesty F2 | LOW | `materialize('architect') -> null` regression guard (architect resolves to a brief but is not a builder, so L1 is what rejects it) |

**Final gate (firsthand-verified by the orchestrator):** all 6 persona-experiment suites green (**118 tests**, +27 fold tests); `eslint` exit 0 on all 10 changed files; ASCII-only; zero `eslint-disable`; no `require` of `packages/runtime`; base on fresh `origin/main` (`ddeef87`).

**Honest residuals (named, not hidden):** behavioral ACTIVATION (the contained actor solves differently) is NOT demonstrated — a live A/B is the named residual; the H-1 defang is forward-looking (only reachable once items 5/6 pipe external text through the primitive); 4 pre-existing `causal-edge` suite failures persist (the documented real-`claude` sandbox temp-dir SCAR — zero files this wave touched are involved, zero persona-experiment regressions).
