const value=snapshot=>snapshot?.val?.()??snapshot??null;

export function createRealtimeRouteRepository(database,{maxContentionRetries=5}={}){
  if(!database)throw new TypeError('database is required.');
  const appendImmutable=async(path,record)=>{
    let created=false;
    await database.ref(path).transaction(current=>{
      if(current)return;
      created=true;
      return record;
    });
    if(!created){
      const existing=value(await database.ref(path).get());
      if(existing?.revisionId!==record.revisionId)throw new Error(`Immutable route revision collision at ${path}`);
    }
    return created;
  };
  const advanceHead=async({path,expectedRevisionId,nextRevisionId})=>{
    let attempts=0,committed=false;
    while(attempts<maxContentionRetries&&!committed){
      attempts++;
      const result=await database.ref(path).transaction(current=>{
        if(current&&current.revisionId===nextRevisionId)return current;
        if((current?.revisionId||null)!==(expectedRevisionId||null))return;
        return {revisionId:nextRevisionId,updatedAt:new Date().toISOString()};
      });
      committed=Boolean(result?.committed);
      if(!committed&&attempts<maxContentionRetries)await Promise.resolve();
    }
    if(!committed)throw new Error(`Route projection contention exceeded ${maxContentionRetries} attempts at ${path}`);
    return Object.freeze({attempts});
  };
  return Object.freeze({
    async projectionReceipt(eventId,observationId){
      return value(await database.ref(`routeProjectionReceipts/${eventId}/${observationId}`).get());
    },
    async persistProjectionReceipt(eventId,observationId,receipt){
      return appendImmutable(`routeProjectionReceipts/${eventId}/${observationId}`,receipt);
    },
    async variantHead(eventId,variantId){
      const head=value(await database.ref(`routeVariantHeads/${eventId}/${variantId}`).get());
      if(!head?.revisionId)return null;
      return value(await database.ref(`routeVariantRevisions/${eventId}/${variantId}/${head.revisionId}`).get());
    },
    async familyHead(eventId,familyId){
      const head=value(await database.ref(`routeFamilyHeads/${eventId}/${familyId}`).get());
      if(!head?.revisionId)return null;
      return value(await database.ref(`routeFamilyRevisions/${eventId}/${familyId}/${head.revisionId}`).get());
    },
    async familyVariants(eventId,familyId){
      const heads=value(await database.ref(`routeVariantHeads/${eventId}`).get())||{};
      const records=await Promise.all(Object.entries(heads).map(async([variantId,head])=>value(await database.ref(`routeVariantRevisions/${eventId}/${variantId}/${head.revisionId}`).get())));
      return records.filter(record=>record?.familyId===familyId&&record.lifecycle!=='superseded');
    },
    async persistVariantRevision(record,expectedRevisionId){
      const created=await appendImmutable(`routeVariantRevisions/${record.eventId}/${record.variantId}/${record.revisionId}`,record);
      const contention=await advanceHead({path:`routeVariantHeads/${record.eventId}/${record.variantId}`,expectedRevisionId,nextRevisionId:record.revisionId});
      return Object.freeze({created,contention});
    },
    async persistFamilyRevision(record,expectedRevisionId){
      const created=await appendImmutable(`routeFamilyRevisions/${record.eventId}/${record.familyId}/${record.revisionId}`,record);
      const contention=await advanceHead({path:`routeFamilyHeads/${record.eventId}/${record.familyId}`,expectedRevisionId,nextRevisionId:record.revisionId});
      await database.ref(`routeAggregateProjections/${record.eventId}/${record.familyId}`).set({familyId:record.familyId,revisionId:record.revisionId,aggregateStats:record.aggregateStats,shadowMode:true});
      return Object.freeze({created,contention});
    },
    persistLineage(eventId,lineage){
      return appendImmutable(`routeLineage/${eventId}/${lineage.lineageId}`,lineage);
    },
    persistProposal(proposal){
      return appendImmutable(`routeProposals/${proposal.eventId}/${proposal.proposalId}`,proposal);
    },
    diagnostic(eventId,id,record){
      return database.ref(`routeDiagnostics/${eventId}/${id}`).set({...record,shadowMode:true});
    }
  });
}
