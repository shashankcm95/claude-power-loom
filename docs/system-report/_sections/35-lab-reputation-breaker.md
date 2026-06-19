# Lab reputation + circuit-breaker — `packages/lab/{reputation,circuit-breaker}`

> This cluster is the **advisory/shadow** trust-signal layer of the Evolution Lab (`@loom-layer: lab`, RFC §2 Layer 3). It turns the kernel-attested verdict-emission ledger (`verdict-attestation/store.js`) into two derived signals that NARROW (never widen) a spawn decision: (1) E4 **reputation** — a per-subject-persona advisory-verdict DISTRIBUTION (`project.js`), materialized off-hot-path into a content-addressed snapshot (`materialize.js`) that the kernel's spawn-record hook reads O(1) as a data file via the A6 contract, and consumed internally by the `reputation-gate.js` narrowing recommender; (2) E11 **circuit-breaker** — a stateless sliding-window denial-rate breaker (`circuit-breaker/project.js`) over a pluggable denial source (default `verdict-fail`). Nothing here is enforced: `projectReputation` self-labels "NOT a quality score", the breaker "halts nothing", and the only production runtime consumer is `manage-proposal/promote.js` (which reads the breaker to bound the destructive-mint rate). Everything else (the gate, the diagnostic) is shadow/internal-loop-closing code awaiting a future enforcement wave. The cluster's safety argument rests entirely on the §0a.3.1 monotonic-narrowing invariant — a forged/injected signal can only OVER-halt (advisory; the orchestrator overrides), never grant.

## Directory contents & nesting

| Path | Folder | Purpose (one line) |
|---|---|---|
| `reputation/project.js` | `reputation/` | PURE projection: verdict-attestation ledger → per-persona advisory-verdict distribution (INV-W1 enriched-only). |
| `reputation/materialize.js` | `reputation/` | Off-hot-path A6 materializer: projection → content-hashed snapshot → atomic-rename write + witness append. |
| `reputation/cli.js` | `reputation/` | CLI: `show` / `materialize` / `snapshot` / `verify-snapshot` — the operator + A6-advise read surfaces. |
| `reputation/reputation-gate.js` | `reputation/` | PURE narrowing recommender: candidates + reputation + breaker → `proceed` \| `down-weight` \| `reroute`. |
| `reputation/_spike/reputation-gate-diagnostic.js` | `reputation/_spike/` | Out-of-CI diagnostic: runs the gate over the user's REAL lab-state to answer "does the loop discriminate?" |
| `circuit-breaker/project.js` | `circuit-breaker/` | PURE denial-rate breaker projection + `evaluate` decision over a pluggable, windowed, latched denial source. |
| `circuit-breaker/cli.js` | `circuit-breaker/` | CLI: `show` / `check` — the per-persona + global breaker view and the consumer HALT decision. |

Nested subfolders:

- `reputation/_spike/` — the `_spike` convention marks throwaway/diagnostic code that is deliberately OUT of CI (it reads the user's real `~/.claude/lab-state`, which is environment-dependent and non-deterministic). It is the Rule-2a "re-probe the BUILT code against the REAL data" surface, distinct from the deterministic, fixture-injected unit suites under `tests/unit/lab/`.
- `circuit-breaker/` has no `_lib`/`_spike` — its header explicitly resists the extract-to-leaf pull (KISS/YAGNI: no cross-layer consumer exists for its window math).

## Per-file analysis

### `reputation/project.js`

- **Purpose** — The E4 reputation derived-view: a Lab-layer PURE deterministic projection over the evidence-linked verdict-attestation store, producing a per-`subject.persona` advisory-verdict DISTRIBUTION (counts stratified by `verifier.kind`), never a scalar score. Display-only; honors the §0a.3.1 anti-amplification clause structurally (INV-W1: projects only enriched records whose `evidence_refs.transaction_id` is non-null).
- **Imports / consumes** — `require('../verdict-attestation/store')` (for `listVerdicts`, `VALID_VERDICTS`); `require('../../kernel/_lib/recency-decay')` (`computeRecencyDecayAt`, a pure leaf). Reads the verdict ledger only through `verdictStore.listVerdicts({ now })` (one read). No env vars read directly (the ledger path is owned by the store). No fs.
- **Consumers** — `reputation/materialize.js` (`projectReputation`), `reputation/cli.js` (`show`), `reputation/reputation-gate.js` (imports `SOURCE`), `reputation/_spike/reputation-gate-diagnostic.js`, and tests (`tests/unit/lab/reputation/project.test.js`, `reputation-gate.test.js`). `SOURCE` is the load-bearing mis-wire marker the gate checks.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `nowMsFrom(opts)` | internal | resolve injectable wall-clock to ms; NaN-guard | `opts.now` | — | throws a clean Error on non-finite `now` (pre-empts a mid-projection `toISOString` RangeError) |
| `emptyVerdictCounts()` | internal | factory `{pass:0,partial:0,fail:0}` | — | — | none (returns a fresh object each call) |
| `personaOf(r)` | internal | extract `r.subject.persona` else `'unknown'` | a record | — | none |
| `projectReputation(opts)` | exported | the projection: ledger → distribution | `opts.now`; `verdictStore.listVerdicts` (one ledger read) | returns the distribution object on stdout-free path | none (PURE — no writes, deterministic given ledger+now) |
| `accFor(persona)` | internal (closure) | get-or-create the per-persona accumulator | the `byPersona` Map | mutates the LOCAL `byPersona` Map + accumulator | local-only mutation (no external state) |

- **File-level notes** — The `by_verifier_kind` accumulator is `Object.create(null)` (M2: a `__proto__`/`toString` kind can't collide with `Object.prototype`); reshaped to a plain object via SPREAD (define-semantics, so a `__proto__` data key stays an own key — `Object.assign` would mis-set the prototype). `verdict` is gated on `VALID_VERDICTS.includes` (M1: an `in`-check would be prototype-poisoned). Malformed/unenriched records are EXCLUDED with explicit counters (`excluded_unenriched`/`excluded_malformed`, per-persona `pending_enrichment`) — no silent omission. The `recencyTs.push({ ts: r.recorded_at })` line is the HIGH-1 adapter: the recency leaf reads `entry.ts` but the store emits `recorded_at`. The records returned by `listVerdicts` are NOT frozen (they come from `readJsonlBounded`), but `projectReputation` only READS them and never returns them, so no mutation/immutability leak escapes this module.

### `reputation/materialize.js`

- **Purpose** — The off-hot-path A6 materializer. `project.js` is a pure theorem, so ALL I/O for E4 lives here (SRP): project → build a snapshot body → compute the SHARED content-hash → atomic-rename write to the SHARED `resolveSnapshotPath()` → append a provenance witness line. The kernel spawn-record hook then reads that file O(1).
- **Imports / consumes** — `fs`, `path`; `require('./project')` (`projectReputation`); `require('../../kernel/_lib/evolution-snapshot-read')` (`resolveSnapshotPath`, `computeSnapshotHash`, `appendSnapshotWitness`); `require('../../kernel/_lib/atomic-write')` (`writeAtomicString`). Indirectly honors `LOOM_EVOLUTION_SNAPSHOT_PATH` / `LOOM_LAB_STATE_DIR` (resolved inside `resolveSnapshotPath`).
- **Consumers** — `reputation/cli.js` (`materialize` subcommand); `tests/unit/lab/reputation/materialize.test.js`; `tests/unit/kernel/spawn-state/spawn-record-a6.test.js` (cross-layer A6 contract test).

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `buildWatermark(rep)` | exported | observable staleness watermark (`record_count`, `max_recorded_at`, exclusions) | a projection `rep` | — | none (pure reduce/scan over `rep.personas`) |
| `materializeSnapshot(opts)` | exported | project → hash → atomic write → witness | `opts.now`, `opts.outPath`; `projectReputation` (one ledger read) | the snapshot file at `target` (atomic rename); a witness line via `appendSnapshotWitness` | `fs.mkdirSync(dir, recursive)`; atomic-rename of the snapshot; appends to the witness ledger; returns `{path, content_hash, persona_count, generated_at, witnessed, witness_id}` |

- **File-level notes** — `computeSnapshotHash` is wrapped in try/catch to convert the canonical-json node-cap TypeError into an operator-legible Error (guards a future >10k-node distribution from silently stopping snapshot production). WRITE-then-WITNESS ordering is deliberate: a crash between the two leaves an UNWITNESSED snapshot (the fail-closed direction the gate tier rejects), and a witness failure fail-softs to `witnessed:false` without discarding the durable snapshot. "Invalidation" is intentionally not modeled — a later materialize SUPERSEDES via atomic rename. Concurrency control is the atomic rename alone (a reader sees old-complete or new-complete, never torn).

### `reputation/cli.js`

- **Purpose** — The E4 reputation CLI: inspect the live distribution, materialize the snapshot, read the pre-computed snapshot (the A6-advise read path), or run the M1 provenance gate check. Read-mostly; only `materialize` writes.
- **Imports / consumes** — `require('./project')` (`projectReputation`); `require('./materialize')` (`materializeSnapshot`); `require('../../kernel/_lib/evolution-snapshot-read')` (`readEvolutionSnapshot`, `resolveSnapshotPath`). `process.argv`.
- **Consumers** — Invoked as a CLI (the orchestrator persona-selection step calls `snapshot --personas`; the operator/gate calls `verify-snapshot`). `main`/`parseArgs` are exported; `tests/unit/lab/reputation/*` reference the module. No JS `require` consumer in `packages/`.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `parseArgs(argv)` | exported | parse `--flag value` / bare `--flag` (→ `true`) | `argv` | — | none (builds a fresh object) |
| `collectPersonas(args)` | internal | gather `--personas` (comma) + `--persona`; trim, drop empties, dedup (Set, first-occurrence order) | `args` | — | none; typeof-guards a bare-flag `true` |
| `main(argv)` | cli-entry | dispatch `show`/`materialize`/`snapshot`/`verify-snapshot` | `argv`; the projection / snapshot / witness ledger | JSON to stdout; error lines to stderr | calls `process.exit(0/1)`; `materialize` triggers the snapshot + witness writes (via `materializeSnapshot`) |

- **File-level notes** — `show --persona` filters the LIVE projection by exact `p.persona === args.persona`; `snapshot` reads the PRE-COMPUTED file. The `snapshot` path is the A6-advise consumer: a Map-lookup over the REQUESTED array (caller order, not snapshot/alpha order), an absent persona → `{persona, status:'no-data'}` (never dropped — no-data ≠ low-rep), prototype-safe (Map, never `obj[name]`). An absent snapshot is benign (`exit 0`, reputation-blind). `verify-snapshot` is the GATE surface: `exit 0` ONLY iff present AND `provenance === 'witnessed'`. `show`/`materialize` wrap in try/catch → exit 1 with a clean stderr message; `snapshot`/`verify-snapshot` do NOT wrap (they rely on `readEvolutionSnapshot` never throwing) — see Findings.

### `reputation/reputation-gate.js`

- **Purpose** — The v3.10-W3 advisory narrowing consumer: a PURE function that, given a candidate set + a `projectReputation` output + a per-candidate breaker decision, recommends `proceed` \| `down-weight` \| `reroute` (NEVER a hard `exclude`). Closes the reputation loop INTERNALLY (production stays open until a future enforcement wave wires it into selection).
- **Imports / consumes** — `require('./project')` for `SOURCE` (the mis-wire marker `'verdict-attestation'`). PURE — no I/O, no fs, no env. Inputs are passed in (the harness owns the store reads).
- **Consumers** — `reputation/_spike/reputation-gate-diagnostic.js`; `tests/unit/lab/reputation/reputation-gate.test.js`. No production runtime consumer yet (shadow; the MV-W2 advisory wire is the planned activation).

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `isInt(n)` | internal | `Number.isInteger` alias | `n` | — | none |
| `coerceMinEvidence(v)` | internal | clamp `minEvidence` to a non-neg int else default 5 | `v` | — | none |
| `coercePassFloor(v)` | internal | clamp `passFloor` to `[0,1]` finite else default 0.5 | `v` | — | none |
| `proceedAll(candidates, reason)` | internal | map every candidate → a `proceed` row (fail-safe shape) | `candidates`, `reason` | — | none (fresh array) |
| `recommendNarrowing(candidates, reputation, breakerOf, opts)` | exported | the 3-axis most-restrictive narrowing recommendation | `candidates`, `reputation` (a projection), `breakerOf(c)→decision`, `opts` | returns the per-candidate recommendation array | none (PURE); catches any `breakerOf`/getter throw → no breaker signal |

- **File-level notes** — Three INDEPENDENT axes combined by MOST-restrictive (`reroute` > `down-weight` > `proceed`), NOT a short-circuit ladder (the architect/hacker fold: a thin reputation must not swallow a tripped breaker; a starved breaker source must not neutralize the reputation axis). Axis A (reputation) fires `down-weight` only on sufficient AND CONSISTENT evidence — a malformed `total`, a `by_verdict` whose `pass+partial+fail !== total`, or a duplicate persona key all fail TOWARD NARROWING (`unreadable-distribution`/`duplicate-row`), never launder to `proceed`. `partial` counts as NON-passing (`pass_ratio = pass/total`). The `source !== SOURCE` check is an honest MIS-WIRE guard, NOT cryptographic auth (the real authentication is upstream in the store the harness reads — the comment is accurate). Map-keyed row index is prototype-safe. The breaker booleans are snapshotted INSIDE the try (a throwing getter on `.tripped` degrades to no-signal). `opts` itself is coerced before any property read (a `null` opts would otherwise crash).

### `reputation/_spike/reputation-gate-diagnostic.js`

- **Purpose** — The LIVE out-of-CI diagnostic: runs `recommendNarrowing` over the REAL `projectReputation` output + the REAL breaker (pinned to `verdict-fail`, non-starved) against the user's real `~/.claude` lab-state, to report whether the closed loop DISCRIMINATES or fail-safes to no-narrowing (thin / all-pass / key-fragmented lane).
- **Imports / consumes** — `require('../project')` (`projectReputation`), `require('../reputation-gate')` (`recommendNarrowing`), `require('../../circuit-breaker/project')` (`evaluate`). Reads the real verdict ledger transitively. Top-level executable script (runs on require).
- **Consumers** — None (a diagnostic script run by hand). Not imported anywhere; out of CI.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `out(s)` | internal | `process.stdout.write(s + "\n")` | `s` | stdout | writes to stdout |
| (top-level body) | script | project → run gate at minEvidence 5 and 1 → print discrimination report | the live ledger + breaker | stdout (human report) | reads the user's real lab-state; no writes to disk |
| `breakerOf` (inline) | internal | wrap `evaluate({persona, source:'verdict-fail'})` so it never throws | a candidate persona | — | none; catch → null |

- **File-level notes** — The "key fragmentation" line (`candidates.length` keys for the `.replace(/^\d+-/,'')` canonical count) probes the documented C2 persona-key laundering seam (`13-node-backend` vs `node-backend`). Pure read; no mutation of shared state. Being a top-level executable, it runs its body on any `require` — acceptable for a hand-run spike but means it cannot be safely imported (no `require.main` guard); see Findings.

### `circuit-breaker/project.js`

- **Purpose** — The v3.4-W4 + E11-rescue denial-rate circuit-breaker (SHADOW). A pure projection over a pluggable DENIAL SOURCE → per-persona + global denial-rate breakers on a sliding wall-clock window, plus a stateless hysteresis LATCH. `evaluate` returns a HALT signal (narrow), never a grant.
- **Imports / consumes** — `require('../negative-attestation/store')` + `require('../verdict-attestation/store')` (both unconditionally at module-load — the ENV-BEFORE-REQUIRE discipline, since each store resolves `LAB_STATE_BASE` at its own module-load); `require('../../kernel/_lib/record-scan')` (`scanCommittedOps`, `scanRejectEvents`). Env: `LOOM_BREAKER_SOURCE`, `LOOM_BREAKER_WINDOW_MS`, `LOOM_BREAKER_MAX_DENIALS`, `LOOM_BREAKER_GLOBAL_MAX_DENIALS`, `LOOM_BREAKER_LATCH_MS`, `LOOM_DISABLE_CIRCUIT_BREAKER` (all read at CALL-time).
- **Consumers** — `manage-proposal/promote.js` (`evaluate` as `evaluateBreaker`, source `manage-promote`); `circuit-breaker/cli.js` (`projectBreaker`, `evaluate`, `DEFAULT_SOURCE`); `reputation/_spike/reputation-gate-diagnostic.js` (`evaluate`); tests (`tests/unit/lab/circuit-breaker/*`, `promote-breaker.test.js`, `cross-store-loop.test.js`).

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `personaOfNeg(r)` | internal | extract neg-attestation persona (`identity.subagent_type`) else `'unknown'` | a record | — | none |
| `personaOfVerdict(r)` | internal | extract verdict persona (`subject.persona`) else `'unknown'` | a record | — | none |
| `dedupBySubject(records, nowMs)` | internal | G1: collapse N reviewer fails about ONE subject spawn to ONE denial (countable class only) | `records`, `nowMs` | — | none (builds a Map; returns deduped.concat(passThrough)) |
| `SOURCES` (registry) | internal const | the 4 pluggable denial sources (`verdict-fail` default, `negative-attestation` opt-in/starved, `manage-promote`, `reject-event`) | the respective stores / scanners at `.list(nowMs, srcOpts)` time | — | each `.list` reads its store/scan (bounded reads) |
| `resolveSourceId(explicit)` | exported | select the active source id; explicit wins over env; unknown fails SAFE to default | `explicit`, `process.env.LOOM_BREAKER_SOURCE` | — | none; `hasOwnProperty` guards prototype-named values |
| `clampInt(raw, def, lo, hi)` | internal | env → clamped int; rejects NaN/Inf/0/neg/'' | `raw` | — | none |
| `windowMs()` / `maxDenials()` / `globalMaxDenials()` / `latchMs()` | internal | clamped env reads (call-time) | env vars | — | none |
| `isBypassed()` | internal | `LOOM_DISABLE_CIRCUIT_BREAKER === '1'` | env | — | none |
| `hasCrossingInLookback(tsArr, k, nowMs, win, latch)` | internal | latch: was the window-count ≥ k at some t in `(now-latch, now]`? O(n) sweep | timestamps, k, clock, window, latch | — | none (sorts a SLICE — does not mutate the input array) |
| `nowMsFrom(opts)` | internal | injectable clock, NaN-guard | `opts.now` | — | throws a clean Error on non-finite `now` |
| `bypassedView(nowMs, sourceId)` | internal | all-clear view with the SAME shape keys (so a consumer never NPEs) | `nowMs`, `sourceId` | — | none |
| `projectBreaker(opts)` | exported | project the active source → per-persona + global breaker view | `opts.now/source/stateDir`; the source `.list` read | returns the view object | none (PURE w.r.t. its own writes; the source read is bounded) |
| `evaluate(opts)` | exported | the consumer HALT decision for a persona (or global) | `opts.persona/now/source/stateDir/requireLive`; `projectBreaker` | returns the decision object | may THROW under `requireLive` + starved source (fail-closed-LOUD); else no side effects |

- **File-level notes** — Both stores are required unconditionally so their `LAB_STATE_BASE` resolves at module-load (the ENV-BEFORE-REQUIRE discipline; verified — both `store.js` files resolve `LAB_STATE_BASE` at module-load). The window has a 60s FLOOR (hacker H1: a sub-minute window silently disables the breaker) and a 24h ceiling; thresholds have HARD caps so a large env clamps rather than disables. The latch (v3.8b) is a STATELESS look-back, preserving the deterministic-theorem property (no state file). `dedupBySubject` keys by `(persona, agentId|positional)` — keying by persona too forks a relocate so a forged later-dated line cannot relocate a real persona's denials (H2/M1); agentId-less hand-written rows use a positional sentinel so they NEVER collapse (the safe over-halt direction). `excluded_future > 0` is surfaced as a tamper/clock-skew signal a destructive consumer (promote.js) fail-closes on. The §0a.3.1 safety argument ("halt only NARROWS") is why no INV-W1 enrichment gate exists here — but this is the documented v3.9-bootcamp CRITICAL: the `verdict-fail` source counts UN-enriched fails that `projectReputation` correctly excludes (see Findings).

### `circuit-breaker/cli.js`

- **Purpose** — The E11 breaker CLI (SHADOW): `show` prints the per-persona + global view; `check --persona` prints the consumer DECISION. Read-only; never writes.
- **Imports / consumes** — `require('./project')` (`projectBreaker`, `evaluate`, `DEFAULT_SOURCE`). `process.argv`; honors all `LOOM_BREAKER_*` env via the project module.
- **Consumers** — Invoked as a CLI (the orchestrator consults `check --persona P` before a delegated spawn). `main`/`parseArgs` exported; `tests/unit/lab/circuit-breaker/cli.test.js`.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `warnIfStarvedSource(result)` | internal | stderr warning when the resolved source is `source_starved` | a view/decision | stderr | writes a warning to stderr (stdout stays clean JSON) |
| `parseArgs(argv)` | exported | parse `--flag value` / bare flag | `argv` | — | none |
| `main(argv)` | cli-entry | dispatch `show`/`check` | `argv`; the breaker projection/decision | JSON to stdout; warnings/errors to stderr | `process.exit(0/1)`; `check --require-live` can surface the starved-source THROW as exit 1 |

- **File-level notes** — `--require-live` is read via the HYPHEN key `args['require-live']` (CR-F5: `args.requireLive` would be silently undefined). Presence (any value but the literal `'false'`) ARMS the gate — a stray token from `--require-live x` must NOT silently disable a safety gate (the M-1 trap). A tripped breaker is a VALID state → `check` exits 0 regardless (the consumer reads the `tripped` field). The starved-source warning derives from the SAME registry fact the API surfaces (`source_starved`), single source of truth (the former CLI-local `NON_STARVED_SOURCES` set was deleted).

## Findings (bugs / logical fallacies / optimizations)

| severity | level | type | location (file:line) | description |
|---|---|---|---|---|
| HIGH | component | logical-fallacy | `circuit-breaker/project.js:118-127` (the `verdict-fail` source `.list`) vs `reputation/project.js:90` | **No enrichment gate on the breaker's default source.** `verdict-fail.list` wraps `listVerdicts({filter: fail})` in `dedupBySubject` but applies NO `transaction_id != null` (INV-W1) filter — dedup is not enrichment. `projectReputation` correctly DROPS un-enriched rows; the breaker counts them. A `recordVerdict` only requires a non-empty `agentId` STRING (`verdict-attestation/store.js:152`), never that it resolve to a real spawn. So a detached/backtest fail (an agentId that never enriched to a `transaction_id`) feeds the DEFAULT breaker and can OVER-halt a live persona. Documented as the v3.9-bootcamp CRITICAL (`rfcs/2026-06-13-...:204`); deferred, not fixed. Narrowing-safe (over-halt only) but asymmetric with reputation — the two signals disagree on what counts. |
| MEDIUM | function | bug | `reputation/cli.js:106-117, 95-104` | **`snapshot` and `verify-snapshot` have no try/catch**, unlike `show`/`materialize`. They rely on `readEvolutionSnapshot`/`resolveSnapshotPath` never throwing. `readEvolutionSnapshot` is contract-bound to never throw, but `resolveSnapshotPath()` calls `os.homedir()` and `path.join` — if `LOOM_EVOLUTION_SNAPSHOT_PATH`/`LOOM_LAB_STATE_DIR` are unset and `os.homedir()` throws (no HOME, certain sandboxes), the CLI emits a raw stack dump and crashes, violating the file's stated "a clean message, never a stack dump" contract (line 19). Low likelihood, but the contract is explicit. |
| MEDIUM | function | smell | `reputation/cli.js:68-81` | **`show --persona` with a bare flag silently returns an empty `personas[]`.** `parseArgs` yields `args.persona === true` for a bare `--persona`; the `typeof args.persona === 'string'` guard at line 71 is false so no filter is applied — wait, the guard IS present, so a bare `--persona` is correctly ignored (no filter). However, `show` does NOT use `collectPersonas` (unlike `snapshot`), so `--personas a,b` is silently ignored by `show` and `--persona` is the only filter — an inconsistency between the two read surfaces that could surprise an operator. Documentation/UX smell, not a correctness bug. |
| MEDIUM | file | optimization | `reputation/project.js:117,124,126` (`distinct_spawns`, `recency_decay_factor`, `last_seen`) | **Computed-but-unconsumed signal.** `recency_decay_factor` (via `computeRecencyDecayAt`), `distinct_spawns`, and `last_seen` are computed per persona and carried into the snapshot, but NEITHER `recommendNarrowing` NOR `circuit-breaker` reads them (grep-confirmed: 0 hits in the gate/breaker). The `ACTIVATION-LEDGER.md:272` confirms `recency_decay_factor` is "OBSERVABLE-ONLY ... NOT in score formula." This is documented display-only, so not a bug, but it is per-record work + a recency-leaf call on every projection with no current consumer — a YAGNI/optimization note if projection cost ever matters. |
| MEDIUM | function | smell | `reputation/_spike/reputation-gate-diagnostic.js:1-44` | **No `require.main === module` guard on an executable that runs its body at top level.** The script reads the user's real lab-state and writes to stdout on ANY `require`. It is a hand-run spike (out of CI, never imported), so the impact is nil today, but it is the only file in the cluster lacking the `if (require.main === module)` guard that `cli.js` files use — a footgun if anything ever requires it for its (nonexistent) exports. |
| LOW | function | smell | `circuit-breaker/project.js:303` + `manage-proposal/promote.js:311-315` | **The breaker header overstates promote.js's coupling.** The header (lines 36-43) says "promote.js already converts any breaker throw into refuse('breaker-source-unavailable') — the composition is deliberate" and frames the `requireLive` THROW arm as exercised by that path. But `promote.js:313` calls `evaluateBreaker({ source: 'manage-promote', stateDir })` WITHOUT `requireLive:true`, and `manage-promote` is `starved:false`, so the starved-source THROW is never actually reached via promote.js. The try/catch is genuine defensive composition, but the comment's claim that promote.js is the live wirer of the `requireLive` arm is not borne out — `ACTIVATION-LEDGER.md:30` corroborates "NO production caller wires it." Premise-not-fully-probed comment. |
| LOW | function | optimization | `circuit-breaker/project.js:334-345` | **Per-persona latch recomputed twice.** `hasCrossingInLookback(tsByPersona.get(p), ...)` is called once at line 336 to decide row inclusion (`personaNames.add(p)`) and AGAIN at line 342 inside the `.map` (`latched = hasCrossingInLookback(...)`). For a latched-but-aged-out persona the O(n log n) sort+sweep runs twice. Memoizing the first result (e.g. a `Map<persona, boolean>`) would halve the latch work. Minor (n is small per persona). |
| LOW | function | smell | `reputation/cli.js:144` (exports) vs `circuit-breaker/cli.js:117` | **DRY: two near-identical `parseArgs` implementations.** `reputation/cli.js` and `circuit-breaker/cli.js` define byte-identical `parseArgs(argv)` functions (lines 27-37 and 43-53 respectively). A shared `_lib/cli-args.js` leaf would remove the duplication, though the divergence risk is low (the function is trivial). KISS argues either way; flagged as a real (not speculative) repetition. |
| INFO | component | smell | `reputation/project.js:65` + `circuit-breaker/project.js:124-126` | **Read-back rows from `listVerdicts` are NOT frozen** (they come from `readJsonlBounded`/`JSON.parse`, not the frozen `recordVerdict` construct path — `verdict-attestation/store.js:336`). This is the documented repo immutability-leak class (shallow-freeze-of-parsed-row), but BOTH consumers here only READ the rows and never return them to a caller, so no mutable row escapes this cluster. The leak, if any, is in the verdict store's read path (out of scope), not in reputation/breaker. Recorded for completeness against checklist item #4. |
| INFO | function | smell | `circuit-breaker/project.js:177-185` (`reject-event`) + `:147-159` (`manage-promote`) | **Two sources are reachable but have no live consumer in this cluster.** `manage-promote` is consumed by `promote.js`; `reject-event` has its producer (`reject-event-store.js`) but the gating consumer is deferred (`ACTIVATION-LEDGER.md:37`). `negative-attestation` is `starved:true` and opt-in. So of 4 sources, only `verdict-fail` (default) and `manage-promote` (promote.js) are live-wired — the other two are produced-ahead-of-consumer (the documented deep-substrate arc). Not a defect; a coverage note. |
