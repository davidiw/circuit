# Circuit Factory

Circuit Factory turns an electronics design into an explicit engineering artifact you can inspect, modify, evaluate, and optimize. It makes assumptions, provenance, validation coverage, and engineering tradeoffs visible instead of hiding them behind a generated answer.

### Live demo

https://circuit.davidwolinsky.com

No login: the prototype holds no sensitive content. No credential or API key is committed; AI provider keys, when used, come from the environment only.

## Quick tour

1. Open **Bluetooth Race Car**.
2. Read the **How this design works** card and open it. Click a step in the flow to see its parts light up in the diagram; open a decision to read why the design is built this way.
3. Press **Evaluate**. The deterministic rules run in the browser and the design reads *evaluated · current*.
4. Open the coverage line under the findings to see what was checked, what is partial because it rests on an assumption, and what is not evaluated at all.
5. Tap a real pin in the diagram (the XIAO's **D6** is a good one), choose **Connect to another pin**, and wire it somewhere wrong, such as the driver's **GND**. Confirm the merge.
6. Notice the state chip now reads *changed since evaluation* and the findings say they are from the previous state.
7. Press **Re-evaluate**.
8. Open the new violation. It shows the rule, the evidence with the source of each value, the consequence, and a structured fix.
9. Apply the fix (or press **Undo**) and re-evaluate. The violation shows once more, marked resolved.
10. Open **Optimize** and preview *right-size the battery*.
11. Read the before/after comparison: modeled quantities, requirement status, changed assumptions, and the risk you accept. Apply it or keep the current design.

## What the product is

- **Canonical structured state.** A project is instances of registry parts, their pins, nets of pin references, a power source, requirements, and assumptions. Templates, edited designs, and imported files all use this one representation (`src/model/schema.ts`).
- **Deterministic analysis of that state.** The rules (one file each under `src/eval/rules/`) read the canonical state, never prose, and produce findings that name real parts, pins, nets, and requirements, with evidence and a consequence.
- **Provenance.** Every fact a rule reads carries where it came from: a verified source, a stated assumption, the user, or unknown. Unknown stays unknown; rules refuse to compute on it and say so.
- **Explicit coverage instead of a score.** Each dimension reads checked, partial (naming the assumed values it leaned on), not evaluated, or unsupported. There is no global confidence number.
- **Direct connectivity editing.** Pins connect to pins, nets merge, parts and wires can be removed. Poor choices are allowed so the evaluator can explain them.
- **Stale and current are distinct.** An evaluation is bound to a hash of the design and a rules version. Any edit makes it stale; a rules change makes old results stale. A stale result is never shown as current.
- **Fixes are structured edits.** A finding's fix is the same kind of operation a manual edit is, applied through the same path, undoable, and re-evaluated by the same rules.
- **Optimization is an edit plus the same evaluator.** An optimization applies canonical edits to a candidate, runs the normal evaluator on it, and shows the before/after difference. No ranking, no score.
- **An engineering guide, not a tutorial.** Each project carries a structured explanation: how power and control flow, what each part does and why it is here, and the engineering decisions behind the design, each tied to real parts, wires, requirements, assumptions, and optimizations. Numbers in the guide are live facts or assumptions with their provenance tag. It explains the design; the rules check it.
- **AI review is a separate trust domain.** When a provider is configured, an AI reviewer can add labeled observations. They are kept apart from deterministic findings and can never change the design. When no provider is configured, the surface is simply absent.

Three example projects ship with the app: the Bluetooth Race Car (the fully worked reference path with guided changes and optimizations), a video doorbell, and a water-leak detector. Sessions persist per browser with a versioned format, and projects can be exported and imported as JSON.

## Prerequisites

Developed, tested, and deployed with Node.js 26.8 and npm 12. No other version has been tested. A Chrome binary is needed only for the browser smoke test and the walkthrough capture (`CHROME` overrides the default path `/opt/google/chrome/chrome`).

## Local setup

```bash
npm ci
cp .env.example .env
```

Edit `.env` (git-ignored) only if you want AI review: set the provider, model, and key there. Everything else runs with no configuration.

Production-style run, which is what the deployment does:

```bash
npm run build     # Vite builds the SPA into dist/
npm run start     # Hono serves dist/ and /api on http://127.0.0.1:8797
```

Development workflow:

```bash
npm run start     # in one terminal: the API and gate on 8797
npm run dev       # in another: Vite on http://localhost:5173 with hot reload
```

Vite proxies `/api` to 8797. There is no access gate in development or production.

## Validation

```bash
npm test            # typecheck, then every unit, property, sweep, render, storage, and server test
npm run validate    # the canonical local release gate
```

`npm run validate` runs the typecheck and the full test suite, regenerates the pin-sweep report and fails if `docs/pin-sweep.md` changed (so the committed report always matches the rules), and runs the production build. There is no hosted CI; this gate is what the pre-push hook and the deploy script run.

```bash
npm run hooks       # optional: install the pre-push hook that runs npm run validate
```

The test strategy, layer by layer, is described in `AGENTS.md`. In short: a corpus of template mutations with expected findings, a finding contract every finding must satisfy, exhaustive pin-pair sweeps through evaluation and layout, property-based edit sequences, adversarial render cases, storage migrations, the freshness state machine, AI and import trust boundaries, and server authentication.

## Useful commands

```bash
npm run sweep           # regenerate docs/pin-sweep.md: which wrong wiring the rules reveal, and the documented gaps
npm run walkthrough     # capture the reviewer loop as screenshots into out/walkthrough/ (needs a running build)
npm run bench -- --dry  # run the model-selection benchmark with a scripted provider (proves the plumbing without keys)
npm run smoke           # the live browser smoke test against the deployed URL
```

With `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` set, `npm run bench` scores candidate models on the frozen corpus and writes the `AI_PROVIDER` / `AI_MODEL` lines for the server environment. See `bench/README.md`.

## Deployment

One Node process behind nginx with TLS, run by systemd, reading `/etc/circuit/env`. Each deploy installs a versioned release directory under `/srv/circuit/releases/` and switches a `current` symlink, so rollback is a symlink change.

```text
clean git tree
    ↓
npm run validate
    ↓
deploy/deploy.sh
    ↓
versioned release  /srv/circuit/releases/<stamp>-<commit>
    ↓
current symlink
    ↓
service restart  (systemd unit: circuit)
    ↓
live browser smoke  (deploy/smoke.mjs)
    ↓
automatic rollback if smoke fails
```

`deploy/deploy.sh` refuses an uncommitted tree, runs the validation gate, installs the release, updates the systemd unit and the nginx site when they differ, restarts the service, checks `/healthz`, runs the live browser smoke test through the normal pin-editing path, and rolls back to the previous release if anything fails. `/healthz` reports the deployed commit. First-deploy steps (DNS, certificate, environment file) are in `deploy/README.md`.

## Repository map

| Path | Contents |
| --- | --- |
| `src/model/` | Zod schemas (Project, Registry, Finding, Coverage, MutationOp), vocabularies, history, integrity check, workflow state machine |
| `src/data/` | `registry.json` and the three template projects with their guided changes and optimizations |
| `src/eval/` | Evaluation context with net-voltage propagation, `evaluate.ts`, `rules/` (one file per rule), structured mutations, the KiCad ERC matrix, the pin-pair sweep, and the ELK diagram layout |
| `src/ui/` | React app: store and reducer, versioned storage, library, project view, SVG diagram, findings, coverage, sheets, the Learn guide, changes, compare |
| `src/ai/` | Provider interface, Anthropic and Gemini adapters, a scripted provider, the review prompt, and the output gate |
| `server/` | Hono server: static serving and `/api/review` with per-client and daily limits |
| `bench/` | Model-selection benchmark over the frozen corpus |
| `deploy/` | nginx site, systemd unit, environment template, `deploy.sh`, `smoke.mjs` |
| `scripts/` | `validate.sh` (the release gate) and the walkthrough capture |
| `docs/` | `pin-sweep.md`, generated by the sweep |

`AGENTS.md` is the engineering guide: invariants, testing layers, and the workflow for changing this codebase. `CHANGELOG.md` records each round and whether saved sessions stayed compatible.

## Additional context

The original plan and system design were written in a shared design document outside this repository. They are historical context, not required reading; the code on `main`, this README, and `AGENTS.md` are authoritative.
