import {planPQNativeAction} from '../../src/pq-wallet-policy.js';
import type {PQAuthorizationSnapshot} from '../../src/pq-wallet-policy.js';
import {signPQWalletNativeAction} from '../../src/pq-wallet-key-backup.js';
import type {PQWalletKeyHandle} from '../../src/pq-wallet-key-backup.js';
import type {PQNativeActionInput} from '../../src/pq-native-action.js';
declare const handle:PQWalletKeyHandle;declare const snapshot:PQAuthorizationSnapshot;
const action={chainId:'00'.repeat(32),nativeChainId:'6423',owner:'0x'+'11'.repeat(20),nonce:'2',fee:'1',kind:'stake_delegate',payload:{validator:'PUBLIC',amountYNXT:'1'}} as const;
const input:PQNativeActionInput=action;const planned=planPQNativeAction(snapshot,action);
const kind:'stake_delegate'=planned.action.kind;const amount:string=planned.action.payload.amountYNXT;const wire:Uint8Array=signPQWalletNativeAction(handle,action,snapshot);
// @ts-expect-error A serializable object is not opaque key custody.
signPQWalletNativeAction({},action,snapshot);
// @ts-expect-error Raw bytes are not a typed Action.
signPQWalletNativeAction(handle,new Uint8Array(),snapshot);
// @ts-expect-error No purpose/raw signing override.
signPQWalletNativeAction(handle,action,snapshot,'OTHER');
// @ts-expect-error No arbitrary Action kind.
const invalid:PQNativeActionInput={...action,kind:'raw_sign'};
// @ts-expect-error Kind-specific payload is not interchangeable.
const mismatched:PQNativeActionInput={...action,kind:'stake_withdraw'};
// @ts-expect-error Unsafe JS numbers never carry U64 amounts.
const numeric:PQNativeActionInput={...action,payload:{validator:'PUBLIC',amountYNXT:9007199254740993}};
// @ts-expect-error Plan payload is frozen.
planned.action.payload.amountYNXT='2';
void [input,kind,amount,wire,invalid,mismatched,numeric];
