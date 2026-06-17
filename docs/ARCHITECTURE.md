# Architecture

Power Loom is a **deterministic state-management substrate for stochastic (LLM) agents** — an *agent runtime* that wraps non-deterministic agent execution in transaction boundaries and pure-function verification gates. This document is the canonical architecture reference. The full design record lives in [`packages/specs/`](../packages/specs/) (the v6 substrate synthesis RFC + ADRs 0008–0012).

> **Reading note.** The v6 synthesis RFC is marked *LIVE-DRAFTING* (positioning, pillars, and axioms are at v6 quality; later sections carry earlier provenance). The **shipped code + ADRs 0008–0012** are the firm ground truth for what exists today. Where this doc states a primitive is "live", "dormant", "advisory", "dropped", or "deferred", that reflects the merged tree as of **v3.11** (the experience-layer arc, like the persona-reputation arc before it, added Lab-layer code only; the kernel/runtime surface is unchanged from v3.8; the §5 table's per-primitive notes carry their own phase stamps).

---

## 1. The core idea

Every agent spawn is treated as a **transaction**:

```
   spawn ──▶ isolated worktree ──▶ filesystem delta ──▶ verify (pure gates) ──▶ promote │ reject ──▶ spawn-record
                                                              │
                                              (out-of-scope writes detected,
                                               treated as policy violations)
```

The **unit of truth is the validated, in-scope filesystem delta** — not the LLM's prose, and not any file's current bytes. An LLM trajectory is non-deterministic and recoverable by re-sampling; what must be durable and trustworthy is the *effect* a spawn had on the filesystem, captured deterministically and either committed atomically or rolled back.

This is, structurally, a database transaction loop — which is why the v6 consistency model (axioms A8–A10) specifies memory the way a transactional store does: an append-only chain of commits, replayable to any point, never mutated in place.

---

## 2. The layers

A microkernel split in three layers (a fourth, `adapters`, is a reserved v3.5+ convention path that does not yet exist on disk):

| Layer | Path | Responsibility | Verification surface |
|---|---|---|---|
| **1 — Loom Kernel** | `packages/kernel/**` | Minimal, deterministic, portable-by-design; MAJOR-version-protected. Hooks, validators, recall-CLI, spawn-state machinery, and the transaction primitives. | **Pure-function gates only — no LLM in the trust/blocking path.** |
| **2 — Loom Runtime** | `packages/runtime/**` | HETS: the agent team — personas, decomposition disciplines, capability traits, per-persona contracts. | Kernel gates (blocking) + advisory checks (non-blocking, audit-logged). |
| **3 — Loom Evolution Lab** | `packages/lab/**` | Adaptive cognition: measures the substrate's own quality, derives policy, feeds reputation. Phase 3+ (v3.3+). | Advisory only; outputs reach the kernel **only** via an explicit reputation snapshot (A6). |

### The dependency rule

Dependencies point **inward**. The kernel imports nothing from outer layers; the runtime may import the kernel; the lab may import both. An inner layer importing an outer one is a violation. The kernel keeps its own shared helpers in `packages/kernel/_lib/` precisely so it never reaches into `packages/runtime/**` — this resolved a real `kernel → runtime` back-edge surfaced during Phase 0.

Enforcement is **convention + advisory**, not a hard gate: per-file `// @loom-layer: kernel|runtime|lab|adapter` markers plus the **K12 layer-boundary lint**, which *warns* on cross-layer imports but does not block. This was a deliberate v5.1 downgrade from mandatory enforcement — six months on the verification-spike branch produced **zero observed cross-layer drift** (the `_lib/` extraction pattern yields acyclic-by-construction). The upgrade trigger back to mandatory is ≥3 observed drift events across v3.1–v3.3 (OQ-19).

---

## 3. The Ten Axioms

A1–A7 specify the kernel transaction loop; A8–A10 (added in v6) specify the memory-consistency model under which agent writes commit. The two groups are co-equal — neither is contingent on the other.

| # | Axiom | One line |
|---|---|---|
| **A1** | Transactional Determinism | Validated *in-scope* filesystem deltas (or contract-conformant text) are the unit of truth; LLM trajectories are non-deterministic and recoverable-by-resampling. |
| **A2** | Kernel / User-Space / Interface Boundary | Kernel = pure deterministic functions; user-space = spawns; interface = filesystem deltas + text outputs. Forbids LLMs writing kernel paths, kernel code calling LLMs to verify, agents bypassing the interface. |
| **A3a** | Gating Verification is Pure *and* Adequate | Gates that BLOCK promotion are pure functions semantically adequate to the property; surface-keyword checks are forbidden in the blocking path. |
| **A3b** | Advisory Verification May Be LLM-Mediated | LLM judgment is allowed for *advisory* checks only — it cannot block, must emit audit records, and may inform reputation. |
| **A4** | Algorithmic Discipline is Kernel Work | Deterministic operations live in unit-tested kernel code, not prose for the LLM to execute. *(Binding from v3.2, when K11 ships.)* |
| **A5** | Substrate Evolution is First-Class | The substrate is designed to measure its own quality and evolve. *(Design intent; the Lab realizes it at v3.3+.)* |
| **A6** | Reputation as a Snapshotted Axiom | Lab signals (reputation, policy axioms) enter a spawn only by being snapshotted into its `axioms` block at spawn-init — the single deterministic bridge from Lab to Kernel. |
| **A7** | Write-Scope Detection | The kernel detects out-of-scope writes (via K14) and treats any violation as rejected/rolled-back — never silently incorporated. |
| **A8** | Memory as a Content-Addressed State Machine | Authoritative memory = deterministic replay of the transaction chain to time *T*; the chain, not any file's current bytes, is the source of truth; in-place mutation of canonical state is forbidden. |
| **A9** | Memory-Transaction Atomicity | State commits at spawn boundaries via two-phase commit (`intent_recorded_at` / `committed_at` + a WAL recovery sweep for crash-mid-spawn); K9 + K14 compose to implement it. |
| **A10** | Evidence-Linked Admission | Every memory transaction carries non-empty `evidence_refs` to kernel-emitted records present in the chain; the K9 pre-commit gate rejects forged refs — a syntactic-layer false-memory defense. |

---

## 4. The kernel transaction loop in detail

1. The **harness** allocates an isolated git worktree for an `isolation:"worktree"` spawn; the kernel **observes** it at spawn-close via `tool_response.worktreePath` (K1 is dormant — the kernel cannot inject its own worktree, OQ-21/[ADR-0012](../packages/specs/adrs/0012-capability-enforcement-is-static-not-runtime-injected.md)), under serial-only admission (K13 — one spawn at a time, with crash-orphan lock recovery).
2. The spawn runs; the substrate records a **spawn-record envelope** (K2) capturing its lineage (`parent_state_id`), settings resolution (K2.b), and — at close — its write-scope snapshot.
3. **K14** snapshots the filesystem after the spawn and records any out-of-scope writes in `write_scope_violations[]` (detected post-hoc — A7 is *detection*, not write-time prevention).
4. The **post-spawn resolver** maps the spawn's terminal state through a canonical transition table to one outcome (promote / reject-conflict / hard-reset / etc.).
5. **K9 promote-deltas** cherry-picks the in-scope delta forward, gated on a non-empty `evidence_refs` admission check (A10) and a clean write-scope set; it writes an append-only **reverse-cherry-pick journal** so any promotion can be rolled back.
6. On crash-mid-spawn, a **recovery sweep** (holding the K13 lock, fail-closed on hash failure) reconciles orphaned spawns rather than forging an outcome.

Path canonicalization (K7) guards every filesystem path against `..`, absolute-escape, and symlink-escape; an operator escape hatch (K10) can disable worktree isolation in local-trust mode, with the combined bypass denied in CI.

---

## 5. Kernel primitives {#kernel-primitives}

The "K1–K14" numbering spans the **whole kernel roadmap**. Phase 1-alpha (v3.0-alpha) shipped **11 of them** atop the pre-existing `K5` validators; **v3.1** (Runtime Foundation) then added **K6** (dormant — since **retired** in v3.2 Wave 2, as its K8 consumer never arrived), **dropped K8** ([ADR-0012](../packages/specs/adrs/0012-capability-enforcement-is-static-not-runtime-injected.md)), and built the runtime layer on top — the **R1–R4** persona/capability contracts + the reconciliation validator, the live shadow-default **spawn-close transaction loop**, and **INV-22** idempotency (see [ROADMAP](ROADMAP.md)). Honest status flags:

- **Live** — has a production code path today.
- **Dormant** — code + tests ship, but **no production importer yet** (a merge-blocking CI gate enforces it); first consumer arrives in a later phase.
- **Advisory** — runs, but **warns, never blocks**.
- **Deferred** — not shipped yet (scheduled for a later phase).
- **Dropped** — cancelled after an empirical probe proved its mechanism does not exist ([ADR-0012](../packages/specs/adrs/0012-capability-enforcement-is-static-not-runtime-injected.md)).
- **Retired** — shipped, then **deleted** once its only consumer was cancelled and no replacement emerged (YAGNI). Distinct from *Dropped*: the primitive itself worked; it simply lost its reason to exist.

| K# | What it does | Status | Where |
|---|---|---|---|
| **K1** | Worktree allocation for `isolation:"worktree"` spawns (retry + cleanup, no-shell git runner). | **Dormant** (superseded — the harness owns worktree creation; the kernel OBSERVES via `tool_response.worktreePath` at spawn-close rather than allocating, so K1 gains no production importer — OQ-21/ADR-0012; the `dormancy-assertion-k1` CI gate enforces it) | `worktree/worktree-allocator.js` |
| **K2** | Spawn-record envelope (v2 schema) — `PostToolUse:Agent\|Task` capture with `parent_state_id` + forward-compat tolerance. **K2.b** settings-resolution shipped; **K2.c** per-tool-call observability deferred → v3.3. | Live | `spawn-state/spawn-record.js` |
| **K3** | Lineage — pure-function `parent_state_id` chain DAG / acyclicity check. | Live | `_lib/lineage.js` |
| **K3.b** | Context envelope — schema + validator for cross-spawn context propagation (`schemaVersion: 1.0.0-provisional`). | **Dormant** (its intended consumer K8 was dropped — ADR-0012; awaits a v3.2+ injection channel) | `_lib/context-envelope.js` |
| **K4** | Recall-CLI deterministic tri-signal ranker (`0.5·kw + 0.3·tag + 0.2·surface`) over a snapshot, not a live store. | Live | `recall/loom-recall.js` |
| **K5** | Schema validators — YAML frontmatter, bare-secrets, config-guard, contract-verifier. | Live (pre-existing, hardened) | `validators/*` |
| **K6** | Capability subset check (deterministic set-subset). | **Retired** (v3.2 Wave 2, [boundary #216](../packages/specs/plans/2026-06-02-v3.2-runtime-decomposition-scope.md) — shipped dormant v3.1; its only intended consumer K8 was dropped per ADR-0012, so it never gained a production importer; the reconciliation validator does its own set-math) | _(removed)_ |
| **K7** | Path canonicalization — rejects `..`, absolute, and symlink-escape. | Live | `_lib/path-canonicalize.js` |
| **K8** | Capability injection at spawn-init (`PreToolUse(Agent).updatedInput`). | **Dropped** ([ADR-0012](../packages/specs/adrs/0012-capability-enforcement-is-static-not-runtime-injected.md) — `updatedInput` is inert on Agent/Task spawns; enforcement is static: agent.md `tools:` + the reconciliation validator) | — |
| **K9** | Promote-deltas — cherry-pick + path-rewrite + atomicity + reverse-cherry-pick journal for rollback. Went live in 4b via the resolver. | Live | `_lib/k9-promote-deltas.js`, `k9-path-guard.js`, `k9-journal.js` |
| **K10** | `LOOM_DISABLE_WORKTREE` operator escape hatch. | Live | `enforcement/k10-escape-hatch.js` |
| **K11** | Kernel algorithm library (makes A4 binding). | **Deferred → v3.2** | — |
| **K12** | Layer-boundary lint — `// @loom-layer:` markers + cross-layer / production→tests import detection. | **Advisory** (non-blocking CI) | `_lib/layer-boundary-lint.js` |
| **K13** | Serial-only spawn enforcer — one spawn at a time via a lock marker + age-reaping + crash-orphan recovery. | Live | `enforcement/k13-serial-enforcer.js` |
| **K14** | Write-scope enforcer — post-hoc filesystem detection of out-of-scope writes; the write-scope *producer* that K9 consumes. | Live | `_lib/k14-write-scope.js` + leaves (`k14-snapshot`, `k14-tail-window`, `k14-symlink-guard`) |

The two-phase-commit + recovery machinery K9/K14 produce and consume lives in `packages/kernel/spawn-state/` (`post-spawn-resolver.js`, `recovery-sweep.js`).

---

## 6. What is enforced, and where

- **Blocking (kernel, deterministic):** path canonicalization (K7), serial-spawn admission (K13), the K5 validators (secrets, frontmatter, config-guard). Plus the always-on Claude Code hooks: read-before-edit, config-guard, pre-compact checkpoint. (The K9 pre-commit evidence + write-scope gate is deterministic too, but it gates the delta-promote path only *when that path runs* — which is shadow by default; see below.)
- **Detect-then-resolve (kernel):** K14 records out-of-scope writes; the resolver + recovery sweep decide the outcome. Writes are *detected*, not prevented at write time — the snapshot is the source of truth (ADR-0010, `INV-K14-PostDetectionEnforcement`).
- **Advisory (non-blocking):** the K12 layer-boundary lint; any LLM-mediated runtime check (A3b) — emits an audit record, can inform reputation, cannot block.
- **Shadow / opt-in (human-gated) — the delta-promote path:** the spawn-close resolver (`spawn-close-resolver.js`), the ordered integrator (`spawn-state/integrator.js`), and the v3.7 **reject-event ledger** (`_lib/reject-event-store.js`) RECORD provenance but do **not** gate by default. The resolver runs journal-only (shadow) unless `LOOM_RESOLVER_ENFORCE=1` (enforce-quarantine) or `LOOM_STAGE_CANDIDATES=1` (candidate-stage) is explicitly set — **both default OFF**. All assembly is **out-of-tree** (`git merge-tree --write-tree` → a tree object); the only refs ever written are the disposable `loom/integration` branch + the durable `loom-promote/*` review branches. **Your checked-out HEAD and working tree are never touched.** A human reviews the staged branch and merges it — the human *is* the promote + scope gate (auto-merge-to-HEAD is retired-until-ContainerAdapter). See the [activation ledger](ACTIVATION-LEDGER.md) for each producer and its planned consumer.

### Threat model — the human-gated delta path

The delta path is safe under a **cooperative, trusted-local-filesystem, single-uid, human-in-the-loop** posture: the operator runs the tooling on their own machine, reviews each staged branch, and merges deliberately. Two residuals are **not** closed at this layer, and are disclosed honestly:

- **Same-uid record back-dating (the v3.8 breaker's input).** The reject-event ledger carries no `recorded_at` field — by design the **v3.8 breaker will window on** each record file's **filesystem mtime** (the existing `manage-promote` breaker source already does this; a `reject-event` source is not wired yet). A same-uid caller can `utimes()` a reject-event's mtime **into the past** to age it out of the breaker window (a denial-rate storm-hiding vector). The existing `excluded_future` guard is **one-directional** — it only drops *future*-dated entries (`ts > nowMs`); the past-dating direction is **unmitigated at the FS layer**. Note this hides *rate*, it cannot *forge* a reject: the content-address still binds the record's identity (a flipped `outcome` breaks the id), and the integrator — not the agent — decides the outcome.
- **`worktree ≠ sandbox`.** A spawn's isolation worktree bounds *accidental* scope, not a hostile one — an absolute-path write still escapes `cwd` (Axiom 7). The kernel *detects* out-of-scope writes (K14) but does not prevent them at write time.

Both close only at the **ContainerAdapter** (a real filesystem / namespace sandbox; Track 2 / OQ-E) — the named execution boundary that makes the writer-identity + path-confinement guarantees enforceable rather than best-effort. Until then, shadow stays the default and the path is opt-in / human-invoked.

### Threat model — the v3.9 read-mostly ContainerAdapter (the calibration backtest)

A **distinct** use of the ContainerAdapter name lands in v3.9 W1 (`packages/lab/issue-corpus/container-adapter.js` + `sandbox-exec-backend.js`): the retrospective-calibration bootcamp's behavioral grading leg runs a **stranger's** repo tests plus a model-generated patch as **arbitrary code**, so it MUST be contained. This is **read-mostly** — it clones a corpus issue at `base_sha` into a scoped temp, applies the candidate then the test patch, runs the tests, parses the flip, and discards. It is **not** the delta-WRITE sandbox above (that one — closing same-uid back-dating + `worktree ≠ sandbox` — remains deferred); the two share a name and a pluggable interface, not a code path.

- **Backend:** macOS `sandbox-exec` (Seatbelt) — `(deny default)` + allow-root reads with `/Users` (every `$HOME` secret) + the temp ROOT (a concurrent run's sibling clone) denied + the interpreter prefix + this run's own clone re-allowed; **writes scoped to a temp dir, network denied** (those two default-deny allow-lists are the load-bearing boundaries). Containment is **proven green-or-block** by `_spike/containment-spike.js` (8 distinct cases: the positive control + inherited-deny across fork/exec, exfil on all channels, `$HOME`/secret-read/symlink/traversal fs-escape, fork-bomb pgid-reaping, fail-closed, **and the git-lifecycle hardening below**) and **re-attested live at runtime** (`containmentAttested` is false until a fast self-check passes on the actual host — the `$HOME`-write block is an independent effect oracle; the network block is the child's EPERM self-report, with the rigorous parent-listener egress oracle in the spike). It fails **closed**: no attested backend ⇒ no behavioral leg (the semantic + teaching legs still run).
- **The git lifecycle runs UNSANDBOXED (disclosed + hardened).** `git clone` / `checkout` / `apply` execute on the host *before* the sandbox exists, on attacker-influenced inputs (the corpus repo URL/path + the candidate/test patches). Hardening: `repo`/`base_sha` are shape-validated and passed after a `--` end-of-options separator (closes CWE-88 arg-injection into git's flag parser); `core.hooksPath=/dev/null` + `protocol.ext.allow=never` + `GIT_CONFIG_NOSYSTEM` neutralize repo-side hooks / `ext::` transport / fsmonitor / config; `git clone --no-hardlinks` does not import the source `.git/hooks`. The **residual**: a *future* git-CVE in the unsandboxed flag parser would execute with the operator's privileges — defense-in-depth, not elimination. W2 (real GitHub ingestion) must keep this hardening (or sandbox the clone itself).
- **Disclosed in-sandbox residuals (the deferred Docker/namespace backend's job):** the memory-DoS bound is **weak** (`RLIMIT_AS` is ignored on macOS arm64 — bounded only by a 10 MB output cap + wall-clock + pid-count + pgid-kill); an unbounded **`setsid`-escaping** fork-bomb survives pgid-kill (bounded by the per-UID `ulimit -u`, not eliminated); **kernel-LPE via an allowed `mach-lookup`** is out of scope; `file-read-metadata` is allowed globally, so a `$HOME` file's existence/size/mtime is **stat-able** (content read is still denied); and the **read-scope** is broad (system dirs outside `/Users` are readable — exfil is closed, so a read alone can't leave). The posture is **single-dev / opportunistic-adversary**, not a determined one; the Docker backend (Track 2) closes the memory + kernel-isolation gaps for CI/server use.
- **The Docker backend (v3.0 wave) realizes the deferred backend** (`packages/lab/issue-corpus/docker-backend.js` + `Dockerfile`, opt-in `LOOM_SANDBOX_BACKEND=docker`; the macOS sandbox-exec backend remains the default). It drops in behind the unchanged `ContainerAdapter` interface and **closes the above in-sandbox residuals for the untrusted-code-execution surface**: `--memory`/`--memory-swap` is a HARD cgroup mem bound (the `RLIMIT_AS`-ignored gap — spike-proven OOM-kill → `KILLED_FOR_DOS` via the authoritative `docker inspect .State.OOMKilled`); `--pids-limit` is a cgroup fork-bomb bound (not the per-UID ulimit) and `--init` reaps orphans; `--network none` denies egress at an empty netns; the **mount namespace** makes host paths *structurally* unreachable (stronger than the Seatbelt deny-list — `/Users`, `$HOME`, host `/tmp` siblings simply do not exist in the container); `--cap-drop ALL --security-opt no-new-privileges --read-only --user $(id -u):$(id -g)` round it out. **Proven green-or-block by `_spike/docker-containment-spike.js` (12/12)** + dogfood-verified end-to-end; `containmentAttested` is an **async-then-cached** live self-check (a real `docker run`; the sync getter does not self-trigger — callers `await attest()`; an un-attested backend is skipped fail-closed). The host git lifecycle (clone/apply) is the SHARED `_clone-lifecycle.js` (the same hardening as sandbox-exec; the clone is still host-side, mounted read-write into the container).
- **Two-surface honesty (what the Docker backend does NOT close).** It contains the **untrusted-code-EXECUTION** surface (the behavioral-grading / dry-run leg running a stranger's tests). It does **not** close the **host-side kernel-hook same-uid residuals** (the `fact-force-gate` tracker TOCTOU, the `atomic-write` remove-then-symlink) — those run as the dev user *in the orchestrator's own host process*, not in any container, so closing them would require containerizing the kernel hooks themselves (a different, out-of-scope surface). The build-time `docker build` / `pip install` runs on the host with full network — a supply-chain surface **distinct from** the `--network none` run-time boundary, mitigated by a digest-pinned base + version-pinned pytest. **"R13" appears in both the host-hook residual cluster AND this exec surface**; `--network none` closes only the exec-surface instance. The delta-WRITE sandbox (same-uid back-dating, `worktree ≠ sandbox`) likewise remains a separate deferred surface.

### The friction map — trajectory capture as a diagnostic (v3.9 W3)

The bootcamp's **second diagnostic** (`packages/lab/causal-edge/trajectory-friction.js`) asks not just *did the patch pass* but *where the plugin excels, hallucinates, misreads*. The actor runs as a **top-level `claude -p --output-format stream-json`** — NOT a sub-agent: the parent's `PostToolUse:Agent` hook cannot see a sub-agent's intermediate tool calls, so the top-level run is the only ADR-0012-clean way to observe a tool log. That capture is the wave's one harness-capability dependency and was **firsthand-probed**, not assumed (the exact stream-json block shapes + the noise-event/own-hooks-in-child/content-polymorphism/model-inheritance/variadic-eats-prompt gotchas).

The trust boundary matters: the actor grades a **stranger's code that itself runs tools**, so `tool_name` / `tool_use.id` / `tool_result.content` are adversary-shapeable bytes crossing into the parser. The parser keys only through a `Map` / `hasOwnProperty` (no prototype pollution), pairs `tool_use`↔`tool_result` FIRST-wins FIFO (a forged/duplicate result never overwrites a binding), and defaults unknown tools to an unclassified phase.

Three honesty invariants make the map a *diagnostic*, not a trust signal: (1) the trajectory + `resolution_friction` fields are **REPORT-ONLY** — by data-flow ordering they are computed *after* the verdict/`recall_eligible` and a RED test pins pass@k byte-identical with and without them, so they can never blend into the headline; (2) the **recall-smell** fires on TWO signals — `(low loop + reached resolution) AND (relevant files unread)` — never trajectory-shape alone (the literature inverts the naive expectation: chaos correlates with *failure*, not recall), it is fail-closed (no relevant files ⇒ UNKNOWN, never a smell), and every flag carries `detector_validated: false` until `validateRecallSmellAgainstControls` returns a THREE-valued verdict on-corpus (the RFC §3.3 "validate BEFORE trusting" sequencing); (3) the friction LABEL's own error bar is **UNKNOWN-until-measured** on this corpus, never the borrowed out-of-distribution analogue. The `resolution_friction` block is a NEW closed-enum block (ADR-0015's R9-mirrored `failed_criterion_id` enum is untouched); the cluster KEY is the deterministic `(class, phase, leg)` tuple, with the semantic embedding an optional depth layer that is never the key.

### The recall graph — leg-B-gated worked examples + the OQ-7 firewall (v3.9 W4)

The bootcamp's **RETRIEVAL artifact** (`packages/lab/attribution/recall-graph.js` + `recall-graph-store.js`) turns a graded attempt into a causal-recall-graph **node** — a worked example the v3.10 live substrate can later retrieve. Three properties keep it honest under the **retrieval-not-weights** invariant (OQ-NS-6: a backtest NARROWS, never HARDENS): (1) a node is `node_type='stochastic_sample'` and the schema has **no weight/gradient/`learned_*` field, ever** — the only thing that grows over runs is retrieval coverage, never capability (a `bootcamp-gates.js` **wording-audit** greps the tree for `learns`/`trains`/`improves over time` near a metric to enforce it); (2) population is **double-gated** — `recall_eligible` (the leg-B-affirmative gate, reused verbatim from the scorer — a behavioral-only or gamed pass NEVER populates, R3) **and** a contamination gate (`CLEAN_FOR_RETRIEVAL` admits ONLY a positively-clean tier; `grey`/`stale` AND an unknown/unlabeled tier are dropped fail-closed, because a memorized issue passes the behavioral leg *because* it is memorized — the strongest OQ-7 poison, and an unlabeled example is exactly where contamination cannot be ruled out); (3) the **friction map** (cross-issue `clusterFriction` roll-up) and the **judge's own precision/recall** — the agreement of leg A's **raw `issue_tests`** (the sandbox run, UNCONDITIONED by leg B) against leg B's blind `supported`, two *independent* legs so the confusion cells are genuinely reachable — are appended to the un-gated Path-1 record as REPORT-ONLY diagnostics, with the labeler error bar **UNKNOWN-until-measured** — on the seed corpus every rate is honestly `INSUFFICIENT-N` (floor 20).

The **OQ-7 firewall is physical, not a label**: bootcamp nodes write to a separate `recall-graph-backtest/` store that **rejects any non-`backtest`-provenance node** and whose every path is unreachable from a future live-retrieval store — so a v3.10 retriever pointed at the live store can never surface a benchmark solution as "original work". `provenance` is in the node's content-address basis (a backtest and a live node for the same issue can never collide), and the store **content-verifies on read** (`node_id` re-derived from the basis + `content_hash` from the body — a hand-edited node fail-softs to null, the #273 "store is not a sandbox" lesson) and **deep-freezes the read-back** incl. the nested `worked_example_ref`. This is a **forward contract** (queryable-as-excluded + physically unreachable), not enforced runtime live-exclusion — no live retriever exists yet, so **OQ-7 stays open**. **Path-2 stays dark** (zero `recordVerdict`/reputation/breaker from any bootcamp module — a fail-closed EC7 grep gate proves it): a backtest must never forge a hardening signal.

The **v3.11 experience layer** (`packages/lab/causal-edge/{lesson-signature,lesson-derive,lesson-capture,lesson-consolidate,lesson-confirm,recall-edge-store}.js` + the lesson fields in `recall-graph.js`) reframes that node from an *action log* into a **derived lesson**. An advisory `claude -p` derive leg classifies a re-run's *(failure, accepted-fix)* contrast into a **FROZEN closed-enum signature** — `lesson:trigger | gotcha | corrective`, the **24-cell D1 floor** (`lesson-signature.js`; APPEND-ONLY, one-way-door, audited in `causal-edge/lesson-taxonomy-freeze.md`) — plus a short principle body. The lesson rides **top-level + outside both `node_id` and `content_hash`** (so a seedless re-derived body never perturbs node identity/dedup) with its **own** `lesson_content_hash` over a separate frozen field-set, and `classifyLessonLayer` re-derives the signature + re-hashes the body on every read (a forged-signature or off-floor `INVALID|INVALID|INVALID` fixed point is rejected — the #273 verify-on-read lesson, a third time). A same-`fail_to_pass` **confirmation gate** (`lesson-confirm.js`, evidence-backed: the requirement is corpus-trusted, exact-SET-matched on both sides, self-confirm + ground-truth-as-confirm rejected) means a lesson **provably cannot enter the predictor lane** without a confirming delta; the first `(failure)--confirmed-by-->(delta)` edge (`recall-edge-store.js`) + the **trap seam** (`failed_attempt_ref`, top-level/unhashed/sidecar-backed → `contrast(wrong-diff, accepted-fix)`) + a confirmed trust-weight consolidation pass + a collision-gated **signature retriever** (`attribution/_spike/retrieve-signature.js`) complete the organ. A full bootcamp re-run (20 real OSS bugs → 20 real on-floor lessons) MEASURED held-out cross-repo sibling retrieval at **signature 0.72 vs the repo-gated lexical floor 0.06** — DIAGNOSTIC per OQ-NS-6 (a corpus engineered for cross-repo collisions NARROWS; only a world-anchored merge HARDENS). The retriever stays a **`_spike`, out of the live K4 recall-CLI** — the standing residual is that a content-addressed store proves *integrity, not provenance* (a sidecar+edge co-forge still inflates the shadow/advisory confirmed-weight), so **signed/kernel-writer edges** are the named v-next close.

For the per-hook deep-dives see [`docs/hooks/`](hooks/); for the cross-PR sequencing contract (K9 ↔ K14, the canonical resolver table, the combined-bypass policy) see [`packages/specs/adrs/0011-k9-k14-sequencing-and-phase-1-alpha-spec-deltas.md`](../packages/specs/adrs/0011-k9-k14-sequencing-and-phase-1-alpha-spec-deltas.md).

---

## See also

- [ROADMAP](ROADMAP.md) — how the substrate got here and where it goes next.
- [Stability commitment](reference/stability-commitment.md) — what is frozen vs evolving vs experimental.
- [v6 substrate synthesis](../packages/specs/rfcs/v6-substrate-synthesis.md) — the full design rationale (live-drafting).
- ADRs [0008](../packages/specs/adrs/0008-phase-0-workspace-restructure.md) (restructure) · [0009](../packages/specs/adrs/0009-major-bump-rationale.md) (major bump) · [0010](../packages/specs/adrs/0010-write-scope-enforcement.md) (write-scope) · [0011](../packages/specs/adrs/0011-k9-k14-sequencing-and-phase-1-alpha-spec-deltas.md) (K9↔K14 sequencing) · [0012](../packages/specs/adrs/0012-capability-enforcement-is-static-not-runtime-injected.md) (capability enforcement is static).
