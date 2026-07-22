import {p256} from "@noble/curves/nist.js";

export const binding={requestingProduct:"cloud",productClientId:"ynx-cloud-mobile-v1",bundleId:"com.ynxweb4.cloud",callback:"ynxcloud://wallet-auth/callback",scopes:["ai.use","audit.read","files.read","files.write","permissions.manage"]} as const;

const encoder=new TextEncoder();
const b64url=(bytes:Uint8Array)=>{let value="";for(const byte of bytes)value+=String.fromCharCode(byte);return btoa(value).replaceAll("+","-").replaceAll("/","_").replaceAll("=","")};
const decode=(value:string)=>Uint8Array.from(atob(value.replaceAll("-","+").replaceAll("_","/")+"===".slice((value.length+3)%4)),x=>x.charCodeAt(0));
export const canonicalJSON=(value:unknown):string=>Array.isArray(value)?`[${value.map(canonicalJSON).join(",")}]`:value!==null&&typeof value==="object"?`{${Object.keys(value as Record<string,unknown>).sort().map(key=>`${JSON.stringify(key)}:${canonicalJSON((value as Record<string,unknown>)[key])}`).join(",")}}`:JSON.stringify(value);

export function authorizationRequest(key:string,nonce:string,now=new Date(),options?:{scopes?:string[];purpose?:string}){
  const scopes=options?.scopes||[...binding.scopes],allowed=new Set([...binding.scopes,"data.delete"]);
  if(!scopes.length||scopes.some((scope,index)=>!allowed.has(scope)||(index>0&&scope<=scopes[index-1]!)))throw Error("Wallet request scopes must be unique, sorted, and registered");
  const purpose=options?.purpose?.trim()||"Use explicitly authorized YNX Cloud content on this device.";
  if(purpose.length<8||purpose.length>280)throw Error("Wallet request purpose is invalid");
  return {version:"1",nonce,chainId:"ynx_6423-1",...binding,scopes,productDeviceAlgorithm:"p256-sha256",productDeviceKey:key,purpose,issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+300000).toISOString()};
}
export function requestURL(key:string,nonce:string,now=new Date(),options?:{scopes?:string[];purpose?:string}){
  const request=authorizationRequest(key,nonce,now,options);
  return `ynxwallet://authorize?request=${b64url(encoder.encode(canonicalJSON(request)))}`;
}
export function approvalFromURL(url:string,request:ReturnType<typeof authorizationRequest>){
  const parsed=new URL(url);
  if(parsed.protocol!=="ynxcloud:"||parsed.host!=="wallet-auth"||parsed.pathname!=="/callback"||parsed.hash||[...parsed.searchParams.keys()].join()!=="response")throw Error("Wallet callback mismatch");
  let approval:any;try{approval=JSON.parse(new TextDecoder().decode(decode(parsed.searchParams.get("response")||"")))}catch{throw Error("Wallet response is not canonical base64url JSON")}
  const fields=["version","requestDigest","nonce","chainId","requestingProduct","productClientId","bundleId","productDeviceAlgorithm","productDeviceKey","callback","account","accountPublicKey","grantedScopes","purpose","issuedAt","expiresAt","walletSignature"];
  if(!approval||Object.keys(approval).sort().join("\n")!==[...fields].sort().join("\n"))throw Error("Wallet approval schema mismatch");
  for(const key of ["version","nonce","chainId","requestingProduct","productClientId","bundleId","productDeviceAlgorithm","productDeviceKey","callback","purpose","expiresAt"] as const)if(approval[key]!==request[key])throw Error(`Wallet approval ${key} mismatch`);
  if(!/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(approval.account)||!/^[0-9a-f]{66}$/.test(approval.accountPublicKey)||!/^[0-9a-f]{128}$/.test(approval.walletSignature)||!/^[0-9a-f]{64}$/.test(approval.requestDigest)||approval.grantedScopes.join("\n")!==request.scopes.join("\n"))throw Error("Wallet approval proof or scopes invalid");
  return approval;
}
export function signGatewayChallenge(secretHex:string,challenge:unknown){
  const secret=Uint8Array.from(secretHex.match(/../g)!.map(x=>parseInt(x,16)));
  const signature=p256.sign(encoder.encode(`YNX_PRODUCT_SESSION_CHALLENGE_V1\n${canonicalJSON(challenge)}`),secret,{format:"der"});
  return {challenge,deviceSignature:b64url(signature)};
}
