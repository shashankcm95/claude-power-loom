# Test phase charter — the LIVE external-PR beta (the trust unlock)

**Phase:** ③ (post v-next mock-mechanics close) · **Date:** 2026-06-16 · **Status:** CHARTER (planning)

## What this phase IS

The **live external-PR beta** — the north-star apex (`external_maintainer_merge`) and the **only lever that
HARDENS trust** (everything to here only NARROWS — OQ-NS-6). A forged **Python-specialist persona** pulls
real `good-first-issue` Python issues, solves them, and we watch the artifacts attach to the right
**skills / KBs / memories-thoughts / the learning graph** as it grows — under a **highly monitored execution
flow** (the user's "F7 step-through"). The user pushes every PR themselves after verifying.

Derived from the 2026-06-16 whole-substrate review (`2026-06-16-whole-substrate-review.md`, board
`wf_39a1072c-fe6`, all 5 lenses HEALTHY-WITH-NOTES) — the foundation is sound for shadow; the beta is a large
net-new build with real safety prerequisites.

## USER decisions (2026-06-16)

1. **Build order: foundation-hardening FIRST**, then the dry-run.
2. **Observability: a structured trace-emitter** — each component emits a per-step record (inputs / outputs /
   state-deltas) to a replayable, queryable, diff-able timeline.
3. **Persona: forge a NEW one** from the existing template (a fresh identity → clean reputation tracking).
4. **The user pushes every PR** after verifying (the submit gate stays human).

## The sequence (three sub-phases; only ③.2 touches real repos destructively)

```
③.0 FOUNDATION-HARDENING  →  ③.1 DRY-RUN (safe; no real PRs)  →  ③.2 REAL-PR (gated on the user + prereqs)
   (chosen first)              forge persona · KB · F7 trace ·       Docker sandbox · PR-egress kernel ·
   kernel close-path ·         macOS-sandbox DRAFT · learning-        the gating preconditions · Fibonacci
   secret-scrub · rule-honesty graph capture · read-only puller      ramp · USER submit gate
```

OQ-NS-6 invariant held throughout: **every lab signal stays advisory/narrowing (shadow) until a real
maintainer-merge corpus + the authenticated minter exist.** The dry-run NARROWS (builds the dataset + proves
the loop); only ③.2's real merges HARDEN.

---

## ③.0 — Foundation-hardening (the chosen first track; per-wave plan→VERIFY→build→VALIDATE→PR each)

Decomposed for reviewable PRs. Kernel waves get the full 3-lens VALIDATE (correctness + adversarial + honesty).

- **③.0-W1 — kernel close-path latency (the 3 HIGHs; the beta breaches the 10s hook timeout otherwise).**
  (a) `library-catalog.js` → replace `withLock` (which `process.exit(2)`s, killing the hook under concurrent
  spawns) with the k13 `acquireLock`+soft-fail pattern; (b) `record-store.js` `readByPostStateHash` /
  `readByIdempotencyKey` O(N) scans → an in-memory index passed through the existing opts bag (measure the
  close-hook wall time at realistic N first — Runtime-Claim Probe); (c) `spawn-close-resolver.js` → collapse
  the two sequential git tree-walks (`diff --name-only` + `status --porcelain`) into ONE `status --porcelain`.
  + fold the cheap MEDs (`deepFreeze` WeakSet cycle-guard; `validateTransactionRecord` `abort_detail`
  width/depth bound).
- **③.0-W2 — secret-scrub for the beta's OWN credential classes (security).** Add `github_pat_`, `ghs_/ghr_`,
  `glpat-`, `AIza` to `SECRET_PATTERNS`; DRY (or cross-test) the two drifting lists (`spawn-record.js` ↔
  `validate-no-bare-secrets.js`). Prereq for any path where the beta mints a GitHub token. hacker lens.
- **③.0-W3 — concurrency + instruction-layer honesty.** `fact-force-gate` per-spawn tracker key (unique
  `CLAUDE_SESSION_ID` + pid fallback, for concurrent spawns); the always-on rule that cites the
  non-existent `validate-markdown-emphasis.js` (implement+register the hook OR rewrite the rule — edit the
  SOURCE `packages/skills/rules/core/workflow.md`, then `install.sh --rules`); the `ARCHITECTURE.md` K1
  "Live"→"Dormant" contradiction; the stale `stability-commitment.md` (v2.x version pins).
- (LOWs — `config-guard` stdin cap, `integrator` `isSafeRunId`, `recordStoreDir` export, the
  `LOOM_LAB_STATE_DIR`-relocates-the-ledger DENY_READ_TREES derivation — fold opportunistically.)

**Recommended start: ③.0-W1** (highest-stakes, the clearest beta-blocker).

---

## ③.1 — The DRY-RUN loop (safe-now; NO real PRs; runs on the existing macOS sandbox-exec)

The user's "dry run": build + observe the FULL loop end-to-end, drafting solutions only.

- **The forged Python persona** (skill-forge, from the template): a fresh identity (clean reputation key —
  reconcile to ONE canonical persona-key shape, the C2 carry, so its reputation doesn't fragment). Python
  background; wired to the right skills + KBs.
- **KB distillation** (textbooks → MD → distilled KB): the user converts advanced-Python textbooks to MD;
  we distill them into the persona's KB. **Internal KB use ONLY** (no reproduction/redistribution of the source).
- **The structured trace-emitter (the F7 observability — USER choice).** A per-step trace record
  (`{step, component, inputs_digest, outputs_digest, state_delta, ts}`) emitted at each seam: persona spawn →
  recall retrieval (which lessons/KBs attached) → solve → grade → learning-graph write. A replayable timeline
  (queryable, diff-able across runs). Likely builds on the trajectory-friction stream-json seam for the
  actor-process layer + a new emitter for the substrate seams.
- **Run-in-sandbox DRAFT:** the persona solves issues inside the existing macOS sandbox-exec backend
  (clone→apply→test→discard), producing a PR body+diff **artifact** — emits NOTHING externally.
- **Read-only routine puller (the dataset):** a scheduled task pulls `good-first-issue?l=python`, filtered to
  repos that accept **unsolicited PRs** (no assignment needed) + PR-capable — building the corpus. Read-only;
  no submission.
- **Learning-graph capture:** watch the recall graph / lessons / memories grow across runs (the trace-emitter
  records each attach + write). This is the experiment: does the experience layer actually accrue + sharpen?

---

## ③.2 — REAL-PR submission (GATED — the only part that hardens trust)

Each is a hard gate before the first real PR:

- **The Docker/gVisor ContainerAdapter** (deferred since v3.9) — the beta runs on Linux/CI + runs stranger
  repo code; macOS-Seatbelt is single-platform. + harden the clone path (route EVERY git call through
  `GIT_HARDEN`+`assertSafeRepo/Sha`; https-only; submodule/file-protocol denied) — the `_spike` clone is bare.
- **The PR-egress kernel** — dry-run-default (emit nothing without the human gate), a hard per-window cap, an
  etiquette policy (one PR/issue, respect `good first issue` reservation + CONTRIBUTING, no re-open), a global
  `LOOM_BETA_KILLSWITCH` (fail-closed), 429/abuse backpressure.
- **The trust preconditions** (only if any beta weight GATES vs narrows): the two-axis weight reconciliation
  (enforce the sole-constructor; ADR the combination semantics) + the authenticated minter (#273; key held
  outside the agent's process) + the lab-store CWE-22 `dir` guards. Safe default: keep every weight shadow.
- **The Fibonacci ramp** — cumulatively increment issues-tackled (1,1,2,3,5,…) once the gates hold; the user
  pushes each PR after verifying.

---

## Open decisions (for when we reach each sub-phase — not blocking ③.0)

- ③.1: which textbooks; the KB-distillation depth/format; the persona's exact skill/KB wiring; the trace
  schema's final field set; the read-only-puller cadence (a `routine`/scheduled task) + the unsolicited-PR filter test.
- ③.2: the GitHub auth model (the user's token, scoped); the per-window cap numbers; the etiquette policy text;
  whether ANY weight ever gates (default: no — stay shadow).

## Honest frame (non-negotiable)

The dry-run + the read-only puller + the engineered dataset **NARROW** (prove the loop, build the corpus); they
move trust ZERO. **Only a real maintainer-merge of a beta-submitted PR HARDENS** — and only then, only on the
authenticated lane. No artifact may say the beta "hardens" until a real merge lands on the signed lane.
