import {normalizePQNativeTransferAmounts,PQ_NATIVE_TRANSFER_TOTAL_MAX} from '../../src/pq-wallet-authorization.js';
const total:bigint=PQ_NATIVE_TRANSFER_TOTAL_MAX;
const amounts=normalizePQNativeTransferAmounts({amount:total-1n,fee:'1'});
const amount:string=amounts.amount;
const fee:string=amounts.fee;
// @ts-expect-error JS Numbers must not silently round protocol integers.
normalizePQNativeTransferAmounts({amount:1,fee:'1'});
// @ts-expect-error fee has the same exact integer wire type.
normalizePQNativeTransferAmounts({amount:'1',fee:1});
// @ts-expect-error No guessed EVM decimal profile exists in this interface.
normalizePQNativeTransferAmounts({amount:'1',fee:'1',decimals:18});
// @ts-expect-error The detached result is read-only.
amounts.amount='2';
void [amount,fee];
