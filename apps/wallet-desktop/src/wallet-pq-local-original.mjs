const fail=code=>{throw Object.assign(Error(code),{code,data:{code}});};
// This view reports custody only. It neither verifies signatures nor performs
// a network query; submitted/UNKNOWN originals keep their existing controller.
export async function inspectRetainedPQOriginal(submissions,hash,account,guard){
  if(!/^0x[0-9a-f]{64}$/.test(hash??'')||!/^0x[0-9a-f]{40}$/.test(account??'')||guard?.account!==account||typeof guard?.assert!=='function')fail('PQ_READ_BINDING_REQUIRED');
  guard.assert();const store=submissions?.intentStore;
  if(typeof store?.readPQOriginals!=='function'||typeof store?.readPQProgress!=='function')fail('PQ_READ_SOURCE_UNAVAILABLE');
  const originals=await store.readPQOriginals(account,()=>guard.assert());guard.assert();
  const original=originals.find(row=>row.account===account&&row.hash===hash);
  if(!original)fail('TRANSACTION_INTENT_REQUIRED');
  if(original.kind==='pq-typed-action')return submissions.checkPQ(hash,account,guard);
  if(!['pq-transfer','pq-migration','pq-revocation'].includes(original.kind))fail('PQ_READ_BINDING_REQUIRED');
  const progress=await store.readPQProgress(account,hash,()=>guard.assert());guard.assert();
  if(progress.account!==account||progress.hash!==hash||progress.kind!==original.kind||progress.status!=='signed-unsubmitted')fail('PQ_ORIGINAL_PROGRESS_QUERY_REQUIRED');
  return Object.freeze({account,hash,kind:original.kind,outcome:'original-retained-locally',networkQueryPerformed:false,signatureVerified:false,retryAuthorized:false,clearsOriginal:false,consensusFinality:false});
}
