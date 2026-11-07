// Independent issuer qualification. Never requires a consumer resource current9.
import {canonical,sha} from './original-auth-identity-source-verifier.mjs';
import {inspectNetworkResourceCurrentPublisherDescriptorV1DATA} from './original-network-resource-current-witness-v1.mjs';
export const NETWORK_CURRENT_PUBLISHER_SOURCE_PURPOSE='network-resource-current-publisher-source-v1';
export const NETWORK_CURRENT_PUBLISHER_SELECTION_KEY='networkResourceCurrentPublisherV1';
export const NETWORK_CURRENT_PUBLISHER_OPERATIONS=Object.freeze(['resource.current.publish']);
const fail=code=>{throw Object.assign(Error(code),{code});};
function exact(v,keys){
 if(!v||Object.getPrototypeOf(v)!==Object.prototype)fail('NETWORK_PUBLISHER_SCHEMA');
 const d=Object.getOwnPropertyDescriptors(v),k=Reflect.ownKeys(d);
 if(k.length!==keys.length||k.some(x=>!keys.includes(x)||!Object.hasOwn(d[x],'value')||!d[x].enumerable))fail('NETWORK_PUBLISHER_SCHEMA');
}
const token=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(v);
export function inspectOriginalNetworkCurrentPublisherScopeV1DATA(scope,association,networkId,subjectOwner,issuerSourceId,issuerInstanceId,currentOwner){
 exact(scope,['version','networkId','subjectOwner','sourceId','instanceId','operation','descriptor']);
 const descriptor=inspectNetworkResourceCurrentPublisherDescriptorV1DATA(scope.descriptor);
 if(scope.version!==1||scope.operation!==NETWORK_CURRENT_PUBLISHER_OPERATIONS[0]||scope.networkId!==networkId||scope.subjectOwner!==subjectOwner||subjectOwner!==currentOwner||descriptor.publisherOwner!==currentOwner||descriptor.networkId!==networkId||scope.sourceId!==issuerSourceId||scope.instanceId!==issuerInstanceId||!token(issuerSourceId)||!token(issuerInstanceId))fail('NETWORK_PUBLISHER_ISSUER_BINDING');
 // The issuer's own generic17 lineage cannot impersonate the resource lineage.
 if(descriptor.sourceId===issuerSourceId||descriptor.instanceId===issuerInstanceId)fail('NETWORK_PUBLISHER_RESOURCE_LINEAGE_COLLISION');
 exact(association,['account','clientId','productId','platform','applicationId','deviceId']);
 if(association.account!==currentOwner||association.productId!=='network'||!['macos','linux','windows'].includes(association.platform)||Object.values(association).some(v=>typeof v!=='string'||!v||v.length>512))fail('NETWORK_PUBLISHER_ASSOCIATION');
 const owned=JSON.parse(canonical(scope));
 return Object.freeze({scopeOriginal:canonical(owned),scope:Object.freeze(owned),descriptor,scopeHead:sha(canonical(owned)),dataOnly:true,authorized:false,executionAllowed:false,RootAdmission:false,SourceAdmission:false,NativeAdmission:false});
}
