export function renderCheckpointOrder({container,rows,escapeHtml}){
  if(!container)return;
  container.innerHTML=rows.length?rows.map((feature,index)=>`<article data-checkpoint-id="${escapeHtml(feature.id)}"><span><b>${index+1}</b><strong>${escapeHtml(feature.name)}</strong><small>${feature.extreme?'21-point extreme':'10 points'} · ${escapeHtml(feature.status)}</small></span><div><button type="button" data-order-action="up" aria-label="Move ${escapeHtml(feature.name)} earlier" ${index===0?'disabled':''}>↑</button><button type="button" data-order-action="down" aria-label="Move ${escapeHtml(feature.name)} later" ${index===rows.length-1?'disabled':''}>↓</button><button type="button" data-order-action="next" aria-label="Make ${escapeHtml(feature.name)} next" ${['completed','skipped','unreachable'].includes(feature.status)?'disabled':''}>Next</button></div></article>`).join(''):'<p>No checkpoints are assigned to this day.</p>';
}

export function renderRally({getElement,model,escapeHtml}){
  if(!getElement('rallyMode'))return;
  const set=(id,value)=>getElement(id).textContent=value;
  set('rallyDay',model.day?`DAY ${model.day}`:'SELECT A DAY');
  set('rallyConnectivity',`${model.online?'Online':'Offline'} · ${model.gpsStatus}`);
  set('rallyScore',model.score);
  set('rallyNextName',model.next?.name||'No checkpoint selected');
  set('rallyNextDistance',model.distance===null?'Distance unavailable':`${model.distance.toFixed(1)} mi away`);
  set('rallyNextPoints',model.next?`${model.next.extreme?'EXTREME · ':''}${model.next.points} points · ${model.next.status}`:'—');
  set('rallyHotelEta',model.hotelLabel);set('rallyFuelStatus',model.fuelLabel);
  getElement('rallyFuelStatus').classList.toggle('warning',model.fuelWarning);
  set('rallyFeedAge',model.feedAge);
  for(const id of ['rallyDeferButton','rallyCompleteButton','rallySkipButton'])getElement(id).disabled=!model.next;
  getElement('rallyRestoreButton').hidden=!model.hasDeferred;getElement('rallyRestoreButton').disabled=!model.hasDeferred;
  getElement('goHotelButton').disabled=!model.hasHotel&&!model.hotelBailoutActive;
  set('goHotelButton',model.hotelBailoutActive?'UNDO HOTEL BAILOUT':'GO TO HOTEL');
  if(getElement('autoCompleteCheckpoints'))getElement('autoCompleteCheckpoints').checked=model.autoComplete;
  if(getElement('checkpointArrivalRadius'))getElement('checkpointArrivalRadius').value=model.arrivalRadius;
  if(getElement('checkpointMaxAccuracy'))getElement('checkpointMaxAccuracy').value=model.maxAccuracy;
  renderCheckpointOrder({container:getElement('checkpointOrderList'),rows:model.checkpoints,escapeHtml});
}
