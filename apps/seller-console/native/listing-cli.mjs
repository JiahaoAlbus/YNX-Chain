// Original qualified Seller runtime and existing opaque mutation journal only.
const fail=code=>{throw Object.assign(Error(code),{code});};
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const count=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(v)&&BigInt(v)<=9223372036854775807n;
const text=(v,max,required=false)=>typeof v==='string'&&new TextEncoder().encode(v).length<=max&&(!required||v.trim()!=='');
const invalid=()=>fail('SHOP_LISTING_ORIGINAL_UNCONFIRMED');
function media(rows){if(!Array.isArray(rows)||rows.length>12)invalid();const seen=new Set();for(const v of rows){if(!exact(v,['URL','AltText','Kind'])||!text(v.URL,1000,true)||!text(v.AltText,240,true)||seen.has(v.URL)||v.Kind!=='image')invalid();let u;try{u=new URL(v.URL)}catch{invalid()}if(u.protocol!=='https:'||!u.hostname||u.username||u.password||u.hash)invalid();seen.add(v.URL)}}
function input(body){
 if(!exact(body,['StoreID','ExpectedRevision','Title','Description','Category','Media','Variants'])||!id(body.StoreID)||!count(body.ExpectedRevision)||body.ExpectedRevision==='0'||!text(body.Title,160,true)||!text(body.Description,5000)||!text(body.Category,80)||!Array.isArray(body.Variants)||!body.Variants.length||body.Variants.length>50)invalid();
 media(body.Media);if(body.Media.length<1)invalid();const ids=new Set(),skus=new Set();
 for(const row of body.Variants){if(!exact(row,['ID','Name','SKU','PriceYNXT','Inventory'])||(row.ID!==''&&!id(row.ID))||!text(row.Name,120,true)||!text(row.SKU,80,true)||!count(row.PriceYNXT)||row.PriceYNXT==='0'||!count(row.Inventory)||row.ID!==''&&ids.has(row.ID)||skus.has(row.SKU))invalid();if(row.ID!=='')ids.add(row.ID);skus.add(row.SKU)}
 return structuredClone(body);
}
function view(response,productID,storeID,applied,query){
 if(!exact(response,['Product','OriginalApplied','QueryOnly'])||response.OriginalApplied!==applied||response.QueryOnly!==query)invalid();const p=response.Product;
 if(!exact(p,['ID','StoreID','Revision','Title','Description','Category','Published','Media','Variants'])||p.ID!==productID||p.StoreID!==storeID||!count(p.Revision)||p.Revision==='0'||typeof p.Published!=='boolean'||!text(p.Title,160,true)||!text(p.Description,5000)||!text(p.Category,80)||!Array.isArray(p.Variants)||!p.Variants.length||p.Variants.length>50)invalid();
 media(p.Media);if(p.Published&&p.Media.length<1)invalid();const ids=new Set(),skus=new Set();for(const v of p.Variants){if(!exact(v,['ID','Name','SKU','PriceYNXT','Inventory','Reserved'])||!id(v.ID)||ids.has(v.ID)||!text(v.Name,120,true)||!text(v.SKU,80,true)||skus.has(v.SKU)||!count(v.PriceYNXT)||v.PriceYNXT==='0'||!count(v.Inventory)||!count(v.Reserved)||BigInt(v.Reserved)>BigInt(v.Inventory))invalid();ids.add(v.ID);skus.add(v.SKU)}
 return structuredClone(response);
}
export async function runListingCLI({command,productID,body,account,current,api,intents}){
 if(!['inspect','publish','recover'].includes(command)||!id(productID)||typeof account!=='function'||typeof current!=='function'||typeof api!=='function'||command!=='inspect'&&typeof intents?.execute!=='function')fail('SHOP_LISTING_RUNTIME_UNAVAILABLE');
 const actor=account();if(typeof actor!=='string'||!actor)fail('SHOP_LISTING_RUNTIME_UNAVAILABLE');const check=()=>{current();if(account()!==actor)fail('SHOP_LISTING_CONTEXT_CHANGED')};check();
 if(command==='inspect'){if(!exact(body,['StoreID'])||!id(body.StoreID))invalid();const storeID=body.StoreID;const response=await api('/seller/listing/read',{method:'POST',body:JSON.stringify({StoreID:storeID,ProductID:productID})});check();return {listingOnly:true,fundsVerified:false,result:view(response,productID,storeID,false,true)}}
 const original=input(body),path=`/seller/products/${productID}/native-listing`;
 const result=await intents.execute('POST',path,original,check,async(value,beforeDispatch)=>{const response=await api(path,{method:'POST',body:JSON.stringify(value),beforeDispatch});check();const out=view(response,productID,original.StoreID,true,false);if(!out.Product.Published)invalid();return out},async value=>{
  const response=await api('/seller/mutations/lookup',{method:'POST',body:JSON.stringify({Method:'POST',Path:path,OriginalBody:JSON.stringify(value)})});check();if(response?.Actor!==actor||response?.Method!=='POST'||response?.Path!==path||response?.IdempotencyKey!==value.IdempotencyKey)invalid();return view(response.Result,productID,original.StoreID,true,true);
 },command==='recover');check();return {listingOnly:true,fundsVerified:false,result};
}
