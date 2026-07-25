# Architecture

## Stationary-event pipeline

`stationary-events.js` is a dependency-free detection and geometry module.
`app.js` invokes it after breadcrumb merges and stores results in
`project.stationaryEvents`.

The detector sorts timestamped breadcrumb history, grows a continuous cluster,
and verifies that every clustered point stays within 150 meters of the first
position in that cluster. An event becomes visible at 180 seconds. The stable event ID combines
rally event, competitor, and cluster start time, preventing duplicate records.

Exit handling uses hysteresis: a single outlier does not close the event. Two
consecutive points beyond 190 meters close it at the last in-cluster timestamp.
Completed events are merged back into local state even when their old
breadcrumbs later age out.

Leaflet renders stationary events in a separate overlay. Nearby icons receive
small deterministic display offsets while their event centers remain unchanged.
Popup zoom always uses the true center and does not alter the base-layer choice.
