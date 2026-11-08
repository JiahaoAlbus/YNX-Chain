// One NEW actual SDK/Native coupling of the pending-phase fix. PUBLIC Root
// ports only; this Native child is not a whole ProductSource or Pay parent.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const file=process.env.PUBLIC_SHOP_SDK_MODULE;
assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),'46bac4ea711d4a5bd0a2816e38770da371d14443398459f19aa47e6ec56ce822');
const sdk=await import(pathToFileURL(file).href);
const native=createRequire(import.meta.url)(process.env.PUBLIC_SHOP_NATIVE_IMAGE);
const capture=sdk.acquireOriginalShopPrivateClient();
assert.equal(capture.errorPresent,false);
const child=capture.owner;
assert.equal(sdk.isOriginalShopPrivateClient(child),true);
let present=false,first;
try{await child.close();}catch(cause){present=true;first=cause;}
assert.equal(present,true);
assert.equal(child.isClosed(),false);
assert.deepEqual(child.readOriginalCustodyDATA(),{selected:true,unknown:false,physicalDone:false});
const before=native.PUBLICcounts();
assert.equal(before.sessionCloses,1);assert.equal(before.sessionDrops,1);
assert.equal(before.sourceJoins,1);assert.equal(before.sourceCloses,0);
// The historical first failure remains exact; physical completion can still
// progress through a known pending phase of the SAME owner. UNKNOWN is never
// retried. SDK's physical witness grants no whole-parent close assertion.
await assert.rejects(child.close(),cause=>cause===first);
assert.equal(child.isClosed(),true);
assert.deepEqual(child.readOriginalCustodyDATA(),{selected:true,unknown:false,physicalDone:true});
const after=native.PUBLICcounts();
assert.equal(after.sessionCloses,1);assert.equal(after.sessionDrops,1);
assert.equal(after.sourceJoins,2);assert.equal(after.sourceCloses,1);assert.equal(after.sourceDrops,1);
assert.equal(after.reads,0);assert.equal(after.proofs,0);
await assert.rejects(child.close(),cause=>cause===first);
assert.deepEqual(native.PUBLICcounts(),after);
console.log(JSON.stringify({version:'pay-shop-sdk-native-parent-progress/v1',node:process.versions.node,electron:process.versions.electron,actualSDKWrapper:true,actualNativePendingProgressFix:true,originalFirstCausePreserved:true,knownPhaseProgressedSameOwner:true,nativeCounts:after,childPhysicallyClosed:true,wholeProductSourceOrPayClosed:false,RootAdmission:false,actualV4Proof:false,normalCombinedImage:false,AppModified:false,installed:false,payDispatched:0,signing:0,funds:0}));
