import {verifyPQRegisteredMemberData,assertPQRegisteredRecoveryBindingData} from '@ynx-chain/wallet-auth/pq-registered-member';
import type {PQAuthorizationSnapshot} from '../../src/pq-wallet-policy.js';
import type {PQPublicBinding} from '../../src/pq-wallet-contract.js';
declare const snapshot:PQAuthorizationSnapshot;
declare const binding:PQPublicBinding;
const context={chainId:'network',owner:'owner',keyVersion:'1',executionHeight:'9007199254740993'};
const result=verifyPQRegisteredMemberData(snapshot,new Uint8Array(),{...context,purpose:'original Auth owned purpose',message:new Uint8Array()});
const noGrant:false=result.nativeAdmission;
const dataOnly:true=assertPQRegisteredRecoveryBindingData(snapshot,binding,context).dataOnly;
// @ts-expect-error A Number cannot represent the registered U64 keyVersion.
verifyPQRegisteredMemberData(snapshot,new Uint8Array(),{...context,keyVersion:1,purpose:'purpose',message:new Uint8Array()});
// @ts-expect-error A mathematical result cannot export or invoke a protected key.
result.invoke();
void [noGrant,dataOnly];
