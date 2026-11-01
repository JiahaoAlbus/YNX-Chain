// Normal Main/Pay owner supplies its existing qualified entry. This adapter
// consumes only its fixed intent/recover-intent actions; it constructs no
// Source, approval, capsule, signer, endpoint or transaction journal.
const fail=code=>{throw Object.assign(Error(code),{code});};
export function createOriginalShopPayNavigation({entry,current}){
 if(typeof entry?.invoke!=='function'||typeof entry?.status!=='function'||typeof current!=='function')fail('SHOP_NATIVE_PAY_MAIN_UNAVAILABLE');
 async function invoke(originalOperation,recover){
  if(typeof originalOperation!=='string'||!/^npi_[a-f0-9]{48}$/.test(originalOperation))fail('SHOP_NATIVE_PAY_ORIGINAL_REQUIRED');
  current();const status=await entry.status();current();
  if(status?.available!==true||status?.normalMainEntry!==true||status?.paymentAuthorized!==false)fail('SHOP_NATIVE_PAY_MAIN_UNAVAILABLE');
  const response=await entry.invoke({action:recover?'recover-intent':'intent',intentId:originalOperation});current();
  if(response?.reference?.intentId!==originalOperation||response?.intent?.intentId!==originalOperation||response?.intent?.originalOperation!==originalOperation||!['PREPARED','ISSUED'].includes(response.intent.state)||response?.clientIndependentFinality!==false)fail('SHOP_NATIVE_PAY_ORIGINAL_CHANGED');
  return Object.freeze({originalOperation,queryOnly:true,clientIndependentFinality:false,approvalInOriginalMain:true});
 }
 return Object.freeze({openOriginalIntent:operation=>invoke(operation,false),recoverOriginalIntent:operation=>invoke(operation,true)});
}
