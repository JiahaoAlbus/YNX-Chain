/** TEST-only authorization policy. No issuer/network/payment authority. */
export type TestnetRiskControls={maxSingleWei:string;dailyWei:string;monthlyWei:string;online:boolean;recurring:boolean;international:boolean;blockedMcc:readonly string[];allowedMcc:readonly string[];blockedMerchants:readonly string[];allowedMerchants?:readonly string[];emergencyBlock?:boolean;blockedCountries:readonly string[];allowedCountries:readonly string[];velocity:number};
type Merchant={id:string;mcc:string;country:string;channel:'online'|'terminal';recurring:boolean};
type PriorAuthorization={cardId:string;amountWei:string;status:'APPROVED'|'DECLINED';createdAt:string};
const validWei=(value:unknown,zero=true):value is string=>typeof value==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(value)&&BigInt(value)<2n**256n&&(zero||value!=='0');
const validTime=(value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const validId=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=256;
const validList=(value:unknown):value is readonly string[]=>Array.isArray(value)&&value.length<=1000&&value.every(validId);
export function evaluateTestnetAuthorizationRisk(input:{cardId:string;status:'ACTIVE'|'FROZEN'|'CLOSED';availableWei:string;amountWei:string;merchant:Merchant;controls:TestnetRiskControls;previous:readonly PriorAuthorization[];now:string}):string|undefined {
  // This policy is also a durable-state/processor boundary, not just a typed
  // convenience function. Malformed history must never become approval.
  if(!input||typeof input!=='object'||!validId(input.cardId)||!['ACTIVE','FROZEN','CLOSED'].includes(input.status)||!validWei(input.availableWei)||!validWei(input.amountWei,false)||!validTime(input.now)||!Array.isArray(input.previous))return 'INVALID_PROCESSOR_EVENT';
  const controls=input.controls,merchant=input.merchant;
  if(!controls||typeof controls!=='object'||!validWei(controls.maxSingleWei)||!validWei(controls.dailyWei)||!validWei(controls.monthlyWei)||!Number.isSafeInteger(controls.velocity)||controls.velocity<1||[controls.online,controls.recurring,controls.international].some(value=>typeof value!=='boolean')||(controls.emergencyBlock!==undefined&&typeof controls.emergencyBlock!=='boolean')||[controls.blockedMcc,controls.allowedMcc,controls.blockedMerchants,controls.blockedCountries,controls.allowedCountries].some(value=>!validList(value))||(controls.allowedMerchants!==undefined&&!validList(controls.allowedMerchants)))return 'INVALID_PROCESSOR_EVENT';
  if(!merchant||typeof merchant!=='object'||!validId(merchant.id)||typeof merchant.mcc!=='string'||!/^\d{4}$/.test(merchant.mcc)||typeof merchant.country!=='string'||! /^[A-Z]{2}$/.test(merchant.country)||!['online','terminal'].includes(merchant.channel)||typeof merchant.recurring!=='boolean')return 'INVALID_PROCESSOR_EVENT';
  if(input.previous.some(a=>!a||typeof a!=='object'||!validId(a.cardId)))return 'INVALID_PROCESSOR_EVENT';
  const previous=input.previous.filter(a=>a.cardId===input.cardId);
  if(previous.some(a=>!['APPROVED','DECLINED'].includes(a.status)||!validWei(a.amountWei,false)||!validTime(a.createdAt)||Date.parse(a.createdAt)>Date.parse(input.now)))return 'INVALID_PROCESSOR_EVENT';
  const {cardId,status,merchant:m,controls:c,now}=input,value=BigInt(input.amountWei);
  if(status!=='ACTIVE')return 'CARD_'+status;
  if(c.emergencyBlock===true)return 'EMERGENCY_BLOCK';
  // Declined attempts consume the attempt budget too. Idempotent replays are
  // returned before entering this policy by the durable service transaction.
  if(previous.filter(a=>Date.parse(now)-Date.parse(a.createdAt)<300000).length>=c.velocity)return 'VELOCITY_EXCEEDED';
  if(value>BigInt(input.availableWei))return 'INSUFFICIENT_BALANCE';
  if(value>BigInt(c.maxSingleWei))return 'MAX_TRANSACTION_EXCEEDED';
  if(m.channel==='online'&&!c.online)return 'ONLINE_DISABLED';
  if(m.recurring&&!c.recurring)return 'RECURRING_DISABLED';
  if(m.country!=='YN'&&!c.international)return 'INTERNATIONAL_DISABLED';
  if(c.blockedMcc.includes(m.mcc)||c.allowedMcc.length>0&&!c.allowedMcc.includes(m.mcc))return 'MCC_BLOCKED';
  if(c.blockedMerchants.includes(m.id)||(c.allowedMerchants?.length??0)>0&&!c.allowedMerchants!.includes(m.id))return 'MERCHANT_BLOCKED';
  if(c.blockedCountries.includes(m.country)||c.allowedCountries.length>0&&!c.allowedCountries.includes(m.country))return 'COUNTRY_BLOCKED';
  const accepted=previous.filter(a=>a.status==='APPROVED');
  const sum=(period:number)=>accepted.filter(a=>a.createdAt.slice(0,period)===now.slice(0,period)).reduce((total,a)=>total+BigInt(a.amountWei),0n);
  if(sum(10)+value>BigInt(c.dailyWei))return 'DAILY_LIMIT_EXCEEDED';
  if(sum(7)+value>BigInt(c.monthlyWei))return 'MONTHLY_LIMIT_EXCEEDED';
  return undefined;
}
