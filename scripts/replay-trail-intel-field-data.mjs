#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  breadcrumbKey,
  compactTrailSegmentsForRender,
  deriveTacticalTrail,
  distanceMeters,
  normalizeTrailPoints,
  pointTime,
  trailStatus,
} from '../src/domain/competitors/trails.js';

const DEFAULTS = Object.freeze({
  gapMs: 2 * 60 * 1000,
  maxSpeedMph: 130,
  maxJumpMeters: 25_000,
  equalTimestampMeters: 10,
  historyMs: 8 * 60 * 60 * 1000,
  maxPoints: 12_000,
  maxRenderPoints: 720,
  nearDuplicateMs: 5_000,
  nearDuplicateMeters: 3,
});

const args = process.argv.slice(2);
const outputArgumentIndex = args.indexOf('--output');
const outputPath = outputArgumentIndex >= 0 ? resolve(args[outputArgumentIndex + 1]) : null;
if (outputArgumentIndex >= 0) args.splice(outputArgumentIndex, 2);
if (!args.length) {
  console.error('Usage: node scripts/replay-trail-intel-field-data.mjs [--output report.json] <competitor-export.json> [...]');
  process.exitCode = 2;
} else {
  const result = {
    format: 'CannonMap Trail Intel Field Replay',
    generatedAt: new Date().toISOString(),
    pipeline: {
      source: 'src/domain/competitors/trails.js',
      ...DEFAULTS,
    },
    datasets: [],
  };
  for (const file of args) result.datasets.push(await replayExport(resolve(file)));
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) await writeFile(outputPath, serialized, 'utf8');
  else process.stdout.write(serialized);
}

async function replayExport(file) {
  const source = await readFile(file);
  const payload = JSON.parse(source);
  const now = validTime(payload.exportedAt) || latestTime(payload.competitors) + 60_000 || Date.now();
  const competitors = (payload.competitors || []).map((competitor) => replayCompetitor(competitor, now));
  return {
    sourceFile: file,
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    format: payload.format,
    appVersion: payload.appVersion,
    eventId: payload.eventId,
    exportedAt: payload.exportedAt,
    receivedCount: competitors.reduce((sum, item) => sum + item.counts.received, 0),
    normalizedDurableCount: competitors.reduce((sum, item) => sum + item.counts.normalizedDurable, 0),
    acceptedCount: competitors.reduce((sum, item) => sum + item.counts.accepted, 0),
    quarantinedCount: competitors.reduce((sum, item) => sum + item.counts.quarantined, 0),
    renderedCount: competitors.reduce((sum, item) => sum + item.counts.rendered, 0),
    competitors,
  };
}

function replayCompetitor(competitor, now) {
  const raw = Array.isArray(competitor.points) ? competitor.points : [];
  const inputByKey = new Map();
  raw.forEach((point, sourceIndex) => {
    const key = safeKey(point);
    const rows = inputByKey.get(key) || [];
    rows.push({ point, sourceIndex });
    inputByKey.set(key, rows);
  });
  const normalized = normalizeTrailPoints(raw, { now, historyMs: DEFAULTS.historyMs, maxPoints: DEFAULTS.maxPoints });
  const tactical = deriveTacticalTrail(raw, {
    now,
    gapMs: DEFAULTS.gapMs,
    maxSpeedMph: DEFAULTS.maxSpeedMph,
    maxJumpMeters: DEFAULTS.maxJumpMeters,
    equalTimestampMeters: DEFAULTS.equalTimestampMeters,
    historyMs: DEFAULTS.historyMs,
    maxPoints: DEFAULTS.maxPoints,
  });
  const renderedSegments = compactTrailSegmentsForRender(tactical.segments, {
    now,
    maxRenderPoints: DEFAULTS.maxRenderPoints,
  });
  const normalizedKeys = new Set(normalized.map(breadcrumbKey));
  const acceptedKeys = new Set(tactical.points.map(breadcrumbKey));
  const renderedKeys = new Set(renderedSegments.flat().map(breadcrumbKey));
  const quarantineByKey = new Map(tactical.quarantined.map((row) => [breadcrumbKey(row.point), row]));
  const segmentStarts = classifySegmentStarts(tactical.segments);
  const nearDuplicateKeys = classifyNearDuplicates(normalized);
  const ledger = raw.map((point, sourceIndex) => {
    const key = safeKey(point);
    const identicalRows = inputByKey.get(key) || [];
    const isRetainedDuplicate = identicalRows.at(-1)?.sourceIndex === sourceIndex;
    const normalizedDurable = normalizedKeys.has(key) && isRetainedDuplicate;
    const quarantine = normalizedDurable ? quarantineByKey.get(key) : null;
    const segment = normalizedDurable ? segmentStarts.get(key) : null;
    let omittedReason = null;
    if (!normalizedDurable) omittedReason = identicalRows.length > 1 && !isRetainedDuplicate ? 'exact_duplicate' : normalizationOmissionReason(point, now, DEFAULTS.historyMs);
    else if (quarantine) omittedReason = `quarantined:${quarantine.reason}`;
    else if (!renderedKeys.has(key)) omittedReason = 'render_compaction';
    return {
      sourceIndex,
      received: true,
      sourceDurable: true,
      normalizedDurable,
      exactDuplicate: identicalRows.length > 1,
      exactDuplicateRetained: identicalRows.length > 1 && isRetainedDuplicate,
      nearDuplicate: normalizedDurable && nearDuplicateKeys.has(key),
      nearDuplicateHeuristic: normalizedDurable && nearDuplicateKeys.has(key) ? '<=5 seconds and <=3 meters; forensic label, not a pipeline disposition' : null,
      accepted: normalizedDurable && acceptedKeys.has(key),
      quarantined: Boolean(quarantine),
      quarantineReason: quarantine?.reason || null,
      quarantineBoundaryReason: quarantine?.boundaryReason || null,
      segmentStart: Boolean(segment),
      segmentStartReason: segment?.reason || null,
      telemetryGap: segment?.reason === 'telemetry_gap',
      sessionBoundary: segment?.reason === 'session_changed',
      corroboratedRelocation: segment?.reason === 'corroborated_relocation',
      rendered: normalizedDurable && renderedKeys.has(key),
      omitted: Boolean(omittedReason),
      omittedReason,
      observation: diagnosticObservation(point),
    };
  });
  const status = trailStatus(raw, { now, tacticalTrail: tactical });
  const acceptedOnlyStatus = trailStatus(tactical.points, { now });
  return {
    competitorId: String(competitor.id ?? ''),
    name: competitor.name ?? null,
    number: competitor.number ?? null,
    counts: {
      received: raw.length,
      sourceDurable: raw.length,
      normalizedDurable: normalized.length,
      exactDuplicateRows: ledger.filter((row) => row.omittedReason === 'exact_duplicate').length,
      exactDuplicateGroups: [...inputByKey.values()].filter((rows) => rows.length > 1).length,
      nearDuplicateObservations: ledger.filter((row) => row.nearDuplicate).length,
      accepted: tactical.points.length,
      quarantined: tactical.quarantined.length,
      pending: tactical.pending ? 1 : 0,
      segments: tactical.segments.length,
      telemetryGaps: [...segmentStarts.values()].filter((row) => row.reason === 'telemetry_gap').length,
      sessionBoundaries: [...segmentStarts.values()].filter((row) => row.reason === 'session_changed').length,
      corroboratedRelocations: [...segmentStarts.values()].filter((row) => row.reason === 'corroborated_relocation').length,
      rendered: renderedSegments.flat().length,
      omittedFromRender: Math.max(0, tactical.points.length - renderedSegments.flat().length),
    },
    status: {
      status: status.status,
      motion: status.motion,
      currentSpeedMph: finiteOrNull(status.currentSpeedMph),
      speedSource: status.speedSource,
      speedSampleCount: status.speedSampleCount,
      headingDegrees: finiteOrNull(status.headingDegrees),
      headingCardinal: status.headingCardinal,
      rollingPaceMph: finiteOrNull(status.rollingPaceMph),
      rollingCoverageMs: status.rollingCoverageMs,
      rollingPaceSufficient: status.rollingPaceSufficient,
      sustainedPaceMph: finiteOrNull(status.sustainedPaceMph),
      sustainedCoverageMs: status.sustainedCoverageMs,
      sustainedPaceSufficient: status.sustainedPaceSufficient,
      trailGapCount: status.trailGapCount,
    },
    metricIsolation: {
      acceptedOnlyMatches: statusFieldsMatch(status, acceptedOnlyStatus),
      acceptedDistanceMiles: segmentDistanceMiles(tactical.segments),
      renderedDistanceMiles: segmentDistanceMiles(renderedSegments),
      maximumAcceptedTransitionMph: maximumTransitionMph(tactical.segments),
    },
    segmentSummary: tactical.segments.map((segment, index) => ({
      index,
      points: segment.length,
      startedAt: segment[0]?.time || null,
      endedAt: segment.at(-1)?.time || null,
      startReason: index ? segmentStarts.get(breadcrumbKey(segment[0]))?.reason || 'unknown' : 'initial',
      confirmationElapsedMs: index && segment.length > 1 ? pointTime(segment[1]) - pointTime(segment[0]) : null,
      confirmationDistanceMeters: index && segment.length > 1 ? distanceMeters(segment[0], segment[1]) : null,
    })),
    suspiciousObservations: ledger.filter((row) => row.quarantined || row.segmentStart || row.exactDuplicate || row.nearDuplicate),
    ledger,
  };
}

function classifyNearDuplicates(points) {
  const keys = new Set();
  for (let index = 1; index < points.length; index += 1) {
    const prior = points[index - 1];
    const point = points[index];
    const elapsed = pointTime(point) - pointTime(prior);
    if (elapsed < 0 || elapsed > DEFAULTS.nearDuplicateMs) continue;
    if (distanceMeters(prior, point) > DEFAULTS.nearDuplicateMeters) continue;
    if (breadcrumbKey(prior) === breadcrumbKey(point)) continue;
    keys.add(breadcrumbKey(prior));
    keys.add(breadcrumbKey(point));
  }
  return keys;
}

function classifySegmentStarts(segments) {
  const starts = new Map();
  for (let index = 1; index < segments.length; index += 1) {
    const prior = segments[index - 1].at(-1);
    const point = segments[index][0];
    const elapsedMs = pointTime(point) - pointTime(prior);
    const distance = distanceMeters(prior, point);
    const speedMph = elapsedMs > 0 ? distance / (elapsedMs / 1000) * 2.236936 : null;
    const priorSession = normalizedSession(prior.sessionId);
    const nextSession = normalizedSession(point.sessionId);
    const sessionChanged = priorSession !== nextSession && (priorSession !== null || nextSession !== null);
    let reason = 'corroborated_relocation';
    if (sessionChanged) reason = 'session_changed';
    else if (elapsedMs > DEFAULTS.gapMs && distance <= DEFAULTS.maxJumpMeters && speedMph <= DEFAULTS.maxSpeedMph) reason = 'telemetry_gap';
    starts.set(breadcrumbKey(point), { reason, elapsedMs, distanceMeters: distance, speedMph });
  }
  return starts;
}

function normalizationOmissionReason(point, now, historyMs) {
  const lat = Number(point?.lat);
  const lon = Number(point?.lon);
  const time = pointTime(point);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return 'invalid_coordinates';
  if (!time) return 'invalid_timestamp';
  if (time > now + 60_000) return 'future_timestamp';
  if (now - time > historyMs) return 'history_expired';
  return 'durable_bound_or_key_replacement';
}

function diagnosticObservation(point) {
  return {
    key: safeKey(point),
    time: point?.time ?? point?.timestamp ?? point?.recordedAt ?? null,
    lat: finiteOrNull(point?.lat),
    lon: finiteOrNull(point?.lon),
    sessionId: point?.sessionId ?? null,
    observationId: point?.observationId ?? point?.id ?? null,
    providerSpeedMph: finiteOrNull(point?.speedMph),
    providerHeading: finiteOrNull(point?.heading),
  };
}

function safeKey(point) {
  try {
    return breadcrumbKey(point);
  } catch {
    return `invalid|${JSON.stringify(point)}`;
  }
}

function finiteOrNull(value) {
  return value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
}

function validTime(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestTime(competitors) {
  let latest = 0;
  for (const competitor of competitors || []) for (const point of competitor.points || []) latest = Math.max(latest, pointTime(point));
  return latest;
}

function normalizedSession(value) {
  return value === null || value === undefined || String(value).trim() === '' ? null : String(value);
}

function segmentDistanceMiles(segments) {
  let meters = 0;
  for (const segment of segments || []) for (let index = 1; index < segment.length; index += 1) meters += distanceMeters(segment[index - 1], segment[index]);
  return meters / 1609.344;
}

function maximumTransitionMph(segments) {
  let maximum = 0;
  for (const segment of segments || []) for (let index = 1; index < segment.length; index += 1) {
    const elapsedMs = pointTime(segment[index]) - pointTime(segment[index - 1]);
    if (elapsedMs > 0) maximum = Math.max(maximum, distanceMeters(segment[index - 1], segment[index]) / (elapsedMs / 1000) * 2.236936);
  }
  return maximum;
}

function statusFieldsMatch(left, right) {
  const fields = ['currentSpeedMph', 'speedSource', 'speedSampleCount', 'headingDegrees', 'headingCardinal', 'motion', 'rollingPaceMph', 'rollingCoverageMs', 'sustainedPaceMph', 'sustainedCoverageMs', 'trailGapCount'];
  return fields.every((field) => Object.is(left[field], right[field]));
}
