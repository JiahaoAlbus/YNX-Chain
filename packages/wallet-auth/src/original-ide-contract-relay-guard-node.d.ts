import type {DeveloperContractRelayContext} from './walletconnect-dapp-connection.js';
declare const originalContractRelayGuard:unique symbol;
export interface OriginalIDEContractRelayScope extends DeveloperContractRelayContext {
 readonly kind:'ide-contract-relay-v1';
 readonly origin:'https://developer.ynxweb4.com';
 /** Absolute milliseconds, positive safe integer. */
 readonly expiresMS:number;
 readonly chainId:'eip155:6423';
 readonly methods:readonly ['ynx_preparePQContractAction','ynx_preparePQContractBroadcast','ynx_getPQContractOriginal'];
 readonly relayURL:'wss://relay.walletconnect.org';
}
export interface OriginalIDEContractRelayGuard {
 readonly [originalContractRelayGuard]:true;
 snapshot():Readonly<{scope:'local-only';closed:boolean;terminal:boolean;cleanup:'unknown'|'closed'|'unobserved';firstCause:Readonly<{present:boolean;code:string|null}>;remoteOutcome:'not-proven';replayAllowed:false}>;
 cancel():Promise<true>;
 revoke():Promise<true>;
 /** retire/join/close; uncertain cleanup remains UNKNOWN and retains owner. */
 close():Promise<void>;
}
/** No provider/module path override; original Native authenticates peer, running
 * server, project, scope and actual confirmation. No network initialization. */
export declare function acquireOriginalIDEContractRelayGuard(input:{serverModuleURL:string;expectedScope:OriginalIDEContractRelayScope}):Promise<OriginalIDEContractRelayGuard>;
