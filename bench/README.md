# Model selection benchmark

Runs the AI adversarial reviewer over the frozen fixture corpus and ranks candidate models by correctness first, then latency, then cost.

## Run

```
npx tsx bench/run.ts --dry --reps 1                 # scripted provider; proves the plumbing
ANTHROPIC_API_KEY=... GEMINI_API_KEY=... npm run bench -- --reps 3
npm run bench -- --models claude-haiku-4-5,gemini-3.8-flash --cases race_car
```

A provider whose key is absent is skipped and reported. Results land in `bench/results/<timestamp>.json` (gitignored) and `bench/results/latest.md` (committed), which ends with the exact `AI_PROVIDER` / `AI_MODEL` lines for the server environment.

## Cases

`bench/cases.ts` builds the corpus from `src/data/templates/*.json`: one baseline case per template plus one case per mutation, with the mutation's `expected` findings as the target. To add a case, add a mutation to a fixture. The same entry is also a unit test for the deterministic rules.

## Scoring, per call

| Metric | Definition |
| --- | --- |
| recall | Fraction of expected findings for which some AI observation shares the category and, when the expectation names an instance, affects that instance. Baseline cases with no expectations score 1. |
| contradictions | Observations that set `contradicts_rule` to a rule that did fire on that case. |
| claimsUnsupported | Observations in thermal or EMI categories with a severity other than unknown/unsupported while coverage marks that dimension not evaluated. |
| schemaFailures | Responses the output gate could not parse. |
| latency | Provider round trip, p50 and p95 per model. |
| cost | Tokens times `bench/prices.json`; each price carries its source and as-of date. |

Ranking: mean recall descending, then contradictions + schema failures + unsupported claims + errors ascending, then p50 latency, then mean cost.

## Candidates

Anthropic `claude-sonnet-5`, `claude-haiku-4-5`; Gemini `gemini-3.8-flash`, `gemini-3.1-pro-preview`. Edit `CANDIDATES` in `bench/run.ts` and `bench/prices.json` together.
