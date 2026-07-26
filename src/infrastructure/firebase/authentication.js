export function createFirebaseAuthentication({firebase,config,appName='cannonmap-secure-ingestion',appCheckSiteKey}={}){
  let app=null;
  let appCheck=null;
  const requireApi=()=>{
    if(!firebase?.initializeApp||!firebase?.auth)throw new Error('Firebase Authentication is unavailable.');
    if(!config||typeof config!=='object')throw new Error('CannonMap Firebase configuration is missing.');
  };
  const initialize=async()=>{
    requireApi();
    app=firebase.apps?.find(candidate=>candidate.name===appName)||firebase.initializeApp(config,appName);
    if(appCheckSiteKey&&typeof app.appCheck==='function'){
      appCheck=app.appCheck();
      appCheck.activate(appCheckSiteKey,true);
    }
    if(!app.auth().currentUser)await app.auth().signInAnonymously();
    return app.auth().currentUser;
  };
  return Object.freeze({
    initialize,
    async credentials(){
      const user=app?.auth().currentUser||await initialize();
      const authToken=await user.getIdToken();
      const appCheckToken=appCheck?(await appCheck.getToken(false)).token:null;
      return Object.freeze({uid:user.uid,authToken,appCheckToken});
    }
  });
}
