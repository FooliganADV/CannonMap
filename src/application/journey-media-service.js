/** Cross-project media projections retain media:// references; blobs remain in one repository. */
export function createJourneyMediaService({mediaRepository,projectLifecycle}={}){
  if(!mediaRepository||!projectLifecycle)throw new TypeError('mediaRepository and projectLifecycle are required.');
  return Object.freeze({
    async index(){
      const [projects,media]=await Promise.all([projectLifecycle.listProjects(),mediaRepository.listAllPhotos()]),names=new Map(projects.map(project=>[String(project.projectId),project.name]));
      return media.map(({blob,...record})=>Object.freeze({...record,projectName:names.get(String(record.projectId))||'Unknown Project',uri:`media://${record.mediaId}`}))
        .sort((a,b)=>String(a.projectName).localeCompare(String(b.projectName))||Number(a.metadata?.dayNumber||0)-Number(b.metadata?.dayNumber||0)||String(a.capturedAt).localeCompare(String(b.capturedAt)));
    },
    async reconcile(journalReferences=[]){
      const media=await mediaRepository.listAllPhotos(),ids=new Set(media.map(item=>item.mediaId)),referenced=new Set(journalReferences.flatMap(reference=>[reference.originalMediaId,reference.evidenceMediaId]).filter(Boolean));
      return Object.freeze({mediaWithoutJournal:media.filter(item=>!referenced.has(item.mediaId)).map(item=>item.mediaId),journalWithoutMedia:[...referenced].filter(id=>!ids.has(id)),
        originalWithoutEvidence:media.filter(item=>item.role==='original'&&(!item.pairedMediaId||!ids.has(item.pairedMediaId))).map(item=>item.mediaId),
        evidenceWithoutOriginal:media.filter(item=>item.role==='evidence'&&(!item.pairedMediaId||!ids.has(item.pairedMediaId))).map(item=>item.mediaId)});
    }
  });
}
