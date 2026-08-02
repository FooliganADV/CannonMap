export function wireProjectController({getElement,actions}){
  getElement('gpxInput').addEventListener('change',event=>{
    actions.importGpx([...event.target.files]);
    event.target.value='';
  });
  getElement('projectInput').addEventListener('change',event=>{
    const file=event.target.files[0];
    if(file)actions.openProject(file);
    event.target.value='';
  });
  getElement('saveButton').addEventListener('click',()=>actions.saveProject(true));
  getElement('saveProjectFileButton').addEventListener('click',actions.exportProject);
  getElement('reassignDaysButton').addEventListener('click',actions.reassignDays);
  getElement('exportAllButton').addEventListener('click',actions.exportGpx);
  getElement('exportGarminButton').addEventListener('click',actions.exportGarmin);
  getElement('exportExcelButton').addEventListener('click',actions.exportExcel);
  getElement('exportCsvButton').addEventListener('click',actions.exportCsv);
  getElement('importForm').addEventListener('submit',event=>{
    event.preventDefault();
    const mode=event.submitter?.value||'cancel';
    getElement('importDialog').close(mode);
    if(mode!=='cancel')actions.applyImport(mode);
    else actions.cancelImport();
  });
}
