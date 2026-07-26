import {createClock} from './clock.js';
import {createEventBus} from './event-bus.js';
import {createIdFactory} from './ids.js';
import {createStateStore} from './state-store.js';

export function createLegacyState(appVersion,clock){
  return {
    map:null,baseLayers:{},featureGroup:null,competitorGroup:null,stationaryEventGroup:null,trafficGroup:null,weatherGroup:null,
    gpsLayer:null,gpsAccuracyLayer:null,gpsWatchId:null,lastGpsPosition:null,followedCompetitorId:null,
    arrivalCandidateId:null,arrivalEnteredAt:0,
    pendingLayer:null,pendingImport:null,selectedId:null,editingLayer:null,history:[],
    rallyPollTimer:null,rallyLiveFeed:null,rallySync:{running:false,lastSync:null,lastError:'',pointsAdded:0},
    weatherData:null,weatherPoint:null,trafficIncidents:[],
    radarLayer:null,radarNextLayer:null,radarFrames:[],radarFrameIndex:-1,radarTimer:null,radarLoadTimer:null,radarPlaying:false,radarAnimationToken:0,
    hotelBailoutActive:false,
    project:{version:appVersion,name:'America 250 – 2026',createdAt:clock.iso(),updatedAt:clock.iso(),features:[],competitors:[],stationaryEvents:[]},
    settings:{
      dayFilter:'all',inreachUrl:'',baseLayer:'Streets',lineOpacity:90,
      typeVisibility:{track:true,route:true,backbone:true,waypoint:true,checkpoint:true,fuel:true,hotel:true},
      leaderboardUrl:'https://gpscheckpoints.com/admin/leaderboard.html?id_event=15',rallyEndpointUrl:'',rallyEventId:'15',rallyPollSeconds:30,
      showCompetitorTrails:true,showCompetitorMarkers:true,competitorFreshMinutes:15,
      trafficProvider:'none',tomtomApiKey:'',wazeFeedUrl:'',radarOpacity:65,radarCoverage:'active-day',routeWeatherSpeed:45,
      usableFuelCapacity:0,expectedPavedRange:0,expectedMixedRange:0,reserveDistance:25,fuelProfile:'mixed'
    }
  };
}

export function createCoreCompatibility({appVersion,now,randomUUID,random}){
  const clock=createClock({now});
  const state=createLegacyState(appVersion,clock);
  return Object.freeze({
    clock,
    ids:Object.freeze({create:createIdFactory({randomUUID,now:clock.now,random})}),
    events:createEventBus({detectDuplicateKeys:true}),
    store:createStateStore({initialState:state}),
    state
  });
}
