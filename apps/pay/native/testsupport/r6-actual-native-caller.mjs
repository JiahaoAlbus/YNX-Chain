// New P06 consumer integration with the exact original Auth Native component.
// This is neither a fake producer nor whole-Main/Root admission. No old packet,
// signature, Root0 matrix, key or network group is executed by this case.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {openNativePayProductSource} from '../r6/product-source.mjs';
const file=process.argv[2],output=process.argv[3];
if(!path.isAbsolute(file??'')||!path.isAbsolute(output??''))throw Error('Exact verified supplier intake and owned output required');
const intake=JSON.parse(fs.readFileSync(file)),image=intake.nativeImage;
function check(row){const bytes=fs.readFileSync(row.path);assert.equal(bytes.length,row.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256);}
for(const row of [intake.authHandoff,intake.authSourcePins,intake.SDKHandoff,intake.SDKManifest,image,...intake.authPhysical,...intake.SDKPhysical])check(row);
const native=createRequire(import.meta.url)(image.path);
assert.equal(typeof native.acquireOriginalProductSource,'function');assert.equal(typeof native.isOriginalProductSource,'function');
let nativePartial,originalError,consumerError,captures=0,recognitions=0;
try{await openNativePayProductSource({
 acquireOriginalProductSource(){captures++;try{return native.acquireOriginalProductSource();}catch(error){originalError=error;nativePartial=Object.getOwnPropertyDescriptor(error,'partial')?.value;throw error;}},
 isOriginalProductSource(value){recognitions++;assert.equal(value,nativePartial);return native.isOriginalProductSource(value);}
});}catch(error){consumerError=error;}
assert.equal(captures,1);assert.equal(recognitions,1);assert.equal(originalError.code,'PRODUCT_SOURCE_CAPTURE_FAILED');assert.equal(originalError.cause.code,'PRODUCT_SOURCE_ROOT_NOT_SUPPLIED');
assert.equal(native.isOriginalProductSource(nativePartial),true);assert.equal(consumerError.code,'NATIVE_PAY_PRODUCT_SOURCE_CAPTURE_FAILED');assert.equal(consumerError.cause,originalError);
const source=consumerError.partial;assert.ok(source);assert.equal(source.status().ready,false);assert.equal(source.status().SourceAdmission,false);
assert.throws(()=>source.current(),error=>error===originalError);
source.retire();await source.join();const closing=source.close();assert.equal(closing,source.close());await closing;source.assertSafeToClose();
nativePartial.assertSafeToClose();assert.equal(source.status().closed,true);assert.equal(source.status().cleanupFailed,false);assert.equal(source.status().operationFailed,true);
assert.throws(()=>source.current(),error=>error===originalError);
for(const key of ['originalPQOpen','initializeOriginalWalletMainNamespaceV1','acquireOriginalPaySource'])assert.equal(typeof native[key],'function');
const result={result:'PASS',actualNativeFactoryCalledOnce:true,actualNativeRecognizer:true,nonnullNativePartialAdopted:true,originalCaptureCausePreserved:true,actualRetireJoinClose:true,sameClosePromise:true,NativeAndConsumerSafeToClose:true,operationFailureSeparateFromPhysicalClose:true,existingWalletRegistrarsPresent:true,verifiedInput:file,nativeImage:image,SDK17AndAuth28Supplied:true,normalReaderProducerIntegratedInThisImage:false,archive14IntegrationInThisImageClaimed:false,wholeMainNamespaceAdmitted:false,RootAdmission:false,SourceAdmission:false,network:false,keysOpened:false,signCalled:false,funds:false};
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result)+'\n');
