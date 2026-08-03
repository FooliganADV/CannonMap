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
  set('rallyObjectiveStatus',model.next?`${text(model.next.type||'checkpoint')} · ${text(model.next.status||'upcoming')}`:'');
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
  if(card)card.hidden=Boolean(model.showDeferredPrompt||model.dayComplete);
  const fab=getElement('rallyRecenterFab');
  if(fab){
    const active=Boolean(model.gpsActive)||(model.gpsStatus&&!/off/i.test(model.gpsStatus));
    fab.textContent=active?'GPS':'START';
    fab.classList.toggle('is-active',active&&model.followMode!=='suspended');
    fab.setAttribute('aria-label',active?(model.followMode==='suspended'?'Restore GPS follow':'GPS follow active'):'Start GPS tracking');
  }
  for(const id of ['rallyDeferIcon','rallyCompleteButton']){
    const el=getElement(id);if(el)el.disabled=Boolean(!model.next||model.dayComplete);
  }
  const photoPending=model.next?.status==='photo_required';
  const defer=getElement('rallyDeferIcon');if(defer)defer.hidden=!model.next||kind==='hotel'||photoPending;
  const complete=getElement('rallyCompleteButton');if(complete&&photoPending)complete.disabled=true;
  const deferredPrompt=getElement('rallyDeferredPrompt');if(deferredPrompt)deferredPrompt.hidden=!model.showDeferredPrompt||Boolean(model.dayComplete);
  set('rallyDeferredMessage',`You have ${model.deferredCount||0} deferred checkpoint${model.deferredCount===1?'':'s'} remaining.`);
  const resume=getElement('rallyResumeDeferredButton');if(resume)resume.disabled=!model.showDeferredPrompt||Boolean(model.dayComplete);
  const finish=getElement('rallyFinishDayButton');if(finish)finish.disabled=!model.showDeferredPrompt||!model.hasHotel||Boolean(model.dayComplete);
  const dayComplete=getElement('rallyDayComplete');if(dayComplete)dayComplete.hidden=!model.dayComplete;
  set('rallyDaySummary',model.dayComplete?`${model.daySummary?.totalCollected||0} collected · ${model.daySummary?.totalDeferred||0} deferred · ${model.daySummary?.score||0} points`:'');
  const startNext=getElement('rallyStartNextDay');if(startNext){startNext.hidden=!model.dayComplete||!model.nextDay;startNext.textContent=model.nextDay?`Start Day ${model.nextDay}`:'Start Next Day';}
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
}
