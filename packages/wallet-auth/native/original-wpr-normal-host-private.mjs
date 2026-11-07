// Actual independent normal startup. Static imports do not load Native.
// All operands are closed within the independently reviewed package.
import{acquireOriginalWPRHostPreloadV1}from'../src/original-auth-runtime-image-source-v1.js';
import{acquireRequiredWPRIssuerPublicOriginalLoanV1}from'./original-wallet-product-required-loan.mjs';
const fault=c=>Object.assign(Error(c),{code:c});
export async function openOriginalWPRMaterializationHostV1(){
 if(arguments.length)throw fault('WPR_NORMAL_HOST_ZERO_ARGUMENTS');
 let preload,loan,first,retired=false,closeRequested=false,complete=false,closing;
 const remember=e=>{first??={cause:e};return first.cause;};
 const live=()=>{if(first)throw first.cause;if(retired)throw fault('WPR_NORMAL_HOST_RETIRED');if(!preload||!loan)throw fault('WPR_NORMAL_HOST_NOT_READY');preload.assertCurrent();loan.assertCurrent();};
 function read(name){live();let value,error;try{value=Reflect.apply(loan[name],loan,[])}catch(cause){error={cause};remember(cause)}try{live()}catch(cause){remember(cause);error??={cause}}if(error)throw error.cause;return value;}
 async function drain(){
  retired=true;
  if(loan){for(const n of['retire','join','close'])try{await Reflect.apply(loan[n],loan,[])}catch(e){remember(e)}
   let childClosed=false;try{childClosed=loan.isClosed()}catch(e){remember(e)}if(!childClosed)throw first?.cause??fault('WPR_NORMAL_HOST_NATIVE_DEBT');}
  if(preload){preload.retire();try{await preload.join();await preload.close()}catch(e){remember(e)}if(!preload.isClosed())throw first?.cause??fault('WPR_NORMAL_HOST_SOURCE_DEBT');}
  complete=true;if(first)throw first.cause;
 }
 const owner=Object.freeze({
  readCapturedPublicOriginals(){if(arguments.length)throw fault('WPR_NORMAL_HOST_ZERO_ARGUMENTS');return read('readCapturedPublicOriginals')},
  readIndependentMaterializationDATA(){if(arguments.length)throw fault('WPR_NORMAL_HOST_ZERO_ARGUMENTS');return read('readIndependentMaterializationDATA')},
  assertCurrent(){if(arguments.length)throw fault('WPR_NORMAL_HOST_ZERO_ARGUMENTS');live()},
  async recheck(){if(arguments.length)throw fault('WPR_NORMAL_HOST_ZERO_ARGUMENTS');live();try{await preload.recheck();await loan.recheck();live()}catch(e){throw remember(e)}},
  retire(){if(arguments.length)throw fault('WPR_NORMAL_HOST_ZERO_ARGUMENTS');retired=true;try{loan?.retire()}catch(e){remember(e)}preload?.retire();if(first)throw first.cause;},
  async join(){if(arguments.length)throw fault('WPR_NORMAL_HOST_ZERO_ARGUMENTS');if(!retired)throw fault('WPR_NORMAL_HOST_RETIRE_REQUIRED');if(loan)try{await loan.join()}catch(e){remember(e)}if(first)throw first.cause;},
  close(){if(arguments.length)throw fault('WPR_NORMAL_HOST_ZERO_ARGUMENTS');closeRequested=true;return closing??=(async()=>{try{await drain()}catch(e){throw remember(e)}})()},
  async drainPartial(){if(arguments.length)throw fault('WPR_NORMAL_HOST_ZERO_ARGUMENTS');if(!closeRequested)throw fault('WPR_NORMAL_HOST_CLOSE_REQUIRED');try{await drain()}catch(e){throw remember(e)}},
  isClosed(){return complete;}
 });
 try{
  const opened=await acquireOriginalWPRHostPreloadV1();preload=opened?.owner;
  if(!opened||typeof opened.errorPresent!=='boolean')throw fault('WPR_NORMAL_HOST_SOURCE_STATUS');if(opened.errorPresent)throw opened.error;if(!preload)throw fault('WPR_NORMAL_HOST_SOURCE_REQUIRED');preload.assertCurrent();
  const acquired=acquireRequiredWPRIssuerPublicOriginalLoanV1();loan=acquired?.owner;
  if(!acquired||typeof acquired.errorPresent!=='boolean')throw fault('WPR_NORMAL_HOST_NATIVE_STATUS');if(acquired.errorPresent)throw acquired.error;if(!loan)throw fault('WPR_NORMAL_HOST_NATIVE_REQUIRED');live();
  return Object.freeze({owner,errorPresent:false,error:null});
 }catch(e){remember(e);return Object.freeze({owner,errorPresent:true,error:first.cause})}
}
