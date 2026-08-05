import {requestResult,transactionDone} from './request.js';
const STORE='finalizedProjects';
export function createFinalizedProjectRepository({database}={}){if(!database)throw new TypeError('database is required.');return Object.freeze({
  async create(record){const tx=database.transaction(STORE,'readwrite'),done=transactionDone(tx);await requestResult(tx.objectStore(STORE).add(structuredClone(record)));await done;return structuredClone(record);},
  async get(masterId){const tx=database.transaction(STORE,'readonly'),done=transactionDone(tx),row=await requestResult(tx.objectStore(STORE).get(String(masterId)));await done;return row?structuredClone(row):null;},
  async list(){const tx=database.transaction(STORE,'readonly'),done=transactionDone(tx),rows=await requestResult(tx.objectStore(STORE).getAll());await done;return rows.map(row=>structuredClone(row));}
});}
