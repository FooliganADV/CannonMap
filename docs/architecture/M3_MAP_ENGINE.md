# Milestone M3: Map engine extraction

## Scope

M3 moves creation and ownership of the single Leaflet map, base layers, overlay
groups, and layer control into `src/ui/map/map-engine.js`. A keyed
`LayerRegistry` owns feature, competitor, stationary-event, traffic, and weather
layers.

`app.js` remains the composition root. It supplies presentation-ready models and
callbacks to the map layer; the map modules do not read IndexedDB, subscribe to
Firebase, or import application/domain state.

Rendering is incremental. Reconciliation retains a layer when its entity key and
presentation fingerprint are unchanged, replaces only changed layers, adds new
keys, and removes stale keys. Compatibility references such as
`state.featureGroup` remain available for existing Geoman and UI behavior.

## Behavior preservation

- The existing default view and all five base-layer definitions are retained.
- Satellite selection, overlay labels, styles, popups, stationary-event actions,
  Geoman drawing/editing, fitting, and mobile behavior are unchanged.
- The M2 IndexedDB path and its disabled-by-default flag are untouched.
- Map modules consume in-memory presentation inputs only.

## Rollback

Repoint `initMap` and render functions to the legacy group creation and
clear/rebuild implementation, remove the two `src/ui/map` imports from the
service-worker shell, and deploy with a new cache name. No persistent schema or
record changes are involved.

## Acceptance evidence

Unit tests cover single-map ownership and incremental add/reuse/replace/remove
behavior through 500 keyed entities. Browser tests confirm one Leaflet container,
registry/group count parity, stable repeated rendering, and the existing full
mobile/desktop visual and behavior matrix.
