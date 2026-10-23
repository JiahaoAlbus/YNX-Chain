import {inspectPQContractDeploymentTransportOriginal,type PQTypedTransportExpected} from './typed-action-transport-reader.mjs';
import {inspectPQReviewedTypedTransportOriginal,type PQReviewedTypedTransportOriginal} from './typed-action-reviewed-transport.mjs';
import type {PQAuthorizationSnapshot} from '@ynx-chain/wallet-auth/pq-wallet-policy';
declare const snapshot:PQAuthorizationSnapshot,raw:Uint8Array,expected:PQTypedTransportExpected,review:unknown,original:PQReviewedTypedTransportOriginal;
const result=inspectPQContractDeploymentTransportOriginal(snapshot,raw,expected);
const required:true=result.compilerMaterialValidationRequired;
const grant:false=result.nativeAdmission;
const bytes:Uint8Array=result.material.artifactFile;
const reviewed=inspectPQReviewedTypedTransportOriginal(review,raw,original);
const material:Uint8Array|undefined=reviewed.material?.buildInfoFile;
// @ts-expect-error Source DATA does not grant compiler authenticity.
const verified:true=result.nativeAdmission;
// @ts-expect-error Both exact original hashes are required.
inspectPQContractDeploymentTransportOriginal(snapshot,raw,{account:'a',networkId:'n'});
void [required,grant,bytes,material,verified];
