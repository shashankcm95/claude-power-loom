<!-- lifecycle: persistent -->

# v3.11 W1 derive-leg dogfood — recorded sample (N=1 smoke)

> **Scope (honest, per the VALIDATE honesty lens):** this is an **N=1 smoke** that the REAL
> `claude -p` derive leg EXECUTES end-to-end and produces a valid, leak-free, floor-keyed
> lesson — **NOT** evidence the leg works across the corpus or at any rate. A
> backtest/synthetic dogfood **NARROWS only; only a world-anchored run HARDENS** (OQ-NS-6).
> The W1 machinery is CI-proven via mocks (`tests/unit/lab/causal-edge/lesson-capture.test.js`);
> this run hardens the one seam the mocks stub (the real LLM classifier). A full bootcamp
> re-run remains owed. Reproduce: `node packages/lab/causal-edge/_spike/dogfood-derive-sample.js`.

## Input (the pair fed — committed in `dogfood-derive-sample.js`)

A real-shaped `more-itertools windowed()` boundary bug: the candidate guards `n < 0` only;
the accepted fix also handles `n == 0`. Issue id `more-itertools__windowed-invalid-size`,
`contamination_tier: clean`, `recall_eligible: true`.

## Recorded output (two runs, 2026-06-15)

| field | value |
|---|---|
| counters | `n_eligible:1, n_written:1, n_leak:0, n_off_floor:0, n_derive_fallback:0` |
| `lesson_signature` | `lesson:boundary-contract\|unguarded-edge-case\|handle-edge-explicitly` |
| leak-guard | passed (`n_leak:0` — no >=12-char run shared with the sealed accepted diff) |
| loads back + verifies | true (`classifyLessonLayer` valid through the store) |
| candidate recoverable | true (sidecar read-back at `candidate_patch_sha`) |
| latency | ~8.6s (first run) |

**`lesson_signature` was STABLE across both runs**; the `lesson_body` PROSE varied (claude -p
has no seed) — which both (a) confirms the floor classification is robust to the model's
non-determinism and (b) exercises the dedup-first-wins semantic (a re-run mints the same
patch-stable `node_id`, keeping the first body).

Sample `lesson_body` (run 2): "Zero is a valid boundary value that sits between the error
domain and the normal operating range; a guard that only rejects negatives silently leaks
zero into logic designed for positive inputs. Each boundary value in a parameter's contract
must have an explicit, tested path rather than falling through to whatever the implementation
happens to produce." (A general principle; no verbatim quote of the sealed diff.)
