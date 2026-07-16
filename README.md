# CannonMap Beta

## What this beta does
- Imports one or more GPX files
- Displays GPX tracks, routes and waypoints
- Uses the phone's live GPS
- Lists checkpoints and distance from the rider
- Records checkpoint completion, time and position
- Saves all data locally on the device
- Exports checkpoint progress as JSON
- Caches the app shell after the first successful load

## Important limitations
- The OpenStreetMap basemap requires internet on first use and is not a true downloadable offline-map package.
- Imported GPX tracks and waypoints remain stored locally.
- This is not turn-by-turn navigation. Continue using the Garmin Zumo XT3 as the primary navigator.
- GPS normally requires the app to be served over HTTPS or localhost. Opening index.html directly may block GPS on iPhone.

## Easiest beta deployment
Upload the contents of this folder to any HTTPS static host, such as GitHub Pages, Netlify Drop or Cloudflare Pages.

Then open the HTTPS address on the phone:
- iPhone/iPad: Safari > Share > Add to Home Screen
- Android: Chrome menu > Add to Home screen / Install app

## Test checklist
1. Open the app while connected to the internet.
2. Tap Import GPX and select an America 250 GPX file.
3. Confirm the route line and waypoint markers appear.
4. Tap Start GPS and allow precise location.
5. Open Checkpoints and mark one complete.
6. Close and reopen the app; confirm progress remains.
7. Tap Export Progress and confirm a JSON file is created.
