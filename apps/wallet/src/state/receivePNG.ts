import {createPaymentURI} from '../chain/paymentRequest';
export type ReceivePNGResult=Readonly<{status:'saved'|'cancelled'}>;
export type ReceivePNGWriter=(base64:string,filename:string)=>Promise<ReceivePNGResult>;
export function receivePNGFilename(account:string):string{createPaymentURI(account);return `YNX-Testnet-receive-${account}.png`}
/** Raw SVG toDataURL output only, never a data URL, path or remote resource. */
export function receivePNGBase64(value:unknown):string{
 if(typeof value!=='string'||value.length>699052||value.length%4!==0||!/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value))throw Error('INVALID_RECEIVE_PNG');
 return value;
}
/** Only public, already-rendered receiving data crosses the native boundary.
 * Check the original view before rendering and before opening the picker.
 * The picker may background/lock Wallet; that does not authorize key access
 * and does not change the immutable public image the user chose to save. */
export async function exportReceivePNG(account:string,render:(callback:(base64:string)=>void)=>void,save:ReceivePNGWriter,assertCurrent:()=>void,timeoutMs=5000):Promise<ReceivePNGResult>{
 const filename=receivePNGFilename(account);assertCurrent();
 const base64=await new Promise<string>((resolve,reject)=>{
  let done=false,rendering=true;let complete:(()=>void)|undefined;
  const timer=setTimeout(()=>{if(!done){done=true;reject(Error('PNG_RENDER_TIMEOUT'))}},timeoutMs);
  try{
   render(value=>{
    if(done)return;done=true;clearTimeout(timer);
    try{const bytes=receivePNGBase64(value);complete=()=>resolve(bytes)}catch(error){complete=()=>reject(error)}
    if(!rendering)complete();
   });
  }catch(error){done=true;clearTimeout(timer);reject(error);return}
  // A callback alone is not successful rendering if the renderer then throws.
  rendering=false;complete?.();
 });
 assertCurrent();const result=await save(base64,filename);
 if(result?.status!=='saved'&&result?.status!=='cancelled')throw Error('RECEIVE_PNG_RESULT_UNKNOWN');
 return Object.freeze({status:result.status});
}
