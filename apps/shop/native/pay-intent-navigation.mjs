// Normal Main/Pay owner supplies its existing qualified entry. This adapter
// consumes its fixed read-only intent action; it constructs no
// Source, approval, capsule, signer, endpoint or transaction journal.
const fail=(code,cause)=>{throw Object.assign(Error(code,cause?{cause}:undefined),{code});};
export function createOriginalShopPayNavigation({entry,current}){
 if(typeof entry?.invoke!=='function'||typeof entry?.status!=='function'||typeof current!=='function')fail('SHOP_NATIVE_PAY_MAIN_UNAVAILABLE');
 async function invoke(originalOperation){
  if(typeof originalOperation!=='string'||!/^npi_[a-f0-9]{48}$/.test(originalOperation))fail('SHOP_NATIVE_PAY_ORIGINAL_REQUIRED');
  current();const status=await entry.status();current();
  if(status?.available!==true||status?.normalMainEntry!==true||status?.paymentAuthorized!==false){
   const reason=typeof status?.reason==='string'&&/^[A-Za-z0-9_:-]{1,128}$/.test(status.reason)?Object.assign(Error(status.reason),{code:status.reason}):undefined;
   fail('SHOP_NATIVE_PAY_MAIN_UNAVAILABLE',reason);
  }
  // P06 recover-intent performs a reconcile POST. A navigation/cold UNKNOWN
  // refresh only reads the same original: it must not select that callee.
  const response=await entry.invoke({action:'intent',intentId:originalOperation});current();
  if(response?.reference?.intentId!==originalOperation||response?.intent?.intentId!==originalOperation||response?.intent?.originalOperation!==originalOperation||!['PREPARED','ISSUED'].includes(response.intent.state)||response?.clientIndependentFinality!==false)fail('SHOP_NATIVE_PAY_ORIGINAL_CHANGED');
  return Object.freeze({originalOperation,queryOnly:true,clientIndependentFinality:false,approvalInOriginalMain:true});
 }
 return Object.freeze({openOriginalIntent:operation=>invoke(operation),recoverOriginalIntent:operation=>invoke(operation)});
}
