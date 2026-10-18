// Transport budget only. This marker does not grant Source/Native/account authority.
import {canonicalJSON,exactFields,WalletAuthError} from './canonical.js';
import {ORIGINAL_PRIVATE_REFERENCE_CARRIER,originalPrivateReferenceBudget} from './original-wallet-service-private-reference.js';
export const ORIGINAL_PRIVATE_PQ_CARRIER='YNX-PRODUCT-SESSION-PRIVATE/v3';
const fail=()=>{throw new WalletAuthError('ORIGINAL_PRIVATE_REQUEST_INVALID','Original private carrier is invalid')};
export function originalPrivateCarrierBudget(input){
  if(input?.carrierVersion===ORIGINAL_PRIVATE_REFERENCE_CARRIER)return originalPrivateReferenceBudget(input);
  const pq=Object.hasOwn(input,'carrierVersion');
  exactFields(input,['requestId','operation','phase','body','proofHeader',...(pq?['carrierVersion']:[])],'Original private carrier');
  if(!pq)return Object.freeze({body:49152,envelope:65536,pq:false});
  if(input.carrierVersion!==ORIGINAL_PRIVATE_PQ_CARRIER||input.phase!=='effect'||!['beginYNX','handleReturn'].includes(input.operation)||input.proofHeader!==null||typeof input.body!=='string'||new TextEncoder().encode(input.body).length>196608)fail();
  let body;try{body=JSON.parse(input.body);}catch{fail();}
  if(canonicalJSON(body)!==input.body)fail();
  exactFields(body,input.operation==='beginYNX'?['request','approval']:['request','approval','completion'],'PQ private session body');
  if(body.request?.version!=='2'||body.approval?.version!=='3'||body.approval?.accountAuthorization?.algorithmVersion!=='YNX-BATCH/v0.1'||typeof body.approval?.walletProof!=='string')fail();
  return Object.freeze({body:196608,envelope:262144,pq:true});
}
export function originalPrivateSessionCarrier(input){
  if(input.phase==='effect'&&['beginYNX','handleReturn'].includes(input.operation)&&typeof input.body==='string'){
    let body;try{body=JSON.parse(input.body);}catch{fail();}
    if(body?.approval?.version==='3')return {...input,carrierVersion:ORIGINAL_PRIVATE_PQ_CARRIER};
  }
  return input;
}
