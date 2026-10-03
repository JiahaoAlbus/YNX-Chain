// Disposable software QA authority on loopback. No real Wallet approval,
// production key, user account enrollment or public registration is performed.
// Proof/session output uses the test's private pipe and is never an artifact.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';
const base=pathToFileURL(process.env.YNX_QA_CENTRAL_SOURCE+'/packages/wallet-auth/');
const load=path=>import(new URL(path,base));
const {createProductSessionRequest,signProductSessionApproval,signProductSessionChallenge}=await load('src/product-session-v2.js');
const {createProductSessionProofV2}=await load('src/product-session-proof-v2.js');
const {encodeProductSessionGatewayProofHeaderV2}=await load('src/product-session-gateway-client.js');
const {canonicalJSON}=await load('src/canonical.js');
const {httpBodyDigest}=await load('src/session-proof.js');
const {p256}=await load('node_modules/@noble/curves/nist.js');
const productId=process.env.YNX_QA_PRODUCT_ID,platform=process.env.YNX_QA_PLATFORM;
const browserMode=process.env.YNX_QA_BROWSER_DEVICE==='1';
const scope={video:'video:library','creator-studio':'creator:publish',music:'music.library'}[productId];
if(!scope)throw Error('UNSUPPORTED_QA_PRODUCT');
const registry=JSON.parse(readFileSync(new URL('product-session-registry.json',base))),token=()=>randomBytes(32).toString('base64url');
const product=registry.products.find(p=>p.productId===productId),scopes=[...product.scopes].sort();
const device=randomBytes(32),secret=Buffer.from(device).toString('base64url');
let request;
try{request=createProductSessionRequest(registry,{productId,platform,deviceId:token(),deviceKey:Buffer.from(p256.getPublicKey(device,true)).toString('base64url'),scopes,purpose:'Disposable Media protocol interoperability QA',nonce:token(),state:token()});}
catch(error){process.stdout.write(JSON.stringify({unsupported:true,productId,platform,code:typeof error?.code==='string'?error.code:'REGISTRY_REJECTED'})+'\n');process.exit(0);}
const {ProductSessionControlNodeHost}=await load('src/product-session-control-node-host.js');
const {ProductSessionGatewayKernel}=await load('src/product-session-gateway.js');
const {migrateProductSessionControlSnapshotV2}=await load('src/product-session-control-intent.js');
const {initializeProductSessionControlState}=await load('src/product-session-control-node-store.js');
const {CentralBrowserSessionAuthority,CentralBrowserSessionNodeRoutes}=await load('src/central-browser-session.js');
const {CentralBrowserSessionStore}=await load('src/central-browser-session-store.js');
const {createCentralBrowserSessionRegistry}=await load('src/central-browser-session-registry.js');
const statePath=process.env.YNX_QA_STATE_PATH;
initializeProductSessionControlState(statePath,migrateProductSessionControlSnapshotV2(new ProductSessionGatewayKernel(registry,token).snapshot()));
const host=new ProductSessionControlNodeHost(registry,{statePath,now:()=>new Date(),tokenFactory:token});
const browserAuthority=new CentralBrowserSessionAuthority(createCentralBrowserSessionRegistry(registry,browserMode&&productId!=='music'?{ecosystem:true}:{}),new CentralBrowserSessionStore(statePath+'.browser'),{tokenFactory:token,privateBusinessRevalidation:true,privateProductRegistry:registry,privateBackendRegistrations:[{productId,platform,keyId:'media-qa',allowedScopes:scopes}],backendClients:[{clientId:product.clientId+'-business-'+platform+'-v1',keyId:'media-qa',publicKey:process.env.YNX_QA_PUBLIC_KEY}],familySealKey:randomBytes(32),productRevalidator:(session,scopes,productId,at)=>host.revalidate(session,scopes,productId,at,true)});
const central=new CentralBrowserSessionNodeRoutes(browserAuthority);
const productHandler=host.handler();
const server=createServer(async(r,w)=>{if(central.handles(new URL(r.url,'http://localhost').pathname)){let body='';for await(const chunk of r)body+=chunk;const result=central.handle({method:r.method,url:r.url,headers:r.headers,body});w.writeHead(result.status,result.headers);w.end(result.body);}else await productHandler(r,w);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
async function call(path,body){const r=await fetch(url+path,{method:'POST',headers:{'content-type':'application/json','x-request-id':'req_'+token(),...(platform==='web'?{origin:product.webOrigin}:{})},body:canonicalJSON(body)});if(r.status!==200)throw Error('QA_APPROVAL_FAILED');return(await r.json()).result;}
let session=null;
if(!browserMode){
 const approval=signProductSessionApproval(registry,request,{accountSecret:'1'.padStart(64,'0'),scopes:request.scopes,expiresAt:request.expiresAt});
 const challenge=await call('/v2/product-sessions/challenge',{request,approval});
 session=await call('/v2/product-sessions/complete',{request,approval,completion:signProductSessionChallenge(challenge,secret)});
}
function proof(method,path,body,nonce=token()){const now=new Date();return encodeProductSessionGatewayProofHeaderV2(createProductSessionProofV2(session,{method,path,bodyDigest:httpBodyDigest(body),nonce,issuedAt:now.toISOString(),expiresAt:new Date(+now+30000).toISOString()},secret));}
process.stdout.write(JSON.stringify({url,session,unsupported:false})+'\n');
for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
 const input=JSON.parse(line);
 if(input.kind==='approve-sso'&&browserMode&&productId!=='music'){
  const link=new URL(input.url);if(link.origin!=='https://wallet-auth.ynxweb4.com'||link.pathname!=='/v2/browser-sessions/authorize')throw Error('Original SSO approval URL required');
  const initiator=Object.fromEntries(link.searchParams);delete initiator.prompt;
  const {walletIdentity}=await load('src/crypto.js'),{centralBrowserConsentSignBytes}=await load('src/central-browser-session.js'),{secp256k1}=await load('node_modules/@noble/curves/secp256k1.js'),{sha256}=await load('node_modules/@noble/hashes/sha2.js'),{hexToBytes,bytesToHex,utf8ToBytes}=await load('node_modules/@noble/hashes/utils.js');
  const binding=token(),{challenge}=browserAuthority.challenge(initiator,binding),accountSecret='1'.padStart(64,'0'),identity=walletIdentity(accountSecret);
  const approval={challengeId:challenge.challengeId,...identity,walletSignature:bytesToHex(secp256k1.sign(sha256(utf8ToBytes(centralBrowserConsentSignBytes(challenge,identity.account,identity.accountPublicKey))),hexToBytes(accountSecret),{prehash:false,format:'compact',lowS:true}))};
  const tokenResult=browserAuthority.complete(approval,binding);process.stdout.write(JSON.stringify({callback:browserAuthority.authorize(initiator,tokenResult.sessionToken).redirectUri})+'\n');
 }else if(['approve-browser-request','approve-native-request'].includes(input.kind)&&browserMode){
  const {parseProductSessionWalletURL,createProductSessionReturnURL}=await load('src/product-session-router.js');
  const pending=parseProductSessionWalletURL(registry,input.url);
  if(pending.productId!==productId||pending.platform!==platform)throw Error('INVALID_QA_BROWSER_BINDING');
  if(input.sampleWallet!==undefined&&!(productId==='creator-studio'&&input.kind==='approve-native-request'&&input.sampleWallet==='independent-moderator'))throw Error('INVALID_QA_SAMPLE_WALLET');
  // Two disposable sample Wallet signatures exercise real original SDK
  // authority and independent review. No production Wallet/key is loaded.
  const accountSecret=(input.sampleWallet==='independent-moderator'?'5':'1').padStart(64,'0');
  const approval=signProductSessionApproval(registry,pending,{accountSecret,scopes:pending.scopes,expiresAt:pending.expiresAt});
  process.stdout.write(JSON.stringify({callback:createProductSessionReturnURL(registry,pending,{result:'approved',approval})})+'\n');
 }else if(input.kind==='proofs'&&!browserMode){
  if(typeof input.bodyBase64!=='string'||input.bodyBase64.length>2*1024*1024)throw Error('INVALID_QA_WIRE');
  const body=Buffer.from(input.bodyBase64,'base64');
  if(input.operation!==undefined&&input.operation!=='account')throw Error('INVALID_QA_OPERATION');
  const account=input.operation==='account';
  if(account&&body.length)throw Error('INVALID_QA_ACCOUNT_BODY');
  const path=account?(productId==='music'?'/api/me':'/v1/account'):(productId==='music'?'/api/playlists':'/v1/playlists');
  const requiredScope=account?({video:'video:account','creator-studio':'creator:account',music:'music.profile'}[productId]):scope;
  process.stdout.write(JSON.stringify({initial:proof('POST','/v2/product-sessions/introspect',canonicalJSON({requiredScopes:[requiredScope]})),action:proof(account?'GET':'POST',path,new Uint8Array(body))})+'\n');
 }else if(input.kind==='revoke'&&!browserMode){
  process.stdout.write(JSON.stringify({revoke:proof('POST','/v2/product-sessions/revoke',canonicalJSON({}))})+'\n');
 }else throw Error('INVALID_QA_COMMAND');
}
await new Promise(resolve=>server.close(resolve));
