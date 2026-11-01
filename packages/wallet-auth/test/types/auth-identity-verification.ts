import {AUTH_IDENTITY_PURPOSES,type OriginalAuthIdentityRequest} from '@ynx-chain/wallet-auth/auth-identity-contract';
import {verifyOriginalAuthIdentityMemberData} from '@ynx-chain/wallet-auth/auth-identity-verification';
import type {PQAuthorizationSnapshot} from '../../src/pq-wallet-policy.js';
declare const snapshot:PQAuthorizationSnapshot;
declare const request:OriginalAuthIdentityRequest;
const data=verifyOriginalAuthIdentityMemberData(snapshot,new Uint8Array(),'raw','expected',AUTH_IDENTITY_PURPOSES.receive,'100');
const noPermission:false=data.authorized;
const samePrincipal:string=data.body.principalId;
// @ts-expect-error Transaction signing purpose is not an Auth identity purpose.
verifyOriginalAuthIdentityMemberData(snapshot,new Uint8Array(),'raw','expected','TX-BATCH','100');
// @ts-expect-error Even verified identity DATA cannot expose a protected key.
data.privateKey;
// @ts-expect-error Canonical keyVersion must not be rounded into Number.
const rounded:OriginalAuthIdentityRequest={...request,keyVersion:1};
void [noPermission,samePrincipal];
