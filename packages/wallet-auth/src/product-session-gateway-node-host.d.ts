import type {PrivateBusinessRegistration,ProductSessionV2} from './index.js';
export declare const PRODUCT_SESSION_GATEWAY_NODE_STATE_SCHEMA_VERSION: 1;
export type ProductSessionGatewayNodeHostOptions=Readonly<{
  now:()=>Date;statePath:string;tokenFactory:()=>string;
  centralBrowser?:boolean;centralBrowserEcosystem?:boolean;businessRevalidation?:boolean;
  privateBusinessRevalidation?:boolean;privateBackendRegistrations?:readonly PrivateBusinessRegistration[];
  centralBackend?:Readonly<{backendClients:readonly Readonly<{clientId:string;keyId:string;publicKey:string}>[];familySealKey:unknown}>;
  centralOIDC?:unknown;
}>;
/** familySealKey must be a Node Buffer of 32 bytes; explicit central adoption and exact provisioned public keys are required. */
export declare class ProductSessionGatewayNodeHost {
  constructor(registry:unknown,options:ProductSessionGatewayNodeHostOptions);
  handler():(request:unknown,response:unknown)=>Promise<void>;
  snapshot():Readonly<Record<string,unknown>>;
  revalidate(session:ProductSessionV2,scopes:readonly string[],productId:string,at:Date,businessRevalidation?:boolean):Readonly<{active:true;session:ProductSessionV2}>;
}
