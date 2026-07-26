import {onRequest} from 'firebase-functions/v2/https';
import {getApps,initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getAppCheck} from 'firebase-admin/app-check';
import {getDatabase} from 'firebase-admin/database';
import {createIngestObservation,createRealtimeIngestionRepository} from './src/ingest-observation.js';

if(!getApps().length)initializeApp();
const database=getDatabase();
const ingest=createIngestObservation({repository:createRealtimeIngestionRepository(database)});
const allowedOrigins=new Set(String(process.env.CANNONMAP_ALLOWED_ORIGINS||'').split(',').map(value=>value.trim()).filter(Boolean));

export const ingestObservation=onRequest({region:'us-central1',timeoutSeconds:30,memory:'256MiB',maxInstances:20},async(req,res)=>{
  const origin=req.get('origin');
  if(origin&&allowedOrigins.has(origin)){
    res.set('Access-Control-Allow-Origin',origin);
    res.set('Vary','Origin');
  }
  if(req.method==='OPTIONS'){
    if(!origin||!allowedOrigins.has(origin))return res.status(403).end();
    res.set('Access-Control-Allow-Headers','Authorization, Content-Type, Idempotency-Key, X-Firebase-AppCheck');
    res.set('Access-Control-Allow-Methods','POST');
    return res.status(204).end();
  }
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed.'});
  if(origin&&!allowedOrigins.has(origin))return res.status(403).json({error:'Origin is not allowed.'});
  try{
    const bearer=String(req.get('authorization')||'').match(/^Bearer (.+)$/i)?.[1];
    const appCheckToken=req.get('x-firebase-appcheck');
    const [auth,appCheck]=await Promise.all([
      bearer?getAuth().verifyIdToken(bearer):null,
      appCheckToken?getAppCheck().verifyToken(appCheckToken):null
    ]);
    const result=await ingest({
      auth,appCheck,observation:req.body?.observation,
      idempotencyKey:req.get('idempotency-key'),
      requestBytes:Number(req.get('content-length'))||Buffer.byteLength(JSON.stringify(req.body||{}))
    });
    return res.status(result.status).json(result.error?{error:result.error,details:result.details}:{receipt:result.receipt,replayed:result.replayed});
  }catch(error){
    console.warn('secure-ingestion-rejected',{name:error?.name||'Error',code:error?.code||'unknown'});
    return res.status(401).json({error:'Authentication or App Check verification failed.'});
  }
});
