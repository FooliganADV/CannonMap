# GPS Checkpoints leaderboard live API

Observed on event 60 on 2026-07-25 UTC. This is an unofficial,
implementation-derived contract.

## Requests

The leaderboard loads these resources once at startup:

| Request | Response |
| --- | --- |
| `GET https://checkpointserver.com/admin/events/{eventId}` | event object |
| `GET https://checkpointserver.com/admin/events/{eventId}/checkpoints` | checkpoint array |
| `GET https://checkpointserver.com/admin/events/{eventId}/competitors` | competitor array |

`eventId` is a numeric path parameter. The page constructs `Content-Type:
application/json` and `Authorization: Bearer <local authToken>`. In the public
session the value was literally `Bearer null`; direct requests without
Authorization returned `200`, so CannonMap only sends Authorization when an
explicit token is configured. Responses are `application/json; charset=utf-8`
with `ETag` and `Vary: Origin`.

Event fields: `id`, `company`, `name`, `rally_type`, `start_date`, `end_date`,
`home_url`, `tracking_url`, `max_competitors`, `rally_master_id`, `notes`,
`created_at`, `updated_at`, `token`.

Checkpoint fields: `id`, `event_id`, `name`, `chk_type`, `latitude`,
`longitude`, `radius_m`, `points`, `description`, `created_at`, `updated_at`,
`orden`. Coordinates are decimal strings and can be null for non-GPS bonuses.

Competitor fields: `id`, `event_id`, `competitor_number`, `name`, `team`,
`vehicle`, `phone`, `email`, `social_link_1`, `social_link_2`, `notes`, `token`,
`created_at`, `updated_at`.

## Push feeds and intervals

Scores subscribe to Firebase Realtime Database path `events/{eventId}`:

```text
checkpointId -> competitorId -> { points: number, date: number, ... }
```

Locations subscribe to `locations/{eventId}`:

```text
competitorId -> { latitude: number, longitude: number, date: number, ... }
```

The source page uses Firebase SDK 8.10 WebSocket/long-poll transport. Scores and
locations are push-driven with automatic reconnect, not polled. Its only related
timer recolors location freshness every 30 seconds; its UTC clock ticks every
second.

`gps-checkpoints-feed.js` consumes Firebase REST streams with `EventSource`,
applies `put` and `patch` messages, refreshes REST metadata every five minutes,
times requests out after 15 seconds, and reconnects failed streams using
exponential delays from one to 30 seconds. These intervals are configurable.
