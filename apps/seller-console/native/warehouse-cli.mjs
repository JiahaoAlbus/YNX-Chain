// Original protected Seller API and existing mutation journal are borrowed.
// Goods receipt and explicit stock admission are separate; no Pay writes exist.
const fail=code=>{throw Object.assign(Error(code),{code});};
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const integer=(v,positive=false)=>typeof v==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(v)&&BigInt(v)<=9223372036854775807n&&(!positive||v!=='0');
const invalid=()=>fail('SHOP_WAREHOUSE_ORIGINAL_UNCONFIRMED');
function items(value){
 if(!Array.isArray(value)||!value.length||value.length>50)invalid();
 const rows=new Map();
 for(const v of value){if(!exact(v,['ProductID','VariantID','Quantity'])||!id(v.ProductID)||!id(v.VariantID)||!integer(v.Quantity,true))invalid();const key=JSON.stringify([v.ProductID,v.VariantID]);if(rows.has(key))invalid();rows.set(key,v.Quantity)}
 return rows;
}
function receipt(value){
 if(!value||!id(value.ID)||!id(value.ReturnID)||!id(value.EvidenceReference))invalid();items(value.Items);
 const restocked=value.RestockedAt!==null&&value.RestockedAt!==undefined;
 if(restocked&&(typeof value.RestockedAt!=='string'||!Number.isFinite(Date.parse(value.RestockedAt))||typeof value.RestockedBy!=='string'||!value.RestockedBy))invalid();
 return {ReceiptID:value.ID,ReturnID:value.ReturnID,EvidenceReference:value.EvidenceReference,Items:structuredClone(value.Items),Restocked:restocked};
}
function inspect(value,orderID,storeID){
 if(!exact(value,['OrderID','StoreID','Status','ApprovedReturns','Lines','Receipts','QueryOnly','FundsVerified'])||value.OrderID!==orderID||value.StoreID!==storeID||typeof value.Status!=='string'||value.QueryOnly!==true||value.FundsVerified!==false||!Array.isArray(value.ApprovedReturns)||value.ApprovedReturns.some(v=>!id(v))||new Set(value.ApprovedReturns).size!==value.ApprovedReturns.length||!Array.isArray(value.Lines)||!value.Lines.length||value.Lines.length>50||!Array.isArray(value.Receipts)||value.Receipts.length>1000)invalid();
 const lines=new Map(),received=new Map(),ids=new Set(),refs=new Set();
 for(const line of value.Lines){
  if(!exact(line,['ProductID','VariantID','OrderedQuantity','ReceivedQuantity','RemainingQuantity'])||!id(line.ProductID)||!id(line.VariantID)||!integer(line.OrderedQuantity,true)||!integer(line.ReceivedQuantity)||!integer(line.RemainingQuantity)||BigInt(line.OrderedQuantity)!==BigInt(line.ReceivedQuantity)+BigInt(line.RemainingQuantity))invalid();
  const key=JSON.stringify([line.ProductID,line.VariantID]);if(lines.has(key))invalid();lines.set(key,line);received.set(key,0n);
 }
 for(const r of value.Receipts){
  if(!exact(r,['ReceiptID','ReturnID','EvidenceReference','Items','Restocked'])||!id(r.ReceiptID)||!id(r.ReturnID)||!id(r.EvidenceReference)||typeof r.Restocked!=='boolean'||ids.has(r.ReceiptID)||refs.has(r.EvidenceReference)||!value.ApprovedReturns.includes(r.ReturnID))invalid();
  ids.add(r.ReceiptID);refs.add(r.EvidenceReference);
  for(const [key,quantity] of items(r.Items)){if(!lines.has(key))invalid();received.set(key,received.get(key)+BigInt(quantity))}
 }
 for(const [key,line] of lines)if(received.get(key)!==BigInt(line.ReceivedQuantity))invalid();
 return structuredClone(value);
}
export async function runWarehouseCLI({command,orderID,storeID,body={},account,current,api,intents}){
 if(!['inspect','receive','restock','recover-receive','recover-restock'].includes(command)||!id(orderID)||!id(storeID)||typeof account!=='function'||typeof current!=='function'||typeof api!=='function'||command!=='inspect'&&typeof intents?.execute!=='function')fail('SHOP_WAREHOUSE_RUNTIME_UNAVAILABLE');
 const actor=account();if(typeof actor!=='string'||!actor)fail('SHOP_WAREHOUSE_RUNTIME_UNAVAILABLE');
 const check=()=>{current();if(account()!==actor)fail('SHOP_WAREHOUSE_CONTEXT_CHANGED')};check();
 if(command==='inspect'){
  if(!exact(body,[]))invalid();const data=await api(`/seller/orders/${orderID}/warehouse`,{method:'POST',body:'{}'});check();
  return {warehouseOnly:true,fundsVerified:false,result:inspect(data,orderID,storeID)};
 }
 const receive=command.endsWith('receive'),recover=command.startsWith('recover-');
 if(receive){if(!exact(body,['ReturnID','EvidenceReference','Items'])||!id(body.ReturnID)||!id(body.EvidenceReference))invalid();items(body.Items)}
 else if(!exact(body,['ReceiptID'])||!id(body.ReceiptID))invalid();
 const original=structuredClone(body),path=`/orders/${orderID}/${receive?'return-receipts':'return-restock'}`;
 function observed(value){
  if(value?.ID!==orderID||value?.StoreID!==storeID||!Array.isArray(value.ReturnReceipts)||value.ReturnReceipts.length>1000)invalid();
  const found=value.ReturnReceipts.filter(r=>receive?r.EvidenceReference===original.EvidenceReference:r.ID===original.ReceiptID);
  if(found.length!==1)invalid();const r=receipt(found[0]);
  if(receive){if(r.ReturnID!==original.ReturnID)invalid();const expected=items(original.Items),got=items(r.Items);if(expected.size!==got.size||[...expected].some(([k,v])=>got.get(k)!==v))invalid()}
  else if(!r.Restocked)invalid();
  return {OrderID:orderID,StoreID:storeID,Receipt:r};
 }
 const result=await intents.execute('POST',path,original,check,async(value,beforeDispatch)=>{const result=await api(path,{method:'POST',body:JSON.stringify(value),beforeDispatch});check();return observed(result)},async value=>{
  const result=await api('/seller/mutations/lookup',{method:'POST',body:JSON.stringify({Method:'POST',Path:path,OriginalBody:JSON.stringify(value)})});check();
  if(result?.Actor!==actor||result?.Method!=='POST'||result?.Path!==path||result?.IdempotencyKey!==value.IdempotencyKey)invalid();return observed(result.Result);
 },recover);
 check();return {warehouseOnly:true,fundsVerified:false,result};
}
