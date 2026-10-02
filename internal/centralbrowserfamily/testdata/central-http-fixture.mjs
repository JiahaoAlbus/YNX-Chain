// Isolated contract server: actual Central routes and durable store, synthetic
// accounts only, loopback only. This never connects to a deployed issuer.
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {secp256k1} from '../../../packages/wallet-auth/node_modules/@noble/curves/secp256k1.js';
import {sha256} from '../../../packages/wallet-auth/node_modules/@noble/hashes/sha2.js';
import {hexToBytes,bytesToHex,utf8ToBytes} from '../../../packages/wallet-auth/node_modules/@noble/hashes/utils.js';
import {walletIdentity} from '../../../packages/wallet-auth/src/crypto.js';
import {CentralBrowserSessionStore} from '../../../packages/wallet-auth/src/central-browser-session-store.js';
import {CentralBrowserSessionAuthority,CentralBrowserSessionNodeRoutes,centralBrowserConsentSignBytes} from '../../../packages/wallet-auth/src/central-browser-session.js';
import {createCentralBrowserSessionRegistry} from '../../../packages/wallet-auth/src/central-browser-session-registry.js';
const directory=process.argv[2],registry=createCentralBrowserSessionRegistry(JSON.parse(readFileSync(new URL('../../../packages/wallet-auth/product-session-registry.json',import.meta.url)))),client=registry.find(c=>c.productId==='finance');
const now=()=>Number(readFileSync(join(directory,'clock'),'utf8')),token=()=>randomBytes(32).toString('base64url'),store=new CentralBrowserSessionStore(join(directory,'central-state'));
let authority=new CentralBrowserSessionAuthority(registry,store,{now,backendClients:[{clientId:client.clientId,keyId:'isolated-test',publicKey:readFileSync(join(directory,'public.pem'),'utf8')}],familySealKey:randomBytes(32)}),routes=new CentralBrowserSessionNodeRoutes(authority);
const sessions=[],inputs=[];
for(const index of [1,2]){
 const key=String(index).padStart(64,'0'),identity=walletIdentity(key),verifier=token(),input={clientId:client.clientId,origin:client.origin,redirectUri:client.redirectUri,state:token(),codeChallenge:createHash('sha256').update(verifier).digest('base64url'),codeChallengeMethod:'S256'},binding=token(),{challenge}=authority.challenge(input,binding);
 const approval={challengeId:challenge.challengeId,...identity,walletSignature:bytesToHex(secp256k1.sign(sha256(utf8ToBytes(centralBrowserConsentSignBytes(challenge,identity.account,identity.accountPublicKey))),hexToBytes(key),{prehash:false,format:'compact',lowS:true}))},session=authority.complete(approval,binding);
 sessions.push(session);const redirect=authority.authorize(input,session.sessionToken);inputs.push({Code:new URL(redirect.redirectUri).searchParams.get('code'),State:input.state,CodeVerifier:verifier});
}
let dropNextRenewResult=false;
const server=http.createServer(async(req,res)=>{
 try{
  if(req.method==='GET'&&req.url.startsWith('/qa/authorize?')){const query=new URL(req.url,'http://127.0.0.1').searchParams,index=Number(query.get('qaSession')||0);query.delete('qaSession');const result=authority.authorize(Object.fromEntries(query),sessions[index].sessionToken);res.setHeader('content-type','application/json');res.end(JSON.stringify(result));return;}
  if(req.method==='POST'&&req.url==='/qa/logout-first'){authority.logout(sessions[0].sessionToken);res.end('{}');return;}
  if(req.method==='POST'&&req.url==='/qa/drop-next-renew-result'){dropNextRenewResult=true;res.end('{}');return;}
  if(req.method==='GET'&&req.url==='/qa/facts'){const snapshot=store.snapshot();res.end(JSON.stringify({schemaVersion:snapshot.schemaVersion,epochs:snapshot.families.map(f=>f.epoch)}));return;}
  if(req.method==='POST'&&req.url==='/qa/guarded-fallback'){authority=new CentralBrowserSessionAuthority(registry,new CentralBrowserSessionStore(join(directory,'central-state')),{now});routes=new CentralBrowserSessionNodeRoutes(authority);res.end('{}');return;}
  const chunks=[];for await(const chunk of req){chunks.push(chunk);if(chunks.reduce((n,c)=>n+c.length,0)>65536)throw Error('body limit');}
  const result=routes.handle({method:req.method,url:req.url,headers:req.headers,body:Buffer.concat(chunks).toString('utf8')});
  if(req.url==='/v2/browser-sessions/renew'&&result.status===200&&dropNextRenewResult){dropNextRenewResult=false;res.destroy();return;}
  res.writeHead(result.status,result.headers);res.end(result.body);
 }catch{res.writeHead(500,{'content-type':'application/json'});res.end('{"ok":false,"error":{"code":"SSO_FIXTURE_FAILURE"}}');}
});
server.listen(0,'127.0.0.1',()=>process.stdout.write(JSON.stringify({port:server.address().port,inputs})+'\n'));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
