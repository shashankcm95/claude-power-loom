# Router-V2 W2 — the Runtime inference layer at the borderline seam (WAVE plan)

- **Status:** BUILT + gate-green — pending the VALIDATE board + the USER merge gate. See `## Build result`.
- **Phase:** Router-V2 (W1 lexicon-as-data #366 + corpus-aug PR-1 #368 / PR-2 #370 all MERGED). W2 is the runtime-inference wave; W3 (lexicon curation) + W4 (weight refit) follow.
- **Mechanism:** branch `feat/router-v2-w2-runtime-borderline` off `origin/main` (99471c2); plan → VERIFY → TDD build → VALIDATE → PR for the USER merge gate.
- **Design seeds:** `plans/2026-06-19-router-v2-phase-plan.md` (W2 row) · the corpus-aug eval set (`packages/specs/bench/router-v2/route-eval-set.jsonl`; 25 scorer-borderline-band rows, 80% route-labeled) · `forcing-instruction-family.md` (the family's anti-proliferation discipline — W2 adds NO marker) · the **USER W2 directive (2026-06-19): borderline tasks ESCALATE to HETS, not root.**

## Context / Goal

The A4 scorer (`route-decide.js`) returns `borderline` when `ROOT_THRESHOLD(0.30) < score_total < ROUTE_THRESHOLD(0.60)`. Today the borderline band is surfaced (the decomposition + the Class-1 forcing instructions) and the orchestrator/user picks. **W2 adds a Runtime inference layer at that seam** that makes the *semantic escalation* — reading the scorer's JSON and, per the USER directive + the corpus evidence (the scorer massively UNDER-routes: PR-2 measured route-band 0/575), **defaulting borderline → route (HETS)** with a semantic safety valve to demote to root only when clearly trivial. It lives in **Runtime, NEVER `kernel/algorithms`** (A4 purity: the scorer stays pure/deterministic/no-LLM/no-I/O), is **advisory** (helped, not gated — OQ-NS-6: never hardens the scorer into a blocker), and **extends the forcing-instruction-as-abstraction pattern**.

## Routing Decision (substrate-meta catch-22)

```json
{ "task": "build Router-V2 W2: a Runtime inference layer at the borderline seam",
  "scorer_self_score": "LOW/borderline — detectSubstrateMeta fires on route-decide/borderline/forcing-instruction tokens; the scorer under-scores its own meta-work; emits [ROUTE-META-UNCERTAIN]",
  "decision": "route (override by judgment — a new Runtime layer with non-obvious tradeoffs: new-marker-vs-extend, default-route-vs-nudge, where-it-plugs-in, the forcing-instruction anti-proliferation discipline).",
  "rationale": "Every Router-V2 wave force-routes (the catch-22). Genuinely architect-shaped." }
```

## Runtime Probes (firsthand-read 2026-06-19, the W2 worktree)

| Claim | Probe | Result |
|---|---|---|
| "borderline is a clean band in the scorer" | `route-decide.js:566-578` | **YES.** `>= 0.60 → route`, `<= 0.30 → root`, else `borderline`; the band already has an H.7.3 "borderline escalates to the user" philosophy (`:586`) + a root→borderline promotion rule (`:588-599`). |
| "the scorer emits forcing instructions in its JSON" | `route-decide.js:644-657, 724, 736-738` | **YES.** `forcing_instruction` ([ROUTE-DECISION-UNCERTAIN], fires only on bare-low-signal-no-context) + `meta_forcing_instruction` ([ROUTE-META-UNCERTAIN]) are fields in the output JSON. NEITHER fires on a plain signal-bearing borderline. |
| "W2 must NOT touch the kernel" | phase-plan W2 row + `route-decide.js` A4 header | **CONFIRMED.** Runtime/orchestrator only; the scorer is A4-pure. The kernel cannot depend on Runtime (dependency-inversion) → the spawn hook (`route-decide-on-agent-spawn.js`, kernel) CANNOT call W2; W2 is consumed by the ORCHESTRATOR gates. |
| "the orchestrator consumes route-decide at a clean seam" | `commands/build-team.md:36` + `build-team-helpers.sh:77-91,261` + `build-plan.md:31,104` | **YES.** `/build-team` Step 0 calls `route-decide-gate` (bash helper, emits recommendation+score+reasoning+uncertain); `/build-plan` Step 0 runs route-decide.js + computes `convergence_value`. The gate **fail-opens to `{recommendation:"route"}`** when the script is missing — the substrate ALREADY leans route on uncertainty. |
| "the score-value consumer buckets the band" | `trust-scoring.js:111-128` | `bucketTaskComplexity` maps `score_total` → trivial(<0.30)/standard(<0.60)/compound(>=0.60); **borderline == `standard`**. A SCORE-VALUE dependency (hardcoded 0.30/0.60, NOT imported thresholds — the W4 threshold-leak). W2 does NOT change scores → this consumer is untouched. |
| "the forcing-instruction family has an anti-proliferation discipline" | `forcing-instruction-family.md` (drift-note 21/57, H.8.8 row) | **YES — load-bearing.** The family grew 1→11 then consolidated; the live active count is **10 (H.8.8), cap 15, 5 headroom**; count-growth is a flagged "smell". **VERIFY-RESOLVED: W2 adds NO marker** — it returns structured fields (a reader, not an emitter; same class as `[ROUTE-DECISION-UNCERTAIN]`). |
| "the eval set validates the borderline→route policy" | `packages/specs/bench/router-v2/route-eval-set.jsonl` (firsthand-read, worktree off PR-2 merge) | **PARTIAL + DISAMBIGUATED.** 712 rows = 575 route / 70 root / 67 LABEL-borderline by `correct_route`; by SCORER `band` = 0 route / **25 borderline** / 687 root. **W2 fires on the 25 SCORER-borderline-band rows** (labels: 20 route / 5 root / 0 borderline ⇒ 80% route-match), NOT the 67 LABEL-borderline rows (those are scorer-ROOT-band — escalating them would be a harness regression). NARROWS-only, N=25 low-power. |

## Design (FOLDED from the VERIFY board — 2026-06-19)

A pure Runtime module `packages/runtime/orchestration/borderline-resolver.js`:

- **`resolveBorderline(scorerJson, opts)`** → reads the route-decide JSON as a DATA contract (never imports the kernel). Fires when `recommendation === 'borderline'` OR the zero-signal `uncertain` instruction fired. Returns **STRUCTURED FIELDS, NOT a forcing-instruction marker** (W2-H2/OQ-W2-1 — W2 is a downstream READER of route-decide's stdout, not an emitter; the family is at **10/15** and just consolidated 11→10, and borderline-escalation is the SAME response class as `[ROUTE-DECISION-UNCERTAIN]`): `{ resolved_recommendation, escalated: bool, policy, reasoning }`.
- **Policy (the NUDGE):** the scorer-borderline band defaults `resolved_recommendation = 'route'` (escalate to HETS) with `reasoning` carrying the **demote-to-root-ONLY-if-the-full-task-is-genuinely-trivial** semantic safety valve for the in-loop orchestrator. The valve keeps it advisory (OQ-NS-6); a hard always-route would remove the valve + violate the law. **No LLM call in W2** — the in-loop Claude is the inference (the forcing-instruction abstraction's whole point); W2 stays fast/cheap.
- **Compose, don't duplicate (OQ-W2-4):** when the kernel already emitted `[ROUTE-DECISION-UNCERTAIN]` (zero-signal case), W2 layers `resolved_recommendation=route` + a one-line note ON TOP — never re-stating the kernel's text. **The `[ROUTE-META-UNCERTAIN]` / substrate-meta case is SCOPED OUT of the route-default** (honesty OQ-W2-4): meta-detection is a score-suppression catch-22 artifact, NOT an under-routing signal — auto-routing meta tasks conflates two failure modes + risks over-routing. Meta keeps its own advisory untouched.
- **A4 purity + fail-open (OQ-W2-3 / W2-M2):** `route-decide.js` is never edited; the arrow is orchestrator(runtime) → resolver(runtime) → reads scorer JSON (no kernel→runtime dep, no cycle). W2 parses DEFENSIVELY and **FAIL-OPENS to `{resolved_recommendation:'route', escalated:false, reasoning:'route-decide JSON unparseable; defaulting to route (fail-open)'}`** on empty/malformed input (the kernel can exit 3 with no stdout on a bad lexicon — W2 must not throw + halt the Step-0 gate; that would convert advisory into an availability risk). Mirrors `build-team-helpers.sh:91`.
- **Consumed by** the Step-0 gates (`route-decide-gate` in build-team-helpers.sh + `/build-plan` Step 0) — a thin `node borderline-resolver.js` call on the route-decide JSON, mirroring the existing shell→node pattern.

### Scope boundary (W2-H1 — do NOT over-claim)

**W2 fires ONLY on the scorer-borderline band (25 corpus rows) + the zero-signal `uncertain` case. It does NOT touch the 555-row dominant under-routing class** (`scored root but labeled route`) — those surface as `recommendation==='root'`, outside W2's trigger. That class is **W3's job** (the lexicon curation + the `experiment` double-count de-dup at `route-decide.js:85`/`:170`). W2 is a **seam-local escalation of the genuine-ambiguity band, NOT a fix for the dominant misclass**; the 0/575 route-band figure is a root-band fact and is NOT W2's justification.

### The route-default's actual evidence (firsthand cross-tab — NOT 0/575)

Of the **25 rows the scorer bands borderline** (the slice W2 fires on, disambiguated from the 67 LABEL-borderline rows which are scorer-ROOT-band and W2 never touches), the blind N=3 + cross-family labels split **20 route / 5 root / 0 borderline** — so W2's route-default **matches the label 20/25 (80%)** and over-escalates 5. Corroborated by the cross-family GPT (1/23 contested → root) + the USER directive. **Honest bounds:** N=25 is low-power; the labels are LLM-derived + corpus-biased (PR-2's disclosed residuals); this NARROWS (supports the default, bounds the over-escalation at ~20%), it does NOT prove correctness. The demote-if-trivial valve is the mitigation for the 5.

### Backtest (OQ-W2-5 — descriptive, narrows-only; reuse the harness's discipline, not its scorer-gate)

A thin backtest over the **scorer-borderline-band rows ONLY**: report the 20/5/0 label split + the 80% route-match as **descriptive, low-power, narrows-only** evidence. **NEVER fed through `shadow-eval.js`'s old-vs-new SCORER gate** — W2 is not a scorer change, and escalating a LABEL-borderline row would register as a harness regression (the honesty board's catch); the disambiguation (scorer-band slice, not label-borderline) is exactly what makes the measurement honest. Reuse the harness's reporting discipline (no trust+pass-rate co-location); build no new infra.

### Open questions — RESOLVED by the VERIFY board

- **OQ-W2-1 → structured fields, NO new marker** (reader-not-emitter; same class as `[ROUTE-DECISION-UNCERTAIN]`; family 10/15).
- **OQ-W2-2 → nudge** (default route + demote-if-trivial valve as a structured field; never a hard route).
- **OQ-W2-3 → JS Runtime module** (A4 boundary holds) + the fail-open parse contract.
- **OQ-W2-4 → cover borderline + zero-signal uncertain; SCOPE META OUT** of the route-default (compose, don't duplicate).
- **OQ-W2-5 → descriptive narrows-only on the 25 scorer-band rows; not the scorer-regression gate, not "toward the label" on the label-borderline set.**

## Load-bearing constraints

- **A4 purity:** `route-decide.js` (and any `kernel/`) is NEVER edited by W2; the inference lives in Runtime. The kernel cannot depend on Runtime.
- **Advisory only (OQ-NS-6):** W2 helps, never gates/blocks; it returns a recommendation + a valve, never a `decision: block`.
- **No new forcing-instruction marker:** W2 returns structured fields (it is a reader, not an emitter); the family stays at 10/15.
- **No LLM in the routing path:** the in-loop Claude is the inference; W2 makes no model call.
- **The USER directive is the policy:** borderline defaults to route (HETS); the only path to root is a semantic demote of a clearly-trivial full task.
- **Disclosed sacrifice (HON-W2-2):** today the borderline band surfaces a user MENU and WAITS (`build-plan.md:66-76`, `build-team.md:46`) — it does NOT default. W2's route-default nudge replaces that user-decision pause with a route-leaning default the orchestrator may accept; the valve keeps it advisory, and the sacrifice (a user gate at the ambiguity zone becomes a default) is named, not hidden.
- **Over-routing cost asymmetry (HON-W2-3):** the scorer exists to avoid the ~30x cost of over-routing (`route-decide.js:11-13`). W2's default over-escalates ~5/25 (the root-labeled scorer-borderline rows); the valve + the 80% route-match bound the risk. The route-lean's support is the 20/25 + cross-family GPT (1/23 root), NOT the 0/575 root-band figure.

## HETS Spawn Plan

- **VERIFY (this plan):** `architect` (LEAD) + `honesty-auditor` — DONE (see below).
- **BUILD:** `node-backend` (the `borderline-resolver.js` module + the bash gate wiring + the thin backtest, TDD). **VALIDATE:** `code-reviewer` (correctness + the A4 boundary actually holds) + `honesty-auditor` (the policy/narrows-only/disclosure claims). No new input-trust surface (W2 reads the kernel's own JSON) → 2-lens, add `hacker` only if the build surfaces one.

## VERIFY board result (2026-06-19)

Architect-led 2-lens board. **architect READY-WITH-NOTES + honesty-auditor NEEDS-REVISION** — the MODULE design (Runtime JS, A4-clean, nudge, no-LLM, compose-not-duplicate) was blessed by both; the NEEDS-REVISION was on the PLAN's claims (the marker, the scope, the backtest framing), all folded above. The keystone correction: the honesty board read W2 as escalating the 67 LABEL-borderline rows (a harness regression); the firsthand cross-tab shows W2 fires on the **25 SCORER-band-borderline rows**, which are **80% route-labeled** — the policy is *better*-supported than the plan first claimed.

| ID | Lens | Sev | Finding | Resolution (folded) |
|---|---|---|---|---|
| W2-H1 | architect | HIGH | scope-vs-evidence gap: the 0/575 under-routing is the ROOT band (555 root→route), NOT the borderline band W2 fires on; W2 won't touch the dominant misclass | Added the **Scope boundary** section (W2 = the 25 scorer-borderline rows; the 555-class is W3's `experiment` de-dup); stopped citing 0/575 as W2's justification. |
| W2-H2 / OQ-W2-1 | both | HIGH | a new `[BORDERLINE-ESCALATE]` marker re-grows the family (10/15, just consolidated 11→10); W2 is a reader not an emitter; same class as `[ROUTE-DECISION-UNCERTAIN]` | **No new marker** — W2 returns STRUCTURED FIELDS the gate consumes; the family is untouched. |
| HON-W2-1 | honesty | HIGH | the backtest "moves toward the correct_route label" is FALSE for the 67 label-borderline rows (they're labeled borderline → escalation = a harness regression); + conflates scorer-band vs label-borderline sets | Re-scoped the backtest to the **25 scorer-band rows** (disambiguated), reported descriptively (20/5/0, 80% route-match), NEVER through the scorer-regression gate, never "toward the label" on the label-borderline set. |
| W2-M2 | architect | MED | no fail-open contract for the new JSON parse seam (kernel can exit 3 with no stdout) | W2 **fail-opens to route** on empty/malformed input (TDD'd); mirrors the bash gate. |
| HON-W2-2 | honesty | MED | undisclosed: the current borderline consumers PAUSE for the user (a menu); W2 replaces that with a default | Disclosed as a named sacrifice in Load-bearing constraints; the valve keeps it advisory. |
| HON-W2-3 | honesty | MED | over-routing cost asymmetry (~30x) undisclosed; the actual route-lean support is cross-family GPT (1/23 root), not 0/575 | Disclosed the cost asymmetry + the ~5/25 over-escalation; re-cited the 20/25 + GPT as the support. |
| OQ-W2-4 | honesty | MED | scope the META case OUT of the route-default (it's a catch-22 artifact, not under-routing) | Meta scoped out — W2 fires on borderline + zero-signal uncertain only. |
| W2-M1 / HON-W2-4 | both | MED/LOW | the eval-set probe path was wrong (`bench/...` not `packages/specs/bench/...`) + understated composition | Corrected the path + composition (575 route / 70 root / 25 scorer-borderline-band) in the probe table. |
| W2-L1 / HON-W2-5 | both | LOW | stale family count (9; actually 10, cap 15, 5 headroom) | Corrected to 10/15 throughout. |

**Board conclusion:** no CRITICAL; the module is build-ready with the scope/marker/backtest corrections folded. The design is sound on every load-bearing axis (A4 purity, OQ-NS-6 advisory, JS module, fail-open, no-LLM); the route-default is firsthand-supported (20/25) and honestly bounded (N=25, low-power, valve-mitigated).

## Build result (2026-06-19)

**Built (TDD):**
- `packages/runtime/orchestration/borderline-resolver.js` — the pure `resolveBorderline(scorerJson)` (structured fields, NOT a marker) + a CLI (stdin / `--json`, always exit 0). Fires on borderline/uncertain → route NUDGE with the demote-if-trivial valve; route/root pass through; meta scoped out; fail-opens to route on bad/empty input. **13 tests.**
- `packages/specs/bench/router-v2/w2-borderline-backtest.js` — the descriptive narrows-only backtest over the 25 scorer-borderline-band rows (reuses `shadow-eval.auditReportWording`; never the scorer-regression gate). Confirmed **20/25 route-match (5 over-escalate; narrows-only, N=25 low-power, LLM-labeled)**. **6 tests.**
- `build-team-helpers.sh` — a `borderline-resolve` subcommand (reads route-decide JSON on stdin → the W2 resolution; fail-opens to route if the resolver is missing) + usage.
- `build-team.md` Step 0 — wires the resolver into the borderline/uncertain dispatch (replaces the user-menu pause with the route-default nudge; surfaces the valve; composes with the kernel's forcing instructions). Disclosed as the named sacrifice (HON-W2-2).

**A4 purity held:** no `kernel/` file edited; the resolver reads route-decide's JSON as a data contract (no kernel→runtime dependency). **Gate:** eslint 0 · resolver 13 + backtest 6 (19 new tests) · runtime suite 25/25 · bench suite 7/7 · markdownlint 0 (CI scope, incl. build-team.md) · doc-path 0 stale · SIGNPOST regenerated · bash `-n` clean.

## VALIDATE board result (2026-06-19)

2-lens board on the built diff. **code-reviewer PASS (0 findings) · honesty-auditor PASS-WITH-NOTES (Grade A)** — the module is sound on every load-bearing axis. code-reviewer firsthand-verified: branch exhaustiveness (borderline/uncertain→route, route/root→passthrough, meta-alone→not-escalated, unknown/null→fail-open), **A4 purity absolute** (zero `require`s in the resolver; no kernel import anywhere), the fail-open contract (empty/malformed/missing→route, CLI always exit 0), the bash Step-0 wiring (correct pipe + jq defaults + dispatch composition), and the backtest (filters the scorer-band, never the regression gate). honesty firsthand-verified the module-matches-design, the 20/25 corpus figure, the HON-W2-2 disclosure, and the honest backtest framing.

| ID | Lens | Sev | Finding | Disposition |
|---|---|---|---|---|
| HON-VAL-W2-1 | honesty | LOW | the backtest synthesizes `signals_matched: []`, so it doesn't exercise the resolver's `sigPart` reasoning branch (the eval set carries no matched-signals to populate) | NO ACTION (board: "fidelity gap, not an overclaim — the 20/25 route-match is independent of the reasoning string + grep-verified"). A future higher-power backtest could populate signals. |
| HON-VAL-W2-2 | honesty | LOW | the Build-result one-liner stated "20/25 route-match" without re-stating the `N=25 low-power` bound inline | FOLDED — the qualifier now travels with the figure so the bound survives a standalone excerpt. |

**Board conclusion:** no CRITICAL/HIGH; PASS. The two LOWs are presentation/fidelity notes, not overclaims. W2 ready for the USER merge gate.
