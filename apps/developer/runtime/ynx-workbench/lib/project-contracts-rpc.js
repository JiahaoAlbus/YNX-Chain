'use strict';
const {valid}=require('./contract-request-protocol');
// Uses the existing project service connection; closing this view cancels only
// its own waits and never creates a second inherited-fd reader.
function createProjectContractsRPC(rpc,target){
 const active=new Set();let closed=false;
 return {async call(action,body={}){
  if(closed||!valid(action,body))throw Object.assign(Error('Project contract request unavailable'),{code:'IDE_CONTRACT_SERVICE_UNAVAILABLE'});
  const id=target.crypto.randomUUID();active.add(id);
  try{return await rpc.read(id,'contract',{action,body});}finally{active.delete(id);}
 },close(){if(closed)return;closed=true;for(const id of active)rpc.cancel(id);active.clear();}};
}
module.exports={createProjectContractsRPC};
