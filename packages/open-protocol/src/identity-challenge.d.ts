export type NetworkBindingV1=Readonly<{kind:'offchain'}>|Readonly<{kind:'ynx-chain';genesis:Uint8Array;nativeChainId:string;networkId:Uint8Array}>;
export interface IdentityChallengeV1DATA {
 readonly realm:Uint8Array;readonly networkBinding:NetworkBindingV1;readonly tenant:Uint8Array;
 readonly agentId:Uint8Array;readonly epoch:string;readonly audience:Uint8Array;
 readonly channelBinding:Uint8Array;readonly nonce:Uint8Array;
 /** Canonical decimal uint64 Unix milliseconds. DATA, not a trusted clock. */
 readonly issuedAt:string;readonly expiresAt:string;
}
export declare const IDENTITY_CHALLENGE_DOMAIN:'YNX-OPEN/IDENTITY-CHALLENGE/1';
export declare const IDENTITY_AUTH_PURPOSE:'YNX-OPEN/IDENTITY-AUTH/1';
/** New typed DATA codec only. No authentication, replay or freshness grant. */
export declare function encodeIdentityChallengeV1DATA(challenge:IdentityChallengeV1DATA):Uint8Array;
export type IdentityChallengeV1ExpectedDATA=Pick<IdentityChallengeV1DATA,'realm'|'networkBinding'|'tenant'|'agentId'|'epoch'|'audience'|'channelBinding'>;
export declare function assertIdentityChallengeV1BindingDATA(challenge:IdentityChallengeV1DATA,expected:IdentityChallengeV1ExpectedDATA):void;
export declare function decodeIdentityChallengeV1DATA(wire:Uint8Array,expected?:IdentityChallengeV1ExpectedDATA):IdentityChallengeV1DATA;
