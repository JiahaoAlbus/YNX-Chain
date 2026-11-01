import{retainOriginalIDECloudGETForCurrentParent,retainOriginalIDECloudProjectLookupForCurrentParent,type OriginalIDECloudRetainedGETOwner}from'../src/original-ide-admission-parent-delivery.js';
import type{OriginalIDECloudGETRequestTicket}from'../src/original-ide-cloud-get-request.js';
declare const owner:OriginalIDECloudRetainedGETOwner;
// @ts-expect-error DTO cannot manufacture original ticket
const ticket:OriginalIDECloudGETRequestTicket={};
// @ts-expect-error no path/provider string as retained workspace
retainOriginalIDECloudGETForCurrentParent('/workspace');
// @ts-expect-error no unknown provider option
retainOriginalIDECloudProjectLookupForCurrentParent({}, {provider:()=>true});
const noHeader:never=owner.getDeploymentRequestHeaders();void noHeader;
