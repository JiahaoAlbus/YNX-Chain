import {CANONICAL_RPC_URL,LEGACY_RPC_URL} from "./rpc.mjs";
import {uint64} from "./transaction-durability.mjs";

const HASH=/^0x[0-9a-f]{64}$/,ACCOUNT=/^0x[0-9a-f]{40}$/;
const FIELDS=["hash","account","to","amount","actualFee","blockNumber","origin","successful","confirmed","confirmationScope","consensusFinality"];
function publicValues(value,fields){
  if(!value||typeof value!=="object"||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error("Invalid public history");
  const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
  if(keys.length!==fields.length||keys.some(key=>!fields.includes(key)||!Object.hasOwn(descriptors[key],"value")))throw Error("Invalid public history");
  return Object.fromEntries(fields.map(key=>[key,descriptors[key].value]));
}
function publicRows(value){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)throw Error("Invalid public history rows");
  const length=Object.getOwnPropertyDescriptor(value,"length")?.value;
  if(!Number.isSafeInteger(length)||length<0||length>50)throw Error("Invalid public history rows");
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(descriptors).length!==length+1)throw Error("Invalid public history rows");
  const rows=[];
  for(let index=0;index<length;index++){
    const descriptor=descriptors[index];
    if(!descriptor||!Object.hasOwn(descriptor,"value"))throw Error("Invalid public history rows");
    rows.push(descriptor.value);
  }
  return rows;
}
// Only the existing producer's primitive display DTO crosses this boundary.
// This validates presentation, not a new receipt proof or consensus finality.
function projectRecord(value,account){
  const record=publicValues(value,FIELDS);
  const decimal=value=>typeof value==="string"&&value.length<=128&&/^(?:0|[1-9][0-9]*)\.(?:0|[0-9]{0,17}[1-9])$/.test(value);
  if(record.account!==account||typeof record.hash!=="string"||!HASH.test(record.hash)||typeof record.to!=="string"||!ACCOUNT.test(record.to)||record.to===account||
      !decimal(record.amount)||record.amount==="0.0"||!decimal(record.actualFee)||typeof record.successful!=="boolean"||
      ![CANONICAL_RPC_URL,LEGACY_RPC_URL].includes(record.origin)||record.confirmed!==true||record.confirmationScope!=="local-snapshot"||record.consensusFinality!==false)throw Error("Unverified history");
  uint64(record.blockNumber,{positive:true});
  return Object.freeze(record);
}
/** Account-bound public history. Refresh retires pending reads, not already
 * verified rows for this same account. A retained snapshot is not a fresh read. */
export function createTransactionHistoryUI({ getAccount, request, render }) {
  let revision = 0, records = Object.freeze([]), recordsAccount = null, cursor = null, busy = false;
  function clear() { revision++; records = Object.freeze([]); recordsAccount = null; cursor = null; busy = false; render({ records, nextCursor: null, busy: false, loaded: false, error: null }); }
  async function load(more = false) {
    const selected = getAccount();
    if (recordsAccount !== null && recordsAccount !== selected) { clear(); if (more) return; }
    if (more && (busy || cursor === null)) return;
    if (!more) {
      if (recordsAccount === null) clear();
      else { revision++; busy = false; }
    }
    const account = getAccount(), current = revision, requestedCursor = more ? cursor : null;
    if (!account) return;
    busy = true; render({ records, nextCursor: cursor, busy, loaded: false, error: null });
    try {
      const response = await request(requestedCursor);
      if (current !== revision || getAccount() !== account) return;
      const envelope=publicValues(response,["ok","value"]);
      if(envelope.ok!==true)throw Error("Unverified history");
      const value=publicValues(envelope.value,["records","nextCursor"]);
      // Never run response iterators/index getters to derive completed facts.
      const page=publicRows(value.records).map(record=>projectRecord(record,account)),next=value.nextCursor;
      if(next!==null&&(typeof next!=="string"||!HASH.test(next)||page.length===0))throw Error("Invalid page");
      // Original TransactionSubmissions.history uses an inclusive cursor: it is
      // the first as-yet-undisplayed hash, never the last row of this page.
      if(more&&page[0]?.hash!==requestedCursor)throw Error("Wrong history page");
      const combined = more ? [...records, ...page] : page;
      if (new Set(combined.map(record => record.hash)).size !== combined.length) throw new Error("Repeated history");
      if(next!==null&&combined.some(record=>record.hash===next))throw Error("Repeated history cursor");
      if(current!==revision||getAccount()!==account)return;
      records = Object.freeze(combined); recordsAccount = account; cursor = next; busy = false;
      render({ records, nextCursor: cursor, busy, loaded: true, error: null });
    } catch {
      if (current !== revision || getAccount() !== account) return;
      busy = false; render({ records, nextCursor: cursor, busy, loaded: false, error: "Saved transaction history could not be verified. Original records remain on this device." });
    }
  }
  return { clear, refresh: () => load(false), older: () => load(true) };
}
