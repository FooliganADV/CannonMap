import assert from 'node:assert/strict';
import test from 'node:test';
import {createLayerRegistry} from '../src/ui/map/layer-registry.js';
import {createMapEngine,MAP_LAYER_TYPES} from '../src/ui/map/map-engine.js';

function fakeGroup(){
  const layers=new Set();
  return {
    layers,
    addTo(map){map.groups.push(this);return this;},
    addLayer(layer){layers.add(layer);return this;},
    removeLayer(layer){layers.delete(layer);return this;},
    clearLayers(){layers.clear();return this;},
    getLayers(){return [...layers];},
    eachLayer(callback){layers.forEach(callback);},
    getBounds(){return {isValid:()=>layers.size>0};}
  };
}

function fakeMap(){
  return {
    groups:[],
    removed:[],
    handlers:{},
    setView(){return this;},
    on(name,handler){this.handlers[name]=handler;return this;},
    hasLayer(layer){return this.groups.includes(layer);},
    removeLayer(layer){this.removed.push(layer);return this;},
    fitBounds(){return this;},
    remove(){this.wasRemoved=true;}
  };
}

test('layer registry incrementally reconciles 500 keyed entities',()=>{
  const map=fakeMap(),L={featureGroup:fakeGroup};
  const registry=createLayerRegistry({map,L,layerTypes:['competitors']});
  let created=0;
  const create=item=>({id:item.id,revision:item.revision,created:++created});
  const initial=Array.from({length:500},(_,id)=>({id:`rider-${id}`,revision:1}));
  const first=registry.reconcile('competitors',initial,{key:item=>item.id,fingerprint:item=>item.revision,create});
  assert.equal(first.size,500);
  assert.equal(created,500);

  const stable=registry.get('competitors','rider-250');
  registry.reconcile('competitors',initial,{key:item=>item.id,fingerprint:item=>item.revision,create});
  assert.equal(created,500);
  assert.equal(registry.get('competitors','rider-250'),stable);

  const changed=initial.map(item=>item.id==='rider-250'?{...item,revision:2}:item);
  registry.reconcile('competitors',changed,{key:item=>item.id,fingerprint:item=>item.revision,create});
  assert.equal(created,501);
  assert.notEqual(registry.get('competitors','rider-250'),stable);

  registry.reconcile('competitors',changed.slice(0,100),{key:item=>item.id,fingerprint:item=>item.revision,create});
  assert.equal(registry.count('competitors'),100);
  assert.equal(registry.group('competitors').getLayers().length,100);
});

test('layer registry rejects duplicate entity keys and clears ownership',()=>{
  const map=fakeMap(),registry=createLayerRegistry({map,L:{featureGroup:fakeGroup}});
  assert.throws(()=>registry.reconcile('features',[{id:'same'},{id:'same'}],{
    key:item=>item.id,create:item=>item
  }),/Duplicate layer key/);
  registry.clear('features');
  assert.equal(registry.count('features'),0);
  registry.destroy();
  assert.equal(map.removed.length,1);
});

test('map engine owns one map, base layers, and the complete layer registry',()=>{
  const map=fakeMap(),tileLayers=[],controls=[];
  const L={
    map(container,options){map.container=container;map.options=options;return map;},
    tileLayer(url,options){
      const layer={url,options,addTo(target){target.baseLayer=this;return this;}};
      tileLayers.push(layer);return layer;
    },
    featureGroup:fakeGroup,
    latLngBounds(){return {extend(){},isValid:()=>false};},
    control:{layers(base,overlays,options){
      const control={base,overlays,options,addTo(){controls.push(this);return this;}};
      return control;
    }}
  };
  let selected='';
  const engine=createMapEngine({L,container:'map',preferredBaseLayer:'Satellite',onBaseLayerChange:name=>selected=name});
  assert.equal(engine.map,map);
  assert.equal(map.container,'map');
  assert.equal(map.options.preferCanvas,true);
  assert.equal(map.groups.length,MAP_LAYER_TYPES.length);
  assert.equal(tileLayers.length,5);
  assert.equal(map.baseLayer,engine.baseLayers.Satellite);
  assert.equal(controls.length,1);
  map.handlers.baselayerchange({name:'Topographic'});
  assert.equal(selected,'Topographic');
});
