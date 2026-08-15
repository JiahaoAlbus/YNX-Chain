import { encodeRequestDeepLink, parseAuthorizationRequest } from "@ynx-chain/wallet-auth";
import { pathToFileURL } from "node:url";

const registry={"ynx-social-v1":{requestingProduct:"social",bundleId:"com.ynx.social",callbacks:["ynx-social://com.ynx.social"],scopes:["account:read","profile:link"],maxScopes:2}};

export function generateCanonicalSocialAuthorization(deviceKey,{now=new Date(),nonce=`social_api36_${crypto.randomUUID().replaceAll("-","")}`}={}){
  if(typeof deviceKey!=="string"||!/^[A-Za-z0-9_-]{44}$/.test(deviceKey))throw new Error("Social API36 QA device public key is invalid");
  if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw new Error("Social API36 QA request time is invalid");
  const issuedAt=new Date(now.getTime()-30_000),expiresAt=new Date(now.getTime()+240_000);
  const request=parseAuthorizationRequest({version:"1",nonce,chainId:"ynx_6423-1",requestingProduct:"social",productClientId:"ynx-social-v1",bundleId:"com.ynx.social",productDeviceAlgorithm:"p256-sha256",productDeviceKey:deviceKey,callback:"ynx-social://com.ynx.social",scopes:["account:read","profile:link"],purpose:"Link this exact Social API36 QA device to the selected YNX account.",issuedAt:issuedAt.toISOString(),expiresAt:expiresAt.toISOString()},{now,registry});
  return Object.freeze({request,authorizeURL:encodeRequestDeepLink(request)});
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const deviceKey=process.argv[2];
  if(deviceKey===undefined)throw new Error("Usage: node generate-canonical-request.mjs <compressed-p256-base64url-device-public-key>");
  process.stdout.write(`${JSON.stringify(generateCanonicalSocialAuthorization(deviceKey))}\n`);
}
