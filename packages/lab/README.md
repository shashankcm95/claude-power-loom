# packages/lab — the Evolution Lab (SHADOW / weight-inert experiment substrate)

The v3.x advisory/shadow experiment substrate (v4 substrate synthesis §2 Layer 3). **Everything here is
SHADOW + weight-inert by default** — a lab signal NARROWS trust (observe-first); only a world-anchored merge
gated by an authenticated oracle HARDENS it (OQ-NS-6). `LIVE_SOURCES=Object.freeze([])` keeps every
lab-derived signal out of any action-gating weight until a deliberate flip. Adaptive cognition, experimental,
PATCH-iterable — **NEVER promoted to kernel without an ADR.**

For the live module + per-file list, see `docs/SIGNPOST.md` and each module's header (a hand-frozen
file-level list re-drifts). Present subdirectories (run `ls packages/lab/` for the live set):

- `world-anchor/` — the merge-return wire: gh-verified merge-outcome records + the world-anchored-by edge mint.
- `causal-edge/` — the experience/lesson layer: frozen taxonomy, live-lesson deriver, `live_pending` capture, weight-source gate.
- `verdict-attestation/` — record an advisory verdict's emission attestation, evidence-linked to a kernel spawn-record.
- `reputation/` — per-persona / per-identity advisory-verdict distribution over attested spawns (read-only).
- `circuit-breaker/` — the denial-rate breaker projection (SHADOW; halts nothing).
- `attribution/` — provenance + the bootcamp closing gates for emitted artifacts.
- `manage-proposal/` — the human-disposition surface for the shadow manage-write loop (advisory ledger).
- `negative-attestation/` — observation tooling with no enforcement authority (the code-reviewer dogfood vehicle).
- `persona-consumer/` — the authorship ledger: a content-addressed (node_id, built_by) edge store.
- `persona-experiment/` — the per-arm prompt-composition experiment harness (one additive delta per arm).
- `issue-corpus/` — the hardened git clone/apply lifecycle + issue-corpus tooling for backtest runs.
- `trace-emitter/` — fold close-path timings into a queryable timeline (SHADOW).
- `_lib/` — shared lab primitives (the tool-less `claude -p` recipe, enum-key, etc.).
- `convergence/` — reserved (placeholder): paired-with convergence measurement.
- `evolve/` — reserved (placeholder): the agent + skill evolution loop.
- `review/` — reserved (placeholder): adaptive code-review heuristics.
- `policy-axioms/` — reserved (placeholder): adaptive policy proposals (kernel reads via snapshot, never a static import).

## Boundary invariants

- NO direct kernel-path writes; NO direct runtime gating — advisory only.
- A lab module may import inward (`lab -> kernel`) but the kernel NEVER imports `lab`.
- Filesystem reads of `~/.claude/library/sections/toolkit/**` from the kernel are permitted only via the A6 snapshot interposition.
