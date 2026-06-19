# Kernel validators (PreToolUse/PostToolUse schema gates) — `packages/kernel/validators/`

> These eight scripts are the **enforced** edge of the substrate. They are wired into `packages/kernel/hooks.json` as `PreToolUse` / `PostToolUse` `command` hooks that the Claude Code harness runs on every `Edit` / `Write` / `Bash` tool call. Per ADR-0001, hooks fail **open** with observability (a crash or parse error returns `decision: 'approve'`) — the lone deliberate exception is `validate-no-bare-secrets.js`, which fails **closed** because it is a security gate. The cluster splits into two roles: **deterministic write-time gates** (frontmatter, dup-key, secret, kb-doc, adr-drift, config-redirect, plan-schema) that read tool-input JSON from stdin and emit a `{decision}` envelope or a forcing-instruction, and one **verdict engine** (`contract-verifier.js`) that is a CLI (not a hook) invoked by the runtime/orchestration layer to grade an agent's output against a persona contract and feed the self-learning loop. Everything here is kernel-tier (enforced), but the gates' philosophy is mostly *advisory forcing-instruction* (Class 1, emit-and-approve) with a few *hard blocks* (Class 2: secrets, missing/dup frontmatter on `HT-state.md`, kb-doc Component-A frontmatter violations).

## Directory contents & nesting

All eight files sit flat in `packages/kernel/validators/` (no nested `_lib/` or `_spike/` under this folder; shared helpers live one level up in `packages/kernel/_lib/`).

| File | Hook wiring (`hooks.json`) | One-line purpose |
|---|---|---|
| `contract-verifier.js` | none (CLI; invoked by runtime orchestration) | Grades agent output vs a persona contract → JSON verdict + fires `pattern-recorder.js` |
| `validate-adr-drift.js` | `PreToolUse:Edit\|Write` | Advisory `[ADR-DRIFT-CHECK]` when the edited file is in an active ADR's `files_affected` |
| `validate-config-redirect.js` | `PreToolUse:Bash` | WARN (or `STRICT_CONFIG_GUARD=1` block) when a Bash redirect/`tee` targets a protected config path |
| `validate-frontmatter-on-skills.js` | `PreToolUse:Edit\|Write` | HARD-block a `skills/library/**` doc write/edit that lacks YAML frontmatter |
| `validate-kb-doc.js` | `PreToolUse:Edit\|Write` | `kb/architecture/**` authoring gate — Component A HARD-block + Component B advisory `[KB-DOC-INCOMPLETE]` |
| `validate-no-bare-secrets.js` | `PreToolUse:Edit\|Write` | HARD-block (fail-closed) any write/edit whose post-edit content contains a secret-shaped literal |
| `validate-plan-schema.js` | `PostToolUse:Edit\|Write` | Advisory `[PLAN-SCHEMA-DRIFT]` when a `.claude/plans/*.md` file misses canonical tiered sections |
| `validate-yaml-frontmatter.js` | `PreToolUse:Edit\|Write` | HARD-block a write/edit that introduces a duplicate top-level YAML key in `HT-state.md` |

Shared dependencies (all in `packages/kernel/_lib/`): `frontmatter.js` (`parseFrontmatter`, `_extractIdentityFromRaw`), `safe-exec.js` (`invokeNodeJson`), `secret-patterns.js` (`getCanonicalSecretClasses`), `toolkit-root.js` (`findToolkitRoot`), `synthid.js` (`validateSuffix`, `parseSynthId`), and `../hooks/_lib/_log.js` (`log`).

## Per-file analysis

### `contract-verifier.js`

- **Purpose** — A CLI verdict engine: reads a persona `contract.json` + an agent `output.md`, runs the contract's declared `functional` and `antiPattern` checks against the output body, computes a `pass`/`partial`/`fail` verdict, prints the result as JSON on stdout, and (unless `--no-record`) fires `pattern-recorder.js` detached to feed the self-learning reputation loop. It is the only non-hook file in the cluster.
- **Imports / consumes** — `fs`, `path`, `child_process.spawn`; `../_lib/frontmatter` (`parseFrontmatter`); `../_lib/synthid` (`validateSuffix`, `parseSynthId`); `../_lib/toolkit-root` (`findToolkitRoot`, lazily); attempts `./identity/lifecycle-spawn` (`_readPersonaMd`) — **this path does not resolve** (see findings). Reads CLI args `--contract`, `--output`, `--previous-run`, `--transcript`, `--skills`, `--identity`, `--skip-checks`, `--no-record`. Reads files: the contract JSON, the output MD, prior-run `.md` files, the transcript JSONL, `.claude-plugin/plugin.json` (version), and the persona `.md` (intended, but dead — see findings).
- **Consumers** — Invoked by the runtime orchestration / chaos-test flow (referenced from `packages/specs/research/orchestrator.md`, `super-agent.md`, and the bench scenarios). `synthid.js` documents being "wired into contract-verifier.js". No `.js` module `require`s it (it is spawned as a CLI). Tests: `tests/unit/scripts/format-spec-hint.test.js`, `no-unrolled-loops-threshold.test.js`, `yaml-identity-quoting.test.js`, `tests/unit/agent-team/synthid.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `_readPluginVersion` | internal | Read plugin `version` (fallback `0.0.0`) | `findToolkitRoot()`, `.claude-plugin/plugin.json` | — | none (pure read) |
| `parseArgs` | internal | Parse `--k v` / `--flag` argv | `argv` | — | none |
| `countFindings` | internal | Count `###`/`* **` items under severity H2 buckets | `text` (output body) | — | none |
| `detectOrphanSeverityH3s` | internal | Find severity-shaped H3s outside a matching H2 bucket | `text` | — | none |
| `countFileCitations` | internal | Count `file.ext:NN` / `**File**:` / backtick-path citations | `text` | — | none |
| `extractSkillsFromTranscript` | internal | Set of `Skill` tool names invoked in a transcript | reads `transcriptPath` JSONL | — | reads file |
| `extractKbReadsFromTranscript` | internal | Provenance-gated set of `kb:` reads from a transcript (pairs `tool_use`↔`tool_result`, rejects shell-evasion/error/`..`) | reads `transcriptPath` JSONL | — | reads file |
| `jaccard` | internal | Word-set Jaccard similarity of two strings | `a`, `b` | — | none |
| `functionalChecks.*` (13 closures) | internal table | Per-check functional validators (`outputContainsFrontmatter`, `frontmatterHasFields`, `minFindings`, `hasFileCitations`, `hasSeveritySections`, `outputLengthMin/Max`, `containsKeywords`, `noUnrolledLoops`, `noExcessiveNesting`, `noEmptyChallengeSection`, `invokesRequiredSkills`, `kb_scope_consumed`) | `cArgs`, module-scope `body`/`frontmatter`/`contract`/`args`; some read `transcriptPath` | — | most pure; transcript-reading ones read files |
| `antiPatternChecks.*` (8 closures) | internal table | Per-check anti-pattern validators (`noTextSimilarityToPriorRun`, `noTemplateRepetition`, `claimsHaveEvidence`, `noPaddingPhrases`, `noCritiqueLanguage`, `acknowledgesFallback`, `noDuplicateFindingIds`) | `cArgs`, module-scope `body`/`args`; prior-run one reads dir | — | prior-run check reads `.md` files |
| `shouldSkip` | internal | Whether a check is skipped per `--skip-checks` (honors `mustNotSkip`) | `check`, `skipSet` | — | none |
| (top-level body) | cli-entry | Drives the whole flow: dispatch checks, compute verdict, print JSON, spawn recorder, exit | all of the above | **stdout** JSON result; **stderr** drift-notes; **spawns** `pattern-recorder.js` (detached) | `process.exit(verdict==='fail'?1:0)`; fires async subprocess that writes the pattern store |

- **File-level notes** — 829 lines (just over the 800-line file ceiling). `Object.create(null)` for both check tables is a deliberate prototype-pollution guard (a contract `check: "constructor"` cannot resolve to an inherited truthy function). The `--skip-checks` backdoor is gated by `mustNotSkip`. Verdict logic: `pass` only when zero functional failures + zero antiPattern failures + zero antiPattern warns; `partial` when warns only; `fail` otherwise. The exit code is `1` only on `fail` — `partial` exits `0`, so a caller keying off exit code alone treats a warn-bearing output as clean. The recorder is fire-and-forget (`spawn ... detached`, `unref()`), printed JSON precedes it, so a recorder failure never blocks the verdict (by design) — but it is also unobservable.

### `validate-adr-drift.js`

- **Purpose** — `PreToolUse:Edit|Write` advisory gate. When the file being edited appears in an active ADR's `files_affected` list, emits an `[ADR-DRIFT-CHECK]` forcing instruction in the `reason` field while still approving the edit. Class 1 (advisory) — never blocks.
- **Imports / consumes** — `fs`, `path`; `../hooks/_lib/_log.js` (`log`); `../_lib/toolkit-root.js` (`findToolkitRoot`); `../_lib/safe-exec` (`invokeNodeJson`). Env: `SKIP_ADR_CHECK`, `HETS_ADRS_DIR`. Reads stdin tool-input JSON; invokes `packages/runtime/orchestration/adr.js touched-by <file>` as a subprocess (via `invokeNodeJson`, no shell).
- **Consumers** — `hooks.json` `PreToolUse:Edit|Write`. Documented in `docs/hooks/overview.md`, `docs/hooks/README.md`. No direct unit test was found under `tests/unit/` for this validator (its sibling `context-envelope.test.js` only references it indirectly).
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `buildForcingInstruction` | internal | Compose the `[ADR-DRIFT-CHECK]` text from matched ADRs | `filePath`, `matchedAdrs` | — | none |
| `getAdrsTouchingFile` | internal | Get ADRs whose `files_affected` includes the file | `filePath`, `ADRS_DIR`, invokes `adr.js` | — | spawns `adr.js` subprocess (read-only) |
| stdin `'end'` handler | hook-entry | Parse stdin, decide approve + optional forcing-instruction | stdin JSON, the two functions above | **stdout** `{decision:'approve'[,reason]}` | logs via `logger`; never blocks; fail-open on error |

- **File-level notes** — Single source of truth for ADR matching is delegated to `adr.js` (the inline fallback at the bottom of `getAdrsTouchingFile` is an empty `return []` — i.e., if `adr.js` is missing the gate silently surfaces nothing). The H.8.4 RCE fix replaced an `execSync(string)` build with `invokeNodeJson` (execFileSync arg-array, no shell) — file paths from stdin can no longer inject. Fail-open per ADR-0001.

### `validate-config-redirect.js`

- **Purpose** — `PreToolUse:Bash` gate that plugs the capability gap left by the Write-only `config-guard.js`: a Bash `>` / `>>` / `tee` that writes a protected config file. Default WARN-not-block (large false-positive surface for Bash); `STRICT_CONFIG_GUARD=1` escalates to block.
- **Imports / consumes** — `fs`, `path`; `../hooks/_lib/_log.js` (`log`). Env: `STRICT_CONFIG_GUARD`. Reads stdin tool-input JSON; reads `config-guard-patterns.json` from one of two candidate paths (falls back to `FALLBACK_PATTERNS`).
- **Consumers** — `hooks.json` `PreToolUse:Bash`. Test: `tests/unit/hooks/validate-config-redirect.test.js`. Design anchor: `kb:design-pushback/syntactic-gate-extension-for-tool-bypass`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `loadPatterns` | internal | Load + compile protected-path regexes (with `\s`-anchored prefix) | `config-guard-patterns.json` candidates | — | reads file; logs `bad_pattern` on bad regex |
| `extractRedirectTargets` | internal | Pull path tokens after `>`/`>>`/`tee` | `command` string | — | none |
| stdin `'end'` handler | hook-entry | Approve / WARN / (strict) block on protected redirect targets | stdin JSON, the two functions above | **stdout** `{decision}`; **stderr** WARN text | logs; default never blocks |

- **File-level notes** — Self-aware design-pushback case (the header acknowledges syntactic command-line parsing is fragile theater). `extractRedirectTargets` is explicitly non-exhaustive: heredocs to a file, process substitution, `dd`, and `cp`/`mv`/`install` are not covered. It matches the bare path *token* and tests it against the pattern — so `> ../../etc/tsconfig.json` is caught by token shape, but the gate has no traversal/canonicalization concept (it is a string match, not a path check). Fail-open on error.

### `validate-frontmatter-on-skills.js`

- **Purpose** — `PreToolUse:Edit|Write` HARD-block: a write/edit to a `skills/library/<skill>/**/*.md` doc that would leave the file without YAML frontmatter is blocked, because the skill loader silently drops frontmatter-less skills.
- **Imports / consumes** — `fs`, `path`; `../hooks/_lib/_log.js` (`log`). Reads stdin tool-input JSON; for `Edit`, reads the existing file from disk and simulates the edit.
- **Consumers** — `hooks.json` `PreToolUse:Edit|Write`. Documented in `docs/hooks/{overview,README}.md`. The `applyEdit` helper is the shared pattern mirrored across this file, `validate-kb-doc.js`, and `validate-yaml-frontmatter.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `requiresFrontmatter` | internal | Path-scope decision (`path.posix.normalize` first; SKIP basenames/paths/dirs) | `filePath` | — | none |
| `hasFrontmatter` | internal | True if content has a non-empty `---`-delimited block (BOM-stripped) | `content` | — | none |
| `applyEdit` | internal | Simulate the post-edit content (`replace_all` split+join; `$`-sanitized single replace) | `existing`, `toolInput` | — | none |
| stdin `'end'` handler | hook-entry | Approve out-of-scope / MultiEdit / FM-present; block FM-missing | stdin JSON; reads existing file for Edit | **stdout** `{decision}` (+ block `reason`) | logs; reads file for Edit; fail-open on error |

- **File-level notes** — C1 (VALIDATE-hacker) fix: `path.posix.normalize` before regex match closes the `skills/library//x` and `a/../b` dodge — the same `#215` path-canonicalize discipline applied to a string gate. MultiEdit (`toolInput.edits[]`) is approved un-checked (acknowledged gap; preserves fail-soft). `applyEdit` correctly sanitizes `$`-patterns (`$$$$`) — this is the reference implementation the secrets validator does **not** mirror (see findings).

### `validate-kb-doc.js`

- **Purpose** — `PreToolUse:Edit|Write` gate for `kb/architecture/**.md` docs. Component A = HARD-block on objective frontmatter violations (`kb_id` matches path, `version: 1`, `tags` ≥3, `sources_consulted` ≥2). Component B = SOFT-advisory `[KB-DOC-INCOMPLETE]` forcing instruction for missing recommended sections (alias-tolerant).
- **Imports / consumes** — `fs`; `../hooks/_lib/_log.js` (`log`); `../_lib/frontmatter.js` (`parseFrontmatter`). Env: `SKIP_KB_DOC_CHECK`. Reads stdin tool-input JSON; for `Edit`, reads existing file + simulates edit.
- **Consumers** — `hooks.json` `PreToolUse:Edit|Write`. Documented in `docs/hooks/overview.md`, `docs/hooks/README.md`, and the `kb-gaps-single-lens` plan.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `deriveExpectedKbId` | internal | `architecture/<sub>/<doc>` from a kb path | `filePath` | — | none |
| `hasH2Section` | internal | Fence-aware exact `## Name` presence (memoized regex) | `body`, `sectionName`, `_sectionRegexCache` | — | populates module-level regex cache |
| `hasH2SectionPrefix` | internal | Fence-aware `## <prefix>...` presence (memoized) | `body`, `prefix`, `_sectionPrefixRegexCache` | — | populates module-level cache |
| `checkHardBlockFrontmatter` | internal | Component A violations array | `frontmatter`, `filePath`, `HARD_BLOCK_BOUNDS` | — | none |
| `checkSoftAdvisorySections` | internal | Component B missing-concern array (alias/prefix/`related:` fallback) | `body`, `frontmatter`, `SOFT_ADVISORY_SECTIONS` | — | none |
| `checkKbDocDiscipline` | internal | Full discipline state (FM present, missing fields/sections, hard-block + advisory) | `content`, `filePath`, `parseFrontmatter` | — | none |
| `buildHardBlockReason` | internal | `[KB-DOC-INVALID]` block text | `filePath`, `violations` | — | none |
| `buildForcingInstruction` | internal | `[KB-DOC-INCOMPLETE]` advisory text | `filePath`, `discipline` | — | none |
| `applyEdit` | internal | Simulate post-edit content (`$`-sanitized) | `existing`, `toolInput` | — | none |
| stdin `'end'` handler | hook-entry | Approve out-of-scope/MultiEdit; HARD-block Component A; advisory Component B | stdin JSON; reads existing file for Edit | **stdout** `{decision}` (+ reason) | logs; reads file for Edit; fail-open |

- **File-level notes** — Component A correctly enforces **strict type** on `version` (rejects quoted `"1"` because `parseFrontmatter` coerces unquoted ints to number) — a coupling with `frontmatter.js` numeric coercion that the comment flags as load-bearing (without it, all docs would HARD-block). `kb_id`-matches-path uses post-edit content. `applyEdit` is the `$`-sanitized reference shape. 586 lines; `buildForcingInstruction` is long (~85 lines, mostly a literal template array — exceeds the 50-line function guideline but is data, not logic).

### `validate-no-bare-secrets.js`

- **Purpose** — `PreToolUse:Edit|Write` HARD-block: scans the post-edit content for secret-shaped literals (Anthropic/Stripe/Slack/GitHub/GitLab/Google/AWS/JWT/PEM + a generic `*_KEY=` assignment) and blocks the write. **Fail-closed**: a parse error blocks (unlike every other gate here). Never echoes the matched literal — only id + offset.
- **Imports / consumes** — `fs`; `../hooks/_lib/_log.js` (`log`); `../_lib/secret-patterns.js` (`getCanonicalSecretClasses`). Reads stdin tool-input JSON; for `Edit`/MultiEdit reads the existing file (capped at `MAX_EDIT_SCAN_BYTES` = 2 MB) and applies edits to build the post-image.
- **Consumers** — `hooks.json` `PreToolUse:Edit|Write`. Exports `{ scanContent, SECRET_PATTERNS }` (guarded by `require.main === module`) for: `tests/unit/hooks/validate-no-bare-secrets.test.js`, `tests/unit/kernel/_lib/secret-patterns-crosstest.test.js`, `tests/unit/kernel/validators/secrets-readcap.test.js`, `tests/unit/kernel/spawn-state/spawn-record.test.js`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `shouldSkipPath` | internal | Whether a path is a test-fixture/`.env.example` skip | `filePath`, `SKIP_PATH_PATTERNS` | — | none |
| `isPlaceholder` | internal | Whether a matched value is a known placeholder shape | `value`, `PLACEHOLDER_VALUES` | — | none |
| `_findFencedBlocks` | internal | `[start,end]` ranges of fenced code blocks | `content` | — | none |
| `_isOffsetInRanges` | internal | Offset-in-range test | `offset`, `ranges` | — | none |
| `_isMarkdownPath` | internal | `.md/.mdx/.markdown` test | `filePath` | — | none |
| `scanContent` | exported | Run all patterns, suppress placeholders + (md-only) fenced literal-assignment | `content`, `filePath`, `SECRET_PATTERNS` | — | resets each pattern's `lastIndex`; pure |
| stdin `'end'` handler (`require.main`) | hook-entry | Build scan text per tool variant; block on findings; fail-closed on parse error | stdin JSON; reads/size-checks existing file for Edit | **stdout** `{decision}` (+ id/offset reason) | logs; reads file; **fail-CLOSED** on error |

- **File-level notes** — The factory `getCanonicalSecretClasses()` is called once so this module owns fresh `RegExp` instances (no shared `lastIndex` bleed with the scrubber's copy) — `scanContent` further resets `lastIndex = 0` per pattern per call, so re-entrant calls are safe. Order is load-bearing: canonical `sk-ant-` is spread before validator-only `openai sk-(proj-)?` so the reported id is the more specific one. The 2 MB cap is a deliberate bounded-memory policy that the comment honestly labels a narrow gap (a >2 MB edit target with a pre-existing secret outside the edit region is not caught — only the `new_string` delta is). The Edit/MultiEdit apply path does **not** `$`-sanitize (see findings).

### `validate-plan-schema.js`

- **Purpose** — `PostToolUse:Edit|Write` advisory gate for `.claude/plans/*.md`. Computes missing tiered sections (Tier 1 mandatory; Tier 2 conditional on new-style plan; Tier 3 aspirational; conditional Principle Audit + Pre-Approval Verification for HETS/route-recommended plans) and emits a `[PLAN-SCHEMA-DRIFT]` forcing instruction to stdout. PostToolUse can't block (the write already happened) — purely informational.
- **Imports / consumes** — `../hooks/_lib/_log.js` (`log`). Env: `CLAUDE_PLAN_DIR`. Reads stdin tool-input JSON only (no disk reads — the multi-edit limitation is inherited).
- **Consumers** — `hooks.json` `PostToolUse:Edit|Write`. Bench scenario `04-hets-routed-plan`. Documented in `docs/hooks/{overview,README}.md`, `packages/specs/research/plan-template.md`.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `hasH2Heading` | internal | H2 heading present (memoized; optional parenthetical) | `content`, `sectionName`, `_sectionRegexCache` | — | populates module cache |
| `isPlanPath` | internal | Whether a path is a plan file (`.claude/plans/` or `$CLAUDE_PLAN_DIR/*.md`) | `filePath`, `CUSTOM_PLAN_DIR` | — | none |
| `isNewStylePlan` | internal | `"Routing Decision"` appears anywhere | `content` | — | none |
| `requiresPrincipleAudit` | internal | Whether the plan needs Principle Audit + Pre-Approval Verification | `content` | — | none |
| `checkTiers` | internal | Per-tier missing-section lists | `content`, the four predicates above | — | none |
| `buildForcingInstruction` | internal | `[PLAN-SCHEMA-DRIFT]` text | `filePath`, `missing` | — | none |
| stdin `'end'` handler | hook-entry | Emit Tier-3 stderr; emit Tier-1/2 forcing instruction on stdout | stdin JSON, the functions above | **stdout** forcing instruction (no `decision`); **stderr** Tier-3 note | logs; never blocks (PostToolUse); fail-open |

- **File-level notes** — Migration H.7.17 moved the gate from PreToolUse to PostToolUse (the original intent) after `claude-code-guide` confirmed `PostToolUse:Write` is supported — codifying the "absence-in-our-codebase ≠ unsupported" lesson in the workflow rules. The content source for Edit is only `tool_input.new_string` (single edit) — a multi-edit or a partial edit that doesn't include the section headings will mis-report (acknowledged limitation; PostToolUse can't read the resulting file here). `isPlanPath`'s `startsWith(CUSTOM_PLAN_DIR + '/')` correctly avoids the `plans` vs `plans-evil` prefix collision (the trailing slash is required).

### `validate-yaml-frontmatter.js`

- **Purpose** — `PreToolUse:Edit|Write` HARD-block: a write/edit to `swarm/thoughts/shared/HT-state.md` that introduces a duplicate top-level YAML frontmatter key (or removes/corrupts the frontmatter delimiters entirely) is blocked. Closes a 5-recurrence cutover-edit-time YAML violation (drift-note 80).
- **Imports / consumes** — `fs`; `../hooks/_lib/_log.js` (`log`). Reads stdin tool-input JSON; for `Edit`, reads existing file + simulates edit.
- **Consumers** — `hooks.json` `PreToolUse:Edit|Write`. `frontmatter.js` references this file's H.5.3 BOM-strip as precedent; this file's `applyEdit` is mirrored in the two sister frontmatter validators.
- **Functions**

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `requiresDupKeyCheck` | internal | Path-scope decision (only `HT-state.md`) | `filePath`, `REQUIRES_DUP_KEY_CHECK` | — | none |
| `extractFrontmatter` | internal | Return text between first `---` and the next `^---$` (BOM-stripped) | `content` | — | none |
| `findDuplicateTopLevelKeys` | internal | Column-0 identifier-keys; first vs duplicate line numbers | `frontmatter` | — | none |
| `applyEdit` | internal | Simulate post-edit content (`$`-sanitized) | `existing`, `toolInput` | — | none |
| stdin `'end'` handler | hook-entry | Approve out-of-scope/MultiEdit; block missing-FM or dup-key | stdin JSON; reads existing file for Edit | **stdout** `{decision}` (+ block reason) | logs; reads file for Edit; fail-open on parse error |

- **File-level notes** — Tightly path-scoped to one file by design (the comment notes adding entries requires an ADR amendment per ADR-0006). Documented gaps: Unicode keys, hyphen/quoted keys, and `|`/`>` block scalars are out of scope (the `^---$` close-detector would mis-bound a frontmatter containing a zero-indented `---` inside a block scalar — not possible in `HT-state.md`'s flow-scalar authoring). `applyEdit` is `$`-sanitized (reference shape).

## Findings (bugs / logical fallacies / optimizations)

| severity | level | type | location | description |
|---|---|---|---|---|
| HIGH | function | bug | `contract-verifier.js:766` | `require('./identity/lifecycle-spawn')` resolves relative to `packages/kernel/validators/`, but the module actually lives at `packages/runtime/orchestration/identity/lifecycle-spawn.js`. The require **always** throws `MODULE_NOT_FOUND` (confirmed by probe); the `catch` returns `null`, so `_agentMd` is permanently `null`. The comment at lines 762-763 ("persona .md changes now participate in drift detection") is **not true in the code** — the Phase-0 kernel-side move broke the sibling-relative path and `validateSuffix` never sees `agentMd`. Premise-not-probed + comment-contradicts-code. |
| MEDIUM | function | bug | `validate-no-bare-secrets.js:323,333` | The Edit/MultiEdit post-image is built with raw `result.replace(oldStr, newStr)` (no `$`-pattern sanitization). A `new_string` containing `$&` / `` $` `` / `$1` makes the validator's reconstructed scan text **diverge** from what is actually written to disk. The three sibling frontmatter validators all fixed exactly this via an `applyEdit` helper that escapes `$$$$`; this security gate (the most important one) did not adopt it, despite the header claiming it "mirrors H.7.20 read-file + apply-edit". A crafted `new_string` could shrink/alter the post-image so a real secret in the true result is not scanned. |
| LOW | function | smell | `contract-verifier.js:667` | antiPattern dispatch uses `typeof ret === 'object'` without the `&& ret !== null` guard that the functional path uses (line 633). No current antiPattern check returns `null`, but a future one would hit `null.pass` (TypeError), caught by the surrounding `try` and recorded as `status:'error'` — and the antiPattern error path increments **no** failure counter, so the check silently vanishes from the verdict. Asymmetry with the functional path; latent fail-open. |
| LOW | file | smell | `contract-verifier.js:1` | File is 829 lines — over the documented 800-line file ceiling (CLAUDE fundamentals). The two check tables plus the recorder block could be extracted into `_lib/` modules. |
| LOW | function | bug | `validate-adr-drift.js:104-106` | The "inline fallback" advertised in the `getAdrsTouchingFile` docstring ("Falls back to inline filesystem scanning if the CLI is unavailable") is a no-op `return []`. When `adr.js` is missing or its invocation fails, the gate silently surfaces zero ADRs — the comment overstates the implemented behavior (dead/unimplemented fallback). |
| LOW | function | optimization | `validate-config-redirect.js:90-100` | `extractRedirectTargets` matches only `>`/`>>`/`tee`; heredocs-to-file, `dd of=`, `cp`/`mv`/`install`, and process substitution bypass the gate. The header documents this as intentional ("high-signal warn coverage, not exhaustive enforcement"), so it is an accepted limitation rather than a defect — but `dd of=`/`cp` are common enough config-write vectors to consider adding. |
| LOW | function | smell | `validate-config-redirect.js:120` | The gate tests the bare path *token* against config-name patterns with no canonicalization, so it cannot distinguish a redirect to a legitimate `/tmp/tsconfig.json` fixture from the protected project file — pure name-shape matching. Acceptable for a WARN default, but `STRICT_CONFIG_GUARD=1` would block on the false-positive token, which is the documented friction. |
| INFO | function | smell | `contract-verifier.js:829` | Exit code is `1` only on `fail`; `partial` (antiPattern warns present) exits `0`. A CI/orchestration caller that gates on exit code alone treats a warn-bearing output as clean. The richer signal is in the JSON `verdict`/`recommendation`, so any caller must parse stdout, not rely on the exit code. |
| INFO | function | optimization | `validate-no-bare-secrets.js:306` | The 2 MB `MAX_EDIT_SCAN_BYTES` cap means a >2 MB edit target falls back to a `new_string`-only scan, skipping a pre-existing secret outside the edit region. Honestly documented as a bounded-memory-vs-coverage tradeoff in the cooperative threat model; noted for completeness. |
| INFO | function | smell | `validate-plan-schema.js:299` | For `Edit`, content is taken from `tool_input.new_string` only (no post-write file read). A partial edit that does not include the section headings, or a MultiEdit, will mis-report missing sections. Acknowledged limitation carried over from the PreToolUse implementation; advisory-only so impact is a spurious nudge, not a block. |
| INFO | file | smell | `validate-kb-doc.js:367-451` | `buildForcingInstruction` is ~85 lines, over the 50-line function guideline — though it is almost entirely a literal template-text array (data, not branching logic), so the readability cost is low. |
| INFO | substrate | smell | `validate-frontmatter-on-skills.js`, `validate-kb-doc.js`, `validate-yaml-frontmatter.js`, `validate-no-bare-secrets.js` | Four copies of an `applyEdit` (replace_all split+join; first-occurrence `$`-sanitized) helper exist across the cluster. Three are identical and correct; the secrets validator hand-rolls a fourth that omits the `$`-sanitization (the MEDIUM bug above). A single shared `_lib/apply-edit.js` would close the DRY gap and remove the divergence vector entirely. |

