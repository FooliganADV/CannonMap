export function readLegacyConfidenceMigrationInput({value,source,readAt}={}){
  if(!Number.isFinite(value)||value<0||value>1)throw new TypeError('Legacy confidence must be a scalar between 0 and 1.');
  if(typeof source!=='string'||!source)throw new TypeError('Legacy confidence migration requires its source.');
  if(!Number.isInteger(readAt)||readAt<0)throw new TypeError('Legacy confidence migration requires an integer readAt timestamp.');
  return Object.freeze({
    kind:'legacy-confidence-migration-input',
    originalValue:value,
    source,
    readAt,
    authoritative:false,
    dimensionMappings:Object.freeze({})
  });
}
