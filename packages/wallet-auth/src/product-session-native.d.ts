import type {ProductSessionGatewayFetchAdapter,ProductBusinessProofInput,ProductBusinessCommitmentInput,SocialAudienceProofInput,ProductSessionIntrospectionProof,ProductSessionPlatform} from "./index.js";
export type NativeProductPlatform=Exclude<ProductSessionPlatform,"web">;
export type NativeProductContext=Readonly<{platform:NativeProductPlatform;applicationId:string;deviceId:string;deviceKey:string;securityLevel:"hardware-backed"|"os-protected";generation:number;account:string|null}>;
export type NativeProductStorage=Readonly<{
 get(namespace:string,key:string,expected:NativeProductContext):Promise<string|null>;
 set(namespace:string,key:string,value:string,expected:NativeProductContext):Promise<void>;
 remove(namespace:string,key:string,expected:NativeProductContext):Promise<void>;
 requestRevocation(namespace:string,expected:NativeProductContext):void;
 revocationRequested(namespace:string,expected:NativeProductContext):boolean;
 saveRevocationIntent(namespace:string,key:string,raw:string,expected:NativeProductContext):Promise<string>;
 finishRevocationIntent(namespace:string,key:string,raw:string,expected:NativeProductContext):Promise<void>;
}>;
/** Native owner must atomically enforce expected context at storage/sign/open use. No software fallback. */
export type NativeProductRuntime=Readonly<{
 readContext():NativeProductContext;
 randomBytes(length:32):Uint8Array;
 sign(input:Readonly<{purpose:"challenge"|"http-proof";algorithm:"p256-sha256";deviceKey:string;payload:string}>,expected:NativeProductContext):Promise<string>;
 openWallet(input:Readonly<{url:string;request:Readonly<Record<string,unknown>>}>,expected:NativeProductContext):Promise<Readonly<{opened:boolean}>>;
 storage:NativeProductStorage;
}>;
export type NativeProductState=Readonly<Record<string,unknown>>;
export type NativeProductSessionAdapter=Readonly<{
 current:NativeProductState;binding:Readonly<Record<string,unknown>>;
 capabilities:Readonly<{kind:"product-private";identityGrant:false;securityLevel:"hardware-backed"|"os-protected";protectedRuntimeRequired:true;privateKeyExported:false;authority:string}>;
 connect():Promise<Readonly<{opened:boolean;state:NativeProductState;approved:false}>>;
 resumeWallet():Promise<Readonly<{opened:boolean;state:NativeProductState;approved:false}>>;
 beginExplicit():Promise<NativeProductState>;beginDetected(automatic?:boolean):Promise<NativeProductState>;retryDetected():Promise<NativeProductState>;
 restore(networkAvailable?:boolean):Promise<NativeProductState>;handleReturn(url:string):Promise<NativeProductState>;disconnect():Promise<NativeProductState>;
 createIntrospectionProof(scopes:readonly string[]):Promise<ProductSessionIntrospectionProof>;
 createBusinessProof(input:ProductBusinessProofInput):Promise<import("./index.js").ProductBusinessProof>;
 createBusinessProofCommitment(input:ProductBusinessCommitmentInput):Promise<import("./index.js").ProductBusinessProof>;
 createSocialAudienceProof(input:SocialAudienceProofInput):Promise<import("./index.js").SocialAudienceProof>;
 setNetworkAvailable(available:boolean):NativeProductState;enterGuest():NativeProductState;close():void;
}>;
export declare function createNativeProductSessionClient(config:Readonly<{registry:unknown;productId:string;platform:NativeProductPlatform;scopes:readonly string[];purpose:string;gateway:ProductSessionGatewayFetchAdapter;runtime:NativeProductRuntime;clock:()=>Date;finiteServiceSeconds?:number}>):Promise<NativeProductSessionAdapter>;
