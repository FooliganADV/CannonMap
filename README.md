# CannonMap Planner — Beta 0.2.0

CannonMap is a browser-based GPX planning and rally-intelligence application built for the 2026 ADV Cannonball / America 250 project.

## Included in this build

- Import GPX 1.1 files containing waypoints, routes and tracks
- Display multiple GPX files simultaneously
- Draw new point-to-point tracks/routes and waypoint/checkpoint markers
- Edit line vertices and drag features with Leaflet-Geoman controls
- Rename, classify, assign rally days, duplicate and delete features
- Filter the working map by Day 1 through Day 8
- Export all visible-day features back to GPX
- Save the current project locally in the browser
- GPS position display on HTTPS
- Streets and topographic basemaps
- Manual competitor breadcrumb JSON import
- Garmin inReach feed configuration placeholder
- Installable PWA shell and Cloudflare Pages headers

## Important limitations

- Route drawing is point-to-point. It does **not yet snap to roads** or calculate turn-by-turn directions.
- The basemap still requires internet. The application shell caches after first load, but true offline map packages are not included yet.
- Projects are stored in IndexedDB, which is suitable for large beta GPX files but is still device-specific and not cloud synchronization.
- Automatic GPSCheckpoints and Garmin inReach polling are not active. They require an authorized endpoint and a Cloudflare Worker.
- Garmin Zumo XT3 remains the primary turn-by-turn navigation device during this beta.

## Deploy to Cloudflare Pages

1. Extract this ZIP.
2. Upload all extracted files to the root of `FooliganADV/CannonMap` on GitHub.
3. In Cloudflare Dashboard, open **Workers & Pages**.
4. Select **Create application** → **Pages** → **Connect to Git**.
5. Choose `FooliganADV/CannonMap`.
6. Framework preset: **None**.
7. Build command: leave blank.
8. Build output directory: `/` or leave blank if Cloudflare accepts the repository root.
9. Deploy.

Cloudflare will provide an HTTPS address such as `cannonmap.pages.dev`.

## Testing checklist

1. Open the HTTPS site on Windows and iPad.
2. First import `samples/cannonmap-test.gpx` to verify the installation.
3. Then import `2026_ADV_Cannonball_MASTER.gpx`.
4. Confirm routes, tracks and waypoints appear.
5. Select a rally day and verify the layer filter.
6. Draw a short polyline and save it as a Route.
7. Use edit mode to move one vertex.
8. Add a checkpoint marker.
9. Export the selected day to GPX.
10. Re-import the exported file and verify the features.
11. Close and reopen the browser to confirm the project reloads.

## Competitor JSON test format

```json
[
  {
    "id": "27",
    "name": "Rider 27",
    "points": [
      {"lat": 38.50, "lon": -105.20, "time": "2026-09-20T14:10:00Z"},
      {"lat": 38.52, "lon": -105.25, "time": "2026-09-20T14:15:00Z"}
    ]
  }
]
```

## Next build priorities

1. Road-snapped routing engine
2. IndexedDB storage for very large GPX projects
3. Cloudflare synchronization and project backups
4. Offline map package management
5. Authorized GPSCheckpoints live polling and trail intelligence
6. Garmin inReach KML ingestion
7. Fuel planner and checkpoint scoring dashboard
