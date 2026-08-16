import assert from 'node:assert/strict';
import test from 'node:test';
import {renderRally} from '../src/ui/rally/presenter.js';
import {wireRallyController} from '../src/ui/rally/controller.js';

const fakeElement=()=>({
  textContent:'',innerHTML:'',disabled:false,hidden:false,value:'',checked:false,listeners:{},
  dataset:{},
  classList:{values:new Set(),toggle(name,enabled){if(enabled)this.values.add(name);else this.values.delete(name);},contains(name){return this.values.has(name);}},
  attributes:{},addEventListener(name,handler){this.listeners[name]=handler;},
  setAttribute(name,value){this.attributes[name]=String(value);},
  querySelector(){return null;}
});

function harness(){
  const elements=new Map(),getElement=id=>{
    if(!elements.has(id))elements.set(id,fakeElement());
    return elements.get(id);
  };
  return {elements,getElement};
}

const objective=(overrides={})=>({
  id:'arch',name:'3.1 THE ARCH',type:'checkpoint',day:3,sequence:1,status:'active',
  notes:'Use the east approach after the cattle guard.',points:21,extreme:true,...overrides
});

const model=(overrides={})=>({
  projectName:'America 250',day:3,online:true,gpsAccuracy:'GPS ±12 ft',elevation:'Elev 4,220 ft',score:71,
  next:objective(),distance:568.4,canNavigate:true,routeIntelligence:'Backbone Route Active',
  objectiveIntel:'Rider 246 passed 4 min ago',warnings:[],checkpoints:[],hasHotel:true,hasPlanned:true,
  ...overrides
});

function compactText(getElement){
  return ['rallyNextName','rallyNextDistance','rallyNavigationGuidance','rallyObjectiveStatus','rallyNavigateButton','rallyCompleteButton','rallyObjectiveDetailsToggle']
    .map(id=>getElement(id).textContent).filter(Boolean).join(' | ');
}

test('compact Mission header renders objective and one distance without redundant status metadata',()=>{
  const {elements,getElement}=harness();
  renderRally({getElement,escapeHtml:String,model:model()});

  assert.equal(getElement('rallyNextName').textContent,'3.1 THE ARCH');
  const distanceOccurrences=[...elements.values()].filter(element=>element.textContent==='568.4 mi').length;
  assert.equal(distanceOccurrences,1,'the formatted objective distance must be presented once');
  assert.match(compactText(getElement),/3\.1 THE ARCH/);
  assert.doesNotMatch(compactText(getElement),/CHECKPOINT|21 points|ACTIVE|Backbone Route Active|sequence|Day 3|type/i);
  assert.equal(getElement('rallyObjectiveDetails').hidden,true);
  assert.equal(getElement('rallyObjectiveDetailsToggle').attributes['aria-expanded'],'false');
  assert.equal(getElement('rallyScore').textContent,71,'the dedicated total score remains authoritative');
});

test('expanded objective details expose notes and collapse back to the compact state',()=>{
  const {getElement}=harness();
  renderRally({getElement,escapeHtml:String,model:model()});
  const actions=new Proxy({render:()=>{}},{get:(target,key)=>target[key]||(()=>{})});
  wireRallyController({getElement,actions,windowTarget:{addEventListener(){}}});
  getElement('rallyObjectiveDetailsToggle').listeners.click();

  assert.equal(getElement('rallyObjectiveDetails').hidden,false);
  assert.equal(getElement('rallyRiderNotesSection').hidden,false);
  assert.equal(getElement('rallyRiderNotes').textContent,'Use the east approach after the cattle guard.');
  assert.equal(getElement('rallyObjectiveDetailsToggle').attributes['aria-expanded'],'true');
  assert.match(getElement('rallyRouteIntelligence').textContent,/Backbone Route Active/,'secondary backbone state may remain discoverable in details');

  getElement('rallyObjectiveDetailsClose').listeners.click();
  assert.equal(getElement('rallyObjectiveDetails').hidden,true);
  assert.equal(getElement('rallyObjectiveDetailsToggle').attributes['aria-expanded'],'false');
});

test('objective switching refreshes the compact identity and distance without retaining old facts',()=>{
  const {getElement}=harness();
  renderRally({getElement,escapeHtml:String,model:model()});
  const actions=new Proxy({render:()=>{}},{get:(target,key)=>target[key]||(()=>{})});
  wireRallyController({getElement,actions,windowTarget:{addEventListener(){}}});
  getElement('rallyObjectiveDetailsToggle').listeners.click();
  assert.equal(getElement('rallyObjectiveDetails').hidden,false);
  renderRally({getElement,escapeHtml:String,model:model({
    next:objective({id:'ridge',name:'3.2 RIDGELINE',sequence:2,points:10,extreme:false}),
    distance:7.25
  })});

  assert.equal(getElement('rallyNextName').textContent,'3.2 RIDGELINE');
  assert.equal(getElement('rallyNextDistance').textContent,'7.3 mi');
  assert.doesNotMatch(compactText(getElement),/THE ARCH|568\.4|10 points|ACTIVE/i);
  assert.equal(getElement('rallyObjectiveDetails').hidden,true);
});

test('controller keeps navigation, COMPLETE, and details actions independently wired',()=>{
  const {getElement}=harness();
  let navigated=0,completed=0;
  const actions=new Proxy({
    navigate:()=>navigated++,complete:()=>completed++,render:()=>{}
  },{get:(target,key)=>target[key]||(()=>{})});

  wireRallyController({getElement,actions,windowTarget:{addEventListener(){}}});
  getElement('rallyNavigateButton').listeners.click();
  getElement('rallyCompleteButton').listeners.click();
  getElement('rallyObjectiveDetailsToggle').listeners.click();
  getElement('rallyObjectiveDetailsClose').listeners.click();

  assert.deepEqual({navigated,completed},{navigated:1,completed:1});
  assert.equal(getElement('rallyObjectiveDetails').hidden,true);
  assert.equal(getElement('rallyObjectiveDetailsToggle').attributes['aria-expanded'],'false');
});
