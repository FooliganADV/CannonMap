# CannonMap Planner — Beta 0.4.0

Build: `2026.07.16.01`

## Major changes

- Portable `.cmap` project files:
  - **Save .cmap** downloads the entire project.
  - **Open .cmap** restores it in another browser or device.
- Existing browser data remains available after this upgrade.
- **Reassign days** repairs previously imported unassigned features without importing the GPX again.
- Day detection now recognizes:
  - `Day 5`
  - `D5`
  - `5.14 Checkpoint Name`
  - `Day Five`
  - Day references in notes and descriptions
- GPX import report before changing the project.
- Import choices:
  - **Merge** — update duplicates and add new features
  - **Add all** — retain duplicates
  - **Replace** — replace the current map features
- Duplicate detection for points, routes, and tracks.
- Visible app version and build number.
- Tracking screen now clearly states that live connectors are not active.
- All v0.3.0 map layers, editing tools, Excel export, CSV export, GPX export, GPS, and local autosave remain.

## First test after deployment

1. Open the browser that already contains the America 250 project.
2. Confirm the bottom map status displays `v0.4.0`.
3. Select **Reassign days**.
4. Export Excel and inspect the Daily Summary and Master Manifest.
5. Select **Save .cmap** and confirm a project file downloads.
6. Open a different browser, select **Open .cmap**, and confirm the project appears.
7. Import the master GPX again and test the **Merge** option.

## GitHub web upload

Upload every extracted file to the repository root. The package is flat—there are no required folders.

## Known limitations

- Road snapping is not included yet.
- Offline basemap downloads are not included yet.
- Garmin inReach and GPSCheckpoints live ingestion are not active.
- The external Excel library requires internet when first loaded.
