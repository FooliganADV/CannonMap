# CannonMap Plugin Architecture

Status: contract definition for Milestone M0  
Implementation: deferred to Milestone M1

## Purpose

The Plugin Manager isolates optional integrations from CannonMap core. It is
not a general extension mechanism for domain behavior. Plugin failure must
never prevent CannonMap or Rally Mode from starting.

Core functionality is never a plugin: Observation Capture, State Store, Event
Bus, IndexedDB, Sync Engine, Route Family Engine, Commitment Engine, Confidence
Engine, Checkpoint Intelligence, Publication Pipeline, Co-Driver Engine, and
Layer 7 Evaluation.

Eligible plugins include GPS Checkpoints, weather, radar, traffic, SpotWalla,
inReach, Garmin, onX, Gaia, export providers, AI assistants, and future optional
integrations.

## Contract shape

A plugin manifest declares data; it does not execute during discovery.

```js
{
  id: "gps-checkpoints",
  version: "1.0.0",
  apiVersion: "1",
  capabilities: ["competitor-feed"],
  requiresCapabilities: [],
  offline: "last-known",
  featureFlag: "plugin.gps-checkpoints.enabled"
}
```

The future factory contract is:

```js
createPlugin(context) -> {
  initialize() -> Promise<void>,
  start() -> Promise<void>,
  stop() -> Promise<void>,
  dispose() -> Promise<void>,
  health() -> PluginHealth
}
```

This is an architecture contract, not an M0 runtime implementation.

## Lifecycle

1. **Discovered**: manifest parsed and validated without executing plugin code.
2. **Disabled**: default state; no initialization or resource ownership.
3. **Initializing**: receives restricted capability context and abort signal.
4. **Ready**: capability implementations registered but not necessarily active.
5. **Started**: optional integration may perform its bounded work.
6. **Degraded**: capability unavailable or stale; core continues.
7. **Stopped**: listeners, timers, and requests released.
8. **Disposed**: registrations revoked and plugin instance unusable.
9. **Failed**: error isolated, diagnostic retained, core continues.

Lifecycle calls are idempotent. Shutdown occurs in reverse initialization
order. `stop()` and `dispose()` must tolerate partial initialization.

## Capability registration and discovery

- Plugins publish implementations through versioned capability interfaces.
- Core publishes only the minimum interfaces plugins require.
- Registration includes plugin ID, capability ID, interface version, health,
  offline behavior, and a revocation function.
- Consumers request a capability by ID and compatible interface version.
- Discovery returns metadata/handles, never another plugin's implementation
  object.
- Absence or failure returns an explicit unavailable capability; core chooses a
  safe fallback.

Examples of optional capabilities:

- `competitor-feed@1`
- `weather-provider@1`
- `radar-provider@1`
- `traffic-provider@1`
- `location-share-provider@1`
- `map-link-provider@1`
- `export-provider@1`
- `assistant-provider@1`

## Initialization context

Plugins receive a restricted context containing only approved interfaces:

- capability registry
- read-only feature flags
- scoped logger/diagnostics
- clock and abort signal
- scoped network client
- scoped cache/repository port when explicitly allowed
- event publication interface for approved integration events

Plugins do not receive the global state object, Leaflet map, Rally Mode
controller, Firebase root, raw IndexedDB connection, or DOM root.

## Dependency rules

- A plugin may never import `app.js`.
- A plugin may never directly modify core domain state.
- A plugin may never own or replace Rally Mode.
- A plugin may never import another plugin implementation.
- Plugins communicate only through published, versioned capability interfaces.
- Optional plugin-to-plugin workflows are mediated by the capability registry.
- A plugin cannot require another plugin ID; it may require a capability.
- Core cannot require an optional plugin for startup or safe Rally operation.
- Plugin modules may import only their own implementation, approved shared
  contracts, and the public Plugin API.

## Failure handling

- Each lifecycle operation has a timeout and abort signal.
- Plugin exceptions are contained at the Plugin Manager boundary.
- Registration is transactional: partial capabilities are revoked on failure.
- Timers, listeners, workers, and requests are tracked for deterministic
  shutdown.
- Repeated failure opens a local circuit breaker; manual or bounded retry is
  explicit.
- Diagnostics include plugin ID/version, lifecycle phase, capability, error
  code, and time. They exclude tokens, contacts, and raw private locations.
- Rally Mode continues with the capability marked unavailable or stale.

## Feature flags

- Every plugin has `plugin.<pluginId>.enabled`.
- Default is off.
- Capability-specific flags may further restrict behavior.
- Enabling a flag permits initialization; it does not grant data access.
- Disabling triggers orderly stop and capability revocation.
- Flag changes during a rally cannot change frozen core model versions.

## Versioning

- Plugin package versions use semantic versioning.
- Capability interfaces use explicit major versions.
- The Plugin Manager rejects unsupported major versions before initialization.
- Minor additions are backward compatible and optional.
- Persisted plugin data includes plugin ID, plugin version, capability version,
  and schema version.
- Migrations are plugin-scoped and may not modify core stores directly.

## Offline expectations

Each plugin declares one mode:

- `none`: unavailable offline.
- `last-known`: may serve clearly timestamped cached data.
- `queue`: may queue bounded idempotent writes through an approved port.
- `full`: operates offline using plugin-scoped data.

Plugins must never claim fresh data while offline. Core offline startup cannot
wait for plugins. Plugin cache failure cannot invalidate the application shell.

## Security

- Least privilege by capability and event scope.
- Secrets and bearer tokens are never committed or exposed in diagnostics.
- Network hosts, methods, timeouts, and response sizes are allowlisted per
  plugin.
- Plugin payloads are schema validated and treated as untrusted.
- Plugins cannot access another plugin's storage namespace.
- Public/crowd data must pass core privacy and validation pipelines; a plugin
  cannot publish intelligence directly.
- AI plugins cannot mutate core state or present generated claims as observed
  facts.

## M1 implementation boundary

M1 may implement the Plugin Manager, registry, context, lifecycle, and tests.
It must not convert core subsystems into plugins or migrate integrations in the
same commit. Each existing optional integration is adapted separately after the
manager is proven and remains behind a default-off flag.

