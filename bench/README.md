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

## Empirical findings from v0.1

- **Headless mode fires the Stop hook** (turnCounter +1; library transcript created). The GitHub #59105 parity concern doesn't seem to affect at least the Stop event.
- **Small tasks may not trigger sub-agent spawns.** This 71s task with ~120 LoC of fixture didn't spawn architect or code-reviewer — Claude handled it directly via Edit + Bash. To exercise sub-agents reliably, the boot task may need to grow OR we accept this is task-size-dependent behavior.
- **Cache-read dominates token cost.** 412k cache-read vs 17 input + 4549 output — the always-on rules + skills context loads predictably. Plugin-on vs plugin-off comparison will show this cache-read delta as a primary "cost of plugin context".
- **AskUserQuestion was invoked once** under headless — worth investigating what happens to interactive tool calls in `-p` mode (probably falls through without blocking).
- **Wallclock 71s** is fast enough to run as a true boot test. v0.2 adds another ~30-60s for the `--bare` baseline run.

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
