# Kernel spawn-state: integrator, resolver, staging — `packages/kernel/spawn-state/`

> This cluster is the **kernel** (enforced-or-shadow) layer that observes Agent/Task
> spawns at close and decides the fate of the delta each spawn produced. It is the
> deepest, highest-stakes substrate: it writes real git refs and content-addressed
> provenance records. Per the toolkit's "merges are the user's gate" doctrine the
> highest-stakes ref writes (the ordered integrator) are human-triggered via a CLI and
> are NOT wired into any hook, while the close-path producers (`spawn-record.js`,
> `stage-candidate.js`, `stage-promote.js`, the shadow resolver) are wired but stay in
> SHADOW (default OFF) behind `LOOM_*` flags. Two files in this directory
> (`prompt-pattern-store.js`, `self-improve-store.js`) are unrelated best-effort
> self-improvement CLIs that happen to live here for historical layout reasons — they
> touch `~/.claude/*.json` stores, never git, and are not part of the spawn-delta arc.

## Directory contents & nesting

All ten files live flat in `packages/kernel/spawn-state/` (no nested `_lib/` or
`_spike/` here; shared kernel primitives live one level up in `../_lib/` and
`../enforcement/`). One intra-folder shared helper is name-prefixed `_` by convention.

| File | Role | One-line purpose |
|---|---|---|
| `integrator.js` | ordered integrator (lib) | Stack hidden `refs/loom/candidates/*` deltas onto `loom/integration` in declared order, conflict→quarantine, one terminal CAS; optional provenance + reject-event minting. |
| `integrate-cli.js` | composition root (cli) | Thin argv parser binding real git/lock concretions to `integrateCandidates`; the ONLY invocation surface (no hook). |
| `post-spawn-resolver.js` | resolver (lib) | Decide a closing spawn's terminal action via the frozen `RESOLVER_TABLE` (INV-20 → K14 scope → K9 promote → K13 release). |
| `stage-candidate.js` | candidate producer (lib) | Close-path: materialize delta → genesis record → pin `refs/loom/candidates/<safeId>` (gated `LOOM_STAGE_CANDIDATES`). |
| `stage-promote.js` | enforcing quarantine (lib) | Close-path: materialize → throwaway staging worktree on `loom-promote/<safeId>` → real `resolve()` → keep-or-discard (gated `LOOM_RESOLVER_ENFORCE`). |
| `spawn-record.js` | `PostToolUse:Agent\|Task` hook | Capture a bounded, secret-scrubbed spawn-record envelope per spawn close to `~/.claude/spawn-state/<run_id>/`. |
| `recovery-sweep.js` | crash-recovery (lib) | Reclassify orphan PENDING WAL records to ABORTED under the K13 lock (TOCTOU-closed). |
| `prompt-pattern-store.js` | self-improve CLI | Persist/look-up prompt-enrichment patterns in `~/.claude/prompt-patterns.json`. |
| `self-improve-store.js` | self-improve CLI + lib | Counter + pending-queue store backing the auto self-improve loop. |
| `_stage-helpers.js` | shared helper (lib) | The 4 byte-identical close-path helpers extracted from the two stagers (DRY). |

## Per-file analysis

### `integrator.js`

- **Purpose** — The ordered integrator: reads the producer-pinned hidden
  `refs/loom/candidates/*` refs, stacks each candidate's delta onto a disposable
  `loom/integration` branch in declared order, quarantines conflicts to durable
  `loom-promote/<safeId>` branches, publishes via ONE terminal CAS, and (optionally,
  when `runId`+`stateDir` are supplied) mints chained provenance records + content-
  addressed reject-events. Never touches the user's checked-out HEAD/working tree
  (all fold work is out-of-tree `merge-tree`/`commit-tree` plumbing). `integrateCandidates`
  never throws (one outer try/catch; every exit returns the same run-report shape).
- **Imports / consumes** — `../_lib/invoke-git.js` (`runGitDefault`), `../_lib/lock.js`
  (`acquireLock`/`releaseLock`), `../_lib/integrate-merge.js`
  (`mergeTreeWriteTree`/`commitMergedTree`/`casAdvanceRef`/`GIT_SHA_RE`),
  `../_lib/quarantine-promote.js` (`sanitizeAgentId`), `../_lib/transaction-record.js`
  (`computePostStateHash`), `../_lib/integration-record.js` (`buildChainedRecord`),
  `../_lib/record-store.js` (`appendRecord`/`readByPostStateHash`),
  `../_lib/k9-promote-deltas.js` (`checkEvidenceLinkPreCommit`),
  `../_lib/reject-event-store.js` (`buildRejectEvent`/`appendRejectEvent`). Reads git
  refs (`refs/loom/candidates/*`, `refs/heads/loom/integration`, `loom-promote/*`).
- **Consumers** — `integrate-cli.js` (the production composition root);
  `tests/unit/kernel/spawn-state/integrator.test.js`,
  `integrator-reject-ledger.test.js`, `tests/unit/kernel/integration/full-kernel-loop.test.js`.
  No hook wires it (human-gated by design).

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `report` | internal | Build a complete immutable run-report from a partial field set. | `fields` | — | none (pure; new object). |
| `validateOrderedIds` | internal | Validate + dedup declared ids pre-lock; refuse empty/non-string/sanitize-to-empty; dedup post-sanitize duplicates to first occurrence. | `orderedIds` | — | none (pure). |
| `refuseIfIntegrationIsHead` | internal | Hazard guard: refuse if `loom/integration` is the checked-out HEAD; detached HEAD → proceed; ambiguous git error → fail closed. | `integrationRef`, `runGit` | — | runs `git symbolic-ref HEAD` (read). |
| `resolveOrderedCandidates` | internal | Resolve each id to its pinned `delta_sha` inside the lock; absent ref → skipped. | `ids`, `runGit` | — | runs `git rev-parse` per id (read). |
| `deriveMergeBase` | exported | DYNAMIC 3-way merge-base via `git merge-base --all`; 0 bases→`none`, >1→`ambiguous`. | `{runGit, ours, theirs}` | — | runs `git merge-base --all` (read). |
| `stackOneCandidate` | internal | Tri-state merge dispatch: non-single base→conflict; merge-tree conflict→conflict; `!ok`→error; else clean+tree. | `tip`, `cand`, `runGit` | — | runs merge-tree (read; writes a tree object). |
| `bootstrapSeedChain` | internal | Minting arm: derive seed `post_state_hash`, require its genesis record exists (presence gate). | `seedDelta`, `ctx` | — | runs `git rev-parse`; reads record store via `resolveParentFn`. |
| `mintIntegrationRecord` | internal | Mint a non-genesis chained record for one clean merge, walk to genesis, append; fail-closed on any miss. | `prevPost`, `cand`, `mergedTree`, `ctx` | record-store append | appends a chained provenance record (or dedup no-op). |
| `integrateOneClean` | internal | Commit a clean merge object (commit-first), then mint+walk+append; advance only if both ok. | `tip`, `chainHeadPost`, `cand`, `tree`, `runGit`, `ctx` | git commit object; record-store append | writes a commit object; advances chain head. |
| `quarantineCandidate` | internal | Pin a conflicting candidate's delta to `loom-promote/<safeId>` via plain `update-ref`; report overwrite of a differing prior sha. | `cand`, `runGit` | git ref `loom-promote/<safeId>` | overwrites the quarantine ref (durable). |
| `mintRejectEvent` | internal | Reject-ledger: record a kernel-decided reject (quarantine/provenance-reject) as a content-addressed reject-event; fail-soft; gated on `ctx.minting`. | `cand`, `outcome`, `ctx` | reject-event store append | appends a reject-event (best-effort; no git). |
| `foldCandidatesOntoTip` | internal | Fold resolved candidates onto one tip in declared order; seed adopted whole; clean→advance, conflict→quarantine+continue, provenance-fail→skip+continue, commit/merge-error→abort. | `resolved`, `runGit`, `ctx` | (via callees) commit objects, quarantine refs, store appends | mutates nothing in place (immutable accumulator); side effects via callees. |
| `observeIntegrationTip` | internal | Read current integration tip inside the lock (fresh `oldOid` for the CAS). | `integrationRef`, `runGit` | — | runs `git rev-parse` (read). |
| `commitNewTip` | internal | The ONE terminal CAS ref advance; lost CAS → discard stack (re-runnable). | `finalTip`, `oldTip`, `exists`, `integrationRef`, `runGit` | git ref `loom/integration` (CAS) | advances/creates the integration ref atomically. |
| `runIntegration` | internal | Critical-section body (under lock): resolve→observe→fold→commit; returns the run-report. | `ids`, `integrationRef`, `runGit`, `ctx` | (via callees) | orchestrates all the above; no own mutation. |
| `integrateCandidates` | exported | Public composer + full safety envelope (validate→head-guard→lock→runIntegration→release); NEVER throws. | `opts` (orderedIds, parentRoot, lockPath, integrationRef, maxWaitMs, runId, stateDir, schemaVersion, + 6 fn seams) | (via callees) refs, commits, store records | acquires/releases the integration lock; all git/store side effects below it. |

- **File-level notes** — Load-bearing invariants: the merge-base is the dynamic `--all`
  common ancestor (NOT `delta_sha^1`); `> 1` base (criss-cross) → quarantine, never an
  arbitrary base. `provenanceRejectedIds` is distinct from `quarantinedIds` (a clean
  merge that failed the chain-walk is NOT a conflict). The reject-ledger is correctly
  isolated off the `post_state_hash` keyspace. The minting arm is fully seam-injectable
  (DIP). The integrator is the DECIDER of `outcome` (an agent cannot self-classify its
  reject). Fragility: identity is keyed on the RAW id but candidate resolution reads by
  the SANITIZED `safeId` (see Findings — collision surface).

### `integrate-cli.js`

- **Purpose** — Thin composition root: parse argv, resolve repo root + state dir, bind
  real git/lock concretions, call `integrateCandidates`, print the JSON run-report,
  exit 0 iff integrated. The only invocation surface for the integrator.
- **Imports / consumes** — `os`, `path`, `child_process.execFileSync`, `./integrator.js`.
  Reads env `LOOM_SPAWN_STATE_DIR`; runs `git rev-parse --show-toplevel`.
- **Consumers** — `tests/unit/kernel/spawn-state/integrate-cli.test.js` (`parseArgs`,
  `resolveStateDir`). Invoked manually as a CLI by a human operator.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `parseArgs` | exported | Parse argv into `{ids, ref, root, runId, stateDir}`; reject a flag missing its value (or eating the next `--flag`). | `argv` | — | none (pure). |
| `resolveRoot` | internal | Resolve repo root: explicit `--root` wins; else `git rev-parse --show-toplevel`; else cwd. | `root` | — | runs git (read); reads cwd. |
| `resolveStateDir` | exported | Resolve spawn-state root: `--state-dir` → `LOOM_SPAWN_STATE_DIR` → `~/.claude/spawn-state`. | `stateDir`, env | — | reads env + homedir. |
| `main` | cli-entry | Parse, validate, build opts, call `integrateCandidates`, print report, set exit code. | `process.argv`, env | stdout (JSON run-report), stderr (usage), `process.exit` | exit code 0/1/2; all integrator side effects. |

- **File-level notes** — Argv parsing is correctly separated (SRP) from the merge
  algorithm. Minting is ON iff `--run-id` is passed. The `--ref` value is NOT validated
  here against the `refs/` prefix — that guard lives in `integrateCandidates` (a
  short-name `--ref main` is rejected there, surfacing a `reason:'invalid-args'`).

### `post-spawn-resolver.js`

- **Purpose** — Resolve a closing spawn to a terminal action through the SINGLE frozen
  `RESOLVER_TABLE` (data-driven, not an if/else state machine). Decision spine in
  precedence: (1) INV-20 two-phase-commit closure → ABORTED + WAL record; (2) K14
  write-scope gate (fail-closed on detect throw); (3) K9 promote dispatch (six outcome
  codes → table rows; `ABORT_UNCONFIRMED` → whole-tree `git status --porcelain` sub-
  decision); (4) ALWAYS release the K13 marker (sourced by reading the marker, not the
  envelope id). All deps are injectable seams; the resolver builds new result objects
  and never mutates the envelope.
- **Imports / consumes** — `os`, `path`, `../_lib/k9-promote-deltas` (`k9`),
  `../enforcement/k13-serial-enforcer` (`k13`), `../_lib/k14-write-scope` (`k14`),
  `../_lib/wal-append` (`appendWalRecord`). Reads env `LOOM_SPAWN_STATE_DIR` (lazily,
  only inside default closures). Consumes the `envelope` (spawn record), `walPath`.
- **Consumers** — `stage-promote.js` (`runStagedResolve` calls the real `resolve()`);
  `packages/kernel/hooks/post/spawn-close-resolver.js` (the SHADOW hook, wires dry-run
  seams); `tests/unit/kernel/integration/transaction-loop.test.js`,
  `tests/unit/kernel/spawn-state/post-spawn-resolver.test.js`.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `appendResolverWal` | internal | Fail-soft WAL append (a WAL write failure must never mask the verdict). | `walPath`, `record` | WAL file (`failSoft`) | best-effort append. |
| `emitAudit` | internal | Fail-soft audit emit via the injected seam; a throwing `auditFn` never changes the decision. | `auditFn`, `record` | (audit sink) | best-effort; swallows throws. |
| `isTwoPhaseClosed` | exported | True iff `envelope.commit_outcome === 'COMMITTED'`. | `envelope` | — | none (pure). |
| `resolveRunGit` | internal | Resolve the single git runner once (injected `runGitFn` or default bound to `worktree_root`). | `opts` | — | none (returns a closure). |
| `resolveAbortUnconfirmed` | internal | `ABORT_UNCONFIRMED` whole-tree sub-decision: clean porcelain → REJECT_CONFLICT; dirty → `git reset --hard HEAD` + Class-4 audit. | `ctx` (runGit, auditFn, spawnId) | git working tree (`reset --hard`), audit | HARD-RESETS the worktree when dirty. |
| `defaultStateDir` | internal | `LOOM_SPAWN_STATE_DIR` → `~/.claude/spawn-state`. | env | — | reads env. |
| `releaseK13Marker` | internal | Source the admission id by reading the marker; release the K13 marker (fall back to envelope id only if unreadable); fail-soft. | `opts` (envelope, stateDir, seams) | K13 marker file (release) | deletes/releases the serial marker. |
| `dispatchPromote` | internal | Run K9 `promoteDelta`, map the outcome via `RESOLVER_TABLE`; unknown outcome → fail-closed ABORTED + Class-4; override path; whole-tree sub-decision. | `opts`, `hasViolations`, `allowOverride`, `runGit` | (via K9) cherry-pick, audit | promotes a delta (cherry-pick) on the PROMOTE path. |
| `resolve` | exported | The integration entry point: run the decision spine then ALWAYS release K13; returns a union audit record per path. | `opts` | WAL record, audit, K13 release, (via K9) git | all of the above, fail-closed on errors. |

- **File-level notes** — Strong fail-closed discipline: K14 detect-throw → ABORTED;
  unknown K9 outcome → ABORTED (no silent no-op = no silent promote); a write-scope
  violation carries `class:4`. The `RESOLVER_TABLE` completeness is a data property
  (all six K9 outcomes present). The K13 release sources the id from the marker (the
  documented `§K13-spawn-id-provenance` fix) — using the envelope UUID would silently
  no-op the release. `resolve()` is documented IMMUTABLE (only ever CALLED by
  `stage-promote.js`; never edited — the `resolveParentFn` seam is the extension point).

### `stage-candidate.js`

- **Purpose** — Close-path candidate PRODUCER (gated `LOOM_STAGE_CANDIDATES === '1'`,
  default OFF). On a COMPLETED worktree-spawn close: (1) materialize the full delta into
  one commit object; (2) record a genesis transaction-record (`post_state_hash =
  computePostStateHash(tree)`, `head_anchor:null`) to the content-addressed store; (3)
  pin the delta under a hidden `refs/loom/candidates/<safeId>` ref (plain idempotent
  overwrite). No merges. Never touches HEAD/working tree. NEVER throws (every failure
  journals + returns a result).
- **Imports / consumes** — `fs`, `path`, `../_lib/wal-append.js`,
  `../_lib/invoke-git.js`, `../_lib/quarantine-promote.js`
  (`buildSpawnRecord`/`sanitizeAgentId`/`deriveParentRoot`),
  `../_lib/transaction-record.js` (`computePostStateHash`), `../_lib/record-store.js`
  (`appendRecord`), `./_stage-helpers.js`
  (`journalPathFor`/`hasValidStateArgs`/`makeHarnessRunners`/`materialize`).
- **Consumers** — `packages/kernel/hooks/post/spawn-close-resolver.js`
  (`stageCandidate`, the `LOOM_STAGE_CANDIDATES` branch);
  `tests/unit/kernel/spawn-state/stage-candidate.test.js`.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `journal` | internal | Fail-soft per-spawn journal append stamped `mode:'candidate-stage'`; lazily mkdir 0o700. | `journalFile`, `record` | journal file | best-effort append; creates run dir. |
| `recordProvenance` | internal | Build + append the genesis record (FLAG-2 ref-implies-record); journals `candidate-record-failed` + `{ok:false}` on failure. | `args`, `safeId`, `postStateHash`, `journalFile` | record-store append, journal | appends a genesis provenance record. |
| `pinCandidateRef` | internal | Pin `delta_sha` under `refs/loom/candidates/<safeId>` in the parent ref store (plain `update-ref`). | `args`, `harnessRunners`, `safeId`, `deltaSha`, `journalFile` | git ref `refs/loom/candidates/<safeId>`, journal | overwrites the candidate ref. |
| `precheck` | internal | Pre-try guards: invalid stateDir/runId→`invalid-args`; empty safeId→`bad-id`; non-completed status→`non-completed` (journaled). | `args` | journal (on non-completed) | none (or journals). |
| `stagedResult` | internal | Emit the success journal (honest-scope note) + the staged result; surfaces the STORED `transaction_id` + `deduped`. | `journalFile`, `safeId`, `ref`, `deltaSha`, `postStateHash`, `appended` | journal | best-effort append. |
| `stageCandidate` | exported | The orchestrator: precheck→materialize→record→pin→result; NEVER throws (catch journals `candidate-error`). | `args` | git ref, record, journal | all of the above; fail-soft. |

- **File-level notes** — FLAG-2 ordering (record FIRST, ref SECOND) is honored: a
  record-success/ref-fail leaves a harmless orphan record (the integrator enumerates by
  REF, so it never sees the orphan); the reverse (ref with no record) is forbidden.
  Genesis is a STRUCTURAL gate, not provenance. The candidate ref is a plain overwrite,
  not a CAS — the sibling race is at the integration tip (correct layering).

### `stage-promote.js`

- **Purpose** — Enforcing quarantine staging-promote (gated `LOOM_RESOLVER_ENFORCE ===
  '1'`, default OFF). The FIRST production path that can reach the real
  `k9.promoteDelta`. Materialize delta → build genesis record → create a throwaway
  staging worktree OUT-OF-REPO on a new `loom-promote/<safeId>` branch → run the real
  `resolve()` against the staging envelope → KEEP `loom-promote/<safeId>` iff verdict ∈
  {PROMOTE, PROMOTE_WITH_AUDIT} else DISCARD (`branch -D`) → remove staging worktree
  (guarded finally). NEVER throws.
- **Imports / consumes** — `fs`, `path`, `../_lib/wal-append.js`,
  `../_lib/path-canonicalize.js` (`checkWithinRoot`), `../_lib/invoke-git.js`,
  `../_lib/quarantine-promote.js`
  (`buildGenesisRecord`/`sanitizeAgentId`/`deriveParentRoot`),
  `./post-spawn-resolver.js` (`resolve`), `./_stage-helpers.js` (the 4 shared helpers).
- **Consumers** — `packages/kernel/hooks/post/spawn-close-resolver.js` (`stagePromote`,
  the `LOOM_RESOLVER_ENFORCE` branch, precedence over `LOOM_STAGE_CANDIDATES`);
  `tests/unit/kernel/spawn-state/stage-promote.test.js`.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `journal` | internal | Fail-soft journal append stamped `mode:'enforce-quarantine', enforced:true`. | `journalFile`, `record` | journal file | best-effort append; mkdir 0o700. |
| `createStagingWorktree` | exported | Create the throwaway worktree on `loom-promote/<safeId>` off parent HEAD; CWE-22 `checkWithinRoot` BEFORE `worktree add`; fail-soft. | `{stateDir, runId, safeId, runGitParent}` | git worktree + branch | registers a worktree + creates a branch. |
| `buildEnforcingEnvelope` | exported | Fresh enforcing envelope (worktree_root + candidate_path = staging; `commit_outcome:'COMMITTED'`; `k14_ctx:{}` no-op; `journal_path` deliberately omitted). | `{stagingPath, candidateRel, deltaSha, transactionRecord, safeId}` | — | none (pure builder). |
| `runStagedResolve` | internal | Run the real `resolve()` (omit promote/runGit seams → real K9 + staging-bound runner; K13 no-op seams; auditFn/walPath → journal). | `envelope`, `journalFile` | (via resolve) cherry-pick on staging, journal | promotes onto the staging branch. |
| `cleanupStaging` | exported | Ordered fail-soft cleanup: `worktree remove --force` → `prune` → (if !keep) `branch -D`; journals anomalies; never throws. | `{stagingPath, safeId, keep, runGitParent, journalFile}` | git worktree removal, branch deletion, journal | removes the staging worktree; deletes the branch unless kept. |
| `materializeOrSkip` | internal | Materialize + two skip guards: empty squash → `enforce-noop-empty`; empty candidateRel → `enforce-no-candidate`. | `args`, `harnessRunners`, `journalFile`, `safeId` | journal (on skip) | none (or journals). |
| `dispositionKind` | internal | Map a verdict to a disposition-accurate journal `kind` (keep→`enforce-promoted`; else `DISPOSITION_KIND[action]` or `enforce-rejected`). | `verdict`, `keep` | — | none (pure). |
| `journalVerdict` | internal | Journal the post-resolve verdict with the honesty-contract note + disposition-accurate kind. | `journalFile`, `safeId`, `verdict`, `keep` | journal | best-effort append. |
| `stagePromote` | exported | The lifecycle orchestrator (status guard, materialize, genesis, staging, resolve, keep/discard, guarded cleanup); NEVER throws. | `args` | git worktree/branch, record, journal | all of the above; fail-soft. |

- **File-level notes** — Three distinct git-runner bindings (harness-bound unguarded
  for materialize; parent-bound for worktree lifecycle; resolve()'s default bound to
  staging for the cherry-pick). `KEEP_BRANCH_ACTIONS` + `DISPOSITION_KIND` are frozen
  DATA so a future resolver action can never silently fall into "keep" or be mislabeled
  a benign noop. The `journal_path` omission is a probed plan-vs-runtime correction
  (threading it would make K9 reject every promote as `journal-path-out-of-scope`).
  `__onStagingCreated` is a TEST seam (P14). The `stagingCreated` guard prevents cleanup
  masking the original error when a throw precedes `worktree add`.

### `spawn-record.js`

- **Purpose** — `PostToolUse:Agent|Task` hook (wired in `hooks.json`). Captures one
  bounded, secret-scrubbed spawn-record envelope per spawn close to
  `~/.claude/spawn-state/<run_id>/spawn-<id>.json`. Stores only sha256s + bounded
  excerpts (never raw payloads). Fail-soft per ADR-0001 (any error → silent approve).
  Embeds the lab-materialized reputation snapshot as an axiom (records, never injects).
- **Imports / consumes** — `fs`, `os`, `path`, `crypto`, `../hooks/_lib/_log.js`,
  `../_lib/atomic-write.js` (`writeAtomicString`), `../_lib/secret-patterns.js`
  (`getCanonicalSecretClasses`), `../_lib/evolution-snapshot-read.js`
  (`readEvolutionSnapshot`). Reads stdin (the hook JSON payload); reads
  `~/.claude/spawn-state/_run-id.txt`; reads `process.ppid`, `session_id`.
- **Consumers** — `hooks.json` (`node .../spawn-state/spawn-record.js`);
  `tests/unit/kernel/spawn-state/inv-p-depth-one.test.js` (`__test__`). Top-level
  `scrubSecrets` export is reused by `_lib/sanitize.js`.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `scrubSecrets` | exported | Coarse secret-redaction net (canonical classes + scrubber-only extras) over free-form text. | `text` | — | none (pure). |
| `readStdin` | internal | Read hook stdin; 10MB cap before parse; null on read/parse/oversize. | fd 0 | — | reads stdin; logs failures. |
| `emitApprove` | internal | Emit the minimal `{decision:'approve'}` envelope. | — | stdout | writes approve JSON. |
| `sha256` | internal | sha256 hex of input. | `input` | — | none (pure). |
| `extractResultText` | internal | Mirror of kb-citation-gate's extractor (string/array/`{text}`/`{content}`). | `toolResponse` | — | none (pure). |
| `normalizeSubagentType` | internal | Lowercase + strip plugin prefix (`power-loom:architect`→`architect`). | `rawSubagentType` | — | none (pure). |
| `resolveRunId` | internal | Run-id: `session_id` sha256 → ppid-keyed file → fresh uuid (degraded). | `input`, env, ppid | `_run-id.txt` (atomic) | creates spawn-state dir 0o700; writes the fallback file. |
| `buildSpawnId` | internal | Timestamp-prefixed UUID (sortable). | — | — | none (reads clock). |
| `safeExcerpt` | internal | Code-point-aware head/tail excerpt (no surrogate splits). | `text`, `head`, `tail` | — | none (pure). |
| `boundSnapshot` | internal | Bound the reputation snapshot for inline storage (drop value > 64KB UTF-8, keep `content_hash` pin). | `snap` | — | none (pure). |
| `buildEnvelope` | internal | Pure envelope construction (axioms, scrubbed free-form fields, attestations, diagnostics). | `{input, toolName, toolInput, toolResponse, evolutionSnapshot}` | — | none (pure; backfilled by main). |
| `writeEnvelope` | internal | Write the envelope JSON to `<run_id>/spawn-<id>.json` (atomic). | `envelope`, `runId` | envelope file | creates run dir 0o700; writes file. |
| `computeDurationMs` | internal | Hook duration ms from an hrtime start. | `startedAt` | — | reads clock. |
| `main` | hook-entry | Read → filter to Agent/Task → resolve run-id → read snapshot → build → write → backfill duration → re-write → approve; fail-soft. | stdin, env, fs | envelope file (x2), `_run-id.txt`, stdout, log | writes spawn-state files; always approves. |

- **File-level notes** — Scrub is applied to EVERY model-influenceable free-form field
  (description, subagent_type, cwd) not just the completion excerpt — a probed leak fix.
  `session_id` is deliberately left unscrubbed (harness-controlled correlation key). The
  sha256 is computed on UNSCRUBBED text (honest fingerprint) while the EXCERPT is
  scrubbed. The double-write (envelope then duration-backfill) is a documented tradeoff
  to keep "measure-after-write" semantics.

### `recovery-sweep.js`

- **Purpose** — Crash-recovery: reclassify orphan PENDING WAL records (intent recorded,
  never committed) to ABORTED, holding the K13 serial lock across the WHOLE (a)→(c)
  critical section so a background subprocess cannot write into the recovery window
  (TOCTOU-closed). Fail-closed per-orphan (hash failure → skip + Class-4, never a forged
  ABORTED). Idempotent (a spawn with a terminal record is skipped). Honors a sweep-timeout
  (admission stays blocked) and an operator force-admit (blast-radius record).
- **Imports / consumes** — `fs`, `../_lib/k9-promote-deltas` (`k9`, for
  `rollbackPromotion`), `../_lib/wal-append` (`appendWalRecord`). Reads the WAL file;
  reads env only via a `main()` entry (the pure path uses injected seams).
- **Consumers** — `tests/unit/kernel/spawn-state/recovery-sweep.test.js`. No production
  hook wires `runRecoverySweep` in v3.0-alpha (the module header + `module.exports`
  comment say "no other production importer"). The grep hits on `recovery-sweep` in
  sibling `_lib` files are comment references, not imports.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `readWalRecords` | exported | Read all JSONL WAL records, discarding a torn final line + corrupt lines; `[]` if absent. | `walPath` | — | reads the WAL. |
| `resolvedSpawnIds` | internal | Set of spawn_ids with a terminal (ABORTED/COMMITTED) record (idempotency dedupe key). | `records` | — | none (pure). |
| `scanOrphanPending` | exported | Scan for orphan PENDING (no later terminal); dedup by spawn_id (first wins). | `records` | — | none (pure). |
| `emitAudit` | internal | Fail-soft audit emit. | `auditFn`, `record` | (audit sink) | best-effort. |
| `buildAbortedRecord` | internal | New ABORTED record (same spawn_id, `is_recovery_sweep:true` F20 sentinel, captured fs hash). | `orphan`, `fsHash` | — | none (pure). |
| `processOrphan` | internal | One orphan under the lock: hash (fail-closed skip), optional K9 rollback of a promoted delta, emit ABORTED (per-orphan isolated). | `orphan`, `opts` | WAL append, audit, (via K9) git rollback | aborts one orphan; rolls back a promotion if present. |
| `runRecoverySweep` | exported | Acquire K13 lock → scan → per-orphan process → timeout check → single release; structured result; never throws into the hook. | `opts` | WAL appends, audits, K13 lock | acquires/releases the lock; writes ABORTED records. |

- **File-level notes** — F3 lock discipline (acquire once before (a), release once in
  `finally`) is honored — no interleaved release. The force-admit blast-radius record is
  emitted PRE-processing so the reported set is the FULL pending surface. The K9 rollback
  path is guarded (only when an orphan carries a hex `promoted_sha`). `SWEEP_DISPOSITIONS`
  is frozen + enumerable (a rename is caught by a data-table test). The
  `lock-unavailable` path returns `admissionBlocked:true` (fail-closed).

### `prompt-pattern-store.js`

- **Purpose** — Self-improvement CLI for the prompt-enrichment skill. Persists approved
  enrichment patterns and looks them up via Jaccard word-set similarity. Storage:
  `~/.claude/prompt-patterns.json` (LRU-evicted at 500). Not part of the spawn-delta arc.
- **Imports / consumes** — `fs`, `path`, `os`, `../hooks/_lib/_log.js` (best-effort),
  `../_lib/lock` (`withLock`), `../_lib/atomic-write` (`writeAtomic`). Reads/writes
  `~/.claude/prompt-patterns.json` (+ `.lock`).
- **Consumers** — invoked as a CLI (spawnSync) by
  `hooks/lifecycle/auto-store-enrichment.js`, referenced in
  `hooks/lifecycle/prompt-enrich-trigger.js` + the prompt-enrichment SKILL.md. No JS
  `require` (it is a pure CLI; no `module.exports`).

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `loadStore` | internal | Read the JSON store; default `{patterns:[],version:1}` on any error. | STORE_PATH | — | reads disk. |
| `saveStore` | internal | mkdir + atomic write the store. | `store` | store file | writes disk. |
| `normalize` | internal | NFKC-normalize, strip zero-width/control chars, lowercase, collapse whitespace, trim trailing punctuation. | `prompt` | — | none (pure). |
| `similarity` | internal | Jaccard similarity on normalized word sets. | `a`, `b` | — | none (pure). |
| `parseArgs` | internal | `--key value` / boolean-flag parser (doesn't eat the next `--flag`). | `argv` | — | none (pure). |
| `cmdStore` | cli | Store/increment a pattern under a lock (load-inside-lock TOCTOU close); LRU-evict at 500; print JSON. | `args` | store file, log, stdout | mutates the store; may `process.exit(1)`. |
| `tierFor` | internal | approvalCount → tier label. | `approvalCount` | — | none (pure). |
| `cmdLookup` | cli | Find matches ≥0.5, top 5; print JSON. | `args`, store | stdout, log | reads store; may exit. |
| `cmdList` | cli | List all patterns (summary). | store | stdout | reads store. |
| `cmdStats` | cli | Counts by category/tier + top patterns. | store | stdout | reads store. |
| (module body) | cli-entry | `switch(subcommand)` dispatch; usage + exit 1 on unknown. | `process.argv` | stdout/stderr | dispatches; may exit. |

- **File-level notes** — `cmdStore` correctly loads INSIDE the lock (closes the
  read-N/write-N+1 TOCTOU). The store/lookup similarity thresholds are asymmetric
  (store dedup ≥0.6, lookup match ≥0.5, bestMatch ≥0.6) — intentional. No
  `module.exports`, so the test file that "requires" it would only get an empty object;
  it is exercised as a subprocess CLI.

### `self-improve-store.js`

- **Purpose** — Counter + pending-queue store backing the auto self-improve loop:
  continuous capture (Stop hook bumps), periodic consolidation (scan applies
  thresholds, auto-graduates low-risk), batched approval. Files under `~/.claude/`:
  `self-improve-counters.json`, `checkpoints/self-improve-pending.json`,
  `checkpoints/observations.log`. Both a CLI and an in-process module (`bumpBatch`).
- **Imports / consumes** — `fs`, `path`, `os`, `../_lib/lock` (`withLock`, with a no-op
  fallback + stderr warning), `../_lib/atomic-write` (`writeAtomic`). Reads/writes the
  three store files.
- **Consumers** — `hooks/lifecycle/auto-store-enrichment.js` (in-process `bumpBatch`),
  `hooks/lifecycle/pre-compact-save.js`, `hooks/lifecycle/session-self-improve-prompt.js`,
  `runtime/orchestration/spawn-recorder.js`; `tests/unit/scripts/self-improve-store.test.js`.

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `_warnLockFallback` | internal | One-shot stderr warning when the lock primitive is unreachable. | — | stderr | sets a module flag. |
| `parseArgs` | internal | `--key value` / boolean-flag parser. | `argv` | — | none (pure). |
| `loadCounters` | internal | Read counters; quarantine a corrupt-but-existing file to `<path>.corrupt-<ISO>`; default on ENOENT. | COUNTERS_PATH | rename (quarantine), stderr | renames a corrupt file. |
| `loadPending` | internal | Same quarantine-on-corruption shape for the pending file. | PENDING_PATH | rename (quarantine), stderr | renames a corrupt file. |
| `inferKindFromSignal` | internal | Signal prefix → kind. | `signal` | — | none (pure). |
| `signalToSummary` | internal | Human summary string. | `signal`, `entry` | — | none (pure). |
| `signalToProposedAction` | exported | Differentiated learning-action text by signal/kind. | `signal`, `kind` | — | none (pure). |
| `newCandidateId` | internal | Timestamped random candidate id. | — | — | reads clock + `Math.random`. |
| `cmdBump` | exported | Increment a signal counter under the counters lock. | `args` | counters file | mutates counters; may exit. |
| `cmdBumpTurn` | exported | Increment the turn counter; report `shouldScan`. | — | counters file, stdout | mutates counters. |
| `_runScan` | internal | Threshold scan: terminal candidates skipped; pending refreshed/auto-graduated; unknown signal → new candidate. | `counters`, `pending` (mutated) | (via executeGraduation) observations.log | mutates `pending.candidates` IN PLACE. |
| `cmdScan` | exported | Consolidate counters→pending under nested locks; write both; print result. | — | counters, pending files, stdout | mutates both stores. |
| `bumpBatch` | exported | In-process batched bump (≤20 signals) + conditional nested-lock scan; single outer counters lock. | `signals` | counters, pending files | mutates both stores; no throw-swallow. |
| `executeGraduation` | exported | Append a learning line to observations.log under a lock; truncate over-`length` lines. | `candidate` | observations.log | appends a log line. |
| `cmdPending` | exported | List pending + auto-graduated candidates. | `args` | stdout | reads pending. |
| `cmdDismiss` | exported | Mark a candidate dismissed (loops all matching ids). | `args` | pending file, stdout | mutates pending; exit 1 if not found. |
| `cmdPromote` | exported | Promote a candidate: low-risk → executeGraduation + mark promoted; med/high → guidance only. | `args` | pending file, observations.log, stdout | mutates pending; may exit. |
| `cmdReset` | exported | Wipe both stores (test fixture). | — | counters, pending files | overwrites both stores. |
| `cmdStats` | exported | Counter + queue summary. | — | stdout | reads both stores. |
| (module body) | cli-entry | `switch(cmd)` dispatch under `require.main === module`. | `process.argv` | stdout/stderr | dispatches; may exit. |

- **File-level notes** — The store mutates loaded objects IN PLACE (e.g.
  `existing.approvalCount++`, `_runScan` mutates `pending.candidates`) — acceptable
  because each is a freshly-`JSON.parse`d local, not a shared/returned reference, but it
  is a deviation from the toolkit's stated immutability fundamental. The no-op lock
  fallback is a documented residual race (double-graduation under concurrency). Lock
  acquisition order (COUNTERS outer → PENDING inner) is consistently enforced.

### `_stage-helpers.js`

- **Purpose** — The 4 byte-identical close-path helpers extracted from `stage-promote.js`
  - `stage-candidate.js` (DRY at the 2nd occurrence). Each producer's `journal()` stays
  LOCAL (the `mode:` stamp differs and is load-bearing observability). Pure, no module state.
- **Imports / consumes** — `path`, `../_lib/invoke-git.js` (`runGitDefault`),
  `../_lib/quarantine-promote.js` (`materializeDelta`), `../_lib/path-canonicalize.js`
  (`isSafePathSegment`).
- **Consumers** — `stage-candidate.js`, `stage-promote.js`. (No test requires it directly;
  exercised through the two stagers.)

| name | kind | purpose | consumes | writes | state changes / side effects |
|---|---|---|---|---|---|
| `journalPathFor` | exported | `<stateDir>/<runId>/resolver-journal-<safeId>.jsonl` (per-spawn, no fan-out contention). | `stateDir`, `runId`, `safeId` | — | none (pure). |
| `hasValidStateArgs` | exported | Boundary guard: stateDir non-empty string + runId a SAFE single path segment (CWE-22 pre-join). | `stateDir`, `runId` | — | none (pure). |
| `makeHarnessRunners` | exported | Two harness-bound UNGUARDED git runners (`runGit`, `runGitWithEnv` carrying extraEnv). | `harnessWorktreePath` | — | none (returns closures). |
| `materialize` | exported | Materialize the delta via the injected `materializeDeltaFn` seam or the real `materializeDelta`. | `args`, `harnessRunners` | (via materializeDelta) git objects | runs git add/write-tree/commit-tree etc. |

- **File-level notes** — `hasValidStateArgs` correctly rejects a traversal `runId`
  BEFORE `path.join` collapses the `..` (the documented record-store `isSafeRunId`
  posture). `stateDir` is the trusted absolute base (separators allowed). Good DIP /
  SRP factoring; the unguarded runners are deliberately scoped to materialize verbs.

## Findings (bugs / logical fallacies / optimizations)

| severity | level | type | location | description |
|---|---|---|---|---|
| MEDIUM | function | bug | `integrator.js:144-155` (`resolveOrderedCandidates`) + `_lib/quarantine-promote.js:256-259` (`sanitizeAgentId`) | `sanitizeAgentId` maps every `[^A-Za-z0-9_-]` char to `_`, so distinct raw ids collide on one `safeId` (e.g. `a.b` and `a/b` → `a_b`). `validateOrderedIds` dedups by `safeId` keeping the RAW id of FIRST occurrence, but `resolveOrderedCandidates` then reads the candidate ref BY `safeId`. Two distinct raw spawns sharing a `safeId` collapse to ONE candidate ref / quarantine branch / journal file: the second producer's `pinCandidateRef` overwrites the first's `refs/loom/candidates/<safeId>` (silent delta loss for the first spawn), and the integrator can only ever fold one. This is a sanitization-collision laundering surface; agent ids are harness-controlled today so it is not adversarially live, but it is a silent-correctness hazard. |
| MEDIUM | function | smell | `integrator.js:284-291` (`quarantineCandidate`) | A pre-existing `loom-promote/<safeId>` review branch with a DIFFERENT sha is OVERWRITTEN via `update-ref` and only surfaced AFTER the fact in `quarantineOverwrites[]`. The comment claims "a human-review branch is never silently lost," but the prior commit object is only GC-reachable as long as reflog/GC policy keeps it — the human's prior review branch pointer IS replaced before the run-report is even returned. Consider refusing-and-reporting instead of overwrite-and-report for an existing differing quarantine branch. |
| LOW | function | optimization | `stage-promote.js:351-360` + `_stage-helpers.js:79-89` | Documented-and-accepted double `deriveParentRoot` (two identical `git worktree list` subprocesses per close): `materialize` calls it internally and `stagePromote` re-derives it. The code comments justify it (preserve `materializeDelta`'s single-return SRP), but threading the value out of `materialize` (it already computes `parentHead`) would remove one subprocess on the close path with no contract loss. |
| LOW | function | smell | `self-improve-store.js:471` (`executeGraduation`) | The PIPE_BUF truncation guard checks `line.length` (UTF-16 code units) but the comment + intent are about BYTES under Darwin's 512-byte PIPE_BUF. A line of multi-byte UTF-8 (e.g. CJK file paths in `summary`) can be ≤256 code units yet >512 bytes, defeating the atomicity guard. Use `Buffer.byteLength(line, 'utf8')`. The lock around the append mitigates the actual interleave risk, so impact is low. |
| LOW | file | smell | `self-improve-store.js` (`cmdStore`-analog in-place mutation; `_runScan:300-309`, `prompt-pattern-store.js:164-168`) | Both stores mutate parsed-from-disk objects IN PLACE (`existing.approvalCount++`, `_runScan` mutates `pending.candidates`, `cmdStore` mutates `existing`). Each is a fresh local `JSON.parse` result so there is no aliasing bug today, but it contradicts the toolkit's stated CRITICAL immutability fundamental ("ALWAYS create new objects"). The integrator/resolver/sweep correctly thread immutable accumulators; these two CLIs do not. |
| LOW | function | smell | `self-improve-store.js:507-517` (`cmdDismiss`) / `522-547` (`cmdPromote`) | Both loop over ALL candidates without a `break` and mutate EVERY id-match. Candidate ids are unique by construction (`newCandidateId`), so this is harmless today, but a duplicate id (e.g. a hand-edited or restored pending file) would dismiss/promote multiple candidates from one `--id`. A `break` (or `find`) after the first match would make intent explicit and the action exact-match. |
| LOW | substrate | smell | `self-improve-store.js:63-67` | The no-op lock fallback (when `_lib/lock.js` is unreachable) is documented to allow concurrent corruption + double-graduation (HIGH #2 residual). It warns to stderr but still proceeds fail-OPEN. For a store whose only failure mode under contention is duplicate audit-log lines this is tolerable, but it is an explicit fail-open where fail-closed (hard-require the lock) was the noted real fix. |
| INFO | function | optimization | `spawn-record.js:430-447` (`main`) | The envelope is written TWICE (once with `hook_duration_ms:null`, then re-written after backfilling the duration) on every spawn close. Documented as a deliberate "measure-after-write" tradeoff for the <50ms p99 budget, but it doubles the file I/O on the hot close path; collapsing to a single write (accepting a slightly-earlier duration measurement) is the noted future micro-optimization. |
| INFO | file | smell | `prompt-pattern-store.js` (whole file) | The file is a CLI with NO `module.exports`, yet it is named like a library and lives in `kernel/spawn-state/`. The grep for requires found zero JS importers; the only callers spawn it as a subprocess. It (and `self-improve-store.js`) are self-improvement plumbing co-located with the unrelated spawn-delta kernel — a layering/co-location smell, not a bug. |
| INFO | function | logical-fallacy | `integrator.js:395-405` (`commitNewTip`) | The `try/catch` around `casAdvanceRef` is dead defense-in-depth: the comment itself states `casAdvanceRef` NEVER throws on CAS loss (returns `{ok:false}`) and its input-validation throws are prevented by the call graph (`integrationRef` is `refs/`-validated, `finalTip` is a real sha). The catch can only ever be reached by an unforeseen bug, which it folds to `cas-lost` — correct fail-soft, but the branch is unreachable on every documented path. Acceptable as belt-and-suspenders given the never-throws contract. |
| INFO | function | optimization | `recovery-sweep.js:325-334` + `:305-313` | `nowMsFn()` is called repeatedly (`t0`, the force-admit `sweep_elapsed_ms`, the timeout check, the timeout alert `sweep_elapsed_ms`) — minor, but the timeout-check value and the alert value are computed by two separate `nowMsFn()` calls a few statements apart, so the reported `sweep_elapsed_ms` in the alert is marginally larger than the value that tripped the `>=` check. Harmless for an operator alert; noted for precision. |
