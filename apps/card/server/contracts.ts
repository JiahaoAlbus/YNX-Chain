export const CHAIN='0x1917' as const;
export const ENVIRONMENT='YNX_TESTNET_CARD_PAYMENT_SIMULATION' as const;
export class CardError extends Error {code:string;status:number;constructor(code:string,status=409){super(code);this.code=code;this.status=status}}
export type Principal={owner:string;chainId:typeof CHAIN|'ynx_6423-1';expiresAt:string;scopes:readonly string[]};
export type CardScope='account:read'|'card:application:write'|'card:controls:write'|'card:dispute:write'|'card:topup:write'|'card:simulation:write';
export type AuthenticationRequest={proofHeader:string;origin?:string;platform?:'web'|'ios'|'android';operation:'read'|'write';method:string;path:string;requiredScopes:readonly CardScope[]};
export type ApplicationDetails={nickname:string;useCase:string;limitWei:string;riskAccepted:boolean;termsVersion:string};
export type BusinessChallenge={id:string;applicationId:string;owner:string;chainId:typeof CHAIN;purpose:'create-testnet-card';payloadHash:string;nonce:string;issuedAt:string;expiresAt:string};
export type Approval={approved:boolean;approvalId:string;challengeId:string;owner:string;payloadHash:string;expiresAt:string;evmAddress?:string};
/** Supplied by the accepted Wallet owner adapter. Card does not implement Wallet
 * DeviceProof, signature recovery or Product Session completion. */
export interface WalletAuthority {authenticate(request:AuthenticationRequest):Promise<Principal>;approve(principal:Principal,expected:BusinessChallenge,proof:unknown,details:ApplicationDetails):Promise<Approval>}
export const unavailableWallet:WalletAuthority={async authenticate(){throw new CardError('PRIVATE_SERVICE_DEGRADED',503)},async approve(){throw new CardError('WALLET_APPROVAL_VERIFIER_UNAVAILABLE',503)}};
export type FundingIntent={id:string;cardId:string;owner:string;sender:string;chainId:typeof CHAIN;recipient:string;amountWei:string;minConfirmations:number;createdAt:string;expiresAt:string;status:'pending'|'credited';txHash?:string};
export type ChainReceipt={chainId:typeof CHAIN;txHash:string;from:string;to:string;amountWei:string;blockNumber:string;blockHash:string;confirmations:number;blockTime:string};
export interface CoreAuthority {verify(intent:FundingIntent,hash:string):Promise<ChainReceipt>}
export const unavailableCore:CoreAuthority={async verify(){throw new CardError('CARD_CORE_UNAVAILABLE',503)}};
export function address(value:unknown):string{if(typeof value!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(value))throw new CardError('INVALID_WALLET_ADDRESS',400);return value.toLowerCase()}
/** Business identifier validation only; authenticity comes from WalletAuthority. */
export function subject(value:unknown):string{if(typeof value==='string'&&/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(value))return value;return address(value)}
export function amount(value:unknown):bigint{if(typeof value!=='string'||! /^(0|[1-9][0-9]{0,77})$/.test(value))throw new CardError('INVALID_YNXT_AMOUNT',400);const n=BigInt(value);if(n<=0n||n>2n**256n-1n)throw new CardError('INVALID_YNXT_AMOUNT',400);return n}
export function digestInput(value:unknown):unknown{if(value===null||typeof value==='string'||typeof value==='boolean')return value;if(typeof value==='number'&&Number.isFinite(value))return value;if(Array.isArray(value))return value.map(digestInput);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,digestInput(v)]));throw new CardError('INVALID_REQUEST',400)}
