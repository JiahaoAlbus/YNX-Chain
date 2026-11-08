import type{TaskReadReceiverScopeV1DATA}from'../../native/original-task-read-receiver-source-contract.mjs';
import{collectOriginalTaskReadReceiverPermissionV1DATA}from'../../native/original-task-read-receiver-permission-collector.mjs';
import type{TaskReadReceiverPermissionInputDATA}from'../../native/original-task-read-receiver-permission-collector.mjs';
declare const scope:TaskReadReceiverScopeV1DATA,input:TaskReadReceiverPermissionInputDATA;
const r=collectOriginalTaskReadReceiverPermissionV1DATA(input);
// @ts-expect-error no listener or Native capability follows DATA math
const listen:true=r.listenCapability;
// @ts-expect-error SourceVersion must remain lossless decimal text
scope.sourceVersion.revision=9007199254740993;
// @ts-expect-error immutable Root-selected route DATA
scope.routes.push({method:'POST',path:'/arbitrary',maxBodyBytes:1,timeoutMS:1});
// @ts-expect-error no provider/setter or callback is accepted
collectOriginalTaskReadReceiverPermissionV1DATA({...input,provider:()=>true});
// @ts-expect-error original bytes cannot be replaced by a caller locator path
collectOriginalTaskReadReceiverPermissionV1DATA({...input,taskSource:{...input.taskSource,projectionOriginal:'/caller/path'}});
void listen;
