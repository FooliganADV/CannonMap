# ADR-0001: Evolutionary Refactoring

- Status: Accepted
- Date: 2026-07-26
- Decision owners: CannonMap Engineering
- Scope: Architecture roadmap implementation

## Context

CannonMap is a production Vanilla JavaScript PWA with substantial behavior
concentrated in `app.js`. The approved architecture adds explicit domain
subsystems, offline-first persistence, server-authoritative processing, and
evaluation while preserving the existing technology stack and product.

A rewrite would combine behavioral change, data migration, operational change,
and architecture change into one high-risk release. Existing mobile, Rally,
offline, import/export, GPS feed, and stationary-event behavior provides a
valuable regression baseline.

Optional integrations also need isolation so their initialization or failure
cannot break Rally Mode. That need does not make core behavior pluggable.

## Decision

CannonMap will use evolutionary, behavior-preserving extraction:

1. `app.js` remains the composition root during extraction.
2. Stable seams and characterization tests precede code movement.
3. One concern is extracted per commit behind compatibility facades.
4. New architecture paths default off behind documented feature flags.
5. Persistent changes are additive, versioned, shadowed, reconciled, and
   reversible.
6. Optional integrations use a future Plugin Manager and published capability
   interfaces; core subsystems are never plugins.
7. Full regression validation is required after every extraction.

## Consequences

Positive:

- Small diffs are reviewable and independently reversible.
- Production behavior remains continuously testable.
- Persistent migrations retain a rollback path.
- Optional integration failures can be isolated from core and Rally Mode.
- Five-year maintenance improves without a technology rewrite.

Costs:

- Compatibility facades and dual paths temporarily increase code volume.
- Progress appears slower than bulk movement.
- Shadow writes and reconciliation require temporary operational support.
- Architecture enforcement requires continuous CI and review discipline.

## Rejected alternatives

- Rewrite the application: violates the frozen architecture and concentrates
  regression risk.
- Framework or language migration: changes technology without solving the
  immediate dependency and persistence risks.
- Make every subsystem a plugin: would allow optional infrastructure to own
  safety-critical core behavior.
- Big-bang module extraction: prevents reliable attribution and rollback.

## Verification

- `scripts/check-boundaries.mjs` and architecture tests enforce initial import
  rules.
- `docs/BASELINE.md` records the behavior and validation checkpoint.
- `docs/runbooks/ROLLBACK_BASELINE.md` defines recovery.
- Future ADRs are required only for lasting decisions within the frozen
  architecture, not for routine implementation.

