export function renderCheckpointOrder({container,rows,escapeHtml}){
  if(!container)return;
  container.innerHTML=rows.length?rows.map((feature,index)=>`<article data-checkpoint-id="${escapeHtml(feature.id)}"><span><b>${index+1}</b><strong>${escapeHtml(feature.name)}</strong><small>${feature.extreme?'21-point extreme':'10 points'} · ${escapeHtml(feature.status)}</small></span><div><button type="button" data-order-action="up" aria-label="Move ${escapeHtml(feature.name)} earlier" ${index===0?'disabled':''}>↑</button><button type="button" data-order-action="down" aria-label="Move ${escapeHtml(feature.name)} later" ${index===rows.length-1?'disabled':''}>↓</button><button type="button" data-order-action="next" aria-label="Make ${escapeHtml(feature.name)} next" ${['completed','skipped','unreachable'].includes(feature.status)?'disabled':''}>Next</button></div></article>`).join(''):'<p>No checkpoints are assigned to this day.</p>';
}

function checkpointKind(next){
  if(!next)return 'none';
  if(next.extreme)return 'extreme';
  const type=String(next.type||'checkpoint').toLowerCase();
  if(type==='hotel')return 'hotel';
  return 'checkpoint';
}

const text=value=>String(value||'').trim();

export function renderRally({getElement,model,escapeHtml}){
  if(!getElement('rallyMode'))return;
  const set=(id,value)=>{const el=getElement(id);if(el)el.textContent=value;};
  const kind=checkpointKind(model.next);
  set('rallyOnlineStatus',model.online?'Online':'Offline');
  set('rallyGpsAccuracy',model.gpsAccuracy||'GPS off');
  set('rallyElevation',model.elevation||'Elev —');
  set('rallyScore',model.score);
  set('rallyNextName',model.next?.name||model.emptyLabel||'Preparing next objective…');
  set('rallyNavigationGuidance',model.navigationGuidance||'Preparing navigation…');
  set('rallyNextDistance',model.distance===null?'':`${model.distance.toFixed(1)} mi`);
  const notes=text(model.next?.notes),intelligence=text(model.routeIntelligence);
  set('rallyRiderNotes',notes);
  set('rallyRouteIntelligence',intelligence);
  const notesSection=getElement('rallyRiderNotesSection');if(notesSection)notesSection.hidden=!notes;
  const intelligenceSection=getElement('rallyRouteIntelligenceSection');if(intelligenceSection)intelligenceSection.hidden=!intelligence;
  const warnings=(model.warnings||[]).filter(item=>item?.message),warningList=getElement('rallyWarnings');
  if(warningList)warningList.innerHTML=warnings.map(item=>`<li data-warning-id="${escapeHtml(item.id)}"><span>${escapeHtml(item.message)}</span><div><button type="button" data-warning-action="dismiss">Dismiss</button><button type="button" data-warning-action="10">10m</button><button type="button" data-warning-action="30">30m</button><button type="button" data-warning-action="checkpoint">Next CP</button></div></li>`).join('');
  const warningsSection=getElement('rallyWarningsSection');if(warningsSection)warningsSection.hidden=!warnings.length;
  set('rallyHotelEta',model.hotelLabel);
  set('rallyFeedAge',model.feedAge);
  const card=getElement('rallyPrimaryCard')||getElement('rallyMode')?.querySelector?.('.rally-primary-card');
  if(card?.classList){
    for(const name of ['is-extreme','is-fuel','is-hotel','is-checkpoint','is-none'])card.classList.toggle(name,false);
    card.classList.toggle(`is-${kind}`,true);
  }
  if(card)card.hidden=Boolean(model.showDeferredPrompt);
  const fab=getElement('rallyRecenterFab');
  if(fab){
    const active=Boolean(model.gpsActive)||(model.gpsStatus&&!/off/i.test(model.gpsStatus));
    fab.textContent=active?'GPS':'START';
    fab.classList.toggle('is-active',active);
    fab.setAttribute('aria-label',active?'Recenter map on GPS':'Start GPS tracking');
  }
  for(const id of ['rallyDeferIcon','rallyCompleteButton']){
    const el=getElement(id);if(el)el.disabled=!model.next;
  }
  const defer=getElement('rallyDeferIcon');if(defer)defer.hidden=!model.next||kind==='hotel';
  const deferredPrompt=getElement('rallyDeferredPrompt');if(deferredPrompt)deferredPrompt.hidden=!model.showDeferredPrompt;
  set('rallyDeferredMessage',`You have ${model.deferredCount||0} deferred checkpoint${model.deferredCount===1?'':'s'} remaining.`);
  const resume=getElement('rallyResumeDeferredButton');if(resume)resume.disabled=!model.showDeferredPrompt;
  const finish=getElement('rallyFinishDayButton');if(finish)finish.disabled=!model.showDeferredPrompt||!model.hasHotel;
  const dayComplete=getElement('rallyDayComplete');if(dayComplete)dayComplete.hidden=!model.dayComplete;
  const goHotel=getElement('goHotelButton');
  if(goHotel){
    goHotel.disabled=!model.hasHotel&&!model.hotelBailoutActive;
    goHotel.textContent=model.hotelBailoutActive?'UNDO HOTEL BAILOUT':'GO TO HOTEL';
  }
  const nextButton=getElement('rallyNextButton');
  if(nextButton)nextButton.hidden=Boolean(model.next)||!model.hasPlanned||model.showDeferredPrompt;
  if(getElement('autoCompleteCheckpoints'))getElement('autoCompleteCheckpoints').checked=model.autoComplete;
  if(getElement('checkpointArrivalRadius'))getElement('checkpointArrivalRadius').value=model.arrivalRadius;
  if(getElement('checkpointMaxAccuracy'))getElement('checkpointMaxAccuracy').value=model.maxAccuracy;
  renderCheckpointOrder({container:getElement('checkpointOrderList'),rows:model.checkpoints,escapeHtml});

  // One-tap paired photo capture UI
  const photoSection=getElement('rallyPhotoSection');
  if(photoSection){
    const canCapture=Boolean(model.next)&&model.photoCaptureEnabled!==false;
    photoSection.hidden=!canCapture;

    const capturing=Boolean(model.photoCapturing);
    const captureBtn=getElement('rallyPhotoCapturePair');
    if(captureBtn){
      captureBtn.disabled=!canCapture||capturing;
      captureBtn.classList.toggle('is-busy',capturing);
      if(capturing){
        captureBtn.textContent=model.photoStatus||'CAPTURING…';
      }else if(model.photoStatus==='Pair saved'){
        captureBtn.textContent='PAIR SAVED ✓';
      }else{
        captureBtn.textContent='CAPTURE PAIR';
      }
    }

    const status=getElement('rallyPhotoStatus');
    if(status){
      if(model.photoStatus)status.textContent=model.photoStatus;
      else if(canCapture)status.textContent='One tap: front + rear photos';
      else status.textContent='';
    }

    // Debug controls stay hidden unless explicitly enabled
    const debugWrap=getElement('rallyPhotoDebug');
    if(debugWrap)debugWrap.hidden=!model.photoDebugMode;
  }
}
