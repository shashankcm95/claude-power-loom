# Kernel `_lib`: security & path primitives — `packages/kernel/_lib/*`

> This cluster is the **enforced kernel tier**'s shared low-level toolbox: the pure, dependency-light primitives that the kernel hooks (PreToolUse / PostToolUse / lifecycle) and the K7/K9/K14 write-scope guards compose to deliver their security guarantees. Nothing here is itself a hook entry-point — every module is a library of pure (or near-pure: `fs.lstat`/`fs.realpath`-bearing) helpers required by the enforced hooks, the spawn-record store, and (by the deliberate `lab → kernel/_lib` outer→inner K12-legal direction) several lab/runtime consumers. Because the kernel is the only *enforced* layer, a fail-open bug here silently weakens a real security control; the modules are written fail-closed where they gate (path scope, exec resolution) and fail-soft/advisory where they merely redact or detect (secret scrub, egress audit). The cluster's recurring discipline themes are: (a) syntactic-pre-screen before any FS resolution (CWE-22), (b) fresh-RegExp-per-call to dodge the global-`lastIndex` false-negative trap, (c) reject-not-scrub vs strip-for-emission as opposite contracts, and (d) honest "raises the bar, does not close it" framing on the same-uid / container-tier residuals.

## Directory contents & nesting

All nine in-scope files live flat in `packages/kernel/_lib/` (no nested `_lib/` or `_spike/` subfolders within this scope). The `_lib/` folder itself is the convention marker: an underscore-prefixed "internal/shared primitives" directory inside the kernel package, importable cross-layer in the outer→inner direction only.

| File | Folder | One-line purpose |
|---|---|---|
| `path-canonicalize.js` | `packages/kernel/_lib/` | K7 — path canonicalization + CWE-22 traversal/symlink/segment guards; single source of truth for K9/K14 write-scope + the out-of-scope reason taxonomy. |
| `safe-exec.js` | `packages/kernel/_lib/` | H.8.4 — shell-free `execFileSync` wrappers (`invokeNodeJson`/`invokeNodeText`) replacing `execSync(string)` RCE call sites; fail-open to `null`. |
| `safe-resolve.js` | `packages/kernel/_lib/` | Choose a script candidate SAFE to hand to `spawnSync` — rejects symlink / foreign-uid / group-other-writable candidates (partial-install plant/symlink defense). |
| `sanitize.js` | `packages/kernel/_lib/` | JSONL hygiene: `sanitizeForJsonl` (strip/replace control chars) + `prepareForJsonl` (the `scrubSecrets → sanitize → stringify` pipeline). |
| `secret-patterns.js` | `packages/kernel/_lib/` | Single source of truth for the high-precision canonical secret-token classes shared by the scrubber AND the bare-secret validator; factory mints fresh RegExps. |
| `network-egress-detect.js` | `packages/kernel/_lib/` | Pure egress-host extraction + allowlist verdict for the advisory PostToolUse:Bash network audit. |
| `env-placeholder.js` | `packages/kernel/_lib/` | `isPlaceholderEnvValue` — recognize template/placeholder `.env` values (treat-as-absent) for the doctor env-inheritance probe. |
| `free-string-checks.js` | `packages/kernel/_lib/` | Shared free-string FIELD detectors (`nonEmptyString` / `hasControlChars`) for the Lab JSONL stores; reject-fail-closed over a BROADER control/format set than `sanitize.js`. |
| `enum-validate.js` | `packages/kernel/_lib/` | Shared closed-enum validation with NFC/homoglyph defense (`normalizeAsciiEnum` / `validateEnum`) for the Lab stores. |

## Per-file analysis

### `path-canonicalize.js`

- **Purpose** — K7. Two deliberately-separated SRP responsibilities: (1) lenient `canonicalize(p)` (resolve + realpath, resolving symlinked ancestors even for a not-yet-existing leaf), used by the `fact-force-gate` read-tracker and as the substrate for (2) the load-bearing CWE-22 scope guard `checkWithinRoot(p,root)` for K9/K14. Also owns the out-of-scope **reason taxonomy** so consumers delegate rather than re-roll the discrimination, plus the raw-segment guard `isSafePathSegment` (the #215 `path.join`-collapses-`..` lesson).
- **Imports / consumes** — `fs` (`realpathSync`, no-follow on the final component only via the ancestor walk), `path`. No env, no module-load I/O.
- **Consumers** — `k9-path-guard.js` (`checkWithinRoot`), `k14-write-scope.js` (`checkWithinRoot`, `hasTraversalMarkers`), `k14-symlink-guard.js` (`checkWithinRoot`), `hooks/pre/fact-force-gate.js` (`canonicalize`), `hooks/post/spawn-close-resolver.js`, `spawn-state/_stage-helpers.js`, `spawn-state/stage-promote.js`, `validators/validate-frontmatter-on-skills.js`, `_lib/quarantine-promote.js`, `_lib/record-locate.js`, `_lib/record-scan.js`, `_lib/record-store.js`, `_lib/reject-event-store.js`, `_lib/layer-boundary-lint.js`, `runtime/orchestration/_lib/safe-segment.js`, `runtime/orchestration/{todo-checkpoint,trampoline}.js`, `runtime/test-runners/node-runner.js`, several `lab/*` modules (`issue-corpus/{_clone-lifecycle,container-adapter,sandbox-exec-backend}.js`, `negative-attestation/record-from-decompose.js`, `trace-emitter/trace-store.js`, `verdict-attestation/enrich-from-spawn-state.js`), plus unit tests.
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `canonicalize` | exported | Lenient canonical absolute path; resolves symlinked ancestors of a non-existent leaf | `filePath`; reads FS via `fs.realpathSync` | none | none (pure-ish read); fails CLOSED (`''`) on PATH\_MAX-exceeding `!reachedRoot` |
| `hasTraversalMarkers` | exported | Syntactic pre-resolution CWE-22/CWE-158 screen (`..` segment, NUL, non-string) → true == REJECT | `rawPath` | none | pure |
| `isWithinRoot` | exported | True iff candidate (post-symlink-resolution) is root or strictly under it, separator-boundary prefix | `candidatePath`, `rootPath`; FS via `canonicalize` | none | pure read |
| `isLexicallyWithin` | exported | True iff candidate is LEXICALLY inside root (pre-resolution string compare); used to discriminate escape reason | `candidatePath`, `rootPath` | none | pure (no FS) |
| `checkWithinRoot` | exported | The CWE-22 admission gate; returns `{ok, reason}` with reason taxonomy (`traversal-markers` / `escapes-root` / `absolute-outside-root`) | `candidatePath`, `rootPath`; FS via `isWithinRoot` | none | pure read; the gate K9/K14 act on |
| `isSafePathSegment` | exported | True iff `seg` is a safe SINGLE untrusted path segment (no sep, no `.`/`..`, no NUL); MUST run BEFORE `path.join` | `seg` | none | pure |

- **File-level notes** — The `canonicalize` ancestor-walk loop is numerically bounded at 4096 iterations as belt-and-suspenders; the real terminator is `parent === dir` at the filesystem root. The fail-closed `''` return on `!reachedRoot` is correctly threaded through `isWithinRoot` (`if (!root || !cand) return false`) so the security consumers REJECT. Module header correctly documents that `lstat`/`realpath` no-follows the FINAL leaf only and that the ancestor-realpath closes the symlinked-parent-of-nonexistent-leaf gap on writes. The `isSafePathSegment` doc-comment is the codified #215 lesson and is accurate. One genuine TOCTOU residual (documented elsewhere in the substrate): the canonicalize→open window is irreducible here.

### `safe-exec.js`

- **Purpose** — H.8.4 shared helper to invoke a Node script without a shell, eliminating the `execSync(string)` shell-injection RCE confirmed by chaos POC `--task 'foo $(touch /tmp/PWNED) bar'`. Two thin wrappers around `execFileSync('node', [scriptPath, ...args])`.
- **Imports / consumes** — `child_process.execFileSync`, `path`. No env, no FS reads at import.
- **Consumers** — `_lib/invoke-git.js`, `_lib/k9-promote-deltas.js`, `validators/validate-adr-drift.js`, `runtime/orchestration/build-spawn-context.js`.
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `invokeNodeJson` | exported | Run a node script (no shell) and `JSON.parse` stdout; `null` on error | `scriptPath`, `args[]`, `opts{timeout?,cwd?}` | spawns child `node` process; on error writes a diagnostic to `process.stderr` | spawns/reaps a subprocess; fail-OPEN to `null` (ADR-0001) |
| `invokeNodeText` | exported | Same but returns raw stdout string | `scriptPath`, `args[]`, `opts{timeout?,cwd?}` | spawns child `node`; stderr diagnostic on error | spawns/reaps subprocess; fail-open `null` |

- **File-level notes** — Argument-array form is the security property (never shell-interpolated). Default timeouts differ (5000ms JSON / 3000ms text) — minor inconsistency, not a bug. `stdio: ['pipe','pipe','pipe']` captures stderr but the captured child stderr is discarded (only `err.message` is surfaced); acceptable for fail-open helpers. Note: it hard-codes the literal `'node'` as the binary, relying on PATH resolution — if `PATH` is attacker-controlled this is a vector, but in the hook runtime PATH is the operator's, so acceptable; worth noting as a residual.

### `safe-resolve.js`

- **Purpose** — Defend the two kernel hook resolvers (`resolveSelfImproveScript` in `pre-compact-save.js`, `resolveStoreScript` in `auto-store-enrichment.js`) against a partial-install plant/symlink attack: pick the first candidate script SAFE to `spawnSync`. Three composed checks: symlink-reject (final component), uid-ownership (POSIX), group/other-writability (POSIX).
- **Imports / consumes** — `fs` (`lstatSync`), `process.getuid`. No env, no module-load I/O.
- **Consumers** — `hooks/lifecycle/auto-store-enrichment.js`, `hooks/lifecycle/pre-compact-save.js`, `hooks/pre/fact-force-gate.js`, `hooks/pre/route-decide-on-agent-spawn.js`, `_lib/atomic-write.js`.
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `currentUid` | exported | Current process uid or `null` on Windows | `process.getuid` | none | reads process identity |
| `isSafeExecStat` | exported (PURE policy) | Decide if an lstat result is safe to exec: reject symlink / non-regular-file / foreign-uid / group-other-writable | `stat` (an `fs.Stats`), `selfUid` | none | pure (unit-testable without root/chown) |
| `isSafeExecCandidate` | exported (I/O shell) | `lstatSync` (no-follow) the candidate + apply policy; never throws | `candidate` path; FS via `fs.lstatSync` | none | reads FS; swallows all errors → `false` (fail-CLOSED here, correct) |
| `resolveExecCandidate` | exported | First safe candidate or `null` | `candidates[]` | none | reads FS (one lstat per candidate) |

- **File-level notes** — Header is unusually honest about scope: the `selfUid !== null` POSIX block is SKIPPED on Windows (so only the symlink/regular-file gate applies — weaker, documented). `(stat.mode & 0o022)` correctly catches group(0o020)+other(0o002) write bits. Documented residuals: same-uid full-`$HOME` breach (a same-uid regular file/hardlink passes — accepted, ContainerAdapter track) and the symlinked-PARENT-dir gap (lstat resolves parent symlinks; documented as reducing to the same-uid residual). The lstat→spawn re-open TOCTOU is irreducible at this layer and accepted. This module is the canonical correct shape of the "lstat no-follows only the FINAL component; defend with the uid check, not a parent-walk" reusable.

### `sanitize.js`

- **Purpose** — JSONL hygiene primitives. `sanitizeForJsonl` strips row-separators + NUL and replaces other C0 control chars with a single space (preserving tab + non-ASCII). `prepareForJsonl` is the composed `scrubSecrets → sanitizeForJsonl → JSON.stringify` pipeline with the load-bearing ordering codified in ADR-0011 §F13.
- **Imports / consumes** — `spawn-record.js` (DEFER-required inside `prepareForJsonl` only, to dodge a circular dep at import time). No FS, no env.
- **Consumers** — `spawn-state/spawn-record.js`, `_lib/free-string-checks.js` (header cross-reference only — `free-string-checks` does not actually `require` it; the reference is documentary), unit tests. Note: a repo grep shows `prepareForJsonl` is exported but I found no production caller of `prepareForJsonl` itself (only `sanitizeForJsonl` is used live) — see Findings.
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `sanitizeForJsonl` | exported | Strip `\0\n\r`, replace other C0 (minus tab) with space; pass-through falsy/non-string unchanged | `str` | none | pure |
| `prepareForJsonl` | exported | Composed `scrubSecrets → sanitize → stringify` pipeline | `str`; defer-`require`s `spawn-record.js` | none | pure at call (no I/O); resolves `scrubSecrets` (or `__test__` alias, or identity fallback) each call |
| (module-load) `_STRIP_CODEPOINTS` / `_SPACE_CODEPOINTS` build loop | internal const init | Build the codepoint Sets without a control-char regex literal (ADR-0006 no-suppress) | — | none | one-time module-load Set construction |

- **File-level notes** — The per-char scan avoids a no-control-regex lint cleanly. The `prepareForJsonl` identity-fallback (`(s) => s`) is a graceful-degradation path for a partial-impl window that, post-PR-1-phase-4, "shouldn't happen" — it is now effectively dead defensive code (`scrubSecrets` IS top-level in `spawn-record.js`), but harmless. Defer-require correctly breaks the cycle (`spawn-record` ⟷ `sanitize`). The ordering rationale (scrub before strip, so a secret split across a control char cannot escape the regex) is sound.

### `secret-patterns.js`

- **Purpose** — ③.0-W2 single source of truth for the high-precision, prefix-anchored canonical secret-token classes that BOTH the coarse scrubber (`spawn-record.scrubSecrets`) and the strict edit-blocking validator (`validators/validate-no-bare-secrets.js`) must cover. A cross-test fails if a consumer stops covering a canonical class.
- **Imports / consumes** — nothing (`'use strict'` + a frozen array of source/flags defs). No FS, no env.
- **Consumers** — `spawn-state/spawn-record.js` (`getCanonicalSecretClasses().map(c => c.regex)`), `validators/validate-no-bare-secrets.js` (`getCanonicalSecretClasses()` spread first, before validator-only), `lab/issue-corpus/_clone-lifecycle.js`, cross-test + unit tests.
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `getCanonicalSecretClasses` | exported (factory) | Mint a FRESH array, each with a NEWLY-constructed RegExp (no shared mutable `lastIndex`) | none | none | pure; returns new objects + new RegExps each call |
| `CANONICAL_SECRET_CLASS_IDS` | exported const | Frozen id list for tests + cross-test expectations | — | none | module-load-frozen array |
| (module-load) `CANONICAL_SECRET_CLASS_DEFS` | internal frozen const | The source/flags/id/description defs | — | none | `Object.freeze`d at load |

- **File-level notes** — The factory rationale is correct and load-bearing: every pattern is `/g`, and a shared global RegExp's mutable `lastIndex` (which `Object.freeze` does not freeze) would intermittently skip a real token → a security false-negative. The charset notes are careful (each class matches its real token alphabet; GitHub classic body is base62 by design; the GitLab routable `.XX.YYYYYYY` suffix is handled with FLOOR quantifiers so a redaction net never leaves a partial tail). `CANONICAL_SECRET_CLASS_DEFS` is frozen but is an array of plain `{id,source,flags,description}` objects — the nested objects are NOT individually frozen, so a caller could mutate `DEFS[0].source`; since `getCanonicalSecretClasses` reads them on every call this is a theoretical shared-state mutation surface (see Findings — low: it's a module-private const never exported).

### `network-egress-detect.js`

- **Purpose** — Pure egress-host detection helpers powering the ADVISORY PostToolUse:Bash audit (`observability/network-egress-audit.js`). No I/O — the hook reads/parses the registry and passes the object in. Honest "coarse net, not a gate" framing (evadable via base64 / sockets / indirection).
- **Imports / consumes** — nothing (pure regex/string transforms). The consuming hook reads the trait registry file and parses it.
- **Consumers** — `observability/network-egress-audit.js`, unit test.
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `hasEgressVerb` | exported | True if command contains a network verb (curl/wget/nc/netcat/ssh/scp/sftp/telnet) | `command` | none | pure |
| `isLoopback` | exported | True for localhost / 127.0.0.1 / ::1 / 0.0.0.0 / `*.localhost` | `host` | none | pure |
| `normalizeHost` | exported | Strip scheme/userinfo/port/path/brackets/trailing-dot; lowercase; reject implausible | `raw` | none | pure |
| `extractEgressHosts` | exported | Best-effort candidate-host extraction (URLs, nc, scheme-less curl/wget + `user@host` ssh), de-duped | `command` | none | pure; per-segment scan, ReDoS-avoided by whitespace tokenization |
| `loadDeclaredHosts` | exported | Union of every trait's `network[]` from a PARSED registry object, normalized | `registry` (parsed object) | none | pure |
| `isAllowlisted` | exported | True if host == allow entry OR a subdomain (`.`-prefixed `endsWith`); loopback always allowed | `host`, `allowlist[]` | none | pure |
| `auditCommand` | exported | The verdict: `{undeclaredHosts, egressVerbNoHost, allHosts}` | `command`, `allowlist` | none | pure |

- **File-level notes** — `isAllowlisted` correctly uses a `.`-prefixed `endsWith` to prevent both `evil-api.anthropic.com` and `api.anthropic.com.evil.com` bypasses (a real subdomain-confusion defense). The known coarse-net edges (echo'd-URL FP, bare-host-ssh FN, all obfuscation) are honestly documented for a non-gating advisory. ReDoS was deliberately avoided (the prior combined regex was O(n²)). `0.0.0.0` is treated as loopback/allowed — debatable for egress (`0.0.0.0` as a destination is unusual), but immaterial for an advisory audit. `isLoopback` redundantly re-checks `::1` (already in the Set) — harmless dead sub-condition (see Findings).

### `env-placeholder.js`

- **Purpose** — `isPlaceholderEnvValue`: recognize template/placeholder `.env` values so a gate treats them as absent (fixes the bench bug where `<your-anthropic-key-here>` passed `[ -n "$X" ]` and Phase-3/4 spawns silently degraded to stubs).
- **Imports / consumes** — nothing. No FS, no env. Pure.
- **Consumers** — `runtime/orchestration/doctor/probes/env-inheritance.js`, unit test.
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `isPlaceholderEnvValue` | exported | True if value looks like a placeholder/template (empty / `<…>` / `XXX` / TODO\|FIXME\|CHANGEME / `YOUR_*_HERE` / `${VAR}` / `...` / `placeholder`); `null`/`undefined` → true; non-string truthy → false | `value` (any) | none | pure |

- **File-level notes** — All alternatives anchored `^…$` (correctly avoids `"TODO: real key"` false-positive). Non-string-but-truthy (e.g., `PORT=8080` coerced to number) returns false — intentional. The `<.*>` branch is greedy but anchored, fine. KISS-clean.

### `free-string-checks.js`

- **Purpose** — Shared free-string FIELD detectors for the Lab JSONL stores, extracted VERBATIM from `manage-proposal` + `causal-edge` stores after a control/format-char defense (the U+FEFF/BOM gap) DRIFTED and had to be patched in both copies. DETECTORS (return boolean), not throwing validators — each store composes them into its own throwing `validateFreeString`. REJECT-fail-closed over a BROADER set than `sanitize.js` (which strips for emission).
- **Imports / consumes** — nothing executable. Header documents a `kernel/_lib/sanitize.js` and `enum-validate.js` contrast but does not `require` them. Pure, no I/O, no module-load state.
- **Consumers** — `lab/causal-edge/store.js`, `lab/manage-proposal/store.js`, unit tests + the cross-store coexist test. (`enum-validate.js` appears in the grep because both are referenced together in tests, not because `free-string-checks` requires it.)
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `nonEmptyString` | exported | True iff v is a non-empty string (the upstream guard) | `v` | none | pure |
| `hasControlChars` | exported | True iff string has a control/format codepoint: C0 (≤0x1f), DEL+C1 (0x7f–0x9f), U+2028/U+2029, U+FEFF | `v` (string, PRECONDITION) | none | pure; THROWS a TypeError on non-string `v.length` (documented as caller's contract) |
| (module-export) | — | exports `{nonEmptyString, hasControlChars}` | — | — | — |

- **File-level notes** — The reject-vs-scrub contract distinction from `sanitize.js` is explicit and correct (broader set, opposite contract — folding them would silently lose the BOM/C1/line-separator defenses). The documented precondition for `hasControlChars` (caller must gate via `nonEmptyString` first) is a deliberate non-clean-boundary — defensible since it is a tight internal store helper, but it means a direct misuse throws an unprefixed TypeError rather than returning a boolean (see Findings — smell, not bug).

### `enum-validate.js`

- **Purpose** — Shared closed-enum validation with NFC/homoglyph defense, extracted VERBATIM from `lab/causal-edge/enums.js` so the causal-edge and manage-proposal stores share ONE homoglyph defense (a security validator must not be duplicated). NEUTRAL `enum-validate:` error prefix so each consumer names its own field honestly.
- **Imports / consumes** — nothing. Pure, no I/O.
- **Consumers** — `lab/causal-edge/enums.js` (re-exports this leaf, #267), `lab/causal-edge/store.js`, `lab/manage-proposal/enums.js`, `_lib/free-string-checks.js` (documentary header reference only), unit tests + cross-store test.
- **Functions**

| name | kind | purpose | consumes (params, files read) | writes | state changes / side effects |
|---|---|---|---|---|---|
| `normalizeAsciiEnum` | exported | NFC-normalize, then reject any codepoint > U+007F before membership; returns the pure-ASCII string | `v`, `fieldName` | none | pure; THROWS on non-string or non-ASCII |
| `validateEnum` | exported | `normalizeAsciiEnum` then closed-set membership via `validSet.includes(ascii)` | `v`, `validSet` (readonly), `fieldName` | none | pure; THROWS on non-ASCII or non-member |

- **File-level notes** — Order is correct: NFC normalize → reject >0x7f (catches Cyrillic/Greek lookalikes, combining sequences, ZWJ, BOM) → THEN membership. Because the >0x7f gate runs first, `validSet.includes(ascii)` is operating on a guaranteed-pure-ASCII string, so the `.includes` here is NOT the subset-laundering anti-pattern — it is exact string membership against a closed set, which is correct. Error messages embed `JSON.stringify(ascii)` and `validSet.join('|')` — fine for an internal store.

## Findings (bugs / logical fallacies / optimizations)

| severity | level | type | location (file:line) | description |
|---|---|---|---|---|
| LOW | file | smell | `safe-exec.js:34,58` | `invokeNodeJson` uses a 5000ms default timeout, `invokeNodeText` 3000ms — inconsistent defaults for two near-identical helpers. Harmless but a DRY/KISS smell; the two functions are 90% duplicated (could share a private `_invokeNode(parse, defaultTimeout)`). |
| LOW | function | security | `safe-exec.js:34,58` | The child binary is the bare string `'node'`, resolved via `PATH`. In a PATH-controlled environment this is a search-order hijack vector. In the kernel hook runtime PATH is the operator's, so the risk is residual — but worth pinning to `process.execPath` (the absolute path of the running node) for defense-in-depth, mirroring the `safe-resolve` partial-install threat model. |
| LOW | function | optimization | `network-egress-detect.js:52` | `isLoopback` returns `LOOPBACK_HOSTS.has(h)\|\|h === '::1'\|\|h.endsWith('.localhost')` — but `'::1'` is already a member of `LOOPBACK_HOSTS` (line 42), so the `\|\|h === '::1'` sub-clause is dead/redundant. Cosmetic; remove the redundant disjunct. |
| LOW | function | smell | `network-egress-detect.js:42,49` | `0.0.0.0` is classified as loopback/always-allowed. As an egress *destination* `0.0.0.0` is not loopback (it is the unspecified/wildcard address); allowlisting it is semantically loose. Immaterial for a non-gating advisory, but the comment calls the Set "loopback" which is not strictly true for `0.0.0.0`. |
| LOW | file | smell (dead code) | `sanitize.js:82-97` | `prepareForJsonl` is exported but I found no production caller (only `sanitizeForJsonl` is used live by `spawn-record.js`). Its identity-fallback (`(s) => s`, line 93) is doubly-dead: post-PR-1-phase-4 `scrubSecrets` is always top-level, so the fallback branch is unreachable. Harmless but YAGNI/dead-code; either wire a consumer or note it as a public-API-for-future. |
| INFO | file | smell | `secret-patterns.js:35-75` | `CANONICAL_SECRET_CLASS_DEFS` is `Object.freeze`d at the array level only; the nested `{id,source,flags,description}` objects are NOT individually frozen, so `DEFS[0].source = 'evil'` would mutate shared module state read by every `getCanonicalSecretClasses()` call. The const is module-private and never exported, so this is a theoretical surface, not an exploitable path — but it is the exact shallow-`Object.freeze`-leaves-nested-mutable pattern this repo has been bitten by. A deep-freeze (or `Object.freeze` per entry) closes it cheaply. |
| INFO | function | smell | `free-string-checks.js:44-50` | `hasControlChars` documents (and relies on) a PRECONDITION that the caller gated `v` via `nonEmptyString` first; a direct non-string call throws an unprefixed `TypeError` on `v.length` rather than returning a boolean or a clean boundary error. Deliberate per the header, but it is a non-clean boundary for a shared kernel `_lib` export — a defensive `if (typeof v !== 'string') return false` would make it total without changing any correct caller. |
| INFO | function | optimization | `path-canonicalize.js:62-75` | The `canonicalize` ancestor-walk re-runs `fs.realpathSync` once per non-existent component while walking up (one syscall per level). For a deep not-yet-existing path this is O(depth) syscalls; acceptable given PATH\_MAX bounds and that the hot consumers (`fact-force-gate`, K9/K14) operate on shallow worktree-relative paths. Noted as an optimization opportunity, not a defect. |
| INFO | file | logical-fallacy (none — verified) | `enum-validate.js:51`; `network-egress-detect.js:169` | Audited the two `.includes`/`.some` membership checks against the repo's "exact-set vs subset" anti-pattern: NEITHER is an authorization-laundering subset check. `validateEnum`'s `validSet.includes(ascii)` is exact string membership against a closed set (ASCII-guaranteed by the preceding >0x7f reject). `isAllowlisted`'s `allowlist.some(...)` with the `.`-prefixed `endsWith` is a correct subdomain-coverage test, not a superset-tolerant approval. Recorded as a deliberately-verified non-finding. |
| INFO | file | smell (mock-vs-real) | `network-egress-detect.js` (whole) / `secret-patterns.js` (whole) | Both modules are pure and unit-tested, but the header text honestly concedes the coarse-net / advisory framing — i.e. a green unit suite proves the regexes match the FIXTURE strings, not that real-world obfuscated egress or a future token-format change is caught. This is correctly documented (not a hidden bug), but is the canonical mock-green ≠ real-path posture worth flagging: the secret scrubber and egress audit are defense-in-depth, never primary controls. |

