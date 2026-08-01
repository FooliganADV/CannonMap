import test from 'node:test';
import assert from 'node:assert/strict';
import {createEventBus} from '../src/core/event-bus.js';
import {DuplicateProjectError} from '../src/domain/projects/errors.js';
import {createProjectLifecycleManager} from '../src/application/project-lifecycle-manager.js';
import {createProjectRepositoryScope} from '../src/application/project-repository-scope.js';

function harness({
  legacy={id:'p1',name:'One',features:[]},transition=null,activeId=null,
  failLegacyOnce=false,failDeletionOnce=false,projectOverrides=[],onFlush,onLegacySave
}={}){
  const projects=new Map(),events=[],steps=[],scopes=new Map();
  if(legacy)projects.set(legacy.projectId||legacy.id,{...legacy,projectId:legacy.projectId||legacy.id});
  for(const project of [
    {projectId:'p2',id:'p2',name:'Two',features:[]},
    {projectId:'p3',id:'p3',name:'Three',features:[]},...projectOverrides
  ])projects.set(project.projectId,project);
  let current=legacy&&structuredClone(legacy),storedTransition=transition,storedActive=activeId,sequence=0;
  const normalize=project=>{
    const id=project.projectId||project.id||`p${++sequence}`;
    return {...project,id,projectId:id,updatedAt:`2026-07-30T12:00:0${sequence}.000Z`};
  };
  const projectRepository={
    async create(project){
      const saved=normalize(project);
      if(projects.has(saved.projectId))throw new DuplicateProjectError(saved.projectId);
      projects.set(saved.projectId,saved);return saved;
    },
    async save(project){const saved=normalize(project);projects.set(saved.projectId,saved);return saved;},
    async get(id){return projects.get(String(id))||null;},
    async list(){return [...projects.values()];},
    async archive(id,at){
      const existing=projects.get(String(id));
      if(!existing)throw new Error(`Project not found: ${id}`);
      const archived={...existing,lifecycleStatus:'archived',archivedAt:at};
      projects.set(String(id),archived);return archived;
    }
  };
  const projectDeletionRepository={
    async deleteProject(id){
      steps.push(`delete:${id}`);
      if(failDeletionOnce){failDeletionOnce=false;throw new Error('interrupted atomic delete');}
      return projects.delete(String(id));
    }
  };
  const lifecycleRepository={
    async getActiveProjectId(){return storedActive;},
    async getTransition(){return storedTransition;},
    async beginTransition(value){storedTransition=structuredClone(value);},
    async updateTransition(value){storedTransition=structuredClone(value);},
    async completeTransition(id){storedActive=id;storedTransition=null;},
    async clearActiveProject(){storedActive=null;storedTransition=null;current=null;steps.push('active:clear');},
    async clearTransition(){storedTransition=null;}
  };
  const legacyCurrentRepository={
    async get(){return current&&structuredClone(current);},
    async save(project){
      if(failLegacyOnce){failLegacyOnce=false;throw new Error('interrupted legacy write');}
      await onLegacySave?.(project);
      current=structuredClone(project);steps.push(`legacy:${project.projectId}`);
    },
    async clear(){current=null;steps.push('legacy:clear');}
  };
  const journalRepository={
    async appendEvent(event){steps.push(`write:${event.projectId}`);return event;},
    async appendEvents(events){return events;},async getEvent(){return null;},
    async getEventsByProject(){return [];},async queryEvents(){return [];}
  };
  const scopeFactory=async id=>{
    const scope=createProjectRepositoryScope({
      projectId:id,journalRepository,
      hooks:{
        async flushPendingWrites(){steps.push(`flush:${id}`);await onFlush?.(id);},
        async commitJournal(){steps.push(`journal:${id}`);},
        async commitAnalytics(){steps.push(`analytics:${id}`);},
        async commitSearch(){steps.push(`search:${id}`);},
        async rebuildCaches(){steps.push(`rebuild:${id}`);},
        async close(){steps.push(`close:${id}`);}
      }
    });
    scopes.set(id,scope);return scope;
  };
  const eventBus=createEventBus({onError:error=>{throw error;}});
  for(const type of ['projectCreated','projectOpened','projectClosed','projectArchived','projectDeleted','activeProjectChanged']){
    eventBus.subscribe(type,event=>events.push(event));
  }
  const clock={value:0,iso(){return `2026-07-30T12:00:${String(this.value++).padStart(2,'0')}.000Z`;}};
  const manager=createProjectLifecycleManager({
    projectRepository,projectDeletionRepository,lifecycleRepository,legacyCurrentRepository,
    scopeFactory,eventBus,clock,createId:()=>`id-${++sequence}`
  });
  return {
    manager,projects,events,steps,scopes,
    state:()=>({active:storedActive,transition:storedTransition,current})
  };
}

test('initialization imports legacy current once and exposes an open scoped repository',async()=>{
  const setup=harness();
  const project=await setup.manager.initialize();
  assert.equal(project.projectId,'p1');
  assert.equal(setup.manager.getActiveProject().projectId,'p1');
  assert.equal(setup.manager.getActiveRepositories().projectId,'p1');
  assert.equal(setup.manager.getActiveRepositories().getState(),'open');
  assert.equal(setup.state().active,'p1');
  await setup.manager.initialize();
  assert.equal(setup.steps.filter(step=>step==='rebuild:p1').length,1);
});

test('active Project save updates the authoritative record and compatibility mirror',async()=>{
  const setup=harness();
  await setup.manager.initialize();
  const saved=await setup.manager.saveActiveProject({...setup.manager.getActiveProject(),name:'Mission Project'});
  assert.equal(saved.name,'Mission Project');
  assert.equal(setup.projects.get('p1').name,'Mission Project');
  assert.equal(setup.state().current.name,'Mission Project');
  assert.equal(setup.manager.getActiveProject().name,'Mission Project');
  await assert.rejects(()=>setup.manager.saveActiveProject({projectId:'p2',name:'Wrong'}),/Only the active Project/);
});

test('rapid switches serialize complete drain/commit/close/open pipelines',async()=>{
  const setup=harness();
  await setup.manager.initialize();
  await Promise.all([setup.manager.openProject('p2'),setup.manager.openProject('p3')]);
  assert.equal(setup.manager.getActiveProject().projectId,'p3');
  assert.deepEqual(setup.steps,[
    'rebuild:p1','flush:p1','journal:p1','analytics:p1','search:p1','close:p1',
    'rebuild:p2','legacy:p2','flush:p2','journal:p2','analytics:p2','search:p2','close:p2',
    'rebuild:p3','legacy:p3'
  ]);
});

test('retained consumers are rejected as soon as draining begins while controlled commits finish',async()=>{
  let release,entered;
  const enteredPromise=new Promise(resolve=>{entered=resolve;});
  const releasePromise=new Promise(resolve=>{release=resolve;});
  const setup=harness({onFlush:async id=>{if(id==='p1'){entered();await releasePromise;}}});
  await setup.manager.initialize();
  const retained=setup.manager.getActiveRepositories();
  const switching=setup.manager.openProject('p2');
  await enteredPromise;
  assert.equal(retained.getState(),'draining');
  assert.throws(()=>retained.journal.appendEvent({eventId:'late'}),/scope is draining/);
  assert.equal(setup.scopes.get('p2'),undefined);
  release();await switching;
  assert.equal(retained.getState(),'closed');
  assert.equal(setup.manager.getActiveRepositories().getState(),'open');
  assert.deepEqual(setup.steps.slice(1,6),['flush:p1','journal:p1','analytics:p1','search:p1','close:p1']);
});

test('failed switch closes the opening scope and deterministically restores the prior project',async()=>{
  const setup=harness({failLegacyOnce:true});
  await setup.manager.initialize();
  const retained=setup.manager.getActiveRepositories();
  await assert.rejects(()=>setup.manager.openProject('p2'),/interrupted legacy write/);
  assert.equal(retained.getState(),'closed');
  assert.equal(setup.scopes.get('p2').repositories.getState(),'closed');
  assert.equal(setup.manager.getActiveProject().projectId,'p1');
  assert.equal(setup.manager.getActiveRepositories().getState(),'open');
  assert.equal(setup.state().transition,null);
});

test('target scope remains non-writable until the active switch commits',async()=>{
  let release,entered;
  const enteredPromise=new Promise(resolve=>{entered=resolve;});
  const releasePromise=new Promise(resolve=>{release=resolve;});
  const setup=harness({onLegacySave:async project=>{
    if(project.projectId==='p2'){entered();await releasePromise;}
  }});
  await setup.manager.initialize();
  const switching=setup.manager.openProject('p2');
  await enteredPromise;
  const target=setup.scopes.get('p2').repositories;
  assert.equal(target.getState(),'opening');
  assert.throws(()=>target.journal.appendEvent({eventId:'early'}),/scope is opening/);
  assert.equal(setup.manager.getActiveRepositories(),null);
  release();await switching;
  assert.equal(target.getState(),'open');
  await target.journal.appendEvent({eventId:'after-commit'});
  assert.equal(setup.steps.at(-1),'write:p2');
});

test('recovery completes a committed switch and rolls back an earlier interruption',async()=>{
  const committed=harness({
    legacy:{id:'p2',projectId:'p2',name:'Two',features:[]},activeId:'p1',
    transition:{fromProjectId:'p1',toProjectId:'p2',stage:'committingLegacy'}
  });
  await committed.manager.initialize();
  assert.equal(committed.manager.getActiveProject().projectId,'p2');

  const interrupted=harness({
    legacy:{id:'p1',projectId:'p1',name:'One',features:[]},activeId:'p1',
    transition:{fromProjectId:'p1',toProjectId:'p2',stage:'opening'}
  });
  await interrupted.manager.initialize();
  assert.equal(interrupted.manager.getActiveProject().projectId,'p1');
});

test('create is unique under concurrent duplicate attempts while save still updates',async()=>{
  const setup=harness();
  await setup.manager.initialize();
  const outcomes=await Promise.allSettled([
    setup.manager.createProject({id:'p4',name:'First',features:[]}),
    setup.manager.createProject({id:'p4',name:'Second',features:[]})
  ]);
  assert.deepEqual(outcomes.map(result=>result.status),['fulfilled','rejected']);
  assert.ok(outcomes[1].reason instanceof DuplicateProjectError);
  assert.equal(outcomes[1].reason.code,'PROJECT_ALREADY_EXISTS');
  assert.equal(setup.projects.get('p4').name,'First');
  assert.equal((await setup.manager.renameProject('p4','Updated')).name,'Updated');
});

test('missing durable active project clears lifecycle and stale legacy state idempotently',async()=>{
  const setup=harness({legacy:{id:'missing',name:'Stale',features:[]},activeId:'missing'});
  setup.projects.delete('missing');
  assert.equal(await setup.manager.initialize(),null);
  assert.deepEqual(setup.state(),{active:null,transition:null,current:null});
  assert.equal(await setup.manager.initialize(),null);
  assert.equal(setup.projects.has('p2'),true);
});

test('archived durable active project is never reopened and valid active project is preserved',async()=>{
  const archived=harness({
    legacy:{id:'p1',name:'One',features:[]},activeId:'p1',
    projectOverrides:[{projectId:'p1',id:'p1',name:'One',features:[],lifecycleStatus:'archived'}]
  });
  assert.equal(await archived.manager.initialize(),null);
  assert.deepEqual(archived.state(),{active:null,transition:null,current:null});

  const valid=harness({legacy:{id:'stale',name:'Stale',features:[]},activeId:'p2'});
  await valid.manager.initialize();
  assert.equal(valid.manager.getActiveProject().projectId,'p2');
  assert.equal(valid.state().current.projectId,'p2');
});

test('active project deletion drains first and publishes deterministic lifecycle events',async()=>{
  const setup=harness();
  await setup.manager.initialize();
  assert.equal(await setup.manager.deleteProject('p1'),true);
  assert.equal(setup.projects.has('p1'),false);
  assert.equal(setup.manager.getActiveProject(),null);
  assert.deepEqual(setup.events.map(event=>event.type),[
    'projectClosed','activeProjectChanged','projectDeleted'
  ]);
  assert.ok(setup.steps.indexOf('close:p1')<setup.steps.indexOf('delete:p1'));
});

test('failed active deletion reopens a fresh writable scope and preserves the Project',async()=>{
  const setup=harness({failDeletionOnce:true});
  await setup.manager.initialize();
  const retained=setup.manager.getActiveRepositories();
  await assert.rejects(()=>setup.manager.deleteProject('p1'),/interrupted atomic delete/);
  assert.equal(retained.getState(),'closed');
  assert.equal(setup.projects.has('p1'),true);
  assert.equal(setup.manager.getActiveProject().projectId,'p1');
  assert.equal(setup.manager.getActiveRepositories().getState(),'open');
  await setup.manager.getActiveRepositories().journal.appendEvent({eventId:'after-recovery'});
  assert.equal(setup.steps.at(-1),'write:p1');
});

test('Analytics lookup remains project-constrained',async()=>{
  let receivedProjectId;
  const analytics={async findActiveSession(_eventId,projectId){receivedProjectId=projectId;return {projectId};}};
  const scope=createProjectRepositoryScope({projectId:'p1',analyticsRepository:analytics});
  scope.lifecycle.activate();
  assert.deepEqual(await scope.repositories.analytics.findActiveSession('r1'),{projectId:'p1'});
  assert.equal(receivedProjectId,'p1');
});
