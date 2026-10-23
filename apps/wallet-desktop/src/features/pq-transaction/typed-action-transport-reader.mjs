import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {PQ_ACTION_TRANSPORT_MAX_BYTES,decodePQActionTransportData} from '@ynx-chain/wallet-auth/pq-action-transport';
import {preparePQNativeActionTransportData} from '@ynx-chain/wallet-auth/pq-action-transport-node';
import {decodePQContractDeploymentTransportData} from '@ynx-chain/wallet-auth/pq-contract-deployment-transport';
import {preparePQContractDeploymentTransportData} from '@ynx-chain/wallet-auth/pq-contract-deployment-transport-node';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const hash=value=>'0x'+createHash('sha256').update(value).digest('hex');
const typed=Object.getPrototypeOf(Uint8Array.prototype);
const bufferOf=Object.getOwnPropertyDescriptor(typed,'buffer').get;
const lengthOf=Object.getOwnPropertyDescriptor(typed,'length').get;
const offsetOf=Object.getOwnPropertyDescriptor(typed,'byteOffset').get;
const resizable=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable').get;
const detached=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'detached').get;
function transportBytes(value){
 if(types.isProxy(value)||!types.isUint8Array(value))fail('PQ_TYPED_TRANSPORT_BYTES_INVALID');
 const buffer=bufferOf.call(value),length=lengthOf.call(value),offset=offsetOf.call(value);
 if(types.isSharedArrayBuffer(buffer)||resizable.call(buffer)||detached.call(buffer)||!length||length>PQ_ACTION_TRANSPORT_MAX_BYTES)fail('PQ_TYPED_TRANSPORT_BYTES_INVALID');
 // Pass a fresh ordinary buffer to the SDK; never execute caller-owned
 // byteLength/buffer flag getters or a conversion hook while copying.
 return new Uint8Array(new Uint8Array(buffer,offset,length));
}
function expectedBinding(value){
 if(!value||typeof value!=='object'||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)fail('PQ_TYPED_TRANSPORT_BINDING_INVALID');
 const fields=['account','networkId','memberHash','transportHash'],ds=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(ds);
 if(keys.length!==fields.length||keys.some(k=>!fields.includes(k)||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))fail('PQ_TYPED_TRANSPORT_BINDING_INVALID');
 const result=Object.fromEntries(fields.map(k=>[k,ds[k].value]));
 if(typeof result.account!=='string'||!/^0x[0-9a-f]{40}$/.test(result.account)||typeof result.networkId!=='string'||!(/^[0-9a-f]{64}$/).test(result.networkId)||['memberHash','transportHash'].some(k=>typeof result[k]!=='string'||!/^0x[0-9a-f]{64}$/.test(result[k])))fail('PQ_TYPED_TRANSPORT_BINDING_INVALID');
 return result;
}

/** Main-only read of an already retained typed Action transport. The caller
 * supplies its original signing snapshot and selected account/network plus
 * original Member/transport hashes. No latest-nonce repair, approval, storage,
 * transport dispatch, signer, query or retry is performed here.
 * This generic observer preserves SDK N/index. It does NOT replace the local
 * signer's existing N1/index0 inspection or establish classic witness validity. */
export function inspectPQTypedActionTransportOriginal(snapshot,raw,expected){
 return inspectTransport(snapshot,raw,expected,false);
}
/** SDK333 full compiler envelope. Compiler provenance still belongs to Go. */
export function inspectPQContractDeploymentTransportOriginal(snapshot,raw,expected){
 return inspectTransport(snapshot,raw,expected,true);
}
function inspectTransport(snapshot,raw,expected,deployment){
 const binding=expectedBinding(expected),body=transportBytes(raw);
 const transportHash=hash(body);
 if(transportHash!==binding.transportHash)fail('PQ_TYPED_TRANSPORT_HASH_MISMATCH');
 const captured=deployment?decodePQContractDeploymentTransportData(body):decodePQActionTransportData(body),member=captured.member,originals=deployment?[]:captured.originals;
 const memberHash=hash(member);
 if(memberHash!==binding.memberHash)fail('PQ_TYPED_TRANSPORT_HASH_MISMATCH');
 const verified=deployment?preparePQContractDeploymentTransportData(snapshot,{member,source:captured.source,material:captured.material}):preparePQNativeActionTransportData(snapshot,{member,originals});
 if(verified.owner!==binding.account||verified.chainId!==binding.networkId)fail('PQ_TYPED_TRANSPORT_BINDING_MISMATCH');
 if(!Buffer.from(verified.body).equals(body))fail('PQ_TYPED_TRANSPORT_BYTES_MISMATCH');
 const result={account:binding.account,networkId:binding.networkId,memberHash,transportHash,
  action:verified.action,keyVersion:verified.keyVersion,executionHeight:verified.executionHeight,purpose:verified.purpose,
  memberCount:verified.memberCount,memberIndex:verified.memberIndex,originalsCount:originals.length,
  signatureVerified:true,classicWitnessValidationRequired:deployment?false:verified.classicWitnessValidationRequired,
  dataOnly:true,nativeAdmission:false,permissionGranted:false,submitted:false,canRetry:false,clearsOriginal:false,consensusFinality:false,
  get body(){return new Uint8Array(body);},get member(){return new Uint8Array(member);},
  get originals(){return Object.freeze(originals.map(value=>new Uint8Array(value)));}};
 if(deployment)Object.defineProperties(result,{compilerMaterialValidationRequired:{value:true,enumerable:true},source:{value:captured.source,enumerable:true},material:{get:()=>captured.material,enumerable:true}});
 return Object.freeze(result);
}
