export function createFeatureFlags({read=()=>false}={}){
  return Object.freeze({
    isEnabled:key=>read(key)===true
  });
}
