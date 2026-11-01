// Original Seller CLI command consumer. Boot supplies its existing protected
// api/current/account and createMutationIntents instance (including original
// storage/lock). This module opens no Source, account, key, URL or second journal.
const path='/seller/inventory/batch';
const fail=code=>{throw Object.assign(Error(code),{code});};
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const integer=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(v)&&BigInt(v)<=9223372036854775807n;
function input(value){
 if(!exact(value,['StoreID','Items'])||!id(value.StoreID)||!Array.isArray(value.Items)||!value.Items.length||value.Items.length>100)fail('SHOP_INVENTORY_BATCH_INPUT_INVALID');
 const seen=new Set(),revisions=new Map();
 for(const item of value.Items){
  if(!exact(item,['ProductID','VariantID','ExpectedRevision','Inventory'])||!id(item.ProductID)||!id(item.VariantID)||!integer(item.ExpectedRevision)||!integer(item.Inventory))fail('SHOP_INVENTORY_BATCH_INPUT_INVALID');
  const key=JSON.stringify([item.ProductID,item.VariantID]);
  if(seen.has(key)||revisions.has(item.ProductID)&&revisions.get(item.ProductID)!==item.ExpectedRevision)fail('SHOP_INVENTORY_BATCH_INPUT_INVALID');
  seen.add(key);revisions.set(item.ProductID,item.ExpectedRevision);
 }
 return structuredClone(value);
}
function result(value,original,recovery){
 if(!exact(value,['StoreID','RequestHash','OriginalApplied','QueryOnly','Products'])||value.StoreID!==original.StoreID||value.OriginalApplied!==true||typeof value.QueryOnly!=='boolean'||recovery&&value.QueryOnly!==true||typeof value.RequestHash!=='string'||!/^[a-f0-9]{64}$/.test(value.RequestHash)||!Array.isArray(value.Products))fail('SHOP_INVENTORY_BATCH_RESULT_UNCONFIRMED');
 return currentProducts(value,original);
}
function currentProducts(value,original){
 const expected=new Set(original.Items.map(x=>x.ProductID)),expectedSKUs=new Set(original.Items.map(x=>JSON.stringify([x.ProductID,x.VariantID]))),seen=new Set(),seenSKUs=new Set();
 for(const p of value.Products){
  if(!exact(p,['ID','StoreID','Revision','Variants'])||!expected.has(p.ID)||seen.has(p.ID)||p.StoreID!==original.StoreID||!integer(p.Revision)||!Array.isArray(p.Variants))fail('SHOP_INVENTORY_BATCH_RESULT_UNCONFIRMED');
  seen.add(p.ID);
  for(const v of p.Variants){
   const key=JSON.stringify([p.ID,v?.ID]);
   if(!exact(v,['ID','Inventory','Reserved'])||!expectedSKUs.has(key)||seenSKUs.has(key)||!integer(v.Inventory)||!integer(v.Reserved)||BigInt(v.Reserved)>BigInt(v.Inventory))fail('SHOP_INVENTORY_BATCH_RESULT_UNCONFIRMED');
   seenSKUs.add(key);
  }
 }
 if(seen.size!==expected.size||seenSKUs.size!==expectedSKUs.size)fail('SHOP_INVENTORY_BATCH_RESULT_UNCONFIRMED');
 // Current product DATA may differ after subsequent legitimate edits. The
 // fixed original lookup and exact retained body prove prior admission; never
 // reapply an old count or label this response goods/funds verification.
 return structuredClone(value);
}
export async function runInventoryBatchCLI({command,body,account,current,api,intents}){
 if(!['inspect','apply','recover'].includes(command)||typeof account!=='function'||typeof current!=='function'||typeof api!=='function'||command!=='inspect'&&typeof intents?.execute!=='function')fail('SHOP_INVENTORY_BATCH_RUNTIME_UNAVAILABLE');
 const actor=account();
 if(typeof actor!=='string'||!actor)fail('SHOP_INVENTORY_BATCH_RUNTIME_UNAVAILABLE');
 const check=()=>{current();if(account()!==actor)fail('SHOP_INVENTORY_BATCH_CONTEXT_CHANGED');};
 check();
 if(command==='inspect'){
  if(!exact(body,['StoreID','Items'])||!id(body.StoreID)||!Array.isArray(body.Items)||!body.Items.length||body.Items.length>100)fail('SHOP_INVENTORY_BATCH_INPUT_INVALID');
  const seen=new Set();
  for(const item of body.Items){const key=JSON.stringify([item?.ProductID,item?.VariantID]);if(!exact(item,['ProductID','VariantID'])||!id(item.ProductID)||!id(item.VariantID)||seen.has(key))fail('SHOP_INVENTORY_BATCH_INPUT_INVALID');seen.add(key)}
  const original=structuredClone(body),received=await api('/seller/inventory/read',{method:'POST',body:JSON.stringify(original)});check();
  if(!exact(received,['StoreID','Products','QueryOnly'])||received.StoreID!==original.StoreID||received.QueryOnly!==true||!Array.isArray(received.Products))fail('SHOP_INVENTORY_BATCH_RESULT_UNCONFIRMED');
  return Object.freeze({command,inventoryOnly:true,fundsVerified:false,result:currentProducts(received,original)});
 }
 const original=input(body);
 const response=await intents.execute('POST',path,original,check,async(value,beforeDispatch)=>{
  const received=await api(path,{method:'POST',body:JSON.stringify(value),beforeDispatch});check();
  return result(received,original,false);
 },async value=>{
  const received=await api('/seller/mutations/lookup',{method:'POST',body:JSON.stringify({Method:'POST',Path:path,OriginalBody:JSON.stringify(value)})});check();
  if(received?.Actor!==actor||received?.Method!=='POST'||received?.Path!==path||received?.IdempotencyKey!==value.IdempotencyKey)fail('SHOP_INVENTORY_BATCH_RESULT_UNCONFIRMED');
  return result(received.Result,original,true);
 },command==='recover');
 check();return Object.freeze({command,inventoryOnly:true,fundsVerified:false,result:response});
}
