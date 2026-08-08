import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_RALLY_EVENT_ID,DEFAULT_RALLY_LEADERBOARD_URL,
  LEGACY_DEFAULT_RALLY_EVENT_ID,LEGACY_DEFAULT_RALLY_LEADERBOARD_URL,
  RALLY_FEED_DEFAULT_REVISION,migrateRallyFeedDefaults,preserveExplicitRallyFeedSettings
} from '../src/core/rally-feed-defaults.js';

test('fresh settings initialize the Event 27 official feed with no custom endpoint',()=>{
  const result=migrateRallyFeedDefaults({});
  assert.equal(result.settings.rallyEventId,DEFAULT_RALLY_EVENT_ID);
  assert.equal(result.settings.leaderboardUrl,DEFAULT_RALLY_LEADERBOARD_URL);
  assert.equal(result.settings.rallyEndpointUrl,'');
  assert.equal(result.settings.rallyFeedDefaultRevision,RALLY_FEED_DEFAULT_REVISION);
});

test('exact legacy defaults migrate once to Event 27 and preserve a custom endpoint',()=>{
  const endpoint='https://example.test/custom-feed.json';
  const first=migrateRallyFeedDefaults({rallyEventId:LEGACY_DEFAULT_RALLY_EVENT_ID,leaderboardUrl:LEGACY_DEFAULT_RALLY_LEADERBOARD_URL,rallyEndpointUrl:endpoint});
  assert.equal(first.settings.rallyEventId,'27');
  assert.equal(first.settings.leaderboardUrl,DEFAULT_RALLY_LEADERBOARD_URL);
  assert.equal(first.settings.rallyEndpointUrl,endpoint);
  assert.equal(migrateRallyFeedDefaults(first.settings).changed,false);
});

test('empty legacy fields advance to Event 27',()=>{
  const result=migrateRallyFeedDefaults({rallyEventId:'',leaderboardUrl:''});
  assert.equal(result.settings.rallyEventId,'27');
  assert.equal(result.settings.leaderboardUrl,DEFAULT_RALLY_LEADERBOARD_URL);
});

test('custom event and custom integration values are never guessed or overwritten',()=>{
  const custom={rallyEventId:'42',leaderboardUrl:'https://leaderboard.example/event/42',rallyEndpointUrl:'https://feed.example/42'};
  assert.deepEqual(migrateRallyFeedDefaults(custom).settings,{...custom,rallyFeedDefaultRevision:RALLY_FEED_DEFAULT_REVISION});
});

test('a partial custom configuration stays partial instead of borrowing Event 27 values',()=>{
  assert.deepEqual(migrateRallyFeedDefaults({rallyEventId:'42'}).settings,{
    rallyEventId:'42',leaderboardUrl:'',rallyEndpointUrl:'',rallyFeedDefaultRevision:RALLY_FEED_DEFAULT_REVISION
  });
  assert.deepEqual(migrateRallyFeedDefaults({leaderboardUrl:'https://custom.example/leaderboard'}).settings,{
    rallyEventId:'',leaderboardUrl:'https://custom.example/leaderboard',rallyEndpointUrl:'',rallyFeedDefaultRevision:RALLY_FEED_DEFAULT_REVISION
  });
});

test('post-migration manual Event 15 selection remains authoritative',()=>{
  const manuallySelected={rallyEventId:'15',leaderboardUrl:LEGACY_DEFAULT_RALLY_LEADERBOARD_URL,rallyEndpointUrl:'',rallyFeedDefaultRevision:RALLY_FEED_DEFAULT_REVISION};
  const reloaded=migrateRallyFeedDefaults(manuallySelected);
  assert.equal(reloaded.changed,false);
  assert.equal(reloaded.settings.rallyEventId,'15');
  assert.equal(reloaded.settings.leaderboardUrl,LEGACY_DEFAULT_RALLY_LEADERBOARD_URL);
});

test('explicit imported feed settings are marked without reinterpretation',()=>{
  const imported=preserveExplicitRallyFeedSettings({rallyEventId:'15',leaderboardUrl:LEGACY_DEFAULT_RALLY_LEADERBOARD_URL,rallyEndpointUrl:'https://custom.example/feed'});
  assert.equal(imported.rallyEventId,'15');
  assert.equal(imported.leaderboardUrl,LEGACY_DEFAULT_RALLY_LEADERBOARD_URL);
  assert.equal(imported.rallyEndpointUrl,'https://custom.example/feed');
  assert.equal(migrateRallyFeedDefaults(imported).changed,false);
});
