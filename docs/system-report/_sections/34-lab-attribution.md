# Lab attribution: recall-graph + edge store + candidate-sidecar + spikes — `packages/lab/attribution/`

> This cluster is the **Evolution Lab's "experience layer" substrate** — the advisory/shadow track that turns the bootcamp's per-attempt grading output into a content-addressed *recall graph* of worked-example nodes, a `confirmed-by` edge ledger, and a candidate-patch sidecar. Per the layer convention (every file carries `// @loom-layer: lab`), **nothing here is enforced**: there is no kernel hook, no merge gate, no runtime orchestration. All trust signals are SHADOW/ADVISORY (OQ-NS-6: a backtest narrows, only a world-anchored merge hardens). The pure producer (`recall-graph.js`) and the two grep gates (`bootcamp-gates.js`) are CI-unit-tested; the three impure stores (`recall-graph-store.js`, `recall-edge-store.js`, `candidate-sidecar.js`) verify content on read/write and live under physically separate `$LOOM_LAB_STATE_DIR` dirs; the `_spike/` files are manual dogfoods / retrieval prototypes deliberately **out of CI** (impure, network/LLM-bound) but recursively covered by the EC7 Path-2-darkness gate. The cluster's load-bearing discipline is the #273 family: *the store is not a sandbox — verify CONTENT on read, integrity is not provenance.*

## Directory contents & nesting

| File | Folder | Purpose (one line) |
|---|---|---|
| `bootcamp-gates.js` | `attribution/` | Two PURE audit predicates + thin CLI: retrieval-not-weights *wording* audit and EC7 *Path-2-darkness* scan over the bootcamp tree. |
| `candidate-sidecar.js` | `attribution/` | Content-addressed patch-bytes store (one `<sha256>.patch` file per candidate); verify-on-read/write; first-wins dedup. |
| `recall-edge-store.js` | `attribution/` | Content-addressed `confirmed-by` edge ledger (the recall-graph's first edge); verify-on-read/write; optional ed25519 sig *shape* layer. |
| `recall-graph-store.js` | `attribution/` | Per-node-file backtest recall-graph store; OQ-7 provenance firewall; content-verify + deep-freeze on read; retirement lifecycle. |
| `recall-graph.js` | `attribution/` | PURE + DETERMINISTIC node populator: turns scorer output into worked-example nodes + friction-map + judge-agreement; the lesson layer. |
| `_spike/persona-read-wire.js` | `attribution/_spike/` | Read-only demo: `retrieve` over real persisted nodes + `personaView` + whitelist prompt-render (M1 no-persona-leak). |
| `_spike/recall-graph-dogfood.js` | `attribution/_spike/` | Manual LIVE dogfood of every W4 path on the real FS (populator + store + gates), 3 legs. |
| `_spike/recall-retrieval-test.js` | `attribution/_spike/` | #78 A/B: does a retrieved prior example help a blind `claude -p` actor solve a sibling issue? Real sandbox + LLM. |
| `_spike/retrieve-signature.js` | `attribution/_spike/` | PURE signature-match trigger retriever + the collision-gated discrimination measurement. |
| `_spike/retrieve.js` | `attribution/_spike/` | PURE minimal lexical retriever (repo hard-gate + Jaccard over slug tokens). |

Nesting: the top-level `attribution/` holds the four shipped substrate modules (one producer + three stores/gates). The single nested `_spike/` subfolder holds five files distinguished by **impurity and CI-exemption**: they call the FS / `child_process` / `claude` (the dogfood + A/B), or they are retrieval *prototypes* (`retrieve.js`, `retrieve-signature.js`, `persona-read-wire.js`) that the substrate does not yet wire into a live path. The two PURE spike retrievers (`retrieve.js`, `retrieve-signature.js`) and `persona-read-wire.js` DO have unit tests; the dogfood and A/B do not (they are run by hand). The EC7 gate scans `_spike/` recursively so a future Path-2 leak there is caught.

## Per-file analysis

### `bootcamp-gates.js`

- **Purpose** — the bootcamp's two closing CI gates (RFC §3.4 wording-audit + §7 EC7 Path-2-darkness). The pure predicates take text/sources and are unit-tested; the `require.main` CLI greps the live bootcamp tree and exits non-zero on a violation.
- **Imports / consumes** — node stdlib only: `fs`, `path`. Reads files under `packages/lab/attribution`, `packages/lab/issue-corpus`, `packages/lab/causal-edge` (relative to `repoRoot`, default `process.cwd()`). No env vars.
- **Consumers** — `_spike/recall-graph-dogfood.js` (LEG 3 imports `auditPath2Darkness`, `auditWording`, `bootcampSources`, `isWordingExempt`); `tests/unit/lab/attribution/bootcamp-gates.test.js`. Intended to be run as a CLI gate (the plan describes it as a "grep gate").

| name | kind | purpose | consumes | writes | state / side effects |
|---|---|---|---|---|---|
| `allowSpans` | internal | Compute `[start,end)` spans on a line covered by an allow-context regex (span-scoped, not line-scoped) | `line` string; module `ALLOWED_CONTEXTS` | — | none (pure); builds a fresh `RegExp` per context |
| `overlapsAny` | internal | Half-open overlap test of one span vs a span list | `start`, `end`, `spans` | — | none (pure) |
| `auditWording` | exported | Flag a learning-claim near a bootcamp metric (span-scoped allow-list) + a net-new W4 field asserted as pre-existing | `text`, `{proposedFields}`; module regexes | — | returns `violations[]`; mutates `LEARNING_CLAIM.lastIndex` (module-global regex state) |
| `stripComments` | exported | Blank line/block comments but preserve string literals + newlines, so the Path-2 regexes see only real code | `text` | — | none (pure char-walker) |
| `lineOf` | internal | 1-based line number of a char index | `text`, `idx` | — | none (pure) |
| `auditPath2Darkness` | exported | Flag Path-2 imports (`reputation`/`circuit-breaker`/`verdict-attestation` segments), dynamic requires, and Path-2 calls | `sources[]` (`{file,text}`); module regexes | — | returns `violations[]`; mutates module regex `lastIndex` |
| `listJs` | internal | Recursively list `.js` files under a dir; ENOENT→`[]`, any other read error THROWS (fail-closed) | `absDir`; `fs.readdirSync` | — | filesystem reads; recursion |
| `readSource` | internal | Read a file; ENOENT→`''`, other errors THROW (fail-closed) | `file`; `fs.readFileSync` | — | filesystem read |
| `bootcampSources` | exported | Build the fail-closed coverage set: attribution/ + issue-corpus/ wholesale + causal-edge minus a top-level allow-list | `{repoRoot}`; `listJs`/`readSource` | — | filesystem reads |
| `isWordingExempt` | exported | True for the gate's own source + any `_spike/` file (Path-2 audit still covers them) | `file` | — | none (pure) |
| `runCli` | exported / cli-entry | Run both gates over the live tree; print GREEN/FAIL; return exit code | `repoRoot`; `bootcampSources` | `process.stdout` (human report) | returns `0`/`1`; under `require.main` → `process.exit` |

- **File-level notes** — `auditWording`/`auditPath2Darkness` mutate the `lastIndex` of module-scoped `/g` regexes; the functions reset `lastIndex=0` before each use, so re-entrancy within a single thread is safe, but the regexes are shared module state (not thread-safe, irrelevant in node). `stripComments` is a hand-rolled state machine — documented as "good enough for our own first-party source," correctly not a full JS parser. The EC7 coverage discipline is well-built: recursion (catches `_spike/`), fail-closed on EACCES (catches an unreadable file masking a leak), whole-word segment match (`tiebreaker` never matches), and a dynamic-require flag for unanalyzable string-built module names.

### `candidate-sidecar.js`

- **Purpose** — v3.11 W1 patch-bytes sidecar. The recall-graph node keeps only a content-address (`candidate_patch_sha`); the actual patch bytes live here, one file per patch named by the FULL sha256, so the derivation leg can contrast the candidate against the accepted diff.
- **Imports / consumes** — `fs`, `os`, `path`, `crypto`; `../../kernel/_lib/atomic-write` (`writeAtomicString`). Env: `LOOM_LAB_STATE_DIR` (default `~/.claude/lab-state`). Default dir `<base>/candidate-sidecar`.
- **Consumers** — `causal-edge/lesson-confirm.js` (`sidecarSha`, `writeCandidate`), `causal-edge/lesson-consolidate.js` (`readCandidate`), `causal-edge/lesson-capture.js` (`writeCandidate`, `sidecarSha`), `causal-edge/_spike/dogfood-derive-sample.js` (`readCandidate`); plus several unit tests.

| name | kind | purpose | consumes | writes | state / side effects |
|---|---|---|---|---|---|
| `storeDir` | internal | Resolve `opts.dir` else `DEFAULT_DIR` | `opts` | — | none |
| `sidecarSha` | exported | The one content-address: sha256 of the patch string (`null`→`''`) | `patch` | — | none (pure) |
| `readCandidate` | exported | Read a patch by sha; reject if filename sha != re-hash of body (`#273`); HEX64 guard | `sha`, `opts`; reads `<dir>/<sha>.patch` | — | filesystem read; returns body or `null` |
| `writeCandidate` | exported | Write a patch (content-verify); first-wins dedup; REPAIR an unverifiable squat by overwriting | `patch`, `opts`; `fs.existsSync`, `readCandidate` | `<dir>/<sha>.patch` via `writeAtomicString`; `mkdirSync` | filesystem write/mkdir; returns `{ok,deduped \| repaired,sha}` |

- **File-level notes** — Clean, small, correct. `readCandidate` re-hashes the body and compares to the filename sha, so a hand-edited or truncated file fail-softs to `null`. `writeCandidate` is symmetric: on an existing-file hit it re-reads via `readCandidate` and only repairs if the prior is unverifiable garbage. **Integrity, not provenance** (consistent with the module header and `security.md`): any same-uid writer can co-forge a `<sha>.patch` whose body hashes to its name — the sidecar proves the bytes match the address, never that the legitimate producer wrote them. That is acceptable here because the sidecar is contrast-fuel, not a trust input. Minor: `writeCandidate` calls `fs.mkdirSync(dir, {recursive:true})` immediately before `writeAtomicString`, which itself does `mkdirSync(path.dirname(target), {recursive:true})` — the explicit mkdir is redundant (see Findings). No `0700` mode on the dir (the carry noted in the W3 plan applies to its sibling stores too).

### `recall-edge-store.js`

- **Purpose** — v3.11 W2 `confirmed-by` edge ledger: `(failure-context, lesson) --confirmed-by--> (delta-ref)`. The presence of an edge moves a lesson from the HAZARD lane to the PREDICTOR lane (the lane predicate lives in `lesson-confirm.js`; this is just the persisted, content-addressed edge). v-next Carry C-W1 adds an ed25519 *signature-shape* layer (well-formedness only; crypto provenance is the authenticated lane's job).
- **Imports / consumes** — `fs`, `os`, `path`, `crypto`; `kernel/_lib/atomic-write` (`writeAtomicString`), `kernel/_lib/deep-freeze` (`deepFreeze`), `kernel/_lib/canonical-json` (`canonicalJsonSerialize`), `kernel/_lib/edge-attestation` (`isCanonicalBase64`, `SIG_ALG`). Env: `LOOM_LAB_STATE_DIR`. Default dir `<base>/recall-edge`.
- **Consumers** — `causal-edge/lesson-confirm.js` (`writeEdge`, `loadEdge`, `deriveEdgeId`), `causal-edge/lesson-consolidate.js` (`listEdges`), `persona-experiment/grounding-slice.js` (the whole module), `persona-experiment/_spike/dogfood-run.js` + `dogfood-arms.js`; plus many unit tests across `lab/attribution`, `lab/causal-edge`, `lab/persona-experiment`.

| name | kind | purpose | consumes | writes | state / side effects |
|---|---|---|---|---|---|
| `storeDir` | internal | Resolve dir | `opts` | — | none |
| `sha256hex` | internal | sha256 hex of a string | `s` | — | none (pure) |
| `isHex64` | internal | STRICT `typeof===string` then HEX64 regex (no `String()` coercion — `#273`) | `v` | — | none (pure) |
| `isValidFtp` | internal | Non-empty array of non-empty strings | `v` | — | none (pure) |
| `normFtp` | internal | Canonical requirement form: `map(String)` then `sort()` (order/type-stable) | `v` | — | none (pure); copies via `.slice()` |
| `deriveEdgeId` | exported | edge_id over the identity basis `[from,to,type,normFtp(ftp)]` (recorded_at NOT in basis) | `rec`; `canonicalJsonSerialize` | — | none (pure) |
| `verifyEdge` | internal | Re-derive id + re-apply strict shape guards on read; reject coerced/forged/empty-ftp/bad-ts; optional sig-shape check | `rec`, `expectedId`; `SIG_ALG`, `isCanonicalBase64` | — | none (pure); returns rec or `null` |
| `normalize` | internal | Normalize to stored shape (derived id, sorted ftp, carry sig fields if present) | `rec` | — | none; builds a fresh object |
| `writeEdge` | exported | Reject malformed; optional inject signer; verify-on-write; first-wins dedup; atomic-write | `rec`, `opts` (incl. `signer`); `fs.existsSync`, `loadEdge` | `<dir>/<edge_id>.json` via `writeAtomicString`; `mkdirSync` | filesystem write/mkdir; may call `opts.signer`; returns `{ok,...}` |
| `loadEdge` | exported | Verify-on-read + deep-freeze; tampered/foreign → `null` | `edgeId`, `opts`; reads `<dir>/<edge_id>.json` | — | filesystem read; returns frozen rec or `null` |
| `listEdges` | exported | Load + verify every `.json` in dir; skip nulls | `opts`; `fs.readdirSync`, `loadEdge` | — | filesystem reads |
| `retireEdges` | exported | Prune OUR OWN valid edges (all, or older than ISO `before`); keep foreign/tampered; bad `before`→retire none | `{dir,before}`; `fs.readdirSync`, `loadEdge` | `fs.rmSync` deletes files | filesystem deletes; returns `{retired,kept}` |

- **File-level notes** — Strongly hardened against the `#273` family: `isHex64` is type-strict (a `[hex]` array or number cannot self-consistently address an edge), `verifyEdge` re-derives the id and rejects a filename↔field mismatch AND a body-hashes-to-id mismatch, and `EDGE_TYPE` is an append-only frozen set in the basis. `loadEdge` deep-freezes (read-back immutability — the nested-array leak that bit the Lab store twice). The signature layer is deliberately *shape-only* (alg pin + canonical base64): the store stays key-free so an integrity-valid edge is never dropped on a key rotation, and crypto provenance is the authenticated lane's job. **Honest residual (documented in the header + MEMORY):** an unsigned or shape-valid-but-lying edge still inflates the integrity-only `confirmedNodeIds` count — a same-uid co-forge survives until the authenticated lane gates a live weight (it gates nothing today). `mkdirSync` lacks a `0700` mode.

### `recall-graph-store.js`

- **Purpose** — v3.9 W4 per-node-file backtest recall-graph store. Content-addressed (one `<node_id>.json`), under a physically separate `recall-graph-backtest/` dir. The OQ-7 firewall: rejects any node whose `provenance !== 'backtest'`, so a future live retriever can never reach a path here.
- **Imports / consumes** — `fs`, `os`, `path`; `kernel/_lib/atomic-write`, `kernel/_lib/deep-freeze`; `./recall-graph` (`deriveNodeId`, `computeContentHash`, `PROVENANCE`, `classifyLessonLayer`). Env: `LOOM_LAB_STATE_DIR`. Default dir `<base>/recall-graph-backtest`.
- **Consumers** — `causal-edge/calibration-issue-run.js` (`writeNode`), `causal-edge/lesson-capture.js` (`writeNode`), `causal-edge/lesson-consolidate.js` (`listNodes`); `_spike/persona-read-wire.js`, `_spike/recall-graph-dogfood.js`; `issue-corpus/_spike/*`, `persona-consumer/_spike/*`, `persona-experiment/_spike/*` + `grounding-slice.js`; plus unit tests. `authorship-store.js` mirrors it (documented, not a call).

| name | kind | purpose | consumes | writes | state / side effects |
|---|---|---|---|---|---|
| `storeDir` | internal | Resolve dir | `opts` | — | none |
| `personaTagsDiffer` | internal | Field-by-field `built_by` diff (order-independent); `null`→absent | `a`, `b` | — | none (pure) |
| `verifyNode` | internal | Reject non-backtest, bad/forged id, basis mismatch, content-hash mismatch, invalid lesson layer | `node`, `expectedId`; `deriveNodeId`, `computeContentHash`, `classifyLessonLayer`, `PROVENANCE` | — | none (pure); returns node or `null` |
| `writeNode` | exported | Reject non-backtest/self-inconsistent; stamp `recorded_at`; content-aware first-wins dedup w/ persona-collision signal; repair garbage | `node`, `opts` (`dir`,`now`); `fs.existsSync`, `loadNode` | `<dir>/<node_id>.json` via `writeAtomicString`; `mkdirSync` | filesystem write/mkdir; returns `{ok,deduped \| repaired \| persona_collision,...}` |
| `retireBacktestNodes` | exported | Prune OUR OWN verified backtest nodes (all, or older than ISO `before`); keep foreign/undatable | `{dir,before}`; `fs.readdirSync`, `loadNode` | `fs.rmSync` deletes files | filesystem deletes; returns `{retired,kept}` |
| `loadNode` | exported | Verify-on-read + deep-freeze; tampered/foreign → `null` | `node_id`, `opts`; reads `<dir>/<node_id>.json` | — | filesystem read; returns frozen node or `null` |
| `listNodes` | exported | Load + verify every `.json`; skip nulls | `opts`; `fs.readdirSync`, `loadNode` | — | filesystem reads |

- **File-level notes** — The OQ-7 firewall is enforced at both read (`verifyNode`) and write (`writeNode` early `provenance-rejected`). Content-verify-on-read + verify-on-write + deep-freeze are all present; the persona-collision branch returns a signal rather than silently dropping (the documented "never a silent erasure"). `recorded_at` is correctly outside the content-hashed body and the node_id basis. One asymmetry worth noting (see Findings): `writeNode` re-runs full `verifyNode` (including the `classifyLessonLayer` re-hash of the lesson block) on the incoming node, while `writeNode`'s dedup-hit path returns `ok:true` based on `personaTagsDiffer` of the PRIOR node's `built_by` — fine, but the persona collision is *return-only* (no merge), as the plan calls out.

### `recall-graph.js`

- **Purpose** — v3.9 W4 PURE + DETERMINISTIC populator. Turns the W2 scorer's per-attempt output into recall-graph nodes (the retrieval artifact), plus the cross-issue friction-map aggregate and the judge's own precision/recall agreement. Never calls the LLM, sandbox, or FS. Also owns the v3.11 W1 lesson layer (tamper-evident, presence-conditional) and v3.10-W0' persona-provenance tagging.
- **Imports / consumes** — `crypto`; `kernel/_lib/canonical-json`; `../issue-corpus/corpus` (`ENUMS`, `N_CLEAN_LARGE_MIN`); `../causal-edge/calibration-issue` (`WORKED_EXAMPLE_FIELDS`); `../causal-edge/trajectory-friction` (`frictionClusterKey`, `clusterFriction`, `validateResolutionFriction`); `../causal-edge/lesson-signature` (`lessonClusterKey`, `TRIGGER_CLASS`, `GOTCHA_CLASS`, `CORRECTIVE_CLASS`, `LESSON_BODY_MAX`). No fs, no child_process.
- **Consumers** — `recall-graph-store.js` (`deriveNodeId`, `computeContentHash`, `PROVENANCE`, `classifyLessonLayer`); `causal-edge/calibration-issue-run.js` (`aggregateFrictionMap`, `computeJudgeAgreement`, `populateRecallGraph`); `causal-edge/lesson-capture.js` (`buildWorkedExampleNode`, `isEligibleForPopulation`, `LESSON_ERR_CODE`); `causal-edge/lesson-consolidate.js` + `lesson-confirm.js` (`classifyLessonLayer`); `_spike/retrieve-signature.js` (`classifyLessonLayer`); `issue-corpus/_spike/*`; unit tests.

| name | kind | purpose | consumes | writes | state / side effects |
|---|---|---|---|---|---|
| `isRosterStr` | internal | `typeof===string` + roster-token regex (guards `String(true)` coercion) | `v` | — | none (pure) |
| `personaError` | internal | Build an `Error` tagged with `PERSONA_ERR_CODE` | `msg` | — | none (pure) |
| `validatePersonaTag` | exported | absent→`UNATTRIBUTED`; malformed→THROW (coded); else frozen `{role,roster_name,actor_kind}` | `tag`, `label` | — | none (pure); throws coded error |
| `validateGraderTag` | internal | Single judge identity `{role,roster_name}` or `null`; malformed→THROW | `g`, `label` | — | none (pure); throws coded error |
| `validateGraders` | exported | absent→`UNATTRIBUTED_GRADERS`; else `{leg_b,leg_c}` of validated graders | `graded`, `label` | — | none (pure); throws coded error |
| `sha256hex` | internal | sha256 hex | `s` | — | none (pure) |
| `deriveNodeId` | exported | node_id over `[issue_id,candidate_patch_ref,repo,provenance]` (provenance IN basis) | `workedExampleRef`, `provenance`; `canonicalJsonSerialize` | — | none (pure) |
| `computeContentHash` | exported | sha256 of `canonicalJsonSerialize(body)` | `body` | — | none (pure) |
| `pickWorkedExample` | internal | Pick ONLY `WORKED_EXAMPLE_FIELDS` (so an extra/leaked `accepted_diff` can't ride in) | `reference`; `WORKED_EXAMPLE_FIELDS` | — | none (pure) |
| `tierOf` | internal | Contamination tier string or `'unknown'` | `reference` | — | none (pure) |
| `isEligibleForPopulation` | exported | `recall_eligible && reference && clean-tier` | `attempt`; `CLEAN_FOR_RETRIEVAL` | — | none (pure) |
| `lessonError` | internal | `Error` tagged `LESSON_ERR_CODE` | `msg` | — | none (pure) |
| `computeLessonContentHash` | exported | sha256 of the canonicalized `LESSON_HASH_FIELDS` body | `node`; `LESSON_HASH_FIELDS` | — | none (pure) |
| `lessonFieldsPresent` | internal | True if any lesson field is non-null | `node` | — | none (pure) |
| `classifyLessonLayer` | exported | `'absent' | 'valid' | 'invalid'`; presence-conditional; bounds body length; re-derives sig + hash | `node`; enums, `LESSON_BODY_MAX`, `lessonClusterKey` \| — \| none (pure) |
| `normalizeFailToPass` | internal | Frozen `map(String)` array or `null` | `v` | — | none (pure) |
| `attachLesson` | exported | MUTATE node to attach a validated lesson layer; off-floor enum THROWS | `node`, `lesson`, refs; enums, `lessonClusterKey`, `computeLessonContentHash` | — | **mutates `node` in place** (sets `trigger_class`…`lesson_content_hash`) |
| `buildWorkedExampleNode` | exported | Build + freeze a node from one attempt (+ optional lesson) | `attempt`, opts; `pickWorkedExample`, `deriveNodeId`, `computeContentHash`, `validateResolutionFriction`, `validatePersonaTag`, `validateGraders`, `attachLesson` | — | none externally; freezes the returned node; may throw coded errors |
| `populateRecallGraph` | exported | Filter eligible+clean attempts → nodes; count eligible/contaminated/malformed-persona drops | `attempts`, opts; `buildWorkedExampleNode`, `tierOf`, `CLEAN_FOR_RETRIEVAL` | — | none (pure); drops only PERSONA_ERR_CODE attempts, re-throws others |
| `aggregateFrictionMap` | exported | Harvest non-null friction blocks paired with `{id,attempt_index}`, cluster, re-map indices→refs | `attempts`; `validateResolutionFriction`, `clusterFriction` | — | none (pure) |
| `computeJudgeAgreement` | exported | precision/recall of leg-A `issue_tests` vs leg-B `supported`, over model-decided attempts; INSUFFICIENT-N below floor | `attempts`, `{minN}` | — | none (pure) |

- **File-level notes** — `buildWorkedExampleNode` calls `attachLesson`, which MUTATES the node before the final `Object.freeze` — the mutation is on a *locally-constructed* object (not an input), so it does not violate the immutability rule, but `attachLesson` is documented as "called pre-freeze by the builder" and mutates its argument, so any future caller must respect that ordering. The honesty invariants are well-enforced: no `learned_*`/weight field, `worked_example_ref` whitelisted via `WORKED_EXAMPLE_FIELDS`, fail-closed contamination (`unknown` is NOT clean), and the persona tags are explicitly UNAUTHENTICATED metadata outside both hashes. `classifyLessonLayer` bounds the body length BEFORE re-hashing (read-path DoS defense) and re-derives the closed-enum signature (a forged sig can't outlive its body). `populateRecallGraph` correctly distinguishes a persona-malformed drop (coded, dropped per-attempt) from a structural throw (e.g. the canonical-depth guard) that must surface.

### `_spike/persona-read-wire.js`

- **Purpose** — v3.10-W0' prototype-1: the first read over REAL persisted recall nodes, exposing the persona axis (empty on the 11 pre-axis nodes). Read-only demo; nothing hardens trust.
- **Imports / consumes** — `../recall-graph-store` (`listNodes`), `./retrieve` (`retrieve`). Reads the real backtest store dir (env-derived). No writes.
- **Consumers** — `tests/unit/lab/attribution/persona-read-wire.test.js` (`renderNodeForPrompt`, `personaView`, `classifyRetrieval`).

| name | kind | purpose | consumes | writes | state / side effects |
|---|---|---|---|---|---|
| `renderNodeForPrompt` | exported | M1 whitelist render: only `repo`/`issue_id` reach a prompt (no `built_by`/`graded_by` leak) | `node` | — | none (pure) |
| `personaView` | exported | Count nodes per `role.roster_name` author (null-proto map) | `nodes` | — | none (pure) |
| `classifyRetrieval` | exported | Label a ranked result (degenerate / repo-gate-null / strong / weak) | `ranked`, `hasDelim` | — | none (pure) |
| (CLI `require.main`) | cli-entry | Print personaView + retrieval table + M1 render against the real store | `listNodes`, `retrieve` | `process.stdout` | reads real store; `process.exit(0)` |

- **File-level notes** — The whitelist render (M1) is a real safety property: it is constructed from an explicit field list rather than `JSON.stringify(node)`, so persona metadata can never leak into a future prompt. `personaView` uses `Object.create(null)` (null-proto) defensively. The CLI is a manual demo; the exported functions are pure and tested.

### `_spike/recall-graph-dogfood.js`

- **Purpose** — v3.9 W4 LIVE dogfood: drive every new W4 path on the real FS + real modules (the standing lesson that a green unit suite proves nothing about the real path it mocks). 3 legs: populator+store on a real temp dir; the real `runIssueCalibration` §6 wiring with LLM legs disabled; the gate CLIs over the live bootcamp tree.
- **Imports / consumes** — `fs`, `os`, `path`, `assert`; `../recall-graph`, `../recall-graph-store`, `../bootcamp-gates`, `../../causal-edge/trajectory-friction`, `../../causal-edge/calibration-issue-run`. Reads `packages/lab/issue-corpus/seed-manifest.json`.
- **Consumers** — none (a manual spike; not imported, not in the unit glob).

| name | kind | purpose | consumes | writes | state / side effects |
|---|---|---|---|---|---|
| `attemptFor` | internal | Build a scoreAttempt-shaped result grounded in a real seed record | `rec`, opts | — | none (pure) |
| `main` (IIFE) | script-entry | Run the 3 legs with assertions | the imports + seed manifest | temp dirs via `mkdtempSync`; node files via `writeNode`; `process.stdout` | creates/removes temp dirs; tampers a file to test verify-on-read; `process.exit(1)` on failure |

- **File-level notes** — Correctly exercises the real paths: EC6 gate-drop delta, OQ-7 provenance reject, content-verify-on-read (it hand-edits a written file and asserts `loadNode` → `null`), and deep read-back immutability (asserts a nested-field mutation throws). LEG 2 asserts the LLM-disabled run produces an HONEST empty diagnostic (0 nodes, `error_bar: 'UNKNOWN-until-measured'`). Temp dirs are cleaned with `fs.rmSync(..., {force:true})`. LEG 2/3 run inside a `.then()` chain; the LEG-1 temp dir is removed synchronously before the async chain, so a LEG-1 assertion failure (which throws synchronously inside the IIFE) is NOT caught by the `.catch` on the promise (see Findings — minor, spike-only).

### `_spike/recall-retrieval-test.js`

- **Purpose** — the #78 A/B existence-proof: does retrieving a prior worked example help a blind `claude -p` actor solve a SIMILAR (not identical) issue? Source = more-itertools `__reversed__` empty bug; target = the `[::-1]` negative-step bug. Interleaved control/treatment, fresh actor clone each, behavioral grade in the W1 sandbox, leak-guarded treatment block, Wilson intervals.
- **Imports / consumes** — `fs`, `os`, `path`, `child_process` (`execFileSync`); `../../issue-corpus/sandbox-exec-backend`, `../../issue-corpus/pytest-runner`, `../../causal-edge/calibration-issue-run` (`makeBehavioralFn`, `resolveClaude`), `../../causal-edge/trajectory-friction-run` (`runActorTrajectory`, `buildActorPrompt`), `../../causal-edge/calibration-issue` (`rubricLeaks`), `./retrieve`. Reads `retrieval-target/test_patch.patch` + `accepted_diff.patch`. Clones git repos. Invokes `claude`.
- **Consumers** — none (a manual spike; not imported).

| name | kind | purpose | consumes | writes | state / side effects |
|---|---|---|---|---|---|
| `git` | internal | Run a git subcommand via `execFileSync` (180s timeout) | `args`, `cwd` | — | spawns `git`; network/FS |
| `cleanupCache` | internal | Best-effort `rmSync` of the module-scoped cache temp dir | module `cache` | — | removes a temp dir |
| `mkNode` | internal | Build a synthetic source/distractor node (`worked_example_ref` + `_title`) | `repo`, `title`, `extra` | — | none (pure) |
| `wilson` | internal | Wilson score interval for a binomial pass-rate | `passes`, `n`, `z` | — | none (pure) |
| `main` (async IIFE) | script-entry | Mirror-clone, retrieve, leak-guard, run K interleaved A/B samples, report | the imports + fixture patches | temp dirs (cache + per-actor); `process.stdout` | clones repos, spawns `claude` + git + pytest sandbox, removes temp dirs, `process.exit` |

- **File-level notes** — Carefully built for the failure modes the repo cares about: `cache` is module-scoped so both in-run aborts and the outer `.catch` clean it (the CodeRabbit leak finding); per-actor dirs are cleaned in a `finally`; the A/B is single-blind by construction (one prompt builder, asserted F4); the treatment block is leak-guarded against the accepted diff (F6); the grade requires `outcome_source === 'model'` (no harness fallback counts as a pass). Honest framing: an existence-proof at n=1, never "retrieval helps." It IS a mock-vs-real *real* path (so the Rule-2a-corollary is satisfied for the mechanism). The `_title` field on synthetic nodes is a spike-only augmentation not on the real node schema (documented).

### `_spike/retrieve-signature.js`

- **Purpose** — v3.11 W3 signature-match trigger retriever + the collision-gated discrimination measurement. The query key is the SITUATION (`trigger_class`), not the trap; ranks by trigger match, tie-broken by the confirmed trust-weight then node_id. PURE, CI-safe, deliberately OUT of the live K4 recall-CLI path.
- **Imports / consumes** — `../recall-graph` (`classifyLessonLayer`), `./retrieve` (`retrieve` as `lexicalRetrieve`, `normRepo`), `../../issue-corpus/corpus` (`N_CLEAN_LARGE_MIN`). No FS.
- **Consumers** — `issue-corpus/_spike/corpus-build/bootcamp-measure.js` (`retrieveBySignature`, `collisionSignatures`, `measureDiscrimination`); unit tests `retrieve-signature.test.js`, `weight-source-gate.test.js`, `w3d-lite-composition.test.js`.

| name | kind | purpose | consumes | writes | state / side effects |
|---|---|---|---|---|---|
| `onlyValid` | internal | Filter to `classifyLessonLayer === 'valid'` nodes (the H1 read-path filter) | `nodes`; `classifyLessonLayer` | — | none (pure) |
| `nullProtoWeights` | internal | Rebuild caller weights as a null-proto map of finite numbers (prototype-pollution guard) | `weights` | — | none (pure) |
| `retrieveBySignature` | exported | Rank valid nodes by trigger match (+ soft repo boost), tie-break weight then node_id | `query`, `nodes`, `{weights}`; `normRepo`, `onlyValid`, `nullProtoWeights` | — | none (pure) |
| `collisionSignatures` | exported | The signatures shared by ≥2 DISTINCT issues among valid lessons | `nodes`; `onlyValid` | — | none (pure); null-proto map |
| `measureDiscrimination` | exported | Collision-gated signature-hit-rate@1 vs lexical floor; INSUFFICIENT-N unless N≥floor AND collisions present AND queries present | `labeledQueries`, `nodes`, `{minN}`; `retrieveBySignature`, `lexicalRetrieve`, `collisionSignatures`, `N_CLEAN_LARGE_MIN` | — | none (pure) |

- **File-level notes** — Well-defended: only `valid` lesson nodes are ranked (a forged/off-floor/hash-lying node is EXCLUDED, not merely ranked low), the weights map is null-proto (no prototype pollution from a node-derived key), and the data-gate fires FIRST so a positive-but-below-floor raw margin still returns INSUFFICIENT-N (the leak-the-beat guard). The `opts.minN` injectability is a documented driver-discipline note, not a live hole (no untrusted caller). Sort comparator is total (score, then weight, then node_id lexical) — deterministic.

### `_spike/retrieve.js`

- **Purpose** — v3.9.x #78 minimal lexical retriever. PURE. Repo hard-gate + Jaccard over slug tokens (query title vs node `issue_id` title-slug). Lexical, not semantic (YAGNI) — it MEASURES whether lexical retrieval discriminates, not builds an embedding retriever.
- **Imports / consumes** — none (pure; node stdlib only via `String`/`Set`/regex).
- **Consumers** — `_spike/recall-retrieval-test.js` (`retrieve`, `slugifyTitle`), `_spike/persona-read-wire.js` (`retrieve`), `_spike/retrieve-signature.js` (`retrieve`, `normRepo`), `issue-corpus/_spike/corpus-build/bootcamp-measure.js` (`retrieve`, `issueTitleSlug`); unit tests.

| name | kind | purpose | consumes | writes | state / side effects |
|---|---|---|---|---|---|
| `stem` | internal | Light singularization (`>4` chars ending in `s`) | `t` | — | none (pure) |
| `slugTokens` | exported | Tokenize free text → topic-token Set (lowercase, split, drop short+stopwords, stem) | `text`; `STOPWORDS` | — | none (pure) |
| `slugifyTitle` | exported | Deterministic dash-slug of a title (joins `slugTokens`) | `title` | — | none (pure) |
| `jaccard` | exported | Jaccard of two token Sets (empty/empty → 0) | `a`, `b` | — | none (pure) |
| `normRepo` | exported | Normalize a repo string (strip github URL / `.git` / trailing slash) | `r` | — | none (pure) |
| `issueTitleSlug` | exported | Title-slug portion of an `issue_id` (`<repo>__<slug>`) or the whole id | `issueId` | — | none (pure) |
| `scoreNode` | exported | Score one node: repo hard-gate (else 0) then Jaccard | `query`, `node`; `normRepo`, `slugTokens`, `issueTitleSlug`, `jaccard` | — | none (pure) |
| `retrieve` | exported | Rank all nodes; return full ranked vector + top scoring (>0) node or `null` | `query`, `nodes`; `scoreNode` | — | none (pure) |

- **File-level notes** — Clean, pure, deterministic, well-tested. `normRepo` has a small redundancy: it calls `.replace(/\/+$/, '')` twice (before and after the `.git` strip) — the first is dead unless a repo ends in `/.git/`, which the second strip already handles after `.git` removal; harmless but a smell (see Findings). The `retrieve` sort is not stable across equal scores (no secondary key), so the *top* element among equal-scoring same-repo nodes is engine-dependent — fine for the discrimination measurement, but `retrieve-signature.js` deliberately adds a node_id tie-break for exactly this reason, so `retrieve.js` itself is non-deterministic on ties.

## Findings (bugs / logical fallacies / optimizations)

| severity | level | type | location | description |
|---|---|---|---|---|
| LOW | function | optimization | `retrieve.js:88-92` (`retrieve`) | The sort `(a,b)=>b.score-a.score` has no secondary tie-break key, so `top` among equal-scoring same-repo nodes is **non-deterministic** (V8 sort is not order-stable for >10 elements pre-ES2019 guarantees notwithstanding the comparator returning 0). `retrieve-signature.js:65-66` adds a `node_id` tie-break precisely to avoid this; `retrieve.js` should too for reproducible discrimination measurements. |
| LOW | function | smell | `retrieve.js:54-61` (`normRepo`) | `.replace(/\/+$/, '')` is applied twice (lines 56 and 60). The first occurrence is effectively dead for normal inputs (the trailing-slash strip after `.git` removal covers the real case); DRY/KISS smell — one trailing-slash strip after the `.git` strip suffices. |
| LOW | function | optimization | `candidate-sidecar.js:62`, `recall-edge-store.js:175`, `recall-graph-store.js:111` (`mkdirSync` before `writeAtomicString`) | Each `writeXxx` calls `fs.mkdirSync(dir,{recursive:true})` immediately before `writeAtomicString`, which itself does `mkdirSync(path.dirname(target),{recursive:true})` (`atomic-write.js:172`). The explicit mkdir is redundant — one of the two should be dropped (KISS/DRY). |
| LOW | substrate | smell | `candidate-sidecar.js:62`, `recall-edge-store.js:175`, `recall-graph-store.js:111` (dir creation) | `mkdirSync` is called WITHOUT a restrictive `mode`, so the lab-state store dirs are created at the process umask default (typically `0755`), not `0700`. A same-uid (or, on a permissive umask, foreign) writer can plant files. This is the documented carry in `2026-06-17-w3-3arm-persona-experiment-harness.md:208` ("lab-state store dirs at 0700"); low-severity today because everything is SHADOW and gates nothing, but it is the integrity-vs-provenance attack surface in the open-writable-store class. |
| LOW | function | smell | `recall-graph.js:194-220` (`attachLesson`) | `attachLesson` MUTATES its `node` argument in place (sets `trigger_class`…`lesson_content_hash`). It is documented as "called pre-freeze by the builder" and the only caller (`buildWorkedExampleNode`) passes a locally-constructed object, so no input is mutated in practice — but the function violates the repo's stated immutability preference and is exported, so a future external caller could mutate a shared object. A return-new-object form would be safer. |
| LOW | file | smell | `recall-graph-dogfood.js:53-146` | LEG 1 runs synchronously inside the IIFE; LEG 2/3 run inside the `.then()` chain whose `.catch` (line 145) only catches async-leg failures. A LEG-1 `assert` failure throws synchronously and is NOT routed through the `.catch`/cleanup — node prints an uncaught exception and the LEG-1 temp dir (already removed at line 111 before the chain) is fine, but the pattern is inconsistent. Spike-only (manual run), so impact is cosmetic. |
| INFO | function | smell | `recall-graph.js:276-296` (`aggregateFrictionMap`) | Reads `a.id` and `a.attempt_index` from each attempt, whereas the rest of the populator keys off `attempt.reference` / `attempt.recall_eligible`. The two shapes (`a.id` vs `rec.id`) are consistent with the dogfood's `attemptFor` (which sets `id`), but there is no validation that `a.id`/`a.attempt_index` are present — a missing field yields `member_refs` entries of `{id:undefined,...}`. Report-only output, so low impact, but a boundary-validation gap. |
| INFO | function | logical-fallacy | `recall-graph.js:68` (`isRosterStr`) vs `validateGraderTag` allowing `roster_name` non-null only | `validatePersonaTag` requires `roster_name` to be a roster string (`isRosterStr`), but `UNATTRIBUTED` (line 62) sets `roster_name: null`. An explicitly-passed `built_by` with `roster_name:null` therefore THROWS (malformed), while an absent tag becomes the `null`-roster `UNATTRIBUTED`. This is intentional (absent vs malformed), but the asymmetry (the system's own UNATTRIBUTED sentinel would fail its own validator) is a subtle invariant worth a comment; not a bug since the sentinel is never re-validated. |
| INFO | component | logical-fallacy | `recall-edge-store.js:117-121` + header (signature provenance) | The header and comments are accurate and self-aware, but the load-bearing truth bears restating as a finding: `verifyEdge` proves INTEGRITY + signature *well-formedness*, NOT provenance. A shape-valid-but-cryptographically-lying signature is accepted as an unauthenticated edge and still counts toward the integrity-only `confirmedNodeIds`. Because no live weight is gated by this count today (SHADOW), it narrows-not-hardens (OQ-NS-6) — the documented residual. The moment a live weight reads "this edge exists and verifies," an authenticated minter becomes mandatory (per `security.md` integrity≠provenance). |
| INFO | function | optimization | `bootcamp-gates.js:63-89` (`auditWording`) | `hasMetric = METRIC_TOKEN.test(String(text\|\|''))` is computed once per file but `METRIC_TOKEN` is a non-global regex, so `.test` has no `lastIndex` side effect — correct. However the per-line `METRIC_TOKEN.test(line)` on line 79 re-scans; since `hasMetric` is already file-scoped-lenient, the `\|\|METRIC_TOKEN.test(line)` branch is only reachable when `hasMetric` is false, i.e. when no metric token exists anywhere in the file — making the per-line test provably always-false. The `\|\|METRIC_TOKEN.test(line)` is effectively dead. (Documented as "the per-line check tightens it," but with file-scoped `hasMetric` already true whenever any line matches, the tightening never fires.) |
| INFO | substrate | smell | cluster-wide (`_spike/` not in CI) | The two impure dogfoods (`recall-graph-dogfood.js`, `recall-retrieval-test.js`) are NOT in the unit glob and are run by hand. This is by design (network/LLM/sandbox-bound), and the Rule-2a-corollary is satisfied because the A/B IS a real-path run — but there is no automated regression guard that the dogfound paths still pass, so a refactor of the real modules could silently break the dogfood until someone re-runs it. The EC7 gate covers them for Path-2-darkness only, not behavior. |
