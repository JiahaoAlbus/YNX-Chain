import {parseProductSessionTaskResponseV6Unsigned,inspectProductSessionTaskOutcomeV6DATA,PRODUCT_SESSION_TASK_LOCAL_BUSINESS_ACTIONS_V6} from '../src/product-session-task-action-v6.js';
import type {ProductSessionTaskResponseV6Unsigned} from '../src/product-session-task-action-v6.js';
import type {OriginalAITaskActionV6Observation} from '../src/original-ai-task-action-v6-client.js';
declare const r:ProductSessionTaskResponseV6Unsigned;declare const o:OriginalAITaskActionV6Observation;
const decisions:'COMMITTED'|'ACCEPTED'|'OBSERVED'|'DENIED'|'UNKNOWN'=r.state;
const mapped:'create-task'=PRODUCT_SESSION_TASK_LOCAL_BUSINESS_ACTIONS_V6['task.create'];
inspectProductSessionTaskOutcomeV6DATA({action:'task.approve',businessAction:null,state:'COMMITTED',completionScope:'TASK_APPROVAL_COMMIT_ONLY',businessReceiptOriginal:new Uint8Array([1])});
inspectProductSessionTaskOutcomeV6DATA({action:'task.read',businessAction:null,state:'OBSERVED',completionScope:'READ_ONLY_OBSERVATION',businessReceiptOriginal:new Uint8Array([1])});
// @ts-expect-error legacy V6 decision was replaced; V4/V5 untouched
const legacy:'REJECTED'=r.state;
// @ts-expect-error new decision closure excludes internal admission
const admitted:'ADMITTED'=r.state;
// @ts-expect-error local commit never authorizes tool execution
const tool:true=o.toolAuthorized;
// @ts-expect-error no generic public new scope
inspectProductSessionTaskOutcomeV6DATA({action:'task.create',businessAction:'create-task',state:'COMMITTED',completionScope:'ALL_ACTIONS',businessReceiptOriginal:new Uint8Array([1])});
// @ts-expect-error ACCEPTED/OBSERVED require an actual ref in the closed wire type
const noRef:ProductSessionTaskResponseV6Unsigned={...r,state:'ACCEPTED',requestRef:null};
