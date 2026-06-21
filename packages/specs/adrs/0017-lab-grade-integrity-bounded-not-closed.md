---
adr_id: 0017
title: "The lab behavioral grade is integrity-BOUNDED, not provenance-CLOSED — SHADOW/advisory, never gates an action"
tier: architectural
status: accepted
created: 2026-06-21
author: ③.2.1a forge wave (firsthand exploit + 2-lens design board)
superseded_by: null
files_affected:
  - packages/lab/issue-corpus/container-adapter.js
  - packages/lab/issue-corpus/_clone-lifecycle.js
# (the dropped-nonce design would also have touched pytest-runner.js / calibration-issue-run.js /
#  calibration-issue.js; the nonce was proven ineffective and NOT shipped — see Context.)
related_adrs:
  - 0012
related_kb:
  - architecture/discipline/evidence-and-premise-discipline
  - architecture/crosscut/information-hiding
---

## Context

The lab behavioral grader runs a model's candidate **source** patch + the SEALED `test_patch`, then
pytest, and reports per-test pass/fail. The grade is the substrate's "did the model actually resolve the
issue" signal. ③.2's live external-PR beta (Path-1) shows a HUMAN a grade computed over a stranger's repo
before they push, so a forged grade is a real harm vector — hence the ③.2.1a grade-integrity wave.

PR-1 (merged #383) closed the test-tree-mutation, diff-scope, and pytest-autoload classes. PR-2 (forge)
set out to close the **headline** vector: the `__LOOM_TEST_RESULT__` stdout sentinel is last-line-wins, so
a candidate could forge a PASS. The proposed fix was a per-run nonce + first-wins parsing.

**A firsthand exploit (reproduced) falsified the nonce as a close.** The grader runs the candidate's
collected code IN-PROCESS with the result reporter (one `python3 -c` interpreter — the tests *import* the
code-under-test by construction). A candidate non-test source file:

1. recovered the nonce in-process via `vars(sys.modules['__main__'])` — **no `/proc`, on macOS** (the live
   sandbox-exec backend), generalizing to any in-process secret (an inherited-fd HMAC key is equally
   recoverable from the loaded plugin object); and
2. monkeypatched `json.dumps` (which the wrapper calls AFTER `pytest.main`, outside pytest's capture) so a
   forged PASS line landed BEFORE the wrapper's legit FAIL line → first-wins returned PASS for a test that
   really FAILED.

A 2-lens design board (architect + hacker, each with live probes) then evaluated **every** isolation
mechanism. Verdict: **BOUND-ONLY / NOT-CLOSEABLE for arbitrary import-based suites.** Scorecard:

| Mechanism | Against the grade forge |
|---|---|
| uid-separate candidate from a reporter inside the container | INEFFECTIVE (one Python heap; uid does not partition a process's memory) |
| trust pytest's process EXIT CODE | INEFFECTIVE (`os._exit(0)` / `pytest.exit(returncode=0)` forge it; proven) |
| `--junitxml` to a protected/append-only path | INEFFECTIVE (a `pytest_runtest_makereport` hook flips outcome BEFORE serialization; proven) |
| inherited-fd / out-of-band channel + secret | INEFFECTIVE (fd + secret live in the candidate's address space) |
| gVisor / seccomp / ptrace | CLOSES-HOST-ONLY (the forge is legal attribute-assignment + a permitted `write(1)`; byte-identical to the real write) |
| differential baseline-vs-candidate | BOUNDS only (the candidate leg still runs candidate code; the FAIL→PASS transition is the exact signature of a real fix) |
| RPC: assertion in a trusted process that never imports candidate code | **CLOSES-FORGE — the only one** — but XL, and NOT a drop-in for arbitrary stranger pytest suites (they import-and-call in-process), so it changes the corpus contract |

This is the **assertion-oracle structural floor**, and a face of the substrate's existing law: **integrity ≠
provenance** (the #273 family). Any result ARTIFACT the test process produces — stdout sentinel, junit XML,
inherited-fd frame, in-process return value — is self-consistent yet **candidate-minted**; verify-on-read
proves a line was *emitted*, never that the *trusted reporter* emitted it. It is also OQ-NS-6 restated:
only a world-anchored merge (or a non-LLM out-of-band oracle) HARDENS trust; an in-process check NARROWS.

## Decision

1. **The lab behavioral grade is integrity-BOUNDED, not provenance-CLOSED.** It is a SHADOW/advisory
   NARROWING signal. **It MUST NEVER gate an action** (a merge, an auto-PR, a trust-weight that gates) while
   the code-under-test runs in the grading process. This is the same disposition the #273 forged-edge took:
   tolerable precisely because the weight stayed advisory.

2. **Ship the achievable BOUNDS (raise forgery cost; never claim closure):**
   - `parseTestStatus` rejects **>1 sentinel line** fail-closed (all-missing), never last-wins — kills the
     naive double-emit forge the exploit reproduced; surfaces `sentinel_count`.
   - The grader `applyPatch` runs under `core.attributesFile=/dev/null` (#6) — neutralizes a host-global
     gitattributes file's influence on the apply (eol/text normalization AND a filter-driver assignment,
     both of which `git apply` honors — proven).
   - Retain the PR-1 controls: the test-tree rehash (C1), the diff-scope reject, and
     `PYTEST_DISABLE_PLUGIN_AUTOLOAD` + `--confcutdir` + `PYTEST_ADDOPTS`/`PYTEST_PLUGINS` scrub.

3. **The full close is mechanism-7 (a trusted-process assertion minter), deferred to the named trigger
   "a lab grade first GATES an action."** It is the ContainerAdapter/v-next escalation. It requires moving
   the assertion into a process that never imports candidate code (an RPC/output-equivalence contract),
   which changes what the corpus can grade — not worth its XL cost while the grade is advisory.

4. **Process/container isolation (the Docker backend, #346) is the close for the HOST axis, not the grade
   axis.** `--network none` / `--cap-drop ALL` / `no-new-privileges` / `--read-only` / non-root `--user`
   close host-compromise/escape (the threat that actually matters for running a stranger's code in ③.2.2);
   they do not — and cannot — close the in-process grade forge.

## Consequences

- **③.2.2 go-live framing is constrained:** the automated grade is a narrowing signal bounded by Path-1
  **human review** (an in-process forge requires forge code in the candidate diff the human reviews) — the
  beta MUST NOT claim the automated grade is adversarially trustworthy, and MUST NOT let it gate.
- **The residual is named, not papered over:** a determined in-process candidate can still forge its own
  leg (suppress the wrapper's line and emit one forged line; flip a report hook). The bounds make the forge
  EXPENSIVE and NARROW, not impossible.
- **The v-next trigger is explicit:** the day a lab grade is proposed to gate an action, mechanism-7 (or an
  out-of-band non-LLM oracle) is a hard precondition — re-open this ADR then. Until then, the bounds + the
  SHADOW disposition are the accepted posture.
- **Kin to ADR-0012:** do not build enforcement on a mechanism that does not deliver — the nonce was a
  capability the threat model defeats, caught at design VERIFY (firsthand probe) before it shipped.
