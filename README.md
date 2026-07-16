# CannonMap Planner — Beta 0.3.0

## Major changes
- Improved automatic day assignment for imported waypoints using names, descriptions, filenames, and geographic proximity to assigned daily routes/tracks.
- Bulk reassignment of remaining unassigned point features.
- Full feature metadata editing.
- Point features can be moved by dragging or by entering latitude/longitude.
- Route and track vertices can be edited on the map.
- Undo support for recent changes.
- Additional basemaps: Streets, Topographic, Satellite, CyclOSM, and USGS Topo.
- Excel workbook manifest export with multiple sheets.
- CSV manifest export.
- Existing GPX import/export, day filtering, fit-map, local IndexedDB storage, GPS, and competitor snapshot support remain available.

## Excel workbook sheets
- Master Manifest
- Daily Summary
- Checkpoints
- Routes
- Tracks
- Fuel Stops
- Hotels
- Waypoints
- Competitor Trails

## Deployment
Upload every file and folder in this package to the root of the GitHub repository, replacing the prior version. Cloudflare Pages will redeploy automatically.

## Testing priorities
1. Import the America 250 master GPX.
2. Confirm most checkpoints receive the correct day.
3. Select a newly created checkpoint, choose Edit map, drag it, and choose Finish edit.
4. Select a route or track, choose Edit map, move a vertex, and finish editing.
5. Switch among all five basemaps.
6. Export Excel and confirm the workbook opens with separate sheets.
7. Export only one selected day and confirm the manifest is filtered.

## Limitations
- Route drawing is still point-to-point; road snapping is planned for a later release.
- Basemap tiles require internet access.
- Live competitor ingestion still requires an authorized endpoint and server component.
