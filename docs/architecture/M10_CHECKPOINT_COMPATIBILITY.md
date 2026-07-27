# M10 Checkpoint and Compatibility

## Scope and operating mode

M10 adds deterministic checkpoint and sequence aggregates, explainable rider compatibility, advisory suggestions, and a user-controlled Intelligence Network. All projections remain shadow infrastructure. The disabled-by-default flags are:

- `architecture.intelligence.checkpoints`
- `architecture.intelligence.sequences`
- `architecture.intelligence.compatibility-suggestions`

No Rally Mode decision, production UI, notification, publication pipeline, or Co-Driver behavior consumes M10 output. Rollback consists of disabling the three flags; source evidence and immutable revisions remain intact.

## Checkpoint aggregates

`CheckpointAggregate` schema version 1 and algorithm `m10-checkpoint-aggregate-v1` identify one event/checkpoint and retain immutable evidence and source-revision references. Successful and failed evidence are counted and referenced separately. Dwell and transition statistics are derived facts; route-family and dimensional-confidence references remain references rather than copied or collapsed values.

Rebuilds deduplicate evidence by immutable ID, reject conflicting replays, sort inputs canonically, and create a revision only when the canonical input fingerprint changes. The same evidence, policies, and evaluation time therefore produce the same record. Low-quality evidence is retained in provenance and contributes through an explicit bounded quality weight; it is never discarded.

Observed evidence, aggregate fields, and explanation text are separate. Revision records include `priorRevisionRef`, `sourceRevisionRefs`, `evidenceRefs`, algorithm/schema versions, and deterministic revision IDs.

## Sequence aggregates

`SequenceAggregate` schema version 1 and algorithm `m10-sequence-aggregate-v1` represent an evidence-supported ordered checkpoint list. An empty evidence set produces an explicit unsupported profile, not an invented relationship. Success/failure and elapsed-time statistics remain evidence-backed.

Route Family references and Route Variant references are separate arrays. Variant statistics are never folded into Family aggregate statistics. Source checkpoint revision references and dimensional-confidence references remain explicit.

## Compatibility

Algorithm `m10-compatibility-v1` compares only available, evidence-backed features:

- speed distribution
- failure pattern
- checkpoint dwell
- route preference
- sequence behavior

Each feature comparison names its supporting evidence, similarity, policy version, weight, and whether it increased or decreased the result. Missing inputs become limitations. At least two comparable features are required; otherwise the contract returns `InsufficientEvidence` with `score: null`.

The compatibility score is bounded to `[0,1]`. It is not confidence. CannonMap’s seven M9 confidence dimensions are neither combined nor converted into compatibility. Confidence may be referenced as provenance only.

The conservative v1 policy uses normalized numeric distance for numeric features and Jaccard overlap for route preferences. Weights are versioned in the engine and sum to one across the full feature set. Available-feature weights are renormalized for sparse but sufficient comparisons.

## Intelligence Network ownership

Network membership is fully user-controlled. The only mutation entry point accepts an immutable command with:

- an authenticated owner and event scope
- verified event membership
- `authorization: "explicit-user-command"`
- one of `AddMember`, `RemoveMember`, `UpdateWeight`, or `UpdateNotes`
- a unique command ID and attributable actor

Commands are replay-safe and append an audit entry. Background processing, compatibility calculation, suggestion generation, and reconciliation return no network mutation. Suggestion acceptance still requires a separate, matching `AddMember` command. There is explicitly no automatic membership, removal, weight, or notes mutation.

## Suggestions

Suggestions use algorithm `m10-suggestion-v1` and are immutable revision records separate from network membership. Their lifecycle is:

`Proposed → Viewed | Accepted | Rejected | Expired`

`Viewed → Accepted | Rejected | Expired`

Terminal states do not transition. Expiry cannot occur before `expiresAt`. Insufficient compatibility evidence produces no suggestion.

## Persistence and recovery

M10 reuses the M2 versioned stores rather than changing the database schema:

- `intelligenceItems` holds immutable checkpoint, sequence, and compatibility revisions.
- `syncMeta` holds atomic projection heads and reconciliation metadata.
- `recommendations` holds immutable suggestion revisions.
- `intelligenceNetwork` remains the private network materialization store.

Projection revision and head writes share one IndexedDB transaction. Aborted transactions leave neither a partial revision nor a changed head, and retry is safe. Reconciliation reports revision counts, head state, and any orphaned revisions. Prior revisions are never overwritten or deleted.

## Security

Realtime Database remains default-deny. Checkpoint, sequence, compatibility, and suggestion projections are server-only. Clients cannot write public intelligence or reconciled networks. A client may append only its own validated network command when authentication, event-membership claims, allowed keys, schema version, timestamp window, numeric bounds, ownership, and immutability checks pass.

Public intelligence excludes contact information, authentication tokens, device identifiers, and private network notes. Analytical identities remain pseudonymous. Existing M6 ingestion and server-only evidence rules are unchanged.

## Architecture boundaries

M10 domain modules depend only on domain outputs, shared contracts, injected evaluation time, explicit policies, and repository interfaces. They do not import DOM, Leaflet, `app.js`, Firebase snapshots, publication, notifications, or UI code. `app.js` is unchanged.

## Prohibitions and rollback

- Never combine the seven confidence dimensions into a scalar.
- Never infer a checkpoint sequence without evidence.
- Never combine independent Route Variant statistics into Family statistics.
- Never mutate the Intelligence Network automatically.
- Never publish or surface M10 suggestions during this milestone.

To roll back M10 behavior, disable its three projection/suggestion flags. Do not delete evidence, projections, suggestions, or revision history.
