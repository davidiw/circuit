# Circuit Factory

Turns an AI-generated engineering proposal into an explicit artifact you can inspect, challenge, modify, and re-evaluate. Phase 1 proves one loop on one template: open the Bluetooth Race Car, evaluate it with deterministic rules, break something, read the finding, fix it, and watch the result change.

Design docs: plan and system design live in the shared Claude Doc linked from the handoff conversation; the handoff folder (`/media/data2/circuit_factory_handoff`) holds the PRD, execution spec, templates, and sources.

## Run locally

```bash
npm install
npm run build          # SPA -> dist/
SESSION_SECRET=dev npm run start   # http://127.0.0.1:8797, login with the credentials from the environment
```

For UI work: `npm run dev` (Vite on 5173, proxies /api to 8797, shows a browser-only dev gate).

## Layout

| Path | What | Ports to Dart |
| --- | --- | --- |
| `src/model/` | Zod schemas (Project, Registry, Finding, Coverage, MutationOp), vocabularies, history, workflow state machine | yes, mechanically |
| `src/data/` | `registry.json`, three template fixtures with mutation corpus, loader | yes, it is JSON |
| `src/eval/` | `Ctx` (indexed project + net voltage propagation), one file per rule, `evaluate.ts`, `mutations.ts`, `layout.ts` (pure diagram geometry), `hash.ts` | yes, pure functions |
| `src/ai/` | `Provider` interface, Anthropic and Gemini adapters, fake provider, review prompt (text file), output gate | interface yes, adapters rewritten |
| `src/ui/` | React app: store, library, project view, SVG diagram, findings, coverage, inspector, AI panel | rewritten in Flutter |
| `server/` | Hono: signed-cookie gate, static serving, `/api/review` with limits | keep or rewrite |
| `bench/` | Frozen cases from fixtures x mutations, scoring, price table, runner | yes |
| `deploy/` | nginx site, systemd unit, env example, `deploy.sh` | n/a |

## Tests

`npm test` runs registry integrity, template integrity, the mutation corpus (every mutation in every fixture asserts structured findings, never prose), voltage propagation, layout, the AI output gate with a fake provider, and server auth.

## Benchmark

`npm run bench -- --dry` proves the plumbing with a fake provider. With `ANTHROPIC_API_KEY` and/or `GEMINI_API_KEY` set, `npm run bench` scores each candidate model on recall against the corpus, contradictions, schema failures, latency, and cost, and writes `bench/results/latest.md` with the `AI_PROVIDER` / `AI_MODEL` lines to put in `/etc/circuit/env`.

## Deploy

See `deploy/README.md`. Summary: DNS for circuit.davidwolinsky.com to this host, `/etc/circuit/env` from `deploy/env.example`, `deploy/deploy.sh`, certbot, `deploy/deploy.sh` again.

## Invariants the code enforces

- Templates load and evaluate with zero network calls.
- One `Project` schema for templates and generated designs.
- Every fact carries provenance; `unknown` is a value and rules refuse to compute on it.
- Deterministic findings and AI observations are separate lists with separate origins; AI never writes to project state.
- Coverage is emitted only by analyzers that ran; everything else reads not evaluated.
- Edits are structured ops; the same ops drive the UI, the tests, and the benchmark.
