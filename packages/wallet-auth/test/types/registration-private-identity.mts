import type{OriginalPendingCollectorWithCreationIdentityDATA}from'../../native/original-device-pending-source-v2-private-factory.mjs';
declare const collect:OriginalPendingCollectorWithCreationIdentityDATA;
const data=collect.inspectOriginalDeviceCreationIdentityDATA('original canonical intent');
const readonlyDATA:true=data.dataOnly;
const noApproval:false=data.userApproved;
const noSource:false=data.SourceAdmission;
const exactCallback:string=data.identityBinding.callback;
const generation:string=data.generation;
// @ts-expect-error Historical DATA never supplies a Source grant.
const forbidden:true=data.SourceAdmission;
// @ts-expect-error No App context/provider/expectedRoot argument accepted.
collect.inspectOriginalDeviceCreationIdentityDATA('original',{});
// @ts-expect-error Private native-root method is readonly.
collect.inspectOriginalDeviceCreationIdentityDATA=()=>data;
void readonlyDATA;void noApproval;void noSource;void exactCallback;void generation;
