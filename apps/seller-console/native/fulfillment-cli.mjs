// Borrow the original protected Seller API, current fence and mutation journal.
// This entry never claims payment proof, performs Pay writes or changes stock.
const fail=code=>{throw Object.assign(Error(code),{code});};
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const invalid=()=>fail('SHOP_FULFILLMENT_ORIGINAL_UNCONFIRMED');
const bounded=(v,max)=>typeof v==='string'&&v.trim()!==''&&new TextEncoder().encode(v).length<=max;
function originalOrder(value,orderID,storeID){
 if(!value||value.ID!==orderID||value.StoreID!==storeID||typeof value.Status!=='string')invalid();
 const result={OrderID:orderID,StoreID:storeID,Status:value.Status,Shipment:null};
 if(value.Shipment!==null&&value.Shipment!==undefined){const s=value.Shipment;if(!bounded(s.Carrier,120)||!bounded(s.TrackingNumber,200)||!['shipped','delivered'].includes(s.Status)||typeof s.UpdatedAt!=='string'||!Number.isFinite(Date.parse(s.UpdatedAt)))invalid();result.Shipment={Carrier:s.Carrier,TrackingNumber:s.TrackingNumber,Status:s.Status,UpdatedAt:s.UpdatedAt};}
 return result;
}
export async function runFulfillmentCLI({command,orderID,storeID,body={},account,current,api,intents}){
 if(!['inspect','ship','recover-ship'].includes(command)||!id(orderID)||!id(storeID)||typeof account!=='function'||typeof current!=='function'||typeof api!=='function'||command!=='inspect'&&typeof intents?.execute!=='function')fail('SHOP_FULFILLMENT_RUNTIME_UNAVAILABLE');
 const actor=account();if(typeof actor!=='string'||!actor)fail('SHOP_FULFILLMENT_RUNTIME_UNAVAILABLE');
 const check=()=>{current();if(account()!==actor)fail('SHOP_FULFILLMENT_CONTEXT_CHANGED')};check();
 if(command==='inspect'){
  if(!exact(body,[]))invalid();const value=await api(`/orders/${orderID}`,{method:'GET'});check();
  return {fulfillmentOnly:true,fundsVerified:false,result:originalOrder(value,orderID,storeID)};
 }
 if(!exact(body,['Carrier','TrackingNumber'])||!bounded(body.Carrier,120)||!bounded(body.TrackingNumber,200))invalid();
 const path=`/orders/${orderID}/transition`,request={Action:'shipped',Carrier:body.Carrier,TrackingNumber:body.TrackingNumber,Explanation:''};
 function observed(value){const out=originalOrder(value,orderID,storeID);if(!['shipped','delivered','reviewed','return_requested','return_approved','return_rejected','refund_requested','refund_approved','refund_rejected','refunded','disputed'].includes(out.Status)||!out.Shipment||out.Shipment.Carrier!==request.Carrier||out.Shipment.TrackingNumber!==request.TrackingNumber)invalid();return out;}
 const result=await intents.execute('POST',path,request,check,async(value,beforeDispatch)=>{
  const response=await api(path,{method:'POST',body:JSON.stringify(value),beforeDispatch});check();return observed(response);
 },async value=>{
  const response=await api('/seller/mutations/lookup',{method:'POST',body:JSON.stringify({Method:'POST',Path:path,OriginalBody:JSON.stringify(value)})});check();
  if(response?.Actor!==actor||response?.Method!=='POST'||response?.Path!==path||response?.IdempotencyKey!==value.IdempotencyKey)invalid();return observed(response.Result);
 },command==='recover-ship');
 check();return {fulfillmentOnly:true,fundsVerified:false,result};
}
