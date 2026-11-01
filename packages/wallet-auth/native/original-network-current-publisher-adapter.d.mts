import type {OriginalNetworkCurrentPublisherAcquisitionV1} from './original-network-current-publisher-loader-private.mjs';
import type {OriginalNetworkResourceCurrentPublisherReferenceV1} from './original-network-current-publisher-reference-private.mjs';
export type Result<T = never> = Readonly<{error: unknown; errorPresent?:boolean;partial?: T}>;
export type VoidResult = Readonly<{error: unknown;errorPresent?:boolean}>; // explicit errorPresent:true always fails, including null
export interface Descriptor8 {
 version:'1'; networkId:string; sourceId:string; instanceId:string;
 resourceKey:string; publisherOwner:string; resourceCurrentFrame:string;
 originalLocator:Readonly<{protectedResourceRef:string;leaf:'source.current.original'}>;
}
export interface Current9 {
 sourceId:string;instanceId:string;resourceKey:string;epoch:string;sequence:string;
 head:string;status:'active'|'revoked'|'retired';issuedAtMs:number;expiresAtMs:number;
}
export interface Binding4 {networkId:string;owner:string;keyVersion:string;executionHeight:string}
export interface IssuerSourceInputs {
 rootRaw:string;enrollmentRaw:string;profileRaw:string;currentRaw:string;
 policy:object;registrations:Readonly<{root:object;profile:object;current:object;subject:object}>;
 expectedNonce:string;previous:object;atMs:number;
}
export interface HeldOriginals {
 descriptor:Descriptor8;binding:Binding4;current9:Current9;
 issuerSourceInputs:IssuerSourceInputs;registeredCurrent:object;
}
export interface Child {retire():Promise<VoidResult>;join():Promise<VoidResult>;close():Promise<VoidResult>}
export interface Capture extends Child {
 current():Promise<VoidResult>;assertCompletedCurrent():VoidResult;clockMs():number;readOriginals():HeldOriginals;
 /** SAME private sole wrapper; raw Native exact7 is enriched with fresh branded views here. */
 readFreshIssuerSourceInputs():Omit<IssuerSourceInputs,'atMs'>;
 retainSigningIntentOnce(current9Original:Uint8Array,statementE8Original:Uint8Array):Promise<VoidResult>;
 querySameOriginal():Promise<unknown>;
}
export interface FixedCurrentSigner extends Child {
 assertCurrent(originalRegisteredCurrent:object):Promise<VoidResult>;
 signCurrent(exactPreparedE8:Uint8Array,independentBinding:Binding4,originalRegisteredCurrent:object):Promise<Result<Uint8Array>>;
}
export interface Pair {currentOriginal:Uint8Array;envelopeOriginal:Uint8Array}
export interface PairStore extends Child {
 retainPublicationIntentOnce(current9Original:Uint8Array,signedEnvelopeOriginal:Uint8Array):Promise<VoidResult>;
 publishOriginalPairOnce(current9Original:Uint8Array,signedEnvelopeOriginal:Uint8Array):Promise<VoidResult>;
 readOriginalPair():Promise<Result<Pair>>;
 querySameOriginal():Promise<unknown>;
}
export interface Publication {
 state:'REJECTED'|'UNKNOWN'|'PUBLISHED'; memberOriginal:Uint8Array|null;envelopeOriginal:Uint8Array|null;
 error:unknown;errorPresent:boolean;signingSelected:boolean;publicationSelected:boolean;
 executionGranted:false;RootAdmission:false;SourceAdmission:false;NativeAdmission:false;
}
/** Typed implementation seam, NOT a Root/Native authority factory. */
export class OriginalNetworkCurrentCodecAdapter {
 constructor(capture:Capture,signer:FixedCurrentSigner,store:PairStore);
 publishOnce():Promise<Publication>;status():Publication;
 querySameOriginal():Promise<Readonly<{capture:unknown;store:unknown;publication:Publication;readOnly:true}>>;
 drain():Promise<Readonly<{closed:boolean;hasCustodyDebt:boolean;closeAmbiguous:boolean;stage:number;error:unknown;errorPresent:boolean}>>;
}
export type RegisteredPublisherReference=OriginalNetworkResourceCurrentPublisherReferenceV1;
/** Private sole-loader call; caller objects are rejected by an actual inventory. */
export function receiveOriginalNetworkCurrentSignerV1(reference:RegisteredPublisherReference,lexicalSigner:object):OriginalNetworkCurrentCodecAdapter;
export function acquireOriginalNetworkResourceCurrentPublisherV1():Promise<OriginalNetworkCurrentPublisherAcquisitionV1>;

