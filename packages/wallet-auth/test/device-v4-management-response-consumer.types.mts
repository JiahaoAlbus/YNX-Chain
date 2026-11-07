import type{OriginalProductDeviceV4ManagementClient,OriginalManagementProofHandleV4}from'../src/original-product-device-v4-management-client.js';
declare const client:OriginalProductDeviceV4ManagementClient,proof:OriginalManagementProofHandleV4,raw:Uint8Array;
const data=client.inspectResponseDATA(proof,raw);const noGrant:false=data.RootAdmission;const noExecution:false=data.executionVerified;void noGrant;void noExecution;
// @ts-expect-error no caller expected/provider transport argument
client.inspectResponseDATA(proof,raw,{provider:{}});
// @ts-expect-error opaque proof cannot be forged from DTO
client.inspectResponseDATA({},raw);
// @ts-expect-error DATA cannot make a connected session
const connected:true=data.SourceAdmission;void connected;
