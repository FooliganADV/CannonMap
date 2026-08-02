# Garmin-Optimized GPX Export — Phase 1

## Scope and isolation

Garmin export is a Planner-only capability. It is implemented by the pure
`src/domain/gpx/garmin-export.js` serializer and does not import or modify
Mission Control, Rally Mode, checkpoint completion, GPS, competitors, or live
intelligence. The existing generic `buildGpx` serializer remains intact.

## Pre-change audit

The generic exporter already produced GPX 1.1. It emitted every point feature
as `wpt`, route lines as ordered `rtept` collections, and every other line
feature as ordered `trkpt` collections. It used the standard Topografix
namespace plus CannonMap's extension namespace. Point notes were written to
`desc`; point type was written to `type`; checkpoints retained CannonMap
status, points, extreme, sequence, and execution timestamps. Export selection
was the Planner's active-day filter. It did not provide Garmin namespaces,
symbols, categories, naming presets, or per-type controls.

## Garmin document contract

The new serializer emits GPX 1.1 with Topografix, Garmin GpxExtensions v3,
Garmin WaypointExtension v1, and XML Schema Instance namespaces. Standard GPX
fields remain primary:

- `name`: selected waypoint-name preset
- `cmt`: rider notes
- `desc`: concise type/name/day/explicit-points summary
- `sym`: centralized Garmin symbol mapping
- `type`: CannonMap feature classification

`gpxx:WaypointExtension` contains only day and feature-type categories in this
phase. Empty and duplicate categories are excluded.

Routes remain `rte` documents with every coordinate emitted in source order.
Tracks and backbones remain `trk` documents. Multiple track segments are
supported when the domain feature supplies `geometry.segments`; otherwise the
ordered coordinate array becomes one segment.

## Mandatory data-safety invariant

Only a finite value stored in the CannonMap feature's `points` property may
appear as rally points. Geometry length, route-point count, track-point count,
sequence, or collection length is never consulted. Missing points are omitted.

## Planner controls

The focused dialog supports all days, the current Planner day, or selected
days; point/route/track/backbone type inclusion; and four naming presets:
`{name}`, `{day}-{name}`, `{name}-{points}`, and
`{day}-{name}-{points}`. It previews a matching waypoint and reports the
selected feature count before download.

## Phase 1 limitations

- BaseCamp and zūmo XT3 behavior still requires rider/device validation.
- ASCII-only naming and custom templates are deferred.
- Status categories and status filtering are deferred.
- Separate per-day packages are deferred; Phase 1 writes one selected GPX.
- Importer enhancements, Garmin synchronization, and device transfer are out
  of scope.
- CannonMap's current model normally represents imported multi-segment tracks
  as separate track features; the serializer nevertheless supports native
  segment arrays for forward compatibility.

Garmin publishes its extension schemas from `www8.garmin.com`; namespace URIs
remain under `www.garmin.com` as required by Garmin GPX documents.
