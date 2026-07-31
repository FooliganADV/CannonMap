import test from 'node:test';
import assert from 'node:assert/strict';
import {createEventBus} from '../src/core/event-bus.js';
import {createProjectLifecycleManager} from '../src/application/project-lifecycle-manager.js';
import {createProjectRepositoryScope} from '../src/application/project-repository-scope.js';

function harness({
  legacy={id:'p1',name:'One',features:[]},transition=null,activeId=null,failLegacyOnce=false
}={}){
  const projects=new Map(),events=[],steps=[],scopes=new Map();
  if(legacy)projects.set(legacy.projectId||legacy.id,{...legacy,projectId:legacy.projectId||legacy.id});
  for(const project of [
    {projectId:'p2',id:'p2',name:'Two',features:[]},
    {projectId:'p3',id:'p3',name:'Three',features:[]}
  ])projects.set(project.projectId,project);
  let current=legacy&&structuredClone(legacy),storedTransition=transition,storedActive=activeId,sequence=0;
  const projectRepository={
    async save(project){
      const id=project.projectId||project.id||`p${++sequence}`;
      const saved={...project,id,projectId:id,updatedAt:`2026-07-30T12:00:0${sequence}.000Z`};
      projects.set(id,saved);return saved;
    },
    async get(id){return projects.get(String(id))||null;},
    async list(){return [...projects.values()];},
    async archive(id,at){
      const archived={...projects.get(String(id)),lifecycleStatus:'archived',archivedAt:at};
      projects.set(String(id),archived);return archived;
    },
    async delete(id){return projects.delete(String(id));}
  };
  const lifecycleRepository={
    async getActiveProjectId(){return storedActive;},
    async getTransition(){return storedTransition;},
    async beginTransition(value){storedTransition=structuredClone(value);},
    async updateTransition(value){storedTransition=structuredClone(value);},
    async completeTransition(id){storedActive=id;storedTransition=null;},
    async clearTransition(){storedTransition=null;}
  };
  const legacyCurrentRepository={
    async get(){return current&&structuredClone(current);},
    async save(project){
      if(failLegacyOnce){failLegacyOnce=false;throw new Error('interrupted legacy write');}
      current=structuredClone(project);steps.push(`legacy:${project.projectId}`);
    },
    async clear(){
      current=null;steps.push('legacy:clear');
    }
  };
  const scopeFactory=async id=>{
    const scope={
      projectId:id,closed:false,
      async flushPendingWrites(){steps.push(`flush:${id}`);},
      async commitJournal(){steps.push(`journal:${id}`);},
      async commitAnalytics(){steps.push(`analytics:${id}`);},
      async commitSearch(){steps.push(`search:${id}`);},
      async rebuildCaches(){steps.push(`rebuild:${id}`);},
      async destroy(){steps.push(`destroy:${id}`);},
      async close(){this.closed=true;steps.push(`close:${id}`);}
    };
    scopes.set(id,scope);return scope;
  };
  const eventBus=createEventBus({onError:error=>{throw error;}});
  for(const type of ['projectCreated','projectOpened','projectClosed','projectArchived','projectDeleted','activeProjectChanged']){
    eventBus.subscribe(type,event=>events.push(event));
  }
  const clock={value:0,iso(){return `2026-07-30T12:00:${String(this.value++).padStart(2,'0')}.000Z`;}};
  const manager=createProjectLifecycleManager({
    projectRepository,lifecycleRepository,legacyCurrentRepository,scopeFactory,eventBus,clock,
    createId:()=>`id-${++sequence}`
  });
  return {
    manager,projects,events,steps,scopes,
    state:()=>({active:storedActive,transition:storedTransition,current})
  };
}

test('initialization imports legacy current once and exposes it through the manager',async()=>{
  const setup=harness();
  const project=await setup.manager.initialize();
  assert.equal(project.projectId,'p1');
  assert.equal(setup.manager.getActiveProject().projectId,'p1');
  assert.equal(setup.manager.getActiveRepositories().projectId,'p1');
  assert.equal(setup.state().active,'p1');
});

test('rapid switches serialize complete flush/commit/close/open pipelines',async()=>{
  const setup=harness();
  await setup.manager.initialize();
  await Promise.all([setup.manager.openProject('p2'),setup.manager.openProject('p3')]);
  assert.equal(setup.manager.getActiveProject().projectId,'p3');
  assert.deepEqual(setup.steps,[
    'rebuild:p1','flush:p1','journal:p1','analytics:p1','search:p1','close:p1',
    'rebuild:p2','legacy:p2','flush:p2','journal:p2','analytics:p2','search:p2','close:p2',
    'rebuild:p3','legacy:p3'
  ]);
  assert.deepEqual(setup.events.map(event=>event.type),[
    'projectClosed','projectOpened','activeProjectChanged',
    'projectClosed','projectOpened','activeProjectChanged'
  ]);
});

test('recovery completes a legacy-committed switch and rolls back an earlier interruption',async()=>{
  const committed=harness({
    legacy:{id:'p2',projectId:'p2',name:'Two',features:[]},activeId:'p1',
    transition:{fromProjectId:'p1',toProjectId:'p2',stage:'committingLegacy'}
  });
  await committed.manager.initialize();
  assert.equal(committed.manager.getActiveProject().projectId,'p2');
  assert.equal(committed.state().transition,null);

  const interrupted=harness({
    legacy:{id:'p1',projectId:'p1',name:'One',features:[]},activeId:'p1',
    transition:{fromProjectId:'p1',toProjectId:'p2',stage:'opening'}
  });
  await interrupted.manager.initialize();
  assert.equal(interrupted.manager.getActiveProject().projectId,'p1');
  assert.equal(interrupted.state().transition,null);
});

test('a failed live transition recovers on the next manager operation without reload',async()=>{
  const setup=harness({failLegacyOnce:true});
  await setup.manager.initialize();
  await assert.rejects(()=>setup.manager.openProject('p2'),/interrupted legacy write/);
  await setup.manager.initialize();
  assert.equal(setup.manager.getActiveProject().projectId,'p1');
  assert.equal(setup.state().transition,null);
});

test('create, rename, archive, and delete publish lifecycle events after persistence',async()=>{
  const setup=harness();
  await setup.manager.initialize();
  const created=await setup.manager.createProject({id:'p4',name:'Four',features:[]},{activate:true});
  assert.equal(created.projectId,'p4');
  assert.equal((await setup.manager.renameProject('p4','Renamed')).name,'Renamed');
  await setup.manager.archiveProject('p4');
  assert.equal(setup.projects.get('p4').lifecycleStatus,'archived');
  assert.equal(setup.state().current,null);
  assert.equal(await setup.manager.deleteProject('p2'),true);
  assert.deepEqual(setup.events.map(event=>event.type),[
    'projectCreated','projectClosed','projectOpened','activeProjectChanged',
    'projectClosed','activeProjectChanged','projectArchived','projectDeleted'
  ]);
});

test('closed project repository scopes reject stale reads and writes',async()=>{
  const journal={
    async appendEvent(event){return event;},async appendEvents(events){return events;},
    async getEvent(){return null;},async getEventsByProject(){return [];},async queryEvents(){return [];}
  };
  const scope=createProjectRepositoryScope({projectId:'p1',journalRepository:journal});
  await scope.journal.appendEvent({projectId:'p1',eventId:'e1'});
  assert.throws(()=>scope.journal.appendEvent({projectId:'p2'}),/cannot write/);
  await scope.close();
  assert.throws(()=>scope.journal.getEvents(),/scope is closed/);
});

test('Analytics active-session lookup is constrained before selecting a result',async()=>{
  let receivedProjectId;
  const analytics={
    async findActiveSession(_rallyEventId,projectId){
      receivedProjectId=projectId;
      return {projectId,sessionId:'s1'};
    }
  };
  const scope=createProjectRepositoryScope({projectId:'p1',analyticsRepository:analytics});
  assert.deepEqual(await scope.analytics.findActiveSession('rally-1'),{projectId:'p1',sessionId:'s1'});
  assert.equal(receivedProjectId,'p1');
});
