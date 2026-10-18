import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyWalletConnectionPage} from '../scripts/verify-wallet-connection-page.mjs';
const csp="default-src 'none'; script-src 'self'; connect-src 'self' wss://relay.walletconnect.org https://verify.walletconnect.org https://verify.walletconnect.com https://pulse.walletconnect.org; frame-src https://verify.walletconnect.org https://verify.walletconnect.com; img-src 'self' data:";
function fixture({body,cspHeader=csp,mime,redirect}={}){
 const values={'index.html':'PUBLIC HTML','walletconnect-consumer.css':'PUBLIC CSS','walletconnect-consumer.js':'PUBLIC SCRIPT'},calls=[];
 const receipt={files:Object.entries(values).map(([path,text])=>({path,bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')}))};
 const fetchImpl=async(url,options)=>{calls.push(url);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'manual');const u=new URL(url),name=u.pathname.endsWith('/')?'index.html':u.pathname.split('/').at(-1);
  if(redirect&&u.pathname==='/connect/')return new Response(null,{status:308,headers:{location:redirect}});
  return new Response(body??values[name],{status:200,headers:{'content-type':mime??(name==='index.html'?'text/html':name?.endsWith('.css')?'text/css':'application/javascript'),'content-security-policy':cspHeader}});
 };return {receipt,fetchImpl,calls};
}
test('read-only delivery gate checks exact three bytes and CSP without claiming session or GUI',async()=>{
 const f=fixture(),result=await verifyWalletConnectionPage(f.receipt,f);assert.equal(result.files.length,3);assert.equal(result.RelayVerified,false);assert.equal(result.permissionGranted,false);assert.equal(result.GUIVerified,false);assert.equal(f.calls.length,3);
});
test('HTTP200 homepage fallback or wrong MIME is not a working deployed connection page',async()=>{
 for(const patch of [{body:'WRONG HTML!'},{mime:'application/octet-stream'}]){const f=fixture(patch);await assert.rejects(verifyWalletConnectionPage(f.receipt,f),/WALLET_CONNECT_(ASSET|MIME)_/);}
});
test('another policy cannot silently deny the verification frame or expand scripts',async()=>{
 for(const cspHeader of [csp+", default-src 'none'; frame-src 'none'",csp.replace("script-src 'self'","script-src 'self' 'unsafe-inline'")]){const f=fixture({cspHeader});await assert.rejects(verifyWalletConnectionPage(f.receipt,f),/WALLET_CONNECT_HTTP_CSP_DIFFERS/);}
});
test('canonical index redirect is accepted but foreign or no-slash document bases are rejected',async()=>{
 const f=fixture({redirect:'/connect/index.html'});assert.equal((await verifyWalletConnectionPage(f.receipt,f)).files.length,3);
 for(const redirect of ['https://foreign.invalid/connect/','/connect','/hosted/']){const f=fixture({redirect});await assert.rejects(verifyWalletConnectionPage(f.receipt,f),/WALLET_CONNECT_REDIRECT_INVALID/);}
});
test('receipt cannot redirect the verifier to an arbitrary path or duplicate a leaf',async()=>{
 const f=fixture();f.receipt.files[1].path='../hosted/';await assert.rejects(verifyWalletConnectionPage(f.receipt,f),/WALLET_CONNECT_RECEIPT_INVALID/);assert.equal(f.calls.length,0);
});
