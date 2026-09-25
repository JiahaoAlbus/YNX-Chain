/** Provider units are explicit; absent precision or currency never implies zero. */
export function formatProviderAmount(value:unknown,digits:unknown,currency:unknown):string|null{
  if(typeof value!=='string'||value.length>80||! /^-?(0|[1-9]\d*)$/.test(value)||typeof digits!=='number'||!Number.isSafeInteger(digits)||digits<0||digits>36||typeof currency!=='string'||! /^[A-Z][A-Z0-9]{1,11}$/.test(currency))return null;
  const amount=BigInt(value),negative=amount<0n,absolute=negative?-amount:amount,scale=10n**BigInt(digits);
  return `${negative?'-':''}${absolute/scale}${digits?'.'+String(absolute%scale).padStart(digits,'0'):''} ${currency}`;
}
export function parseProviderLimit(value:string,digits:number):string{
  if(!Number.isSafeInteger(digits)||digits<0||digits>9||! /^(0|[1-9]\d{0,11})(\.\d+)?$/.test(value))throw Error('CARD_LIMIT_INVALID');
  const [whole,fraction='']=value.split('.');if(fraction.length>digits)throw Error('CARD_LIMIT_INVALID');
  const amount=BigInt(whole!)*10n**BigInt(digits)+BigInt(fraction.padEnd(digits,'0')||'0');
  if(amount<=0n)throw Error('CARD_LIMIT_INVALID');return String(amount);
}
export function providerBlockState(value:unknown):'frozen'|'unfrozen'|'unknown'{return value===true?'frozen':value===false?'unfrozen':'unknown'}
