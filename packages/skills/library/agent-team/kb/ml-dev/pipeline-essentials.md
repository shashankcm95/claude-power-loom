---
kb_id: ml-dev/pipeline-essentials
version: 1
tags: [ml, pipelines, orchestration, reproducibility, starter]
---

## Summary

ML pipeline essentials for HETS ml-engineer personas: dataset versioning (DVC, LakeFS, Delta) is non-negotiable; experiment tracking (MLflow, WandB, Neptune) for hyperparams + metrics + artifacts; deterministic seeding across NumPy / PyTorch / TF / Python random; train/val/test splits documented + immutable per dataset version; pipeline DAG as code (Airflow, Prefect, Dagster, Kedro). Stub doc — expand on use.

## Full content (starter — expand when first persona uses)

### Reproducibility checklist

For any training run that's worth keeping:

- **Dataset version pinned** (DVC commit hash, LakeFS branch, Delta version)
- **Code version pinned** (git SHA — including dependencies via `pip freeze` or lockfile)
- **Hyperparameters logged** (config file in artifact, or experiment tracker)
- **All random seeds set** (Python `random`, NumPy, PyTorch, CUDA)
- **Hardware logged** (GPU model, CUDA version, driver version)
- **Eval metrics logged** with confidence intervals where applicable

### Pipeline shape

Three stages minimum:

1. **Data ingestion + validation** — schema check, range check, drift check vs prior version
2. **Training** — produces model artifact + eval metrics
3. **Eval** — runs against holdout + production-like data; gates model promotion

Optional:
- **Feature engineering** as a separate stage if reused across models
- **Hyperparameter sweep** as a higher-level orchestration

### Orchestrators

| Tool | Strength | Weakness |
|------|----------|----------|
| Airflow | Mature, large ecosystem | Heavy, Python-only DAG |
| Prefect | Modern, dynamic DAGs | Smaller ecosystem |
| Dagster | Strong typing, asset-aware | Higher learning curve |
| Kedro | ML-opinionated | Less general-purpose |

### Common pitfalls

- Train/val split inside the training script (silently re-splits each run; defeats reproducibility)
- Test set used for hyperparameter tuning (leakage; reported metrics inflated)
- Model promoted to production without holdout eval against production-like distribution
- Feature transforms diverge between training pipeline and serving (training-serving skew)
- Random seeds set in training but not in dataloaders (shuffles differ across runs)

### Related KB docs (planned)

- `kb:ml-dev/training-vs-inference` — train-serve skew + deployment topologies
- `kb:ml-dev/eval-design` — holdout strategy, subgroup analysis, eval-as-contract
- `kb:ml-dev/feature-store-patterns`
