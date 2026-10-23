import {acquireOriginalIDEContractRelayGuard, assertOriginalIDEContractRelayGuardCurrent, type OriginalIDEContractRelayScope} from '@ynx-chain/wallet-auth/original-ide-contract-relay-guard';
import {createDeveloperContractConnection} from '@ynx-chain/wallet-auth/walletconnect-dapp-connection';
import {encodeIDEArtifactManifestData,inspectIDEArtifactManifestData} from '@ynx-chain/wallet-auth/ide-artifact-manifest';
declare const scope:OriginalIDEContractRelayScope;
async function consume(){
 const localContext={workspace:'/normal/workspace',profile:'/normal/profile',id:'PUBLIC-local-project'};
 const guard=await acquireOriginalIDEContractRelayGuard({serverModuleURL:'file:///normal/server.mjs',localContext,expectedScope:scope});
 // The Native successor chooses the signed canonical scope, never localContext.
 void acquireOriginalIDEContractRelayGuard({serverModuleURL:'file:///normal/server.mjs',localContext});
 // @ts-expect-error actual local launch constraints remain mandatory
 void acquireOriginalIDEContractRelayGuard({serverModuleURL:'file:///normal/server.mjs'});
 const current=assertOriginalIDEContractRelayGuardCurrent(guard);
 const dataOnly:true=current.dataOnly,notRPCApproval:false=current.authorized;
 void dataOnly;void notRPCApproval;
 // @ts-expect-error scope DATA does not fabricate the former Auth principal
 current.account;
 // @ts-expect-error a copied scope is not the original ready guard
 assertOriginalIDEContractRelayGuardCurrent(scope);
 const client=createDeveloperContractConnection({relayGuard:guard,relayContext:scope});
 const initialized:void=await client.initialize();
 // @ts-expect-error raw SignClient is not exposed by the dedicated profile
 initialized.request({});
 const raw=encodeIDEArtifactManifestData({byteSize:1,contentDigest:'a'.repeat(64),projectId:'p',publishPurpose:'release',targetEnvironment:'testnet',version:'1'});
 const data=inspectIDEArtifactManifestData(raw);void data;
 await guard.close();
}
void consume;
import {createIDEArtifactPublisherKeyData,readIDEArtifactPublisherPublicOriginalData,exportIDEArtifactPublisherKeyMaterialData,importIDEArtifactPublisherKeyMaterialData,signIDEArtifactManifestData,inspectIDEArtifactSignatureData,destroyIDEArtifactPublisherKeyData,type IDEArtifactPublisherBindingData} from '@ynx-chain/wallet-auth/ide-artifact-signature';
declare const binding:IDEArtifactPublisherBindingData;
function protectedConsumer(raw:Uint8Array){
 const handle=createIDEArtifactPublisherKeyData(binding),originalR=readIDEArtifactPublisherPublicOriginalData(handle);
 const material=exportIDEArtifactPublisherKeyMaterialData(handle);
 const restored=importIDEArtifactPublisherKeyMaterialData(material,originalR);
 const signature=signIDEArtifactManifestData(restored,raw,originalR);
 const result=inspectIDEArtifactSignatureData(signature,raw,originalR);
 const noAuthority:false=result.authorized;void noAuthority;
 destroyIDEArtifactPublisherKeyData(handle);destroyIDEArtifactPublisherKeyData(restored);
}
void protectedConsumer;
import {preparePQContractDeploymentMaterialData,type PQContractDeploymentMaterialInput} from '@ynx-chain/wallet-auth/pq-contract-deployment-material';
declare const input:PQContractDeploymentMaterialInput;
const prepared=preparePQContractDeploymentMaterialData(input);
const unapproved:false=prepared.authorized;void unapproved;
import {captureOriginalIDEPublicationArtifact,readOriginalIDEPublicationArtifactManifest,closeOriginalIDEPublicationArtifact,acquireOriginalIDEProtectedPublicationKeyCall} from '@ynx-chain/wallet-auth/original-ide-admission';
import type {OriginalIDEPublicationArtifactRef,OriginalIDEProtectedKeyCallOwner} from '@ynx-chain/wallet-auth/auth-native-contract';
function originalPublicationConsumer(manifest:string,bytes:Uint8Array){
 const ref:OriginalIDEPublicationArtifactRef|null=captureOriginalIDEPublicationArtifact(manifest,bytes);
 if(ref===null)return;
 const original:string=readOriginalIDEPublicationArtifactManifest(ref);
 const partial:OriginalIDEProtectedKeyCallOwner|null=acquireOriginalIDEProtectedPublicationKeyCall('file:///normal/server.mjs',original,ref);
 const closed:true=closeOriginalIDEPublicationArtifact(ref);
 void partial;void closed;
 // @ts-expect-error opaque DATA does not expose artifact bytes
 ref.bytes;
 // @ts-expect-error opaque DATA is not a protected effect owner
 ref.invoke();
}
void originalPublicationConsumer;
// @ts-expect-error structural DATA cannot forge the private unique-symbol brand
const forgedPublication:OriginalIDEPublicationArtifactRef={};
// @ts-expect-error arrays are not Native ordinary Uint8Array operands
captureOriginalIDEPublicationArtifact('{}',[1,2,3]);
// @ts-expect-error constructors require the exact original tagged ref
acquireOriginalIDEProtectedPublicationKeyCall('file:///normal/server.mjs','{}',{});
// @ts-expect-error no provider/path override or fourth argument
acquireOriginalIDEProtectedPublicationKeyCall('file:///normal/server.mjs','{}',forgedPublication,'/other/addon.node');
// @ts-expect-error no mutable manifest object instead of original canonical string
captureOriginalIDEPublicationArtifact({projectId:'p'},new Uint8Array(1));
