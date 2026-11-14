import test from 'node:test';import assert from 'node:assert/strict';
import {assertCurrentColdCompletion} from './adopt-current-product-build.mjs';
const source='a'.repeat(40),stages=['original-cold-Node53-strict55-and-canonical-completion','current-P03-main.m','current-P03-ynx-wallet-admission-parent.m','strict-current-Cocoa-link','original-fresh-helper13-owned-U0'];
const valid=()=>({complete:true,source:{commit:source},results:stages.map(name=>({name,status:0,signal:null}))});
test('failed Cocoa after successful Node cannot be adopted as a complete product build',()=>{
 const failed=valid();failed.complete=false;failed.results=failed.results.slice(0,-1);failed.results.at(-1).status=1;
 assert.throws(()=>assertCurrentColdCompletion(failed,source),/reconcile existing failure/);
});
test('all same-source required stages complete without signals or duplicate callbacks',()=>{
 assert.doesNotThrow(()=>assertCurrentColdCompletion(valid(),source));
 for(const mutate of [r=>r.source.commit='b'.repeat(40),r=>r.results.at(-1).signal='SIGTERM',r=>r.results.pop(),r=>r.results.splice(3,1),r=>r.results.push(r.results.at(-1)),r=>r.results=[]]){const r=valid();mutate(r);assert.throws(()=>assertCurrentColdCompletion(r,source));}
});
