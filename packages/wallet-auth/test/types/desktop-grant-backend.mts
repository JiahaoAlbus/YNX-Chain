import type{AcquireOriginalTaskGrantAuthorityBackendV1,OriginalTaskGrantAuthorityBackendAcquisition}from'../../native/desktop-grant-backend-contract.d.mts';
declare const acquire:AcquireOriginalTaskGrantAuthorityBackendV1;
// @ts-expect-error no path/provider/caller row accepted by Native acquisition
acquire({image:'/tmp/not-a-root'});
declare const a:OriginalTaskGrantAuthorityBackendAcquisition;
if(a.errorPresent){const cause:unknown=a.error;void cause;}
// @ts-expect-error partial/error owner is not a complete service caller
const invoke=()=>a.owner.acquireOriginalTaskCaller({});void invoke;
// @ts-expect-error paired error presence mandatory even raw null
const noFlag:OriginalTaskGrantAuthorityBackendAcquisition={owner:null,error:null};void noFlag;
