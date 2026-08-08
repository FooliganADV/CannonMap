const unavailable=value=>value===null||value===undefined||value===''?'Unavailable':String(value);
const fixed=(value,digits=5)=>Number.isFinite(Number(value))?Number(value).toFixed(digits):'Unavailable';
const localParts=timestamp=>{
  const date=new Date(timestamp);if(Number.isNaN(date.valueOf()))return {date:'Unavailable',time:'Unavailable'};
  return {date:date.toLocaleDateString(),time:date.toLocaleTimeString()};
};

export function buildPhotoEvidenceMetadata(context={}){
  const local=localParts(context.capturedAt);
  return Object.freeze({
    eventName:unavailable(context.eventName),rallyName:unavailable(context.rallyName),dayNumber:unavailable(context.dayNumber),
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
    async capture({projectId,checkpointId,journalEventId,file,context}){
      const identities={mediaGroupId:createId(),originalMediaId:createId(),evidenceMediaId:createId()};
      const sourceDimensions=await inspect(file),metadata=buildPhotoEvidenceMetadata({...context,mediaId:identities.mediaGroupId,journalEventId,imageWidth:sourceDimensions.width,imageHeight:sourceDimensions.height});
      const existing=await repository.listCheckpointPhotos?.(projectId,checkpointId)||[],sequence=existing.filter(item=>(item.role||'original')==='original').length+1;
      const label=context.eventName==='Hotel Arrival'?'Hotel':'CP',cameraSuffix=context.cameraRole==='front'?'_Front':context.cameraRole==='rear'?'_Rear':'',base=`Day${String(context.dayNumber||0).padStart(2,'0')}_${label}${String(context.checkpointNumber||checkpointId).replace(/[^a-z0-9.-]+/gi,'_')}${cameraSuffix}${sequence>1?`_${String(sequence).padStart(2,'0')}`:''}`;
      const filenames={original:`${base}_Original.jpg`,evidence:`${base}_Evidence.jpg`};
      if(typeof repository.addOriginal!=='function'){
        const evidenceBlob=await render(file,metadata);
        return repository.addEvidencePair({projectId,checkpointId,journalEventId,originalFile:file,evidenceBlob,metadata,identities,filenames});
      }
      const original=await repository.addOriginal({projectId,checkpointId,journalEventId,originalFile:file,metadata,identities,filenames});
      let evidence=null;
      try{
        assertDimensions(await inspect(original.blob),sourceDimensions,'Original image');
        const evidenceBlob=await render(file,metadata);evidence=await repository.addEvidence({original,evidenceBlob,filename:filenames.evidence,evidenceMediaId:identities.evidenceMediaId});
        assertDimensions(await inspect(evidence.blob),sourceDimensions,'Evidence image');
        const reference=record=>Object.freeze({mediaId:record.mediaId,mediaGroupId:record.mediaGroupId,uri:`media://${record.mediaId}`,kind:'photo',role:record.role,mimeType:record.mimeType,name:record.name,size:record.size,capturedAt:record.capturedAt,pairedMediaId:record.pairedMediaId});
        return Object.freeze({mediaGroupId:identities.mediaGroupId,original:reference({...original,pairedMediaId:evidence.mediaId}),evidence:reference(evidence),metadata:structuredClone(metadata)});
      }catch(error){
        if(evidence)await repository.discardEvidence?.(evidence.mediaId,original.mediaId,error?.message||error);
        await repository.markEvidenceFailed?.(original.mediaId,error?.message||error);
        error.originalMedia=original;error.evidenceRetryable=true;throw error;
      }
    },
    async retryEvidence(originalMediaId){
      const original=await repository.getMedia(originalMediaId);if(!original||original.role!=='original')throw new Error('The stored original is unavailable.');
      const sourceDimensions=await inspect(original.blob),evidenceBlob=await render(original.blob,original.metadata),filename=String(original.name||'Original.jpg').replace(/_Original(?=\.jpe?g$)/i,'_Evidence');let evidence=null;
      try{evidence=await repository.addEvidence({original,evidenceBlob,filename,evidenceMediaId:original.pairedMediaId||createId()});assertDimensions(await inspect(evidence.blob),sourceDimensions,'Evidence image');return evidence;}
      catch(error){if(evidence)await repository.discardEvidence?.(evidence.mediaId,original.mediaId,error?.message||error);throw error;}
    }
  });
}
