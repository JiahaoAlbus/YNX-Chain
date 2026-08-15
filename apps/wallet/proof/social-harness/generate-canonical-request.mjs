import { encodeRequestDeepLink, parseAuthorizationRequest } from "@ynx-chain/wallet-auth";

const deviceKey=process.argv[2];
if(typeof deviceKey!=="string"||!/^[A-Za-z0-9_-]{44}$/.test(deviceKey))throw new Error("Usage: node generate-canonical-request.mjs <compressed-p256-base64url-device-public-key>");
const now=new Date(),issuedAt=new Date(now.getTime()-30_000),expiresAt=new Date(now.getTime()+240_000);
const nonce=`social_api36_${crypto.randomUUID().replaceAll("-","")}`;
const registry={"ynx-social-v1":{requestingProduct:"social",bundleId:"com.ynx.social",callbacks:["ynx-social://com.ynx.social"],scopes:["account:read","profile:link"],maxScopes:2}};
const request=parseAuthorizationRequest({version:"1",nonce,chainId:"ynx_6423-1",requestingProduct:"social",productClientId:"ynx-social-v1",bundleId:"com.ynx.social",productDeviceAlgorithm:"p256-sha256",productDeviceKey:deviceKey,callback:"ynx-social://com.ynx.social",scopes:["account:read","profile:link"],purpose:"Link this exact Social API36 QA device to the selected YNX account.",issuedAt:issuedAt.toISOString(),expiresAt:expiresAt.toISOString()},{now,registry});
process.stdout.write(`${JSON.stringify({request,authorizeURL:encodeRequestDeepLink(request)})}\n`);
