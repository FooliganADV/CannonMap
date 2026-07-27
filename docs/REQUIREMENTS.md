# Requirements

## Competitor stationary events

- Analyze each competitor's ordered breadcrumb history within a rally event.
- Open one stationary event after all positions in a continuous cluster remain
  within an approximate 150-meter radius for three minutes.
- Measure duration from the first breadcrumb in the cluster and update it as new
  in-radius breadcrumbs arrive.
- Close an event only after meaningful movement beyond the hysteresis boundary;
  isolated GPS outliers must not split a stop.
- Keep completed events in the local project for later inspection and scope
  every event by rally event ID and competitor ID.
- Describe the marker as a **stationary event**, never as fuel or another cause.
- Use the Competitor Signature in a minimum 44px tap target.
- The popup must show competitor number, rider, duration, timestamps, radius,
  and user distance when GPS is available. It must offer zoom, follow rider,
  hide rider trail, and close actions.
- Zooming must center the recorded event at building/road inspection scale
  without changing the selected base layer.

Out of scope: fuel lookup, cause classification, clustering, and route advice.
# Milestone M6 — Auth and Secure Ingestion

- Secure upload is independently feature-gated by `architecture.auth.secure-ingestion`; local observation capture remains authoritative and operational when upload is disabled or unavailable.
- An enabled upload session authenticates with Firebase Authentication and presents Firebase ID and App Check tokens to the ingestion endpoint.
- Clients cannot write observation ingress, validated observations, quotas, receipts, or derived intelligence directly. The ingestion function is the only observation write boundary.
- The boundary accepts only schema version 1 observations with known keys, valid identifiers and timestamps, bounded position values, a matching idempotency key, and a request no larger than 32 KiB.
- Accepted observations are immutable. Each authenticated user receives an owner-scoped deterministic receipt; replay returns that receipt without creating another observation.
- Abuse controls include App Check verification, per-user/event minute quotas, strict origin handling, request-size limits, and replay reservations.
