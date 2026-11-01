// Transport DATA only. Fixed original receivers still own proof/body/current checks.
const PENDING_PROOF='x-ynx-product-pair-original-query-proof-v1';
const MANAGEMENT_PROOF='x-ynx-product-session-proof-v4';
const PENDING_PATH='/v4/product-pairs/original-query';
const MANAGEMENT_PATHS=new Set(['/v4/product-sessions/active','/v4/product-sessions/recover','/v4/product-sessions/revoke','/v4/product-session-challenges/cancel']);
const MAX_GLOBAL=262144,MAX_ORDINARY=16384;
export function withOriginalPendingQueryHTTPHeaderBudget(listener){
 if(typeof listener!=='function')throw new TypeError('ORIGINAL_HTTP_LISTENER_REQUIRED');
 return function originalPendingQueryHeaderBudget(request,response){
  const pending=request.method==='POST'&&request.url===PENDING_PATH;
  const management=request.method==='POST'&&MANAGEMENT_PATHS.has(request.url);
  const selected=pending?PENDING_PROOF:management?MANAGEMENT_PROOF:null;
  const maxTotal=pending?147456:management?262144:MAX_ORDINARY,maxProof=pending?131072:196608;
  let total=2+Buffer.byteLength(request.method+' '+request.url+' HTTP/'+request.httpVersion+'\r\n'),other=2,proofs=0,proofBytes=0,pendingCount=0,managementCount=0;
  const raw=request.rawHeaders;
  if(Array.isArray(raw)&&raw.length%2===0){for(let i=0;i<raw.length;i+=2){if(typeof raw[i]!=='string'||typeof raw[i+1]!=='string'){total=Infinity;break;}const name=raw[i].toLowerCase(),n=Buffer.byteLength(raw[i])+Buffer.byteLength(raw[i+1])+4;total+=n;if(name===PENDING_PROOF)pendingCount++;if(name===MANAGEMENT_PROOF)managementCount++;if(name===selected){proofs++;proofBytes+=Buffer.byteLength(raw[i+1]);}else other+=n;}}
  else total=Infinity;
  // Never normalize paths or exchange the two original proof families. The
  // finite receiver body caps remain in their actual protected Auth handlers.
  const allowed=total<=MAX_GLOBAL&&total<=maxTotal&&pendingCount<=1&&managementCount<=1&&(selected?(proofs===1&&proofBytes<=maxProof&&other<=MAX_ORDINARY&&(pending?managementCount===0:pendingCount===0)):true);
  if(!allowed){response.writeHead(431,{'connection':'close','cache-control':'no-store','content-type':'application/json; charset=utf-8'});response.end('{"error":{"code":"ORIGINAL_HTTP_HEADER_BUDGET_REFUSED"},"ok":false}');return;}
  return Reflect.apply(listener,this,[request,response]);
 };
}
