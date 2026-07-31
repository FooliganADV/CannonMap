import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProjectSearchIndex,compareSearchResults,createSearchDocument,
  normalizeSearchText,partialTerms,rankSearchDocument
} from '../src/domain/search/index.js';
import {createSearchService} from '../src/application/search-service.js';

test('normalization and partial terms support stable case, diacritic, prefix, and infix matching',()=>{
  assert.equal(normalizeSearchText('Cañon—Balcony!'),'canon balcony');
  const terms=partialTerms('Balcony');
  assert.equal(terms.includes('bal'),true);
  assert.equal(terms.includes('lco'),true);
  assert.equal(terms.includes('con'),true);
  assert.ok(terms.length<20);
});

test('builds compact source-reference projections for every required source family',()=>{
  const project={
    projectId:'project-1',name:'America 250',updatedAt:'2026-07-30T12:00:00Z',
    features:[
      {id:'route-1',type:'route',name:'Mountain route'},
      {id:'track-1',type:'track',name:'Dirt track'},
      {id:'cp-1',type:'checkpoint',name:'Balcony Arch'},
      {id:'wp-1',type:'waypoint',name:'Fuel'},
      {id:'hotel-1',type:'hotel',name:'Finish Hotel'},
      {id:'location-1',type:'location',name:'Moab'}
    ],
    notes:[{id:'note-1',title:'Rider note',text:'Loose gravel'}]
  };
  const journalEvents=[{
    eventId:'event-1',projectId:'project-1',eventType:'photo_added',
    title:'Arch photo',summary:'Taken at sunset',metadata:{},references:{checkpointId:'cp-1'},
    attachments:{photoIds:['photo-1']},timestamp:'2026-07-30T20:00:00Z',createdAt:'2026-07-30T20:00:01Z'
  }];
  const index=buildProjectSearchIndex({project,journalEvents});
  assert.deepEqual(new Set(index.documents.map(document=>document.sourceType)),new Set([
    'project','route','track','checkpoint','waypoint','hotel','location',
    'rider_note','journal_event','media_reference'
  ]));
  assert.equal(index.documents.every(document=>!('sourceRecord' in document)),true);
  assert.equal(index.revision,buildProjectSearchIndex({project,journalEvents}).revision);
});

test('ranking is deterministic with source priority and identity tie breakers',()=>{
  const documents=[
    createSearchDocument({projectId:'p',sourceType:'route',sourceId:'b',title:'Balcony Road'}),
    createSearchDocument({projectId:'p',sourceType:'checkpoint',sourceId:'z',title:'Balcony Road'}),
    createSearchDocument({projectId:'p',sourceType:'checkpoint',sourceId:'a',title:'Balcony Road'})
  ];
  const ranked=documents.map(document=>rankSearchDocument(document,'balc')).sort(compareSearchResults);
  assert.deepEqual(ranked.map(item=>`${item.sourceType}:${item.sourceId}`),[
    'checkpoint:a','checkpoint:z','route:b'
  ]);
});

test('service defaults to project scope, permits explicit all-project search, and reuses fresh revisions',async()=>{
  const stored=new Map(),states=new Map();
  const repository={
    async replaceProjectIndex(index){
      stored.set(index.projectId,index.documents);states.set(index.projectId,{
        projectId:index.projectId,revision:index.revision,indexVersion:index.indexVersion,status:'ready'
      });
      return {projectId:index.projectId,revision:index.revision,documentCount:index.documents.length};
    },
    async getIndexState(projectId){return states.get(projectId)||null;},
    async findCandidates({terms,projectId,allProjects}){
      return [...stored].flatMap(([id,documents])=>allProjects||id===projectId?documents:[])
        .filter(document=>terms.every(term=>document.terms.includes(term)));
    },
    async listIndexStates(){return [...states.values()];},
    async deleteProjectIndex(projectId){stored.delete(projectId);states.delete(projectId);return 1;}
  };
  const service=createSearchService({repository,clock:{iso:()=> '2026-07-30T12:00:00Z'}});
  const first={projectId:'p1',name:'Balcony Rally',features:[]};
  const second={projectId:'p2',name:'Balcony Tour',features:[]};
  await service.rebuildProject({project:first});await service.rebuildProject({project:second});
  assert.deepEqual((await service.search('lcon',{projectId:'p1'})).map(item=>item.projectId),['p1']);
  assert.deepEqual((await service.search('lcon',{allProjects:true})).map(item=>item.projectId),['p1','p2']);
  assert.equal((await service.ensureProjectIndex({project:first})).reused,true);
  await assert.rejects(()=>service.search('balc'),/projectId/);
});
