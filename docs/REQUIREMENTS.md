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

## Rally Mode Rider Manager

- List every competitor in the normalized GPS Checkpoints model, including
  riders whose current location is temporarily unavailable.
- Show competitor number, rider name, team or vehicle, score or rank, and
  freshness when those values are available.
- Keep independent marker, breadcrumb, and selection preferences for each
  event ID and competitor ID.
- Default markers to visible and breadcrumbs to hidden.
- Apply rider and bulk trail changes immediately, persist them locally, and
  restore them across refreshes without modifying normalized feed records.
- Preserve preferences for temporarily removed riders and apply defaults only
  to newly observed riders.
- Provide glove-friendly controls on phone portrait layouts without permanently
  covering the Rally Mode action dock.

Competitor Signatures and local breadcrumb recording remain separate later work.
