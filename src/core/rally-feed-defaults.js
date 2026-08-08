export const DEFAULT_RALLY_EVENT_ID='27';
export const DEFAULT_RALLY_LEADERBOARD_URL='https://gpscheckpoints.com/admin/leaderboard.html?id_event=27';
export const LEGACY_DEFAULT_RALLY_EVENT_ID='15';
export const LEGACY_DEFAULT_RALLY_LEADERBOARD_URL='https://gpscheckpoints.com/admin/leaderboard.html?id_event=15';
export const RALLY_FEED_DEFAULT_REVISION='2026-event-27';

export const RALLY_FEED_DEFAULTS=Object.freeze({
  rallyEventId:DEFAULT_RALLY_EVENT_ID,
  leaderboardUrl:DEFAULT_RALLY_LEADERBOARD_URL,
  rallyEndpointUrl:''
});

const text=value=>String(value??'').trim();

/** Advances only unconfigured or exact legacy defaults, preserving overrides. */
export function migrateRallyFeedDefaults(settings={}){
  const migrated={...(settings&&typeof settings==='object'?settings:{})};
  if(migrated.rallyFeedDefaultRevision===RALLY_FEED_DEFAULT_REVISION){
    return Object.freeze({settings:migrated,changed:false,reason:'already-migrated'});
  }
  const eventId=text(migrated.rallyEventId),leaderboardUrl=text(migrated.leaderboardUrl);
  const shouldAdvance=(eventId===''||eventId===LEGACY_DEFAULT_RALLY_EVENT_ID)&&
    (leaderboardUrl===''||leaderboardUrl===LEGACY_DEFAULT_RALLY_LEADERBOARD_URL);
  if(shouldAdvance){
    migrated.rallyEventId=DEFAULT_RALLY_EVENT_ID;
    migrated.leaderboardUrl=DEFAULT_RALLY_LEADERBOARD_URL;
  }else{
    migrated.rallyEventId=eventId;
    migrated.leaderboardUrl=leaderboardUrl;
  }
  migrated.rallyEndpointUrl??='';
  migrated.rallyFeedDefaultRevision=RALLY_FEED_DEFAULT_REVISION;
  return Object.freeze({settings:migrated,changed:true,reason:shouldAdvance?'legacy-default-advanced':'custom-settings-preserved'});
}

/** Marks imported explicit settings as intentional without reinterpreting them. */
export function preserveExplicitRallyFeedSettings(settings={}){
  return {...(settings&&typeof settings==='object'?settings:{}),rallyEndpointUrl:settings?.rallyEndpointUrl??'',rallyFeedDefaultRevision:RALLY_FEED_DEFAULT_REVISION};
}
