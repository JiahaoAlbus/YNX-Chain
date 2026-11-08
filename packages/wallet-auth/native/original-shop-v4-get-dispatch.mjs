// Finite private extension of the ORIGINAL bounded pinned Native-node driver.
// No generic loop/stdio service, JS provider, caller expected, or new V4 wire.
import{createHash}from'node:crypto';
import{canonicalJSON}from'../src/canonical.js';
import{acquireOriginalShopV4GETServer,assertOriginalShopV4GETServerResult}from'../src/product-pair-session-v4-source.js';
import{OriginalReadOnlyChildDebtV4}from'../src/original-readonly-child-debt-v4.js';
const fail=code=>{throw Object.assign(Error(code),{code})};
function failure(cause){let firstKind='object',firstValue=null;if(cause===null)firstKind='null';else if(cause===undefined)firstKind='undefined';else if(typeof cause==='boolean'||typeof cause==='number'&&Number.isFinite(cause)){firstKind=typeof cause;firstValue=cause}return{code:typeof cause?.code==='string'&&/^[A-Z0-9_]{1,128}$/.test(cause.code)?cause.code:'SHOP_V4_DRIVER_FAILED',firstKind,firstValue};}
export async function dispatchOriginalShopV4GET(input){
 let owner=null,debt,originalRequest,ctx,result,first;
 const remember=cause=>{first??={cause}};
 try{
  if(!input||Object.getPrototypeOf(input)!==Object.prototype||Object.keys(input).sort().join('|')!=='operation|phase|requestOriginal'||input.operation!=='shop-original-product-session-get/v4'||!['VERIFY','CURRENT'].includes(input.phase)||typeof input.requestOriginal!=='string'||Buffer.byteLength(input.requestOriginal)>393216)fail('SHOP_V4_DRIVER_SCHEMA');
  originalRequest=JSON.parse(input.requestOriginal);if(canonicalJSON(originalRequest)!==input.requestOriginal)fail('SHOP_V4_DRIVER_CANONICAL_REQUEST');ctx=Object.freeze({signal:new AbortController().signal});
  const opened=await acquireOriginalShopV4GETServer();owner=opened.owner;if(owner!==null&&owner!==undefined)debt=new OriginalReadOnlyChildDebtV4(owner);assertOriginalShopV4GETServerResult(opened);
  result=await(input.phase==='VERIFY'?owner.verifyOriginalGET(originalRequest,ctx):owner.observeOriginalGET(originalRequest,ctx));
  if(result.nonceConsumed!==(input.phase==='VERIFY'))fail('SHOP_V4_DRIVER_PHASE');
 }catch(cause){remember(cause);if(owner&&cause!==null&&(typeof cause==='object'||typeof cause==='function')&&Object.hasOwn(cause,'partial'))result={authorization:cause.partial};}
 if(owner&&result?.authorization!==undefined)try{await owner.releaseOriginalGET(result.authorization,originalRequest,ctx)}catch(cause){remember(cause)}
 if(debt)try{await debt.drain()}catch(cause){remember(cause)}
 const header={version:1,phase:input?.phase??null,errorPresent:!!first};
 if(first)return Object.freeze({...header,failure:failure(first.cause),projection:null});
 if(!result||!debt?.closed)fail('SHOP_V4_DRIVER_PHYSICAL_DEBT');
 const{authorization,...projection}=result;
 return Object.freeze({...header,failure:null,projection:Object.freeze({...projection,requestDigest:createHash('sha256').update(input.requestOriginal).digest('hex'),sessionDigest:createHash('sha256').update(result.sessionOriginal).digest('hex'),dataOnly:true,authorized:false})});
}
