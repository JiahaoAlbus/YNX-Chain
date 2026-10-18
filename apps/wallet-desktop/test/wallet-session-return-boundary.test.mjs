import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {assertSessionReturnTransport} from '../src/wallet-session-return-boundary.mjs';

test('session transport budget counts UTF-8 bytes with no hidden oversized fallback',()=>{
 for(const value of ['a'.repeat(4096),'中'.repeat(1365)+'a'])assert.equal(assertSessionReturnTransport(value),value);
 for(const value of ['',null,{},'a'.repeat(4097),'中'.repeat(1366)])assert.throws(()=>assertSessionReturnTransport(value),e=>e.code==='SESSION_REFERENCE_RETURN_REQUIRED');
});
test('actual renderer distinguishes missing reference service from needing another unlock',async()=>{
 const source=await readFile(new URL('../src/renderer.js',import.meta.url),'utf8'),start=source.indexOf('function authorizationErrorText('),end=source.indexOf('\nfunction presentApproval(',start),context={};
 runInNewContext(source.slice(start,end),context);
 const input={underlyingCode:'SESSION_REFERENCE_RETURN_REQUIRED',sessionOriginal:{signed:true,storageConfirmed:true,cleanupComplete:true}};
 assert.match(context.authorizationErrorText(input),/Unlocking again will not fix/);
 assert.match(context.authorizationErrorText({...input,callbackOutcomeUnknown:true}),/outcome is unknown/);
 assert.match(context.authorizationErrorText({...input,sessionOriginal:{...input.sessionOriginal,storageConfirmed:false}}),/storage\/cleanup is unresolved/);
});
