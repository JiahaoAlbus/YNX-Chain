import type {OriginalAuthSourceV2Enrollment,OriginalAuthSourceV2ProfileData} from '../../native/original-auth-identity-source-v2-verifier.mjs';
const services:OriginalAuthSourceV2Enrollment['service'][]=['wallet-product-session-v2','ide-contract-relay-v1','ide-project-authority-v1'];
const operations:OriginalAuthSourceV2Enrollment['operations']=['CurrentProject','CurrentPublisher','RecheckProject'];
// @ts-expect-error arbitrary services are not declared by the original verifier
const foreign:OriginalAuthSourceV2Enrollment['service']='caller-project-authority';
// @ts-expect-error mixed operation domains do not form any original exact tuple
const mixed:OriginalAuthSourceV2Enrollment['operations']=['CurrentProject','disconnect','RecheckProject'];
declare const verified:OriginalAuthSourceV2ProfileData;
const notAdmission:false=verified.nativeAdmission;
// @ts-expect-error verified Source DATA does not produce a JS currentPublisher factory
verified.copyOriginalIDECurrentPublisher('publisher','project');
void services;void operations;void foreign;void mixed;void notAdmission;
import {acquireOriginalIDEProjectAuthority,readOriginalIDECurrentProject,readOriginalIDECurrentPublisher,closeOriginalIDEProjectAuthority} from '@ynx-chain/wallet-auth/original-ide-admission';
import type {OriginalIDEProjectAuthorityRef} from '@ynx-chain/wallet-auth/auth-native-contract';
function originalProjectReader(){
 const original=acquireOriginalIDEProjectAuthority();if(original===null)return;
 const project=readOriginalIDECurrentProject(original,'project'),publisher=readOriginalIDECurrentPublisher(original,'project','publisher');
 const accountGeneration:string=project.principal.accountGeneration,projectRevision:string=project.project.projectRevision,publisherRevision:string=publisher.publisher.revision;
 const expiresMS:number=publisher.expiresMS,bytes:Uint8Array<ArrayBuffer>=publisher.publisherOriginal;
 const cleanup:undefined=closeOriginalIDEProjectAuthority(original);
 void accountGeneration;void projectRevision;void publisherRevision;void expiresMS;void bytes;void cleanup;
 // @ts-expect-error Native snapshot has no fabricated authorization property
 project.authorized;
 // @ts-expect-error Native snapshot has no invented dataOnly property
 publisher.dataOnly;
 // @ts-expect-error generations are original U64 decimal strings, not JS float
 const generation:number=project.principal.accountGeneration;
 // @ts-expect-error Native records are readonly
 project.project.publish=true;
 // @ts-expect-error public-original bytes are not an opaque Source owner
 readOriginalIDECurrentProject(bytes,'project');
}
void originalProjectReader;
// @ts-expect-error structural objects cannot forge original Native owner brand
const forgedOwner:OriginalIDEProjectAuthorityRef={};
// @ts-expect-error no Source/provider/serverURL or caller Root option exists
acquireOriginalIDEProjectAuthority({Source:{},serverURL:'file:///server.mjs'});
// @ts-expect-error exact reader requires original owner and string project ID
readOriginalIDECurrentProject(forgedOwner,{projectId:'project'});
// @ts-expect-error exact publisher reader is three operands, no provider callback
readOriginalIDECurrentPublisher(forgedOwner,'project','publisher',()=>true);
