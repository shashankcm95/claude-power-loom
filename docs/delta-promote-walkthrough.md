# Delta-promote — the human-gated workflow, end to end

This is the documented walkthrough of Power Loom's **delta-promote** path: how an
agent spawn's filesystem delta gets staged as a candidate, folded onto an assembly
branch, recorded in the trust ledger, and — only by a deliberate human action —
merged. It is the v3.7 W3 capability demonstration (operator-dogfood): everything
below was produced by running the real machinery, and CI re-runs it on every push
(`tests/unit/kernel/spawn-state/delta-promote-demo-e2e.test.js`).

**Posture (read this first):** the whole path is **shadow / opt-in / human-gated**.
Nothing here runs unless you set a `LOOM_*` flag (all default OFF); the machinery
only ever RECORDS and STAGES; your checked-out HEAD and working tree are never
written; the only promotion is a human running `git merge`. The honest framing +
threat model live in [ARCHITECTURE §6](ARCHITECTURE.md#6-what-is-enforced-and-where)
— including the two residuals (same-uid mtime back-dating; `worktree ≠ sandbox`)
that close only at the ContainerAdapter.

## Try it yourself (hermetic, 5 seconds)

```bash
node examples/delta-promote-demo.js          # narrated
node examples/delta-promote-demo.js --keep   # keep the temp repo to poke at
```

The demo creates a throwaway repo under the system temp dir and drives the REAL
modules — `stageCandidate()` (the producer the spawn-close hook calls) and
`integrate-cli.js` (the human surface) — through the full workflow. Nothing
outside the temp dir is written.

## The workflow, step by step

### 1. Spawns produce deltas (the harness side)

Each agent spawn runs in an isolated git worktree (`isolation: "worktree"`). In
production, the spawn-close hook observes the worktree at `PostToolUse:Agent`
close. The demo simulates three spawns:

| Spawn | Delta | Fate |
|---|---|---|
| `demo-seed` | edits a `README.md` line | candidate-0: adopted whole as the **seed** |
| `demo-logger` | adds `src/logger.js` (disjoint file) | merges clean → **absorbed** |
| `demo-conflict` | rewrites the SAME `README.md` line the seed edited | **quarantined** |

### 2. Staging (the producer — opt-in via `LOOM_STAGE_CANDIDATES=1`)

In production the spawn-close hook calls `stageCandidate()` when
`LOOM_STAGE_CANDIDATES=1` is set (default OFF). For each completed worktree-spawn it:

1. **materializes** the worktree's full delta (committed range + working tree)
   into one squash commit, parented on the dynamic fork point
   (`git merge-base(parent HEAD, worktree HEAD)`);
2. **mints a genesis provenance record** into the content-addressed record-store
   (`post_state_hash = computePostStateHash(tree)`);
3. **pins** the delta under a hidden `refs/loom/candidates/<id>` ref — not under
   `refs/heads/`, so it never appears in `git branch` and can never be checked out.

Captured demo output:

```text
staged demo-seed: ref=refs/loom/candidates/demo-seed
  genesis transaction_id=c0de607e88e13785... post_state_hash=14781c8924389757...
staged demo-logger: ref=refs/loom/candidates/demo-logger
staged demo-conflict: ref=refs/loom/candidates/demo-conflict
worktrees REMOVED (harness-cleanup simulation); 3 hidden candidate refs survive
(git branch sees none of them)
```

The pin is the durability mechanism: the harness removes a spawn's worktree at
close, but the pinned object stays GC-reachable in the parent repo's object store.

### 3. The fold (the human surface — `integrate-cli`)

The integrator is **not wired into any hook** — a human invokes it, with the
candidate ids in an explicit declared order (candidate-0 is the seed, adopted
whole; each later candidate is 3-way-merged out-of-tree against the dynamic
merge-base):

```bash
node packages/kernel/spawn-state/integrate-cli.js \
  demo-seed demo-logger demo-conflict \
  --root <repo> --run-id <run-id> --state-dir <spawn-state-dir>
```

```text
integrated:  ["demo-seed","demo-logger"]  (tip 9fb93d5bf8bd...)
quarantined: ["demo-conflict"]  -> refs/heads/loom-promote/demo-conflict
```

- A **clean** merge advances the disposable `loom/integration` assembly branch
  (rebuilt from scratch every run — never commit onto it).
- A **conflict** quarantines the candidate to a durable `loom-promote/<id>`
  review branch and the run continues.
- The whole fold is out-of-tree (`git merge-tree --write-tree`); the terminal ref
  write is a single compare-and-swap. **HEAD and the working tree are never
  touched** — the demo asserts byte-equality across the entire fold.

### 4. The ledger (v3.7 W1 — what the trust system will consume)

With `--run-id` set, the fold mints provenance:

```text
chained integration records (absorb side, mechanical/display-only): 1
  APPEND db6e990ec0fa4c32... writer=loom-integrate-demo-logger
reject-events (the kernel-DECIDED denial source; v3.8 breaker input): 1
  quarantined 4f64f78906d6eef7... candidate=demo-conflict
```

Two distinct record kinds, deliberately asymmetric:

- **Absorbed** → a chained **integration record** in the K9 provenance chain. A
  clean merge is *mechanical* (`merge-tree` exit 0 = did-not-textually-conflict —
  an agent can guarantee it with a disjoint-files delta), so this signal is
  **display-only** for trust purposes.
- **Rejected** (quarantine / provenance-reject) → a **reject-event** — NON-CHAIN,
  isolated off the chain-walk keyspace, content-addressed with the outcome folded
  into the id, minted by the *integrator's* decision (an agent cannot forge its
  own classification). This is the denial source the v3.8 breaker consumes
  (reject-rate may only NARROW trust; only a world-anchored merge hardens it).

### 5. The human reviews and merges (the only promotion)

```bash
git log --oneline main..loom/integration     # what would land
git diff main...loom/integration             # the full delta
git merge --no-ff loom/integration           # the DELIBERATE promotion
```

```text
README.md     | 2 +-
src/logger.js | 2 ++
merged. main now has: README.md, src/app.js, src/logger.js
```

The quarantined delta stays parked for a separate human decision:

```bash
git diff main...loom-promote/demo-conflict   # inspect the conflicting rewrite
# then: merge it manually, cherry-pick parts, or delete the branch
```

## Enabling it for real (the opt-in)

```bash
export LOOM_STAGE_CANDIDATES=1     # stage each worktree-spawn close as a candidate
# ... agent spawns accumulate candidates under refs/loom/candidates/ ...
node packages/kernel/spawn-state/integrate-cli.js <id...> --run-id <run> # fold when YOU choose
git merge loom/integration         # promote when YOU choose
```

`LOOM_RESOLVER_ENFORCE=1` is the alternative single-spawn arm (quarantine each
close straight to `loom-promote/<id>`; takes precedence if both are set). Unset
both and the resolver is journal-only shadow — the default.

**Scope honesty:** this demonstrates the *capability* with the operator as the
maintainer. A product-demand consumer (an external user actually adopting the
flag) remains undemonstrated — that hinge resolves at v3.9 (RFC
`2026-06-04-enforcing-vs-advisory-identity` §7).

## See also

- [ARCHITECTURE §6](ARCHITECTURE.md#6-what-is-enforced-and-where) — enforced vs
  shadow vs best-effort + the threat model.
- [ACTIVATION-LEDGER](ACTIVATION-LEDGER.md) — every dark/flag-gated producer and
  its consumer fate.
- `packages/specs/plans/2026-06-10-v3.7-delta-promote.md` — the v3.7 plan this
  wave belongs to.
