import * as c from '../native/original-network-resource-current-witness-v1.mjs';
import type {NetworkResourceSourceCurrentV1} from '../native/original-network-resource-source-v2-contract.mjs';
const descriptor={version:'1' as const,networkId:'a'.repeat(64),sourceId:'s',instanceId:'i',resourceKey:'r',publisherOwner:'0x'+'1'.repeat(40),resourceCurrentFrame:'PUBLIC',originalLocator:{protectedResourceRef:'r',leaf:'source.current.original' as const}},binding={networkId:descriptor.networkId,owner:descriptor.publisherOwner,keyVersion:'7',executionHeight:'18'},body:NetworkResourceSourceCurrentV1={sourceId:'s',instanceId:'i',resourceKey:'r',epoch:'17',sequence:'9007199254740993',head:'b'.repeat(64),status:'active',issuedAtMs:1,expiresAtMs:20000};
c.encodeNetworkResourceCurrentWitnessStatementV1DATA(descriptor,binding,body);
// @ts-expect-error resource sequence must not pass through JS Number
c.encodeNetworkResourceCurrentWitnessStatementV1DATA(descriptor,binding,{...body,sequence:9007199254740993});
// @ts-expect-error keyVersion is independently registered decimal, not resource epoch
c.encodeNetworkResourceCurrentWitnessStatementV1DATA(descriptor,{...binding,keyVersion:7},body);
// @ts-expect-error descriptor exact8 has no injected Root provider
c.inspectNetworkResourceCurrentPublisherDescriptorV1DATA({...descriptor,provider:()=>true});
// @ts-expect-error generic current17 body is not resource current9
c.encodeNetworkResourceCurrentWitnessStatementV1DATA(descriptor,binding,{generation:1});
// @ts-expect-error ordinary JSON/boolean cannot replace registered witness stage
c.verifyNetworkResourceCurrentWitnessWithSourceV1DATA({signatureMathVerified:true},{});
// @ts-expect-error default factory does not install caller descriptor/reader
c.acquireOriginalNetworkResourceCurrentWitnessReaderV1(descriptor);
// @ts-expect-error only the fixed private original leaf is accepted
c.inspectNetworkResourceCurrentPublisherDescriptorV1DATA({...descriptor,originalLocator:{protectedResourceRef:'r',leaf:'/tmp/current.json'}});
// @ts-expect-error Member must be original bytes
c.encodeNetworkResourceCurrentWitnessEnvelopeV1DATA(descriptor,binding,body,'PUBLIC');
