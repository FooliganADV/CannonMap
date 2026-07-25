# Decisions

## Stationary does not imply cause

Stationary events intentionally carry no cause classification. A stop can be
fuel, traffic, repairs, food, a checkpoint, an obstruction, or something else.

## Radius and hysteresis

The qualifying cluster uses a 150-meter radius. Exit uses a wider 190-meter
boundary plus two consecutive outside breadcrumbs. This prevents ordinary GPS
jitter from repeatedly opening and closing the same continuous stop.

## Stable identity and persistence

The event key is `rallyEventId:competitorId:startTime`. Reprocessing history
updates that record instead of creating another one. Completed records remain in
the local project even if the source breadcrumb window is later truncated.

## Nearby markers

Stationary events are not semantically clustered. Small deterministic display
offsets keep overlapping 48px signature markers independently tappable while
all calculations and zoom actions retain the true event center.
