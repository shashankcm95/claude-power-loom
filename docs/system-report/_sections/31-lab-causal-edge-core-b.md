# Lab causal-edge (B): lesson lifecycle + store + walker + friction — `packages/lab/causal-edge/`

> This cluster is part of the **lab** tier (advisory / shadow experiment substrate). Nothing here is enforced: there are zero `packages/kernel/hooks.json` references, every store is writer-unauthenticated and advisory, and every output is DATA-for-ranking that "narrows the retriever, never gates a merge" (the OQ-NS-6 discipline). The cluster spans three intertwined sub-systems built across v3.5 → v-next: (1) the **causal-edge graph** (the `store.js` content-addressed JSONL edge ledger, the `walker.js` read-side traversal, the `projections.js` `conflicted` view, and the `manage-ops.js` flag-conflict write op); (2) the **lesson experience layer** (`lesson-signature.js` frozen taxonomy key, `lesson-derive.js` LLM-injected derivation, `lesson-capture.js` mint orchestration, `lesson-confirm.js` hazard→predictor lane + signed-edge attestation, `lesson-consolidate.js` recurrence rollup, `lesson-merge-lift.js` HARDEN gate, `weight-source-gate.js` source firewall); and (3) the **trajectory-friction** diagnostic (`trajectory-friction.js` pure parse/metrics/cluster core + `trajectory-friction-run.js` the impure `claude -p` real-capture runner). The lesson layer reads from / writes to sibling stores in `packages/lab/attribution/` (`recall-graph-store`, `recall-edge-store`, `candidate-sidecar`, `recall-graph`).

## Directory contents & nesting

In-scope files (all in `packages/lab/causal-edge/`):

| File | Folder | One-line purpose |
|---|---|---|
| `lesson-capture.js` | `causal-edge/` | Orchestrates the W1 capture re-run: eligibility gate → derive → sidecar → mint node → consolidate. |
| `lesson-confirm.js` | `causal-edge/` | The W2 confirmation gate + hazard/predictor lane split + signed (authenticated) lane + `runConfirmationPass`. |
| `lesson-consolidate.js` | `causal-edge/` | Rolls lesson nodes up by `lesson_signature` into a recurrence report (raw + confirmed), plus the wired pass. |
| `lesson-derive.js` | `causal-edge/` | The pure derivation leg: validates an injected `deriveFn`'s lesson against the frozen floor + leak-guard. |
| `lesson-merge-lift.js` | `causal-edge/` | The v-next FORK-6 HARDEN gate (verdict lattice over arm counts + Wilson) + `lessonTrustWeight`. |
| `lesson-signature.js` | `causal-edge/` | The FROZEN closed-enum lesson taxonomy + composite key + leak-guard + `groupByKey` tally. |
| `manage-ops.js` | `causal-edge/` | The Manage-Layer `flagConflict` write op: a validated thin wrapper over `store.createEdge`. |
| `projections.js` | `causal-edge/` | The pure `conflicted` projection (D2) over the edge set; confirmed/candidate tiers. |
| `store.js` | `causal-edge/` | The advisory content-addressed JSONL causal-edge ledger (create/update-status/list). |
| `walker.js` | `causal-edge/` | The pure read-side graph walker (cluster / related / causal-chain) with R3 filter-then-index. |
| `weight-source-gate.js` | `causal-edge/` | The MV-W2 source-admission firewall: only an allow-listed provenance lane moves a real ranking weight. |
| `trajectory-friction.js` | `causal-edge/` | The pure trajectory parse / process-graph / recall-smell / friction-cluster core. |
| `trajectory-friction-run.js` | `causal-edge/` | The impure runner: top-level `claude -p` actor capture + LLM friction labeler. |

Nesting: there is one `_spike/` subfolder (`causal-edge/_spike/`) holding out-of-CI dogfood drivers (`lesson-capture-rerun.js`, `trajectory-friction-dogfood.js`, `calibration-issue-dogfood.js`, `dogfood-derive-sample.js`, plus `DOGFOOD-SAMPLE.md`). The `_spike/` files invoke the REAL `claude -p` leg and the real corpus; they live OUTSIDE `tests/unit/**` precisely so Linux CI never globs them (the pure modules in scope are the CI-tested cores). Out-of-scope siblings in the same folder include `calibration*.js`, `faithfulness.js`, `enums.js`, `wilson.js`, `item-source.js`, and `cli.js` (referenced below as consumers/deps).

## Per-file analysis

### `lesson-capture.js`

- **Purpose** — The v3.11 W1 capture re-run orchestration. For each eligible attempt it derives a lesson (injected `deriveFn`), persists the candidate-patch bytes to a content-addressed sidecar, mints a worked-example lesson node, and consolidates the batch into a recurrence report. The LLM leg is injected so the module is CI-testable with mocks.
- **Imports / consumes** — `crypto`; `./lesson-derive` (`deriveLesson`); `./lesson-consolidate` (`consolidateLessons`, `writeConsolidationReport`); `../attribution/recall-graph` (`buildWorkedExampleNode`, `isEligibleForPopulation`, `LESSON_ERR_CODE`); `../attribution/recall-graph-store` (`writeNode`); `../attribution/candidate-sidecar` (`writeCandidate`, `sidecarSha`). Consumes `opts`: `recallGraphDir`, `sidecarDir`, `reportFile`, `provenance`, `now`.
- **Consumers** — `causal-edge/_spike/lesson-capture-rerun.js` (the real driver); `tests/unit/lab/causal-edge/lesson-capture.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `acceptedDiffRef(accepted)` | exported | sha256 content-address POINTER to the sealed accepted diff (body stays in git, never re-stored) | `accepted` (any) | returns hex string | none (pure) |
| `captureLessons(items, deriveFn, opts)` | exported async | the full mint pipeline over a batch | `items[]`, injected `deriveFn`, `opts` dirs; reads `attempt.reference.problem_statement_digest`, `it.candidate_patch/accepted_diff/fail_to_pass/failed_patch` | candidate-patch sidecar file(s) via `writeCandidate`; lesson node file(s) via `writeNode`; consolidation report via `writeConsolidationReport`; returns a counts object + `minted[]` + `report` | disk: sidecar dir + recall-graph dir + report file; no process exit; awaits the injected leg |

- **File-level notes** — Bounds the new untrusted contrast input (`failed_patch`) at `MAX_CONTRAST_PATCH = 1_000_000` and treats oversize/absent as no-trap (the W3 M1 defense). The `failed_attempt_ref` only ever comes from a confirmed-OK sidecar write (never `sidecarSha`-before-write, which could dangle). The catch around `buildWorkedExampleNode` is correctly narrowed to `LESSON_ERR_CODE` (re-throws any other error). Dedup-re-runs are excluded from `minted` so the DEF-3 recurrence tally is not double-counted. Good fail-closed discipline; the only smell is the long parameter-threading and a single ~60-line function (see findings).

### `lesson-confirm.js`

- **Purpose** — The v3.11 W2 confirmation gate and lane machinery. A W1-minted lesson is PROVISIONAL (hazard lane); it enters the PREDICTOR lane only when a *different* verified passing run resolved the SAME corpus-declared `fail_to_pass` with a *different, non-trivial, non-ground-truth* delta. Also defines the v-next signed (authenticated) lane and the `runConfirmationPass` join.
- **Imports / consumes** — `../attribution/recall-graph` (`classifyLessonLayer`); `../attribution/recall-edge-store` (`writeEdge`, `loadEdge`, `deriveEdgeId`); `../attribution/candidate-sidecar` (`sidecarSha`, `writeCandidate`); `../../kernel/_lib/edge-attestation` (`signEdgeId`, `verifyEdgeSig`, `hasVerifyKey`, `SIG_ALG`). Env: indirectly `LOOM_EDGE_VERIFY_KEY` is mentioned in comments but is read inside `edge-attestation`, not here.
- **Consumers** — `causal-edge/lesson-consolidate.js` (`confirmedNodeIds`); `causal-edge/lesson-merge-lift.js` (`authenticatedEdgeIds`); `causal-edge/item-source.js` (`authenticatedEdgeIds`); `persona-experiment/grounding-slice.js` (`confirmedNodeIds`, `canEnterPredictorLane`); `tests/unit/lab/causal-edge/lesson-confirm.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `isHex64(v)` | internal | 64-hex string test | `v` | bool | none |
| `isStringSet(v)` | internal | non-empty array of non-empty strings | `v` | bool | none |
| `sameRequirement(a, b)` | exported | exact-set equality on requirement sets (order/multiplicity-insensitive) | `a`, `b` | bool | none |
| `confirmsLesson(node, confirmingAttempt, trustedFailToPass)` | exported | the gate: TRUE iff valid lesson + verified passing attempt independently resolved the SAME corpus requirement with a different non-trivial non-ground-truth delta | `node`, `confirmingAttempt`, `trustedFailToPass`; calls `classifyLessonLayer`, `sidecarSha` | bool | none (pure) |
| `confirmedNodeIds(edges)` | exported | strict-HEX64 set of `from_node_id` over confirmed-by edges | `edges[]` | `Set` | none |
| `canEnterPredictorLane(node, ids)` | exported | membership test of node in confirmed set | `node`, `ids:Set` | bool | none |
| `authenticatedEdgeIds(edges, opts)` | exported | the SIGNED lane: like `confirmedNodeIds` but additionally requires a valid ed25519 sig; fail-closed empty without a verify key | `edges[]`, `opts.verifyKey`; calls `hasVerifyKey`, `deriveEdgeId`, `verifyEdgeSig` | `Set` | none |
| `runConfirmationPass(provisionalNodes, confirmingAttempts, opts)` | exported async | join provisional nodes × confirming attempts; for each genuine confirm, sidecar the candidate then write the edge | `provisionalNodes[]`, `confirmingAttempts[]`, `opts.{edgeDir, sidecarDir, now, requirementFor, signingKey}`; calls `confirmsLesson`, `writeCandidate`, `writeEdge`, `loadEdge`, `signEdgeId` | sidecar file(s); confirmed-by edge file(s); returns counts + `edges[]` (canonical stored) + `confirmed_node_ids[]` | disk: sidecar dir + edge dir; mints signatures iff `signingKey` given |

- **File-level notes** — This is the cluster's strongest defensive module. The gate re-verifies the node it is handed (`classifyLessonLayer === 'valid'` re-derives `lesson_content_hash`), forbids self-confirmation (`deltaRef === node.candidate_patch_sha`) and ground-truth-as-confirmation (`deltaRef === node.accepted_diff_ref`), and sources the requirement from the trusted corpus only (fail-closed if absent). `authenticatedEdgeIds` re-derives `edge_id` before trusting `from_node_id`, defeating the signature-replay forge. `runConfirmationPass` adds to `confirmed` only on a successful write and returns the canonical stored edge (never the raw pre-derive rec). The standing residual is honestly documented: integrity ≠ provenance — a co-forged self-consistent edge still inflates the SHADOW weight (acceptable because it never gates). One latent concern flagged in findings: `confirmed.add(node.node_id)` happens on a deduped write too, but `edges` only gets the fresh canonical edge — so `confirmed_node_ids` can include a node whose canonical edge is not in the returned `edges` array (an inter-field divergence the comment actually intends but does not flag).

### `lesson-consolidate.js`

- **Purpose** — The W1 consolidation pass (DEF-3): roll lesson nodes up by `lesson_signature` into a recurrence report (raw count always; confirmed count when a confirmed-set is supplied) plus the under-separation diagnostic. A pure core + an impure dir-injectable writer + a fully-wired `runConsolidationPass`.
- **Imports / consumes** — `fs`, `os`, `path`; `../../kernel/_lib/atomic-write` (`writeAtomicString`); `./lesson-signature` (`groupByKey`); `../attribution/recall-graph` (`classifyLessonLayer`); `../attribution/recall-graph-store` (`listNodes`); `../attribution/recall-edge-store` (`listEdges`); `./lesson-confirm` (`confirmedNodeIds`); `../attribution/candidate-sidecar` (`readCandidate`). Env: `LOOM_LAB_STATE_DIR` (for `DEFAULT_REPORT`).
- **Consumers** — `causal-edge/lesson-capture.js`; `issue-corpus/_spike/corpus-build/bootcamp-measure.js`; `tests/unit/lab/causal-edge/lesson-consolidate.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `consolidateLessons(nodes, opts)` | exported | PURE rollup by `lesson_signature`; re-validates the FULL lesson layer; optional confirmed weight | `nodes[]`, `opts.confirmedNodeIds:Set`; calls `classifyLessonLayer`, `groupByKey` | returns report object | none (pure) |
| `writeConsolidationReport(report, opts)` | exported | stamp + atomic-write the report | `report`, `opts.{file, now}` | report JSON file (default `DEFAULT_REPORT`) | disk write; `mkdirSync`; returns `{ok}` |
| `runConsolidationPass({nodeDir, edgeDir, sidecarDir, reportFile, now})` | exported | the WIRED pass: source nodes + edges only from verify-on-read stores; drop phantom-delta edges; consolidate + write | reads node dir, edge dir, sidecar dir via `listNodes`/`listEdges`/`readCandidate`; calls `confirmedNodeIds`, `consolidateLessons`, `writeConsolidationReport` | report file | disk read + report write |

- **File-level notes** — The C1 fold is real: `consolidateLessons` re-runs `classifyLessonLayer === 'valid'` so a forged node (self-computing its own hash) cannot inflate the confirmed weight. `runConsolidationPass` belt-and-suspenders by also sourcing from verify-on-read stores and enforcing the W2 detectability lever (an edge whose `to_delta_ref` is not sidecar-recoverable is dropped). The provenance residual is documented (integrity, not provenance). Determinism is preserved via signature-key sort. No mutation of inputs.

### `lesson-derive.js`

- **Purpose** — The pure W1 derivation leg. Wraps an injected `deriveFn` (the real `claude -p` contrast lens in the spike, a mock in tests), validates its output against the FROZEN closed-enum floor, and leak-guards the prose body against the sealed accepted diff before trusting the closed-enum key.
- **Imports / consumes** — `./lesson-signature` (`TRIGGER_CLASS`, `GOTCHA_CLASS`, `CORRECTIVE_CLASS`, `lessonClusterKey`, `lessonLeaks`, `LESSON_BODY_MAX`).
- **Consumers** — `causal-edge/lesson-capture.js`; `tests/unit/lab/causal-edge/lesson-derive.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `harnessFallback(reason)` | internal | the standard fail-closed result | `reason` | returns `{ok:false, ...}` | none |
| `deriveLesson(contrastInput, deriveFn)` | exported async | validate + leak-guard the leg output | `contrastInput.{problem_statement_digest, candidate_patch, accepted_diff, failed_patch}`, injected `deriveFn`; calls `lessonLeaks`, `lessonClusterKey` | returns validated lesson result or harness fallback | awaits the injected leg; catches any leg throw → fallback |

- **File-level notes** — Order is correct: off-floor enum → bound the body (`LESSON_BODY_MAX`) → leak-guard → only then trust the key. The body is `String()`-coerced (so a non-string body cannot bypass the length cap). The leg may be sync or async and may throw (caught). `failed_patch` is forwarded to the leg but deliberately NOT added to the leak needle (a wrong attempt is not the answer key); the body is still scanned only against `accepted_diff`. The documented residual (a `< RUBRIC_LEAK_MIN`-char secret can slip; cross-script homoglyphs evade) lives in `lesson-signature.lessonLeaks`, not here.

### `lesson-merge-lift.js`

- **Purpose** — The v-next MV-W1 FORK-6 HARDEN gate. A pure function `(armCounts, edges, opts) → verdict` deciding whether a `(lesson_signature × cell)` pair HARDENS given a maintainer-judged differential A/B/placebo outcome. MV-W2 adds `lessonTrustWeight(verdict)`.
- **Imports / consumes** — `./wilson` (`wilson`); `./lesson-confirm` (`authenticatedEdgeIds`). Consumes `armCounts` (`{treatment|control|placebo: {merged, n}}`), `edges[]`, `opts.{verifyKey, nodeId, maintainers[], selfDenylist, avoided, lessonSignature, placeboSignature}`.
- **Consumers** — `causal-edge/weight-source-gate.js` (`lessonTrustWeight`); `tests/unit/lab/causal-edge/lesson-merge-lift.test.js`. (`evaluateHardenGate` itself appears only test-consumed in-repo at this stage — the MV-W4 live interleaver does not yet exist.)
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `armN(armCounts, a)` | internal | integer `n` for arm `a`, else -1 | `armCounts`, `a` | number | none |
| `evaluateHardenGate(armCounts, edges, opts)` | exported | the 4-valued verdict lattice (INSUFFICIENT-N > EXCLUDED > HARDEN/WITHHOLD) | arm counts, edges, opts; calls `armN`, `authenticatedEdgeIds`, `wilson` | returns `{verdict, reasons[]}` | none (never throws) |
| `lessonTrustWeight(verdict)` | exported | HARDEN→1, every other verdict→0; never negative; source-free | `verdict` | number | none (pure) |

- **File-level notes** — Strong anti-laundering design: ADMISSION is the signed lane only (`authenticatedEdgeIds`), the verify key is opts-only / env-blind (a missing key short-circuits to an empty `Set`, never the delegate's env fallback). Placebo independence is fail-closed (missing either signature → not-independent). Maintainer logins are trimmed + lower-cased for the distinct-not-us count, and a non-Set `selfDenylist` (an array) is coerced (a silent empty-Set fallback would nullify the anti-self-merge check). `lessonTrustWeight` is total + source-free by design (a source must never be a free arg — the #273 third face). The N-floor uses precedence over admission, which is correct. One minor concern: `wilson` returns null when `merged > n`, and the gate reports "un-computable arm interval" — but `merged > n` is a data-integrity error that the gate silently downgrades to WITHHOLD rather than INSUFFICIENT-N or a distinct invalid verdict (acceptable since it fails closed; noted as LOW).

### `lesson-signature.js`

- **Purpose** — The FROZEN lesson taxonomy (the experience layer's content-addressed key) + the composite-key builder + the string-variant leak-guard + the generic `groupByKey` tally. Pure + deterministic; the one-way-door append-only floor.
- **Imports / consumes** — `../_lib/enum-key` (`safeEnumKey`); `./calibration-issue` (`RUBRIC_LEAK_MIN`, `normalizeAlnum`).
- **Consumers** — `../attribution/recall-graph.js` (`lessonClusterKey`, the three enums, `LESSON_BODY_MAX`); `causal-edge/lesson-consolidate.js` (`groupByKey`); `causal-edge/lesson-derive.js` (the enums, `lessonClusterKey`, `lessonLeaks`, `LESSON_BODY_MAX`); `causal-edge/_spike/lesson-capture-rerun.js` (the enums); `tests/unit/lab/causal-edge/lesson-signature.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `lessonClusterKey(block)` | exported | `lesson:`-prefixed composite key from three closed enums via `safeEnumKey` | `block.{trigger_class, gotcha_class, corrective_class}` | string | none |
| `assertEnumDelimiterSafe(arrays)` | exported | throws if any enum value is non-string or contains `\|`/`:` | `arrays[][]` | true / throws | none (called at module load) |
| `lessonLeaks(str, acceptedDiff)` | exported | does the body share a ≥`RUBRIC_LEAK_MIN` normalized-alnum run with the sealed diff | `str`, `acceptedDiff`; calls `normalizeAlnum` | bool | none |
| `groupByKey(blocks, keyFn)` | exported | generic null-proto exact-key tally with positional members | `blocks[]`, `keyFn` | `{groups, n}` | none |

- **File-level notes** — `assertEnumDelimiterSafe` runs at module load on the three enums (fail-fast on a typo'd value with a reserved separator). `safeEnumKey` collapses any off-enum/non-string component to the closed `INVALID` token, so a RAW block cannot inject a `\|`/`:` separator or seat a poison key. `groupByKey` uses `Object.create(null)` so a poison-token key can never pollute. The leak-guard reuses the SAME min-run + normalizer as `rubricLeaks` (imported, never re-literal'd). Residuals (short-secret slip; homoglyphs) are honestly documented. `lessonLeaks` is `O(body × accepted)` but the body is bounded upstream (`LESSON_BODY_MAX`); noted as an optimization (rolling-hash) in findings.

### `manage-ops.js`

- **Purpose** — The Manage-Layer's first WRITE op (v3.5 W3a). `flagConflict` is a thin validated CREATE over the Wave-2 causal-edge store: it emits a `contradicts` edge born `unvalidated` (audit-only, walker-excluded until a rung-2 judge promotes it). CREATE-only; never destructive.
- **Imports / consumes** — `./store` (`createEdge`). Consumes `input.{blockX, blockY, conflictType, origin, now}`.
- **Consumers** — `manage-proposal/cli.js`; `causal-edge/cli.js`; `tests/unit/lab/causal-edge/manage-ops.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `flagConflict(input)` | exported | pin `relation='contradicts'`, presence-check conflictType+origin, reject self-contradiction, delegate to `createEdge` | `input` fields | delegates the edge write to `createEdge` | disk (ledger) via the store; throws a clean Error on bad input |

- **File-level notes** — Three owned guards (pin relation; presence-check `conflictType`+`origin`; reject `blockX===blockY`); everything else (closed-enum validity, free-string caps, R1 default, lock, content-address) delegates to the store (single admission gate, DRY). The self-contradiction guard is correctly gated on a non-empty-string `blockX` so a missing block falls through to the store's clean "source_block required" rather than misfiring. Clean, small, well-factored.

### `projections.js`

- **Purpose** — The pure `conflicted` projection (D2): map each block touched by a `contradicts` edge to a `confirmed`/`candidate` tier. Annotation, never suppression. Computed in the lab layer because the kernel cannot read lab (K12 inner→outer).
- **Imports / consumes** — `./walker` (`isEligible`). Pure over a passed-in `edges[]`.
- **Consumers** — Only `tests/unit/lab/causal-edge/projections.test.js` imports it directly (the `manage-proposal/projections.js` matches are a *separate* same-named file; `provenance-projections.js` only references it in a comment). So in-repo the production consumer wiring is the kernel/runtime ranking layer (not yet wired here) + the test.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `isRecord(r)` | internal | object-not-array guard | `r` | bool | none |
| `nonEmptyStr(v)` | internal | non-empty string guard | `v` | bool | none |
| `conflictedBlocks(edges)` | exported | block_id → `{tier, edges[]}`; confirmed iff ≥1 R3-eligible contradicts edge | `edges[]`; calls `isEligible` | returns a `Map` | none (pure; does not mutate input) |

- **File-level notes** — The load-bearing pre-filter is correct: filter to `relation === 'contradicts'` FIRST, THEN apply `isEligible` (else a `caused_by`/eligible edge would falsely mark endpoints conflicted, since `isEligible` admits all 9 relations). `confirmed` is monotonic + order-independent. The self-loop guard (`target !== source`) avoids double-listing the edge for a degenerate self-loop planted via the raw store. One subtlety flagged in findings: the returned `Map` entries hold the *raw* incident edge objects by reference and the `edges` arrays are not frozen — a caller that mutates a returned `edge` mutates the input (the projection is "pure" w.r.t. not reassigning, but the contained edges are shared references).

### `store.js`

- **Purpose** — The v3.5 W2 advisory content-addressed causal-edge JSONL ledger. Records LLM-asserted semantic edges (`caused_by`/`contradicts`/...) between memory blocks. Observes + records; never blocks or gates. Dedups on a re-derived `edge_id`; a mutable `faithfulness_status` is superseded in place.
- **Imports / consumes** — `os`, `path`, `crypto`; `../../kernel/_lib/atomic-write` (`writeAtomicString`); `../../kernel/_lib/lock` (`acquireLock`, `releaseLock`); `../../kernel/_lib/canonical-json` (`canonicalJsonSerialize`); `../../kernel/_lib/jsonl-read` (`readJsonlBounded`); `../../kernel/_lib/free-string-checks` (`nonEmptyString`, `hasControlChars`); `./enums` (`RELATIONS`, `CONFLICT_TYPES`, `FAITHFULNESS_STATUSES`, `DEFAULT_FAITHFULNESS_STATUS`, `validateEnum`). Env: `LOOM_LAB_STATE_DIR`, `LOOM_LAB_MAX_LEDGER_BYTES`.
- **Consumers** — `causal-edge/manage-ops.js` (`createEdge`); `causal-edge/cli.js` (`createEdge`, `updateEdgeStatus`, `listEdges`); `tests/unit/lab/causal-edge/store.test.js`. (Note: the many `verdict-attestation/store` / `negative-attestation/store` / `manage-proposal/store` grep hits are DIFFERENT same-named files.)
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `sha256(s)` | internal | hex sha256 | `s` | string | none |
| `withLabLock(fn, onContended)` | internal | advisory soft-lock; warn+fallback on contention (NEVER `process.exit`) | `fn`, `onContended`; calls `acquireLock`/`releaseLock` | stderr warning on contention | acquires/releases the lock file; runs `fn` |
| `isAuthenticEdge(r)` | internal | re-derive `edge_id` from body; INV-22 content-address verify | `r`; calls `computeEdgeId` | bool | none |
| `readLedger()` | internal | bounded JSONL read → array, then drop forgeries | `LEDGER_PATH`; calls `readJsonlBounded`, `isAuthenticEdge` | array | reads the ledger file (never throws) |
| `writeLedger(records)` | internal | atomic whole-ledger write | `records[]` | `LEDGER_PATH` (atomic) | disk write; `mkdir` via atomic-write |
| `nowMsFrom(opts)` | internal | resolve injected `now` to ms | `opts.now` | number | none |
| `tsOf(record)` | internal | parse `recorded_at`→ms; unparseable→-Infinity | `record` | number | none |
| `validateFreeString(v, fieldName)` | internal | non-empty + byte-capped + control-char-free | `v` | string / throws | none |
| `validateCreateEdgeInput(o)` | internal | validate+normalize all create inputs at the boundary | `o`; calls `validateEnum`, `validateFreeString` | normalized fields / throws | none |
| `computeEdgeId(rel, src, tgt, ct)` | exported | the identity content-address over the tuple | the four identity fields; calls `canonicalJsonSerialize`, `sha256` | string | none |
| `createEdge(input)` | exported | create-or-idempotently-return; count-cap; dedup on `edge_id` | `input`; calls validation, `readLedger`, `writeLedger`, `withLabLock` | a new ledger record (or returns existing) | disk write under lock; throws on bad input / non-finite `now` |
| `updateEdgeStatus(edgeId, newStatus)` | exported | supersede `faithfulness_status` in place (read-modify-write whole ledger) | `edgeId`, `newStatus`; calls `validateEnum`, `readLedger`, `writeLedger` | the updated record (or `{notFound}`) | disk write under lock; throws on invalid status |
| `listEdges(opts)` | exported | read-only list with optional filter; shallow-freeze each row | `opts.filter`; calls `readLedger` | frozen records | reads ledger; no lock |

- **File-level notes** — The store is honest about its trust model: writer-unauthenticated, advisory, narrowing-safe. INV-22 is enforced on read (`isAuthenticEdge` re-derives `edge_id`; a tampered/hand-planted row is skipped, self-healing on the next write). The `now` guard rejects both non-finite AND out-of-`MAX_DATE_MS`-range timestamps before `toISOString()` can throw. The count-cap sort uses a stable index tiebreaker for same-millisecond rows. The read-back freeze is shallow but the comment correctly notes an edge record is all-scalar (no nested array/object to leak — unlike a proposal's `target_records`), so the shallow freeze is sufficient HERE. `updateEdgeStatus` correctly read-modify-writes rather than re-calling `createEdge` (which would dedup and drop the status change). The main residual is the documented O(N)-whole-ledger read-modify-write on every status change (a smell, noted as INFO/LOW).

### `walker.js`

- **Purpose** — The v3.5 W2 pure read-side graph walker. Generalizes the kernel provenance-walk leaf to semantic multi-relation fan-out. Three modes: `cluster` (full undirected component), `related` (depth-1), `causal-chain` (directed forward). Advisory; output is DATA for ranking, never instructions.
- **Imports / consumes** — `../../kernel/_lib/provenance-walk` (`DEFAULT_MAX_NODES`); `./enums` (`RELATIONS`, `WALKER_ELIGIBLE_STATUSES`). Pure over a passed-in `edges[]`.
- **Consumers** — `causal-edge/projections.js` (`isEligible`); `causal-edge/cli.js` (`walk`); `tests/unit/lab/causal-edge/walker.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `isRecord(r)` | internal | object-not-array guard | `r` | bool | none |
| `nonEmptyStr(v)` | internal | non-empty string guard | `v` | bool | none |
| `clampMaxNodes(opts)` | internal | positive-int maxNodes or default | `opts.maxNodes` | number | none |
| `isEligible(edge)` | exported | the SOLE R3 admission gate: eligible status + known relation + both endpoints + `edge_id` | `edge` | bool | none |
| `indexByBlock(eligibleEdges)` | exported | undirected adjacency index (each edge under both endpoints) | `eligibleEdges[]` | `Map` | none (does NOT re-filter) |
| `neighborOf(block, e, mode)` | internal | the followable neighbor for a mode (directed vs undirected) | `block`, `e`, `mode` | string/null | none |
| `walk(seedBlock, edges, opts)` | exported | bounded cycle-safe BFS from a seed | `seedBlock`, `edges[]`, `opts.{mode, maxNodes, maxDepth, maxEdges}`; calls `isEligible`, `indexByBlock`, `neighborOf` | returns `{reachedBlocks[], traversedEdges[], truncated}` | none (pure) |

- **File-level notes** — Filter-then-index is enforced in `walk` (filter to eligible first, index only eligible, never touch the raw array again — so no mode can surface an audit-only edge). `isEligible` requires a non-empty `edge_id` (the `traversedEdges` dedup key — without it, id-less edges collide on `undefined`). Both `reachedBlocks` (`maxNodes`) and `traversedEdges` (`maxEdges`) are bounded; cycle-safe via a seen-set. One subtle correctness point flagged in findings: `traversedEdges` truncation (line 156) sets `truncated=true` but `continue`s the neighbor loop, so an edge can be skipped yet the walk still reaches the neighbor through a different edge — this is intended (the cap is on the edge OUTPUT not reachability), and is correct. No mutation of inputs.

### `weight-source-gate.js`

- **Purpose** — The v-next MV-W2 OQ-NS-6 source-admission firewall for the lesson trust-weight wire. Only a provenance lane in the live-allow-set may move a real ranking weight; in MV-W2 the production set is EMPTY (frozen), so every source is inert in prod and the mechanism is proven only via a test-injected allow-set.
- **Imports / consumes** — `./lesson-merge-lift` (`lessonTrustWeight`). Pure; no I/O.
- **Consumers** — Only `tests/unit/lab/causal-edge/weight-source-gate.test.js` in-repo (the live retriever wiring is MV-W3, not yet present).
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `isLiveSource(source, opts)` | internal | exact membership (no coercion) against an injected allow-set or the frozen prod default | `source`, `opts.liveSources` | bool | none |
| `admitWeightForRanking(record, opts)` | exported | return `record.weight` iff source admitted + weight finite ≥0, else 0; never throws | `record.{source, weight}`, `opts` | number | none |
| `buildRankingWeights(items, opts)` | exported | the SOLE constructor of the `lesson_signature → number` map the retriever reads; last-wins dedup | `items[]`, `opts`; calls `lessonTrustWeight`, `admitWeightForRanking` | null-proto object | none (pure) |

- **File-level notes** — `LIVE_SOURCES = Object.freeze([])` is correctly a frozen ARRAY, not `Object.freeze(new Set())` — the comment explicitly documents the gotcha that a frozen Set's `.add()` still mutates (fake immutability). Exact membership with zero coercion (the comment warns NOT to copy the maintainer-login normalization — trim/lowercase is identity-dedup, never authorization). `buildRankingWeights` is last-wins so a later WITHHOLD evicts a stale HARDEN, and a 0 deletes the key rather than writing a 0. The forward invariant (the retriever is source-blind; the firewall holds only because `buildRankingWeights` is the SOLE constructor) is documented. Clean.

### `trajectory-friction.js`

- **Purpose** — The v3.9 W3 pure trajectory parse / process-graph / recall-smell / friction-cluster core. Parses `claude -p --output-format stream-json` NDJSON into ordered trajectory rows, computes Layer-1 process metrics, detects the two-signal recall smell, and builds/clusters closed-enum friction blocks. The LLM and real capture are never called here.
- **Imports / consumes** — `crypto`; `../issue-corpus/corpus` (`N_CLEAN_LARGE_MIN`); `../_lib/enum-key` (`safeEnumKey`).
- **Consumers** — `../attribution/recall-graph.js` (`frictionClusterKey`, `clusterFriction`, `validateResolutionFriction`); `causal-edge/calibration-issue.js` (`parseTrajectory`, `computeProcessGraph`, `detectRecallSmell`, `buildFrictionLabelerInput`, `validateResolutionFriction`); `causal-edge/trajectory-friction-run.js`; `causal-edge/_spike/trajectory-friction-dogfood.js`; `tests/unit/lab/attribution/recall-graph.test.js`; `tests/unit/lab/causal-edge/trajectory-friction.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `hasOwn(o, k)` | internal | safe own-property test | `o`, `k` | bool | none |
| `digest(x)` | internal | fail-closed sha256[:16] digest (circular→sentinel) | `x` | string | none |
| `classifyBashPhase(command)` | exported | `validation` iff test-like, else `ambiguous` | `command` | string | none |
| `phaseOf(name, input)` | internal | tool→phase lookup (Bash→`classifyBashPhase`) | `name`, `input` | string/null | none |
| `extractTargetPath(name, input)` | internal | pull a file/path/pattern target for a file-target tool | `name`, `input` | string/null | none |
| `coerceContent(content)` | internal | flatten tool_result content to a string | `content` | string | none |
| `parseTrajectory(streamEvents)` | exported | NDJSON events → ordered rows; FIFO tool_use↔tool_result pairing | `streamEvents[]`; calls `digest`, `phaseOf`, `extractTargetPath`, `coerceContent` | returns `{rows, dropped_noise, unpaired}` | none (pure; uses a `Map` to avoid prototype pollution) |
| `computeProcessGraph(rows)` | exported | Layer-1 metrics (loop_count, back_edge, phase counts) | `rows[]` | returns metrics object | none |
| `normalizeRepoPath(p, {cloneRoot})` | exported | strip cloneRoot + leading `./`/`/` | `p`, `cloneRoot` | string | none |
| `baseName(p)` | internal | last path segment | `p` | string | none |
| `readCovers(f, reads)` | internal | exact OR basename/suffix match | `f`, `reads[]` | bool | none |
| `detectRecallSmell({processGraph, relevantFiles, reachedResolution, lowLoopMax, cloneRoot})` | exported | two-signal fail-closed recall smell | the destructured opts; calls `normalizeRepoPath`, `readCovers` | returns `{recall_smell, signals}` | none |
| `validEmbedding(e)` | internal | bounded numeric-array guard | `e` | bool | none |
| `buildResolutionFriction({...})` | exported | build a frozen closed-enum friction block (+ optional embedding) | the destructured fields | returns a frozen block / throws on bad enum | none |
| `isValidResolutionFriction(block)` | internal | closed-enum shape guard | `block` | bool | none |
| `validateResolutionFriction(block)` | exported | return block iff valid, else null (fail-closed) | `block` | block/null | none |
| `frictionClusterKey(block)` | exported | the deterministic 3-tuple cluster key via `safeEnumKey` | `block` enum fields | string | none |
| `clusterFriction(blocks)` | exported | null-proto exact-key tally | `blocks[]`; calls `frictionClusterKey` | `{clusters, n}` | none |
| `validateRecallSmellAgainstControls(labeled, {fpThreshold, tpFloor, minN})` | exported | three-valued discrimination verdict over labeled controls | `labeled[]`, thresholds | returns a verdict object | none |
| `buildFrictionLabelerInput({...})` | exported | the PUBLIC-SAFE projection for the impure labeler (metrics only; no paths, no oracle) | problem digest, candidate patch, processGraph | returns a stripped input object | none |

- **File-level notes** — Strong adversary-input discipline: a `Map` (not a plain object keyed by an untrusted tool name) for pairing → no prototype pollution; FIRST-tool_use-wins FIFO pairing so a forged/duplicate tool_result cannot overwrite an existing pairing; `digest` is fail-closed on circular/non-serializable input. The recall smell fires on TWO signals (low-loop + reached AND relevant-files-unread), never trajectory-shape alone, and is `UNKNOWN`/fail-closed with no relevant files. `frictionClusterKey` reads only the three named enum fields through `safeEnumKey` (never a `JSON.stringify` that would re-admit attacker `_diagnostic` free-text). The `_diagnostic` free-text is frozen + explicitly excluded from the key. This is at the file-size boundary (~395 lines) but well-segmented; `validateRecallSmellAgainstControls` correctly null-guards the rates before minting DISCRIMINATES. The biggest residual is documented: this is a calibrated heuristic, not an oracle; the labeler error bar is UNKNOWN-until-measured (never the borrowed 87%/13%). One under-claim noted in findings: `readCovers`'s basename-suffix fallback can false-NEGATIVE (a same-basename read in a different dir suppresses a smell) — but this is the deliberately-safe direction.

### `trajectory-friction-run.js`

- **Purpose** — The v3.9 W3 IMPURE real-capture runner. Invokes a top-level `claude -p --output-format stream-json --verbose` actor over the BLIND public problem, observes the tool log, and runs the LLM friction labeler. Lives outside `tests/unit/**` so CI never globs it.
- **Imports / consumes** — `fs`, `os`, `path`, `child_process` (`spawnSync`); `./trajectory-friction` (the pure core fns); `../issue-corpus/corpus` (`splitRecord`).
- **Consumers** — `persona-experiment/real-solve.js` (`runActorTrajectory`); `persona-experiment/_spike/real-solve-spike.js` (`resolveClaude`); `issue-corpus/_spike/real-e2e-actor-dogfood.js`; `attribution/_spike/recall-retrieval-test.js`; `causal-edge/calibration-issue-run.js`; `causal-edge/_spike/trajectory-friction-dogfood.js`; `tests/unit/lab/causal-edge/build-actor-prompt.test.js` (`buildActorPrompt` only).
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `resolveClaude()` | exported | locate the `claude` binary (PATH then `~/.local/bin`) | `spawnSync('command -v claude')`, `fs.existsSync` | path/null | spawns a `command -v` subprocess |
| `parseStreamJson(stdout)` | exported | split NDJSON stdout to parsed events; skip unparseable lines | `stdout` | events[] | none |
| `buildActorPrompt(record, extraContext)` | exported | build the blind actor prompt (public problem + optional extraContext) | `record`, `extraContext`; calls `splitRecord` | string | none (pure) |
| `runActorTrajectory({record, claudeBin, model, timeout, cwd, allowedTools, extraContext})` | exported | spawn the top-level actor; fail-closed to empty events on error/timeout/nonzero | the opts; calls `resolveClaude`, `buildActorPrompt`, `spawnSync`, `parseStreamJson` | returns `{ok, reason, events, ...}` | spawns a `claude -p` child (real LLM + real tools in the actor's cwd!) |
| `captureProcessGraph(record, opts)` | exported | capture + reduce to `{rows, process_graph}` | `record`, `opts`; calls `runActorTrajectory`, `parseTrajectory`, `computeProcessGraph` | returns the reduced result | spawns the actor (via `runActorTrajectory`) |
| `claudeOnce(bin, prompt, timeout)` | internal | one `claude -p` call returning parsed JSON (fence-stripped) | `bin`, `prompt`, `timeout`; `spawnSync` | `{ok, obj}` / `{ok:false, reason}` | spawns a `claude -p` child |
| `makeFrictionLabeler({bin, timeout})` | exported | build the impure fail-closed friction labeler fn | `bin`, `timeout`; calls `resolveClaude`, `claudeOnce`, `buildResolutionFriction` | returns `frictionFn` | the returned fn spawns `claude -p` |

- **File-level notes** — The firsthand-proven invocation contract is honored: prompt rides STDIN (not a trailing argv that the variadic `--allowedTools` would eat); `--model` is pinned (`DEFAULT_MODEL`); the actor sees only the public problem (`splitRecord(record).public`); the labeler is fail-closed (any refuse/parse-failure/unknown-enum → null block). `runActorTrajectory` distinguishes ETIMEDOUT/ENOBUFS/nonzero-exit and fails closed to empty events rather than a fabricated trajectory. The fence-strip regex matches the calibration-run precedent. This is the cluster's mock-vs-real boundary: every consumer that mocks `runActorTrajectory`/`frictionFn` is testing a hypothesis about a path this module exercises for real — the documented Rule-2a-corollary risk (see findings INFO). The actor runs with `Write`/`Edit`/`Bash` enabled in `cwd` — by design (it resolves a real issue in a clone), but the `cwd` is caller-supplied and there is no in-module sandbox (deferred to the ContainerAdapter tier).

## Findings (bugs / logical fallacies / optimizations)

| severity | level | type | location | description |
|---|---|---|---|---|
| MEDIUM | function | bug | `lesson-confirm.js:172-181` (`runConfirmationPass`) | Field divergence on dedup: `confirmed.add(node.node_id)` runs on `w.ok` (including `w.deduped`), but `edges.push(stored)` runs only on `!w.deduped`. So a node whose confirming edge already existed lands in the returned `confirmed_node_ids` while its canonical edge is absent from the returned `edges[]`. A caller that builds a confirmed-set from the returned `edges` (rather than `confirmed_node_ids`) and a different caller using `confirmed_node_ids` will disagree on the same run. The two output channels are not equivalent — document or reconcile (e.g. push the loaded stored edge on dedup too, or only add to `confirmed` on a fresh write). |
| MEDIUM | function | smell | `projections.js:56-89` (`conflictedBlocks`) | The returned `Map` shares raw input edge references and the per-block `edges` arrays are not frozen. A caller mutating `entry.edges` or a contained edge object mutates the caller's input edge set — the projection is "pure" only in that it does not reassign inputs. Given the cluster's read-back-immutability discipline elsewhere (`store.listEdges` freezes rows; `recall-graph-store.listNodes` deep-freezes), this projection should freeze its returned annotation entries / shallow-copy edges to honor the same contract. |
| LOW | function | logical-fallacy | `lesson-merge-lift.js:91` (`evaluateHardenGate`) | A `merged > n` arm (a data-integrity violation) makes `wilson` return null, which the gate reports as "un-computable arm interval (bad merged count)" and downgrades to WITHHOLD. WITHHOLD is the "demonstrated decline" verdict, but a malformed count is neither a decline nor evaluated evidence — it is closer to INSUFFICIENT-N / invalid input. Fails closed (safe), but the verdict-lattice comment (lines 26-28) explicitly says "no data" and "not eligible" must be DISTINCT from a demonstrated decline; a bad-count arm violates that intent by collapsing into WITHHOLD. |
| LOW | function | optimization | `lesson-signature.js:110-118` (`lessonLeaks`) and `calibration-issue.js:118-120` (`rubricLeaks`) | The leak scan is `O(body × accepted)`: for every window of the normalized body it calls `hay.includes(...)` (itself O(accepted)). The body is bounded by `LESSON_BODY_MAX` so it cannot DoS, but a rolling hash / suffix-automaton over `hay` would make it linear. Pure optimization, no correctness impact. |
| LOW | file | smell | `store.js:261-276` (`updateEdgeStatus`) | Every status promotion reads the whole ledger, mutates one record, and rewrites the entire file under the lock — O(N) per promotion with whole-file atomic rewrite. Acceptable at the count cap (`MAX_LEDGER_RECORDS=10000`) and the dedup keeps the ledger small in practice, but it is a quadratic-in-promotions cost if a workload promotes many edges in sequence. Documented as advisory-bounded; noted for completeness. |
| LOW | function | smell | `lesson-capture.js:45-113` (`captureLessons`) | Single function ~68 lines (exceeds the project's <50-line guideline) threading nine local counters and seven `opts` fields. The per-item body (eligibility → derive → sidecar → mint → write) is a natural extract-method candidate; the counter bag could be a small accumulator. No behavior issue. |
| INFO | function | smell | `lesson-merge-lift.js:49-52` (`armN`) | `armN` conflates two distinct failures into the same `-1` sentinel: a missing arm object and a non-integer `n`. Both correctly trip the floor (so behavior is safe), but the INSUFFICIENT-N reason string (`arm X below floor`) is slightly misleading when the real cause is a malformed/absent count rather than a small-but-valid sample. Cosmetic. |
| INFO | component | bug | `trajectory-friction-run.js` (whole module) + every mock-based consumer test | Mock-green ≠ real-path (the documented Rule-2a-corollary). The pure core is exhaustively unit-tested with synthetic NDJSON, and `real-solve.js`/`calibration-issue-run.js` inject a `solveFn`/`frictionFn` that is mocked in CI. The REAL `claude -p` actor path (STDIN prompt contract, model pinning, fence-strip, ETIMEDOUT/ENOBUFS handling) is only exercised in `_spike/` dogfoods outside CI. The pieces most likely to break (a flag eating the positional prompt, a missing model default, an un-fenced JSON judge) are precisely the ones no unit test can see. This is by design and honestly documented, but it is the cluster's standing untested seam — flagged so the system report records it. |
| INFO | substrate | smell | `lesson-confirm.js:25-29`, `lesson-consolidate.js:110-117`, `store.js:29-37` | Integrity ≠ provenance (the #273 standing residual), honestly documented in three places. All three stores verify CONTENT on read (re-derive the content-address / re-hash the body) — so a key-only forgery is caught — but none authenticate the WRITER. A byte-writer who calls the exported `deriveEdgeId`/`sidecarSha` and writes a matching sidecar can co-forge a self-consistent confirmed-by edge that inflates the SHADOW confirmed/HARDEN weight. Tolerable today ONLY because the weight is advisory and never gates a merge (`weight-source-gate` keeps the live-allow-set empty in prod). The moment such a weight gates an action, an authenticated minter (the partly-built `edge-attestation` signed lane) becomes mandatory. No code defect — a substrate-level honest residual the report should carry forward. |
| INFO | function | optimization | `walker.js:155-158` (`walk`) | When `traversed.length >= maxEdges`, the code sets `truncated=true` for an unseen edge but does not add it to `traversedIds`, so the same over-cap edge id is re-evaluated (and re-flips `truncated`) on every subsequent incidence. Harmless (idempotent on a boolean) and bounded by the cap, but a micro-inefficiency on dense graphs. |

(Scope note: the bug/fallacy checklist classes 1-6 were checked and largely PASS in this cluster — exact-set equality is used correctly (`sameRequirement`, `weight-source-gate` exact membership); content-is-verified-on-read across all three stores; `Object.freeze([])` is correctly used over the fake-immutable frozen-Set; the canonical-json depth bound is inherited from the kernel `_lib`; secret/leak scrubbing is present on the egress (`buildFrictionLabelerInput` strips the oracle + paths, `lessonLeaks` guards the prose). The async paths (`captureLessons`, `runConfirmationPass`, `deriveLesson`) correctly `await` the injected leg and catch throws. The findings above are the residuals, smells, and optimizations that survived that audit.)
