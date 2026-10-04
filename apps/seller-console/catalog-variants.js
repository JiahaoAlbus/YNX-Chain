import {validateSellerVariants} from './form-input.js';

// Product-local drafts only. Original variant identities and reservations stay
// attached to their rows; switching a row never writes inventory or publishes.
export function createCatalogVariants(product,{inventoryWritable=false}={}){
 const rows=structuredClone(product?.Variants?.length?product.Variants:[{ID:'',Name:'',SKU:'',PriceYNXT:'',Inventory:0}]);let selected=0;
 const at=index=>{if(!Number.isInteger(index)||index<0||index>=rows.length)throw Error('Choose a current product variant.');return index;};
 return Object.freeze({
  rows:()=>structuredClone(rows),
  selected:()=>selected,
  current:()=>structuredClone(rows[selected]),
  update(fields){const old=rows[selected];rows[selected]={...old,Name:String(fields.variant??''),SKU:String(fields.sku??''),PriceYNXT:Number(fields.price),Inventory:inventoryWritable?Number(fields.inventory):old.Inventory};},
  select(index){selected=at(index);return structuredClone(rows[selected]);},
  add(){if(rows.length>=50)throw Error('A product supports up to 50 variants.');rows.push({ID:'',Name:'',SKU:'',PriceYNXT:'',Inventory:0});selected=rows.length-1;return structuredClone(rows[selected]);},
  removeNew(){if(rows[selected].ID||rows.length===1)throw Error('Only an unsaved additional variant can be removed here.');rows.splice(selected,1);selected=Math.min(selected,rows.length-1);return structuredClone(rows[selected]);},
  input(){if(rows.length<1||rows.length>50)throw Error('A product requires 1 to 50 variants.');validateSellerVariants(rows);const sku=new Set(),ids=new Set(),bytes=v=>new TextEncoder().encode(v).length;for(const row of rows){if(!row.Name.trim()||bytes(row.Name)>120||!row.SKU.trim()||bytes(row.SKU)>80||sku.has(row.SKU)||row.ID&&ids.has(row.ID))throw Error('Each variant needs a name (120 UTF-8 bytes), unique SKU (80 UTF-8 bytes), and its original identity.');if(row.Inventory<(row.Reserved||0))throw Error('Inventory cannot be below current reservations.');sku.add(row.SKU);if(row.ID)ids.add(row.ID);}return structuredClone(rows);}
 });
}
