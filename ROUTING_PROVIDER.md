# CannonMap routing provider

## Adapter contract

The desktop planner calls a routing-provider adapter with an ordered array of `{lat, lon}` points and a profile. The adapter must return route geometry plus provider, profile, distance, and duration metadata. Provider-specific response fields do not leak into the CannonMap project model.

## Current provider: OSRM public demo

- Endpoint: `https://router.project-osrm.org/route/v1/driving/...`
- Profile enabled in CannonMap: `driving`
- API key: none
- Connectivity: online only
- Output: calculated road geometry, distance, and estimated duration

The public demo is suitable for beta planning and testing, not guaranteed production capacity. It can reject large requests, throttle traffic, change availability, or lack newly opened roads.

## Important limitations

- The public demo is road-oriented. It is not a dependable adventure-trail or off-road routing source.
- A routable line does not prove that a road is public, legally open, safe, passable, or appropriate for a motorcycle.
- Seasonal closures, private gates, construction, weather, and local restrictions may be absent.
- CannonMap never substitutes a straight line when road calculation fails.
- **Create provisional connection** makes a yellow dashed straight connection labeled `provisional`; it is not presented as a road route.
- Unroutable dirt or trail sections should be created as manually drawn tracks and validated separately.

## Future providers

Additional providers can implement the same adapter without changing checkpoint sequencing, plan storage, mileage categories, or GPX export. A production release should use a provider with documented service levels, appropriate motorcycle/off-road coverage, and licensing that permits CannonMap's intended use.
