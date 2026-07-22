import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const css = await readFile(new URL('../app.css', import.meta.url), 'utf8');
const js = await readFile(new URL('../app.js', import.meta.url), 'utf8');

test('mobile controls preserve planner targets and Rally Mode uses 48px primary targets', () => {
  assert.match(css, /\.top-actions \.button \{[^}]*min-height: 44px/);
  assert.match(css, /\.sidebar-toggle \{[^}]*min-height: 44px/);
  assert.match(css, /\.leaflet-bar a,[^{]+\{[^}]*width: 44px !important;[^}]*height: 44px !important/);
  assert.match(css, /\.rally-actions button\{[^}]*min-width:48px;[^}]*min-height:52px/);
  assert.match(css, /\.rally-checkpoint-actions button\{[^}]*min-height:48px/);
  assert.match(css, /\.rally-hotel-action\{[^}]*min-width:124px;[^}]*min-height:48px/);
  assert.match(css, /\.intel-sheet header button\{width:44px;height:44px/);
});

test('mobile drawer blocks map interaction and honors bottom safe area', () => {
  assert.match(css, /\.sidebar \{[^}]*z-index: 1200;[^}]*pointer-events: none;[^}]*padding-bottom: calc\(16px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /\.sidebar\.open \{[^}]*pointer-events: auto/);
  assert.match(css, /\.sidebar-backdrop \{[^}]*z-index: 1100;[^}]*pointer-events: none/);
  assert.match(css, /\.sidebar-backdrop\.visible \{[^}]*pointer-events: auto/);
  assert.match(css, /\.intel-sheet\{[^}]*bottom:max\(8px,env\(safe-area-inset-bottom\)\)/);
});

test('mobile layer manager uses one readable column', () => {
  assert.match(css, /\.type-layer-controls\{grid-template-columns:1fr\}/);
  assert.match(css, /\.type-toggle\{min-width:0;font-size:\.88rem\}/);
  assert.match(css, /\.type-toggle input\[type="checkbox"\]\{width:24px;height:24px;flex:0 0 24px;margin:0\}/);
  assert.match(css, /\.type-toggle \.swatch\{flex:0 0 14px\}/);
});

test('compact and detailed weather use the same maximum gust calculation', () => {
  const helper = js.match(/function weatherMaxGustMph\(data\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper, 'weatherMaxGustMph helper should exist');

  const context = vm.createContext({});
  vm.runInContext(`${helper}; result = weatherMaxGustMph({current:{wind_gusts_10m:5},hourly:{wind_gusts_10m:[8,22,17]}});`, context);
  assert.equal(context.result, 22);
  assert.match(js, /const gusts=weatherMaxGustMph\(data\)/);
  assert.match(js, /Gusts \$\{Math\.round\(weatherMaxGustMph\(state\.weatherData\)\)\} mph/);
});
