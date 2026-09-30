// Isolated, finite loopback QA only. Not a Wallet application or public proof.
import {createServer} from 'node:http';
import {chmod,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {secp256k1} from '../../../packages/wallet-auth/node_modules/@noble/curves/secp256k1.js';
import {sha256} from '../../../packages/wallet-auth/node_modules/@noble/hashes/sha2.js';
import {bytesToHex,hexToBytes,utf8ToBytes} from '../../../packages/wallet-auth/node_modules/@noble/hashes/utils.js';
import {walletIdentity} from '../../../packages/wallet-auth/src/crypto.js';
import {ProductSessionGatewayNodeHost} from '../../../packages/wallet-auth/src/product-session-gateway-node-host.js';
import {createCentralBrowserSessionRegistry} from '../../../packages/wallet-auth/src/central-browser-session-registry.js';
import {centralBrowserConsentSignBytes,parseCentralBrowserSignInChallenge} from '../../../packages/wallet-auth/src/central-browser-session-contract.js';
const products=JSON.parse(await readFile(new URL('../../../packages/wallet-auth/product-session-registry.json',import.meta.url))),registry=createCentralBrowserSessionRegistry(products);
const directory=await mkdtemp(join(tmpdir(),'ynx-finance-central-qa-'));await chmod(directory,0o700);
const host=new ProductSessionGatewayNodeHost(products,{statePath:join(directory,'gateway.json'),now:()=>new Date(),tokenFactory:()=>randomBytes(32).toString('base64url'),centralBrowser:true});
const handle=host.handler();let unavailable=false;
const server=createServer(async(request,response)=>{
  try{
    if(request.url==='/__qa/approve'&&request.method==='POST'){
      let body='';for await(const bytes of request){body+=bytes;if(body.length>16384)throw new Error('QA_INPUT_REJECTED')}
      const input=JSON.parse(body);if(!['A','B'].includes(input.account))throw new Error('QA_ACCOUNT_REJECTED');
      const challenge=parseCentralBrowserSignInChallenge(input.challenge,registry,{peerOrigin:'https://wallet-auth.ynxweb4.com'}),secret=(input.account==='A'?'1':'2').padStart(64,'0'),identity=walletIdentity(secret);
      const walletSignature=bytesToHex(secp256k1.sign(sha256(utf8ToBytes(centralBrowserConsentSignBytes(challenge,identity.account,identity.accountPublicKey))),hexToBytes(secret),{prehash:false,format:'compact',lowS:true}));
      response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify({challengeId:challenge.challengeId,...identity,walletSignature}));return;
    }
    if(request.url==='/__qa/unavailable'&&request.method==='POST'){unavailable=true;response.writeHead(204);response.end();return}
    if(request.url==='/__qa/available'&&request.method==='POST'){unavailable=false;response.writeHead(204);response.end();return}
    if(unavailable&&request.url?.startsWith('/v2/browser-sessions/')){response.writeHead(503,{'content-type':'application/json'});response.end('{"error":{"code":"ISOLATED_QA_UNAVAILABLE"}}');return}
    await handle(request,response);
  }catch{response.writeHead(400,{'content-type':'application/json'});response.end('{"error":{"code":"ISOLATED_QA_REJECTED"}}')}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
process.stdout.write(`FINANCE_CENTRAL_QA=http://127.0.0.1:${server.address().port}\n`);
const lifetime=setTimeout(()=>stop(),60000);let stopped=false;
async function stop(){if(stopped)return;stopped=true;clearTimeout(lifetime);await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
process.on('SIGTERM',()=>stop().then(()=>process.exit(0)));
process.on('SIGINT',()=>stop().then(()=>process.exit(0)));
