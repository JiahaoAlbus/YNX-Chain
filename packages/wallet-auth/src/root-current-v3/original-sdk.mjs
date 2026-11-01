// Original readonly kernel, registered-member AND and fixed Native IO.
// SDK relocation maps only these original module operands, never a provider.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
export {OriginalRootReadV2Kernel} from '../original-source-root-ledger-v2.js';
export {canonical,sha} from '../../native/original-auth-identity-source-verifier.mjs';
export {inspectRootManifestV2,rootExact} from '../../native/original-source-root-contract-v2.mjs';
export {verifyPQRegisteredMemberData} from '../pq-registered-member.js';
export {inspectPQAuthorizationView,assertPQAuthorizationCurrent} from '../pq-wallet-policy.js';
export {inspectNativeCommittedProductPolicyV4Data} from '../product-pair-session-v4-account-source.js';
export {parseProductSessionRegistry} from '../product-session-registry.js';
export {fetchOriginalNativeAuthorization} from '../../native/original-ide-auth-proof-dispatch.mjs';
export {captureOriginalRootCurrentV3} from './root-current-capture-v3.mjs';
export function openOriginalRootReadOnlyIO(){
 const motherURL=new URL('../original-source-root-owner-v2.js',import.meta.url);
 const native=createRequire(motherURL)(fileURLToPath(new URL('../../../apps/wallet-desktop/native/original-source-root-dirfd.node',motherURL)));
 return Object.freeze({openV2:(p,l)=>native.openV2Existing(p,l),ready:(...a)=>native.ready(...a),list:(...a)=>native.list(...a),read:(...a)=>native.read(...a),write(){throw Error('ROOT_V3_READ_ONLY');},close:(...a)=>native.close(...a)});
}
