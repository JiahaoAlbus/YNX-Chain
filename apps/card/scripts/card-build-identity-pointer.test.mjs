import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCardBuildIdentityShell} from './card-build-identity-shell.mjs';
const html='<html><head><title>Card</title></head><body><button>Start application</button></body></html>';
const identity={sourceCommit:'a'.repeat(40),appVersion:'1.0.0',releaseChannel:'qa'};
test('QA source note remains visible and semantic without intercepting product actions',()=>{
 const output=applyCardBuildIdentityShell(html,identity);
 assert.match(output,/role="note"/);assert.match(output,/pointer-events:none;/);assert.match(output,/Not the formal release/);assert.match(output,/<button>Start application<\/button>/);
 assert.ok(output.includes(identity.sourceCommit));assert.doesNotMatch(output,/tabindex=|onclick=|onpointer/);
});
test('formal Testnet shell never inserts the QA overlay',()=>{
 const output=applyCardBuildIdentityShell(html,{...identity,releaseChannel:'testnet-release'});
 assert.doesNotMatch(output,/<aside|ynx-card-qa-build|pointer-events/);assert.match(output,/<title>YNX Card \| 1.0.0<\/title>/);
});
