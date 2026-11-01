import {acquireOriginalIDEColdTerminalCustody,getOriginalIDEColdTerminalCustodyCleanup} from '../../src/original-ide-admission-parent-delivery.js';

async function useOriginalColdData(entry:string,originalRequest:string) {
 const custody=await acquireOriginalIDEColdTerminalCustody(entry);
 const data=custody.readTerminalCustody(originalRequest);
 const dataOnly:true=data.proof.dataOnly;
 const admission:false=data.proof.nativeAdmission;
 const replay:false=data.proof.effectRetryAuthorized;
 // @ts-expect-error Cold DATA custody exposes no dispatch authority.
 custody.dispatch(originalRequest);
 // @ts-expect-error A retained terminal read cannot acknowledge the effect.
 custody.acknowledge();
 custody.retire();await custody.join();await custody.close();
 const cleanup=getOriginalIDEColdTerminalCustodyCleanup(entry);
 if(cleanup){cleanup.retire(undefined);await cleanup.join();await cleanup.close();}
 return {dataOnly,admission,replay,response:data.response};
}
void useOriginalColdData;
