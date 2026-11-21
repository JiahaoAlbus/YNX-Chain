import test from 'node:test';import assert from 'node:assert/strict';import {ChatDrafts,ChatScope,guardChatCallbacks} from './chatScope';
test('switching conversation or session invalidates delayed stream and detail callbacks',()=>{
 const scope=new ChatScope<object>(),a={},b={};scope.setSession(a);scope.select(a,'first');const old=scope.capture(a,'first');scope.select(a,'second');assert.equal(scope.current(old),false);const next=scope.capture(a,'second');scope.setSession(b);scope.select(b,'second');assert.equal(scope.current(next),false);assert.equal(scope.select(a,'first'),false);
});
test('late provider events cannot change a different conversation or replacement session',()=>{
 const scope=new ChatScope<object>(),first={},second={},shown:string[]=[];scope.setSession(first);scope.select(first,'one');const token=scope.capture(first,'one');const callbacks=guardChatCallbacks(()=>scope.current(token),{onMetadata:()=>shown.push('metadata'),onToken:s=>shown.push(s),onDone:()=>shown.push('done'),onError:()=>shown.push('error')});
 callbacks.onToken('original');scope.select(first,'two');callbacks.onToken('foreign');callbacks.onDone(null);scope.setSession(second);scope.select(second,'one');callbacks.onError(Error('old'));assert.deepEqual(shown,['original']);
});
test('only latest list result from the unchanged session and selection may be shown',()=>{
 const scope=new ChatScope<object>(),a={};scope.setSession(a);const first=scope.captureList(a),second=scope.captureList(a);assert.equal(scope.currentList(first),false);assert.equal(scope.currentList(second),true);scope.select(a,'original');assert.equal(scope.currentList(second),false);
});
test('a late list request from a retired session cannot invalidate the current session request',()=>{const scope=new ChatScope<object>(),old={},current={};scope.setSession(old);scope.setSession(current);const fresh=scope.captureList(current),late=scope.captureList(old);assert.equal(scope.currentList(late),false);assert.equal(scope.currentList(fresh),true)});
test('unsent drafts stay with their original conversation and session',()=>{const a={},b={},drafts=new ChatDrafts<object>();drafts.put(a,'one','private one');drafts.put(a,'two','private two');assert.equal(drafts.get(a,'one'),'private one');assert.equal(drafts.get(a,'two'),'private two');assert.equal(drafts.get(b,'one'),'')});
