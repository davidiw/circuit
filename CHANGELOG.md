# Changelog

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
