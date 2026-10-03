// Software QA keys, isolated authority and private pipes only. No actual Wallet.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline';
const base=pathToFileURL(process.env.YNX_QA_CENTRAL_SOURCE+'/packages/wallet-auth/');
const load=p=>import(new URL(p,base));
const {ProductSessionGatewayNodeHost}=await load('src/product-session-gateway-node-host.js');
const {createProductSessionRequest,signProductSessionApproval,signProductSessionChallenge}=await load('src/product-session-v2.js');
const {createProductSessionProofV2}=await load('src/product-session-proof-v2.js');
const {encodeProductSessionGatewayProofHeaderV2}=await load('src/product-session-gateway-client.js');
const {canonicalJSON}=await load('src/canonical.js');
const {httpBodyDigest}=await load('src/session-proof.js');
const {p256}=await load('node_modules/@noble/curves/nist.js');
const registry=JSON.parse(readFileSync(new URL('product-session-registry.json',base)));
const platform=process.env.YNX_QA_PLATFORM,token=()=>randomBytes(32).toString('base64url');
const device=new Uint8Array(32).fill(3),secret=Buffer.from(device).toString('base64url');
const host=new ProductSessionGatewayNodeHost(registry,{statePath:process.env.YNX_QA_STATE_PATH,now:()=>new Date(),tokenFactory:token,centralBrowser:true,centralBrowserEcosystem:true,businessRevalidation:true,centralBackend:{backendClients:[{clientId:'ynx-shop-v1-sso-v1',keyId:'qa',publicKey:process.env.YNX_QA_PUBLIC_KEY}],familySealKey:randomBytes(32)}});
const server=createServer(host.handler());await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
async function call(path,body){const r=await fetch(url+path,{method:'POST',headers:{'content-type':'application/json','x-request-id':'req_'+token(),...(platform==='web'?{origin:'https://shop.ynxweb4.com'}:{})},body:canonicalJSON(body)});if(r.status!==200)throw Error('QA_APPROVAL_FAILED');return(await r.json()).result;}
const request=createProductSessionRequest(registry,{productId:'shop',platform,deviceId:token(),deviceKey:Buffer.from(p256.getPublicKey(device,true)).toString('base64url'),scopes:['account:read','shop:orders:write','shop:profile:write'],purpose:'Isolated Commerce QA only',nonce:token(),state:token()});
const approval=signProductSessionApproval(registry,request,{accountSecret:'1'.padStart(64,'0'),scopes:request.scopes,expiresAt:request.expiresAt});
const challenge=await call('/v2/product-sessions/challenge',{request,approval});
const session=await call('/v2/product-sessions/complete',{request,approval,completion:signProductSessionChallenge(challenge,secret)});
function proof(method,path,body,nonce=token()){const now=new Date();return encodeProductSessionGatewayProofHeaderV2(createProductSessionProofV2(session,{method,path,bodyDigest:httpBodyDigest(body),nonce,issuedAt:now.toISOString(),expiresAt:new Date(+now+30000).toISOString()},secret));}
process.stdout.write(JSON.stringify({url,account:session.account,binding:session.sessionBinding})+'\n');
let previousAction;
for await(const line of createInterface({input:process.stdin})){
 const command=JSON.parse(line);
 if(command.revoke){
  const r=await fetch(url+'/v2/product-sessions/revoke',{method:'POST',headers:{'content-type':'application/json','x-request-id':'req_'+token(),'x-ynx-product-session-proof-v2':proof('POST','/v2/product-sessions/revoke',canonicalJSON({})),...(platform==='web'?{origin:'https://shop.ynxweb4.com'}:{})},body:canonicalJSON({})});
  if(r.status!==200)throw Error('QA_REVOCATION_FAILED');
  process.stdout.write(JSON.stringify({revoked:true})+'\n');continue;
 }
 const introspection=proof('POST','/v2/product-sessions/introspect',canonicalJSON({requiredScopes:command.scopes}));
 const action=command.reuseAction?previousAction:proof(command.method,command.path,command.body??'');
 previousAction=action;
 process.stdout.write(JSON.stringify({introspection,action})+'\n');
}
server.close();
