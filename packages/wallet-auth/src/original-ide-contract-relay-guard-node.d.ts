import type {DeveloperContractRelayContext} from './walletconnect-dapp-connection.js';
declare const originalContractRelayGuard:unique symbol;
export interface OriginalIDEContractRelayScope extends DeveloperContractRelayContext {
 /** Actual original signed peer nodeCodeIdentity, never supplied by the IDE. */
 readonly callerIdentity:string;
 readonly kind:'ide-contract-relay-v1';
 readonly origin:'https://developer.ynxweb4.com';
 /** Absolute milliseconds, positive safe integer. */
 readonly expiresMS:number;
 readonly chainId:'eip155:6423';
 readonly methods:readonly ['ynx_preparePQContractAction','ynx_preparePQContractBroadcast','ynx_getPQContractOriginal'];
 readonly relayURL:'wss://relay.walletconnect.org';
}
export interface OriginalIDEContractRelayExpectedScope {
 readonly projectId:string;
 readonly projectGeneration:number;
 /** Positive safe integer upper bound; Native actual expiry must not exceed it. */
 readonly expiresMS:number;
 readonly callerIdentity?:string;
 readonly kind?:'ide-contract-relay-v1';
 readonly origin?:'https://developer.ynxweb4.com';
 readonly chainId?:'eip155:6423';
 readonly methods?:readonly ['ynx_preparePQContractAction','ynx_preparePQContractBroadcast','ynx_getPQContractOriginal'];
 readonly relayURL?:'wss://relay.walletconnect.org';
}
export interface OriginalIDEContractRelayLocalContext {
 /** Actual absolute normalized non-root paths, at most 4096 UTF-8 bytes and
  * without controls. Native additionally verifies realpath/held directory FDs. */
 readonly workspace:string;
 readonly profile:string;
 /** ASCII [A-Za-z0-9_-]{1,128}, compared with signed projectLaunch.localProjectId.
  * It is never the canonical projectId or an authority. */
 readonly id:string;
}
export interface OriginalIDEContractRelayScopeData extends OriginalIDEContractRelayScope {
 readonly dataOnly:true;readonly authorized:false;readonly nativeAdmission:false;
}
export interface OriginalIDEContractRelayGuard {
 readonly [originalContractRelayGuard]:true;
 /** Frozen copies of retained scope DATA, or null if none was captured.
  * Does not read Native current, grant permission, or initialize networking. */
 readScopeData():Readonly<OriginalIDEContractRelayScopeData>|null;
 snapshot():Readonly<{scope:'local-only';closed:boolean;terminal:boolean;cleanup:'unknown'|'closed'|'unobserved';firstCause:Readonly<{present:boolean;code:string|null}>;remoteOutcome:'not-proven';replayAllowed:false}>;
 cancel():Promise<true>;
 revoke():Promise<true>;
 /** retire/join/close; uncertain cleanup remains UNKNOWN and retains owner. */
 close():Promise<void>;
}
/** No provider/module path override; original Native authenticates peer, running
 * server, project, scope and actual confirmation. No network initialization. */
export declare function acquireOriginalIDEContractRelayGuard(input:{serverModuleURL:string;localContext:OriginalIDEContractRelayLocalContext;expectedScope?:OriginalIDEContractRelayExpectedScope}):Promise<OriginalIDEContractRelayGuard>;
/** Synchronously checks the original ready owner's Native current and unchanged
 * nine-field scope before returning frozen scope DATA. Rejects partial, forged,
 * expired, revoked or closed owners; does not renew expiry or initialize Relay.
 * This is not an Auth principal, account credential or Wallet RPC approval. */
export declare function assertOriginalIDEContractRelayGuardCurrent(guard:OriginalIDEContractRelayGuard):Readonly<OriginalIDEContractRelayScopeData>;
