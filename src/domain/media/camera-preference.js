export const CAMERA_FRONT='front';
export const CAMERA_REAR='rear';

export function normalizeCameraPreference(value){return value===CAMERA_REAR?CAMERA_REAR:CAMERA_FRONT;}
export function cameraCaptureAttribute(value){return normalizeCameraPreference(value)===CAMERA_REAR?'environment':'user';}

/** File inputs normally do not expose the selected lens. Native/test adapters may attach this hint. */
export function detectActualCamera(file){
  const hint=file?.cameraFacingMode??file?.actualCamera??file?.metadata?.cameraFacingMode;
  if(hint==='user'||hint==='front')return CAMERA_FRONT;
  if(hint==='environment'||hint==='rear')return CAMERA_REAR;
  return 'unknown';
}

export function cameraSelectionMetadata(preference,file){
  const requestedCamera=normalizeCameraPreference(preference),actualCamera=detectActualCamera(file);
  return Object.freeze({requestedCamera,actualCamera,cameraSelectionHonored:actualCamera==='unknown'?'unknown':actualCamera===requestedCamera,captureMethod:'file-input'});
}
