import assert from 'node:assert/strict';
import test from 'node:test';
import {renderRally} from '../src/ui/rally/presenter.js';
import {wireRallyController} from '../src/ui/rally/controller.js';

const fakeElement=()=>({
  textContent:'',innerHTML:'',disabled:false,hidden:false,value:'',checked:false,listeners:{},
  classList:{values:new Set(),toggle(name,enabled){if(enabled)this.values.add(name);else this.values.delete(name);}},
  attributes:{},setAttribute(name,value){this.attributes[name]=String(value);},
  addEventListener(name,handler){this.listeners[name]=handler;}
});

test('Rally presenter keeps only execution details and centralizes checkpoint visuals',()=>{
  const elements=new Map(),getElement=id=>{
    if(!elements.has(id))elements.set(id,fakeElement());
    return elements.get(id);
  };
  renderRally({getElement,escapeHtml:value=>String(value),model:{
    gpsStatus:'GPS off',
    next:{id:'cp',name:'5.16 Balcony Arch',notes:'Photograph the formation from the marked turnout.',extreme:true,points:21,status:'next'},distance:4.25,
    hotelLabel:'Hotel 12 mi',feedAge:'Feed Never',
    hasDeferred:true,hasHotel:true,hotelBailoutActive:false,autoComplete:true,arrivalRadius:500,maxAccuracy:200,
    checkpoints:[{id:'cp',name:'5.16 Balcony Arch',notes:'Photograph the formation from the marked turnout.',extreme:true,status:'next'}]
  }});
  assert.equal(getElement('rallyDay').textContent,'');
  assert.equal(getElement('rallyNextType').textContent,'NEXT CHECKPOINT');
  assert.equal(getElement('rallyNextName').textContent,'5.16 Balcony Arch');
  assert.equal(getElement('rallyNextPoints').textContent,'21 points');
  assert.equal(getElement('rallyNextHint').textContent,'Photograph the formation from the marked turnout.');
  assert.equal(getElement('rallyPrimaryCard').classList.values.has('is-extreme'),true);
  assert.match(getElement('checkpointOrderList').innerHTML,/Photograph the formation/);
  assert.equal(getElement('rallyCompleteButton').disabled,false);
});

test('Rally controller owns control event wiring through injected actions',()=>{
  const elements=new Map(),getElement=id=>{
    if(!elements.has(id))elements.set(id,fakeElement());
    return elements.get(id);
  };
  let completed=0,onlineHandlers=0;
  const actions=new Proxy({complete:()=>completed++,render:()=>{}},{get:(target,key)=>target[key]||(()=>{})});
  wireRallyController({getElement,actions,windowTarget:{addEventListener(){onlineHandlers++;}}});
  getElement('rallyCompleteButton').listeners.click();
  assert.equal(completed,1);
  assert.equal(typeof getElement('checkpointOrderList').listeners.click,'function');
  assert.equal(onlineHandlers,2);
});
