import{inspectOriginalAITaskActionV6AgentRegistrationDATA,inspectOriginalAITaskActionV6SourceScopeDATA,type OriginalAITaskActionV6AgentPublic,type OriginalAITaskActionV6ClientScope}from'../native/original-ai-task-action-v6-source-contract.mjs';
import{verifyOriginalAuthSourceProfileV2,verifyOriginalAuthSourceCurrentV2}from'../native/original-auth-identity-source-v2-verifier.mjs';
import type{OriginalAITaskV6ClientSourceScopeDATA}from'../src/original-ai-task-action-v6-client-private.js';
declare const agent:OriginalAITaskActionV6AgentPublic;declare const client:OriginalAITaskActionV6ClientScope;declare const projection:OriginalAITaskV6ClientSourceScopeDATA;
const purpose:'PRODUCT-SESSION-AI-TASK-ACTION'=agent.purpose;const epoch:string=agent.keyEpoch;const mandatory:OriginalAITaskActionV6AgentPublic=client.agentRegistration;
// @ts-expect-error independent public metadata is immutable
agent.pkA='wrong';
// @ts-expect-error HTTP device pair is not a replacement Native Task expected pair
const legacy:OriginalAITaskV6ClientSourceScopeDATA={version:'6',originURL:'https://example.invalid',networkId:'x',pkA:'x',pkB:'x',identity:projection.identity,expiresAtMs:1};
// @ts-expect-error mandatory agent binding cannot be omitted from client signed scope
const old:OriginalAITaskActionV6ClientScope={version:'6',role:'client',deviceScope:client.deviceScope,nativeIdentity:client.nativeIdentity,operations:client.operations,currentSelector:client.currentSelector,imagePins:client.imagePins};
const effect=inspectOriginalAITaskActionV6SourceScopeDATA(client,{},'x','x','x','x',0,1,0);const noRoot:false=effect.SourceAdmission;
void[purpose,epoch,mandatory,legacy,old,noRoot,inspectOriginalAITaskActionV6AgentRegistrationDATA,verifyOriginalAuthSourceProfileV2,verifyOriginalAuthSourceCurrentV2];
