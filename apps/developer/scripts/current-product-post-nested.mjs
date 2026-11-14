import {lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {currentSourceProjectionInput} from './current-source-projection-input.mjs';
import {resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
import {currentProductQAInput} from './current-product-supplier-qa.mjs';
export async function finalizeCurrentProduct(handoff,app){
 const r21=await import('./r21-cocoa-product.mjs');
 const variant=r21.cocoaVariantForHandoff(resolve(handoff));
 if(variant){console.log(JSON.stringify(await r21.finalizeR21(resolve(app),variant)));return;}
 const c6=await import('./c6-diagnostic-product.mjs');
 if(resolve(handoff)===c6.C6_HANDOFF.path){await c6.finalizeC6(resolve(app));return;}
 const root63=await import('./root63-product.mjs');
 if(resolve(handoff)===root63.ROOT63_HANDOFF){await root63.finalizeRoot63(resolve(app));return;}
 const h=await currentProductQAInput(handoff);
 let projected=false;try{await lstat(join(app,'Contents/Resources/code/apps/developer/identity-sdk-projection-binding.json'));projected=true;}catch(e){if(e.code!=='ENOENT')throw e;}
 if(projected){const supply=await currentSourceProjectionInput();execFileSync(h.execution.ordinaryColdBuild[0],[supply.finalizer.after.path,resolve(app)],{stdio:'inherit',env:process.env});return;}
 execFileSync(h.execution.ordinaryColdBuild[0],[h.postNestedFinalizer.path,resolve(app)],{stdio:'inherit',env:process.env});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==4)throw Error('Exact current whole handoff and App required');await finalizeCurrentProduct(process.argv[2],process.argv[3]);
}
