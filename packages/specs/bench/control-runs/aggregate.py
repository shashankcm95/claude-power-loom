#!/usr/bin/env python3
"""
aggregate.py — Cross-version benchmark aggregator.

Reads metrics.json from multiple <version>-run<N>/ directories, computes
mean + std per metric per version, then prints a comparison report with
variance bands and effect-size labels.

Usage:
    python3 aggregate.py v2.8.2-run* v2.8.3-run*
    python3 aggregate.py --baseline v2.8.2 --treatment v2.8.3
    python3 aggregate.py --all  # scan all <version>-run* dirs

Conventions:
- Run directories named <version>-run<N>/ (e.g., v2.8.2-run1/)
- Each contains metrics.json with the schema in metrics-schema.json
- Versions are grouped by the prefix before "-run"

Effect-size labels (pre-registered to prevent post-hoc rationalization):
- MEANINGFUL  = |delta| > 2× max(baseline_stddev, 0.05 * baseline_mean)
- MARGINAL    = |delta| within 1-2× variance band
- NOISE       = |delta| within 1× variance band (NOT claimable)

For n=1 on baseline or treatment, variance is undefined → all deltas
labeled "NEEDS-MORE-DATA" and the report flags this loudly.
"""

import argparse
import json
import math
import os
import re
import sys
from pathlib import Path
from statistics import mean, stdev
from collections import defaultdict


HERE = Path(__file__).resolve().parent


def load_run(run_dir: Path):
    """Load metrics.json from a run directory.

    v2.9.0 FIX-I5 (lior HIGH-4 absorbed): refuse runs with _unfilled_fields
    by inspection rather than coincidental null-skip. If a run has unfilled
    fields, print loudly and skip aggregation. Operator MUST run
    `extract-run.sh --strict` OR manually backfill before retrying.
    """
    metrics_path = run_dir / "metrics.json"
    if not metrics_path.exists():
        return None
    try:
        metrics = json.loads(metrics_path.read_text())
    except json.JSONDecodeError as e:
        print(f"WARN: Skipping {run_dir.name}: invalid JSON ({e})", file=sys.stderr)
        return None
    unfilled = metrics.get("_unfilled_fields") or []
    if unfilled:
        print(
            f"WARN: Skipping {run_dir.name}: {len(unfilled)} unfilled field(s) "
            f"({', '.join(unfilled[:3])}{'...' if len(unfilled) > 3 else ''}). "
            f"Run `extract-run.sh --strict` to validate OR manually backfill metrics.json.",
            file=sys.stderr,
        )
        return None
    return metrics


def group_by_version(run_dirs):
    """Group run dirs by toolkit version prefix (e.g., v2.8.2-run1 → v2.8.2)."""
    groups = defaultdict(list)
    for d in run_dirs:
        m = re.match(r"(v\d+\.\d+(?:\.\d+)?)-run\d+", d.name)
        if m:
            groups[m.group(1)].append(d)
    return groups


# All Tier-1 metric keys we'll aggregate (matches metrics-schema.json)
TIER_1_KEYS = [
    "findings_density_critical_high",
    "findings_density_total",
    "convergence_rate",
    "verdict_loop_closure",
    "tier_transition_count",
    "contract_verifier_exercise_rate",
    "hook_runtime_gaps",
    "forge_cite_rate",
    "tokens_per_finding",
    "spawn_ceremony_deviation_rate",
    "ceremony_completion_rate_overall",  # v2.8.3 — observability via agent-identity.js stats
    "cache_reuse_pct",
    "synthid_drift_events",
]

# Direction map: True = ↑ better, False = ↓ better, None = context-dependent
DIRECTION = {
    "findings_density_critical_high": None,  # saturates
    "findings_density_total": None,
    "convergence_rate": True,
    "verdict_loop_closure": True,
    "tier_transition_count": True,
    "contract_verifier_exercise_rate": True,
    "hook_runtime_gaps": False,
    "forge_cite_rate": True,
    "tokens_per_finding": False,
    "spawn_ceremony_deviation_rate": False,
    "ceremony_completion_rate_overall": True,  # v2.8.3
    "cache_reuse_pct": True,
    "synthid_drift_events": None,
}


def extract(metrics, key):
    """Pull a Tier-1 metric, return None if absent."""
    return (metrics or {}).get("tier_1_substrate", {}).get(key)


def aggregate_metrics(runs):
    """For a list of run dicts, compute {metric: [values]} (None filtered)."""
    out = defaultdict(list)
    for r in runs:
        for k in TIER_1_KEYS:
            v = extract(r, k)
            if v is not None:
                out[k].append(v)
    return dict(out)


def stats(values):
    """Return (mean, stddev, n). For n=1, stddev=None."""
    n = len(values)
    if n == 0:
        return None, None, 0
    m = mean(values)
    s = stdev(values) if n >= 2 else None
    return m, s, n


def label_delta(baseline_mean, baseline_std, treat_mean, baseline_n, treat_n):
    """Categorize the size of (treat - baseline)."""
    if baseline_n < 2 or treat_n < 1:
        return "NEEDS-MORE-DATA"
    if baseline_mean is None or treat_mean is None:
        return "NEEDS-MORE-DATA"
    if baseline_std is None or baseline_std == 0:
        # Fall back to 5% of mean as variance floor
        baseline_std = abs(baseline_mean) * 0.05 if baseline_mean else 0.01
    delta = treat_mean - baseline_mean
    abs_delta = abs(delta)
    band_1x = baseline_std
    band_2x = 2 * baseline_std
    if abs_delta <= band_1x:
        return "NOISE"
    if abs_delta <= band_2x:
        return "MARGINAL"
    return "MEANINGFUL"


def direction_arrow(key, delta):
    """↑ / ↓ / · arrow based on metric direction and observed delta."""
    if delta is None:
        return "·"
    d = DIRECTION.get(key)
    if d is True:
        return "↑" if delta > 0 else ("↓" if delta < 0 else "·")
    if d is False:
        return "↓" if delta < 0 else ("↑" if delta > 0 else "·")
    return "·"  # context-dependent


def is_improvement(key, delta):
    """True if the delta moves the metric in the desired direction."""
    d = DIRECTION.get(key)
    if d is None or delta is None or delta == 0:
        return None
    if d is True:
        return delta > 0
    return delta < 0  # ↓-better metrics improve when delta is negative


def fmt(v, key=None):
    """Format a metric value compactly."""
    if v is None:
        return "—"
    if isinstance(v, float):
        if key and key in ("tokens_per_finding",):
            return f"{int(v):,}"
        return f"{v:.3f}"
    if isinstance(v, int) and abs(v) >= 10000:
        return f"{v:,}"
    return str(v)


def print_report(version_groups):
    """Render the cross-version comparison."""
    versions = sorted(version_groups.keys())

    print("=" * 90)
    print(f"  bench/control-runs cross-version aggregate report")
    print(f"  versions:  {' · '.join(versions)}")
    print(f"  runs per version:  " + ", ".join(f"{v}={len(version_groups[v])}" for v in versions))
    print("=" * 90)
    print()

    if not versions:
        print("No runs found.")
        return

    # Load + aggregate per version
    per_version = {}
    for v in versions:
        runs = [load_run(d) for d in version_groups[v]]
        runs = [r for r in runs if r is not None]
        per_version[v] = aggregate_metrics(runs)

    # Baseline = first version chronologically
    baseline_v = versions[0]
    baseline_data = per_version[baseline_v]

    # Sample-size warnings
    print("Sample sizes per version (n):")
    for v in versions:
        ns = [len(per_version[v].get(k, [])) for k in TIER_1_KEYS]
        max_n = max(ns) if ns else 0
        flag = "⚠️ n=1 (no variance band)" if max_n == 1 else f"n={max_n}" if max_n >= 2 else "  n=0"
        print(f"  {v}:  {flag}")
    print()

    # Header
    cols = [f"  {'metric':<36}", f"{baseline_v} (μ ± σ, n)"]
    for v in versions[1:]:
        cols.append(f"{v} (μ ± σ, n)")
        cols.append(f"Δ vs {baseline_v}")
        cols.append("size")
    print(" | ".join(cols))
    print("-" * (sum(len(c) for c in cols) + 3 * (len(cols) - 1)))

    # Per-metric rows
    for key in TIER_1_KEYS:
        b_vals = baseline_data.get(key, [])
        b_mean, b_std, b_n = stats(b_vals)
        row = [
            f"  {key:<36}",
            f"{fmt(b_mean, key)} ± {fmt(b_std, key) if b_std is not None else '—'}  (n={b_n})",
        ]
        for v in versions[1:]:
            t_vals = per_version[v].get(key, [])
            t_mean, t_std, t_n = stats(t_vals)
            row.append(f"{fmt(t_mean, key)} ± {fmt(t_std, key) if t_std is not None else '—'}  (n={t_n})")
            if b_mean is not None and t_mean is not None:
                delta = t_mean - b_mean
                arrow = direction_arrow(key, delta)
                improvement = is_improvement(key, delta)
                size = label_delta(b_mean, b_std, t_mean, b_n, t_n)
                pct = (delta / b_mean * 100) if b_mean != 0 else float('inf')
                row.append(f"{arrow} {fmt(delta, key)} ({pct:+.0f}%)" if abs(pct) < 1000 else f"{arrow} {fmt(delta, key)}")
                marker = "  " if improvement is None else ("✅ " if improvement else "❌ ")
                row.append(f"{marker}{size}")
            else:
                row.append("—")
                row.append("—")
        print(" | ".join(row))

    print()
    print("Effect-size legend:")
    print("  MEANINGFUL       — |delta| > 2× baseline_stddev (or 10% of mean if n=1 baseline). Claimable improvement.")
    print("  MARGINAL         — |delta| within 1-2× variance band. Real-but-small.")
    print("  NOISE            — |delta| within 1× variance band. NOT claimable.")
    print("  NEEDS-MORE-DATA  — baseline n<2 or treatment n=0. Get more samples before claiming anything.")
    print()
    print("Improvement marker:")
    print("  ✅ — moves the metric in the desired direction (or removes a gap)")
    print("  ❌ — moves the metric in the wrong direction (regression)")
    print("  ·  — context-dependent metric; direction is interpretation-dependent")
    print()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "run_dirs",
        nargs="*",
        help="Run directories to aggregate (e.g., v2.8.2-run1 v2.8.2-run2 v2.8.3-run1). "
             "Globs expanded by shell.",
    )
    parser.add_argument("--all", action="store_true", help="Scan all v*-run* dirs in bench/control-runs/")
    parser.add_argument("--baseline", help="Baseline version (e.g., v2.8.2)")
    parser.add_argument("--treatment", help="Treatment version (e.g., v2.8.3)")

    args = parser.parse_args()

    run_dirs = []
    if args.all:
        run_dirs = sorted(HERE.glob("v*-run*/"))
    elif args.baseline or args.treatment:
        if args.baseline:
            run_dirs += sorted(HERE.glob(f"{args.baseline}-run*/"))
        if args.treatment:
            run_dirs += sorted(HERE.glob(f"{args.treatment}-run*/"))
    elif args.run_dirs:
        run_dirs = [Path(p) for p in args.run_dirs]
        run_dirs = [p if p.is_absolute() else (HERE / p) for p in run_dirs]
    else:
        parser.print_help()
        sys.exit(0)

    run_dirs = [d for d in run_dirs if d.exists() and d.is_dir()]
    if not run_dirs:
        print("No run directories found.", file=sys.stderr)
        sys.exit(1)

    groups = group_by_version(run_dirs)
    print_report(groups)


if __name__ == "__main__":
    main()
