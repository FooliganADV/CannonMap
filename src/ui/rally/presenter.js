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
const operationalWarnings=model=>[
  ...(model.warnings||[]),
  ...(!model.online?['Offline — live intelligence is paused.']:[]),
  ...(/error/i.test(model.gpsStatus||'')?['GPS unavailable — automatic capture may require manual completion.']:[])
].filter(Boolean);

export function renderRally({getElement,model,escapeHtml}){
  if(!getElement('rallyMode'))return;
  const set=(id,value)=>{const el=getElement(id);if(el)el.textContent=value;};
  const kind=checkpointKind(model.next);
  set('rallyDay',model.day?`DAY ${model.day}`:'SELECT A DAY');
  set('rallyConnectivity',`${model.online?'Online':'Offline'} · ${model.gpsStatus}`);
  set('rallyScore',model.score);
  set('rallyNextName',model.next?.name||'No checkpoint selected');
  set('rallyNextDistance',model.distance===null?'Distance unavailable':`${model.distance.toFixed(1)} mi away`);
  set('rallyRiderNotes',text(model.next?.notes)||'No rider notes.');
  set('rallyRouteIntelligence',text(model.routeIntelligence)||'Backbone route active. Live route intelligence is not yet available.');
  const warnings=operationalWarnings(model),warningList=getElement('rallyWarnings');
  if(warningList)warningList.innerHTML=(warnings.length?warnings:['No active operational warnings.'])
    .map(item=>`<li>${escapeHtml(item)}</li>`).join('');
  getElement('rallyWarningsSection')?.classList.toggle('has-warnings',warnings.length>0);
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
  for(const id of ['rallyDeferIcon','rallyCompleteButton','rallySkipButton']){
    const el=getElement(id);if(el)el.disabled=!model.next;
  }
  const restore=getElement('rallyRestoreButton');
  if(restore){restore.hidden=!model.hasDeferred;restore.disabled=!model.hasDeferred;}
  const goHotel=getElement('goHotelButton');
  if(goHotel){
    goHotel.disabled=!model.hasHotel&&!model.hotelBailoutActive;
    goHotel.textContent=model.hotelBailoutActive?'UNDO HOTEL BAILOUT':'GO TO HOTEL';
  }
  const nextButton=getElement('rallyNextButton');
  if(nextButton)nextButton.hidden=Boolean(model.next)||!model.hasPlanned;
  if(getElement('autoCompleteCheckpoints'))getElement('autoCompleteCheckpoints').checked=model.autoComplete;
  if(getElement('checkpointArrivalRadius'))getElement('checkpointArrivalRadius').value=model.arrivalRadius;
  if(getElement('checkpointMaxAccuracy'))getElement('checkpointMaxAccuracy').value=model.maxAccuracy;
  renderCheckpointOrder({container:getElement('checkpointOrderList'),rows:model.checkpoints,escapeHtml});
}
