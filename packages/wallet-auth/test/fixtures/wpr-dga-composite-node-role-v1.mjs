// Source-role metadata only. No image, Native, Root or Source admission.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const pin=(bytes,sha256)=>Object.freeze({bytes,sha256});
export const WPR_DGA_COMPOSITE_NODE_ROLE=Object.freeze({
 version:1,role:'common-node-original-wpr-and-existing-desktop-grant/v1',
 current:pin(85016,'263abc624f6925d26531eed295d19b652578f8c5f65d6d2c67d00eb8818a0ce0'),
 withoutDGA:pin(84915,'9c52a7b44c69eec10998da904a1630257cfb673f6005c621dc2f850443b28c0c'),
 withoutWPR:pin(84892,'37489fe24cd668d2b92cc6a7bf0ff9d1a1a87483025e99b67e04252fd51ea9de'),
 originalBeforeBoth:pin(84791,'5505f703dd98de2510b2a77390c58ac6ddb7c346d30aeab2573d23b62cb24788'),
 WPRHeaderSHA256:'f19b84bb91b8ce9eb5feecf1427d8b2777091e198d8a7b05ab03590d4e330e01',
 WPRImplementationSHA256:'3363ea003bd9fbacaf561b203ce0b3addb7d90930705496dd62f50ffe5143c57',
});
const wpr=['#include "WPRMaterializationNodeHostPrivate.h"\n',' if(YNXInstallWPRMaterializationLoanV1(env,exports)!=napi_ok)return nullptr;\n'];
const dga=['#include "desktop-grant-native-private.h"\n',' RegisterOriginalTaskGrantAuthorityBackendV1(env,exports);\n'];
const hash=b=>createHash('sha256').update(b).digest('hex');
function check(raw,expected){assert.equal(Buffer.byteLength(raw),expected.bytes);assert.equal(hash(raw),expected.sha256);}
function remove(raw,lines){for(const line of lines){assert.equal(raw.split(line).length-1,1,'each original hook must occur exactly once');raw=raw.replace(line,'');}return raw;}
export function inspectWPRDesktopGrantCompositeNodeRoleDATA(input){
 assert(Buffer.isBuffer(input),'metadata input must be actual file bytes');const raw=Buffer.from(input).toString('utf8'),r=WPR_DGA_COMPOSITE_NODE_ROLE;
 check(raw,r.current);const a=remove(raw,dga),b=remove(raw,wpr);check(a,r.withoutDGA);check(b,r.withoutWPR);const c=remove(a,wpr),d=remove(b,dga);assert.equal(c,d);check(c,r.originalBeforeBoth);
 return Object.freeze({role:r.role,dataOnly:true,NativeAdmission:false,RootAdmission:false,SourceAdmission:false});
}
