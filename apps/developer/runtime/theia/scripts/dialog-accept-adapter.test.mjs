import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const {acceptCurrentDialog}=createRequire(import.meta.url)('../../ynx-workbench/lib/dialog-accept-adapter.js');
class CancellationTokenSource{constructor(){this.token={isCancellationRequested:false};}cancel(){this.token.isCancellationRequested=true;}}
const DialogError={getResult:error=>error===true},Widget={detach:dialog=>{dialog.detached++;dialog.resolve=undefined;}};
function fixture(){let finish;const result=new Promise(resolve=>finish=resolve);const returned=[],dialog={resolve:value=>returned.push(value),value:'reviewed',acceptCancellationSource:new CancellationTokenSource(),isValid:()=>result,setErrorMessage:error=>dialog.error=error,detached:0};return{dialog,finish,returned};}
test('canceling while validation is pending retires its result instead of calling a cleared resolver',async()=>{
 const h=fixture();const pending=acceptCurrentDialog.call(h.dialog,CancellationTokenSource,DialogError,Widget);h.dialog.resolve=undefined;h.finish(true);await pending;assert.deepEqual(h.returned,[]);assert.equal(h.dialog.detached,0);
 // Causal negative control: the inherited accept sequence calls the resolver
 // after its await with no still-open check, reproducing the observed error.
 const old=fixture();const unguarded=(async()=>{await old.dialog.isValid();old.dialog.resolve(old.dialog.value);})();old.dialog.resolve=undefined;old.finish(true);await assert.rejects(unguarded,/resolve is not a function/);
});
test('old validation cannot settle or detach a reopened dialog; current invalid/valid checks retain behavior',async()=>{
 const stale=fixture();const pending=acceptCurrentDialog.call(stale.dialog,CancellationTokenSource,DialogError,Widget);const newValues=[];stale.dialog.resolve=value=>newValues.push(value);stale.finish(true);await pending;assert.deepEqual(newValues,[]);assert.equal(stale.dialog.detached,0);
 const invalid=fixture();const failed=acceptCurrentDialog.call(invalid.dialog,CancellationTokenSource,DialogError,Widget);invalid.finish('Not valid');await failed;assert.equal(invalid.dialog.error,'Not valid');assert.deepEqual(invalid.returned,[]);
 const valid=fixture();const accepted=acceptCurrentDialog.call(valid.dialog,CancellationTokenSource,DialogError,Widget);valid.finish(true);await accepted;assert.deepEqual(valid.returned,['reviewed']);assert.equal(valid.dialog.detached,1);
});
