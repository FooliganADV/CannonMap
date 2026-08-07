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

function checkpointTypeLabel(next){
  if(!next)return 'NEXT CHECKPOINT';
  if(next.extreme)return 'EXTREME CHECKPOINT';
  const type=String(next.type||'checkpoint').toLowerCase();
  if(type==='hotel')return 'NEXT HOTEL';
  return 'NEXT CHECKPOINT';
}

function checkpointHint(next){
  if(!next)return 'Select Next to load the active day checkpoint.';
  const notes=String(next.notes||'').trim();
  if(notes)return notes.length>72?`${notes.slice(0,69)}…`:notes;
  if(next.extreme)return 'High-value extreme checkpoint — confirm approach carefully.';
  if(next.status==='deferred')return 'Previously deferred — still counts when completed.';
  if(next.status==='next')return 'Active target — complete or defer when ready.';
  return `${next.points||10} points · ${next.status||'planned'}`;
}

export function renderRally({getElement,model,escapeHtml}){
  if(!getElement('rallyMode'))return;
  const set=(id,value)=>{const el=getElement(id);if(el)el.textContent=value;};
  const kind=checkpointKind(model.next);
  set('rallyDay',model.day?`DAY ${model.day}`:'SELECT A DAY');
  set('rallyConnectivity',`${model.online?'Online':'Offline'} · ${model.gpsStatus}`);
  set('rallyScore',model.score);
  set('rallyNextType',checkpointTypeLabel(model.next));
  set('rallyNextName',model.next?.name||'No checkpoint selected');
  set('rallyNextDistance',model.distance===null?'Distance unavailable':`${model.distance.toFixed(1)} mi away`);
  set('rallyNextPoints',model.next?`${model.next.extreme?'EXTREME · ':''}${model.next.points} points · ${model.next.status}`:'—');
  set('rallyNextHint',checkpointHint(model.next));
  set('rallyHotelEta',model.hotelLabel);
  set('rallyFeedAge',model.feedAge);
  const card=getElement('rallyPrimaryCard')||getElement('rallyMode')?.querySelector?.('.rally-primary-card');
  if(card?.classList){
    for(const name of ['is-extreme','is-fuel','is-hotel','is-checkpoint','is-none'])card.classList.toggle(name,false);
    card.classList.toggle(`is-${kind}`,true);
  }
  const fab=getElement('rallyRecenterFab');
  if(fab){
    const active=Boolean(model.gpsActive)||(model.gpsStatus&&!/off/i.test(model.gpsStatus));
    fab.textContent=active?'GPS':'START';
    fab.classList.toggle('is-active',active);
    fab.setAttribute('aria-label',active?'Recenter map on GPS':'Start GPS tracking');
  }
  for(const id of ['rallyDeferButton','rallyCompleteButton','rallySkipButton']){
    const el=getElement(id);if(el)el.disabled=!model.next;
  }
  const restore=getElement('rallyRestoreButton');
  if(restore){restore.hidden=!model.hasDeferred;restore.disabled=!model.hasDeferred;}
  const goHotel=getElement('goHotelButton');
  if(goHotel){
    goHotel.disabled=!model.hasHotel&&!model.hotelBailoutActive;
    goHotel.textContent=model.hotelBailoutActive?'UNDO HOTEL BAILOUT':'GO TO HOTEL';
  }
  if(getElement('autoCompleteCheckpoints'))getElement('autoCompleteCheckpoints').checked=model.autoComplete;
  if(getElement('checkpointArrivalRadius'))getElement('checkpointArrivalRadius').value=model.arrivalRadius;
  if(getElement('checkpointMaxAccuracy'))getElement('checkpointMaxAccuracy').value=model.maxAccuracy;
  renderCheckpointOrder({container:getElement('checkpointOrderList'),rows:model.checkpoints,escapeHtml});

  // Paired photo capture UI state
  const photoSection=getElement('rallyPhotoSection');
  if(photoSection){
    const canCapture=Boolean(model.next)&&model.photoCaptureEnabled!==false;
    photoSection.hidden=!canCapture;
    const frontReady=Boolean(model.pendingFrontPhoto);
    const rearReady=Boolean(model.pendingRearPhoto);
    const frontBtn=getElement('rallyPhotoFrontButton');
    const rearBtn=getElement('rallyPhotoRearButton');
    const submitBtn=getElement('rallyPhotoSubmitPair');
    if(frontBtn){
      frontBtn.disabled=!canCapture;
      frontBtn.textContent=frontReady?'FRONT ✓':'FRONT';
      frontBtn.classList.toggle('is-ready',frontReady);
    }
    if(rearBtn){
      rearBtn.disabled=!canCapture;
      rearBtn.textContent=rearReady?'REAR ✓':'REAR';
      rearBtn.classList.toggle('is-ready',rearReady);
    }
    if(submitBtn){
      submitBtn.disabled=!canCapture||!frontReady||!rearReady;
      submitBtn.hidden=!canCapture;
    }
    const status=getElement('rallyPhotoStatus');
    if(status){
      if(model.photoStatus)status.textContent=model.photoStatus;
      else if(frontReady&&rearReady)status.textContent='Both photos ready — save pair';
      else if(frontReady)status.textContent='Front ready — capture rear';
      else if(rearReady)status.textContent='Rear ready — capture front';
      else status.textContent=canCapture?'Capture front + rear photos':'';
    }
  }
}
