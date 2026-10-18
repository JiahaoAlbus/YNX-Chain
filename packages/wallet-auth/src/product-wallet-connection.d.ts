import type {ProductSessionPlatform,ProductSessionPlatformSigner,WalletConnectionCoordinator,ProductSessionPublicationOutcome} from "./index.js";
export declare const PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN: "https://wallet-auth.ynxweb4.com";
/** Fixed normal HTTPS caller only; not Native/Source or deployment admission.
 * No endpoint/fetch/key/provider option and no automatic publish retry. */
export declare function createProductWalletReturnPublisher(config:Readonly<{gatewayTimeoutMs:number}>):Readonly<{
 currentTime(input:Readonly<{requestId:string}>):Promise<Date>;
 publishReturn(input:Readonly<{requestId:string;request:unknown;approval:unknown}>):Promise<Readonly<{reference:string;nonce:string;state:string;expiresAt:string}>>;
 publicationOutcome(input:Readonly<{requestId:string;publicationRequestId:string;request:unknown;approval:unknown}>):Promise<ProductSessionPublicationOutcome>;
}>;
/** Actual protected bridge, supplied by the native/platform owner. The label alone is not proof of OS custody. */
export interface ProductWalletProtectedStorage {
 readonly securityLevel: "hardware-backed"|"os-protected"|"webcrypto-nonextractable";
 get(key:string):Promise<string|null>;
 set(key:string,value:string):Promise<void>;
 remove(key:string):Promise<void>;
 revocationRequested?():boolean;
 saveRevocationIntent?(key:string,value:string):Promise<string>;
 finishRevocationIntent?(key:string,expected:string):Promise<unknown>;
 finishRevocationIntentWithCompletion?(key:string,expected:string,receipt:string):Promise<string>;
 getRevocationCompletions?(key:string):Promise<unknown>;
 getRevocationCompletion?(key:string,intentId:string):Promise<string|null>;
 acknowledgeRevocationCompletion?(key:string,receipt:string):Promise<void>;
}
export interface ProductWalletConnectionConfiguration {
 readonly registry:unknown;
 readonly productId:string;
 readonly platform:ProductSessionPlatform;
 readonly walletInstalled:()=>boolean|Promise<boolean>;
 readonly schemeRegistered:()=>boolean|Promise<boolean>;
 readonly gatewayTimeoutMs:number;
 readonly storage:ProductWalletProtectedStorage;
 readonly device:Readonly<{id:string;key:string;sign:ProductSessionPlatformSigner;scopes:readonly string[];purpose:string}>;
 readonly scope:object;
 readonly discoveryWaitMs:number;
 readonly openWallet:(input:Readonly<{url:string;request:Readonly<Record<string,unknown>>;requestId:string;automatic:boolean;productId:string;platform:ProductSessionPlatform}>)=>Readonly<{opened:true}|{opened:false;code:string}>|Promise<Readonly<{opened:true}|{opened:false;code:string}>>;
 readonly openTimeoutMs:number;
}
/** Composition only; constructor does not approve egress, project access or a Product Session. */
export declare function createProductWalletConnection(config:ProductWalletConnectionConfiguration):WalletConnectionCoordinator;
