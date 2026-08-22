const unavailable=value=>value===null||value===undefined||value===''?'Unavailable':String(value);
const optionalText=value=>value===null||value===undefined||value===''?null:String(value);
const fixed=(value,digits=5)=>Number.isFinite(Number(value))?Number(value).toFixed(digits):'Unavailable';
const localParts=timestamp=>{
  const date=new Date(timestamp);if(Number.isNaN(date.valueOf()))return {date:'Unavailable',time:'Unavailable'};
  return {date:date.toLocaleDateString(),time:date.toLocaleTimeString()};
};

export function buildPhotoEvidenceMetadata(context={}){
  const local=localParts(context.capturedAt);
  const source=context.originalSourceProvenance&&typeof context.originalSourceProvenance==='object'?structuredClone(context.originalSourceProvenance):null;
  return Object.freeze({
    eventName:unavailable(context.eventName),objectiveType:unavailable(context.objectiveType),rallyName:unavailable(context.rallyName),dayNumber:unavailable(context.dayNumber),
    sessionId:optionalText(context.sessionId),sessionRunNumber:Number.isInteger(Number(context.sessionRunNumber))?Number(context.sessionRunNumber):null,
    sessionCalendarDate:optionalText(context.sessionCalendarDate),sessionStartTimestamp:optionalText(context.sessionStartedAt||context.sessionStartTimestamp),
    checkpointName:unavailable(context.checkpointName),checkpointNumber:unavailable(context.checkpointNumber),points:unavailable(context.points),
    captureDate:local.date,captureTime:local.time,latitude:fixed(context.latitude),longitude:fixed(context.longitude),
    elevation:context.elevation===null||context.elevation===undefined?'Unavailable':`${Math.round(Number(context.elevation))} ft`,
    temperature:context.temperature===null||context.temperature===undefined?'Unavailable':`${Math.round(Number(context.temperature))}°F`,
    gpsAccuracy:context.gpsAccuracy===null||context.gpsAccuracy===undefined?'Unavailable':`±${Math.round(Number(context.gpsAccuracy))} ft`,
    speed:context.speedMph===null||context.speedMph===undefined?'Unavailable':`${Number(context.speedMph)<1?0:Number(context.speedMph).toFixed(1)} mph`,
    motion:unavailable(context.motion),gpsSampleTimestamp:unavailable(context.gpsSampleTimestamp),gpsSampleAge:context.gpsSampleAgeMs===null||context.gpsSampleAgeMs===undefined?'Unavailable':`${(Number(context.gpsSampleAgeMs)/1000).toFixed(1)} sec`,
    deviceHeading:context.deviceHeading===null||context.deviceHeading===undefined?'Unavailable':`${Math.round(Number(context.deviceHeading))}°`,
    travelDirection:unavailable(context.travelDirection),weatherContext:unavailable(context.weatherContext),mediaId:unavailable(context.mediaId),journalEventId:unavailable(context.journalEventId),
    cameraRole:unavailable(context.cameraRole),pairId:unavailable(context.pairId),requestedCamera:unavailable(context.requestedCamera),actualCamera:unavailable(context.actualCamera),cameraSelectionHonored:context.cameraSelectionHonored??'unknown',captureMethod:context.captureMethod||'file-input',captureTimestamp:context.captureTimestamp||context.capturedAt||null,
    imageWidth:Number.isFinite(Number(context.imageWidth))?Number(context.imageWidth):null,imageHeight:Number.isFinite(Number(context.imageHeight))?Number(context.imageHeight):null,
    originalMimeType:String(context.originalMimeType||source?.mimeType||'application/octet-stream'),originalByteLength:Number(context.originalByteLength||source?.byteLength)||null,
    originalSourceProvenance:source,
    capturedAt:context.capturedAt||null
  });
}

export function photoEvidenceOverlayEntries(metadata){
  const objective=metadata.eventName==='Hotel Arrival'?'Hotel':'Checkpoint';
  return [['Rally',metadata.rallyName],['Day',metadata.dayNumber],[objective,`${metadata.checkpointNumber} · ${metadata.checkpointName}`],['Camera Role',metadata.cameraRole==='front'?'FRONT / SELFIE':metadata.cameraRole==='rear'?'REAR / FORWARD':metadata.cameraRole],['Points',metadata.points],['Captured',`${metadata.captureDate} ${metadata.captureTime}`],['Coordinates',`${metadata.latitude}, ${metadata.longitude}`],['Elevation',metadata.elevation],['Temperature',metadata.temperature],['Weather',metadata.weatherContext],['Speed / Motion',`${metadata.speed} · ${metadata.motion}`],['GPS Accuracy',metadata.gpsAccuracy],['GPS Sample',`${metadata.gpsSampleTimestamp} (${metadata.gpsSampleAge})`],['Heading',metadata.deviceHeading],['Travel Direction',metadata.travelDirection],['Pair ID',metadata.pairId],['Media ID',metadata.mediaId],['Journal Event ID',metadata.journalEventId]];
}

async function imageSource(file){
  if(typeof createImageBitmap==='function'){
    try{return await createImageBitmap(file);}catch(_){/* WebKit may reject camera-backed Files that HTMLImageElement can decode. */}
  }
  const url=URL.createObjectURL(file),image=new Image();
  try{await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});return image;}finally{URL.revokeObjectURL(url);}
}

export async function readImageDimensions(file){
  const image=await imageSource(file);try{return Object.freeze({width:Number(image.width),height:Number(image.height)});}finally{image.close?.();}
}

const assertDimensions=(actual,expected,label)=>{
  if(actual.width!==expected.width||actual.height!==expected.height)throw new Error(`${label} dimension verification failed.`);
};
const assertReadableDimensions=(actual,label)=>{
  if(!Number.isFinite(Number(actual?.width))||!Number.isFinite(Number(actual?.height))||Number(actual.width)<1||Number(actual.height)<1)throw new Error(`${label} dimension verification failed.`);
};

const extensionFor=mimeType=>mimeType==='image/png'?'png':mimeType==='image/webp'?'webp':mimeType==='image/heic'||mimeType==='image/heif'?'heic':'jpg';

const detachedOriginalReference=(original,error)=>{
  const abandonedPairId=original?.pairId||original?.metadata?.pairId||null,metadata={...(original?.metadata||{}),pairId:null,pairStatus:'abandoned',abandonedPairId,evidenceStatus:'failed'};
  return {...original,pairId:null,pairStatus:'abandoned',abandonedPairId,pairedMediaId:null,evidenceStatus:'failed',evidenceError:String(error||'Evidence generation failed.'),metadata};
};

const cleanupFailure=(operation,error)=>Object.freeze({operation,errorName:error?.name||'Error',message:error?.message||String(error)});

export async function renderEvidenceJpeg(file,metadata,{quality=1,canvasFactory=()=>document.createElement('canvas')}={}){
  const image=await imageSource(file),canvas=canvasFactory();canvas.width=image.width;canvas.height=image.height;
  const context=canvas.getContext('2d');context.drawImage(image,0,0);image.close?.();
  const footerHeight=Math.max(120,Math.round(canvas.height*.19)),top=canvas.height-footerHeight,pad=Math.max(16,Math.round(canvas.width*.018));
  context.fillStyle='rgba(0,0,0,.78)';context.fillRect(0,top,canvas.width,footerHeight);
  context.fillStyle='#fff';context.textBaseline='top';context.font=`700 ${Math.max(18,Math.round(footerHeight*.12))}px system-ui, sans-serif`;
  context.fillText('CANNONMAP  ·  AMERICA 250 ADV CANNONBALL',pad,top+pad,canvas.width-pad*2);
  const entries=photoEvidenceOverlayEntries(metadata);
  const columns=3,rows=Math.ceil(entries.length/columns),titleHeight=Math.max(34,footerHeight*.2),columnWidth=(canvas.width-pad*2)/columns,rowHeight=(footerHeight-titleHeight-pad)/rows;
  context.font=`500 ${Math.max(12,Math.round(Math.min(rowHeight*.56,footerHeight*.085)))}px system-ui, sans-serif`;
  entries.forEach(([label,value],index)=>{const column=Math.floor(index/rows),row=index%rows;context.fillText(`${label}: ${value}`,pad+column*columnWidth,top+titleHeight+row*rowHeight,columnWidth-pad);});
  context.font=`500 ${Math.max(11,Math.round(footerHeight*.065))}px system-ui, sans-serif`;context.textAlign='right';context.fillText('Generated by CannonMap Mission Control',canvas.width-pad,canvas.height-pad*1.2);context.textAlign='left';
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Evidence JPEG generation failed.')),'image/jpeg',quality));
}

export function createPhotoEvidenceService({repository,render=renderEvidenceJpeg,inspect=readImageDimensions,createId}={}){
  if(!repository||typeof createId!=='function')throw new TypeError('repository and createId are required.');
  return Object.freeze({
    async capture({projectId,checkpointId,journalEventId,file,source=null,context={}}){
      const originalFile=source?.blob||file,provenance=source?.provenance||context.originalSourceProvenance||null;
      if(!originalFile)throw new TypeError('An original camera image is required.');
      if(provenance?.derivedFromVideoFrame===true||provenance?.sourceKind==='video-frame'||provenance?.sourceKind==='canvas-frame')throw new TypeError('A canvas or video frame cannot be stored as Original media.');
      const identities={mediaGroupId:createId(),originalMediaId:createId(),evidenceMediaId:createId()};
      const inspectedDimensions=await inspect(originalFile),sourceDimensions={width:Number(provenance?.width)||inspectedDimensions.width,height:Number(provenance?.height)||inspectedDimensions.height};
      assertDimensions(inspectedDimensions,sourceDimensions,'Original source');
      const metadata=buildPhotoEvidenceMetadata({...context,mediaId:identities.mediaGroupId,journalEventId,imageWidth:sourceDimensions.width,imageHeight:sourceDimensions.height,originalMimeType:originalFile.type,originalByteLength:originalFile.size,originalSourceProvenance:provenance});
      const existing=await repository.listCheckpointPhotos?.(projectId,checkpointId)||[],sameSession=item=>!context.sessionId||String(item.sessionId||item.metadata?.sessionId||'')===String(context.sessionId),sameCamera=item=>!context.cameraRole||String(item.cameraRole||item.metadata?.cameraRole||'')===String(context.cameraRole),sequence=existing.filter(item=>(item.role||'original')==='original'&&sameSession(item)&&sameCamera(item)).length+1;
      const safe=value=>String(value||'').trim().replace(/[^a-z0-9.-]+/gi,'-').replace(/^-+|-+$/g,'')||'Unknown',dayNumber=Number(context.dayNumber),dayLabel=Number.isInteger(dayNumber)&&dayNumber>0?String(dayNumber).padStart(2,'0'):'Unassigned',label=context.eventName==='Hotel Arrival'?'Hotel':safe(context.checkpointName||context.checkpointNumber||'Checkpoint'),shortId=safe(checkpointId).slice(-12),cameraSuffix=context.cameraRole==='front'?'_Front':context.cameraRole==='rear'?'_Rear':'',base=`Day${dayLabel}_${label}_${shortId}${cameraSuffix}${sequence>1?`_${String(sequence).padStart(2,'0')}`:''}`;
      const filenames={original:`${base}_Original.${extensionFor(originalFile.type)}`,evidence:`${base}_Evidence.jpg`};
      if(typeof repository.addOriginal!=='function'){
        const evidenceBlob=await render(originalFile,metadata);
        return repository.addEvidencePair({projectId,checkpointId,journalEventId,originalFile,evidenceBlob,metadata,identities,filenames,sourceProvenance:provenance});
      }
      const original=await repository.addOriginal({projectId,checkpointId,journalEventId,originalFile,metadata,identities,filenames,sourceProvenance:provenance});
      let evidence=null;
      try{
        assertDimensions(await inspect(original.blob),sourceDimensions,'Original image');
        const evidenceBlob=await render(originalFile,metadata);evidence=await repository.addEvidence({original,evidenceBlob,filename:filenames.evidence,evidenceMediaId:identities.evidenceMediaId});
        assertReadableDimensions(await inspect(evidence.blob),'Evidence image');
        const reference=record=>Object.freeze({mediaId:record.mediaId,mediaGroupId:record.mediaGroupId,uri:`media://${record.mediaId}`,kind:'photo',role:record.role,mimeType:record.mimeType,name:record.name,size:record.size,capturedAt:record.capturedAt,pairedMediaId:record.pairedMediaId,sourceProvenance:record.sourceProvenance?structuredClone(record.sourceProvenance):null});
        return Object.freeze({mediaGroupId:identities.mediaGroupId,original:reference({...original,pairedMediaId:evidence.mediaId}),evidence:reference(evidence),metadata:structuredClone(metadata)});
      }catch(error){
        const failure=error instanceof Error?error:new Error(String(error)),reason=failure.message||failure,cleanupErrors=[];
        // The in-memory reference is detached first so callers can always recover/export
        // the native Original even if one or more IndexedDB cleanup writes fail.
        let preserved=detachedOriginalReference(original,reason),durablyDetached=false,evidenceDiscarded=!evidence;
        try{
          const stored=await repository.abandonIncompleteOriginal?.(original.mediaId,reason);
          if(stored){durablyDetached=stored.pairId===null&&stored.pairedMediaId===null;preserved=durablyDetached?stored:detachedOriginalReference(stored,reason);}
        }catch(cleanupError){cleanupErrors.push(cleanupFailure('detach-original',cleanupError));}
        try{if(evidence&&typeof repository.discardEvidence==='function'){await repository.discardEvidence(evidence.mediaId,original.mediaId,reason);evidenceDiscarded=true;}}
        catch(cleanupError){cleanupErrors.push(cleanupFailure('discard-evidence',cleanupError));}
        try{await repository.markEvidenceFailed?.(original.mediaId,reason);}
        catch(cleanupError){cleanupErrors.push(cleanupFailure('mark-evidence-failed',cleanupError));}
        failure.originalMedia=preserved;failure.evidenceRetryable=true;failure.originalPreserved=true;failure.originalDurablyDetached=durablyDetached;
        failure.requiresNewPair=!durablyDetached||!evidenceDiscarded;failure.cleanupErrors=Object.freeze(cleanupErrors);throw failure;
      }
    },
    async retryEvidence(originalMediaId,{pairId=null,cameraRole=null,pairJournalEventId=null}={}){
      const original=await repository.getMedia(originalMediaId);if(!original||original.role!=='original')throw new Error('The stored original is unavailable.');
      await inspect(original.blob);const evidenceBlob=await render(original.blob,original.metadata),filename=String(original.name||'Original.jpg').replace(/_Original(?=\.[^.]+$)/i,'_Evidence').replace(/\.[^.]+$/,'.jpg');let evidence=null;
      try{
        evidence=await repository.addEvidence({original,evidenceBlob,filename,evidenceMediaId:original.pairedMediaId||createId()});assertReadableDimensions(await inspect(evidence.blob),'Evidence image');
        if(pairId&&typeof repository.reattachRecoveredEvidencePair==='function'){
          const recovered=await repository.reattachRecoveredEvidencePair({originalMediaId:original.mediaId,evidenceMediaId:evidence.mediaId,pairId,cameraRole,pairJournalEventId});
          return recovered.evidence;
        }
        return evidence;
      }
      catch(error){if(evidence)await repository.discardEvidence?.(evidence.mediaId,original.mediaId,error?.message||error);throw error;}
    }
  });
}
