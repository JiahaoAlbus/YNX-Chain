import {types} from 'node:util';
// Diagnostics only. This function cannot create/brand/recheck a policy, choose
// a provider, inspect raw account/authorization data or suppress any error.
const observations=new WeakSet();
const known=new Set([
 'AUTH_POLICY_TLS_PIN','AUTH_POLICY_OPERATOR_VERSION_OR_HEALTH_CHANGED','AUTH_POLICY_SOURCE_NETWORK',
 'AUTH_POLICY_SOURCE_NOT_SUPPLIED','AUTH_POLICY_QUERY_TIMEOUT','AUTH_POLICY_QUERY_SIZE','AUTH_POLICY_QUERY_UTF8','AUTH_POLICY_QUERY_JSON',
 'AUTH_POLICY_QUERY_SCHEMA','AUTH_POLICY_QUERY_U64','AUTH_POLICY_QUERY_INCOMPLETE','AUTH_POLICY_QUERY_UNHEALTHY',
 'AUTH_POLICY_QUERY_HEIGHT','AUTH_POLICY_QUERY_REORG','AUTH_POLICY_QUERY_REVOCATION_MISMATCH','AUTH_POLICY_QUERY_REVOCATION_STATUS_MISMATCH','AUTH_POLICY_QUERY_COMMITTED_MISMATCH',
 'AUTH_POLICY_SOURCE_EXPIRED','AUTH_POLICY_SOURCE_RETIRED','AUTH_POLICY_ORIGINAL_JSON',
 'AUTH_TX_POLICY_BYTES','AUTH_TX_POLICY_SCHEMA','AUTH_TX_POLICY_BINDING','AUTH_TX_POLICY_EXPIRED','AUTH_TX_POLICY_TIME','AUTH_TX_POLICY_SOURCE','AUTH_TX_POLICY_CLOCK',
 'ECONNRESET','ECONNREFUSED','ENOTFOUND','ETIMEDOUT','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE'
]);
const own=(v,k)=>{if(!v||(typeof v!=='object'&&typeof v!=='function')||types.isProxy(v))return undefined;const d=Object.getOwnPropertyDescriptor(v,k);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
function observation(v){
 if(!v||typeof v!=='object'||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)return null;
 const kind=own(v,'kind'),method=own(v,'method'),routeKind=own(v,'routeKind'),reason=own(v,'reason'),httpStatus=own(v,'httpStatus'),contentType=own(v,'contentType'),noStore=own(v,'noStore');
 if(kind!=='YNX_OPERATOR_READ_REFUSAL/v1'||method!=='GET'||!['status','genesis-block','account-authorization','transaction-lookup','public-metadata'].includes(routeKind)||!['http-status','content-type','missing-no-store'].includes(reason)||!(httpStatus===null||Number.isInteger(httpStatus)&&httpStatus>=100&&httpStatus<=599)||typeof contentType!=='string'||!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$|^unknown$/.test(contentType)||typeof noStore!=='boolean')return null;
 return Object.freeze({kind,method,routeKind,reason,httpStatus,contentType,noStore});
}
export function describeWalletTransactionPolicyRefusal(failure){
 let code='UNKNOWN',read=null;const seen=new Set();let current=failure;
 for(let depth=0;depth<4;depth++){
  if(seen.has(current))break;seen.add(current);
  const candidate=own(current,'code'),message=own(current,'message');
  if(typeof candidate==='string'&&known.has(candidate))code=candidate;
  else if(typeof message==='string'&&known.has(message))code=message;
  read??=observation(own(current,'operatorReadObservation'));
  const next=own(current,'cause');if(next===undefined)break;current=next;
 }
 const stage=read?.routeKind??(code==='AUTH_POLICY_TLS_PIN'?'tls':code==='AUTH_POLICY_OPERATOR_VERSION_OR_HEALTH_CHANGED'?'operator-health':code==='UNKNOWN'?'unknown':'source-or-policy');
 const value=Object.freeze({version:'AUTH_WALLET_TRANSACTION_POLICY_REFUSAL/v1',failurePresent:true,originalFailureKind:failure===null?'null':typeof failure,originalNumericZero:typeof failure==='number'&&failure===0,code,stage,operatorReadObservation:read,policyAvailable:false});observations.add(value);return value;
}

// Only locally produced, in-process diagnostics may be reduced to UI facts.
export function projectWalletPolicyFailure(observation){
 if(!observations.has(observation))return null;
 const read=observation.operatorReadObservation;
 if(read?.routeKind==='account-authorization'&&read.reason==='http-status'&&read.httpStatus===405)return 'AUTHORIZATION_HTTP_405';
 if(['AUTH_POLICY_TLS_PIN','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(observation.code))return 'TLS_IDENTITY_FAILED';
 if(['ECONNRESET','ECONNREFUSED','ENOTFOUND'].includes(observation.code))return 'CONNECTION_FAILED';
 return null;
}
