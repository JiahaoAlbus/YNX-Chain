import {launchWebAuthorization} from "@ynx-chain/wallet-auth";

const EXACT_FIELDS=["bundleId","callback","chainId","expiresAt","issuedAt","nonce","productClientId","productDeviceAlgorithm","productDeviceKey","purpose","requestingProduct","scopes","version"];
const EXACT_SCOPES=["account:read","search:cases"];
const EXACT_CALLBACK="https://web4.ynxweb4.com/search/auth/callback";

export function parseSearchAuthorizationDeepLink(value,{now=new Date()}={}){
  let url;
  try{url=new URL(value)}catch{throw new Error("Search Wallet authorization link is invalid.")}
  if(url.protocol!=="ynxwallet:"||url.hostname!=="authorize"||url.pathname||url.hash||url.username||url.password)throw new Error("Search Wallet authorization route is invalid.");
  const keys=[...url.searchParams.keys()];
  if(keys.length!==1||keys[0]!=="request")throw new Error("Search Wallet authorization request is missing or ambiguous.");
  let request;
  try{const encoded=url.searchParams.get("request")||"",normalized=encoded.replaceAll("-","+").replaceAll("_","/");request=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Uint8Array.from(atob(normalized+"=".repeat((4-normalized.length%4)%4)),character=>character.charCodeAt(0))))}catch{throw new Error("Search Wallet authorization request encoding is invalid.")}
  if(!request||Array.isArray(request)||typeof request!=="object"||JSON.stringify(Object.keys(request).sort())!==JSON.stringify(EXACT_FIELDS))throw new Error("Search Wallet authorization request fields are invalid.");
  if(request.version!=="1"||request.chainId!=="ynx_6423-1"||request.requestingProduct!=="search"||request.productClientId!=="ynx-search-web"||request.bundleId!=="com.ynxweb4.search.web"||request.productDeviceAlgorithm!=="p256-sha256"||request.callback!==EXACT_CALLBACK)throw new Error("Search Wallet authorization product binding is invalid.");
  if(JSON.stringify(request.scopes)!==JSON.stringify(EXACT_SCOPES)||typeof request.purpose!=="string"||request.purpose.length<1||request.purpose.length>180)throw new Error("Search Wallet authorization scope or purpose is invalid.");
  if(!/^[A-Za-z0-9_-]{32,64}$/.test(request.nonce)||!/^[A-Za-z0-9_-]{43,44}$/.test(request.productDeviceKey))throw new Error("Search Wallet authorization nonce or device key is invalid.");
  const issued=Date.parse(request.issuedAt),expires=Date.parse(request.expiresAt),current=now.getTime();
  if(!Number.isFinite(current)||!Number.isFinite(issued)||!Number.isFinite(expires)||expires<=issued||expires-issued>300000||issued>current+30000||expires<=current)throw new Error("Search Wallet authorization request is expired or has invalid timing.");
  return Object.freeze({...request,scopes:Object.freeze([...request.scopes])});
}

export function launchSearchWalletAuthorization(deepLink,options={}){
  const request=parseSearchAuthorizationDeepLink(deepLink,{now:options.now});
  return launchWebAuthorization(request,options);
}
