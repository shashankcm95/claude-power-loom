# Kernel `_lib`: decay / synthid / envelope / frontmatter / audit — `packages/kernel/_lib/*`

> This cluster is a set of seven **kernel-tier leaf modules** under `packages/kernel/_lib/`. The kernel is the only *enforced* substrate layer, but most files here are pure, deterministic helpers (high fan-in, zero outward fan — the acyclic `_lib/` sink pattern) that the runtime, Lab, and validator layers import. Three of them participate in *enforcement* surfaces (`kernel-algorithms-audit.js` backs the merge-blocking A4 gate; `layer-boundary-lint.js` is an advisory CI lint; `synthid.js` feeds the contract-verifier drift check); the rest are pure data helpers (`recency-decay.js`, `frontmatter.js`, `context-envelope.js`, `route-decide-export.js`). Nothing in this cluster writes git refs, store records, or mutates disk at call time — the only side effects are `process.stderr`/`process.stdout` writes and a CLI `process.exit` guarded behind `require.main === module`.

## Directory contents & nesting

All seven files live directly in the flat `packages/kernel/_lib/` folder; there is no nested `_lib/` or `_spike/` subfolder within scope. `_lib/` is the kernel's canonical "extracted pure leaf" sink — modules here are deliberately dependency-light (most are stdlib-only) so any layer may depend inward on them without importing layer state.

| File | Folder | One-line purpose |
|---|---|---|
| `recency-decay.js` | `packages/kernel/_lib/` | Pure recency-decay factor `mean(exp(-ageDays/τ))` over a `{ts}` history; injectable `now` for determinism. |
| `synthid.js` | `packages/kernel/_lib/` | Content-addressed HETS agent identifier — compose / parse / validate the `<persona>.<name>~<hash>/r:...` SynthId. |
| `context-envelope.js` | `packages/kernel/_lib/` | K3.b context-envelope schema validator + builder (DORMANT in v3.0-alpha; no production importer). |
| `frontmatter.js` | `packages/kernel/_lib/` | Shared YAML-frontmatter subset parser for kb docs + ADRs + skills. |
| `route-decide-export.js` | `packages/kernel/_lib/` | Thin re-export of `scoreTask` + thresholds from `algorithms/route-decide.js` (avoid subprocess-per-call). |
| `kernel-algorithms-audit.js` | `packages/kernel/_lib/` | The A4-binding gate — audits the algorithm `manifest.json` ledger vs the on-disk algorithm files. |
| `layer-boundary-lint.js` | `packages/kernel/_lib/` | Advisory K12 lint — flags inner-imports-outer + prod-imports-tests edges across `packages/**`. |

## Per-file analysis

### `recency-decay.js`

- **Purpose** — Pure leaf computing a mean recency-decay factor over a history of timestamped entries. Extracted from runtime `trust-scoring.js` (v3.4 W2) so non-runtime callers (Lab E4 reputation, persona recalibrate) can depend on the decay *rule* without importing runtime identity *state*. Observable/advisory only.
- **Imports / consumes** — None (stdlib-free; no `require`). Reads no files, no env vars.
- **Consumers** — `packages/lab/reputation/project.js` (`computeRecencyDecayAt`), `packages/lab/persona-consumer/recalibrate.js` (`computeRecencyDecayAt`), `packages/runtime/orchestration/identity/trust-scoring.js` (re-exports `computeRecencyDecay` + `RECENCY_HALF_LIFE_DAYS` verbatim for back-compat), `tests/unit/kernel/_lib/recency-decay.test.js`.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `computeRecencyDecayAt` | exported | Mean of `exp(-ageDays/τ)` over entries with a parseable `ts`; `nowMs` injected for determinism | `history` array of `{ts:string}`, `nowMs` number | returns `number\|null` | none (pure) |
| `computeRecencyDecay` | exported | Back-compat single-arg wrapper using live `Date.now()` | `history` | returns `number\|null` | reads wall-clock (`Date.now()`) — non-deterministic |
| `RECENCY_HALF_LIFE_DAYS` | exported const | Time-constant τ = 30 days (mis-named; not a true half-life — see header) | — | — | — |

- **File-level notes** — Honestly self-documents two prior verify-plan findings: the name `RECENCY_HALF_LIFE_DAYS` is a misnomer (`exp(-d/τ)` is a time-constant decay, not a half-life; at `d=τ` the factor is `e⁻¹≈0.37`), and it is a *separate knob* from the verdict-attestation store's `DEFAULT_EXPIRES_AFTER_DAYS` (both coincidentally 30 — do not DRY). The contract reads `entry.ts`; consumers with a different timestamp field must adapt to `{ts:<iso>}` before calling or every entry is silently skipped (→ `null`). Negative ages (future `ts`) are correctly clamped to 0 via `Math.max(0, ...)`. **Gap:** `nowMs` is not validated — a non-finite `nowMs` yields `NaN` (not the documented `null`).

### `synthid.js`

- **Purpose** — HETS-SynthId: a content-addressed agent identifier. Owns hash composition (`computeContentHash`), string formatting (`formatSynthId`), parsing (`parseSynthId`), and drift validation (`validateSuffix`). Content-addressed by construction: same persona + name + contract + machine → same id. Observability-only — callers decide what to do with a mismatch.
- **Imports / consumes** — `crypto` (stdlib). Reads no files itself; the caller supplies the parsed `contract`, optional `agentMd` content, and `pluginVersion`.
- **Consumers** — `packages/kernel/validators/contract-verifier.js` (`validateSuffix`, `parseSynthId` — surfaces persona-contract drift per verdict), `packages/runtime/orchestration/identity/lifecycle-spawn.js` (`computeContentHash`, `formatSynthId` — appends drift entries to `synthid_history`), `tests/unit/kernel/_lib/synthid.test.js` (inferred).

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `_canonicalize` | internal | Recursively sort object keys; arrays preserve order; primitives pass through | `value` | returns canonicalized clone | none (pure); **unbounded recursion** |
| `_canonicalJson` | exported (test-only) | `JSON.stringify(_canonicalize(value))` — deterministic byte-identical serialization | `value` | returns string | none (pure); inherits unbounded recursion |
| `_sha256hex` | internal | sha256-hex of a utf8 string | `s` | returns 64-char hex | none (pure) |
| `_stripSkillStatus` | exported (test-only) | Deep-clone contract, strip `skills.skill_status` + `skills.required` + `skills.recommended` (hash-irrelevant) | `contract` | returns clone | none (pure); clones via `JSON.parse(JSON.stringify(...))` |
| `computeContentHash` | exported | Compose the 8-hex content hash from contract + agentMd + MAJOR.MINOR version | `{persona, contract, agentMd?, pluginVersion}` | returns 8-hex string | **throws** on missing `persona`/`contract`/`pluginVersion`; **throws** `RangeError` on deeply nested contract |
| `formatSynthId` | exported | Assemble the SynthId string (bare → suffixed → with lineage) | `{persona, name, contentHash?, lineage?}` | returns string | **throws** on missing `persona`/`name` |
| `parseSynthId` | exported | Parse a SynthId via `PARSE_RE` into components | `synthId` string | returns parsed object or `null` | none (pure) |
| `validateSuffix` | exported | Compare a SynthId's hash suffix against the current contract; status-coded result | `{identity, contract, pluginVersion, agentMd?}` | returns `{status, ...}` (incl. `warning`/`error`) | none; **catches** `computeContentHash` throw → `compute-error` |

- **File-level notes** — `validateSuffix` is the only caller that fail-soft-wraps `computeContentHash` (→ `compute-error`); `lifecycle-spawn.js` calls `computeContentHash` directly but wraps it in its own try/catch. The header documents the hash inputs precisely (CH6–CH12), and the "deliberately out" set correctly excludes the identity's own verdict history (avoids the circular-dependency self-poison). The 8-hex (~4B) space is birthday-bound at ~65K identities — fine for a tens-sized HETS roster, with a documented rotate-to-12 escalation. **Spec drift:** `PARSE_RE` documents `contentHash` as exactly 8 hex (`[0-9a-f]{8}` — enforced) but `parentHash` is documented as "4 hex chars" while the regex allows `[0-9a-f]+` (any length); `formatSynthId` also does not enforce a 4-char `parentHash`. **Integrity ≠ provenance:** a SynthId hash proves the contract *content* is self-consistent, never that a legitimate producer minted it — but this module is observability-only and gates no action, so the open-writable-store trust concern does not bite here.

### `context-envelope.js`

- **Purpose** — K3.b context-envelope schema validator + producer. DORMANT in v3.0-alpha (zero production importers; enforced dormant by the merge-blocking `dormancy-assertion-k3b` CI job). Hand-rolled validation (no ajv at this tier — substrate-fundament has zero non-stdlib deps).
- **Imports / consumes** — `fs`, `path` (stdlib). Reads `packages/kernel/schema/context-envelope.schema.json` **once at module load** (verified present, 1185 bytes). No env vars.
- **Consumers** — Only `tests/unit/kernel/_lib/context-envelope.test.js`. No production importer (this is the asserted-dormant invariant).

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| (module load) | side-effect | Read + `JSON.parse` the schema once | `SCHEMA_PATH` file | `_SCHEMA`, `SCHEMA_VERSION` module consts | **throws at require-time** if schema missing/invalid JSON |
| `validateEnvelope` | exported | Hand-rolled validation: required fields, `schemaVersion` const, `contextItems` array, no extra top-level keys | `envelope` | returns `{valid, errors?}` | none (pure) |
| `buildEnvelope` | exported | Construct a schema-valid envelope (round-trip producer); shallow-copies `contextItems` | `{contextItems?}` | returns `{schemaVersion, contextItems}` | none; input not mutated |
| `acceptsSchemaVersion` | exported | MAJOR-version handshake: accept iff string starts with `'1.'` | `v` | returns boolean | none (pure) |

- **File-level notes** — The module-load schema read is the only I/O and is pure-read (no side effects beyond populating module consts), but it **throws at require-time** if the schema file is missing or malformed — acceptable for a kernel-fundament invariant but a hard-fail import. `buildEnvelope` correctly avoids mutating its input (fresh `.slice()` array). Validation is shallow by design (v3.0-alpha imposes no per-item shape); the JSDoc per-item shape is convention, not a gate. `acceptsSchemaVersion` is a `startsWith('1.')` prefix test — would also accept `'1.foo'` or `'10.0'` would *not* match (`'10.'` starts with `'1'` then `'0'` — actually `'10.0'.startsWith('1.')` is `false`, correct), but `'1.x-garbage'` passes; benign given dormancy.

### `frontmatter.js`

- **Purpose** — Shared canonical YAML-frontmatter parser for the YAML subset used by power-loom kb docs + ADRs + skills. Closes a DRY violation (divergent inline parsers in `kb-resolver.js` and `adr.js` with different bug surfaces).
- **Imports / consumes** — None (stdlib-free). Operates purely on the text string passed in.
- **Consumers** — `packages/runtime/orchestration/{pattern-runner,adr,kb-resolver,contracts-validate,_h70-test}.js`, `packages/runtime/orchestration/aggregate/hierarchical-aggregate.js`, `packages/kernel/validators/{validate-frontmatter-on-skills,contract-verifier,validate-kb-doc}.js`, `tests/unit/scripts/yaml-identity-quoting.test.js`. Wide fan-in — a behavior change here ripples across the kb + ADR + skills + contract-verification surfaces.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `_stripInlineComment` | exported | Strip a YAML 1.2 inline `#` comment honoring single/double-quote state + `\"` escape | `val` string | returns stripped string | none (pure) |
| `parseFrontmatter` | exported | Parse frontmatter block → `{frontmatter, body}`; CRLF + BOM normalize, scalars/arrays/block-lists/null/numeric coercion | `text` string | returns `{frontmatter, body}` | **writes `process.stderr`** on an unsupported block-scalar indicator; reassigns the `text` param (local) |
| `_extractIdentityFromRaw` | exported | Last-resort `^identity:` scalar extractor (bypasses YAML `~`→null semantics) | `rawFrontmatterText` string | returns `string\|null` | none (pure) |

- **File-level notes** — Extensively hardened against documented chaos findings: CRLF→LF normalization (VAL-1), BOM strip (VAL-6), digit-bearing keys (eli LOW-3), block-scalar indicators → `null` + stderr warning (VAL-2), quote-aware numeric coercion with a leading-zero exclusion to preserve string IDs like `adr_id: 0001` (VAL-5). The `_stripInlineComment` quote-state machine correctly handles `\"` escapes (does not translate them, by design). **Known gotcha confirmed by probe:** inline arrays are comment-stripped *before* the `[...]` detection, so `tags: [a, b # c, d]` silently becomes the **string** `"[a, b"` (not an array) — documented in the header, but a consumer expecting an array gets a string with no error. `parseFrontmatter` reassigns its `text` parameter (local reassignment, not caller mutation — JS strings are immutable, safe). Function length: `parseFrontmatter` is ~112 lines (lines 92–224) — well over the 50-line guideline; a candidate for extracting the per-line scalar-coercion ladder.

### `route-decide-export.js`

- **Purpose** — A ~15-LoC thin re-export so callers (`agent-identity.js`'s task-complexity bucketer) can call `scoreTask` as a function instead of spawning a subprocess per call. Pure refactor; CLI behavior of `route-decide.js` unchanged.
- **Imports / consumes** — `require('../algorithms/route-decide.js')`. The require side-effect (running route-decide's main block) is suppressed because `route-decide.js` guards its CLI behind `require.main === module` (verified at `route-decide.js:702`).
- **Consumers** — `packages/runtime/orchestration/identity/trust-scoring.js`, `packages/runtime/orchestration/_h70-test.js`, and re-imported via `packages/kernel/algorithms/route-decide.js` (self-reference in comments). Grep confirms the three references.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `scoreTask` (re-export) | exported | Pass-through of `routeDecide.scoreTask` | — | — | none (re-export of a pure scorer) |
| `ROUTE_THRESHOLD` (re-export) | exported const | Pass-through of `routeDecide.ROUTE_THRESHOLD` (0.60) | — | — | — |
| `ROOT_THRESHOLD` (re-export) | exported const | Pass-through of `routeDecide.ROOT_THRESHOLD` (0.30) | — | — | — |

- **File-level notes** — Verified that all three re-exported names exist in `route-decide.js` (`scoreTask` at line 370/695, `ROUTE_THRESHOLD=0.60` at line 50, `ROOT_THRESHOLD=0.30` at line 51) and that the CLI is correctly guarded — so importing this module does not trigger the route-decide main block. Trivially correct; the only fragility is the silent coupling — if `route-decide.js` renamed an export, this would re-export `undefined` with no validation.

### `kernel-algorithms-audit.js`

- **Purpose** — The A4-binding gate (v3.2 K11, ENFORCING since Wave 3). Audits the author-maintained `manifest.json` ledger against the on-disk algorithm files: schema validity, per-algorithm integrity (file exists, declared exports present, test exists), an unregistered-file scan, and (at `enforcement:"error"`) the `planned[]` watchlist as hard errors. Pure + injectable (`deps` for fixture-free testing); no `process.exit`, no module-scope I/O.
- **Imports / consumes** — `fs`, `path`, `./toolkit-root` (`findToolkitRoot`). Reads `packages/kernel/algorithms/manifest.json` (verified present, 458 bytes) unless a `manifest` override is supplied; reads each algorithm `*.js` source via `readFileSync` (static analysis — **never `require()`s** the module, closing the require-cache/side-effect/DoS surface); `readdirSync`/`lstatSync` over the algorithms dir.
- **Consumers** — `packages/runtime/orchestration/contracts-validate.js` (`kernel-algorithm-a4-binding` validator, line 1422 — a thin runtime→kernel adapter, legal), `tests/unit/kernel/algorithms/kernel-algorithms-audit.test.js`.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `finding` | internal | Build a `{kind, message, ...extra}` finding object | `kind, message, extra` | returns object | none (pure) |
| `exportBlock` | internal | Strip comments, extract first `module.exports = { ... }` body (non-greedy, assumes flat) | `src` string | returns block string or `null` | none (pure) |
| `blockHasName` | internal | Test whether a name appears as an identifier in the export block | `block, name` | returns boolean | none; builds a `RegExp` per call |
| `validateSchema` | internal | Validate manifest shape: version, enforcement enum, algorithms/planned arrays + per-entry required + typed fields | `manifest` | returns errors array | none (pure) |
| `checkAlgorithmIntegrity` | internal | Per-algorithm: file exists, flat export block, declared exports present, test exists | `algo, rootDir, deps` | returns errors array | reads `algo.file` source + checks `algo.test` path via `deps` |
| `checkUnregistered` | internal | Flag-unless-allowlisted scan of the algorithms dir; reject symlinks + subdirs by `lstat` type | `manifest, rootDir, deps` | returns errors array | `readdirSync` + `lstatSync` the dir |
| `auditAlgorithmLibrary` | exported | Orchestrate: load manifest → schema → integrity → unregistered → planned watchlist | `{rootDir?, manifest?, deps?}` | returns `{errors, warnings}` | reads manifest + algorithm files; no writes, no exit |

- **File-level notes** — Fail-closed and well-factored: a malformed manifest short-circuits before integrity (you cannot trust a broken ledger), string fields are type-checked *before* reaching `path.join` (avoids an unhandled `TypeError` breaking the `{errors,warnings}` contract), and the directory-read failure gets its own `algorithm-directory-unreadable` kind (SRP — consumers filtering by kind do not conflate environment errors with ledger errors). The `exportBlock` non-greedy regex is a documented, deliberate trade-off — it assumes a FLAT export object and `checkAlgorithmIntegrity` explicitly rejects a non-flat block (`algorithm-export-nonflat`) rather than mis-parsing it (GH #229). The unregistered scan correctly uses `lstat` (no-follow) to catch a `.js`-*named* symlink before the registered check, and skips dotfiles — but the header itself notes a symlink **target** escape is out of scope (needs the ContainerAdapter fs-sandbox). The Wave-3 `enforcement:"error"` flip was a pure data change (both modes implemented). **Minor coupling:** `checkUnregistered` relies on `validateSchema` having already guaranteed `manifest.algorithms` is an array of objects with string `file` — true on the only call path (`auditAlgorithmLibrary` returns early on schema errors), but the function is not defensively self-contained if called directly.

### `layer-boundary-lint.js`

- **Purpose** — K12 advisory layer-boundary lint (v3.0-alpha, PR 5). Flags two finding classes across `packages/**`: (1) `inner-imports-outer` — an inner layer importing an outer one, violating the Dependency Rule (rank kernel<runtime<lab<adapter); (2) `prod-imports-tests` — a production file importing a `tests/` path. Advisory (CI `continue-on-error`), not blocking; the script exits non-zero on findings as ground truth.
- **Imports / consumes** — `fs`, `path` (stdlib only — no deps, no shell, no `require.resolve`, no `fs.realpath`). Walk root is a fixed constant `path.resolve(__dirname, '..', '..', '..')` (CWE-22-safe — no untrusted path input). No env vars.
- **Consumers** — `tests/unit/kernel/_lib/layer-boundary-lint.test.js`. The CI advisory job invokes the CLI (wired by the orchestrator, per the header). No production importer.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `enumerateSourceFiles` | exported | Recursive walk of `.js/.mjs/.cjs` files; skip `SKIP_DIRS` + symlinks; depth-bounded; fail-soft | `root` | returns abs path array | `readdirSync` (fail-soft on EACCES/ENOENT) |
| `layerOfPath` | exported | Path-primary layer identity: `packages/<layer>/...` → layer or `null` | `absPath, root` | returns layer string or `null` | none (pure) |
| `isTestsPath` | exported | True iff any path segment equals `tests` | `absPath` | returns boolean | none (pure) |
| `isProductionFile` | exported | True iff under `packages/**` and not in a `tests/` dir | `absPath` | returns boolean | none (pure) |
| `isCommentedMatch` | internal | Suppress-only heuristic: is the import match inside a `//` or `*` comment | `fileText, matchIndex` | returns boolean | none (pure) |
| `extractImportSpecifiers` | exported | Pull relative import specifiers via bounded `IMPORT_RE`, skipping commented matches | `fileText` | returns string array | resets `IMPORT_RE.lastIndex` (shared global regex) |
| `analyzeFile` | exported | Read + classify one file's import edges into findings; pure path-string resolution | `absPath, root` | returns findings array | `readFileSync` (fail-soft) |
| `lint` | exported | Run over the whole workspace; sort file list for stable output | `root?` | returns `{findings, notes}` | reads the tree via the helpers |
| `formatFinding` | exported | Format one finding as a stable grep-friendly line | `f` | returns string | none (pure) |
| (CLI runner) | cli (`require.main`) | Print findings + count, exit 1 if any | — | `process.stdout` | **`process.exit(findings.length>0?1:0)`** |

- **File-level notes** — Security-conscious by design: stdlib-only, bounded `IMPORT_RE` (single char-class star with `{0,512}` cap, no nested quantifier — ReDoS-safe), the walk skips symlinks (no-follow defeats loop + escape) and is depth-bounded (`MAX_WALK_DEPTH=50`). The shared global-flag `IMPORT_RE` is correctly reset (`lastIndex = 0`) at the top of every `extractImportSpecifiers` call — verified by probe that sequential calls do not lose matches. `isCommentedMatch` is a non-AST suppress-only heuristic that can ONLY remove findings, so it cannot break the 0-on-main baseline. `LAYER_RANK` and `DIR_TO_LAYER` are frozen. **Note:** `isCommentedMatch`'s "before contains `//`" check (line 197) treats any earlier `//` on the line as a comment — a line like `const u = 'http://x'; require('./real')` would mis-suppress the real import because the protocol `//` precedes the match (false-negative). Forward-looking only (suppresses, never adds findings), so the baseline is preserved, but it is an over-broad heuristic.

## Findings (bugs / logical fallacies / optimizations)

| severity | level | type | location (file:line) | description |
|---|---|---|---|---|
| LOW | function | bug | `recency-decay.js:37-49` (`computeRecencyDecayAt`) | No boundary validation on `nowMs`. A non-finite `nowMs` (e.g. a failed `Date.parse` passed in) makes `dDays` `NaN` → `Math.exp(NaN)` `NaN` → result `NaN`, violating the docstring contract `factor in (0,1], or null`. Probed: `computeRecencyDecayAt([{ts:"2026-01-01T00:00:00Z"}], NaN)` returns `NaN`. Guard with `Number.isFinite(nowMs)` → `null`. |
| LOW | function | bug | `synthid.js:66-86` (`_canonicalize` / `_canonicalJson` / `computeContentHash`) | Unbounded recursion. The kernel `canonicalJsonSerialize` precedent is DEPTH-BOUNDED with a controlled throw; this `_canonicalize` is not, so a deeply nested contract overflows the stack with an uncaught `RangeError`. Probed: a ~200k-deep object throws `Maximum call stack size exceeded`. `validateSuffix` catches it (`compute-error`); `lifecycle-spawn.js` wraps its direct call in try/catch. Severity LOW because contract JSON is author-controlled, not adversarial input. |
| LOW | function | smell | `frontmatter.js:142,172-178` (`parseFrontmatter`) | Inline-array values are comment-stripped before `[...]` detection, so `tags: [a, b # c, d]` silently parses to the **string** `"[a, b"` instead of an array, with no error. Probed and confirmed. Documented as a header gotcha, but a downstream consumer expecting `Array.isArray` gets a string — a silent type drift. Detect `[`-prefixed values before stripping, or warn. |
| INFO | function | smell | `synthid.js:193` (`PARSE_RE`) | Spec drift between doc and regex: header + JSDoc say `parentHash` is "4 hex chars", but the regex captures `[0-9a-f]+` (unbounded) and `formatSynthId` does not enforce a 4-char width. Probed: a 16-char `parentHash` parses unchanged. `contentHash` is correctly fixed at `{8}`. Cosmetic — `parentHash` is lineage-only and gates nothing. |
| INFO | function | smell | `layer-boundary-lint.js:194-203` (`isCommentedMatch`) | The `before.includes('//')` check treats any earlier `//` on the line (e.g. a URL protocol like `'http://x'` preceding a real `require('./y')` on the same line) as a comment, mis-suppressing the genuine import (false-negative). Suppress-only, so it cannot break the 0-on-main baseline, but the heuristic is over-broad. |
| INFO | function | optimization | `kernel-algorithms-audit.js:86-90` (`blockHasName`) | Constructs a fresh `RegExp` (with escape) per `(algorithm, exportName)` pair. For a manifest with many algorithms × many declared exports this is repeated allocation; a single tokenization of the export block into an identifier `Set` would make membership O(1) and avoid per-name regex compilation. Micro-optimization; correctness is fine. |
| INFO | function | smell | `frontmatter.js:92-224` (`parseFrontmatter`) | Function is ~112 lines — over the 50-line guideline and >4 levels of nested branching in places. The per-line scalar-coercion ladder (numeric/null/array/quote handling) is a clean extraction candidate (`_coerceScalar`) to shrink the body and isolate the VAL-5 numeric rules. |
| INFO | file | smell | `context-envelope.js:30` (module load) | The schema `JSON.parse(readFileSync(...))` at require-time throws if the schema file is missing or malformed, making module import a hard-fail rather than a graceful degrade. Acceptable for a kernel-fundament invariant, but worth noting: any importer (incl. the dormant-assertion CI grep’s future first consumer) inherits a require-time crash on a corrupt schema. |
| INFO | file | smell | `route-decide-export.js:22-28` | Silent coupling with no validation: if `route-decide.js` renamed/removed `scoreTask`/`ROUTE_THRESHOLD`/`ROOT_THRESHOLD`, this module would re-export `undefined` with no error. A load-time assertion (`if (typeof routeDecide.scoreTask !== 'function') throw`) would fail fast. Currently all three names verified present. |
| INFO | function | smell | `kernel-algorithms-audit.js:202-248` (`checkUnregistered`) | Depends on `validateSchema` having already proven `manifest.algorithms` is an array of objects with string `file` (the `.map((a) => a.file)` would throw otherwise). True on the only call path (`auditAlgorithmLibrary` returns early on schema errors), but the function is not defensively self-contained if invoked directly from a test. |
