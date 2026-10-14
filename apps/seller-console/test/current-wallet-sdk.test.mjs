import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {prepareCurrentWalletSDK,CURRENT_WALLET_SDK} from '../scripts/current-wallet-sdk.mjs';

const app=fileURLToPath(new URL('..',import.meta.url));
const selected=await prepareCurrentWalletSDK({dependencies:resolve(app,'node_modules')});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const registry=JSON.parse(await readFile(new URL('../product-session-registry.json',import.meta.url),'utf8'));

test('legacy same-version archive cannot be selected as current R9',async()=>{
    await assert.rejects(prepareCurrentWalletSDK({archive:fileURLToPath(new URL('../vendor/ynx-chain-wallet-auth-1.2.0.tgz',import.meta.url))}),/does not match current R9/);
});

test('all product SDK imports resolve to one supplied copy, never installed legacy SDK',async()=>{
    let resolveSDK;
    selected.buildOptions.plugins[0].setup({onResolve(_options,callback){resolveSDK=callback}});
    for(const name of ['@ynx-chain/wallet-auth','@ynx-chain/wallet-auth/standard-wallet-connection','@ynx-chain/wallet-auth/wallet-provider-discovery','@ynx-chain/wallet-auth/product-wallet-connection','@ynx-chain/wallet-auth/product-session-native']){
        const {path}=resolveSDK({path:name});
        assert.ok(path.startsWith(selected.root+'/'));assert.ok((await readFile(path)).length>0);
    }
    assert.throws(()=>resolveSDK({path:'@ynx-chain/wallet-auth/not-an-export'}),/Unexported/);
    assert.equal(CURRENT_WALLET_SDK.sourceHead,'2689bece12fddd991c2ecd7a024f6aa4e8b1afbd');
});

test('normal module selection retains current R7 coordinator and R8 recovery bytes',async()=>{
    assert.equal(digest(await readFile(selected.entry('./wallet-connection-coordinator'))),'b757fb45c464dfe74aa763e5c87a941ac2e65d4809f1aa62ee055890b9cad674');
    assert.equal(digest(await readFile(resolve(selected.root,'src/product-session-recovery.js'))),'e80eeb44d78d0b91f67c18c8593bea4be89235eef20b3e7b66c664d2b4555b8b');
});

test('real browser consumer uses current constructor and refuses missing private resources',async()=>{
    // Resolve the actual production caller's bare imports exactly as its build plugin.
    const hook=registerHooks({resolve(specifier,context,next){
        if(specifier==='@ynx-chain/wallet-auth'||specifier.startsWith('@ynx-chain/wallet-auth/')){
            const subpath=specifier==='@ynx-chain/wallet-auth'?'.':'./'+specifier.slice('@ynx-chain/wallet-auth/'.length);
            return {url:pathToFileURL(selected.entry(subpath)).href,shortCircuit:true};
        }
        return next(specifier,context);
    }});
    try {
        const {createPrivateSessionController}=await import('../product-session.js');
        const sdk=await import(pathToFileURL(selected.entry('.')).href);
        assert.equal(typeof sdk.createBrowserProductSessionClient,'function');
        const environment={isSecureContext:true,location:{origin:'https://shop.ynxweb4.com',href:'https://shop.ynxweb4.com/seller/'},crypto:globalThis.crypto,indexedDB:null,fetch:async()=>{throw Error('No network in SDK input check')}};
        const options={productId:'shop',scopes:['account:read','shop:seller:operate'],purpose:'Use my original seller records',environment};
        const unavailable=createPrivateSessionController({...options,endpoint:()=>null});
        await assert.rejects(unavailable.begin(),/Gateway is unavailable/);assert.equal(unavailable.current(),null);
        const insecure=createPrivateSessionController({...options,endpoint:()=> 'https://wallet-auth.ynxweb4.com'});
        await assert.rejects(insecure.begin(),error=>error.code==='INSECURE_STORAGE');assert.equal(insecure.current(),null);
        const foreign=createPrivateSessionController({...options,environment:{...environment,location:{origin:'https://commerce-preview.ynxweb4.com'}},endpoint:()=> 'https://wallet-auth.ynxweb4.com'});
        await assert.rejects(foreign.begin(),error=>error.code==='ORIGIN_NOT_ALLOWED');assert.equal(foreign.current(),null);
    } finally {hook.deregister()}
});

test('official Native constructor stays separate and requires real protected ports',async()=>{
    const {createNativeProductSessionClient}=await import(pathToFileURL(selected.entry('./product-session-native')).href);
    const {ProductSessionGatewayFetchAdapter}=await import(pathToFileURL(selected.entry('.')).href);
    let network=0;
    const gateway=new ProductSessionGatewayFetchAdapter({endpoint:'https://wallet-auth.ynxweb4.com',fetch:async()=>{network++;throw Error('No network in Native intake')},walletInstalled:()=>false,schemeRegistered:()=>false,timeoutMs:1000});
    for(const platform of ['android','macos'])await assert.rejects(createNativeProductSessionClient({registry,productId:'shop',platform,scopes:['account:read','shop:orders:write','shop:profile:write'],purpose:'Use my original Shop records',gateway,runtime:null,clock:()=>new Date()}),error=>error.code==='INVALID_DEVICE');
    assert.equal(network,0);
});
