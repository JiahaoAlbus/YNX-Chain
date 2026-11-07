import type{OriginalIDECloudLookupOwner,OriginalIDECloudRetainedGETOwner,OriginalIDECloudProjectLookupDATA,OriginalIDECloudRegisteredFullRefDATA}from'../src/original-ide-admission-parent-delivery.js';
import{inspectOriginalIDECloudProjectLookupDATA}from'../src/original-ide-cloud-project-lookup-private.js';
declare const lookup:OriginalIDECloudLookupOwner;declare const get:OriginalIDECloudRetainedGETOwner;
const a:OriginalIDECloudProjectLookupDATA=lookup.readOriginalMappingDATA();const b:OriginalIDECloudProjectLookupDATA=get.readOriginalMappingDATA();const ref:OriginalIDECloudRegisteredFullRefDATA=a.registeredCloudFullRef;const kind:string=ref.kind;const rev:string=ref.rev;const version:'YNX-IDE-CLOUD-PROJECT-LOOKUP/v1'=b.version;
// @ts-expect-error immutable exact Native DATA
ref.rev='4';
// @ts-expect-error no endpoint can be inferred from lookup
const endpoint:string=a.serviceOrigin;
// @ts-expect-error no qualification from shape
const grant:true=a.SourceAdmission;
// @ts-expect-error no durable operation selected by this exact10 mapping
const operation:string=a.operationRequestId;
// @ts-expect-error version is literal and cannot be replaced
const wrong:OriginalIDECloudProjectLookupDATA={...a,version:'OTHER'};
const noHeaders:never=get.getDeploymentRequestHeaders();const parsed=inspectOriginalIDECloudProjectLookupDATA({});void[kind,rev,version,noHeaders,parsed];
