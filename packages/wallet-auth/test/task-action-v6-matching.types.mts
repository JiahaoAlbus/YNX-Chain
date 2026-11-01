import{PRODUCT_SESSION_TASK_RESPONSE_HEADER_V6,encodeProductSessionTaskActionV6Message,type ProductSessionTaskActionV6Unsigned}from'../src/product-session-task-action-v6.js';
declare const request:ProductSessionTaskActionV6Unsigned;
const proposal:ProductSessionTaskActionV6Unsigned={...request,action:'task.propose-tool-step',taskId:'task',taskRevision:'2',generation:'3',stepId:null,runId:null,creationBinding:null};
const complete:ProductSessionTaskActionV6Unsigned={...request,action:'task.complete',taskId:'task',taskRevision:'2',generation:'3',stepId:null,runId:'run',creationBinding:null};
// @ts-expect-error complete must bind its actual run id
const missingRun:ProductSessionTaskActionV6Unsigned={...complete,runId:null};
// @ts-expect-error proposal does not already select a tool step
const fakeStep:ProductSessionTaskActionV6Unsigned={...proposal,stepId:'fake'};
// @ts-expect-error handoff remains unregistered until actual body contract arrives
const handoff:ProductSessionTaskActionV6Unsigned={...proposal,action:'task.handoff'};
const responseHeader:'x-ynx-product-session-response-proof-v6'=PRODUCT_SESSION_TASK_RESPONSE_HEADER_V6;
encodeProductSessionTaskActionV6Message(proposal,'a'.repeat(64));void[complete,missingRun,fakeStep,handoff,responseHeader];
