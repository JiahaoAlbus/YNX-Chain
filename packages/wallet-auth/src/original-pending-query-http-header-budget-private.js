// Transport DATA budget only. No proof parsing, permission or Source acquisition.
// E13's fixed header literal is mirrored without importing an in-progress codec.
const PROOF='x-ynx-product-pair-original-query-proof-v1';
const PATH='/v4/product-pairs/original-query';
const MAX_TOTAL=147456,MAX_PROOF=131072,MAX_ORDINARY=16384;
export function withOriginalPendingQueryHTTPHeaderBudget(listener){
 if(typeof listener!=='function')throw new TypeError('ORIGINAL_HTTP_LISTENER_REQUIRED');
 return function originalPendingQueryHeaderBudget(request,response){
  const raw=request.rawHeaders;
  // Node's parser budget also covers the original request target. Preserve that
  // bound for other routes when the common parser is enlarged for fixed PQ.
  const line=Buffer.byteLength(request.method+' '+request.url+' HTTP/'+request.httpVersion+'\r\n');
  let total=2+line,other=2,proofs=0,proofBytes=0;
  if(Array.isArray(raw)&&raw.length%2===0){for(let i=0;i<raw.length;i+=2){if(typeof raw[i]!=='string'||typeof raw[i+1]!=='string'){total=Infinity;break;}const n=Buffer.byteLength(raw[i])+Buffer.byteLength(raw[i+1])+4;total+=n;if(raw[i].toLowerCase()===PROOF){proofs++;proofBytes+=Buffer.byteLength(raw[i+1]);}else other+=n;}}
  else total=Infinity;
  const query=request.method==='POST'&&request.url===PATH;
  // Exact raw route, never URL-normalize an alternate request into this exception.
  const allowed=proofs<=1&&total<=MAX_TOTAL&&(query?(proofs===1&&proofBytes<=MAX_PROOF&&other<=MAX_ORDINARY):total<=MAX_ORDINARY);
  if(!allowed){response.writeHead(431,{'connection':'close','cache-control':'no-store','content-type':'application/json; charset=utf-8'});response.end('{"error":{"code":"ORIGINAL_HTTP_HEADER_BUDGET_REFUSED"},"ok":false}');return;}
  return Reflect.apply(listener,this,[request,response]);
 };
}
