import {ProductSessionGatewayFetchAdapter,createProductSessionReferenceReturnURL} from '../../src/index.js';
import {ProductSessionGatewayNodeHost} from '../../src/product-session-gateway-node-host.js';
import {inspectCompletionRecord} from '../../src/product-session-completion-record.js';
import {createProductWalletReturnPublisher} from '../../src/product-wallet-connection.js';
declare const caller:ProductSessionGatewayFetchAdapter,host:ProductSessionGatewayNodeHost;
declare const registry:unknown,request:unknown,approval:unknown,completion:unknown;
const publication=await caller.publishReturn({requestId:'req_reference_types_001',request,approval});
const callback:string=createProductSessionReferenceReturnURL(registry,request,publication);
await caller.returnChallenge({requestId:'req_reference_types_002',reference:publication.reference,request});
await caller.completeReturn({requestId:'req_reference_types_003',reference:publication.reference,request,completion});
await caller.returnOutcome({requestId:'req_reference_types_004',reference:publication.reference,request,completion});
await host.publishOriginalProductSessionReturn({requestId:'req_reference_types_005',request,approval});
const outcome=host.readOriginalProductSessionReturnOutcome('req_reference_types_005');
const record=inspectCompletionRecord(registry,'{}');
void [callback,outcome,record];
const publisher=createProductWalletReturnPublisher({gatewayTimeoutMs:1000});
const recovered=await publisher.publicationOutcome({requestId:'req_read_types_0000001',publicationRequestId:'req_publish_types_0001',request,approval});
if(recovered.state!=='not_found'){const identity:string=recovered.account;const fullDigest:string=recovered.approvalDigest;void [identity,fullDigest];}
await host.readOriginalProductSessionPublicationOutcome({requestId:'req_read_types_0000002',publicationRequestId:'req_publish_types_0001',request,approval});
// @ts-expect-error Caller-selected endpoint is not part of the fixed publisher.
createProductWalletReturnPublisher({gatewayTimeoutMs:1000,endpoint:'https://untrusted.example'});
