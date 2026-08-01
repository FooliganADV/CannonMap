/** Read-only source port for future Ride, Journal, GPX, and CSV exporters. */
export function createRideExportSource({getActiveProject,journal,analytics}={}){
  if(typeof getActiveProject!=='function'||!journal||!analytics)throw new TypeError('Export source dependencies are required.');
  return Object.freeze({
    async snapshot(){
      const project=getActiveProject();if(!project?.projectId)throw new Error('No active Project.');
      const journalSnapshot=await journal.getProjectJournal(project.projectId);
      await analytics.flush?.();
      const analyticsSnapshot=analytics.getExportSnapshot?await analytics.getExportSnapshot():analytics.snapshot?.()??null;
      return Object.freeze({project:Object.freeze(structuredClone(project)),journal:journalSnapshot,analytics:analyticsSnapshot});
    }
  });
}
