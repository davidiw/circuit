# Working on Circuit Factory

This file is for any engineer or coding agent changing this repository. It describes what the product is, the invariants a change must preserve, how the tests are layered, and the workflow that keeps `main`, the documentation, and production on the same revision.

## Source of truth

Authoritative, in this order of precedence when they disagree:

1. The current code on `main`.
2. This file.
3. The other documentation in this repository (`README.md`, `CHANGELOG.md`, `bench/README.md`, `deploy/README.md`, `docs/pin-sweep.md`).

External design documents, historical handoff material, and old walkthrough screenshots may explain why something was built. They can be stale. Do not change current behavior to reconcile it with an older plan; change the plan, or record the difference in `CHANGELOG.md`.

## Product model

Circuit Factory presents an electronics design as explicit state and lets a person inspect, change, evaluate, and optimize it.

- Three structured example projects ship in `src/data/templates/`. The Bluetooth Race Car is the deepest reference path: it has guided changes (mutations with expected findings), structured fixes, and curated optimizations. The video doorbell and water-leak detector are shallower.
- A project is canonical state: instances of registry components, the pins those components define, nets of pin references, a power source, explicit requirements, and explicit assumptions. Every fact on a registry component carries provenance.
- Evaluation is deterministic. Rules (`src/eval/rules/`) read the canonical state through the evaluation context and emit findings, coverage rows, and metrics. Nothing reads prose.
- Coverage is explicit per dimension: checked, partial (naming the assumed values), not evaluated, or unsupported. There is no global score.
- The user selects parts, nets, and pins directly, connects pin to pin (nets merge), disconnects, and removes parts. Every edit is a structured operation replayed on the template or imported base, so Undo and Reset are exact.
- An evaluation is bound to a state hash and a rules version. Any edit makes it stale; a rules change makes old results stale. The UI shows stale and current distinctly.
- A finding may carry fixes: structured operations applied through the same path as a manual edit.
- Optimizations are curated canonical edits. Preview applies them to a candidate, runs the normal evaluator, and shows the before/after difference; Apply records the edit like any other.
- Sessions persist per browser in a versioned localStorage format with migrations; projects export and import as JSON, and imported files are validated and re-evaluated before they are trusted.
- Each template carries a `designGuide` (system flow, power/control/result, why each part is here, engineering decisions) and each registry component a `guide` (role, summary). The Learn sheet renders them beside the diagram and highlights the related artifacts. It is explanatory content, read-only with respect to engineering state.
- The server (`server/`) is a signed-cookie access gate plus static serving plus one AI review endpoint.
- AI review is optional and architecturally separate: a provider interface (`src/ai/`), an output gate, a benchmark to select a model, and a labeled observation list in the UI that appears only when a provider is configured.

## Architectural invariants

Preserve these in every change. A change that needs to break one is a product decision, not an implementation detail; say so explicitly.

- Canonical Project state is the source of truth. The diagram, the findings, the sheets, and the comparison are all derived from it.
- Templates, edited projects, and imported projects use the same representation and the same code paths.
- Unknown stays unknown. A missing fact is a value the rules refuse to compute on, never a default silently filled in.
- Assumptions are explicit and provenance-bearing. A rule that reads an assumption reports that it did, and the coverage row for that dimension reads partial.
- Edits are structured operations (`MutationOp`). No code path mutates a project by hand.
- Deterministic evaluation reads canonical state, never generated prose, and never the AI's output.
- Findings reference real artifacts: instance ids, pins, nets, and requirements that exist in the project being evaluated.
- A stale evaluation cannot masquerade as current. Freshness is decided by the state hash and the rules version, not by a flag someone sets.
- Changing rule semantics bumps `RULES_VERSION` in `src/eval/evaluate.ts`, which invalidates stored results.
- Optimization performs real canonical edits and uses the normal evaluator on the real candidate. A caller-supplied evaluation is accepted only when it matches what the evaluator produces.
- AI observations stay separate from deterministic findings: different origin, different list, different label.
- AI cannot mutate trusted Project state. The review endpoint returns observations; nothing it returns is applied.
- Import and storage boundaries validate (schema, integrity against the registry) before state is trusted, and an imported or stored evaluation is discarded and recomputed.
- Unsupported and unmodeled dimensions remain visible as such. Coverage is never upgraded to make a result look cleaner.
- Any structurally valid user edit must not crash evaluation or rendering. It may produce a violation, a warning, an unknown, a documented coverage gap, or an ugly diagram.
- The design guide explains; it never checks. The evaluator does not read `designGuide` or registry `guide`, neither is in the state hash, and opening or browsing the guide cannot change project state or freshness. Numbers in guide prose come through `{{instance.fact}}` / `{{assumption.key}}` tokens so they render with provenance; a guide must not state an electrical value the registry or an assumption does not carry, and every related id must resolve (the learn tests enforce this).
- A part's diagram geometry is a pure function of its component (`partGeometry` in `src/eval/layout.ts`): every registry pin is always drawn, on a side decided by its role, at a position that does not depend on the nets. Wiring edits can neither hide nor move a pin, so a disconnected pin stays selectable. The layout contract asserts every node equals that function's output, across the pin-pair and disconnect sweeps.

## Failure-handling philosophy

When a user-generated state reveals a crash or a correctness bug, identify the broader class of states that produced it and extend systematic regression protection for that class rather than patching only the observed example.

Systematic protection in this repository takes these forms:

- a corpus case: a mutation on a template with expected findings (`src/data/templates/*.json`);
- an exhaustive sweep: every pin pair through evaluation (`src/eval/__tests__/sweep.test.ts`) and through layout (`layout-sweep.test.ts`);
- a property: random edit sequences that must keep the project valid and evaluable (`sequences.test.ts`);
- a trust-boundary validation: schema plus integrity at import, storage, server, and evaluate;
- an adversarial layout or render case: a named topology in `src/eval/__tests__/adversarial.ts`, which feeds both the compact-layout run and the React render corpus.

The graceful layout fallback (`src/ui/__tests__/layout-failure.test.tsx`) is the safety net for state space the sweeps have not seen. Keep it working.

## Electrical knowledge discipline

- Every electrical or component claim rests on a registry fact with provenance, a stated assumption, or an explicit unknown. No rule may invent a number.
- Exact module behavior must not silently become generic component behavior. A vetted breakout with a board pull-up is not the same as the bare IC; the registry models them as different components and the rules read the difference.
- Provenance survives transformations. A derived value (a propagated net voltage, a computed runtime) carries the weakest provenance of its inputs.
- Coverage is never upgraded to produce a cleaner-looking result. If a rule leaned on an assumption, the dimension is partial and the note names the value.
- Known model gaps are documented, not guessed through. Pairs the rules do not reveal are listed with a reason in `KNOWN_GAPS` (`src/eval/sweep.ts`) and rendered into `docs/pin-sweep.md`. A new rule that covers a gap must remove it from that list.
- Heuristics are labeled as heuristics in the finding text (bulk capacitance is the standing example).

## Testing strategy

Each layer catches a different kind of bug. Put a new test where its failure would be most legible.

| Layer | Where | What it protects | Put a test here when |
| --- | --- | --- | --- |
| Template and corpus | `src/eval/__tests__/corpus.test.ts`, template JSON | Registry and template integrity; every mutation and optimization produces exactly its expected structured findings; every offered fix clears its finding | A rule's verdict on a known design changes, or a new guided change is added |
| Finding contract | `contract.ts` | Every finding names real artifacts, carries evidence with provenance, a consequence, and a remediation or a missing list; no internal vocabulary leaks | A finding is malformed or unreadable |
| Pin-pair sweeps | `sweep.test.ts`, `src/eval/sweep.ts` | Every pin joined to every other pin, fresh and merge modes: no crash, valid project, contract-clean findings; every pair kind the KiCad ERC matrix or a domain rule calls wrong fires on the touched pins; nothing allowed fires; every silent kind is a documented gap | A wrong wiring goes unreported, or a rule fires on the wrong pins |
| KiCad ERC mapping | `src/eval/erc.ts` | Pin roles map onto KiCad's electrical types; the default matrix is the base expectation | A pin role or its electrical type changes |
| Known gaps | `KNOWN_GAPS`, `docs/pin-sweep.md` | The honest list of what the rules do not reveal, with reasons; the report must match the code | A gap is closed or discovered |
| Edit sequences | `sequences.test.ts` (fast-check) | Any sequence of connect, disconnect, remove, guided change, fix, optimize, undo keeps the project valid and evaluable | A crash depends on edit order |
| Boundary and numeric | `boundary.test.ts` | Hand-derived numbers, supply-range edges from registry limits, connect-pins survivor rules, pin-exact attribution | A threshold or formula changes |
| Layout | `layout.test.ts`, `layout-sweep.test.ts`, `layout-contract.ts` | Template diagrams: no overlap, every net routed, wires clear of boxes. Every merge-mode pin pair and every adversarial topology: finite geometry, nodes are instances, edge endpoints are real pins, regular and compact modes | Geometry is wrong or a topology breaks layout |
| React render | `src/ui/__tests__/render.test.tsx` | Every corpus state, sheet, compare, applied optimization, phone layout, AI state, migrated evaluation, and adversarial topology renders with no thrown error, no console error, valid SVG attributes, and the page mounted | A state white-screens or a component throws |
| Design guide | `src/ui/__tests__/learn.test.tsx` | Guide references and tokens resolve; every registry part has a guide; Learn is read-only (project, hash, edits, evaluation state unchanged); renders for every template on desktop and phone; steps, parts, and decisions highlight exactly their artifacts | Guide content or the Learn sheet changes |
| Layout failure | `layout-failure.test.tsx` | When layout rejects, the page stays up with a fallback and Undo, Reset, Re-evaluate, and Back still work | The fallback regresses |
| Storage | `storage.test.ts`, `fixtures/` | Payloads from earlier builds migrate; unreadable, newer, and invalid payloads are dropped with a notice; stored evaluations are never restored as current | The saved-session shape changes |
| Reducer and freshness | `store.test.ts` | Every semantic edit makes the evaluation stale; UI-only actions are hash-neutral; undo and reset restore the template hash; rules-version staleness; optimization apply path | State-machine semantics change |
| AI trust boundary | `src/ai/review.test.ts`, render and store tests | The output gate drops malformed observations; observations are stamped as AI on the client; AI results never touch the design | The provider interface or gate changes |
| Server and auth | `server/__tests__/auth.test.ts` | Unauthenticated requests redirect or 401; wrong credentials are rejected; the API validates schema and integrity and leaks no internal error text | A route or the gate changes |
| Production smoke | `deploy/smoke.mjs` | In a real browser against the deployed URL: login, open, evaluate, connect a bad pin through the UI, stale, re-evaluate, expected finding, fix, cleared, optimization preview, phone viewport, no page errors | Deployment confidence; keep it short |

`npm test` runs everything but the production smoke. Saved-session compatibility: any change to the stored shape gets a migration in `src/ui/storage.ts` and a fixture under `src/ui/__tests__/fixtures/`, or it is a breaking change that drops saved work with a notice. Record which in `CHANGELOG.md`.

## Repository map

- `src/model/` — Zod schemas, vocabularies, the history event model, the integrity check, and the workflow state machine (project state, finding lifecycles, requirement status, stepper).
- `src/data/` — the registry and the three template projects, loaded and schema-parsed at import.
- `src/eval/` — the evaluation context (indexing, net-voltage propagation, provenance tracking), `evaluate.ts` with `RULES_VERSION`, structured mutations and `connectPins`, the KiCad ERC matrix, the pin-pair sweep, the state hash, and the ELK layout.
- `src/eval/rules/` — one analyzer per file; each declares its id, dimensions, and what it read.
- `src/ui/` — React application: store and reducer, versioned storage, library, project view, diagram, findings, coverage, sheets, the Learn guide (`Learn.tsx`), changes and optimize, compare, gate, error boundary.
- `src/ai/` — provider interface, Anthropic and Gemini adapters, scripted provider, prompt text, review orchestration and output gate.
- `server/` — Hono application (gate, static, `/api/review`), environment loading, entry point.
- `bench/` — the frozen benchmark cases, runner, and price table for selecting an AI model.
- `docs/` — generated documentation (`pin-sweep.md`).
- `deploy/` — nginx site, systemd unit, environment template, deploy script, live smoke test, first-deploy notes.
- `scripts/` — the validation gate and the walkthrough capture.

## Standard engineering workflow

```text
understand the canonical state and the invariant you are touching
→ make a structured change (schema, rule, op, reducer, component)
→ add or update systematic regression coverage for the class of states it affects
→ npm run validate
→ commit
→ deploy if appropriate
→ live smoke
```

Commands:

```bash
npm ci                      # once per clone
npm test                    # typecheck plus the full suite, while iterating
npm run sweep               # after changing a rule, a pin role, or KNOWN_GAPS; commit docs/pin-sweep.md
npm run validate            # the release gate; also the pre-push hook (npm run hooks)
git commit                  # one cohesive commit per change
deploy/deploy.sh            # clean tree required; validates, releases, restarts, smoke-tests, rolls back on failure
npm run smoke               # rerun the live smoke at any time (GATE_USER and GATE_PASS in the environment)
curl -s https://circuit.davidwolinsky.com/healthz   # deployed commit must equal main
```

Do not leave local `main`, the documentation, and production on different revisions after a deploy. `CHANGELOG.md` gets a short entry per round stating whether saved sessions stayed compatible.

## Current product boundaries

These describe scope, not prohibitions. Circuit Factory currently does not attempt to be:

- a complete EDA or schematic-capture application;
- a PCB layout system;
- SPICE or any general circuit simulation;
- arbitrary datasheet ingestion;
- a complete electronics knowledge base;
- a general arbitrary circuit generator;
- a breadboard or physical-layout generator.

Future work may extend into any of these. Changes should preserve the canonical-state, evidence, and trust model above: state stays explicit, claims stay sourced, unknown stays unknown, and AI stays in its own domain.
