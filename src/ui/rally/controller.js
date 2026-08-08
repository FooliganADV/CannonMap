export function wireRallyController({getElement,actions,windowTarget=window}){
  const on=(id,event,handler)=>getElement(id)?.addEventListener(event,handler);
  on('rallyNextButton','click',actions.selectNext);
  on('rallyDeferIcon','click',actions.defer);
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
  on('rallyResumeDeferredButton','click',actions.resumeDeferred);
  on('rallyFinishDayButton','click',actions.finishDay);
  on('rallyCameraCapturePair','click',actions.capturePair);
  on('rallyCameraFrontInput','change',event=>actions.addCameraSide?.('front',event.target.files?.[0]));
  on('rallyCameraRearInput','change',event=>actions.addCameraSide?.('rear',event.target.files?.[0]));
  on('rallyCameraFrontInput','cancel',()=>actions.cancelCamera?.('front'));
  on('rallyCameraRearInput','cancel',()=>actions.cancelCamera?.('rear'));
  on('rallyCameraInput','change',event=>actions.addTestCameraPair?.(event.target.files?.[0]));
  on('rallyCameraInput','cancel',()=>actions.cancelCamera?.());
  on('rallyCameraRetry','click',actions.capturePair);
  on('rallyCameraFailObjective','click',actions.failPhotoObjective);
  on('rallyStartNextDay','click',actions.startNextDay);
  on('rallyDebugExportButton','click',actions.exportDebug);
  on('rallyJournalExportButton','click',actions.exportJournal);
  on('rallyWarnings','click',event=>{
    const button=event.target.closest('button[data-warning-action]'),row=event.target.closest('[data-warning-id]');
    if(button&&row)actions.warning(row.dataset.warningId,button.dataset.warningAction);
  });
  for(const id of ['autoCompleteCheckpoints','checkpointArrivalRadius','checkpointMaxAccuracy'])on(id,'change',actions.saveArrivalSettings);
  on('checkpointOrderList','click',event=>{
    const button=event.target.closest('button[data-order-action]'),row=event.target.closest('[data-checkpoint-id]');
    if(button&&row)actions.order(row.dataset.checkpointId,button.dataset.orderAction);
  });
  on('resetCheckpointOrder','click',actions.resetOrder);
  windowTarget.addEventListener('online',actions.render);
  windowTarget.addEventListener('offline',actions.render);
}
