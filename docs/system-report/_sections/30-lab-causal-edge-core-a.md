# Lab causal-edge (A): calibration + faithfulness + wilson — `packages/lab/causal-edge/`

> This cluster sits entirely in the **lab** tier (advisory / shadow experiment substrate, `// @loom-layer: lab`): it MEASURES the quality of an injected LLM judge and grades a model's attempts at already-resolved OSS issues, but it never gates, blocks, or mints trust. The load-bearing safety property is owned elsewhere (`faithfulness.js` caps every promotion at `advisory_llm_checked`, the kernel owns enforcement); these modules only produce DIAGNOSTIC numbers with explicit error bars (`not_a_trust_score: true`, OQ-NS-6). The split between PURE deterministic scorers (`calibration.js`, `calibration-issue.js`, `faithfulness.js`, `wilson.js`, `item-source.js`) and IMPURE real-LLM runners (`calibration-run.js`, `calibration-issue-run.js`) is deliberate: the pure side is TDD'd with mock judges in the unit glob; the `*-run.js` modules hold the real `claude -p` / sandbox legs and live OUTSIDE `tests/unit/**` so Linux CI never globs them.

## Directory contents & nesting

All files are direct children of `packages/lab/causal-edge/` (no `_lib/` here; a sibling `_spike/` holds throwaway dogfood scripts, and `calibration-records/` / `calibration-fixtures.json` hold data, all out of scope).

| File | Folder | One-line purpose |
|---|---|---|
| `calibration.js` | `causal-edge/` | PURE rung-2 faithfulness CALIBRATION scorer (mock-judge corpus → accuracy/precision/recall + injection battery). |
| `calibration-cli.js` | `causal-edge/` | CLI wiring the dry (mock-judge) and `--real` (`claude -p`) calibration surfaces. |
| `calibration-issue.js` | `causal-edge/` | PURE three-legged (behavioral / semantic / reference) issue-resolution scorer; never-blend firewall + blind firewall + A2 firewall. |
| `calibration-issue-run.js` | `causal-edge/` | IMPURE macOS-only real-leg runner for the three-legged scorer (sandbox leg A + blind `claude -p` leg B + teaching leg C). |
| `calibration-run.js` | `causal-edge/` | IMPURE real-`claude -p` judge + record writer for the rung-2 calibration. |
| `cli.js` | `causal-edge/` | The dogfood CLI over the SHADOW causal-edge graph store/walker (`create` / `flag-conflict` / `list` / `update-status` / `walk`). |
| `enums.js` | `causal-edge/` | Side-effect-free shared enums (relations / conflict types / faithfulness statuses) + re-export of the kernel enum-validate leaf. |
| `faithfulness.js` | `causal-edge/` | PURE rung-1 (surface overlap) + rung-2 (injectable advisory judge) faithfulness ladder; fail-closed, narrowing-safe ceiling. |
| `item-source.js` | `causal-edge/` | `deriveItemSource`: auth-class mapping of a lesson node to `signed-lane` / `mock` by ed25519-signed-edge membership; fail-closed, env-blind. |
| `wilson.js` | `causal-edge/` | Pure Wilson score interval (95%, no continuity correction) stats helper. |

Nested-folder distinctions:

- `_spike/` (sibling, out of scope) — throwaway dogfood / rerun scripts (`calibration-issue-dogfood.js`, `lesson-capture-rerun.js`, …). They REQUIRE the in-scope modules but are not part of the product path or the unit glob.
- The `*-run.js` naming convention is the load-bearing CI firewall: `calibration-run.js` and `calibration-issue-run.js` are deliberately OUT of `tests/unit/**` so a Linux/sandboxed CI never loads `child_process` / sandbox machinery.

## Per-file analysis

### `calibration.js`

- **Purpose** — the OQ-21 rung-2 faithfulness CALIBRATION scorer. PURE + DETERMINISTIC: given a labelled fixture corpus + an injected `judgeFn` (same seam as `faithfulness.rung2AdvisoryCheck`), it scores how well the judge distinguishes a supported causal relation from a false one and how it withstands a prompt-injection battery. The LLM is never called here.
- **Imports / consumes** — `require('./faithfulness')` for `rung2AdvisoryCheck` + `RUNG2_MAX_STATUS`. No fs / env / I/O. Inputs are the `fixtures` array + the `judgeFn`.
- **Consumers** — `calibration-run.js:115` (`scoreCalibration` for the real run), `calibration-cli.js:18` (dry run), and `tests/unit/lab/causal-edge/calibration.test.js`.
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `validateCorpus` | exported | assert the corpus is well-formed + measurement-valid; throws on first violation | `fixtures` array | nothing (returns count) | throws `Error` on invalid corpus; otherwise pure |
| `edgeOf` | exported | build the edge shape `rung2AdvisoryCheck` scores (mirrors store edge identity) | one fixture `f` | nothing (returns new object) | pure; constructs a fresh object |
| `scoreFixture` | internal | run ONE fixture through the injected judge via the production promotion path; classify model-vs-`harness_fallback` (A2) | `f`, `judgeFn` | nothing (returns row) | calls `judgeFn` (which the caller may make impure); wraps it; pure aggregation |
| `divide` | internal | safe divide returning `null` on zero denominator | `a`, `b` | nothing | pure |
| `scoreCalibration` | exported | validate → map → aggregate the full calibration run (accuracy/precision/recall + injection + per-relation + fallback accounting) | `fixtures`, `judgeFn` | nothing (returns result object) | calls `validateCorpus` (may throw); otherwise pure |

- **File-level notes** — The A2 measurement-integrity split (distinguishing a harness fallback from a model true-negative) is the load-bearing correctness property. `injection_followed` is computed only over the adversarial subset where the directive opposes ground truth (H3 invariant, enforced in `validateCorpus` line 53). Coupling to `faithfulness.js` is intentional and tight: `scoreFixture` routes the promotion decision through the real `rung2AdvisoryCheck` so the test exercises production logic. The `judgeFn` is treated as untrusted (the `try/catch` at line 77 + the throw-rethrow shim at line 78). At 173 lines this file is comfortably within the 800-line budget; all functions are < 50 lines.

### `calibration-cli.js`

- **Purpose** — the rung-2 calibration CLI. `calibrate` runs a DRY mock-judge baseline (CI-safe, exit 0); `calibrate --real` runs the MEASURED `claude -p` spike and writes a record (requires an unsandboxed, network-enabled, authed shell).
- **Imports / consumes** — `fs`, `path`, `require('./calibration')` (`scoreCalibration`); lazy `require('./calibration-run')` only on the `--real` path. Reads `calibration-fixtures.json` from `__dirname`. Reads `process.argv`.
- **Consumers** — invoked as a script (`require.main === module`); `mockJudgeFrom` + `main` are exported but no in-repo `require` consumes them (CLI-only surface).
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `mockJudgeFrom` | exported | build a deterministic mock judge that answers each fixture's ground truth (perfect-judge baseline) | `corpus` array | nothing (returns closure) | pure; builds a `Map` |
| `main` | cli / exported | parse argv, run dry or `--real`, print result JSON, set exit code | `argv`, reads `calibration-fixtures.json` (dry path) | `process.stdout` (result JSON), `process.stderr` (errors) | `process.exit(0\|1)`; lazy-loads `calibration-run` on `--real`; the real path writes a record via `runCalibration` |

- **File-level notes** — The lazy require of `calibration-run.js` (line 50) is deliberate so the dry path never loads spawn machinery. `mockJudgeFrom` keys on `source_block + ' ' + target_block` — a space-joined composite key that is collision-prone if two fixtures share blocks differing only at the join boundary (e.g. `"a b" + " " + "c"` vs `"a" + " " + "b c"`), though for a curated fixtures file this is benign. The dry-path `JSON.parse(fs.readFileSync(...))` has no try/catch — a malformed fixtures file throws an unhandled error with a stack dump rather than the clean message the `--real` path provides (line 56). 63 lines; functions < 50 lines.

### `calibration-issue.js`

- **Purpose** — the v3.9 three-legged calibration scorer: an additive sibling to `calibration.js` that grades a model's attempt at an already-resolved OSS issue along THREE never-blended axes (behavioral / semantic / reference) plus W3 report-only trajectory + friction axes. PURE: the LLM + sandbox are injected legs; the impure legs live in `calibration-issue-run.js`.
- **Imports / consumes** — `crypto`; `require('../issue-corpus/corpus')` for `splitRecord` / `validateIssueCorpus` / `N_CLEAN_LARGE_MIN`; `require('./trajectory-friction')` for `parseTrajectory` / `computeProcessGraph` / `detectRecallSmell` / `buildFrictionLabelerInput` / `validateResolutionFriction`. Documented import allow-list (line 16): NO `child_process`, NO `claude`, NO `*-run` module.
- **Consumers** — `calibration-issue-run.js:30` (`scoreIssueCalibration`); `attribution/recall-graph.js:36` (`WORKED_EXAMPLE_FIELDS`); `lesson-signature.js:29` (`RUBRIC_LEAK_MIN` + `normalizeAlnum`, reusing the same leak-min so the two leak checks never diverge); `_spike` dogfoods; `tests/unit/lab/causal-edge/calibration-issue.test.js`.
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `buildActorInput` | exported | the BLIND public-only input (replaces `edgeOf`) | `record` | nothing | pure; delegates to `splitRecord(record).public` |
| `digest` | internal | sha256 first-16-hex of a coerced string | `s` | nothing | pure |
| `parsePatchTouchedPaths` | exported | parse touched paths from a unified diff (incl. rename/copy/git-quoted forms); flag malformed headers unparseable | `patch` string | nothing (returns `{paths, unparseable}`) | pure; fail-closed `unparseable` on a malformed `diff --git` header |
| `isTestInfraPath` | internal | classify a path as test-infra (collection config / `.pth` / `conftest` / test dirs / `test_*` files) | `p` | nothing | pure |
| `computeTamper` | internal | derive `forceFail` from an unparseable hunk OR a touched test-infra path | `candidate_patch` | nothing | pure |
| `normalizeAlnum` | exported | lowercase + strip non-alnum (shared normalizer for both leak checks) | `s` | nothing | pure |
| `rubricLeaks` | exported | detect a rubric whose keys/values share a `>=RUBRIC_LEAK_MIN` alnum run with `accepted_diff` | `rubric`, `acceptedDiff` | nothing | pure; recursive `walk` over the rubric |
| `deepClone` | internal | `structuredClone` with `JSON` fallback | `o` | nothing | pure (returns a fresh copy) |
| `buildLegBInput` | internal | build leg B's blind input + leak-tripwire-drop the rubric (CLONED so a mutating `semanticFn` can't poison the record) | `record` | nothing (returns `{input, dropped}`) | pure |
| `deriveBehavioralVerdict` | internal | the only cross-leg combine: PASS / FAIL / PARTIAL with fail-closed defaults | a destructured options object | nothing | pure |
| `scoreAttempt` | exported, async | run one `(record, candidate, attempt)` through the three legs + W3 axes | `record`, `candidate_patch`, `attemptIndex`, `legs`, `{tier, trajectory, cloneRoot}` | nothing (returns attempt result) | awaits injected legs (`behavioralFn`/`semanticFn`/`referenceFn`/`frictionFn`); `try/catch` fail-closes a thrown `frictionFn` to null |
| `passAtK` | exported | numerically-stable unbiased HumanEval pass@k estimator | `n`, `c`, `k` | nothing | pure |
| `scoreIssueCalibration` | exported, async | validate → map (k attempts/issue) → aggregate; per-axis never blended; pass@k excludes fallbacks | `records`, `attemptsPerIssue`, `legs`, `{tierOf, patchFor, trajectoryFor, cloneRoot}` | nothing (returns aggregate) | calls `validateIssueCorpus` (throws on invalid corpus); awaits `scoreAttempt` per attempt |

- **File-level notes** — Three documented firewalls: never-blend (no scalar score key), blind (leg B never sees `accepted_diff`, leak-tripwire on `criteria_only_rubric`), and A2 (only `outcome_source === 'model'` is a model decision; everything else excluded from pass@k). The `treeMutated` default at line 168 is fail-CLOSED (only an explicit `false` is clean). Leg C gets DEEP-frozen verdict copies (line 214) including the nested `tamper_flags` array — explicitly fixing a prior shallow-freeze leak (immutability of the read-back path). The `cloneRoot` seam is plumbed through `scoreAttempt` and `scoreIssueCalibration` but is the source of a real wiring gap in the impure runner (see Findings). At 347 lines, within budget; `scoreAttempt` is ~105 lines (over the 50-line guideline).

### `calibration-issue-run.js`

- **Purpose** — the IMPURE real-leg runner for the three-legged scorer. macOS-only (leg A needs the sandbox-exec ContainerAdapter); outside `tests/unit/**`. Holds the real legs + `runIssueCalibration`, which drives `scoreIssueCalibration` over them and writes the un-gated Path-1 record.
- **Imports / consumes** — `fs`, `os`, `path`, `crypto`, `child_process.spawnSync`; `require('./calibration-issue')` (`scoreIssueCalibration`, `WORKED_EXAMPLE_FIELDS`); `require('../issue-corpus/corpus')` (`computeManifestHash`); `require('../issue-corpus/container-adapter')` (`classifyRun`, `parseTestStatus`, `evaluateOutcome`, `RESULT_CLASS`); `require('./trajectory-friction-run')` (`makeFrictionLabeler`, `runActorTrajectory`); `require('../attribution/recall-graph')` (`aggregateFrictionMap`, `computeJudgeAgreement`, `populateRecallGraph`); `require('../attribution/recall-graph-store')` (`writeNode`). Reads the filesystem (clone work dirs, the `claude` binary), spawns `claude -p`. No direct env read except `os.homedir()`.
- **Consumers** — `persona-experiment/real-solve.js:144` (`makeBehavioralFn`); multiple `issue-corpus/_spike/*` and `attribution/_spike/*` dogfoods; `_spike/calibration-issue-dogfood.js`. No unit test imports it (by design — out of the glob).
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `hashTestTree` | exported | hash the collection-relevant tree (test dirs + loom runner + collection config) for the C1 mid-run rehash | `workDir`; reads files via `fs.readdirSync`/`readFileSync` | nothing (returns hex digest) | reads disk; bounded recursive walk; skips `.git`; swallows unreadable files |
| `makeBehavioralFn` | exported | build leg A: clone → apply candidate → REHASH (C1) → apply test → run tests; fail-closed to `harness_fallback` | `backend` | nothing (returns async closure) | the closure mutates the backend work dir (clone/apply/run/discard); `discard` in `finally` |
| `resolveClaude` | exported | resolve the `claude` binary (PATH via bash `command -v`, then `~/.local/bin`) | env PATH (via spawn), `os.homedir()`; `fs.existsSync` | nothing (returns path or null) | spawns `command -v claude`; reads disk |
| `claudeOnce` | internal | spawn `claude -p` once (prompt on STDIN, pinned `--model`); fence-strip then `JSON.parse`; fail-closed | `bin`, `prompt`, `timeout` | nothing (returns `{ok, obj\|reason}`) | spawns the LLM child process |
| `makeBlindSemanticJudge` | exported | build leg B (blind): prompt has only the public input + candidate, NO `accepted_diff`; fail-closed → `harness_fallback` | `{bin, timeout}` | nothing (returns `semanticFn` closure) | the closure spawns `claude -p` |
| `makeReferenceTeacher` | exported | build leg C (teaching): MAY include `accepted_diff`; separate invocation; returns a write-only worked-example | `{bin, timeout}` | nothing (returns `referenceFn` closure) | the closure spawns `claude -p` |
| `runIssueCalibration` | exported, async | drive `scoreIssueCalibration` over the real legs; compute W4 aggregates; populate the recall-graph store; write the Path-1 record | `records`, `attemptsPerIssue`, `{backend, patchFor, tierOf, outDir, claudeBin, recallGraphDir, trajectoryFor, frictionFn}` | `recall-graph` nodes via `writeNode`; the Path-1 JSON record to `outDir/issue-calibration-<ts>.json` | spawns LLM legs; writes store nodes + a record file; `mkdir -p` `outDir`; best-effort swallow on write failure |

- **File-level notes** — Leg A owns the load-bearing C1 tamper control: it rehashes the test tree AFTER applying the candidate but BEFORE the test patch (line 82), so a candidate that mutates its own grading tests is caught. The `claude -p` legs ride untrusted bytes as ONE STDIN payload (`shell: false`), with a `--model` pin (the W3 lesson: the child otherwise inherits a possibly-unavailable parent model). The fence-strip at line 140 is start/end-anchored (parser-differential defense). The `await` at line 202 is load-bearing — without it the record's `result` would serialize as a pending Promise (`{}`). `runIssueCalibration` is ~60 lines (over the 50-line guideline). The recall-graph write loop (line 217) is fire-and-while: `writeNode` is synchronous, so no missing-await there.

### `calibration-run.js`

- **Purpose** — the NON-DETERMINISTIC real-LLM side of the rung-2 calibration. Holds `makeClaudePJudge` (a real `claude -p` `judgeFn`) + `runCalibration` (drives `scoreCalibration` over the real judge + writes the calibration record). Kept separate from `calibration.js` so the unit suite stays LLM-free; not in the run-suite glob.
- **Imports / consumes** — `fs`, `os`, `path`, `crypto`, `child_process.spawnSync`; lazy `require('./calibration')` (`scoreCalibration`) inside `runCalibration`. Reads `rung2-judge-prompt.md`, `calibration-fixtures.json`, `faithfulness.js` (for the contract hash) from `__dirname`. Reads `process.env.LOOM_LAB_STATE_DIR` (falls back to `~/.claude/lab-state`).
- **Consumers** — `calibration-cli.js:50` (`runCalibration` on `--real`); `tests/unit/lab/causal-edge/calibration-parse.test.js` (likely `parseVerdict`); no broad in-product consumer (manual-spike).
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `sha256` | internal | hex sha256 of a string | `s` | nothing | pure |
| `resolveClaudeBin` | exported | resolve the `claude` binary (PATH then `~/.local/bin`) | env PATH via bash `command -v`; `os.homedir()`; `fs.existsSync` | nothing (returns path or null) | spawns `command -v claude`; reads disk |
| `renderPrompt` | exported | render the judge prompt for one edge (spec + relation/blocks as DATA, one argv string) | `promptSpec`, `edge` | nothing (returns string) | pure |
| `parseVerdict` | exported | fence-strip-then-strict-WHOLE parse of `claude` stdout; fail-closed `{supported:false, fallback_reason}` | `stdout` | nothing (returns verdict) | pure |
| `makeClaudePJudge` | exported | build the real `judgeFn` closure over the resolved binary + prompt spec | `opts` (`bin`, `promptSpec`, `timeoutMs`, `model`); reads `PROMPT_PATH` if no `promptSpec` | nothing (returns closure) | reads the prompt file at build time; the closure spawns `claude -p` |
| `runCalibration` | exported | drive a real calibration run + write the record (non-deterministic; manual-spike) | `opts`; reads `FIXTURES_PATH`, `PROMPT_PATH`, `FAITHFULNESS_PATH`, env `LOOM_LAB_STATE_DIR` | the calibration record JSON to `LOOM_LAB_STATE_DIR/calibration/rung2-<ts>.json` (or `opts.outPath`) | `mkdir -p` the dir; `fs.writeFileSync`; spawns LLM via the judge |

- **File-level notes** — `makeClaudePJudge` honors the `undefined` (resolve) vs explicit `null/''` (disabled) distinction (line 89) so a test can deterministically exercise the judge-unavailable path; a naive `o.bin || resolve()` would silently re-resolve `bin:null` to the real binary. `parseVerdict` requires a strict boolean `supported` and never scans for an embedded `{...}` (the parser-differential defense mirrors `faithfulness.js`). The record body keeps a HASH of the judge prompt + faithfulness contract for reproducibility but the per-fixture `raw` text is dropped. Unlike `calibration-issue-run.js`, the `writeFileSync` here is NOT in a try/catch — a record-write failure on the real path throws (acceptable, since a manual spike wants to know). 152 lines; functions < 50 lines.

### `cli.js`

- **Purpose** — the v3.5 dogfood CLI + manual surface for the SHADOW causal-edge graph loop. Every subcommand only records/reads the Lab-owned ledger or runs a pure read-side walk; nothing blocks or gates.
- **Imports / consumes** — `require('./store')` (`createEdge`, `updateEdgeStatus`, `listEdges`); `require('./walker')` (`walk`); `require('./manage-ops')` (`flagConflict`). Reads `process.argv`.
- **Consumers** — script entry (`require.main === module`); `main` + `parseArgs` exported but no in-product `require` (covered by `tests/unit/lab/causal-edge/*` indirectly; no direct `causal-edge/cli` require found).
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `parseArgs` | exported | parse `--key value` / `--flag` argv into an object | `argv` | nothing (returns object) | pure |
| `emit` | internal | pretty-print an object as JSON to stdout | `obj` | `process.stdout` | writes stdout |
| `fail` | internal | print a clean error to stderr + exit 1 | `msg` | `process.stderr` | `process.exit(1)` |
| `main` | cli | dispatch the subcommand (`create` / `flag-conflict` / `list` / `update-status` / `walk`) | `argv`; via store: reads/writes the Lab ledger | stdout (results), stderr (errors); store writes via `createEdge`/`updateEdgeStatus`/`flagConflict` | mutates the Lab store (create/update/flag); `process.exit(0\|1)` |

- **File-level notes** — `parseArgs` (line 30) cannot represent a value that itself starts with `--` (treated as a flag), and a `--flag` followed by a value-less flag silently becomes boolean `true` — fine for this CLI's value space but a latent foot-gun. Exit-code discipline is clean (0 success, 1 usage/validation). Out of scope but referenced: `store.js`, `walker.js`, `manage-ops.js` own the actual mutation + validation. 118 lines; all functions < 50 lines.

### `enums.js`

- **Purpose** — shared causal-edge enums + the R4 validation re-export. SIDE-EFFECT-FREE (no env read, no I/O, no module-load state) so `store.js` + `walker.js` can require it without triggering state resolution or breaking the walker purity contract.
- **Imports / consumes** — `require('../../kernel/_lib/enum-validate')` for `normalizeAsciiEnum` + `validateEnum`. Nothing else.
- **Consumers** — `walker.js:32` (`RELATIONS`, `WALKER_ELIGIBLE_STATUSES`); `store.js:51` (the full set). Constants mirror values in `faithfulness.js` and `calibration.js`.
- **Functions** — none defined locally; the module is pure data + a re-export.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| (module body) | data | freeze + export `RELATIONS`, `CONFLICT_TYPES`, `FAITHFULNESS_STATUSES`, `DEFAULT_FAITHFULNESS_STATUS`, `WALKER_ELIGIBLE_STATUSES` + re-export the two validators | the enum-validate leaf | nothing | none (frozen constants) |

- **File-level notes** — All arrays are `Object.freeze`d (immutability). The DRY decision to re-export the kernel `enum-validate` leaf rather than duplicate the NFC/homoglyph defense is explicitly documented (a security validator must not be duplicated). The `advisory_llm_checked` / `human_confirmed` walker-eligible split is the contract `faithfulness.js` and `calibration.js` depend on. 56 lines.

### `faithfulness.js`

- **Purpose** — the rung-2 advisory check (Spike C). ADVISORY + PURE: produces a VERDICT; the CALLER applies the promotion via `store.updateEdgeStatus`. Never touches the store, never calls an LLM (the judge is injected). Two rungs: rung-1 surface-overlap (audit-only) + rung-2 injectable judge (ceiling `advisory_llm_checked`).
- **Imports / consumes** — nothing (no requires). Pure functions over their args.
- **Consumers** — `calibration.js:26` (`rung2AdvisoryCheck` + `RUNG2_MAX_STATUS`); `tests/unit/lab/causal-edge/faithfulness.test.js`, `manage-ops.test.js`, `loop-and-exclusion.test.js`. The real caller in production applies the verdict via the store.
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `tokenize` | internal | lowercase + split on non-alnum runs → dedup Set | `text` | nothing | pure; non-string → empty Set |
| `jaccard` | internal | Jaccard similarity of two token Sets; empty → 0 | `a`, `b` | nothing | pure |
| `rung1SurfaceOverlap` | exported | deterministic surface-overlap precursor; suggests `surface_overlap_only` (audit-only) or `unvalidated` | `sourceText`, `targetText`, `{threshold}` | nothing (returns `{score, suggestedStatus}`) | pure; 0-overlap never escalates even at threshold 0 |
| `rung2AdvisoryCheck` | exported | the injectable advisory judge; FAIL-CLOSED; promotes ONLY on explicit `{supported:true}`; ceiling `advisory_llm_checked` | `edge`, `judgeFn` | nothing (returns `{promoted, status, reason}`) | calls `judgeFn` (may be impure); `try/catch` → not-promoted on throw |

- **File-level notes** — The narrowing-safety property is the whole point: a false-positive at rung-2 admits an edge to ADVISORY reads only, never a kernel gate, and can never mint `human_confirmed`. The `judgment.supported !== true` strict check (line 98) defeats truthy / coerced / over-claiming verdicts, and the hard-coded `status: RUNG2_MAX_STATUS` (line 104) ignores any `status`/`grant` field the judge tries to set (defense against a judge attempting privilege escalation). The honest rung-1-skip false-negative limitation is documented (a 0-overlap cross-surface causal edge stays audit-only forever). 113 lines; functions < 50 lines.

### `item-source.js`

- **Purpose** — `deriveItemSource`: map a lesson node to its trust-weight SOURCE (`signed-lane` vs `mock`) by membership in the C-W1 authenticated (ed25519-signed) edge lane. AUTHORIZATION-class (a bug is a firewall bypass / the #273 laundering lever). FAIL-CLOSED + ENV-BLIND: requires a non-empty `opts.verifyKey`, short-circuiting to `mock` without one so an ambient `LOOM_EDGE_VERIFY_KEY` can never flip a keyless caller into the signed lane.
- **Imports / consumes** — `require('./lesson-confirm')` for `authenticatedEdgeIds`. PURE (no I/O), never throws (auth-class: a throw fails CLOSED).
- **Consumers** — `tests/unit/lab/causal-edge/item-source.test.js` and `w3d-lite-composition.test.js`. No in-product consumer wires it into ranking yet (the rig injects `liveSources`; production `LIVE_SOURCES` is frozen-empty per MV-W2, so a signed-lane source is inert in prod).
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `deriveItemSource` | exported | derive `signed-lane` / `mock`; env-blind, fail-closed | `node` (object or id string), `signedEdges` array, `{verifyKey}` | nothing (returns a token string) | calls `authenticatedEdgeIds` (which verifies ed25519 sigs + re-derives `edge_id`); wrapped in `try/catch` → `mock` on any throw |

- **File-level notes** — The defense is layered: the env-blind guard (line 51) defeats `authenticatedEdgeIds`' own `LOOM_EDGE_VERIFY_KEY` env fallback for THIS function; `authenticatedEdgeIds` re-derives `edge_id` before trusting `from_node_id` (defeating a signature-replay forge). The documented residual is the #273 third face: a private-key holder can CO-FORGE a fresh valid edge — integrity ≠ provenance — tolerable ONLY because the derived source gates nothing in production. The `Array.isArray(node)` guard (line 54) correctly rejects an array passed as a node (an array is `typeof 'object'`). 63 lines; single function < 50 lines.

### `wilson.js`

- **Purpose** — the Wilson score interval (95%, no continuity correction). A pure stats helper used by the lesson-merge-lift harden-gate's disjoint-above interval test.
- **Imports / consumes** — nothing. Pure.
- **Consumers** — `lesson-merge-lift.js:32` (`wilson`); `tests/unit/lab/causal-edge/wilson.test.js`.
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `wilson` | exported | `(successes, n)` → `{lower, upper}` clamped to `[0,1]`, or `null` on invalid input; never throws | `successes`, `n` | nothing (returns interval or `null`) | pure |

- **File-level notes** — Input validation is strict: non-integers, `n <= 0`, `successes < 0`, or `successes > n` all return `null` (fail-closed at the boundary). The no-continuity-correction variant is pinned for reproducibility (CC gives materially wider intervals at small N). Bounds are clamped to `[0,1]`. The `Z` constant is exported alongside. 34 lines; single function < 50 lines.

## Findings (bugs / logical fallacies / optimizations)

| severity | level | type | location | description |
|---|---|---|---|---|
| MEDIUM | function | bug | `calibration-issue-run.js:202` | `runIssueCalibration` calls `scoreIssueCalibration(records, attemptsPerIssue, legs, { patchFor, tierOf, trajectoryFor: trajFor })` WITHOUT threading `cloneRoot`. The `cloneRoot` seam is plumbed through both `scoreAttempt` (`calibration-issue.js:162`) and `scoreIssueCalibration` (`:285`) precisely so `detectRecallSmell`/`normalizeRepoPath` can strip the absolute clone-root prefix from the actor's trajectory reads before comparing them to the repo-relative `relevantFiles` from `accepted_diff`. With `cloneRoot=undefined`, reads stay absolute (e.g. `/tmp/clone-xyz/src/foo.py`) while `relevantFiles` are repo-relative (`src/foo.py`), so `readCovers` never matches and `relevant_files_unread` is biased to `true`, inflating `recall_smell`. Bounded because the trajectory block is REPORT-ONLY and carries `detector_validated:false`, but the signal is silently wrong on the real path. |
| LOW | function | bug | `calibration-cli.js:43` | The dry path does `JSON.parse(fs.readFileSync(path.join(__dirname, 'calibration-fixtures.json'), 'utf8')).fixtures` with no try/catch. A missing or malformed fixtures file throws a raw stack dump, unlike the `--real` path which catches and prints a clean `calibrate: real run failed: ...` message (`:55-57`). Inconsistent error handling at a file boundary. |
| LOW | function | smell | `calibration-cli.js:32-33` | `mockJudgeFrom` keys its `Map` on `f.source_block + ' ' + f.target_block`. The space delimiter is ambiguous: two fixtures with blocks `("a b","c")` and `("a","b c")` produce the identical key `"a b c"`, so one would shadow the other and the mock judge would return the wrong ground truth. Benign for a curated fixtures file, but a latent collision foot-gun; a NUL or length-prefixed join would be unambiguous. |
| LOW | function | optimization | `calibration-issue.js:117-123` | `rubricLeaks` is O(tokens x acceptedDiff-length) — for each rubric token it slides a window over the full normalized `accepted_diff` calling `hay.includes(...)` at every offset. On a large accepted diff this is quadratic-ish per token. A rolling hash / substring index would bound it, though in practice rubrics + diffs are small enough that this is not a hot path. |
| LOW | function | smell | `calibration-issue.js:162` (`scoreAttempt` ~105 lines) and `calibration-issue-run.js:183` (`runIssueCalibration` ~60 lines) | Both functions exceed the project's < 50-line function guideline (`fundamentals.md`). `scoreAttempt` interleaves three legs + two W3 report-only axes; it could extract the trajectory + friction blocks into helpers for readability. Not a correctness issue. |
| INFO | function | smell | `calibration.js:96` | `fallback_reason: cleanModel ? null : ((verdict && verdict.fallback_reason) \|  \| (threw ? 'judge-threw' : 'malformed'))` — a model verdict that legitimately carries `fallback_reason: ''` (empty string, falsy) would be relabeled `'malformed'` rather than surfacing the empty reason. Edge case only; the real adapter never emits an empty `fallback_reason`. |
| INFO | function | logical-fallacy | `calibration-issue.js:168` | `const treeMutated = a.test_tree_mutated === false ? false : true;` is correctly fail-CLOSED, but the ternary is a verbose form of `a.test_tree_mutated !== false`. The comment claims "only explicit false is clean" which the code does honor; flagged only as a clarity simplification, not a bug. |
| INFO | file | smell | `cli.js:30` | `parseArgs` cannot accept a flag value that begins with `--` (it is parsed as the next flag), and a flag with no following value silently becomes boolean `true`. Acceptable for this CLI's value space (edge ids, relation names) but a documented foot-gun if a block text or path argument ever started with `--`. |
| INFO | function | optimization | `calibration-run.js:129` | `runCalibration` reads + hashes `faithfulness.js` from disk on every real run to pin `faithfulness_contract_hash`. Correct for reproducibility, but the file read is unbounded `readFileSync` of a source file at runtime — fine here (manual spike, small file), noted only as an unusual runtime dependency on a sibling source file's bytes. |
| INFO | substrate | smell | `item-source.js` (whole file) | The module is fully built + tested but has NO in-product consumer (only the two test files + the W3d rig wire it; production `LIVE_SOURCES` is frozen-empty). This is intentional shadow/advisory staging per MV-W2, but is dead-in-production code by the YAGNI lens until a future signed-lane wave; flagged for completeness, not as a defect. |

### Checklist items explicitly verified as NOT violated

- **Exact-set vs subset (`.includes`)** — the authorization-class check in `item-source.js` uses `admitted.has(nodeId)` (Set membership of an authenticated id), not a superset-tolerant subset test; the corpus negative-control check in the consumed `corpus.js:140` is exact-set. No subset-launders-into-superset bug found in scope.
- **Integrity vs provenance** — `item-source.js` correctly derives trust from the ed25519-signed lane (`authenticatedEdgeIds` re-derives `edge_id` + verifies the sig), not from a self-asserted field or mere store existence. The standing CO-FORGE residual is documented and tolerable (gates nothing in prod).
- **Read-back / dedup immutability** — `scoreAttempt` (`calibration-issue.js:214`) DEEP-freezes the verdict copies passed to leg C, including the nested `tamper_flags` array, explicitly fixing a prior shallow-freeze leak; `buildLegBInput` CLONES the rubric so a mutating `semanticFn` cannot poison the record.
- **Path traversal / symlink** — no path is opened from these scope files in a traversal-sensitive way; `calibration-issue-run.js` clone/apply paths are owned by the injected backend. `hashTestTree` walks a work dir read-only and skips `.git`.
- **Secret-scrubbing / unbounded recursion** — the `claude -p` legs bound output with `maxBuffer: 4MiB` and a timeout; `rubricLeaks`/`hashTestTree` walks are over bounded structures/trees. No egress of secrets in scope.
- **mock-green != real-path** — explicitly respected by the architecture: the pure scorers are mock-tested; the real legs live in `*-run.js` out of the glob, and the records carry `not_a_trust_score` + `sample_note` caveats about `claude -p` non-determinism.
- **async/await** — the load-bearing `await` at `calibration-issue-run.js:202` is present (its absence would serialize a pending Promise as `{}`); `scoreAttempt` awaits each injected leg; no missing-await found.
- **Fail-OPEN where fail-CLOSED required** — `faithfulness.rung2AdvisoryCheck`, `deriveItemSource`, `wilson`, `parseVerdict`, leg-A/B fallbacks, and `treeMutated` all fail CLOSED. No fail-open path found.
