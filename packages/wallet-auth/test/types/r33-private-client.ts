import {acquireOriginalIDEPrivateServiceChannel,getOriginalIDEPrivateServiceChannelCleanup,type OriginalIDEPrivateServiceResponse} from '../../src/original-ide-admission-parent-delivery.js';
import type {OriginalIDEParentHost} from '../../src/original-ide-parent-host.js';
async function useActualPrivateABI(entry:string,parent:OriginalIDEParentHost) {
 const channel=await acquireOriginalIDEPrivateServiceChannel(entry);
 const data=channel.original.readTerminalCustody('handleReturn','effect','req_ORIGINAL_REQUEST_001');
 const response:OriginalIDEPrivateServiceResponse=data.response;
 const version:1|2|3=data.proof.recordVersion;
 const pending:string|null=await channel.framer.nextOutboundFrame();
 if(pending!==null)await parent.handlePrivateServicePayload(pending);
 channel.original.retire(undefined);await channel.original.join();await channel.original.close();
 const partial=getOriginalIDEPrivateServiceChannelCleanup(entry);if(partial){partial.retire(false);await partial.join();await partial.close();}
 return {response,version};
}
void useActualPrivateABI;
