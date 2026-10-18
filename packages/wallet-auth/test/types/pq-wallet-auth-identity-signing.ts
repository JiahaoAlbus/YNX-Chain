import {signPQWalletAuthIdentityRequest,type PQWalletKeyHandle} from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import type {PQAuthorizationSnapshot} from '@ynx-chain/wallet-auth/pq-wallet-policy';
declare const key:PQWalletKeyHandle;
declare const snapshot:PQAuthorizationSnapshot;
const wire:Uint8Array=signPQWalletAuthIdentityRequest(key,'canonical original R82 request',snapshot,'100');
// @ts-expect-error Opaque original key custody cannot be replaced with a DTO.
signPQWalletAuthIdentityRequest({},'request',snapshot,'100');
// @ts-expect-error R82 proof input is canonical request JSON, not arbitrary bytes.
signPQWalletAuthIdentityRequest(key,new Uint8Array(),snapshot,'100');
// @ts-expect-error Original time observation is a decimal string.
signPQWalletAuthIdentityRequest(key,'request',snapshot,100);
// @ts-expect-error No caller-selected purpose or raw-sign options.
signPQWalletAuthIdentityRequest(key,'request',snapshot,'100',{purpose:'TX-BATCH'});
// @ts-expect-error Proof bytes never return an authority or native owner.
wire.invoke();
void wire;
