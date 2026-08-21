import {createProductWalletConnection,PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN} from "@ynx-chain/wallet-auth";
import registry from "../vendor/product-session-registry-46386ae8.json";

export const CARD_PRODUCT_SESSION_V2_ORIGIN=PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN;
export const CARD_PRODUCT_SESSION_V2_ROUTES=Object.freeze(["/v2/product-sessions/challenge","/v2/product-sessions/complete","/v2/product-sessions/introspect","/v2/product-sessions/revoke"] as const);
export type CardProductWalletConnection=ReturnType<typeof createProductWalletConnection>;

type Device=Readonly<{id:string;key:string;sign:(input:Readonly<{purpose:"challenge"|"http-proof";algorithm:"p256-sha256";deviceKey:string;payload:string}>)=>Promise<string>;scopes:readonly string[];purpose:string}>;
type ProtectedStorage=Readonly<{securityLevel:"os-protected";get:(key:string)=>Promise<string|null>;set:(key:string,value:string)=>Promise<void>;remove:(key:string)=>Promise<void>}>;
export type CardProductWalletCapabilities=Readonly<{platform:"web"|"ios"|"android";walletInstalled:()=>Promise<boolean>;schemeRegistered:()=>Promise<boolean>;storage:ProtectedStorage;device:Device;openWallet:(input:Readonly<{url:string}>)=>Promise<Readonly<{opened:true}|{opened:false;code:string}>>}>;

export function createCardProductWalletConnection(capabilities:CardProductWalletCapabilities):CardProductWalletConnection{
  return createProductWalletConnection({registry,productId:"card",platform:capabilities.platform,walletInstalled:capabilities.walletInstalled,schemeRegistered:capabilities.schemeRegistered,gatewayTimeoutMs:10_000,storage:capabilities.storage,device:capabilities.device,scope:globalThis,discoveryWaitMs:0,openWallet:capabilities.openWallet,openTimeoutMs:10_000});
}
