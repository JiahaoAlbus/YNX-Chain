import {inspectPQGoValidatedContractMaterial} from './contract-deployment-material.mjs';
import type {PQNativeAction} from '@ynx-chain/wallet-auth/pq-native-action';
declare const action:PQNativeAction,artifactFile:Uint8Array,buildInfoFile:Uint8Array;
const match=inspectPQGoValidatedContractMaterial(action,{source:'exact original',material:{artifactFile,buildInfoFile}});
const verified:true=match.goMaterialPinsMatched;
const grant:false=match.permissionGranted;
// @ts-expect-error Material match is no native grant.
const root:true=match.nativeAdmission;
// @ts-expect-error Actual artifact bytes are required, never caller hash strings.
inspectPQGoValidatedContractMaterial(action,{source:'x',material:{artifactFile:'hash',buildInfoFile}});
void [verified,grant,root];
