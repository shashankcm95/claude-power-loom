# Locked Brief: Textbook→Tutorial Web App (toolkit shakedown control object)

**Status**: LOCKED at v1. Do NOT silent-edit between runs. If methodology needs a change, branch to `brief-v2.md` with a documented rationale.

---

## Context (paste into fresh chat verbatim)

You're in a fresh chat. A toolkit called `power-loom` (currently at v2.8.2 or later) is installed as a Claude Code plugin. You're running it as a CONTROL OBJECT for cross-version benchmarking — the project below is a vehicle, not the deliverable. The deliverable is a structured run report.

Toolkit source repo: `~/Documents/claude-toolkit/` (whatever tag matches the installed plugin version).
Plugin cache: `~/.claude/plugins/cache/power-loom-marketplace/power-loom/<version>/`.

Load-bearing features to exercise (in priority order):
1. HETS agent-team orchestration via `/build-team` or `/chaos-test`
2. SynthId content-hash drift detection (`agent-identity.js assign` returns `synthid` + `synthid_drift`)
3. Per-identity reputation tier transitions (unproven → low-trust → medium → high; needs ≥5 verdicts)
4. Contract-verifier output validation (look for `synthIdValidation` field in JSON)
5. route-decide gating (root vs route vs borderline)
6. prompt-enrich-trigger (the ship-confirmation skip pattern should hold on "merged" / "shipped" / etc.)
7. Auto-store + self-improve loops

**Use the formal HETS spawn ceremony**: assign identity → spawn with frontmatter `identity:` → run contract-verifier on output → record verdict via pattern-recorder. Deviating from this ceremony is the single biggest source of toolkit-feature non-exercise; if you find yourself bypassing it for convenience, that's itself a debrief finding.

---

## The test app (constant across all runs)

**PDF→Tutorial Web App**: Takes a public PDF URL → extracts text → chunks into chapters → generates per-chapter summary + key concepts via an LLM API → generates randomized multiple-choice quizzes → tracks per-user progress.

**Stack preference**: Next.js 14 (App Router) + TypeScript + Tailwind + Postgres + pgvector + Drizzle ORM + Claude API. **Defer to the `tech-stack-analyzer` skill's recommendation** in Phase 0. The point is to exercise the toolkit's decision-making, not to lock the stack pre-toolkit.

**Persona spread target**: 4 personas hitting the full mid-spread (04-architect, 13-node-backend, 09-react-frontend, 08-ml-engineer, 12-security-engineer — analyzer picks the final 4).

**Intentionally deferred**: Google Drive OAuth (plumbing that exercises zero toolkit features). Accept any public PDF URL via `?pdf=<url>` query param. Drive integration is a Phase 3 stretch goal only.

**Project location**: `~/Documents/Textbook_to_Tutorial/` (or a versioned variant like `~/projects/textbook-tutorial-v2.8.3-run1/` for benchmark runs).

---

## Phasing (5 sessions; ~2-3h each; chat-window-sized)

### Phase 0 — Pre-flight verification + stack proposal (~20min)

1. **Confirm plugin cache at expected version**:
   ```bash
   cat ~/.claude/plugins/cache/power-loom-marketplace/power-loom/<version>/.claude-plugin/plugin.json | jq .version
   ```

2. **Verify hooks are functional with 3 probe prompts**:
   - Type a vague prompt like "fix the thing" → should see `[PROMPT-ENRICHMENT-GATE]` injection
   - Type "merged" → should NOT see GATE injection (v2.8.2 Fix-2(a) regression test; KNOWN GAP — may still fire pre-fix in runtime even if source is correct; capture as drift if so)
   - Spawn a trivial architect agent and check whether its output gets `[KB-CITATION-MISSING]` when missing the `## KB Sources Consulted` heading

   **If ANY probe fails to fire as designed: STOP.** Capture state and abort. Write `bench/ABORT-PHASE-0.md` and hand back.

3. **Invoke `tech-stack-analyzer` skill** with this exact project description:
   > "Web app that takes a public PDF URL → extracts chapters → generates per-chapter summary + key concepts + randomized MCQ quizzes → tracks user progress. Stack flexibility: Next.js + Postgres preferred but defer to analyzer's recommendation. OAuth deferred. Target: a working dev-mode prototype across 4 phases."

4. **Save the analyzer's output** to project-local `bench/tech-stack-proposal.md`.

5. **Pause for user GO** before Phase 1 even though the analyzer pauses for you — surface for explicit approval.

### Phase 1 — Foundation + telemetry harness (~2h)

1. `mkdir -p ~/Documents/Textbook_to_Tutorial && cd ~/Documents/Textbook_to_Tutorial && git init` (or run-versioned variant)
2. **Create the project-local `bench/` telemetry harness FIRST** (3 files: capture.sh, diff.sh, debrief-template.md — see "Telemetry harness" section below)
3. **Capture baseline snapshot before ANY agent work**:
   ```bash
   bash bench/capture.sh baseline-pre-phase-1
   ```
4. Run `/build-team` with the analyzer's persona list. Task: Next.js scaffold + Postgres docker-compose + Drizzle schema + base routes.
5. **Input contract**: accept any public PDF URL via `?pdf=<url>`. **NO OAuth, NO Google Drive integration.**
6. **End-of-phase**: `bash bench/capture.sh phase-1-end` + diff vs baseline.

Verification: `npm run dev` boots; `/api/health` returns 200; bench/diff.sh shows ≥3 new identity spawns + ≥3 new verdict records.

### Phase 2 — PDF ingestion + chapter parsing + quiz gen (~2-3h)

1. Spawn HETS team for: PDF download, pdf-parse text extraction, chapter detection (heuristic: ToC + heading frequency), LLM summary + concept extraction + MCQ quiz gen.
2. **Apply TDD-treatment to the chapter-parser** — tests-first → architect → impl → reviewer. This is a TDD-treatment data point worth capturing.
3. Use `08-ml-engineer` persona prominently for prompt engineering.
4. End-of-phase: capture + diff.

### Phase 3 — Frontend + progress tracking (~2h)

1. Spawn HETS team for: chapter reader UI, quiz UI with randomized question order, percentage-complete tracker, per-user-per-book progress in DB.
2. Use `09-react-frontend` persona prominently.
3. End-of-phase: capture + diff.

### Phase 4 — Chaos audit + ship (~1-2h)

1. Run `/chaos-test` against the full project (4 actors: hacker / code-reviewer / architect / honesty-auditor minimum).
2. Run `node ~/Documents/claude-toolkit/scripts/library-migrate.js add-synthid --dry-run` — should show synthid_history additions for new identities.
3. Inspect `agent-identities.json` for tier transitions across the 4 phases.
4. Generate `bench/FINAL-DEBRIEF.md` (see template below).
5. Hand back to original session.

---

## Telemetry harness — create project-local `bench/` in Phase 1 sub-step 2

Three files. Project-local so each run is isolated. **DO NOT confuse this with the toolkit-repo `bench/control-runs/` framework — that's at a higher level.**

### bench/capture.sh

```bash
#!/usr/bin/env bash
PHASE="${1:-unknown}"
TS=$(date +%Y%m%d-%H%M%S)
OUT="bench/snapshots/${PHASE}-${TS}"
mkdir -p "$OUT"

# v2.8.3 — sync legacy agent-identities.json from bulkhead per-persona store
# BEFORE snapshotting. Without this, the legacy file is fossilized at its
# pre-partition state and the snapshot captures stale data (CHAOS-SUB-2
# finding from v2.8.2-run1). The sync is a no-op when bulkhead is inactive.
node ~/Documents/claude-toolkit/scripts/library-migrate.js sync-legacy >/dev/null 2>&1 || true

cp ~/.claude/agent-identities.json "$OUT/agent-identities.json" 2>/dev/null
cp ~/.claude/agent-patterns.json "$OUT/agent-patterns.json" 2>/dev/null
cp -r ~/.claude/library/sections/agents/stacks/identities/ "$OUT/identities-library/" 2>/dev/null
cp -r ~/.claude/library/sections/agents/stacks/verdicts/ "$OUT/verdicts-library/" 2>/dev/null
cp ~/.claude/self-improve-counters.json "$OUT/self-improve-counters.json" 2>/dev/null
cp ~/.claude/checkpoints/self-improve-pending.json "$OUT/self-improve-pending.json" 2>/dev/null

# v2.8.3 — capture ceremony_completion_rate via agent-identity stats output
# (Tier-1 substrate metric, observability-only; precursor to v2.9.0 enforcement)
node ~/Documents/claude-toolkit/scripts/agent-team/agent-identity.js stats > "$OUT/stats.json" 2>/dev/null

for log in ~/.claude/logs/*.log; do
  tail -500 "$log" > "$OUT/$(basename "$log")"
done
cp ~/.claude/checkpoints/observations.log "$OUT/observations.log" 2>/dev/null

TRANSCRIPT="${CLAUDE_TRANSCRIPT_PATH:-$(ls -t ~/.claude/projects/*/[a-f0-9]*.jsonl 2>/dev/null | head -1)}"
if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
  python3 <<PY > "$OUT/token-usage.json"
import json
totals = {'input': 0, 'output': 0, 'cache_read': 0, 'cache_create': 0}
with open('$TRANSCRIPT') as f:
    for line in f:
        try:
            e = json.loads(line)
            u = e.get('message', {}).get('usage', {})
            if isinstance(u, dict):
                totals['input'] += u.get('input_tokens', 0) or 0
                totals['output'] += u.get('output_tokens', 0) or 0
                totals['cache_read'] += u.get('cache_read_input_tokens', 0) or 0
                totals['cache_create'] += u.get('cache_creation_input_tokens', 0) or 0
        except: pass
totals['total'] = sum(totals.values())
print(json.dumps(totals, indent=2))
PY
fi

git log --oneline -20 > "$OUT/git-log.txt" 2>/dev/null
git status --short > "$OUT/git-status.txt" 2>/dev/null

# Plugin version (resolve the installed version dynamically)
PLUGIN_VER_DIR=$(ls -dt ~/.claude/plugins/cache/power-loom-marketplace/power-loom/2.* 2>/dev/null | head -1)
[ -n "$PLUGIN_VER_DIR" ] && cat "$PLUGIN_VER_DIR/.claude-plugin/plugin.json" > "$OUT/plugin-version.json" 2>/dev/null

echo "Snapshot written to $OUT"
ls "$OUT" | wc -l | xargs echo "Files captured:"
```

### bench/diff.sh

(See the original handoff brief — same script unchanged. Compares two snapshot dirs and reports identity / verdict / token / hook-fire deltas.)

### bench/debrief-template.md

```markdown
# Phase N Debrief — <date>

## Quantitative deltas
(paste bench/diff.sh output)

## Qualitative observations
- Personas spawned this phase:
- Tier transitions observed:
- SynthId drift events:
- Route-decide calls (sample):
- Prompt-enrich fires considered legitimate:
- Prompt-enrich over-fires (should be 0 post-v2.8.2 if Fix-2(a) is operative in runtime):

## Drifts noticed
For each:
- **What drifted**:
- **Evidence** (file:line / log excerpt):
- **Severity**: LOW / MEDIUM / HIGH / CRITICAL
- **Suggested follow-up**:

## Successful calls worth noting
(things that worked exactly as designed)

## Recommendations for next phase
```

---

## Diagnostic commands (have these ready throughout)

```bash
# Live identity state
node ~/Documents/claude-toolkit/scripts/agent-team/agent-identity.js stats
node ~/Documents/claude-toolkit/scripts/agent-team/agent-identity.js list

# Active candidate queue
node ~/.claude/scripts/self-improve-store.js pending

# Verify SynthId backfill state
node ~/Documents/claude-toolkit/scripts/library-migrate.js add-synthid --dry-run

# Recent verdict history
node ~/Documents/claude-toolkit/scripts/agent-team/pattern-recorder.js stats

# Recent hook fires
tail -50 ~/.claude/logs/prompt-enrich-trigger.log
tail -50 ~/.claude/logs/kb-citation-gate.log
tail -50 ~/.claude/logs/fact-force-gate.log

# Plugin version
ls ~/.claude/plugins/cache/power-loom-marketplace/power-loom/

# Route-decide with continuation context (H.7.5 protocol)
node ~/Documents/claude-toolkit/scripts/agent-team/route-decide.js \
  --task "<task>" \
  --context "<paste excerpt of last assistant response that locked the routing>"
```

## Mid-stream abort/escalate protocol

| Condition | Action |
|---|---|
| A hook fails closed unexpectedly | STOP. Capture log tails. Write `bench/ABORT-PHASE-N.md`. Hand back. |
| 3 consecutive contract-verifier verdicts return `fail` for the same persona | PAUSE. Inspect contract file. Document. |
| `agent-identity.js assign` returns new synthid hash without contract change | INVESTIGATE — load-bearing drift signal. Capture contract + synthid_history. |
| Plugin cache version drifts mid-run | Capture delta. SynthId hashes will shift — expected, not bug. |
| Route-decide returns `borderline` | Add `--context "<prior turn>"` and re-invoke. If still borderline, surface to user. |
| Prompt-enrich over-fires on ship-confirmations | If post-v2.8.2 cache: capture as drift (the v2.8.2 runtime gap may still be live; chaos-test caught this in baseline run). |

## Handoff-back protocol

Write `bench/FINAL-DEBRIEF.md` aggregating across phases:

1. **Per-phase debriefs** consolidated
2. **Honest 7-feature scorecard** (HETS / SynthId / tier transitions / contract-verifier / route-decide / prompt-enrich / auto-store) — for each: EXERCISED / PARTIALLY-EXERCISED / NOT-EXERCISED / BROKEN-IN-RUNTIME, with evidence
3. **Drifts caught** — every divergence between toolkit's text rules and observed behavior
4. **Per-identity reputation trajectory** — did any cross tiers?
5. **Quantitative summary** — total spawns, verdicts, findings (CRIT/HIGH/MED/LOW), token usage per phase
6. **Recommended next ship** based on drifts

Hand back to the orchestrator session. The user runs `extract-run.sh` to pull metrics into `bench/control-runs/<version>-run<N>/metrics.json`.

## Honesty contract (read before you start)

The toolkit is a substrate-discipline experiment. Its load-bearing claim is that text rules can be empirically backed by hook-enforced mechanisms, and the mechanisms can be audited against the rules.

**You are running an audit.** Expect to find drifts. Expect to find features that don't work as documented. Expect the formal HETS ceremony to be tempting to skip. **All of that is signal worth capturing, not failure to paper over.**

If you find yourself bypassing a feature for convenience, that bypass IS a finding. Document it in the debrief, don't apologize for it.

The benchmark's value is the honesty of the per-run debrief, not the polish of the project code.
