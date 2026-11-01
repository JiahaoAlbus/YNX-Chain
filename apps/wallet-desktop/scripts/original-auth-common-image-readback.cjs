const assert=require('node:assert/strict');
assert.equal(process.version,'v24.19.0');assert.equal(process.versions.modules,'137');assert.equal(process.versions.napi,'10');assert.equal(process.versions.uv,'1.52.1');
(async()=>{const image=require(process.argv[2]);
const namespace=['initializeOriginalWalletMainNamespaceV1','isOriginalWalletMainNamespaceOwnerV1','retireOriginalWalletMainNamespaceV1','joinOriginalWalletMainNamespaceV1','closeOriginalWalletMainNamespaceV1','openOriginalWalletMainNamespaceLoaderV1'];
const pq=['originalPQOpen','originalPQCurrent','originalPQRetire','originalPQTransactionOnce','originalPQCopyOutcome','originalPQClose','originalPQReleaseClosed','originalPQCapabilities','originalPQOpenInitial','originalPQInitialOnce'];
for(const name of[...namespace,...pq,'acquireOriginalPaySource','isOriginalPaySource'])assert.equal(typeof image[name],'function',name);
assert.equal(typeof image.acquireOriginalIDEHeldSessionReadCapture,'function');
assert.equal(typeof image.originalPQCapabilities(),'number');assert.throws(()=>image.originalPQOpen(),/ARGUMENTS/); // Never opens a key/account.
let startup;try{image.initializeOriginalWalletMainNamespaceV1();assert.fail('Root0 must reject');}catch(cause){assert.equal(cause.code,'PAY_NATIVE_CODE_ROOT_NOT_SUPPLIED');startup=cause.partial;assert(startup);}
assert(image.isOriginalWalletMainNamespaceOwnerV1(startup));assert.equal(image.isOriginalPaySource(startup),false);image.retireOriginalWalletMainNamespaceV1(startup);await image.joinOriginalWalletMainNamespaceV1(startup);await image.closeOriginalWalletMainNamespaceV1(startup);
const account='0x'+'1'.repeat(40),intentId='npi_'+'a'.repeat(48);let source;
try{image.acquireOriginalPaySource({request:null,original:{account,hash:'0x'+'b'.repeat(64),operationId:'public-normal-gate',typed:{networkId:'a'.repeat(64),memberHash:'0x'+'c'.repeat(64)}},target:{version:1,service:'pay',kind:'invoice_terms',intentId,merchant:account,invoiceId:'public:invoice',requestPath:'/v5/pay/invoice-intents/'+intentId+'/merchant-member'}});assert.fail('normal missing namespace must reject');}catch(cause){source=cause.partial;assert(source);assert(image.isOriginalPaySource(source));assert.match(cause.cause.message,/MAIN_NAMESPACE_NOT_CURRENT/);}
source.retire();await source.join();await source.close();console.log('actual normal image loaded: Namespace6/PQ10/Pay2; Root0+strong capture deny and partial drain; no keys/sign/effects');
})().catch(error=>{console.error(error);process.exitCode=1;});
