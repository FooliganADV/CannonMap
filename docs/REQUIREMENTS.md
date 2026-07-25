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
