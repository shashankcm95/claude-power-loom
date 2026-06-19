# Ghost Heartbeat — W1: drift STORE correctness + gated auto-SURFACE

> Plan artifact (per-wave workflow). Wave 1 of a multi-wave arc. **Scope expanded
> (user direction: "scope it explicitly") to include the gated SURFACE re-registration**,
> after firsthand evidence showed the 2026-05-30 noise risk is already mitigated
> at the producer. Round-1 verify board (3/3 NEEDS-REVISION) folded; Round-2
> board re-verifies the surface delta. See Pre-Approval Verification.

## Context

The user wants ghost protocol + self-improvement + drift detectors to run as a
**continuous heartbeat without explicit commands**. We shipped that heartbeat
(H.4.1) and **retired half of it (2026-05-30)** because the automated
`filePath:`/`command:` frequency half produced 91.5%-dismissal noise; the
value-bearing `drift:` taxonomy was left manual and silently lapses.

The `drift:` loop has **three dead links** (verified firsthand, not inherited
from the drift-taxonomy doc which flagged its own over-claims):

| Link | State (firsthand) | Wave |
|---|---|---|
| **EMIT** — auto-write `drift:` signals | dead — only `scan-stale-artifacts.js` auto-emits (`workspace-hygiene-debt`); all other drift emit is a manual `bump` | **Wave 2** |
| **STORE** — classify + converge correctly | **broken — this wave** | **Wave 1** |
| **SURFACE** — auto-prompt the queue | dead — `session-self-improve-prompt.js` un-registered from `hooks.json` (retired with the frequency half) | **Wave 1 (gated)** |

**Wave 1 fixes STORE + SURFACE.** EMIT stays Wave 2 (it needs an advisory LLM
drift-producer — a deterministic hook cannot judge drift-worthiness, which is
exactly why the frequency half failed). After Wave 1, a `drift:` signal that
reaches its convergence count (manually bumped, or `workspace-hygiene-debt`
auto-emitted) is correctly classified, queued, AND auto-surfaced to the user at
session start — the loop runs end-to-end **except** the auto-emit step.

**Why re-registering the retired SURFACE hook is safe now (the firsthand
de-risk):** the noise that got it retired came from the PRODUCER, which is dead:
- `auto-store-enrichment.js:209` — "Self-improve FREQUENCY capture RETIRED
  (2026-05-30) ... retired AT SOURCE." No fresh `filePath:`/`command:` candidates
  are created.
- Live `self-improve-pending.json` = **63 candidates, ALL terminal** (61
  dismissed, 2 promoted), **0 in `pending`** status; all are legacy
  `observation-log`(57)/`skill-candidate`(6). The surface only shows
  `pending`/`auto-graduated`, so re-registering it today surfaces **nothing**.
- Post-Wave-1, new `pending` candidates are converged `drift:` -> `rule-candidate`
  only. A **kind-gate** on the surface (allowlist `rule-candidate` +
  `agent-evolution`) makes it safe even if a stray frequency candidate ever
  re-enters `pending` — noise-reintroduction is closed by construction, not by
  trusting the producer to stay dead.

**Standalone value:** live counters already hold converged drifts invisible today
(`drift:plan-honesty=3`, `drift:dictionary-gap=3`); after Wave 1 they classify,
queue, and surface for `/self-improve` triage.

## Routing Decision

```json
{
  "recommendation": "route",
  "route_decide_raw": { "recommendation": "root", "score_total": 0.15, "confidence": 0.5, "matched": ["compound_strong:protocol"] },
  "escalation": "judgment-override per route-decide.js:11-13 + workflow rule (substrate-meta catch-22)"
}
```

`route-decide` returned `root` (0.15) — the **substrate-meta catch-22**: the task
changes the self-improve machinery itself, so the scorer cannot see its own
stakes (only `protocol` matched). Escalated to **route**: env-wide blast radius
(touches the prompt pipeline of every session), documented prior failure
(2026-05-30), explicit user request for full rigor.

## HETS Spawn Plan

- **VERIFY round 1 (store scope):** architect + code-reviewer + honesty-auditor —
  DONE (3/3 NEEDS-REVISION, folded; see Pre-Approval Verification).
- **VERIFY round 2 (surface delta):** architect + code-reviewer + honesty-auditor
  re-verify ONLY the surface re-registration + kind-gate (is re-introducing a
  retired hook justified now; is the gate adequate; is the `hooks.json` wiring +
  fail-open + idempotency correct). Required because this touches every session's
  prompt pipeline.
- **BUILD:** root or `node-backend` — TDD test-first.
- **VALIDATE (post-build):** code-reviewer + honesty-auditor, the latter charged
  to prove a converged `drift:` candidate is SEEN end-to-end (the hook fires AND
  renders it), not merely written to `pending.json`.

## Files To Modify

| File | Change |
|---|---|
| `packages/kernel/spawn-state/self-improve-store.js` | Single `signalPolicy(signal) -> { kind, risk, candidateThreshold }` resolver (extends/absorbs `inferKindFromSignal` — ONE classification chokepoint). Allowlist branches: `drift:` -> `{rule-candidate, high, 3}`; `rule-recurrence:` -> `{rule-candidate, high, 3}` (retune-specific `proposedAction`). **Catch-all default `observation-log`/low/5 UNCHANGED** (so `improvement-effectiveness:` + unknown signals stay low/log; closes the noise vector by construction). In `_runScan`: replace the global `if (entry.count < THRESHOLDS.candidate) continue;` pre-filter (~line 286) with per-signal `signalPolicy(signal).candidateThreshold`; re-derive kind/risk from `signalPolicy` on the existing-candidate path (~line 303) instead of trusting stored `existing.risk` (closes the migration hazard). |
| `packages/kernel/hooks/lifecycle/session-self-improve-prompt.js` | **(1) FIX the I/O contract (Round-2 HIGH, firsthand-probed):** the hook reads stdin as RAW text and emits `input + suffix` — an OLD UserPromptSubmit contract. The current contract (per the working sibling `prompt-enrich-trigger.js:400-437`) is: stdin = the JSON event envelope; emit ONLY the added-context string (NOT `input + ...`). Rewrite to `JSON.parse(input)` -> use `data.prompt` / `data.session_id`, and `process.stdout.write(suffix)` alone (suffix empty when nothing to surface). Use `data.session_id` for the per-session idempotency key (replacing the env/ppid fallback). Keep fail-open (any parse/read error -> emit nothing, never throw). **(2) Gate the surface**: `visible = candidates.filter(c => c.status==='pending' && HIGH_VALUE_KINDS.has(c.kind))`, `HIGH_VALUE_KINDS = {'rule-candidate','agent-evolution'}`. **(3) Drop the now-dead `auto-graduated` branch** of `buildReminder` (Round-2 LOW + honesty MED): high-value kinds are `high` risk and never auto-graduate, so that branch is unreachable. This is an intentional, named behavior change — **low-risk auto-graduated items are no longer auto-surfaced** (they remain inspectable via `self-improve-store.js pending`). |
| `packages/kernel/hooks.json` | Register `session-self-improve-prompt.js` as a 2nd `UserPromptSubmit` entry (matcher `*`, after `prompt-enrich-trigger.js`), `${CLAUDE_PLUGIN_ROOT}` command shape, **`timeout: 3`** (mirror the sibling; Round-2 MED). |
| `tests/unit/scripts/self-improve-store.test.js` | TDD-first store contract (see Phases). |
| `tests/unit/hooks/session-self-improve-prompt.test.js` (new or extend) | Pin (a) the **I/O contract**: feed a JSON event envelope on stdin -> the hook emits ONLY the reminder (or empty), never the echoed envelope; a malformed-JSON stdin -> emits nothing (fail-open). (b) the **gate**: a `rule-candidate`/`pending` candidate surfaces; `observation-log`/`skill-candidate`/`pending` does NOT; empty/terminal-only queue injects nothing. (c) idempotency keyed on `data.session_id`. Extract the gate predicate + the event-parse to testable exports if needed. |
| `ghost-protocol/volumes/drift-taxonomy.md` (library volume) | STORE + SURFACE corrections FALSE -> FIXED (dated, refs this wave); EMIT remains open (Wave 2). Keep the append-only signal-name rule. |

## Phases

1. **TDD red** — write the contract, run vs current impl -> expect failures. Store tests:
   - `drift:X`@3 -> pending/`rule-candidate`/high; `drift:X`@2 -> NO candidate; `drift:X`@10 -> still pending, NOT auto-graduated.
   - cross-class isolation: `drift:X`@3 queues AND `filePath:Y`@3 does NOT (same scan).
   - `improvement-effectiveness:Z`@3 -> NO candidate; @5 -> low/observation (never rule-candidate).
   - `rule-recurrence:W`@3 -> pending/high with retune action.
   - migration: pre-existing `pending` candidate stored `observation-log`/`low` with signal `drift:X` -> re-derived high on re-scan, NOT auto-graduated.
   - regression: `filePath:`/`command:`/`rule:`/`agent:`/`pattern:` unchanged (T1–T15 green).
   Surface tests: I/O contract (JSON event in -> reminder-only out; malformed -> empty) + gate allowlist + idempotency (above).
2. **Impl green** — `signalPolicy` + `_runScan` pre-filter + existing-candidate re-derive; surface gate filter; `hooks.json` entry. No scope creep beyond failing tests.
3. **Doc** — `drift-taxonomy.md` (STORE + SURFACE FIXED; EMIT open).
4. **VALIDATE** — code-reviewer + honesty-auditor (charged per HETS plan); fold; full pre-push gate (`bash install.sh --hooks --test` + full kernel suite + the new tests). **`install.sh --hooks --test` is load-bearing here** — it validates the new `hooks.json` registration against a fresh environment. PR for the USER merge gate.

## Principle Audit

- **KISS** — one `signalPolicy` resolver + two allowlist branches + a one-line
  surface filter; no config registry (YAGNI).
- **YAGNI** — no auto-EMIT, no bounded-loop wrapper, no cron in this wave.
- **SRP** — `signalPolicy` is the single classification+threshold chokepoint;
  the surface owns only the gate filter.
- **OCP** — extend by adding allowlist branches + one filter; existing kinds,
  the catch-all default, and `buildReminder`'s rendering untouched.
- **DRY** — reuse `KIND_RISK` + `HIGH_VALUE_KINDS` derived from it; no parallel
  risk table.

## Verification Probes

Firsthand (done):
- `grep -c session-self-improve hooks.json -> 0` — SURFACE unregistered (only `prompt-enrich-trigger.js` wired on UserPromptSubmit).
- `auto-store-enrichment.js:209` — frequency PRODUCER retired at source; no fresh `filePath:`/`command:` candidates.
- `pending.json -> 63 candidates, 0 pending` (61 dismissed/2 promoted; 57 observation-log/6 skill-candidate) — re-registering surfaces nothing today; stale junk is terminal + excluded by status AND the new kind-gate.
- `THRESHOLDS.candidate=5` + `_runScan:286` global pre-filter — bug 1 + the trap.
- `inferKindFromSignal:162-170` no `drift:` branch, catch-all `observation-log` -> low — bug 2.
- `_runScan:303` reads stored `existing.risk` — migration hazard (currently no-op: 0 drift candidates pending).
- live counters: `drift:plan-honesty=3`, `drift:dictionary-gap=3` (converged, waiting); `improvement-effectiveness:phase-close=4` (rule WORKED — must NOT become a rule-candidate; validates the lens split).

- **UserPromptSubmit I/O contract (Round-2 HIGH, firsthand-probed):** `prompt-enrich-trigger.js:400-437` (the working sibling) does `JSON.parse(input)` -> `data.prompt`, and `stdout.write(instruction)` ALONE (or nothing). Piping a JSON envelope `{"prompt":"...","session_id":"..."}` into the surface hook's current raw-stdin model proves it would emit `input + suffix` = the echoed JSON envelope — broken under the current contract. Fix = mirror the sibling (parse the event; emit the reminder alone).

Post-build: the Phase-1 test contract (store + surface gate + I/O contract).

## Out of Scope (Deferred to Wave 2)

- **Auto-EMIT** — the advisory LLM drift-producer (session-end review writes
  `drift:` signals). A deterministic hook cannot judge drift-worthiness. This is
  the one remaining dead link after Wave 1.
- The **bounded-loop wrapper** (Observe -> Choose -> Act:draft-only -> Verify ->
  Record -> no-progress-stop) + cron/`schedule` carrier. **Promotion stays
  human-gated** (`/self-improve` for medium/high) — continuous *proposal*, never
  continuous *mutation*.
- **Re-enabling the `filePath:`/`command:` frequency producer** — retired for
  cause. Never.

## Drift Notes

- `drift:plan-honesty` (graduated rule — caught fresh, this session): the
  original plan claimed "bug 3 for free" after probing `buildReminder`'s BODY but
  never whether the hook FIRES (`hooks.json` registration). Round-1 board CRITICAL
  caught it; firsthand `grep -c = 0` confirmed. Bump
  `improvement-effectiveness:adversarial-review-plan-honesty`.
- `drift:route-meta-catch22` — `route-decide` scored a change to its own
  machinery `root` (0.15). `[ROUTE-META-UNCERTAIN]` effectiveness data point.

## What this DOESN'T claim to fix

After Wave 1, **one** signal class already runs fully unattended: `scan-stale-artifacts.js`
auto-emits `drift:workspace-hygiene-debt`, which (post-Wave-1) converges ->
classifies -> auto-surfaces with no command at all (Round-2 honesty LOW — the
earlier "only a manual bump" framing under-credited this live auto-path). What
Wave 1 does NOT deliver is **general** auto-EMIT: a `drift:` signal for an
arbitrary class (plan-honesty, recon-depth, a CWE class, ...) still needs a
manual `bump`, because judging drift-worthiness across classes requires the
Wave-2 advisory LLM producer — a deterministic hook cannot, which is exactly why
the frequency producer failed. So "no explicit commands" is true today for
workspace-hygiene drift and reached for all drift only when Wave-2 EMIT lands.

## Pre-Approval Verification

### Round 1 — store scope (DONE)

**Board:** architect + code-reviewer + honesty-auditor (run `wf_0d5c586e-417`).
**3/3 NEEDS-REVISION** — folded; each re-probed firsthand.

| # | Sev | Finding | Resolution |
|---|---|---|---|
| 1 | **CRITICAL** | "Bug 3 for free" FALSE — surface hook not registered | Re-probed `grep -c=0`; SURFACE now explicitly in scope (gated) per user direction. |
| 2 | **HIGH** | No auto `drift:` producer either | EMIT named as the one remaining Wave-2 dead link; framing corrected. |
| 3 | **HIGH** | Migration: stale `risk:low` drift candidate auto-graduates at 10 | existing-candidate path re-derives from `signalPolicy`; re-probed 0 drift candidates pending. |
| 4 | **HIGH/MED** | Catch-all hardening + unspecified kinds, no tests | catch-all UNCHANGED (allowlist only); kinds specified; pinning tests added. |
| 5 | **MED** | `_runScan:286` global pre-filter skips drift@3-4 before classification | per-signal `candidateThreshold` in the resolver. |
| 6 | **MED** | `improvement-effectiveness:` is "rule WORKED", not a rule-write | stays catch-all low/log; validated by live `…phase-close=4`. |
| 7 | **MED** | Missing boundary tests | count=2 + cross-class isolation + effectiveness + migration added. |
| 8 | **LOW** | VALIDATE should prove end-to-end surfacing | charge added; now testable since SURFACE is in scope. |

### Round 2 — surface delta (PENDING)

**Board:** architect + code-reviewer + honesty-auditor (run `wf_467e5076-3d6`),
scoped to the surface delta only. **Verdict: architect NEEDS-REVISION + 2
PASS-WITH-NOTES.** The re-registration DECISION is **endorsed** (the kind-gate is
the right safety boundary, stronger than producer-death alone, coherent with the
store risk model — both allowlisted kinds are `high`, which never auto-graduate,
so `status==='pending'` is the only reachable surfacing path). All findings
folded; the HIGH was firsthand-re-probed.

| # | Sev | Finding | Resolution |
|---|---|---|---|
| 1 | **HIGH** | The two `UserPromptSubmit` hooks have incompatible stdin/stdout contracts — `prompt-enrich-trigger` JSON-parses the event + emits the instruction alone; the surface hook reads raw stdin + echoes `input + suffix`. ADR-0012-class harness premise, unprobed. | **Firsthand-probed** (`prompt-enrich-trigger.js:400-437` + a stdin echo test): confirmed broken. Fix folded into Files-To-Modify item (1): rewrite the surface hook to the JSON-event contract (parse, emit reminder-only, key idempotency on `data.session_id`). Added to probes + the surface test contract. |
| 2 | **HIGH/LOW** | Kind-gate strands `buildReminder`'s `auto-graduated` branch as unreachable dead code; no test | Drop the dead branch (Files-To-Modify item 3); named the intentional behavior change (low-risk auto-graduated items no longer auto-surfaced, still in the `pending` CLI); test asserts it. |
| 3 | **MED** | `hooks.json` timeout unspecified -> builder guesses | Specified `timeout: 3` (mirror the sibling). |
| 4 | **MED/LOW (honesty)** | "Safe by construction" mildly over-claimed (silently drops the auto-graduated surface); "only a manual bump" under-credits the `workspace-hygiene-debt` live auto-emit | Behavior change named (above); "What this DOESN'T claim" rewritten to credit the one unattended auto-path and bound the rest to Wave-2 EMIT. |
| — | NOTE | Re-registration justified; gate correct (junk kinds cannot reach surface); fail-open + idempotency intact; Wave line coherent | Endorsed; no change. |

**Net:** decision endorsed; the one HIGH (harness I/O contract) is firsthand-probed
and fixed in-plan; no CRITICAL or unresolved HIGH remains. Ready for the build gate.

## VALIDATE result (post-build, on the diff)

**Board:** code-reviewer + honesty-auditor (run `wf_e5cde6ba-b0a`) on the built
diff. **Verdict: both PASS-WITH-NOTES** — no CRITICAL/HIGH, no correctness bug.
The code-reviewer traced every boundary (count===threshold for drift(3) +
default(5); per-class isolation; the migration re-derive vs the auto-graduate
gate; T1-T15 regressions; surface fail-open completeness) and confirmed all
correct. Notes folded:

| Sev | Finding | Resolution |
|---|---|---|
| **MED (honesty)** | "Runs end-to-end" pinned by a manual probe only — no test composes STORE -> `pending.json` -> SURFACE (the schema-contract seam) | **Added S7** (composed test): the REAL `scan` PRODUCES `pending.json`, the REAL hook CONSUMES it and renders the drift candidate. The seam is now a pinned regression (Rule-2a-corollary), not a one-off probe. |
| **NOTE (reviewer)** | `rule-recurrence:` migration path not independently tested | **Added T22b**. |
| **NOTE (honesty)** | env/ppid `session_id` fallback unpinned | **Added S8**. |
| **LOW (honesty)** | "SessionStart" label inaccurate — the hook is `UserPromptSubmit` | Source comments + `proposedAction` text corrected to "first-prompt-of-session (UserPromptSubmit, idempotent per `session_id`)". |
| **LOW (reviewer)** | idempotency mark persisted AFTER stdout -> a `writeAtomic` failure re-shows once | Pre-existing; left as-is — re-showing once on a rare atomic-write failure is acceptable for an advisory reminder (losing the show would be worse). Documented, not changed. |

**Test totals:** store **25/25**, surface **8/8** (incl. the composed S7),
kernel suite no regressions, eslint clean. Pre-push gate **123/124** — the one
failure is `contract-plugin-hook-deployment` flagging that the locally-installed
plugin (v3.9.0) predates the new hook; the contract **auto-passes in CI**
(fresh checkout, no installed cache — `contracts-validate.js:638-645`) and
resolves after release + `/plugin update`. Not a code defect.
