import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Exact SDK39/Core2.23.10 source-derived route policy, not network evidence.
const html=readFileSync(new URL('../web-connect/index.html',import.meta.url),'utf8');
const policy=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
const directives=new Map(policy?.split(';').map(part=>part.trim().split(/\s+/)).filter(row=>row[0]).map(([key,...values])=>[key,values]));
test('first-party connection page permits only exact SDK39 relay, verification and default event endpoints',()=>{
 assert.deepEqual(new Set(directives.get('connect-src')),new Set(["'self'",'wss://relay.walletconnect.org','https://verify.walletconnect.org','https://verify.walletconnect.com','https://pulse.walletconnect.org']));
 assert.deepEqual(new Set(directives.get('frame-src')),new Set(['https://verify.walletconnect.org','https://verify.walletconnect.com']));
});
test('connection policy retains local scripts, local QR images and no inline/eval/wildcard or external base',()=>{
 assert.deepEqual(directives.get('default-src'),["'none'"]);assert.deepEqual(directives.get('script-src'),["'self'"]);
 assert.deepEqual(directives.get('img-src'),["'self'",'data:']);assert.deepEqual(directives.get('base-uri'),["'none'"]);assert.deepEqual(directives.get('form-action'),["'none'"]);
 assert.equal(/unsafe-inline|unsafe-eval|\*/.test(policy),false);
});
