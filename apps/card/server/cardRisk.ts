/** TEST-only authorization policy. No issuer/network/payment authority. */
export type TestnetRiskControls={maxSingleWei:string;dailyWei:string;monthlyWei:string;online:boolean;recurring:boolean;international:boolean;blockedMcc:readonly string[];allowedMcc:readonly string[];blockedMerchants:readonly string[];blockedCountries:readonly string[];allowedCountries:readonly string[];velocity:number};
type Merchant={id:string;mcc:string;country:string;channel:'online'|'terminal';recurring:boolean};
type PriorAuthorization={cardId:string;amountWei:string;status:'APPROVED'|'DECLINED';createdAt:string};
export function evaluateTestnetAuthorizationRisk(input:{cardId:string;status:'ACTIVE'|'FROZEN'|'CLOSED';availableWei:string;amountWei:string;merchant:Merchant;controls:TestnetRiskControls;previous:readonly PriorAuthorization[];now:string}):string|undefined {
  const {cardId,status,merchant:m,controls:c,now}=input,value=BigInt(input.amountWei);
  if(status!=='ACTIVE')return 'CARD_'+status;
  const previous=input.previous.filter(a=>a.cardId===cardId);
  // Declined attempts consume the attempt budget too. Idempotent replays are
  // returned before entering this policy by the durable service transaction.
  if(previous.filter(a=>Date.parse(now)-Date.parse(a.createdAt)<300000).length>=c.velocity)return 'VELOCITY_EXCEEDED';
  if(value>BigInt(input.availableWei))return 'INSUFFICIENT_BALANCE';
  if(value>BigInt(c.maxSingleWei))return 'MAX_TRANSACTION_EXCEEDED';
  if(m.channel==='online'&&!c.online)return 'ONLINE_DISABLED';
  if(m.recurring&&!c.recurring)return 'RECURRING_DISABLED';
  if(m.country!=='YN'&&!c.international)return 'INTERNATIONAL_DISABLED';
  if(c.blockedMcc.includes(m.mcc)||c.allowedMcc.length>0&&!c.allowedMcc.includes(m.mcc))return 'MCC_BLOCKED';
  if(c.blockedMerchants.includes(m.id))return 'MERCHANT_BLOCKED';
  if(c.blockedCountries.includes(m.country)||c.allowedCountries.length>0&&!c.allowedCountries.includes(m.country))return 'COUNTRY_BLOCKED';
  const accepted=previous.filter(a=>a.status==='APPROVED');
  const sum=(period:number)=>accepted.filter(a=>a.createdAt.slice(0,period)===now.slice(0,period)).reduce((total,a)=>total+BigInt(a.amountWei),0n);
  if(sum(10)+value>BigInt(c.dailyWei))return 'DAILY_LIMIT_EXCEEDED';
  if(sum(7)+value>BigInt(c.monthlyWei))return 'MONTHLY_LIMIT_EXCEEDED';
  return undefined;
}
