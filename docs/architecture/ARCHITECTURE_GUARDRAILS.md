# CannonMap Architecture Guardrails

Status: mandatory  
Authority: Software Architecture Specification 1.0 and Implementation Roadmap
2.0  
Applies to: all work after Milestone M0

## Frozen architecture

1. Do not rewrite CannonMap.
2. Preserve Vanilla JavaScript, PWA, Leaflet, Leaflet-Geoman, Firebase
   Realtime Database, IndexedDB, and Service Worker.
3. Evolve through small, behavior-preserving extractions.
4. Do not redesign product behavior while extracting architecture.

## Composition and dependencies

- `app.js` remains the composition root until a behavior-equivalent bootstrap
  replaces it in an approved milestone.
- `app.js` may import modules.
- Modules may never import `app.js`.
- Lower layers never import higher layers.
- Core depends only on core/shared contracts.
- Domain depends only on domain, core, and shared contracts.
- Application coordinates core/domain interfaces; it does not import UI,
  plugins, or concrete infrastructure.
- Infrastructure implements ports and may use core/domain contracts; it does
  not import application, UI, plugins, or `app.js`.
- UI invokes application use cases and selectors; it does not import concrete
  infrastructure or plugin implementations.
- Bootstrap/composition may connect all approved interfaces.
- Circular dependencies are prohibited.

The dependency checker is an early guardrail, not a substitute for review.

## State and behavior

- Use explicit state machines for Observation, Checkpoint, Route DNA,
  Co-Driver Event, Intelligence publication, and recommendation evaluation.
- Persist state transitions as auditable records; do not represent lifecycle
  with unrelated implicit flags.
- Keep observed data separate from inferred data in memory, storage, schemas,
  and UI wording.
- Every inference is evidence-backed and includes evidence references,
  algorithm/version information, and an explanation.
- Commitment is inferred, never observed.
- Route Families own Route DNA; Route Variants retain independent statistics.
- Confidence dimensions remain independent. Do not collapse Observation
  Quality, Evidence Strength, Inference Confidence, Historical Confidence,
  Current Confidence, Recency, and Stability into one score.
- No model update may occur during an active rally.

## Persistence and compatibility

- Every new persistent contract is versioned.
- Migrations are additive, resumable, testable, and reversible.
- Large migrations do not run inside `onupgradeneeded`.
- Shadow writes, dual reads, and reconciliation precede authority changes.
- Legacy storage is removed only after the approved rollback window.
- Accepted offline observations must not be lost.

## Delivery discipline

- One concern per commit.
- Extraction commits do not also change behavior, UI, schemas, or dependencies.
- Add characterization tests before moving production behavior.
- Preserve compatibility facades until consumers migrate.
- Every milestone documents rollback and acceptance criteria.
- The authoritative Node, Playwright serial, startup, offline, vendor, syntax,
  and diff checks must remain green.

## Feature flags

All new architecture capabilities default **OFF**.

Naming convention:

```text
architecture.<subsystem>.<capability>
plugin.<pluginId>.enabled
```

Requirements:

- The absence of a flag is equivalent to `false`.
- Flags are read through one injected feature-flag interface.
- Domain models do not read global configuration directly.
- Flags select orchestration paths; they do not alter historical records.
- A disabled or malformed flag must preserve current production behavior.
- Active-rally model/version flags are frozen at rally start.
- Each flag has an owner, purpose, rollout stage, removal condition, and
  emergency disable procedure.

## Pull-request review checklist

- [ ] One concern and reviewable commit scope.
- [ ] No production behavior change hidden in an extraction.
- [ ] No module imports `app.js`.
- [ ] No lower-to-higher or cross-plugin implementation dependency.
- [ ] State transitions are explicit and tested.
- [ ] Observed and inferred data remain separate.
- [ ] Inference carries evidence and explanation.
- [ ] Persistence is versioned and rollback tested.
- [ ] New architecture path defaults off.
- [ ] No active-rally model mutation.
- [ ] Full relevant regression suite passes.

