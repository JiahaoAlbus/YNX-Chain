// Original return decisions only: no money, receipt import, goods or stock action.
const fail=code=>{throw Object.assign(Error(code),{code});};
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const invalid=()=>fail('SHOP_RETURN_ORIGINAL_UNCONFIRMED');
function timeline(value,orderID,storeID){
 if(!value||value.ID!==orderID||value.StoreID!==storeID||typeof value.Status!=='string'||!Array.isArray(value.Timeline)||!value.Timeline.length||value.Timeline.length>10000)invalid();
 const ids=new Set();for(const e of value.Timeline){if(!e||!id(e.ID)||typeof e.Status!=='string'||ids.has(e.ID))invalid();ids.add(e.ID);}return value.Timeline;
}
export async function runReturnDecisionCLI({command,orderID,storeID,body={},account,current,api,intents}){
 if(!['inspect','approve','reject','recover-approve','recover-reject'].includes(command)||!id(orderID)||!id(storeID)||typeof account!=='function'||typeof current!=='function'||typeof api!=='function'||command!=='inspect'&&typeof intents?.execute!=='function')fail('SHOP_RETURN_RUNTIME_UNAVAILABLE');
 if(!body||Object.getPrototypeOf(body)!==Object.prototype)invalid();body=structuredClone(body);
 const actor=account();if(typeof actor!=='string'||!actor)fail('SHOP_RETURN_RUNTIME_UNAVAILABLE');const check=()=>{current();if(account()!==actor)fail('SHOP_RETURN_CONTEXT_CHANGED');};check();
 if(command==='inspect'){
  if(!exact(body,[]))invalid();const value=await api(`/orders/${orderID}`,{method:'GET'});check();const rows=timeline(value,orderID,storeID),original=rows.findLast(e=>e.Status==='return_requested');
  return {returnDecisionOnly:true,fundsVerified:false,result:{OrderID:orderID,StoreID:storeID,Status:value.Status,ReturnID:original?.ID??null}};
 }
 const reject=command.endsWith('reject'),recover=command.startsWith('recover-');
 if(!exact(body,reject?['ReturnID','Explanation']:['ReturnID'])||!id(body.ReturnID)||reject&&(typeof body.Explanation!=='string'||!body.Explanation.trim()||new TextEncoder().encode(body.Explanation).length>5000))invalid();
 const path=`/orders/${orderID}/transition`,action=reject?'return_rejected':'return_approved',request={Action:action,OriginalReturnID:body.ReturnID,Explanation:reject?body.Explanation:''};
 function observed(value){
  const rows=timeline(value,orderID,storeID),start=rows.findIndex(e=>e.ID===body.ReturnID&&e.Status==='return_requested');if(start<0)invalid();
  let end=rows.findIndex((e,i)=>i>start&&e.Status==='return_requested');if(end<0)end=rows.length;
  const decisions=rows.slice(start+1,end).filter(e=>e.Status==='return_approved'||e.Status==='return_rejected');if(decisions.length!==1||decisions[0].Status!==action)invalid();
  return {OrderID:orderID,StoreID:storeID,ReturnID:body.ReturnID,Decision:action,DecisionEventID:decisions[0].ID,OrderStatus:value.Status};
 }
 const result=await intents.execute('POST',path,request,check,async(value,beforeDispatch)=>{
  const read=await api(`/orders/${orderID}`,{method:'GET'});check();const rows=timeline(read,orderID,storeID),original=rows.findLast(e=>e.Status==='return_requested');
  if(read.Status!=='return_requested'||original?.ID!==body.ReturnID)invalid();
  const response=await api(path,{method:'POST',body:JSON.stringify(value),beforeDispatch});check();return observed(response);
 },async value=>{
  const response=await api('/seller/mutations/lookup',{method:'POST',body:JSON.stringify({Method:'POST',Path:path,OriginalBody:JSON.stringify(value)})});check();
  if(response?.Actor!==actor||response?.Method!=='POST'||response?.Path!==path||response?.IdempotencyKey!==value.IdempotencyKey)invalid();return observed(response.Result);
 },recover);
 check();return {returnDecisionOnly:true,fundsVerified:false,result};
}
