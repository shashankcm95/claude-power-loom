# power-loom Boot-Test Harness (v0.1)

A one-shot **boot test for the plugin** — runs a small but representative task headlessly and captures token + latency + behavioral telemetry. The "metaphorical OS boot upon restart" for new users to verify the plugin works end-to-end and to give us live metrics for plugin submission review.

## v0.1 — what's shipped

- `runner.sh` — orchestrates a single `claude -p` invocation against the fixture; captures stream-json, pre/post snapshots, fixture diff.
- `collect.js` — parses stream-json + diffs counters → structured `metrics.json` + deterministic PASS/FAIL.
- `_snapshot.js` — captures `~/.claude/` state (counters, library catalogs, prompt-patterns, transcript count) for pre/post diff.
- `boot-task.md` — the One Big Task specification + acceptance criteria.
- `fixture/` — minimal Node.js todo CLI (3 files; ~120 LoC); the working substrate the boot task operates on.

## What's not yet shipped

- **v0.2**: `--bare` baseline mode + plugin-on-vs-plugin-off diff report.
- **v0.3**: blinded moderator pass (separate Claude judges both transcripts).
- **v0.4**: cross-user metric aggregation format.

## How to run

```bash
cd <toolkit-repo>
bash bench/runner.sh
```

Output lands in `bench/runs/<timestamp>-plugin-on/`:

```
runs/<ts>-plugin-on/
├── pre-snapshot.json    # ~/.claude/ state before the run
├── post-snapshot.json   # ~/.claude/ state after
├── stream.jsonl         # full claude -p stream-json output
├── stderr.log           # claude -p stderr
├── work/                # working copy of fixture (mutated by claude)
└── metrics.json         # structured boot-test result
```

## What "PASS" means (deterministic)

The 6 criteria evaluated by `collect.js`:

1. `claude_exit_zero` — claude -p exited 0
2. `cli_has_export` — generated cli.js has an export handler (regex check)
3. `test_added` — cli.test.js now has > 3 tests (fixture started with 3)
4. `smoke_tests_pass` — `node cli.test.js` exits 0 in the work dir
5. `readme_mentions_export` — README references the new feature
6. `cli_has_path_validation` — some form of path validation present in cli.js

If all 6 pass, the boot test is GREEN. If any fail, the report explains which and why.

## Sample output (real run, 2026-05-20)

```
Mode:           plugin-on
Wallclock:      71s
API duration:   67.7s
Turns:          12
Tokens (in):    17
Tokens (out):   4549
Cache reads:    412907
Cache creation: 41226
Tool uses:      {"Bash":3,"Read":3,"Edit":4,"AskUserQuestion":1}
Sub-agent spawns: 0
Hook bumps:     {"turn_counter_delta":1,"signal_count_delta":0,"last_scan_changed":false,"transcripts_added":1}
Files modified: 3
Files created:  0

=== Deterministic PASS criteria ===
  PASS  claude_exit_zero  (exit=0)
  PASS  cli_has_export  (export reference found)
  PASS  test_added  (7 test(s); fixture started with 3)
  PASS  smoke_tests_pass  (exit=0; 7 passed)
  PASS  readme_mentions_export  (export mentioned)
  PASS  cli_has_path_validation  (validation pattern present)

OVERALL: PASS
```

## Empirical findings (iterated)

### What works

- **Headless mode fires the Stop hook** (turnCounter +1; library transcript created). The GitHub #59105 parity concern doesn't affect at least the Stop event.
- **Sub-agent spawn works in headless** — both `architect` and `code-reviewer` spawned when the boot task is large enough + explicitly authorizes orchestration ("you have permission to spawn the agents you need"). Their reviews were substantive (path.resolve sandbox analysis, CSV RFC 4180 deviation flagged).
- **`--permission-mode bypassPermissions` suppresses AskUserQuestion errors.** Without it, Claude politely asks before Bash invocations and the headless answer errors back, wasting turns.
- **Cache-read dominates token cost** (828k vs 13k output). The always-on rules + skills + KB context loads predictably. Plugin-on vs `--bare` comparison (v0.2) will show this as the primary "cost of plugin context."

### What the bench has surfaced as plugin compliance gaps in headless mode

These are **real findings** worth investigating before plugin submission:

| Soft signal | Status | Interpretation |
|---|---|---|
| `kb_consultation` | ❌ NOT firing | Architect + code-reviewer wrote substantive reviews but cited NO `kb:` references, even though kb-consultation-discipline (H.9.20.0 v2.0.3) says HETS personas should cite. Either: (a) the discipline isn't enforced for Agent-tool spawns, (b) is enforced via a hook that doesn't fire in headless, or (c) sub-agent KB refs don't surface in the parent's view of the Agent tool result. |
| `plan_mode_evidence` | ❌ NOT firing | No `EnterPlanMode`/`ExitPlanMode` tool calls despite the workflow rule requiring plan-mode for ≥2-file changes. Likely cause: plan-mode requires an interactive Approve-plan dialog unavailable in `-p` mode. |
| `route_decide_consulted` | ❌ NOT firing | `route-decide.js` was never invoked before sub-agent spawn, despite the workflow rule. Claude jumped straight to `Agent` tool. Real instruction-following gap. |

These are not boot-test failures — they're **observability signals** for the plugin maintainer to act on. The whole point of the boot test was to expose this kind of thing.

### Latest live numbers (expanded JSON+CSV task, 2026-05-20)

```
Wallclock:        250s        (≈3× longer than v0.1.5 baseline; substantive work)
Turns:            19
Tokens (input):   29
Tokens (output):  13,271
Cache reads:      828,384     ← cost of plugin context loaded into headless session
Cache creation:   36,449
Tool uses:        Bash(4) + Read(7) + Agent(2) + Write(2) + Edit(7)
Sub-agent spawns: 2           (architect + code-reviewer; both produced substantive reviews)
Hook bumps:       Stop fired once (turnCounter +1)
Deterministic:    10/10 PASS
Soft signals:     specialist_agents_spawned=YES, research_mode_citations=YES
                  kb_consultation=no, plan_mode_evidence=no, route_decide_consulted=no
```

## Architecture decisions

- **CLI `claude -p`, not Agent SDK.** Probe confirmed hooks fire; CLI is simpler for end-users to run as a boot test (`bash runner.sh`) than installing a Python/TS SDK.
- **stream-json + post-run JSONL.** Real-time tool events come from stream-json; the full transcript is read post-run from the session JSONL file.
- **`--bare` mode for baseline (v0.2).** Built-in CLI flag bypasses all hooks/skills/plugins — cleaner than symlink-swapping `~/.claude/`.
- **Synthetic fixture, not dogfood.** The boot test must run on any machine without requiring the user to clone the toolkit repo. The fixture is shipped with the plugin.
- **Metrics in tokens + latency, not dollars.** Tokens are the durable unit; pricing changes.

## Roadmap

| Ship | Scope | Status |
|---|---|---|
| **v0.1** | plugin-on side only; deterministic PASS gate | ✅ shipped |
| **v0.2** | `--bare` baseline + diff report (plugin-on vs plugin-off) | next |
| **v0.3** | Blinded moderator pass for qualitative dimensions | after v0.2 stable |
| **v0.4** | Cross-user metric aggregation format (`metrics.json` schema-stable; submission format documented) | after v0.3 stable |
