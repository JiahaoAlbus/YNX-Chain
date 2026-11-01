import type{OriginalAuthSourceV2CurrentData}from'./original-auth-identity-source-v2-verifier.mjs';
declare const originalPublisherReference:unique symbol;
export interface OriginalNetworkResourceCurrentPublisherReferenceV1 {readonly [originalPublisherReference]:true;retire():Promise<void>;join():Promise<void>;close():Promise<void>}
/** Fixed zero-input Native + compiled Root inventory. Caller DATA never constructs this. */
export function acquireOriginalNetworkResourceCurrentPublisherReferenceV1():Promise<OriginalNetworkResourceCurrentPublisherReferenceV1>;
/** Same opaque reference, physical-current and completion full-math fences. */
export function assertOriginalNetworkResourceCurrentPublisherReferenceV1(reference:OriginalNetworkResourceCurrentPublisherReferenceV1):Promise<Readonly<OriginalAuthSourceV2CurrentData>>;
/** Private Auth receiver alone consumes this handoff once. Ports remain private. */
export function readOriginalNetworkResourceCurrentPublisherReferenceV1(reference:OriginalNetworkResourceCurrentPublisherReferenceV1):Readonly<{capture:object;store:object}>;

export function assertOriginalNetworkCurrentPublisherLoaderEntryV1(reference:OriginalNetworkResourceCurrentPublisherReferenceV1,entry:object):void;
export function readOriginalNetworkCurrentPublisherRegisteredViewV1(reference:OriginalNetworkResourceCurrentPublisherReferenceV1):import('../src/pq-wallet-policy.js').PQAuthorizationSnapshot;
export function assertOriginalNetworkCurrentPublisherMessageV1(reference:OriginalNetworkResourceCurrentPublisherReferenceV1,message:Uint8Array,binding:import('./original-network-resource-current-witness-v1.mjs').NetworkResourceCurrentWitnessBindingV1DATA):void;
