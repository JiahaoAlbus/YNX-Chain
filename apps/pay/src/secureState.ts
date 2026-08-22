import type {SignedPaymentIntent,WalletPaymentResult} from './walletAuth';
import {getProductState,removeProductState,setProductState} from './platformStorage';

const PREFIX='ynx-pay.secure.v2.';
export type PendingPayment=Readonly<{intent:SignedPaymentIntent;result?:WalletPaymentResult;updatedAt:string}>;
export type PendingSplitClaim=Readonly<{splitId:string;shareId:string;idempotencyKey:string;expiresAt:string;createdAt:string}>;

/** Wallet credentials, private keys, callback payloads and Product Sessions are owned by Wallet/Auth, never Pay storage. */
export async function clearRetiredWalletState(){await Promise.all(['session','authorization'].map(key=>removeProductState(PREFIX+key)))}
export async function loadPendingPayment():Promise<PendingPayment|null>{return load<PendingPayment>('payment',value=>value.intent?.productClientId==='ynx-pay-v1'&&typeof value.updatedAt==='string')}
export async function savePendingPayment(value:PendingPayment|null){return save('payment',value)}
export async function loadPendingSplitClaim():Promise<PendingSplitClaim|null>{return load<PendingSplitClaim>('split-claim',value=>/^spl_[a-f0-9]{20}$/.test(value.splitId)&&/^shr_[a-f0-9]{16}$/.test(value.shareId)&&/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/.test(value.idempotencyKey)&&Number.isFinite(Date.parse(value.createdAt))&&Date.parse(value.expiresAt)>Date.now())}
export async function savePendingSplitClaim(value:PendingSplitClaim|null){return save('split-claim',value)}
export async function loadLocale(){return getProductState(PREFIX+'locale')}
export async function saveLocale(value:string){return setProductState(PREFIX+'locale',value)}
export async function loadAILanguage(){return getProductState(PREFIX+'ai-language')}
export async function saveAILanguage(value:string){return setProductState(PREFIX+'ai-language',value)}
async function save(key:string,value:unknown|null){if(value===null)return removeProductState(PREFIX+key);return setProductState(PREFIX+key,JSON.stringify(value))}
async function load<T extends Record<string,unknown>>(key:string,valid:(value:T)=>boolean):Promise<T|null>{const raw=await getProductState(PREFIX+key);if(!raw)return null;try{const value=JSON.parse(raw) as T;if(valid(value))return value}catch{}await removeProductState(PREFIX+key);return null}
