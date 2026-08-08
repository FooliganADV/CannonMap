import assert from 'node:assert/strict';
import test from 'node:test';
import {renderRally} from '../src/ui/rally/presenter.js';
import {wireRallyController} from '../src/ui/rally/controller.js';

const fakeElement=()=>({
  textContent:'',innerHTML:'',disabled:false,hidden:false,value:'',checked:false,listeners:{},
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
    day:1,online:false,gpsStatus:'GPS off',score:31,
    next:{id:'cp',name:'Extreme Checkpoint',notes:'Approach from the north.',extreme:true,points:21,status:'next'},distance:4.25,
    hotelLabel:'Hotel 12 mi',feedAge:'Feed Never',warnings:['Construction at the south entrance.'],
    hasDeferred:true,hasHotel:true,hotelBailoutActive:false,autoComplete:true,arrivalRadius:500,maxAccuracy:200,
    checkpoints:[{id:'cp',name:'Extreme Checkpoint',extreme:true,status:'next'}]
  }});
  assert.equal(getElement('rallyDay').textContent,'DAY 1');
  assert.equal(getElement('rallyScore').textContent,31);
  assert.equal(getElement('rallyNextDistance').textContent,'4.3 mi away');
  assert.equal(getElement('rallyRiderNotes').textContent,'Approach from the north.');
  assert.match(getElement('rallyWarnings').innerHTML,/Construction/);
  assert.equal(getElement('rallyNextButton').hidden,true);
  assert.match(getElement('checkpointOrderList').innerHTML,/21-point extreme/);
  assert.equal(getElement('rallyCompleteButton').disabled,false);
});

test('Rally controller owns control event wiring through injected actions',()=>{
  const elements=new Map(),getElement=id=>{
    if(!elements.has(id))elements.set(id,fakeElement());
    return elements.get(id);
  };
  let completed=0,deferred=0,onlineHandlers=0;
  const actions=new Proxy({complete:()=>completed++,defer:()=>deferred++,render:()=>{}},{get:(target,key)=>target[key]||(()=>{})});
  wireRallyController({getElement,actions,windowTarget:{addEventListener(){onlineHandlers++;}}});
  getElement('rallyCompleteButton').listeners.click();
  getElement('rallyDeferIcon').listeners.click();
  assert.equal(completed,1);
  assert.equal(deferred,1);
  assert.equal(typeof getElement('checkpointOrderList').listeners.click,'function');
  assert.equal(onlineHandlers,2);
});
