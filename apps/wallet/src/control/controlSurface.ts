import { parseCapitalProductReview } from "@ynx-chain/wallet-auth";

export const CAPITAL_PRODUCT_TYPES = Object.freeze([
  "native-staking", "liquid-staking-candidate", "withdrawal-queue", "safety-module",
  "service-security-pool", "dex-lp", "vault", "trading-subaccount", "api-wallet",
  "portfolio-margin", "stablecoin", "cross-chain-route", "solver-auction",
  "protocol-owned-liquidity", "treasury-multisig",
] as const);

export type CapitalProductType = typeof CAPITAL_PRODUCT_TYPES[number];
export type CapitalReview = Readonly<Record<string, unknown> & {productType:CapitalProductType;name:string;provider:string;contract:string;governance:string;yieldSource:string;historicalYieldRange:string;fees:string;lock:string;cooldown:string;slashing:string;drawdown:string;withdrawalDelay:string;reserveRatio:string;immediateExit:string;revoke:string;risk:string;source:string;asOf:string;version:string}>;
export type SmartAccountEvidence = Readonly<{chainId:6423;account:string;entryPoint:string;paymaster:string;bundlerOrigin:string;deploymentTxHash:string;codeHash:string;bundlerHealthy:boolean;entryPointSupported:boolean;sponsorshipEnabled:boolean;source:string;asOf:string;version:string}>;
export type WalletControlView = Readonly<{phase:"verified"|"unavailable";reason:string;smartAccount:SmartAccountEvidence|null;smartAccountReady:boolean;sponsorshipReady:boolean;capitalReviews:readonly CapitalReview[];missingCapitalProducts:readonly CapitalProductType[];staleCapitalProducts:readonly CapitalProductType[];asOf:string|null}>;

const ADDRESS=/^0x[0-9a-f]{40}$/;
const HASH=/^0x[0-9a-f]{64}$/;

function exactObject(value:unknown,fields:readonly string[],label:string):Record<string,unknown>{
  if(value===null||typeof value!=="object"||Array.isArray(value))throw new Error(`${label} must be an object`);
  const record=value as Record<string,unknown>;
  const keys=Object.keys(record).sort();
  const expected=[...fields].sort();
  if(keys.length!==expected.length||keys.some((key,index)=>key!==expected[index]))throw new Error(`${label} fields are invalid`);
  return record;
}
function string(value:unknown,label:string,pattern?:RegExp):string{if(typeof value!=="string"||value.trim()!==value||value.length<1||value.length>512||pattern&&!pattern.test(value))throw new Error(`${label} is invalid`);return value}
function bool(value:unknown,label:string):boolean{if(typeof value!=="boolean")throw new Error(`${label} must be boolean`);return value}
function https(value:unknown,label:string):string{const result=string(value,label);let url:URL;try{url=new URL(result)}catch{throw new Error(`${label} is invalid`)}if(url.protocol!=="https:"||url.username||url.password||url.hash||url.toString()!==result)throw new Error(`${label} must be canonical HTTPS`);return result}
function time(value:unknown,label:string):string{const result=string(value,label,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);if(new Date(result).toISOString()!==result)throw new Error(`${label} is invalid`);return result}

export function parseSmartAccountEvidence(input:unknown):SmartAccountEvidence{
  const value=exactObject(input,["chainId","account","entryPoint","paymaster","bundlerOrigin","deploymentTxHash","codeHash","bundlerHealthy","entryPointSupported","sponsorshipEnabled","source","asOf","version"],"Smart Account evidence");
  if(value.chainId!==6423)throw new Error("Smart Account evidence chainId must be 6423");
  const result={chainId:6423 as const,account:string(value.account,"account",ADDRESS),entryPoint:string(value.entryPoint,"entryPoint",ADDRESS),paymaster:string(value.paymaster,"paymaster",ADDRESS),bundlerOrigin:https(value.bundlerOrigin,"bundlerOrigin"),deploymentTxHash:string(value.deploymentTxHash,"deploymentTxHash",HASH),codeHash:string(value.codeHash,"codeHash",HASH),bundlerHealthy:bool(value.bundlerHealthy,"bundlerHealthy"),entryPointSupported:bool(value.entryPointSupported,"entryPointSupported"),sponsorshipEnabled:bool(value.sponsorshipEnabled,"sponsorshipEnabled"),source:https(value.source,"source"),asOf:time(value.asOf,"asOf"),version:string(value.version,"version")};
  return Object.freeze(result);
}

export function buildWalletControlView(input:unknown,at=new Date()):WalletControlView{
  try{
    const root=exactObject(input,["schemaVersion","smartAccount","capitalReviews"],"Wallet control snapshot");
    if(root.schemaVersion!==1||!Array.isArray(root.capitalReviews))throw new Error("Wallet control snapshot version or reviews are invalid");
    const smartAccount=root.smartAccount===null?null:parseSmartAccountEvidence(root.smartAccount);
    const reviews=root.capitalReviews.map((item)=>parseCapitalProductReview(item) as CapitalReview);
    const currentTypes=new Set<CapitalProductType>();
    for(const review of reviews){if(!CAPITAL_PRODUCT_TYPES.includes(review.productType)||currentTypes.has(review.productType))throw new Error("Capital review product types must be supported and unique");currentTypes.add(review.productType)}
    const now=at.getTime();
    if(!Number.isFinite(now))throw new Error("Review time is invalid");
    const timestamps=[...reviews.map((review)=>Date.parse(review.asOf)),...(smartAccount?[Date.parse(smartAccount.asOf)]:[])];
    if(timestamps.some((stamp)=>stamp>now+60_000))throw new Error("Evidence cannot be future-dated");
    const stale=reviews.filter((review)=>now-Date.parse(review.asOf)>86_400_000).map((review)=>review.productType);
    const ready=smartAccount!==null&&now-Date.parse(smartAccount.asOf)<=300_000&&smartAccount.bundlerHealthy&&smartAccount.entryPointSupported;
    return Object.freeze({phase:"verified" as const,reason:ready?"Fresh chain and Bundler evidence verified":"No fresh, complete public Smart Account evidence",smartAccount,smartAccountReady:ready,sponsorshipReady:ready&&smartAccount!.sponsorshipEnabled,capitalReviews:Object.freeze(reviews),missingCapitalProducts:Object.freeze(CAPITAL_PRODUCT_TYPES.filter((type)=>!currentTypes.has(type))),staleCapitalProducts:Object.freeze(stale),asOf:timestamps.length?new Date(Math.max(...timestamps)).toISOString():null});
  }catch(caught){
    return Object.freeze({phase:"unavailable" as const,reason:caught instanceof Error?caught.message:"Invalid Wallet control snapshot",smartAccount:null,smartAccountReady:false,sponsorshipReady:false,capitalReviews:Object.freeze([]),missingCapitalProducts:CAPITAL_PRODUCT_TYPES,staleCapitalProducts:Object.freeze([]),asOf:null});
  }
}
