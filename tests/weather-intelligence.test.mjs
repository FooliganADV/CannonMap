import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const app = await readFile(new URL('app.js', root), 'utf8');
const html = await readFile(new URL('index.html', root), 'utf8');
const css = await readFile(new URL('app.css', root), 'utf8');

test('radar uses the public RainViewer frame API with attribution and safe source zoom', () => {
  assert.match(app, /api\.rainviewer\.com\/public\/weather-maps\.json/);
  assert.match(app, /maxNativeZoom:7/);
  assert.match(app, /RainViewer/);
  assert.match(html, /id="radarToggleButton"/);
  assert.match(html, /Radar data:[\s\S]*RainViewer/);
});

test('radar animation can be stopped and opacity is configurable', () => {
  assert.match(app, /function stopRadarLoop\(\)/);
  assert.match(app, /clearTimeout\(state\.radarTimer\)/);
  assert.match(app, /next\.once\('load',reveal\)/);
  assert.match(app, /previous\?\.setOpacity\(0\)/);
  assert.match(css, /\.cannon-radar-layer\{transition:opacity/);
  assert.match(app, /setOpacity\(state\.settings\.radarOpacity\/100\)/);
  assert.match(html, /id="radarOpacity"[^>]*type="range"/);
});

test('radar can be limited to a buffered active-day or selected-route corridor', () => {
  assert.match(html, /id="radarCoverage"/);
  assert.match(html, /Active day \(30-mile buffer\)/);
  assert.match(html, /Selected route\/track \(30-mile buffer\)/);
  assert.match(app, /function radarCoverageBounds\(\)/);
  assert.match(app, /const latPad=30\/69/);
  assert.match(app, /options\.bounds=bounds/);
});

test('track-ahead scan requests rain, wind, snow, visibility, dust and air quality', () => {
  for (const variable of ['precipitation','rain','snowfall','weather_code','wind_gusts_10m','visibility']) assert.match(app, new RegExp(variable));
  for (const variable of ['dust','pm2_5','us_aqi','uv_index']) assert.match(app, new RegExp(variable));
  assert.match(app, /Rain likely in about/);
  assert.match(app, /Estimated rainfall exposure/);
  assert.match(app, /freezing precipitation risk/);
  assert.match(app, /thunderstorm\/hail/);
  assert.match(app, /low visibility/);
  assert.match(app, /high heat/);
  assert.match(app, /extreme cold/);
  assert.match(app, /very high UV/);
});

test('weather controls remain usable in the phone drawer', () => {
  assert.match(css, /\.weather-radar-controls/);
  assert.match(html, /id="routeWeatherButton"[^>]*class="button secondary wide"/);
  assert.match(html, /id="routeWeatherSpeed"/);
});
