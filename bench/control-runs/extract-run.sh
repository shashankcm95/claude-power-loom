#!/usr/bin/env bash
# extract-run.sh — pull metrics from a project's bench/snapshots/ into a control-run dir
#
# Usage:
#   bash extract-run.sh \
#     --project ~/Documents/Textbook_to_Tutorial/ \
#     --target  bench/control-runs/v2.8.3-run1/
#
# Reads:
#   <project>/bench/snapshots/baseline-pre-phase-1-*/
#   <project>/bench/snapshots/phase-{1,2,3,4}-end-*/
#   <project>/bench/FINAL-DEBRIEF.md
#   <project>/bench/phase-{1,2,3}-debrief.md
#
# Writes:
#   <target>/metrics.json
#   <target>/MANIFEST.md (auto-generated stub if absent)
#   <target>/notes.md (auto-generated stub if absent)

set -e

PROJECT=""
TARGET=""

while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="$2"; shift 2 ;;
    --target)  TARGET="$2"; shift 2 ;;
    *) echo "unknown arg: $1"; exit 1 ;;
  esac
done

if [ -z "$PROJECT" ] || [ -z "$TARGET" ]; then
  echo "Usage: extract-run.sh --project <path-to-project> --target <control-run-dir>"
  echo ""
  echo "Example:"
  echo "  bash extract-run.sh \\"
  echo "    --project ~/Documents/Textbook_to_Tutorial/ \\"
  echo "    --target  bench/control-runs/v2.8.3-run1/"
  exit 1
fi

if [ ! -d "$PROJECT/bench" ]; then
  echo "ERROR: $PROJECT/bench/ does not exist. Project must have run the locked brief with the bench harness."
  exit 2
fi

mkdir -p "$TARGET"

# Resolve snapshot dirs (most recent of each phase)
BASELINE_SNAP=$(ls -dt "$PROJECT"/bench/snapshots/baseline-pre-phase-1-* 2>/dev/null | head -1)
PHASE1_SNAP=$(ls -dt "$PROJECT"/bench/snapshots/phase-1-end-* 2>/dev/null | head -1)
PHASE2_SNAP=$(ls -dt "$PROJECT"/bench/snapshots/phase-2-end-* 2>/dev/null | head -1)
PHASE3_SNAP=$(ls -dt "$PROJECT"/bench/snapshots/phase-3-end-* 2>/dev/null | head -1)
PHASE4_SNAP=$(ls -dt "$PROJECT"/bench/snapshots/phase-4-end-* 2>/dev/null | head -1)

# Find FINAL-DEBRIEF + per-phase debriefs
FINAL_DEBRIEF="$PROJECT/bench/FINAL-DEBRIEF.md"
PHASE1_DEBRIEF="$PROJECT/bench/phase-1-debrief.md"
PHASE2_DEBRIEF="$PROJECT/bench/phase-2-debrief.md"
PHASE3_DEBRIEF="$PROJECT/bench/phase-3-debrief.md"

# Run the Python extractor
python3 - <<PYEOF
import json, os, re, sys
from pathlib import Path

target = Path("$TARGET")
project = Path("$PROJECT")
final_debrief = "$FINAL_DEBRIEF"
phase_debriefs = ["$PHASE1_DEBRIEF", "$PHASE2_DEBRIEF", "$PHASE3_DEBRIEF"]
snaps = {
    "baseline": "$BASELINE_SNAP",
    "phase1":   "$PHASE1_SNAP",
    "phase2":   "$PHASE2_SNAP",
    "phase3":   "$PHASE3_SNAP",
    "phase4":   "$PHASE4_SNAP",
}

def read_or_empty(path):
    try: return Path(path).read_text()
    except: return ""

def load_or_empty_json(path):
    try: return json.loads(Path(path).read_text())
    except: return {}

# ---- Findings count by severity ----
all_text = read_or_empty(final_debrief)
for p in phase_debriefs:
    all_text += "\n" + read_or_empty(p)

def count_sev(text, label):
    # Look for `CRITICAL ` `HIGH ` etc. in finding tables. This is approximate;
    # adjust as your debrief format stabilizes.
    pattern = re.compile(rf"\b{label}\b", re.IGNORECASE)
    return len(pattern.findall(text))

# Crude count: each severity word occurs ~ once per finding row
crit = count_sev(all_text, "CRITICAL")
high = count_sev(all_text, "HIGH")
med = count_sev(all_text, "MEDIUM")
low = count_sev(all_text, "LOW")

# Total findings (severity_total)
findings_total = crit + high + med + low
findings_ch = crit + high

# ---- Token usage from phase4 snapshot ----
tokens = load_or_empty_json(os.path.join(snaps["phase4"], "token-usage.json")) if snaps["phase4"] else {}
total_tokens = tokens.get("total", 0)
cache_read = tokens.get("cache_read", 0)
input_tokens = tokens.get("input", 0)
cache_create = tokens.get("cache_create", 0)
cache_reuse = round(cache_read / (input_tokens + cache_read + cache_create), 3) if (input_tokens + cache_read + cache_create) > 0 else None

# ---- Tier transitions ----
baseline_ids = load_or_empty_json(os.path.join(snaps["baseline"], "agent-identities.json")) if snaps["baseline"] else {"identities": {}}
phase4_ids = load_or_empty_json(os.path.join(snaps["phase4"], "agent-identities.json")) if snaps["phase4"] else {"identities": {}}

def tier_of(data):
    v = data.get("verdicts", {"pass":0, "partial":0, "fail":0})
    total = v["pass"] + v["partial"] + v["fail"]
    if total < 5: return "unproven"
    pass_rate = v["pass"] / total
    if pass_rate >= 0.8: return "high-trust"
    if pass_rate >= 0.5: return "medium-trust"
    return "low-trust"

tier_transitions = 0
transitions_detail = []
for id_str, post_data in phase4_ids.get("identities", {}).items():
    pre_data = baseline_ids.get("identities", {}).get(id_str, {"verdicts":{"pass":0,"partial":0,"fail":0}})
    pre_tier = tier_of(pre_data)
    post_tier = tier_of(post_data)
    if pre_tier != post_tier:
        tier_transitions += 1
        transitions_detail.append({
            "identity": id_str,
            "from": pre_tier,
            "to": post_tier,
            "verdicts_recorded": post_data.get("verdicts", {}).get("pass", 0) +
                                 post_data.get("verdicts", {}).get("partial", 0) +
                                 post_data.get("verdicts", {}).get("fail", 0),
        })

# ---- Verdict counts ----
phase4_patterns = load_or_empty_json(os.path.join(snaps["phase4"], "agent-patterns.json")) if snaps["phase4"] else {"patterns": []}
baseline_patterns = load_or_empty_json(os.path.join(snaps["baseline"], "agent-patterns.json")) if snaps["baseline"] else {"patterns": []}
verdicts_added = len(phase4_patterns.get("patterns", [])) - len(baseline_patterns.get("patterns", []))

# Verdicts breakdown
v_pass = v_partial = v_fail = 0
for p in phase4_patterns.get("patterns", [])[len(baseline_patterns.get("patterns", [])):]:
    v = p.get("verdict")
    if v == "pass": v_pass += 1
    elif v == "partial": v_partial += 1
    elif v == "fail": v_fail += 1

# ---- Spawn ceremony deviation rate ----
# Heuristic: actors spawned outside the pattern-recorder loop didn't generate entries.
# If actors_spawned (from FINAL-DEBRIEF "Total spawns" line) > verdicts_recorded, the excess deviated.
actors_match = re.search(r"Total spawns\s*[\|:]\s*(\d+)", all_text)
actors_spawned = int(actors_match.group(1)) if actors_match else verdicts_added
spawn_ceremony_deviation = round(1.0 - (verdicts_added / actors_spawned), 3) if actors_spawned > 0 else 0.0
verdict_loop_closure = round(verdicts_added / actors_spawned, 3) if actors_spawned > 0 else 0.0

# ---- Convergence rate (look for "convergence" or "both" / "independently" in FINAL) ----
convergence_match = re.findall(r"convergence|independently caught|both\s+\w+\s+and", read_or_empty(final_debrief), re.IGNORECASE)
convergence_pairs = len(convergence_match)
convergence_rate = round(convergence_pairs / max(findings_total, 1), 3)

# ---- Compose metrics.json ----
metrics = {
    "schema_version": 1,
    "run_id": target.name,
    "extracted_at_utc": __import__("datetime").datetime.utcnow().isoformat() + "Z",
    "extraction_method": "extract-run.sh",
    "source_project": str(project),
    "tier_1_substrate": {
        "findings_density_critical_high": findings_ch,
        "findings_density_total": findings_total,
        "convergence_rate": convergence_rate,
        "verdict_loop_closure": verdict_loop_closure,
        "tier_transition_count": tier_transitions,
        "contract_verifier_exercise_rate": None,  # not extractable without per-spawn metadata; set manually
        "hook_runtime_gaps": None,  # set manually based on debrief
        "forge_cite_rate": None,  # set manually
        "tokens_per_finding": int(total_tokens / max(findings_total, 1)) if total_tokens else 0,
        "spawn_ceremony_deviation_rate": spawn_ceremony_deviation,
        "cache_reuse_pct": cache_reuse,
        "synthid_drift_events": None,  # set manually from log greps
    },
    "tier_2_project": {
        "tests_passing": None,  # set manually
        "build_success": None,  # set manually
        "eslint_errors": None,
        "typescript_errors": None,
        "wall_clock_hours_total": None,
    },
    "qualitative_flags": {},
    "deviations": [],
    "findings_breakdown_by_severity": {
        "critical": crit,
        "high": high,
        "medium": med,
        "low": low,
    },
    "tier_transitions_detail": transitions_detail,
    "actors_spawned_total": actors_spawned,
    "verdicts_recorded": {
        "pass": v_pass,
        "partial": v_partial,
        "fail": v_fail,
    },
    "tokens": tokens,
    "_extraction_notes": [
        "Auto-extracted via extract-run.sh. Manually review/fill the None fields:",
        "  - contract_verifier_exercise_rate (count from spawn debrief)",
        "  - hook_runtime_gaps (count documented in FINAL-DEBRIEF 'gap' or 'runtime' findings)",
        "  - forge_cite_rate (forged skills cited by ≥1 downstream actor)",
        "  - synthid_drift_events (grep ~/.claude/logs/ for synthid_drift:true)",
        "  - tier_2_project metrics (run eslint/tsc/test commands against the project)",
        "  - qualitative_flags (read FINAL-DEBRIEF for evidence)",
        "  - deviations (capture environment/brief-spec/tooling-failure departures)",
    ],
}

# Write metrics.json
target.mkdir(parents=True, exist_ok=True)
(target / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")

# Stub MANIFEST.md and notes.md if absent
if not (target / "MANIFEST.md").exists():
    (target / "MANIFEST.md").write_text(f"""# {target.name} — Manifest

**Run extracted via extract-run.sh on {metrics['extracted_at_utc']}.**

## Where the run artifacts live

- Project: `{project}`
- Snapshots: `{project}/bench/snapshots/`
- FINAL-DEBRIEF: `{project}/bench/FINAL-DEBRIEF.md`
- Per-phase debriefs: `{project}/bench/phase-{{1,2,3}}-debrief.md`

## Status

- Toolkit version under test: <FILL IN — e.g., 2.8.3>
- Toolkit-repo commit at time of run: <FILL IN — `git rev-parse --short HEAD` from `~/Documents/claude-toolkit/`>
- Brief: bench/control-runs/brief.md (v1)
- Run date: <FILL IN>
- Deviations from brief: see metrics.json `deviations` array

## Caveats

(Document any run-specific notes — methodology deviations, environment quirks, etc.)
""")

if not (target / "notes.md").exists():
    (target / "notes.md").write_text(f"""# {target.name} — Human Notes

## What happened in this run

(One paragraph summary of the run as a whole)

## Notable findings vs prior runs

(Compare to the most recent prior run on the same toolkit version, OR to the baseline. What's different?)

## Open follow-ups

(Anything captured during the run that needs handling outside the run's scope)

## What I'd do differently next time

(Methodology improvements for future runs)
""")

print(f"Extraction complete. Wrote:")
print(f"  {target}/metrics.json")
print(f"  {target}/MANIFEST.md (stub — fill in TOOLKIT VERSION + DATE)")
print(f"  {target}/notes.md (stub — write up the run)")
print()
print(f"Tier-1 substrate snapshot:")
print(f"  findings (CRIT+HIGH/total):  {findings_ch} / {findings_total}")
print(f"  tier transitions:            {tier_transitions}")
print(f"  verdict loop closure:        {verdict_loop_closure}")
print(f"  spawn ceremony deviation:    {spawn_ceremony_deviation}")
print(f"  cache reuse:                 {cache_reuse}")
print(f"  tokens / finding:            {int(total_tokens / max(findings_total, 1))}")
print()
print(f"⚠️ Manually fill the None fields in metrics.json (see _extraction_notes).")
PYEOF
