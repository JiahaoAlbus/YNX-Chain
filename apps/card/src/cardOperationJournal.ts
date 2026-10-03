export type TestnetOperation='freeze'|'unfreeze'|'recover'|'controls'|'topup-intent'|'topup-confirm'|'authorization'|'capture'|'reverse'|'refund';
export type PendingCardOperation=Readonly<{version:1;owner:string;cardId:string;kind:TestnetOperation;resourceId:string;key:string;digest:string;input:Record<string,unknown>}>;
export function canonicalCardOperationInput(value:unknown):string {
  const canonical=(item:unknown):unknown=>{
    if(item===null||typeof item==='string'||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))return item;
    if(Array.isArray(item))return item.map(canonical);
    if(item&&typeof item==='object')return Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>[key,canonical(value)]));
    throw Error('INVALID_CARD_OPERATION');
  };
  return JSON.stringify(canonical(value));
}
export function parsePendingCardOperation(raw:string,owner:string):PendingCardOperation {
  const value=JSON.parse(raw);
  if(value?.version!==1||value.owner!==owner||!['freeze','unfreeze','recover','controls','topup-intent','topup-confirm','authorization','capture','reverse','refund'].includes(value.kind)||![value.cardId,value.resourceId,value.key].every(item=>typeof item==='string'&&/^[A-Za-z][A-Za-z0-9_-]{1,159}$/.test(item))||! /^[0-9a-f]{64}$/.test(value.digest)||!value.input||typeof value.input!=='object'||Array.isArray(value.input))throw Error('CARD_LOCAL_RECOVERY_REQUIRED');
  return value;
}
export function parseTestnetYnxt(value:string):string {
  if(!/^(0|[1-9][0-9]{0,59})(\.[0-9]{1,18})?$/.test(value))throw Error('INVALID_TESTNET_AMOUNT');
  const [whole,fraction='']=value.split('.'),amount=BigInt(whole!)*10n**18n+BigInt(fraction.padEnd(18,'0'));
  if(amount<=0n||amount>=2n**256n)throw Error('INVALID_TESTNET_AMOUNT');return String(amount);
}
