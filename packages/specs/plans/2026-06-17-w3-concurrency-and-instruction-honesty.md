---
lifecycle: persistent
phase: ③.0-W3
status: BUILT + VALIDATED (3-lens SHIP) — cleared to PR
date: 2026-06-17
---

# ③.0-W3 — concurrency + instruction-layer honesty (closes ③.0 foundation-hardening)

The third and final wave of the live-external-PR-beta prereq track (charter
`packages/specs/plans/2026-06-16-test-phase-live-beta-charter.md`, lines 55-59). All work is
SHADOW; trust moves ZERO (OQ-NS-6 — only a real maintainer-merge hardens). Per-wave workflow:
plan + Runtime Probes -> 3-lens VERIFY -> TDD build -> 3-lens VALIDATE (hacker live re-probe) ->
full gate -> PR -> CodeRabbit gate -> USER merge.

## Scope (4 items, charter-verbatim)

1. **`fact-force-gate` per-spawn tracker-key** — the read-before-edit gate keys its on-disk tracker
   on a `SESSION_ID` that, when env is unset, falls back to bare `process.ppid`. Concurrent
   same-parent spawns share one ppid -> one tracker -> cross-contamination (agent A's Read of file X
   approves agent B's Edit of X). Fix: derive the key from the stdin-payload `session_id` first
   (matching the established `spawn-record.js:218` precedent), env -> ppid as fallback tiers.
2. **`validate-markdown-emphasis.js` honesty** — the rule + KB docs cite this PostToolUse hook as
   live infrastructure, but the file does NOT exist. **[VERIFY-FOLD W3-H1]** the file was
   DELIBERATELY retired at H.7.27 (~230 LoC deleted; detection migrated to CI markdownlint MD037,
   empirically validated). Re-implementing it would REVERSE a documented YAGNI decision. Fix:
   take the charter's other authorized path — REWRITE the stale rule (`workflow.md:174`) + KB refs
   (`validator-conventions.md` Conv C/D) to reflect the H.7.27 reality (hook retired; CI MD037
   enforces the discipline). NO new hook, NO `hooks.json` change, NO new code.
3. **`docs/ARCHITECTURE.md` K1 "Live"->"Dormant"** — the table says K1 is "Live"; ROADMAP +
   `dormancy-assertion-k1` say K1 is dormant/superseded (harness owns worktree creation; kernel
   observes, does not allocate — OQ-21/ADR-0012). Fix the stale doc cell.
4. **`docs/reference/stability-commitment.md` v2.x staleness** — titled "(v2.x)", pins v2.0.0
   throughout; the substrate is at v3.11 heading into the beta. Fix: refresh to v3.x reality.

## Runtime Probes (firsthand-verified 2026-06-17, against HEAD `1896053` — NOT prose/memory)

| # | Claim | Probe | Observed |
|---|---|---|---|
| P1 | `fact-force-gate.js` exists + keys on ppid | `Read packages/kernel/hooks/pre/fact-force-gate.js` | EXISTS; line 23 `SESSION_ID = process.env.CLAUDE_SESSION_ID \|\| process.env.CLAUDE_CONVERSATION_ID \|\| String(process.ppid \|\| 'default')`; `TRACKER_PATH` computed at line 24 at module-load (BEFORE stdin read at line 83) |
| P2 | the stdin payload carries `session_id` at PreToolUse | `grep 'session_id' pre/*.js` | `contract-reminder-on-agent-spawn.js:280` + `route-decide-on-agent-spawn.js:99` BOTH read `input.session_id \|\| input.sessionId` from the payload at PreToolUse — field is present |
| P3 | payload-session-id-first is the established precedent | `Read spawn-record.js:218,226` | "Prefer hash of `input.session_id` (most stable when present)"; ppid is the documented FALLBACK, not the primary. fact-force-gate is the outlier reading env |
| P4 | existing FFG tests pass session via ENV, not payload | `Read tests/unit/hooks/fact-force-gate.test.js:29-36` | `runHook` sets `env.CLAUDE_SESSION_ID=sessionId`; payload is `{tool_name,tool_input}` only -> my env-fallback tier preserves all 6 existing tests |
| P5 | `validate-markdown-emphasis.js` does NOT exist | `find packages -name 'validate-markdown-emphasis*'` | no match (file absent) |
| P6 | it is cited as live in 4 places | `grep -n validate-markdown-emphasis` | `workflow.md:174` ("PostToolUse hook ... emits `[MARKDOWN-EMPHASIS-DRIFT]`") + `validator-conventions.md:131,142,206` |
| P7 | the doc-path gate does NOT catch the dangling refs (so implementing is zero-CI-risk) | `Read scripts/validate-doc-paths.js` | `validators/` is not in `ROOTS` (only `packages`); `rules/core/*.md` is not in `collectDocs()` -> both citation forms dodge the gate. CI green on `1896053` confirms |
| P8 | ARCHITECTURE says K1 Live, ROADMAP says Dormant | `grep -n K1 docs/ARCHITECTURE.md docs/ROADMAP.md` | `ARCHITECTURE.md:90` "K1 ... Live"; `ROADMAP.md:36` "K1 worktree-allocator — superseded ... dormancy-assertion-k1 stays". K3.b in the SAME table (`ARCHITECTURE.md:93`) already uses the "Dormant" treatment -> a precedent cell shape exists |
| P9 | stability-commitment.md is v2.x-pinned | `grep -n 'v2\.' docs/reference/stability-commitment.md` | title "# Stability Commitment (v2.x)"; "v2.0.0 on 2026-05-12"; route-decide `weights_version "v1.1-context-aware-2026-05-07"` (current is `v1.3-dict-expanded-2026-06-12` per route-decide output); `tierOf` byte-frozen "for v2.x" |
| P10 | PostToolUse:Edit\|Write advisory-hook registration shape | `Read packages/kernel/hooks.json:218-227` | `validate-plan-schema.js` is the model: PostToolUse, `matcher:"Edit\|Write"`, `timeout:5` |

## The fix designs

### Item 1 — fact-force-gate tracker key (the only behavior change; kernel hook)

- **Move** the `SESSION_ID` + `TRACKER_PATH` derivation OUT of module-load (lines 23-24) INTO the
  stdin `end` handler, AFTER `data` is parsed. New resolution order (fallback chain, fail-never):
  `data.session_id || data.sessionId || process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_CONVERSATION_ID || String(process.ppid || 'default')`.
- **Sanitize** the key into the filename (it now comes from external payload): restrict to
  `[A-Za-z0-9_-]`, replace others, cap length — so a hostile `session_id` ("../../etc/x", path
  separators, 10MB string) cannot escape `os.tmpdir()` or DoS the path. (This is a NEW attack
  surface the env-only path did not have — env is operator-controlled; payload is not.)
- `loadTracker`/`saveTracker`/`normalizePath` take the resolved `TRACKER_PATH` as a param (no more
  module-scope const). KISS: pass it through; do not introduce a class.
- Fail-open contract preserved: any error -> `{decision:'approve'}` (line 171-174 unchanged shape).
- **Honest residual to document in-code + plan**: IF the harness gives concurrent sub-agents the
  SAME `session_id` (a harness fact I cannot fully probe without spawning concurrent agents), the
  cross-contamination is reduced but not eliminated — BUT it remains fail-OPEN (over-approves a
  read-before-edit), never fail-closed, and is strictly better than the ppid floor. The VERIFY
  hacker must weigh whether payload-session-id is per-spawn-distinct; if uncertain, the fix still
  dominates the status quo and the residual is logged, not blocking.

### Item 2 — implement validate-markdown-emphasis.js (new advisory PostToolUse hook)

- New file `packages/kernel/validators/validate-markdown-emphasis.js`. Contract (from the
  `workflow.md:174` spec it must satisfy): PostToolUse, only acts on `.md`/`.mdx` files, detects the
  MD037 trigger — an unbackticked underscore-bearing token (`HETS_TOOLKIT_DIR`, `_h70-test`,
  `_lib/`) sharing a line with another underscore at an emphasis distance — and emits
  `[MARKDOWN-EMPHASIS-DRIFT]` for AWARENESS. **Advisory: NEVER blocks** (always `{decision:'approve'}`
  or no-decision), forward-looking (does not auto-fix), fail-soft (exit 0 on any error per ADR-0001).
- Register in `hooks.json` PostToolUse, `matcher:"Edit|Write"`, after `validate-plan-schema.js`.
- `require.main === module` guard + `module.exports = { scanContent }` so it is unit-testable
  (the W2 validate-no-bare-secrets pattern).
- Detection precision: must NOT false-positive on legitimately-italicized prose (`_word_`) or on
  already-backticked tokens. The detector targets the specific MD037 shape: a bare token containing
  `_` with whitespace between it and another `_` on the same line, outside code spans/fences.

### Item 3 — ARCHITECTURE.md K1 cell (doc only)

- Change the `ARCHITECTURE.md:90` K1 treatment cell from `Live` to the K3.b-style dormant shape:
  `Dormant (superseded — the harness owns worktree creation; the kernel OBSERVES via tool_response.worktreePath at spawn-close rather than allocating — OQ-21/ADR-0012; no importer, dormancy-assertion-k1 stays green)`.
  Align the surrounding prose (line 66 / line 79 honest-status flags) if they assert K1 allocates.
- Reconcile against ROADMAP.md:36 wording so the two read consistently.

### Item 4 — stability-commitment.md refresh (doc only)

- Add a prominent header noting the doc describes the **v2.x era** and the substrate is now at
  **v3.11** (released) heading into the live-external-PR beta (③); point to `docs/ROADMAP.md` +
  MEMORY for current state. Update the stalest concrete pins (route-decide `weights_version`,
  "within v2.x" framing) OR clearly demarcate the v2.x section as historical. KISS: a clear
  "as-of" banner + a current-state pointer beats a full rewrite — the doc's v2.x commitments are
  historically TRUE; the dishonesty is the absent "this is the v2.x record" framing.

## HETS Spawn Plan (escalation rationale — route-decide returned `root`, I escalate by judgment)

`route-decide` scored **0.162 -> root** (the `stale` counter-signal −0.25 + a `stakes` lexicon miss
dragged it down — the documented substrate blind spot: "writes to real refs / kernel hook under
concurrency" carries no `stakes` lexicon token). Per the workflow Rule 2 + the MEMORY route-decide
caveat ("escalate by judgment"), item 1 is a **kernel ENFORCEMENT hook changed under concurrency for
a security-sensitive beta** — that diff class REQUIRES the full 3-lens tier. Escalation is
documented + justified (not a silent override).

- **VERIFY (pre-build, read-only personas, parallel):**
  - `architect` — the tracker-key fallback-chain design + the residual (is payload-session-id the
    right key? does moving derivation into the handler break any seam?) + the new-hook contract.
  - `hacker` — adversarial: the NEW payload-controlled-filename attack surface (path traversal / DoS
    via hostile `session_id`); whether the concurrency fix actually closes cross-contamination or
    only narrows it; can the markdown hook be made to block (DoS the edit path)?
  - `honesty-auditor` — does each "fix" actually resolve the dishonesty, or relabel it? Is the
    ARCHITECTURE/stability framing now claim-vs-evidence clean? Is the concurrency residual stated
    honestly?
- **BUILD** — TDD: new/extended tests first (red), then impl (green). Orchestrator-direct build
  (not delegated) -> no Rule-4 verdict-attestation subject.
- **VALIDATE (post-build, parallel):** `code-reviewer` (correctness/edge) + `hacker` (Rule-2a LIVE
  re-probe of the BUILT code — plant a hostile session_id, plant a real MD037 token, confirm the
  filename is sandboxed + the hook never blocks) + `honesty-auditor` (the diff vs the claims).

## Routing Decision

```json
{ "recommendation": "root", "score": 0.162, "escalated_to": "3-lens VERIFY + VALIDATE",
  "escalation_reason": "kernel enforcement hook changed under concurrency for a security-sensitive beta; route-decide stakes-lexicon miss + 'stale' counter-signal is the documented substrate blind spot (workflow Rule 2 + MEMORY route-decide caveat).",
  "weights_version": "v1.3-dict-expanded-2026-06-12" }
```

## Files

| File | Change | Kind |
|---|---|---|
| `packages/kernel/hooks/pre/fact-force-gate.js` | tracker-key from payload session_id (probed present+stable), `sha256(key).slice(0,16)` sanitize (spawn-record precedent), derivation moved into stdin handler, in-code fail-open residual comment | code (kernel) |
| `tests/unit/hooks/fact-force-gate.test.js` | +payload-session-id primary path + +two-distinct-hostile-ids->distinct-trackers + +oversized-id bounded/fail-open; existing 6 preserved via env tier | test |
| `packages/skills/rules/core/workflow.md` | rewrite H.7.18 §174: hook RETIRED-H.7.27, CI markdownlint MD037 enforces (then `install.sh --rules`) | rule source |
| `packages/skills/library/agent-team/patterns/validator-conventions.md` | Conv C §131/142 mark hook retired (tiered-design lesson stands); Conv D §200 "3 hooks"->"2", §206 remove the retired row + 1-line retirement note | KB doc |
| `docs/ARCHITECTURE.md` | K1 table cell §90 Live->Dormant **AND** §66 prose "Allocate (K1)"->observe-not-allocate (MANDATORY per W3-A2/H2) | doc |
| `docs/reference/stability-commitment.md` | H1 retitle "(v2.x — historical record)" + as-of banner/pointer + demarcate Stable/Evolving block as v2.x-era (W3-H3) | doc |

## Pre-push gate

`bash install.sh --hooks --test` (eslint Test 84 + yaml 83 — NOTE [VERIFY-FOLD W3-H5]: markdownlint
is a CI-only job (`ci.yml:110 markdownlint-cli2`), NOT an install.sh sub-test) + the full kernel
suite + the fact-force-gate test file + `node scripts/validate-doc-paths.js` + a local
`npx markdownlint-cli2` over the edited `.md` files (the MD037 surface this wave's Item 2 now relies
on). NO new source file this wave -> no SIGNPOST regen needed (Item 2 is doc/rule-only).

## Drift Notes

- route-decide `root`-vs-judgment escalation recorded above — the recurring substrate-meta
  catch-22 (the scorer can't see "kernel hook under concurrency" stakes). Already a known carry;
  no new dictionary-expansion proposed this wave (judgment-escalation is the codified path).

## VERIFY result (3-lens board: architect + hacker + honesty) + folds — 2026-06-17

Board: architect **BLESS-WITH-NOTES**, hacker **BLESS-WITH-NOTES**, honesty **NEEDS-REVISION**
(driven by W3-H1). All folds applied below before build. Each finding premise-probed firsthand
before folding (per the review-gate discipline).

### Folds applied

| Finding | Sev | Fold |
|---|---|---|
| **W3-H1** (honesty) | HIGH | **Item 2 FLIPPED implement->rewrite.** Firsthand-confirmed: `BACKLOG.md:386-425` + `CHANGELOG.md:4702` show H.7.27 DELIBERATELY retired the hook (~230 LoC) after empirically validating CI MD037 absorbs detection (`BACKLOG.md:392`); `.markdownlint.json default:true` + MD037 not disabled + `ci.yml:110 markdownlint-cli2 "**/*.md"` (excludes only node_modules/swarm/packages/specs — `workflow.md` + `validator-conventions.md` ARE linted) confirm CI enforces it now. Re-implementing reverses a YAGNI decision; the honest fix is rewriting the stale refs. |
| **W3-A1** (architect) | HIGH | **Item 1 premise PROBED firsthand (the load-bearing harness fact).** Throwaway `claude -p` Read+Edit in `/tmp/ffg-probe` with a payload-logging hook: `session_id` PRESENT on both Read+Edit `PreToolUse` payloads AND byte-identical across the two separate processes (`39a9410c-...`, pid 60989 vs 60997). So payload-session_id-first is cross-process STABLE -> does NOT brick the gate, is NOT a silent no-op. Only snake_case `session_id` is sent (`sessionId` always null). |
| **H1 / W3-A3** | HIGH | **Sanitizer = `sha256(key).slice(0,16)`** (the `spawn-record.js:228` precedent the plan already cited), NOT char-restrict+cap. One transform that is collision-resistant + traversal-proof (no separators) + DoS-proof (bounded output) — closes the "drop-disallowed collapses distinct hostile ids to one empty key" re-collision the hacker's spike demonstrated. Coerce `String()`, empty->`'default'` floor before hashing. |
| **W3-A2 / H2** | MED | **ARCHITECTURE §66 prose edit is MANDATORY** (not conditional): step 1 "Allocate ... (K1)" -> harness-allocates / kernel-observes (OQ-21/ADR-0012). Grepped all K1+allocate co-occurrences: §66 + §90 are the only K1-allocates assertions (§73/§122 are K7/sandbox, not K1). |
| **H3 / W3-H4** | MED | Concurrency residual framed as **"narrows", never "fixed"** in diff/PR/code. In-code comment: per-spawn-distinctness of `session_id` under CONCURRENT same-parent sub-agents is an unverified harness assumption; the failure mode is strictly fail-OPEN (over-approves a read-before-edit; never a false block) and strictly dominates the ppid floor. |
| **W3-H3 / W3-A4** | MED | **Item 4 deepened past a banner:** retitle H1 `(v2.x — historical record)` + as-of banner + demarcate the Stable/Evolving block as describing the v2.x era (so the present-tense "commits to"/"frozen" body + the stale `weights_version v1.1` pin don't read as live commitments at v3.11). |
| **W3-H5** | LOW | Pre-push line corrected: markdownlint is CI-only, not `install.sh --test`. |
| **W3-A5 / A6 / H2(emphasis)** | NOTE | A5: pass `TRACKER_PATH` only to `loadTracker`/`saveTracker` (NOT `normalizePath` — it has no tracker dep); keep the fail-open try/catch wrapping the new derivation. A6/H2: moot — no hook built. |
| **H4 / H5(hacker)** | MED/LOW | Moot — no markdown hook built (no ReDoS surface); no oversized-key syscall cycle (sha256 bounds the key before `path.join`). |

### New Runtime Probe (firsthand, the W3-A1 resolution)

| # | Claim | Probe | Observed |
|---|---|---|---|
| P11 | the `Read\|Edit\|Write` `PreToolUse` payload carries `session_id`, stable across the separate Read + Edit processes | throwaway `claude -p "Read ./target.txt then Edit foo->bar"` in `/tmp/ffg-probe` with a payload-logging `PreToolUse:Read\|Edit\|Write` hook | `session_id` present on BOTH (`39a9410c-05c0-4498-a5ea-cc10ac31f277`); IDENTICAL across pid 60989 (Read) + 60997 (Edit); `sessionId` camel always null; ppid stable in the sequential case (60968) |

### Item 1 final key resolution (post-fold)

Inside the stdin `end` handler (after `data` parse): `raw = data.session_id || data.sessionId ||
process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_CONVERSATION_ID || String(process.ppid || 'default')`;
`key = sha256(String(raw) || 'default').slice(0,16)`; `TRACKER_PATH = path.join(os.tmpdir(),
'claude-read-tracker-' + key + '.json')`. `loadTracker(trackerPath)` / `saveTracker(trackerPath, tracker)`
take the path as a param; `normalizePath` unchanged. The whole derivation is inside the existing
fail-open try/catch.

## VALIDATE result (3-lens board on the BUILT diff) + folds — 2026-06-17

Board: code-reviewer **SHIP**, hacker **SHIP** (Rule-2a live re-probe — 7 throwaway node spikes
against the built module), honesty **SHIP-WITH-NOTES** (Grade A, NO-OVERCLAIM). Full gate 125/0;
fact-force-gate suite 28/0. No CRITICAL/HIGH/MEDIUM blocking finding. Each finding premise-probed
before disposition.

| Finding | Sev | Disposition |
|---|---|---|
| **FFG-2** (reviewer: `String(raw)` floor is dead code) | NOTE | **FALSE POSITIVE — kept.** Premise-probed: `session_id: []` is truthy -> `raw=[]` -> `String([])===''` -> the `'default'` floor branch IS reached. The reviewer's trace missed the empty-array case; the defensive floor is load-bearing for hostile non-string ids. |
| **H-W3-4** (honesty: Stable/Evolving body headers stay present-tense) | LOW | **FOLDED.** Past-tensed the 3 section headers (`Stable within v2.x (was frozen ...)`, `Evolving within v2.x ...`, `Experimental within v2.x ...`) so a mid-doc deep-link reader cannot misread them as live commitments. The one fold the wave's honesty purpose warranted. |
| **FFG-1 / H-MED-1** (falsy session_id -> floor, silent) | LOW/MED | **Documented residual, no code change.** Both lenses: accept for W3 — the harness sends UUIDs; strictly fail-OPEN; matches the `spawn-record.js` chain precedent. An empty/falsy id behaving like an absent one cannot brick and cannot cross-contaminate beyond the ppid floor. |
| **H-LOW-1** (symlink-TOCTOU on the predictable tmp tracker path) | LOW | **Pre-existing (NOT a W3 regression) — flagged as a background task.** HEAD's raw-SESSION_ID path was equally predictable; same-uid only; foreign-uid writes refused by `atomic-write.js`. Sibling of the MEMORY "M1 TOCTOU symlink-swap accepted — re-evaluate when multi-agent/concurrent" watch; the beta is that trigger. Fix (per-uid 0700 tmpdir subdir or `O_NOFOLLOW`) is out of W3 scope. |
| **DOC-1** (reviewer), **H-W3-2/3/5** (honesty), **H-NOTE-1/2** (hacker) | NOTE | No action. DOC-1 = pre-existing `catalog-reconcile-write` omission (HEAD too). Honesty confirmed: Item 2 has zero residual live-claim (exhaustive grep); Item 3 internally + ROADMAP-consistent (SIGNPOST:135 is an auto-gen file-descriptor, correctly out of scope); the VERIFY-result section maps to verifiable diff artifacts. |

**Honesty headline:** the most damaging potential overclaim — calling the concurrency leak "fixed" —
was explicitly NOT made; diff, in-code comment, and plan all say "narrows" (fail-OPEN, dominates the
ppid floor). NO-OVERCLAIM across all 4 items. Cleared to PR for the USER merge gate.
