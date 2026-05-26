---
kb_id: ml-dev/training-vs-inference
version: 1
tags: [ml, training, inference, deployment, drift, starter]
---

## Summary

Training-vs-inference parity for HETS ml-engineer personas: feature transforms must be byte-identical between training pipeline and serving path; deployment topology choices (batch / online / streaming) drive latency vs cost tradeoffs; drift monitoring (input distribution + prediction distribution + outcome correlation) is required for any model in production; rollback path must be tested before deploy. Stub doc — expand on use.

## Full content (starter — expand when first persona uses)

### Training-serving skew (the #1 silent failure mode)

Skew sources:
- Different feature transformation code in training (offline) vs serving (online)
- Schema drift between training data and live inputs
- Time-based features computed from different timestamps (training: batch run time; serving: request time)
- Categorical encoding maps not pinned and re-fit at serve time

Mitigations:
- **Single source of truth for transforms** — one library, called by both pipelines
- **Feature store** — compute features once, read from same store at train + serve
- **Eval on production-shaped inputs** before promotion
- **Shadow deployment** — new model runs alongside old, compare predictions, measure divergence

### Deployment topologies

| Topology | Latency | Cost | When to use |
|----------|---------|------|-------------|
| Batch (offline) | hours | low | Recommendations, reports, periodic scoring |
| Online (per-request) | <100ms | high | Real-time UX (search ranking, fraud detection) |
| Streaming | seconds-minutes | medium | Event-driven (user actions, sensor data) |
| On-device | varies | shifted to user | Privacy-sensitive, offline-first apps |

### Drift monitoring (required for any production model)

Three signals:
1. **Input drift** — feature distribution shifts vs training (PSI, KL divergence)
2. **Prediction drift** — model output distribution shifts (independent of inputs)
3. **Outcome drift** — correlation between predictions and ground-truth changes (the actual business metric)

Alert on (1) and (2) within hours; (3) requires labeled outcomes which lag.

### Rollback path

Every deploy needs a documented rollback:
- Previous model artifact retained for at least 14 days
- Routing config can be flipped instantly (feature flag, weighted load balancer)
- Test the rollback in staging before relying on it

### Common pitfalls

- Training-serving skew assumed-fixed without measurement
- Deploy without drift monitoring (model deteriorates silently)
- "We can always retrain" assumption ignores label availability + retraining cost
- Production model accumulates uninspectable changes via online learning (drift not detectable retroactively)

### Related KB docs (planned)

- `kb:ml-dev/pipeline-essentials`
- `kb:ml-dev/feature-store-patterns`
- `kb:ml-dev/eval-design`
