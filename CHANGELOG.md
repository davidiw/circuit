# Changelog

## 2026-09-16 · pins never move or vanish
- Storage: **no shape change; saved sessions stay compatible.**
- Diagram: a part's geometry is now a pure function of its component. Every registry pin is drawn, connected or not (unconnected pins muted), on a side decided by the pin's role (inputs west, outputs and a controller board's GPIO and buses east, ground south) instead of by which pin happens to be a net's source. Disconnecting a pin no longer removes it from the diagram or flips the other pin of its net to the opposite side. Flags on east and west pins draw as short stubs. Part-sheet rows for unconnected pins select the pin so it can be wired from there.
- Tests: the layout contract asserts every node equals `partGeometry`; a disconnect sweep (every pin of every template, regular and compact) checks geometry against the template layout; a render test checks the freed pin stays drawn, in place, muted, and selectable from the diagram and the part sheet, and can be reconnected; the live smoke disconnects and reconnects a pin.

## 2026-09-16 · hardening and documentation round
- Storage: **no shape change; saved sessions stay compatible.**
- Arbitrary connect through layout: every merge-mode pin pair in every template now runs `connectPins → applyOps → evaluate → layout` with a layout contract (finite geometry, nodes are instances, edge endpoints are real pins on their net). A named adversarial topology corpus (`src/eval/__tests__/adversarial.ts`) plus the largest single merges run through regular and compact layout, and the named topologies render through `ProjectView` with valid SVG attributes and the page mounted, stale and re-evaluated, desktop and phone.
- Graceful layout failure is an explicit contract: when layout rejects, the page stays mounted with the fallback, findings still show, and Undo, Reset, Re-evaluate, and Back still work.
- Production smoke (`deploy/smoke.mjs`) now walks the golden interaction: login, fresh Race Car, evaluate, pick a pin, Connect mode, wire STBY into ground through the merge confirmation, stale, re-evaluate, the standby violation with its detail, apply the structured fix, cleared, optimization preview, phone viewport. Fails on page errors, unhandled rejections, console errors, missing UI, wrong stale/current transitions, or horizontal overflow.
- AI review surface: shown only when `/api/ai/status` reports a configured provider. No disabled panel or dead button otherwise. Provider interfaces, adapters, benchmark, routes, and tests are unchanged.
- Documentation: README rewritten as the front door (live demo, quick tour, product thesis, setup, validation, deployment); `AGENTS.md` added as the evergreen engineering guide; `CLAUDE.md` points to it.

## 2026-09-16 · test-suite adversarial review (commit after c0a0d93)
- Storage: **no shape change; upgradeable.** Every revived session, template or imported, now re-evaluates with the current rules instead of restoring a stored result, so a saved evaluation is never shown as current. Evaluation results carry a `rulesVersion`; a result from an older rule set reads as stale even when the design is unchanged.
- Trust boundaries: an imported file's own evaluation is discarded; applying an optimization re-runs the evaluator on the real candidate inside the reducer and ignores a caller-supplied result that does not match; AI observations are stamped `ai_review` on the client regardless of what the server sent.
- Provenance: project assumptions are noted when read (a template default is an assumption, a user-set value is trusted); evidence and metric provenance follow the value's source instead of being hard-coded.
- Tests: freshness state machine (hash per action, UI-only actions are hash-neutral, undo and reset restore the template hash, optimization apply path, rules-version staleness), import and AI trust boundaries, coverage policy table plus a stub-rule downgrade, hand-derived numeric invariants, supply-range boundaries from the registry limits, connect-pins survivor rules, pin-exact attribution, merge-mode sweep verdicts, and semantic render assertions (stale label, resolved row, compare rows). New fixture changes: bare TB6612 with STBY floating (unknown), buck set to 10 V (violation), reversed diode (violation), and the 14 V case now asserts the headroom violation. 124 tests.

Entries note whether a change to saved sessions (localStorage) is **upgradeable** (a migration carries data forward) or **breaking** (saved work is dropped with a notice). See `src/ui/storage.ts` for `STORAGE_VERSION` and the migration table.

## 2026-09-16 · adversarial-review and hardening rounds (commits 7e3b2af to HEAD)
- Storage: **v1 to v2, upgradeable.** Findings saved by earlier builds gain empty fix lists; evaluations are re-parsed; edits and history are schema-validated; anything that fails is dropped with a notice on the library page. Later rounds changed no saved shape.
- Coverage policy: a dimension reads `checked` only when every value the rule read is a published fact or a user setting; an assumption or unknown makes it `partial` and the note says which values.
- Rules: KiCad ERC pin-type matrix (`pin_type_conflict`), `undriven_net`, `net_conflict` (ground-side shorts), unconnected supply inputs, diode orientation, shorted motor and shared driver channel, per-rail load tracing in the rail budget, a buck set above its input is a violation.
- Process: `scripts/validate.sh` (typecheck, tests, sweep freshness, build) as the local gate, `npm run hooks` installs it as a pre-push hook, `deploy/deploy.sh` installs into `/srv/circuit/releases/<stamp>-<commit>` with a `current` symlink, restarts, smoke-tests the live URL (`deploy/smoke.mjs`), and rolls back on failure.

## 2026-09-16 · interaction round (commit d73b931)
- Storage: session shape gained `base`, `edits`, `selectedPin`, `connectFrom`, `compareId`; loaded unversioned (v1) with a rebuild from `appliedMutations`. Classified after the fact as upgradeable, formalized in v2.

## 2026-09-16 · first build (commits 924a1a6 to 9e27644)
- Storage: v1, unversioned key `circuit-factory.sessions.v1`.
