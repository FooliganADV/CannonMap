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
    fab.textContent=model.gpsActive?'GPS':'START';
    fab.classList.toggle('is-active',Boolean(model.gpsActive));
    fab.setAttribute('aria-label',model.gpsActive?'Recenter map on GPS':'Start GPS tracking');
  }
  for(const id of ['rallyDeferButton','rallyCompleteButton','rallySkipButton'])getElement(id).disabled=!model.next;
  getElement('rallyRestoreButton').hidden=!model.hasDeferred;getElement('rallyRestoreButton').disabled=!model.hasDeferred;
  getElement('goHotelButton').disabled=!model.hasHotel&&!model.hotelBailoutActive;
  set('goHotelButton',model.hotelBailoutActive?'UNDO HOTEL BAILOUT':'GO TO HOTEL');
  if(getElement('autoCompleteCheckpoints'))getElement('autoCompleteCheckpoints').checked=model.autoComplete;
  if(getElement('checkpointArrivalRadius'))getElement('checkpointArrivalRadius').value=model.arrivalRadius;
  if(getElement('checkpointMaxAccuracy'))getElement('checkpointMaxAccuracy').value=model.maxAccuracy;
  renderCheckpointOrder({container:getElement('checkpointOrderList'),rows:model.checkpoints,escapeHtml});
}
