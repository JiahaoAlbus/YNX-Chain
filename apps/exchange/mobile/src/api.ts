import {productSessionUnavailable,type CentralSession} from './wallet';

export type IntegrationStatus={gateway:string;gatewayReason?:string;walletRegistry:string;custody:string;indexer:string;crossChain:string};
export type Config={chainId:string;custodyAddress:string;integrations:IntegrationStatus;networks:Array<{asset:string;network:string;depositEnabled:boolean;withdrawalEnabled:boolean;withdrawalReviewEnabled:boolean;crossChain:boolean;unavailableReason?:string;withdrawalFeeMicro?:number}>;warnings:string[]};
export type Order={id:string;side:string;priceMicro:number;amountMicro:number;filledMicro:number;status:string;createdAt:string;authorizationDigest:string};
export type PublicTrade={id:string;priceMicro:number;amountMicro:number;createdAt:string;sourceType:string;sourceDigest:string};
export type Account={balances:Array<{asset:string;availableMicro:number;reservedMicro:number}>;orders:Order[];trades:unknown[];fees:unknown[];ledger:unknown[];audit:unknown[];security:{withdrawalLock:boolean;orderConfirmation:boolean;sessionTtlMinutes:number}};

function productApiUnavailable(){return new Error('API_UNAVAILABLE: Exchange product API is PENDING in the accepted endpoint manifest. No request was sent.')}

/** Public and private Exchange product endpoints are unavailable until Integration publishes product evidence. */
export async function publicState():Promise<{config:Config;markets:any[];book:{bids:any[];asks:any[]};trades:PublicTrade[]}>{throw productApiUnavailable()}
export async function account(_session:CentralSession):Promise<Account>{throw productSessionUnavailable()}
export async function placeOrder(_session:CentralSession,_input:unknown):Promise<Order>{throw productSessionUnavailable()}
export async function draftAI(_session:CentralSession,_prompt:string,_language:string):Promise<{status:string;providerStatus:string}>{throw productSessionUnavailable()}
