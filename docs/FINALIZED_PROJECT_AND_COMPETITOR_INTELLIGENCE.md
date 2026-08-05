# Finalized Project and Competitor Intelligence

## Finalized Project contract

A Finalized Project Package is a clean, immutable rally plan and is distinct from an execution backup. Its stored ZIP contains `manifest.json`, `project.json`, and `validation-report.json`. The manifest identifies `exportType: finalized-project`, package, application, build, Project, and schema versions, the finalization timestamp, inventory counts, and SHA-256 checksums for the plan and report.

Finalization never reorders or repairs data. Blocking errors must be corrected in Planner; warnings require an explicit rider decision. The clean plan preserves arbitrary feature metadata, optimized order, routes, tracks, backbones, notes, photo requirements, competitor configuration, weather/radar settings, and Garmin metadata. It excludes Journal, Analytics, media, competitor observations, checkpoint progress, day progress, and other execution state.

Imported masters are create-only records in `finalizedProjects`. They cannot be opened as an active Project. `Create Active Execution Copy` assigns a new Project and execution identity and records a checksum-backed reference to the immutable master. Project Lifecycle then owns activation and isolation. Execution backups continue to use the Backup/mission-media pipeline and are never accepted as finalized plans.

## Competitor trail contract

Competitors are grouped by stable feed identity. Breadcrumbs are validated, timestamp-sorted, deterministically deduplicated, bounded by history and record count, and split when the tracking session changes, the time gap exceeds 20 minutes, the jump exceeds 25 km, or implied speed exceeds 130 mph. Each segment is a separate Leaflet entity, so no polyline can connect riders, sessions, stale days, or implausible jumps.

Freshness, movement, speed, and direction remain evidence-backed. Unknown values remain unavailable. Reconciliation uses stable rider/segment keys, so unchanged riders are not redrawn and open rider or stationary-event popups survive refresh. Stationary events retain the existing three-minute, 150-meter jitter-tolerant policy. Tactical clusters report only observed nearby riders, movement state, freshness, coordinates, and nearby checkpoints; they never infer stop cause or initiate routing.

Layer panes preserve the operational hierarchy: radar, routes/tracks, competitor trails, stationary events/clusters, checkpoints/hotels, active rider, then Mission Control UI. Project-scoped visibility, opacity, freshness, and history settings persist with the Project.
