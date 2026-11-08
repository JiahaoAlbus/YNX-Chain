// Static original Node composition. No request chooses its verifier/provider.
import{createDeviceSourceKernelFromFixedParts}from'./original-auth-source-v2-device-kernel.mjs';
import{deviceScopeRegistry}from'./original-auth-source-v2-device-scopes-node.mjs';
import{verifyPQRegisteredMemberData}from'../src/pq-registered-member.js';
import{encodeOriginalAuthSourceStatementV2}from'./original-auth-source-v2-public-codec.mjs';
const purposes=Object.freeze({enrollment:'AUTH-SOURCE-ENROLLMENT',profile:'AUTH-SOURCE-PROFILE',current:'AUTH-SOURCE-CURRENT'});
function verifyMath(role,frame,binding,bodyRaw,wire,snapshot){return verifyPQRegisteredMemberData(snapshot,wire,{chainId:binding.networkId,owner:binding.owner,keyVersion:binding.keyVersion,executionHeight:snapshot.executionHeight,purpose:purposes[role],message:encodeOriginalAuthSourceStatementV2(role,frame,binding,bodyRaw)});}
export const originalDeviceSourceV2NodeKernel=createDeviceSourceKernelFromFixedParts(Object.freeze({scopeRegistry:deviceScopeRegistry,verifyMath}));
