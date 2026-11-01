import{encodeProductSessionTaskActionV6Message,inspectProductSessionTaskActionHeaderV6Data,type ProductSessionTaskActionV6Unsigned,type ProductSessionTaskResponseV6Unsigned,type ProductSessionTaskMathV6DATA}from'../src/product-session-task-action-v6.js';
declare const request:ProductSessionTaskActionV6Unsigned;declare const response:ProductSessionTaskResponseV6Unsigned;
encodeProductSessionTaskActionV6Message(request,'a'.repeat(64));
// @ts-expect-error handoff cannot gain a guessed registered route
const handoff:ProductSessionTaskActionV6Unsigned={...request,action:'task.handoff'};
// @ts-expect-error create unknown task refs must be typed null
const fake:ProductSessionTaskActionV6Unsigned={...request,action:'task.create',taskId:'fake-existing',taskRevision:'1',generation:'1',creationBinding:{conversationId:'x'}};
// @ts-expect-error COMMITTED response requires actual record ref, not null
const noRef:ProductSessionTaskResponseV6Unsigned={...response,state:'COMMITTED',requestRef:null};
declare const math:ProductSessionTaskMathV6DATA;const noReplay:false=math.replayAuthorized;
// @ts-expect-error mathematics is not current Source admission
const current:true=math.current;
void [handoff,fake,noRef,noReplay,current,inspectProductSessionTaskActionHeaderV6Data];
