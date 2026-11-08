import {startOriginalShopRegisteredReadNodeLoadV1,isOriginalShopRegisteredReadNamespaceImportDATA,consumeOriginalShopRegisteredReadNamespaceImportDATA} from '../../packages/wallet-auth/src/original-shop-registered-read-node-loader-private.js';
const attempt=startOriginalShopRegisteredReadNodeLoadV1({});attempt.retire();await attempt.join();const result=await attempt.completion;
const evidence:boolean=isOriginalShopRegisteredReadNamespaceImportDATA({},result.namespaceOriginal);consumeOriginalShopRegisteredReadNamespaceImportDATA({},result.namespaceOriginal);
// @ts-expect-error no caller URI
startOriginalShopRegisteredReadNodeLoadV1({},'file:///caller.mjs');
// @ts-expect-error no primitive owner
startOriginalShopRegisteredReadNodeLoadV1('owner');
// @ts-expect-error no callback/provider input
startOriginalShopRegisteredReadNodeLoadV1({},{acceptCompleted(){}});
// @ts-expect-error import evidence never Native admission
const admitted:true=result.NativeAdmission;
void evidence;void admitted;
