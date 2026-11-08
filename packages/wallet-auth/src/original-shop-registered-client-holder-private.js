import {readOriginalProductWalletBusinessReadHolder} from './product-wallet-connection-holder-private.js';
import {readOriginalProductSessionDeviceV4ReadOrigin} from './original-product-device-v4-source-stage-private.js';
/** Node-only private composition. No install/setter, session DTO, signing callback
 * or Source creation. Both inventories must originate in their normal factories.
 * This loan holds only the existing GET child; Native keeps its strong owner.
 * assertCurrent is a freshness fence, never registered-session authorization. */
export function captureOriginalRegisteredClientReadHolder(read){
 const client=readOriginalProductWalletBusinessReadHolder(read);
 const origin=readOriginalProductSessionDeviceV4ReadOrigin(client.device,client.deviceCurrent);
 client.assertCurrent();origin.assertCurrent();
 const child=client.retain();let released=false;
 const current=()=>{if(released)throw new Error('ORIGINAL_SHOP_READ_HOLDER_RELEASED');child.assertCurrent();origin.assertCurrent();child.assertCurrent();};
 try{current();}catch(error){child.release();throw error;}
 return Object.freeze({
  assertCurrent:current,
  async createBusinessProof(input){current();try{const result=await child.createBusinessProof(input);current();return result;}catch(error){child.retainFirstCause(error);throw error;}},
  release(){if(!released){released=true;child.release();}},
  statusDATA(){return Object.freeze({released,readOnly:true,NativeAdmission:false,SourceAdmission:false});}
 });
}
