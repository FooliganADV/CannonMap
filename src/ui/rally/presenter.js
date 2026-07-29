export function renderCheckpointOrder({container,rows,escapeHtml}){
  if(!container)return;
  container.innerHTML=rows.length?rows.map((feature,index)=>{
    const notes=String(feature.notes||'').trim();
    const detail=feature.sequenceNeedsReview?'Manual day/order review needed':notes||feature.status;
    return `<article data-checkpoint-id="${escapeHtml(feature.id)}"><span><b>${index+1}</b><strong>${escapeHtml(feature.name)}</strong><small title="${escapeHtml(detail)}">${escapeHtml(detail)}</small></span><div><button type="button" data-order-action="up" aria-label="Move ${escapeHtml(feature.name)} earlier" ${index===0?'disabled':''}>↑</button><button type="button" data-order-action="down" aria-label="Move ${escapeHtml(feature.name)} later" ${index===rows.length-1?'disabled':''}>↓</button><button type="button" data-order-action="next" aria-label="Make ${escapeHtml(feature.name)} next" ${['completed','skipped','unreachable'].includes(feature.status)?'disabled':''}>Next</button></div></article>`;
  }).join(''):'<p>No checkpoints are assigned to this day.</p>';
}

export const CHECKPOINT_VISUAL_CLASSES=Object.freeze({
  standard:'is-standard',
  extreme:'is-extreme',
  offroad:'is-offroad',
  finish:'is-finish',
  none:'is-none'
});

export function checkpointVisualKind(next){
  if(!next)return 'none';
  if(next.type==='hotel'||next.dayFinish===true)return 'finish';
  if(next.extreme)return 'extreme';
  const classification=String(next.checkpointType||next.classification||next.routeClass||'').toLowerCase();
  if(/dirt|off.?road/.test(`${classification} ${next.name||''} ${next.notes||''}`))return 'offroad';
  return 'standard';
}

function checkpointHint(next){
  if(!next)return 'Select Next to load the active day checkpoint.';
  const notes=String(next.notes||'').trim();
  if(notes)return notes.length>72?`${notes.slice(0,69)}…`:notes;
  return 'No checkpoint notes.';
}

export function renderRally({getElement,model,escapeHtml}){
  if(!getElement('rallyMode'))return;
  const set=(id,value)=>{const el=getElement(id);if(el)el.textContent=value;};
  const kind=checkpointVisualKind(model.next);
  set('rallyNextType','NEXT CHECKPOINT');
  set('rallyNextName',model.next?.name||'No checkpoint selected');
  set('rallyNextDistance',model.distance===null?'Distance unavailable':`${model.distance.toFixed(1)} mi away`);
  set('rallyNextPoints',model.next?.type==='hotel'||model.next?.dayFinish===true?'Day finish':model.next?`${model.next.points} points`:'—');
  set('rallyNextHint',checkpointHint(model.next));
  set('rallyHotelEta',model.hotelLabel);
  set('rallyFeedAge',model.feedAge);
  const card=getElement('rallyPrimaryCard')||getElement('rallyMode')?.querySelector?.('.rally-primary-card');
  if(card?.classList){
    for(const name of Object.values(CHECKPOINT_VISUAL_CLASSES))card.classList.toggle(name,false);
    card.classList.toggle(CHECKPOINT_VISUAL_CLASSES[kind],true);
    card.setAttribute?.('data-checkpoint-kind',kind);
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
}
