import {types} from 'node:util';
import {normalizePQNativeTransferAmounts} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
const fail=()=>{throw Object.assign(Error('Supply a recipient and a canonical native integer amount; no decimal conversion is applied.'),{code:'PQ_TRANSFER_INPUT_INVALID'});};
// Renderer DATA adapter only. The sole SDK owns the amount/fee total range;
// current policy, balance, nonce and independent approval still come later.
export function normalizeWalletPQTransferInput(input){
 if(!input||types.isProxy(input)||Object.getPrototypeOf(input)!==Object.prototype)fail();
 const d=Object.getOwnPropertyDescriptors(input),keys=Reflect.ownKeys(d);
 if(keys.length!==2||!keys.includes('amount')||!keys.includes('to')||keys.some(k=>!d[k].enumerable||!Object.hasOwn(d[k],'value'))||typeof d.to.value!=='string'||typeof d.amount.value!=='string')fail();
 const normalized=normalizePQNativeTransferAmounts({amount:d.amount.value,fee:'1'});
 return Object.freeze({to:d.to.value,amount:normalized.amount});
}
