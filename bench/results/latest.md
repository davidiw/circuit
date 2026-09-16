# Benchmark (dry run) 2026-09-16T19:03:07.313Z

19 cases x 1 reps. Prices as of 2026-09-16. Ranked by mean recall, then contradictions + schema failures + unsupported claims + errors, then p50 latency, then cost.

| Model | Runs | Mean recall | Contradictions | Unsupported claims | Schema failures | Errors | p50 ms | p95 ms | Mean cost USD | Mean obs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fake-1 | 19 | 1.000 | 0 | 0 | 0 | 0 | 1 | 1 | 0.00000 | 0.9 |

## Chosen: fake-1

```
AI_PROVIDER=fake
AI_MODEL=fake-1
```

Dry run with a scripted provider: recall is 1.0 by construction. Run with real keys to select a model.