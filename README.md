# CannonMap Planner — Beta 0.7.0 Rally Mode Reset

Build: `2026.07.21.07`

## Purpose

CannonMap is a rally decision system. The primary live-rally function is displaying and preserving competitor trails from the official GPS Checkpoint leaderboard feed. The backbone is only an optional sightseeing/reference layer; it is not an official route.

## New in this release

- Dedicated phone-first Rally Mode while preserving the desktop Planner
- Checkpoint states, 10/21 point scoring, completion, defer, restore, skip, and sequence preservation
- One-action hotel bailout that defers unfinished checkpoints and offers an immediate undo
- Fuel planning foundation with explicitly conservative, configurable estimates
- Central event-data protection that removes and logs `Old Coast Road` at every import/restore boundary
- Geometry-based route/track mileage deduplication, including reversed and differently spaced representations
- Real Playwright browser tests across requested phone and desktop layouts
- Deployment parity audit in `DEPLOYMENT_AUDIT.md`

- Buffered radar frame loading and crossfading remove the blank strobe between animation frames
- Radar can be restricted to the active day, selected route/track, or current map view
- Route/day radar uses a 30-mile buffer so approaching weather remains visible
- Optional animated recent-weather radar overlay with opacity control and timestamps
- Track-ahead weather scan with an estimated rain start time, distance, and rainfall exposure
- Route hazard warnings for wind gusts, snow, freezing precipitation, thunderstorms/hail, low visibility, dust, and poor air quality
- Configurable planning speed for arrival-time estimates along the track
- Trail Intelligence integration hub
- Generic live competitor-location JSON connector with configurable polling
- Breadcrumb history preservation when a feed only returns each rider's latest position
- Fresh/stale rider display and trail-age indicators
- Competitor trail export, clearing, and per-rider zoom
- Live Open-Meteo weather at GPS position, selected checkpoint, or map center
- TomTom Traffic incident support for the current map viewport
- Waze launch button plus optional Waze for Cities inbound data-feed support for approved partners
- Compact mobile Intel sheet instead of adding another full phone dashboard
- Backbone feature type with a gray dashed reference style
- Planning mileage no longer automatically adds route and track mileage together
- TomTom keys remain local to the browser and are excluded from portable `.cmap` exports
- Existing GPX, `.cmap`, search, editing, snapshots, layer controls, Excel/CSV, and manual competitor JSON features retained

## Upload

Extract the ZIP and upload every file to the GitHub repository root. Replace the existing files.

## Tests

Run the dependency-free regression suite with Node.js:

```text
node --test tests/*.test.mjs
```

## First test

1. Confirm the status shows `v0.6.2 · 2026.07.21.02`.
2. Import `competitor-test.json`; verify the red trail appears and Rider 27 is listed.
3. Open **Trail Intel** and select **Weather here**. No key is required.
4. On a phone, select **Intel** and verify the compact bottom sheet opens without covering the entire map.
5. Change a line feature to **Backbone (reference)** and verify it becomes gray and dashed.
6. Confirm project mileage does not double-count both a route and its matching track.
7. Enter a TomTom API key, zoom to a local area, and select **Traffic in map view**.
8. Do not start live rally polling until the live GPS Checkpoint JSON/location endpoint is captured.

## What is still needed from the user

### Official competitor trails

Capture a live public leaderboard session as a HAR file. CannonMap needs the actual JSON/location request, not the visible `leaderboard.html` page URL. Once identified, paste that endpoint into **Trail Intel → Official rally feed setup**.

### Traffic

Choose one:

- TomTom developer API key; or
- Waze for Cities partner GeoRSS URL.

The normal consumer Waze application does not provide CannonMap a general-purpose public traffic feed. CannonMap can open Waze at the active map location; an in-app Waze overlay requires approved Waze for Cities data access.

## Current limitations

- The exact GPS Checkpoint live-feed schema remains unverified until a live HAR capture is available.
- Consensus routing, turnaround detection, rider-ahead filtering, and scoring recommendations require verified live data.
- Browser CORS restrictions may require a Cloudflare Worker after the official feed endpoint is identified. Browser polling also stops when iOS suspends or closes the page.
- Radar requires internet access, shows recent observed precipitation rather than forecast nowcast frames, and has source resolution through zoom level 7.
- Track-ahead weather uses sampled forecast points and the selected planning speed. Timing, rainfall, dust, and hazard values are estimates—not safety guarantees.
- TomTom incident requests require the map viewport to be no larger than 10,000 km².
