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
export declare function acquireOriginalIDEContractRelayGuard(input:{serverModuleURL:string;expectedScope:OriginalIDEContractRelayExpectedScope}):Promise<OriginalIDEContractRelayGuard>;
