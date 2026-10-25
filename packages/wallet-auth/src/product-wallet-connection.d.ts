import type {ProductSessionPlatform,ProductSessionPlatformSigner,WalletConnectionCoordinator,ProductSessionPublicationOutcome,ProductBusinessReadClient} from "./index.js";
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
/** Explicit old fixture/history contract. Never a normal49 device producer. */
export interface LegacyProductWalletConnectionConfiguration {
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
export type ProductWalletConnectionConfiguration=Omit<LegacyProductWalletConnectionConfiguration,'device'>&Readonly<{device:import('./product-session-device-v4.js').ProductSessionDevicePortsV4;deviceCurrent:import('./product-session-device-v4.js').OriginalProductSessionDeviceCurrentSourceV4;abortContext:import('./product-session-device-v4.js').ProductSessionDeviceAbortContextV4}>;
/** Currently throws PQ_DEVICE_ISSUER_NOT_SUPPLIED until the original v4 pairing
 * and issuer are supplied. Does not approve egress, access or a Product Session. */
export declare function createProductWalletConnection(config:ProductWalletConnectionConfiguration):WalletConnectionCoordinator;

/** New explicit native read lease; actual protected storage/device ports are
 * supplied by the platform owner after its visible narrow read permission.
 * No endpoint/session/provider/credential or login/restore input is accepted. */
export type ProductWalletBusinessReadConfiguration=Readonly<Pick<ProductWalletConnectionConfiguration,'registry'|'productId'|'storage'|'gatewayTimeoutMs'>&{platform:Exclude<ProductSessionPlatform,'web'>;device:import('./product-session-device-v4.js').ProductSessionDevicePortsV4;deviceCurrent:import('./product-session-device-v4.js').OriginalProductSessionDeviceCurrentSourceV4;abortContext:import('./product-session-device-v4.js').ProductSessionDeviceAbortContextV4}>;
/** Node/backend must explicitly import the original device-v4 AND entry; an
 * unsupported browser runtime fails closed without Node crypto or P256 fallback. */
export declare function createProductWalletBusinessReadClient(config:ProductWalletBusinessReadConfiguration):Promise<import('./product-session-device-v4.js').ProductSessionBusinessReadClientV4>;
