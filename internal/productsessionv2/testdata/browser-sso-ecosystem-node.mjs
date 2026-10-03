// Existing Central source interoperability fixture only. No production keys,
// Wallet profile, protected configuration or new authorization protocol.
import {createServer} from 'node:http';import {readFileSync} from 'node:fs';import {join} from 'node:path';import {pathToFileURL} from 'node:url';import {randomBytes} from 'node:crypto';
const source=process.env.YNX_QA_CENTRAL_SOURCE;if(!source)throw Error('explicit reviewed source required');
const load=p=>import(pathToFileURL(join(source,'packages/wallet-auth',p)).href);
const {CentralBrowserSessionAuthority,CentralBrowserSessionNodeRoutes,centralBrowserConsentSignBytes}=await load('src/central-browser-session.js');
const {CentralBrowserSessionStore}=await load('src/central-browser-session-store.js');
const {createCentralBrowserSessionRegistry}=await load('src/central-browser-session-registry.js');
const {walletIdentity}=await load('src/crypto.js');const {secp256k1}=await load('node_modules/@noble/curves/secp256k1.js');const {sha256}=await load('node_modules/@noble/hashes/sha2.js');const {hexToBytes,bytesToHex,utf8ToBytes}=await load('node_modules/@noble/hashes/utils.js');
const doc=JSON.parse(readFileSync(join(source,'packages/wallet-auth/product-session-registry.json'),'utf8'));
const registry=createCentralBrowserSessionRegistry(doc,{ecosystem:true}),authority=new CentralBrowserSessionAuthority(registry,new CentralBrowserSessionStore(process.env.YNX_QA_STATE_PATH)),routes=new CentralBrowserSessionNodeRoutes(authority);
let mode='normal';const sessions=new Map();
const server=createServer(async(req,res)=>{try{
 const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks).toString();
 if(req.url.startsWith('/__qa/')){
  const input=JSON.parse(body||'{}');let result={};
  if(req.url==='/__qa/approve'){
   const initiator=Object.fromEntries(new URL(input.url).searchParams),binding=randomBytes(32).toString('base64url'),{challenge}=authority.challenge(initiator,binding),key='1'.padStart(64,'0'),identity=walletIdentity(key);
   const approval={challengeId:challenge.challengeId,...identity,walletSignature:bytesToHex(secp256k1.sign(sha256(utf8ToBytes(centralBrowserConsentSignBytes(challenge,identity.account,identity.accountPublicKey))),hexToBytes(key),{prehash:false,format:'compact',lowS:true}))};
   const session=authority.complete(approval,binding);sessions.set(initiator.clientId,session.sessionToken);result=authority.authorize(initiator,session.sessionToken);
  }else if(req.url==='/__qa/generation')result=authority.logout(sessions.get(input.clientId));
  else if(req.url==='/__qa/mode'){mode=input.mode;result={ok:true};}
  else throw Error('unknown test command');
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));return;
 }
 if(mode==='redirect'){res.writeHead(307,{location:'https://attacker.invalid/not-contacted'});res.end();return;}
 if(mode==='outage'){res.writeHead(503,{'content-type':'application/json'});res.end('{}');return;}
 const result=routes.handle({method:req.method,url:req.url,headers:req.headers,body});res.writeHead(result.status,result.headers);res.end(result.body);
}catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:String(error)}));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));console.log(JSON.stringify({url:'http://127.0.0.1:'+server.address().port,registry,defaultRoster:createCentralBrowserSessionRegistry(doc).length}));
