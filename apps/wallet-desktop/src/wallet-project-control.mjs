import {createRequire} from 'node:module';
import {WalletProjectControlReviewKernel} from './wallet-project-control-review-kernel.mjs';
const require=createRequire(import.meta.url);
// Sole fixed normal Main image. No caller-selected module, Source, signing
// provider, raw request or current flag. Old packages fail visibly; never
// borrow the artifact approval factory or replace an uncertain capture.
export function createOriginalWalletProjectControl(){
 let native=null,owner=null,kernel=null,busy=false,closed=false,ended=false;
 function load(){
  if(process.platform!=='darwin')throw Error('CONTROL_NATIVE_MAC_REQUIRED');
  native??=require('../native/original-auth-identity.node');
  if(typeof native.captureOriginalWalletProjectControlReview!=='function'||typeof native.isOriginalWalletProjectControlReview!=='function')throw Error('CONTROL_MATCHED_NATIVE_BINDING_REQUIRED');
 }
 return Object.freeze({
  async start(getGuard){
   if(busy||owner&&!ended||closed)throw Error('CONTROL_ORIGINAL_CAPTURE_ALREADY_SELECTED');busy=true;
   if(ended){owner=null;kernel=null;ended=false;}
   try{load();owner=native.captureOriginalWalletProjectControlReview();
    if(native.isOriginalWalletProjectControlReview(owner)!==true)throw Error('CONTROL_ORIGINAL_NATIVE_REQUIRED');
    kernel=new WalletProjectControlReviewKernel({isOwner:native.isOriginalWalletProjectControlReview,persist:record=>owner.persistOriginalLifecycle(JSON.stringify(record))});
    return await kernel.capture(owner,getGuard);
   }finally{busy=false;}
  },
  decide(reviewId,decision,getGuard){if(!kernel||closed)throw Error('CONTROL_ORIGINAL_REVIEW_REQUIRED');return kernel.decide(reviewId,decision,getGuard);},
  observeOriginal(getGuard){if(!kernel||closed)throw Error('CONTROL_ORIGINAL_REVIEW_REQUIRED');return kernel.observeOriginal(getGuard);},
  status(){return kernel?.status()??{phase:owner?'capture-unknown':'idle',dataOnly:true,approved:false,committed:false,retryAuthorized:false};},
  retire(){kernel?.retire();if(!kernel)owner?.retire();},
  closeReview(){if(busy||kernel?.status().needsSave)throw Error('CONTROL_STORAGE_OR_CAPTURE_PENDING');kernel?.retire();owner?.close();ended=true;return {...this.status(),reviewClosed:true};},
  shutdown(){if(busy||kernel?.status().needsSave)throw Error('CONTROL_STORAGE_OR_CAPTURE_PENDING');kernel?.retire();owner?.close();closed=true;},
  assertSafeToClose(){if(busy||kernel?.status().needsSave)throw Error('CONTROL_STORAGE_OR_CAPTURE_PENDING');},
 });
}
