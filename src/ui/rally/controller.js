export function wireRallyController({getElement,actions,windowTarget=window}){
  const on=(id,event,handler)=>getElement(id)?.addEventListener(event,handler);
  on('rallyNextButton','click',actions.selectNext);
  on('rallyDeferButton','click',actions.defer);
  on('rallyWeatherButton','click',()=>actions.setIntelOpen(true));
  on('rallyHotelButton','click',actions.focusHotel);
  on('rallyRecenterFab','click',()=>{
    const status=getElement('gpsStatus');
    const text=(status?.textContent||'').toLowerCase();
    const isOff=!status||text.includes('off')||text.includes('starting')||text.includes('error');
    if(isOff){
      if(typeof actions.startGps==='function'){
        actions.startGps();
      }else{
        const gpsBtn=getElement('gpsButton');
        if(gpsBtn)gpsBtn.click();
      }
    }else if(typeof actions.center==='function'){
      actions.center();
    }
  });
  on('rallyMoreButton','click',actions.toggleMore);
  on('rallyPlannerButton','click',actions.openPlanner);
  on('goHotelButton','click',actions.toggleHotelBailout);
  on('rallyCompleteButton','click',actions.complete);
  on('rallyRestoreButton','click',actions.restore);
  on('rallySkipButton','click',actions.skip);
  for(const id of ['autoCompleteCheckpoints','checkpointArrivalRadius','checkpointMaxAccuracy'])on(id,'change',actions.saveArrivalSettings);
  on('checkpointOrderList','click',event=>{
    const button=event.target.closest('button[data-order-action]'),row=event.target.closest('[data-checkpoint-id]');
    if(button&&row)actions.order(row.dataset.checkpointId,button.dataset.orderAction);
  });
  on('resetCheckpointOrder','click',actions.resetOrder);
  windowTarget.addEventListener('online',actions.render);
  windowTarget.addEventListener('offline',actions.render);
}
