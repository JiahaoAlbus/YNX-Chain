import {canonicalJSON,WalletAuthError} from './canonical.js';
import {evmAddressFromYNX} from './crypto.js';
import {exactPQRecord} from './pq-wallet-contract.js';
import {registerAccountPolicyObservation,readAccountPolicyObservation} from './product-session-account-private.js';
const fail=code=>{throw new WalletAuthError(code,code)};
const integer=value=>{if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(value)||BigInt(value)>(1n<<64n)-1n)fail('ACCOUNT_POLICY_INTEGER_INVALID');return BigInt(value)};
const hex=(value,n)=>{if(typeof value!=='string'||!new RegExp('^[0-9a-f]{'+n*2+'}$').test(value))fail('ACCOUNT_POLICY_HEX_INVALID');return value};
const instant=value=>{if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)fail('ACCOUNT_POLICY_TIME_INVALID');return value};
function parseOriginal(value,expected,at){
  exactPQRecord(value,['version','networkId','canonicalOwner','checkpoint','policyVersion','algorithmVersion','activeRecord','observedAt','expiresAt']);
  exactPQRecord(value.checkpoint,['kind','height','blockHash']);
  if(value.version!=='YNX-PRODUCT-SESSION-ACCOUNT-POLICY/v1'||value.networkId!==expected.networkId||value.canonicalOwner!==evmAddressFromYNX(expected.account)||
    !['legacy','YNX-BATCH/v0.1'].includes(value.algorithmVersion)||value.checkpoint.kind!=='trusted-node-committed/v1')fail('ACCOUNT_POLICY_BINDING_INVALID');
  const height=integer(value.checkpoint.height),observedAt=instant(value.observedAt),expiresAt=instant(value.expiresAt);
  if(observedAt>at.toISOString()||expiresAt<=at.toISOString()||expiresAt<=observedAt)fail('ACCOUNT_POLICY_EXPIRED');
  let activeRecord=null;
  if(value.algorithmVersion==='legacy'){
    if(value.activeRecord!==null||![null,'YNX-ACCOUNT-POLICY/v1'].includes(value.policyVersion))fail('ACCOUNT_POLICY_ACTIVE_INVALID');
  }else{
    if(value.policyVersion!=='YNX-ACCOUNT-POLICY/v1')fail('ACCOUNT_POLICY_ACTIVE_INVALID');
    const r=value.activeRecord;exactPQRecord(r,['revision','registeredAt','activeFrom','pkA','pkB']);
    if(!integer(r.revision)||integer(r.registeredAt)>=integer(r.activeFrom)||integer(r.activeFrom)>height)fail('ACCOUNT_POLICY_ACTIVE_INVALID');
    activeRecord=Object.freeze({revision:r.revision,registeredAt:r.registeredAt,activeFrom:r.activeFrom,pkA:hex(r.pkA,2592),pkB:hex(r.pkB,64)});
  }
  return Object.freeze({version:value.version,networkId:hex(value.networkId,32),canonicalOwner:value.canonicalOwner,
    checkpoint:Object.freeze({kind:value.checkpoint.kind,height:value.checkpoint.height,blockHash:hex(value.checkpoint.blockHash,32)}),policyVersion:value.policyVersion,
    algorithmVersion:value.algorithmVersion,activeRecord,observedAt,expiresAt});
}
// Borrow an ORIGINAL server-only resource, not a JSON authority claim. Its
// normal producer must establish node provenance, commit and reorg semantics;
// structural checks here cannot supply them. This function creates no grant.
export function captureProductSessionAccountPolicy(resource,expected,at=new Date()){
  exactPQRecord(expected,['networkId','account']);hex(expected.networkId,32);evmAddressFromYNX(expected.account);
  if(!(at instanceof Date)||!Number.isFinite(at.getTime()))fail('ACCOUNT_POLICY_TIME_INVALID');
  if(!resource||['readOriginal','assertCurrent','recheck','retire','join','close'].some(k=>typeof resource[k]!=='function'))fail('ACCOUNT_POLICY_SOURCE_NOT_SUPPLIED');
  if(resource.assertCurrent()!==undefined)fail('ACCOUNT_POLICY_CURRENT_REFUSED');
  const fixed=Object.freeze({...expected}),view=parseOriginal(resource.readOriginal(),fixed,at),bytes=canonicalJSON(view);
  return registerAccountPolicyObservation(view,current=>{
    if(!(current instanceof Date)||!Number.isFinite(current.getTime())||current.toISOString()<view.observedAt||current.toISOString()>=view.expiresAt)fail('ACCOUNT_POLICY_EXPIRED');
    if(resource.assertCurrent()!==undefined)fail('ACCOUNT_POLICY_CURRENT_REFUSED');
    if(canonicalJSON(parseOriginal(resource.readOriginal(),fixed,current))!==bytes)fail('ACCOUNT_POLICY_CHANGED');
  });
}
export function readProductSessionAccountPolicy(ref,account,at=new Date()){return readAccountPolicyObservation(ref,account,at)}
