import test,{mock}from'node:test';import assert from'node:assert/strict';import{sha,canonical}from'../native/original-auth-identity-source-verifier.mjs';
await test('PUBLIC actual normal loader preserves acquisition discriminant and SAME partial for falsy failures',async()=>{
 const entry={PUBLIC:'fixed approved entry seam'},partial={publisherReference:{PUBLIC:'same'},keyOwner:{PUBLIC:'debt'}},owner={publishOnce(){},querySameOriginal(){},drain(){},status(){}};let action;
 const row={loaderEntry:entry,loaderEntryDigest:sha(canonical(entry))};
 const selection=mock.module(new URL('../native/original-network-current-publisher-selection-private.mjs',import.meta.url).href,{namedExports:{originalNetworkCurrentPublisherRows:[row]}});
 const source=mock.module(new URL('../src/original-auth-source-current-v2.js',import.meta.url).href,{namedExports:{async loadOriginalNetworkCurrentPublisherSelectedKeysV1(actual){assert.equal(actual,entry);return action();}}});
 try{const {acquireOriginalNetworkResourceCurrentPublisherNormalV1:acquire}=await import('../native/original-network-current-publisher-loader-private.mjs?PUBLIC-falsy');
 for(const value of [null,undefined,false,0]){action=()=>({partial,error:value,errorPresent:true});const r=await acquire();assert.equal(r.errorPresent,true);assert.equal(r.error,value);assert.equal(r.owner,partial);action=()=>{throw value;};const t=await acquire();assert.equal(t.errorPresent,true);assert.equal(t.error,value);assert.equal(t.owner,null);}
 action=()=>owner;const r=await acquire();assert.equal(r.errorPresent,false);assert.equal(r.error,null);assert.equal(r.owner,owner);await assert.rejects(acquire({}),{code:'NETWORK_CURRENT_ZERO_INPUT'});
 }finally{source.restore();selection.restore();}
});
