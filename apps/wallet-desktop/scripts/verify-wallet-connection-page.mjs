import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const ORIGIN='https://wallet.ynxweb4.com';
const assets=new Map([['index.html','text/html'],['walletconnect-consumer.css','text/css'],['walletconnect-consumer.js','javascript']]);
const fail=code=>{throw Error(code);};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function checkCsp(header){
 if(typeof header!=='string'||!header.trim())fail('WALLET_CONNECT_HTTP_CSP_MISSING');
 const expected={"default-src":["'none'"],"script-src":["'self'"],"connect-src":["'self'",'wss://relay.walletconnect.org','https://verify.walletconnect.org','https://verify.walletconnect.com','https://pulse.walletconnect.org'],"frame-src":['https://verify.walletconnect.org','https://verify.walletconnect.com'],"img-src":["'self'",'data:']};
 // Multiple response policies intersect. Every policy must permit the normal
 // inputs; a second frame-src none must not disappear behind the last value.
 for(const policy of header.split(',')){
  const directives=new Map();for(const part of policy.split(';')){const [key,...values]=part.trim().split(/\s+/);if(key&&!directives.has(key.toLowerCase()))directives.set(key.toLowerCase(),values);}
  for(const [key,values]of Object.entries(expected)){const actual=directives.get(key)??directives.get('default-src')??[];if(actual.length!==values.length||values.some(value=>!actual.includes(value)))fail('WALLET_CONNECT_HTTP_CSP_DIFFERS:'+key);}
 }
}
async function boundedBytes(response,expected){
 const reader=response.body?.getReader();if(!reader)fail('WALLET_CONNECT_BODY_MISSING');
 const chunks=[];let count=0;try{while(true){const {done,value}=await reader.read();if(done)break;count+=value.byteLength;if(count>expected){await reader.cancel();fail('WALLET_CONNECT_ASSET_SIZE_DIFFERS');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
 if(count!==expected)fail('WALLET_CONNECT_ASSET_SIZE_DIFFERS');return Buffer.concat(chunks);
}
/** Read-only public release gate, not a browser, Relay or permission test.
 * The transport seam is for unit controls only; the CLI always uses fetch. */
export async function verifyWalletConnectionPage(receipt,{fetchImpl=fetch}={}){
 if(!Array.isArray(receipt?.files)||receipt.files.length!==3)fail('WALLET_CONNECT_RECEIPT_INVALID');
 const rows=new Map();for(const row of receipt.files){if(!assets.has(row.path)||rows.has(row.path)||!Number.isSafeInteger(row.bytes)||row.bytes<1||row.bytes>8*1024*1024||! /^[0-9a-f]{64}$/.test(row.sha256))fail('WALLET_CONNECT_RECEIPT_INVALID');rows.set(row.path,row);}
 if(rows.size!==3)fail('WALLET_CONNECT_RECEIPT_INVALID');
 async function request(url,isDocument){
  let current=new URL(url);for(let hops=0;hops<3;hops++){
   const response=await fetchImpl(current.href,{method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(10000)});
   if([301,302,303,307,308].includes(response.status)){
    const location=response.headers.get('location');if(!location)fail('WALLET_CONNECT_REDIRECT_INVALID');const next=new URL(location,current);
    const allowed=isDocument?['/connect/','/connect/index.html']:[current.pathname];
    if(next.origin!==ORIGIN||next.username||next.password||next.search||next.hash||!allowed.includes(next.pathname))fail('WALLET_CONNECT_REDIRECT_INVALID');
    await response.body?.cancel();current=next;continue;
   }
   if(response.status!==200)fail('WALLET_CONNECT_HTTP_STATUS:'+response.status);
   return {response,url:current};
  }fail('WALLET_CONNECT_REDIRECT_LIMIT');
 }
 const document=await request(ORIGIN+'/connect/',true);const verified=[];
 for(const [name,mime]of assets){
  const url=name==='index.html'?document.url:new URL('./'+name,document.url);
  if(name!=='index.html'&&url.pathname!=='/connect/'+name)fail('WALLET_CONNECT_DOCUMENT_BASE_CHANGED');
  const {response}=name==='index.html'?document:await request(url.href,false),type=response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if(mime==='javascript'?!['text/javascript','application/javascript'].includes(type):type!==mime)fail('WALLET_CONNECT_MIME_DIFFERS:'+name);
  const row=rows.get(name),bytes=await boundedBytes(response,row.bytes);if(sha(bytes)!==row.sha256)fail('WALLET_CONNECT_ASSET_HASH_DIFFERS:'+name);
  if(name==='index.html')checkCsp(response.headers.get('content-security-policy'));
  verified.push({path:name,bytes:row.bytes,sha256:row.sha256});
 }
 return Object.freeze({state:'PUBLIC_BYTES_AND_HTTP_CSP_VERIFIED_NOT_GUI_OR_RELAY',origin:ORIGIN,route:'/connect/',files:verified,credentialSent:false,sessionCreated:false,GUIVerified:false,RelayVerified:false,permissionGranted:false});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [receipt,...extra]=process.argv.slice(2);if(!receipt||!path.isAbsolute(receipt)||extra.length)fail('USAGE: verify-wallet-connection-page.mjs ABSOLUTE_BUILD_RECEIPT');
 console.log(JSON.stringify(await verifyWalletConnectionPage(JSON.parse(await readFile(receipt,'utf8')))));
}
