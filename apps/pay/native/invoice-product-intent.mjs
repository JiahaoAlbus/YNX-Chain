import {types} from 'node:util';
const fail=()=>{throw Object.assign(Error('NATIVE_PAY_ORIGINAL_PRODUCT_INTENT_INVALID'),{code:'NATIVE_PAY_ORIGINAL_PRODUCT_INTENT_INVALID'});};
const fields=['productId','sourceOrder','merchant','recipient','genesis','nativeChainId','assetId','unitVersion','amountAtoms','domainData'];
const uint=value=>typeof value==='string'&&/^[1-9][0-9]{0,19}$/.test(value)&&BigInt(value)<=18446744073709551615n;
function descriptors(value,domain=false){
 if(!value||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype&&!(domain&&Object.getPrototypeOf(value)===null))fail();
 const d=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(d).some(k=>typeof k!=='string'||!Object.hasOwn(d[k],'value')||!d[k].enumerable))fail();
 return d;
}
// A detached bounded copy of original product DATA, never a Source brand or
// approval. Reading this object cannot execute getters/toJSON/proxy traps.
export function nativeInvoiceProductIntentData(value){
 const d=descriptors(value),keys=Object.keys(d);
 if(fields.some(k=>!Object.hasOwn(d,k))||keys.some(k=>!fields.includes(k)&&k!=='storeId'))fail();
 const out={};for(const k of keys)if(k!=='domainData'){if(typeof d[k].value!=='string')fail();out[k]=d[k].value;}
 const id=v=>/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(v??'');
 if(!id(out.productId)||!id(out.sourceOrder)||out.storeId!==undefined&&!id(out.storeId)||
  !/^0x[0-9a-f]{40}$/.test(out.merchant)||!/^0x[0-9a-f]{40}$/.test(out.recipient)||
  !/^[0-9a-f]{64}$/.test(out.genesis)||!uint(out.nativeChainId)||!uint(out.amountAtoms)||out.assetId!=='YNXT'||out.unitVersion!=='1')fail();
 let nodes=0;const seen=new Set();
 function copy(v,depth=0){
  if(++nodes>4096||depth>16)fail();
  if(v===null||typeof v==='string'||typeof v==='boolean')return v;
  if(typeof v==='number'){if(!Number.isFinite(v))fail();return v;}
  if(!v||typeof v!=='object'||types.isProxy(v)||seen.has(v))fail();
  seen.add(v);let result;
  if(Array.isArray(v)){
   const d=Object.getOwnPropertyDescriptors(v),n=d.length.value;
   if(Reflect.ownKeys(d).length!==n+1)fail();result=[];
   for(let i=0;i<n;i++){const p=d[String(i)];if(!p||!Object.hasOwn(p,'value')||!p.enumerable)fail();result.push(copy(p.value,depth+1));}
  }else{const d=descriptors(v,true);result=Object.create(null);for(const k of Object.keys(d))result[k]=copy(d[k].value,depth+1);}
  seen.delete(v);return Object.freeze(result);
 }
 descriptors(d.domainData.value,true);out.domainData=copy(d.domainData.value);
 if(Buffer.byteLength(JSON.stringify(out.domainData))>64*1024)fail();
 // Fixed top-level order also keeps original create and lookup bodies equal.
 return Object.freeze(Object.fromEntries(['productId','storeId',...fields.slice(1)].filter(k=>out[k]!==undefined).map(k=>[k,out[k]])));
}

export function assertNativeInvoiceIntentView(value,original){
 const request=nativeInvoiceProductIntentData(original),saved=nativeInvoiceProductIntentData(value?.request);
 if(JSON.stringify(saved)!==JSON.stringify(request)||!/^npi_[0-9a-f]{48}$/.test(value?.intentId??'')||value.originalOperation!==value.intentId||
  value.merchant!==request.merchant||!['PREPARED','ISSUED'].includes(value.state)||typeof value.phase!=='string'||!value.phase||value.phase.length>96||
  value.terms?.recipient!==request.recipient||value.terms.amountAtoms!==request.amountAtoms||value.terms.assetId!==request.assetId||value.terms.unitVersion!==request.unitVersion)fail();
 return value;
}
