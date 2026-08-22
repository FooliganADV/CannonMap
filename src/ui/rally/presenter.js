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

const PREFLIGHT_DOM=Object.freeze({gps:'Gps',camera:'Camera',storage:'Storage',offline:'Offline'});
function renderDayPreflight({getElement,model}){
  const preflight=model.dayPreflight||{},sheet=getElement('rallyDayPreflight'),visible=Boolean(model.showDayPreflight);
  if(sheet)sheet.hidden=!visible;
  const overallState=String(preflight.status||'CHECKING'),overall=overallState.replaceAll('_',' ');
  const overallElement=getElement('rallyDayPreflightOverall');if(overallElement){overallElement.textContent=overall;overallElement.dataset.state=overallState.toLowerCase().replaceAll('_','-');}
  const title=getElement('rallyDayPreflightTitle');if(title)title.textContent=`Day ${model.day||'—'} readiness`;
  for(const [key,suffix] of Object.entries(PREFLIGHT_DOM)){
    const capability=preflight.capabilities?.[key]||{},rawStatus=String(capability.status||'CHECKING'),state=rawStatus.toLowerCase().replaceAll('_','-'),stateElement=getElement(`rallyPreflight${suffix}State`),detail=getElement(`rallyPreflight${suffix}Detail`),action=getElement(`rallyPreflight${suffix}Action`);
    if(stateElement){stateElement.textContent=String(capability.label||rawStatus).replaceAll('_',' ').toUpperCase();stateElement.dataset.state=state;}
    if(detail)detail.textContent=capability.detail||'';
    if(action){action.hidden=!capability.actionLabel;action.disabled=Boolean(capability.actionDisabled);if(capability.actionLabel)action.textContent=capability.actionLabel;}
  }
  const notice=getElement('rallyDayPreflightNotice');if(notice)notice.textContent=preflight.notice||'No permission is requested until you choose the matching action.';
  const start=getElement('rallyDayPreflightStart');if(start){start.disabled=!preflight.ready;start.textContent=preflight.resume?'RESUME DAY':'START DAY';}
  const degraded=getElement('rallyDayPreflightDegraded');if(degraded){degraded.hidden=Boolean(preflight.ready);degraded.disabled=Boolean(preflight.checking);}
}

function renderSessionChoice({getElement,model}){
  const choice=model.sessionChoice||{},sheet=getElement('rallySessionChoice'),visible=Boolean(choice.show);if(sheet)sheet.hidden=!visible;
  const session=choice.session||{},summary=getElement('rallySessionChoiceSummary');
  if(summary)summary.textContent=session.sessionId?`Day ${session.dayNumber} · Run ${session.runNumber} · ${session.calendarDate}. Resume its exact state, or preserve it and start clean.`:'Start a clean rally-day session.';
  const resume=getElement('rallyResumeSessionButton');if(resume){resume.hidden=!choice.canResume;resume.disabled=!choice.canResume;}
  const start=getElement('rallyStartNewSessionButton');if(start)start.disabled=!choice.canStartNew;
}

function renderPendingEvidence({getElement,model,escapeHtml}){
  const entries=model.pendingEvidence||[],section=getElement('rallyPendingEvidence'),list=getElement('rallyPendingEvidenceList');if(section)section.hidden=!entries.length;
  if(list)list.innerHTML=entries.map(item=>`<article data-pending-checkpoint-id="${escapeHtml(item.checkpointId)}"><div><strong>${escapeHtml(item.checkpointName||item.checkpointId)}</strong><small>ARRIVAL CONFIRMED · PHOTO MISSING${item.photoState?` · ${escapeHtml(String(item.photoState).replaceAll('_',' '))}`:''}</small></div><div><button type="button" data-evidence-action="${item.recoveryAction==='RESUME PAIR'?'resume':'retry'}">${escapeHtml(item.recoveryAction||'RETRY EVIDENCE')}</button><button type="button" data-evidence-action="continue">CONTINUE</button><button type="button" data-evidence-action="defer">DEFER</button><button type="button" data-evidence-action="fail">FAIL</button></div></article>`).join('');
  const more=getElement('rallyMoreButton');if(more)more.textContent=entries.length?`MORE · ${entries.length}`:'MORE';
}

function warningActions(item,{escapeHtml,cameraCapability,cameraPermission}){
  if(String(item?.id||'')!=='camera')return `<div><button type="button" data-warning-action="dismiss">Dismiss</button><button type="button" data-warning-action="10">10m</button><button type="button" data-warning-action="30">30m</button><button type="button" data-warning-action="checkpoint">Next CP</button></div>`;
  const checking=cameraCapability==='checking',denied=cameraPermission==='denied';
  const canEnable=!denied&&['uninitialized','setup-required','interrupted'].includes(cameraCapability);
  const enable=checking
    ?'<button type="button" data-camera-action="checking" disabled>CHECKING…</button>'
    :canEnable?'<button type="button" data-camera-action="enable">ENABLE CAMERA</button>':'';
  const manualLabel=denied?'CONTINUE MANUAL':'USE MANUAL CAMERA';
  return `<div class="rally-camera-warning-actions${enable?'':' is-single'}">${enable}<button type="button" data-camera-action="manual">${escapeHtml(manualLabel)}</button></div>`;
}

export function renderRally({getElement,model,escapeHtml}){
  if(!getElement('rallyMode'))return;
  const set=(id,value)=>{const el=getElement(id);if(el)el.textContent=value;};
  renderSessionChoice({getElement,model});
  renderDayPreflight({getElement,model});
  renderPendingEvidence({getElement,model,escapeHtml});
  const kind=checkpointKind(model.next);
  const camera=model.cameraReadiness||{},cameraCapability=String(camera.capability||'uninitialized'),cameraPermission=String(camera.permission||'unknown');
  const cameraSetup=getElement('rallyCameraSetup'),showCameraSetup=Boolean(model.showCameraSetup);
  if(cameraSetup){
    cameraSetup.hidden=!showCameraSetup;
    cameraSetup.classList.toggle('is-denied',cameraPermission==='denied');
  }
  if(showCameraSetup){
    const checking=cameraCapability==='checking';
    set('rallyCameraSetupTitle',cameraPermission==='denied'?'Camera access blocked':checking?'Checking camera…':'Enable camera before riding');
    set('rallyCameraSetupMessage',cameraPermission==='denied'
      ?'Camera permission is blocked in the browser. CannonMap will use the full-screen manual camera until permission is enabled in site settings.'
      :checking?'CannonMap is verifying camera access and will release the camera immediately afterward.'
      :'Tap once now to grant camera access. CannonMap will verify both cameras, release them, and use automatic checkpoint capture when supported.');
    const enable=getElement('rallyEnableCameraButton');if(enable){enable.hidden=cameraPermission==='denied';enable.disabled=checking;enable.textContent=checking?'CHECKING…':'ENABLE CAMERA';}
    const manual=getElement('rallyCameraContinueManualButton');if(manual){manual.disabled=false;manual.textContent=cameraPermission==='denied'?'CONTINUE MANUAL':'USE MANUAL CAMERA';}
  }
  set('rallyActiveProjectName',model.projectName||'');
  set('rallyDay',`Day ${model.day||'—'}`);
  set('rallyOnlineStatus',model.online?'Online':'Offline');
  set('rallyGpsAccuracy',model.gpsAccuracy||'GPS off');
  set('rallyElevation',model.elevation||'Elev —');
  set('rallyScore',model.score);
  set('rallyNextName',model.next?.name||model.emptyLabel||'Preparing next objective…');
  set('rallyNavigationGuidance',model.navigationGuidance||'Preparing navigation…');
  set('rallyNextDistance',model.distance===null?'':`${model.distance.toFixed(1)} mi`);
  const arrivalPhotoMissing=model.next?.arrivalState==='confirmed'&&model.next?.arrivalTrustworthy&&model.next?.photoRequired&&model.next?.photoEvidenceState!=='complete';
  set('rallyObjectiveStatus',arrivalPhotoMissing?'ARRIVAL CONFIRMED · PHOTO MISSING':model.next?`${text(model.next.type||'checkpoint')} · ${Number(model.next.points)||0} points${model.next.extreme?' · EXTREME':''} · ${text(model.next.status||'upcoming')}`:'');
  const notes=text(model.next?.notes),objectiveIntel=text(model.objectiveIntel);
  set('rallyRiderNotes',notes);
  const notesSection=getElement('rallyRiderNotesSection');if(notesSection)notesSection.hidden=!notes;
  set('rallyObjectiveIntel',objectiveIntel);
  const objectiveIntelSection=getElement('rallyObjectiveIntelSection');if(objectiveIntelSection)objectiveIntelSection.hidden=!objectiveIntel;
  const warnings=(model.warnings||[]).filter(item=>item?.message),warningList=getElement('rallyWarnings');
  if(warningList)warningList.innerHTML=warnings.map(item=>`<li data-warning-id="${escapeHtml(item.id)}"><span>${escapeHtml(item.message)}</span>${warningActions(item,{escapeHtml,cameraCapability,cameraPermission})}</li>`).join('');
  const warningsSection=getElement('rallyWarningsSection');if(warningsSection)warningsSection.hidden=!warnings.length;
  set('rallyHotelEta',model.hotelLabel);
  set('rallyFeedAge',model.feedAge);
  const card=getElement('rallyPrimaryCard')||getElement('rallyMode')?.querySelector?.('.rally-primary-card');
  if(card?.classList){
    for(const name of ['is-extreme','is-fuel','is-hotel','is-checkpoint','is-none'])card.classList.toggle(name,false);
    card.classList.toggle(`is-${kind}`,true);
  }
  if(card)card.hidden=Boolean(model.showDeferredPrompt||model.dayComplete||showCameraSetup||model.showDayPreflight||model.sessionChoice?.show);
  const fab=getElement('rallyRecenterFab');
  if(fab){
    const active=Boolean(model.gpsActive)||(model.gpsStatus&&!/off/i.test(model.gpsStatus));
    fab.textContent=active?'GPS':'START';
    fab.disabled=Boolean(!active&&!model.executableDay);
    fab.classList.toggle('is-active',active&&model.followMode!=='suspended');
    fab.setAttribute('aria-label',active?(model.followMode==='suspended'?'Restore GPS follow':'GPS follow active'):(model.executableDay?'Start GPS tracking':'Choose a numbered Rally Day before starting GPS'));
  }
  for(const id of ['rallyDeferIcon','rallyCompleteButton']){
    const el=getElement(id);if(el)el.disabled=Boolean(!model.next||model.dayComplete);
  }
  const photoPending=model.next?.status==='photo_required';
  const defer=getElement('rallyDeferIcon');if(defer)defer.hidden=!model.next||kind==='hotel'||photoPending;
  const complete=getElement('rallyCompleteButton');if(complete){complete.disabled=Boolean(!model.next||model.dayComplete);complete.textContent=model.next?.photoRecoveryAction||'COMPLETE';}
  const deferredPrompt=getElement('rallyDeferredPrompt');if(deferredPrompt)deferredPrompt.hidden=!model.showDeferredPrompt||Boolean(model.dayComplete);
  set('rallyDeferredMessage',`You have ${model.deferredCount||0} deferred checkpoint${model.deferredCount===1?'':'s'} remaining.`);
  const resume=getElement('rallyResumeDeferredButton');if(resume)resume.disabled=!model.showDeferredPrompt||Boolean(model.dayComplete);
  const finish=getElement('rallyFinishDayButton');if(finish)finish.disabled=!model.showDeferredPrompt||!model.hasHotel||Boolean(model.dayComplete);
  const dayComplete=getElement('rallyDayComplete');if(dayComplete)dayComplete.hidden=!model.dayComplete;
  const review=getElement('rallyReviewNotice');if(review)review.hidden=!model.reviewMode;
  const actionBar=getElement('rallyMode')?.querySelector?.('.rally-actions');if(actionBar){actionBar.hidden=false;actionBar.classList.toggle('is-day-complete',Boolean(model.dayComplete));}
  set('rallyDayCompleteTitle',model.nextDay?'✓ Day Complete':'✓ Rally Complete');
  set('rallyDaySummary','');const daySummary=getElement('rallyDaySummary');if(daySummary)daySummary.hidden=true;
  set('rallyDayCollected',model.daySummary?.totalCollected||0);set('rallyDayDeferred',model.daySummary?.totalDeferred||0);set('rallyDayScore',model.daySummary?.score||0);set('rallyTotalScore',model.score||0);set('rallyDayBackupStatus',model.backupStatus||'Not backed up');set('rallyBackupSheetStatus',model.backupStatus||'Not backed up');
  const startNext=getElement('rallyStartNextDay');if(startNext){startNext.hidden=!model.dayComplete||!model.nextDay||model.reviewMode;startNext.textContent=model.nextDay?`Start Day ${model.nextDay}`:'Start Next Day';}
  const startNewRun=getElement('rallyStartNewRun');if(startNewRun){startNewRun.hidden=!model.dayComplete||model.reviewMode;startNewRun.textContent=`START NEW DAY ${model.day||''} RUN`;}
  const goHotel=getElement('goHotelButton');
  if(goHotel){
    goHotel.disabled=!model.hasHotel&&!model.hotelBailoutActive;
    goHotel.textContent=model.hotelBailoutActive?'UNDO HOTEL BAILOUT':'GO TO HOTEL';
  }
  const nextButton=getElement('rallyNextButton');
  if(nextButton)nextButton.hidden=Boolean(model.dayComplete||model.next)||!model.hasPlanned||model.showDeferredPrompt;
  if(complete)complete.hidden=Boolean(model.dayComplete||!model.next);
  if(getElement('autoCompleteCheckpoints'))getElement('autoCompleteCheckpoints').checked=model.autoComplete;
  if(getElement('checkpointArrivalRadius'))getElement('checkpointArrivalRadius').value=model.arrivalRadius;
  if(getElement('checkpointMaxAccuracy'))getElement('checkpointMaxAccuracy').value=model.maxAccuracy;
  renderCheckpointOrder({container:getElement('checkpointOrderList'),rows:model.checkpoints,escapeHtml});
}
