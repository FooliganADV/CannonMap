import assert from 'node:assert/strict';
import test from 'node:test';
import {renderRally} from '../src/ui/rally/presenter.js';
import {wireRallyController} from '../src/ui/rally/controller.js';

const fakeElement=()=>({
  textContent:'',innerHTML:'',disabled:false,hidden:false,value:'',checked:false,listeners:{},
  dataset:{},
  classList:{values:new Set(),toggle(name,enabled){if(enabled)this.values.add(name);else this.values.delete(name);}},
  attributes:{},addEventListener(name,handler){this.listeners[name]=handler;},
  setAttribute(name,value){this.attributes[name]=String(value);}
});

test('Rally presenter preserves score, checkpoint, fuel, and control state',()=>{
  const elements=new Map(),getElement=id=>{
    if(!elements.has(id))elements.set(id,fakeElement());
    return elements.get(id);
  };
  renderRally({getElement,escapeHtml:value=>String(value),model:{
    day:1,online:false,gpsStatus:'GPS off',gpsAccuracy:'GPS off',elevation:'Elev —',score:31,
    next:{id:'cp',name:'Extreme Checkpoint',notes:'Approach from the north.',extreme:true,points:21,status:'next'},distance:4.25,
    hotelLabel:'Hotel 12 mi',feedAge:'Feed Never',warnings:[{id:'construction',message:'Construction at the south entrance.'}],
    deferredCount:1,showDeferredPrompt:false,hasHotel:true,hotelBailoutActive:false,autoComplete:true,arrivalRadius:500,maxAccuracy:200,
    navigationGuidance:"Turn LEFT in 200'",objectiveIntel:'4 riders near objective · 3 recent trails within 1 mi',
    checkpoints:[{id:'cp',name:'Extreme Checkpoint',extreme:true,status:'next'}]
  }});
  assert.equal(getElement('rallyScore').textContent,31);
  assert.equal(getElement('rallyDay').textContent,'Day 1');
  assert.equal(getElement('rallyNavigationGuidance').textContent,"Turn LEFT in 200'");
  assert.equal(getElement('rallyNextDistance').textContent,'4.3 mi');
  assert.equal(getElement('rallyRiderNotes').textContent,'Approach from the north.');
  assert.match(getElement('rallyWarnings').innerHTML,/Construction/);
  assert.equal(getElement('rallyNextButton').hidden,true);
  assert.match(getElement('checkpointOrderList').innerHTML,/21-point extreme/);
  assert.equal(getElement('rallyCompleteButton').disabled,false);
  assert.equal(getElement('rallyRiderNotesSection').hidden,false);
  assert.equal(getElement('rallyWarningsSection').hidden,false);
  assert.match(getElement('rallyObjectiveStatus').textContent,/21 points · EXTREME/);
  assert.equal(getElement('rallyObjectiveIntelSection').hidden,false);
});

test('Rally presenter hides empty objective sections and hotel defer control',()=>{
  const elements=new Map(),getElement=id=>{if(!elements.has(id))elements.set(id,fakeElement());return elements.get(id);};
  renderRally({getElement,escapeHtml:String,model:{day:2,online:true,score:0,next:{id:'hotel',name:'Official Hotel',type:'hotel'},distance:null,warnings:[],checkpoints:[],hasHotel:true}});
  assert.equal(getElement('rallyRiderNotesSection').hidden,true);
  assert.equal(getElement('rallyWarningsSection').hidden,true);
  assert.equal(getElement('rallyDeferIcon').hidden,true);
});

test('Rally presenter exposes compact truthful PHOTO states without changing the completion control',()=>{
  const elements=new Map(),getElement=id=>{if(!elements.has(id))elements.set(id,fakeElement());return elements.get(id);};
  const base={day:1,online:true,score:123,distance:1.25,warnings:[],checkpoints:[],hasHotel:true};
  const render=(photoRecoveryAction,photoCaptureActive=false)=>renderRally({getElement,escapeHtml:String,model:{...base,photoCaptureActive,next:{id:'cp-1',name:'Long checkpoint name',notes:'Long rider note',type:'checkpoint',photoRecoveryAction}}});
  render('CAPTURE PHOTO');
  assert.equal(getElement('rallyCompleteButton').textContent,'PHOTO');
  assert.equal(getElement('rallyCompleteButton').dataset.photoState,'ready');
  render('RETRY EVIDENCE');
  assert.equal(getElement('rallyCompleteButton').textContent,'RETRY PHOTO');
  assert.equal(getElement('rallyCompleteButton').dataset.photoState,'pending');
  render('RESUME PAIR',true);
  assert.equal(getElement('rallyCompleteButton').textContent,'CAPTURING…');
  assert.equal(getElement('rallyCompleteButton').dataset.photoState,'capturing');
  assert.equal(getElement('rallyCompleteButton').disabled,false,'presentation must not replace the existing action wiring');
  assert.equal(getElement('rallyNextName').attributes.title,'Long checkpoint name');
  assert.equal(getElement('rallyRiderNotes').attributes.title,'Long rider note');
});

test('camera setup keeps manual escape available while browser acquisition is checking',()=>{
  const elements=new Map(),getElement=id=>{if(!elements.has(id))elements.set(id,fakeElement());return elements.get(id);};
  renderRally({getElement,escapeHtml:String,model:{day:1,online:true,score:0,next:null,distance:null,warnings:[],checkpoints:[],hasHotel:true,showCameraSetup:true,cameraReadiness:{permission:'prompt',capability:'checking'}}});
  assert.equal(getElement('rallyCameraSetup').hidden,false);
  assert.equal(getElement('rallyEnableCameraButton').disabled,true);
  assert.equal(getElement('rallyCameraContinueManualButton').disabled,false);
  assert.equal(getElement('rallyCameraContinueManualButton').textContent,'USE MANUAL CAMERA');
});

test('camera warnings use a dedicated enable action while non-camera warnings retain Mission controls',()=>{
  const elements=new Map(),getElement=id=>{if(!elements.has(id))elements.set(id,fakeElement());return elements.get(id);};
  renderRally({getElement,escapeHtml:String,model:{
    day:1,online:true,score:0,next:null,distance:null,checkpoints:[],hasHotel:true,
    showCameraSetup:true,cameraReadiness:{permission:'prompt',capability:'setup-required'},
    warnings:[
      {id:'camera',message:'CAMERA SETUP REQUIRED — enable once before riding.'},
      {id:'construction',message:'Construction at the south entrance.'}
    ]
  }});
  const markup=getElement('rallyWarnings').innerHTML;
  const camera=markup.match(/<li data-warning-id="camera">[\s\S]*?<\/li>/)?.[0]||'';
  const construction=markup.match(/<li data-warning-id="construction">[\s\S]*?<\/li>/)?.[0]||'';
  assert.match(camera,/data-camera-action="enable"/);
  assert.match(camera,/>ENABLE CAMERA</);
  for(const action of ['dismiss','10','30','checkpoint'])assert.doesNotMatch(camera,new RegExp(`data-warning-action="${action}"`));
  for(const action of ['dismiss','10','30','checkpoint'])assert.match(construction,new RegExp(`data-warning-action="${action}"`));
  assert.match(construction,/>Dismiss</);assert.match(construction,/>10m</);assert.match(construction,/>30m</);assert.match(construction,/>Next CP</);
});

test('granted and manual-only camera states do not expose stale or suppressible camera actions',()=>{
  const render=model=>{
    const elements=new Map(),getElement=id=>{if(!elements.has(id))elements.set(id,fakeElement());return elements.get(id);};
    renderRally({getElement,escapeHtml:String,model:{day:1,online:true,score:0,next:null,distance:null,checkpoints:[],hasHotel:true,...model}});
    return {markup:getElement('rallyWarnings').innerHTML,hidden:getElement('rallyWarningsSection').hidden};
  };
  const granted=render({showCameraSetup:false,cameraReadiness:{permission:'granted',capability:'ready'},warnings:[]});
  assert.equal(granted.hidden,true);assert.doesNotMatch(granted.markup,/data-warning-id="camera"/);
  for(const manual of [
    render({showCameraSetup:true,cameraReadiness:{permission:'denied',capability:'manual-only'},warnings:[{id:'camera',message:'Manual camera mode.'}]}),
    render({showCameraSetup:false,cameraReadiness:{permission:'unknown',capability:'manual-only'},warnings:[{id:'camera',message:'Manual camera mode.'}]})
  ]){
    assert.match(manual.markup,/data-warning-id="camera"/);
    assert.doesNotMatch(manual.markup,/data-warning-action=/);
    assert.doesNotMatch(manual.markup,/ENABLE CAMERA|Dismiss|10m|30m|Next CP/);
  }
});

test('Day Complete renders compact metrics and persisted backup status',()=>{
  const elements=new Map(),getElement=id=>{if(!elements.has(id))elements.set(id,fakeElement());return elements.get(id);};
  renderRally({getElement,escapeHtml:String,model:{day:1,online:true,score:45,next:null,distance:null,warnings:[],checkpoints:[],hasHotel:true,showDeferredPrompt:true,deferredCount:1,dayComplete:true,nextDay:2,backupStatus:'Photos exported',daySummary:{totalCollected:3,totalDeferred:1,score:20}}});
  assert.equal(getElement('rallyDeferredPrompt').hidden,true);
  assert.equal(getElement('rallyResumeDeferredButton').disabled,true);
  assert.equal(getElement('rallyFinishDayButton').disabled,true);
  assert.equal(getElement('rallyDayComplete').hidden,false);
  assert.equal(getElement('rallyStartNextDay').textContent,'Start Day 2');
  assert.equal(getElement('rallyDayCollected').textContent,3);
  assert.equal(getElement('rallyDayDeferred').textContent,1);
  assert.equal(getElement('rallyDayScore').textContent,20);
  assert.equal(getElement('rallyTotalScore').textContent,45);
  assert.equal(getElement('rallyDayBackupStatus').textContent,'Photos exported');
  assert.equal(getElement('rallyBackupSheetStatus').textContent,'Photos exported');
});

test('Rally controller owns control event wiring through injected actions',()=>{
  const elements=new Map(),getElement=id=>{
    if(!elements.has(id))elements.set(id,fakeElement());
    return elements.get(id);
  };
  let completed=0,deferred=0,mission=0,journal=0,intel=0,onlineHandlers=0;
  const actions=new Proxy({complete:()=>completed++,defer:()=>deferred++,showMission:()=>mission++,setJournalOpen:()=>journal++,setIntelOpen:()=>intel++,render:()=>{}},{get:(target,key)=>target[key]||(()=>{})});
  wireRallyController({getElement,actions,windowTarget:{addEventListener(){onlineHandlers++;}}});
  getElement('rallyCompleteButton').listeners.click();
  getElement('rallyDeferIcon').listeners.click();
  assert.equal(completed,1);
  assert.equal(deferred,1);
  getElement('rallyMissionButton').listeners.click();getElement('rallyTrailIntelButton').listeners.click();getElement('rallyJournalButton').listeners.click();
  assert.deepEqual({mission,journal,intel},{mission:1,journal:1,intel:1});
  assert.equal(typeof getElement('checkpointOrderList').listeners.click,'function');
  assert.equal(onlineHandlers,2);
});

test('Rally controller delegates camera enable directly and preserves generic warning suppression',()=>{
  const elements=new Map(),getElement=id=>{if(!elements.has(id))elements.set(id,fakeElement());return elements.get(id);};
  let enabled=0;const warningCalls=[];
  const actions=new Proxy({enableCamera:()=>enabled++,warning:(id,action)=>warningCalls.push([id,action]),render:()=>{}},{get:(target,key)=>target[key]||(()=>{})});
  wireRallyController({getElement,actions,windowTarget:{addEventListener(){}}});
  const delegated=(id,action,{camera=false}={})=>({target:{closest(selector){
    if(selector==='button[data-camera-action]')return camera?{dataset:{cameraAction:action}}:null;
    if(selector==='button[data-warning-action]')return camera?null:{dataset:{warningAction:action}};
    if(selector==='[data-warning-id]')return {dataset:{warningId:id}};
    return null;
  }}});
  getElement('rallyWarnings').listeners.click(delegated('camera','enable',{camera:true}));
  assert.equal(enabled,1);assert.deepEqual(warningCalls,[]);
  getElement('rallyWarnings').listeners.click(delegated('construction','10'));
  assert.equal(enabled,1);assert.deepEqual(warningCalls,[['construction','10']]);
});

test('Rally day preflight renders each capability state and only its relevant setup action',()=>{
  const elements=new Map(),getElement=id=>{if(!elements.has(id))elements.set(id,fakeElement());return elements.get(id);};
  renderRally({getElement,escapeHtml:String,model:{
    day:1,online:true,score:0,next:null,distance:null,warnings:[],checkpoints:[],hasHotel:true,
    showDayPreflight:true,
    dayPreflight:{
      status:'USER_GESTURE',ready:false,checking:false,resume:false,
      notice:'Resolve available actions before riding, or deliberately continue in degraded mode.',
      capabilities:{
        gps:{status:'READY',detail:'GPS has a trustworthy fix.'},
        camera:{status:'USER_GESTURE',detail:'Tap once before riding.',actionLabel:'ENABLE CAMERA'},
        storage:{status:'ACTION_REQUIRED',detail:'Protect local evidence storage.',actionLabel:'PROTECT STORAGE'},
        offline:{status:'BLOCKED',detail:'Offline app shell is unavailable.'}
      }
    }
  }});
  assert.equal(getElement('rallyDayPreflight').hidden,false);
  assert.equal(getElement('rallyDayPreflightTitle').textContent,'Day 1 readiness');
  assert.equal(getElement('rallyDayPreflightOverall').textContent,'USER GESTURE');
  assert.equal(getElement('rallyDayPreflightOverall').dataset.state,'user-gesture');
  assert.equal(getElement('rallyPreflightGpsState').textContent,'READY');
  assert.equal(getElement('rallyPreflightCameraState').textContent,'USER GESTURE');
  assert.equal(getElement('rallyPreflightCameraDetail').textContent,'Tap once before riding.');
  assert.equal(getElement('rallyPreflightCameraAction').hidden,false);
  assert.equal(getElement('rallyPreflightCameraAction').textContent,'ENABLE CAMERA');
  assert.equal(getElement('rallyPreflightStorageAction').hidden,false);
  assert.equal(getElement('rallyPreflightStorageAction').textContent,'PROTECT STORAGE');
  assert.equal(getElement('rallyPreflightOfflineAction').hidden,true);
  assert.equal(getElement('rallyDayPreflightStart').disabled,true);
  assert.equal(getElement('rallyDayPreflightDegraded').hidden,false);
  assert.equal(getElement('rallyPrimaryCard').hidden,true);
});

test('Rally day preflight clears stale actions and enables a ready resumed day',()=>{
  const elements=new Map(),getElement=id=>{if(!elements.has(id))elements.set(id,fakeElement());return elements.get(id);};
  const base={day:2,online:true,score:10,next:null,distance:null,warnings:[],checkpoints:[],hasHotel:true,showDayPreflight:true};
  renderRally({getElement,escapeHtml:String,model:{...base,dayPreflight:{status:'ACTION_REQUIRED',ready:false,checking:false,resume:true,capabilities:{camera:{status:'ACTION_REQUIRED',actionLabel:'RETRY CAMERA'}}}}});
  assert.equal(getElement('rallyPreflightCameraAction').hidden,false);
  renderRally({getElement,escapeHtml:String,model:{...base,dayPreflight:{
    status:'READY',ready:true,checking:false,resume:true,
    capabilities:Object.fromEntries(['gps','camera','storage','offline'].map(id=>[id,{status:'READY',detail:`${id} ready`}]))
  }}});
  assert.equal(getElement('rallyDayPreflightOverall').textContent,'READY');
  assert.equal(getElement('rallyPreflightCameraAction').hidden,true);
  assert.equal(getElement('rallyDayPreflightStart').disabled,false);
  assert.equal(getElement('rallyDayPreflightStart').textContent,'RESUME DAY');
  assert.equal(getElement('rallyDayPreflightDegraded').hidden,true);
});

test('Rally controller delegates every day-preflight action without generic warning routing',()=>{
  const elements=new Map(),getElement=id=>{if(!elements.has(id))elements.set(id,fakeElement());return elements.get(id);};
  const calls=[];
  const actions=new Proxy({
    enableGps:()=>calls.push('gps'),enableCamera:()=>calls.push('camera'),prepareStorage:()=>calls.push('storage'),
    prepareOffline:()=>calls.push('offline'),startReadyDay:()=>calls.push('start'),continueDegradedDay:()=>calls.push('degraded'),render:()=>{}
  },{get:(target,key)=>target[key]||(()=>{})});
  wireRallyController({getElement,actions,windowTarget:{addEventListener(){}}});
  for(const id of ['rallyPreflightGpsAction','rallyPreflightCameraAction','rallyPreflightStorageAction','rallyPreflightOfflineAction','rallyDayPreflightStart','rallyDayPreflightDegraded'])getElement(id).listeners.click();
  assert.deepEqual(calls,['gps','camera','storage','offline','start','degraded']);
});
