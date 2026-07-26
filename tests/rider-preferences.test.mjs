import assert from 'node:assert/strict';
import test from 'node:test';
import preferences from '../rider-preferences.js';

const memoryStorage=(seed={})=>{
  const values=new Map(Object.entries(seed));
  return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
};
const storeWith=seed=>{
  const storage=memoryStorage(seed===undefined?{}:{[preferences.STORAGE_KEY]:seed});
  return {storage,store:preferences.createRiderPreferenceStore({storage})};
};

test('defaults live markers on',()=>assert.equal(storeWith().store.get('60','7').markerVisible,true));
test('defaults breadcrumbs off',()=>assert.equal(storeWith().store.get('60','7').breadcrumbVisible,false));
test('scopes preferences by event',()=>{
  const {store}=storeWith();store.update('60','7',{markerVisible:false});
  assert.equal(store.get('61','7').markerVisible,true);
});
test('scopes preferences by competitor',()=>{
  const {store}=storeWith();store.update('60','7',{selected:true});
  assert.equal(store.get('60','8').selected,false);
});
test('persists and restores preferences',()=>{
  const {storage,store}=storeWith();store.update('60','7',{markerVisible:false,breadcrumbVisible:true});
  const restored=preferences.createRiderPreferenceStore({storage}).get('60','7');
  assert.deepEqual(restored,{markerVisible:false,breadcrumbVisible:true,selected:false});
});
test('new riders receive defaults without changing existing riders',()=>{
  const {store}=storeWith();store.update('60','7',{markerVisible:false});store.ensure('60',['7','8']);
  assert.equal(store.get('60','7').markerVisible,false);assert.deepEqual(store.get('60','8'),preferences.DEFAULT_PREFERENCE);
});
test('removed riders remain available for later restoration',()=>{
  const {store}=storeWith();store.update('60','7',{selected:true});store.ensure('60',['8']);
  assert.equal(store.get('60','7').selected,true);
});
test('hide all trails preserves marker and selection settings',()=>{
  const {store}=storeWith();store.update('60','7',{markerVisible:false,breadcrumbVisible:true,selected:true});
  store.hideAllTrails('60',['7']);
  assert.deepEqual(store.get('60','7'),{markerVisible:false,breadcrumbVisible:false,selected:true});
});
test('selected-only shows selected trails and hides all others',()=>{
  const {store}=storeWith();store.update('60','7',{selected:true});store.update('60','8',{breadcrumbVisible:true});
  store.showSelectedTrailsOnly('60',['7','8']);
  assert.equal(store.get('60','7').breadcrumbVisible,true);assert.equal(store.get('60','8').breadcrumbVisible,false);
});
test('trail bulk actions do not change marker visibility',()=>{
  const {store}=storeWith();store.update('60','7',{markerVisible:false,selected:true});
  store.showSelectedTrailsOnly('60',['7']);assert.equal(store.get('60','7').markerVisible,false);
});
test('malformed stored data resets safely',()=>{
  const {store}=storeWith('{nope');assert.deepEqual(store.snapshot(),{version:1,events:{}});
});
test('unversioned storage migrates and unknown versions reset',()=>{
  const migrated=storeWith(JSON.stringify({'60':{'7':{markerVisible:false}}})).store;
  assert.deepEqual(migrated.get('60','7'),{markerVisible:false,breadcrumbVisible:false,selected:false});
  const reset=storeWith(JSON.stringify({version:99,events:{'60':{'7':{markerVisible:false}}}})).store;
  assert.equal(reset.get('60','7').markerVisible,true);
});
