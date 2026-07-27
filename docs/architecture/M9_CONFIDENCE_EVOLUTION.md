# M9 Confidence Evolution

## Scope and invariant

M9 stores confidence as seven independent dimensions: `quality`,
`evidenceStrength`, `inference`, `historical`, `current`, `recency`, and
`stability`. They are never averaged, summed, weighted, multiplied, ranked, or
otherwise collapsed into one score. Each dimension owns its value, method,
policy identity and version, evidence references, provenance, prior value,
change reason, and any decay or reinforcement basis.

Confidence is derived metadata. It is not an observation and never rewrites an
observed fact.

## Policy choices

The roadmap fixes independence and provenance but does not prescribe formulas.
M9 therefore adopts these conservative deterministic policy choices:

| Dimension | Policy v1 | Evolution |
| --- | --- | --- |
| `quality` | `quality-source-assessment` | Source-quality evidence reinforces; explicit contradiction reduces it; no time decay. |
| `evidenceStrength` | `evidence-independent-corroboration` | Independent corroboration reinforces; contradiction reduces it; no time decay. |
| `inference` | `inference-support` | Supporting inference evidence reinforces; contradiction reduces it; no time decay. |
| `historical` | `historical-corroboration` | Long-lived history changes only with qualifying corroborating or contradictory evidence. |
| `current` | `current-evidence-decay` | Current evidence reinforces and decays with a six-hour half-life. |
| `recency` | `recency-evidence-age` | Derived only from the newest relevant evidence timestamp with a two-hour half-life. |
| `stability` | `stability-consistency` | Repeated consistency reinforces slowly; explicit contradiction reduces it more strongly. |

All constants live in versioned policy modules. Values are bounded to `[0,1]`;
unknown values are `null`. Timestamps are non-negative integer milliseconds.
Backward time and future evidence are rejected.

## Evidence and provenance

Evidence uses immutable IDs and names the dimensions it affects. A dimension
revision records the applied algorithm and policy versions, evaluation time,
prior revision reference, evidence IDs, explicit reinforce/set/contradict
effects, and the reason for change. Replayed evidence IDs are ignored, while
contradictions remain visible in provenance.

## Revision and persistence model

Every calculation produces an immutable `ConfidenceVector` revision keyed by
`[eventId, subjectType, subjectId, revision]`. Revision IDs are deterministic
over subject identity, prior revision, time, inputs, policies, and dimension
state. Identical replays return the prior revision. The IndexedDB repository
uses `add`, never `put`; an identical key and revision ID is an idempotent
replay, while a different record at that key is an immutable collision.
Retrieval uses the existing `updatedAt` index. IndexedDB transaction aborts
leave no partial record and a later replay safely recovers.

## Legacy migration and rollback

Legacy scalar confidence is read only into a non-authoritative migration input.
Its original value, source, and read time are retained in vector provenance,
but it initializes none of the seven dimensions because the roadmap defines no
scalar-to-vector mapping. Later evidence-backed revisions remain authoritative
within the M9 shadow store, and subsequent legacy inputs cannot override them.
Legacy fields and stores are not deleted.

Rollback disables M9 calculation and reads legacy confidence only where the
pre-M9 application already did so. Immutable M9 revisions may remain for audit.

## Shadow boundary

M9 exposes pure domain functions and an append-only IndexedDB repository only.
There is no production orchestration. The reserved feature flag
`architecture.confidence.evolution` is disabled by the existing default flag
reader. `app.js`, UI, Route Family, Commitment, checkpoint, compatibility,
publication, Co-Driver, notification, and evaluation modules do not consume
confidence vectors. M10 has not started.
