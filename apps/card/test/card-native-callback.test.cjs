const test=require('node:test'),assert=require('node:assert/strict');
const {makeMounted,makeController,deferred,url,connecting,rejected,act,tick}=require('./card-native-callback-fixture.cjs');
const connected={sessionState:{status:'connected',session:{account:'ynx1'+'a'.repeat(38),sessionBinding:'synthetic observer binding',expiresAt:'2099-01-01T00:00:00Z'}}};
// These outcomes are inert SDK observations. They do not claim signature validity or an installed login.
test('cold initial URL enters existing-only verification without automatically beginning',async t=>{
 let factories=0,returns=0,begins=0;
 const app=await makeMounted(async input=>{factories++;assert.equal(input.existingDeviceOnly,true);return makeController({handleReturn:async original=>{assert.equal(original,url);returns++;return rejected},beginYNX:async()=>{begins++;return connecting}})},{initialURL:url});t.after(()=>app.unmount());
 assert.equal(factories,1);assert.equal(returns,1);assert.equal(begins,0);
});
test('Close then new Begin: older cold factory cannot replace new pending state',async t=>{
 const old=deferred();const app=await makeMounted(async input=>input.existingDeviceOnly?old.promise:makeController(),{initialURL:url});t.after(()=>app.unmount());
 await app.mutate(()=>app.props.closeWalletChooser());await app.mutate(()=>app.props.connectYNXWallet());assert.equal(app.props.nativeAuthorizationPending,true);
 const writes=app.metrics.stateWrites;await app.mutate(()=>old.resolve(makeController()));assert.equal(app.metrics.stateWrites,writes);assert.equal(app.props.nativeAuthorizationPending,true);assert.equal(app.props.privateSession,null);
});
test('overlapping cold factories: old error cannot overwrite newer callback outcome',async t=>{
 const old=deferred();let factories=0;const app=await makeMounted(async()=>++factories===1?old.promise:makeController({handleReturn:async()=>connected}),{initialURL:url});t.after(()=>app.unmount());
 await app.event(url);assert.equal(app.props.privateSession.state,'PRIVATE_SESSION_V2_CONNECTED_SOURCE_ONLY');const writes=app.metrics.stateWrites;
 await app.mutate(()=>old.resolve(makeController()));assert.equal(app.metrics.stateWrites,writes);assert.equal(app.props.privateSession.state,'PRIVATE_SESSION_V2_CONNECTED_SOURCE_ONLY');
});
test('published controller retains actual serial ordering for overlapping callbacks',async t=>{
 const old=deferred();let returns=0;const app=await makeMounted(async()=>makeController({handleReturn:async()=>++returns===1?old.promise:connected}),{initialURL:url});t.after(()=>app.unmount());
 await app.event(url);assert.equal(returns,1);assert.equal(app.props.privateSession,null);
 await app.mutate(()=>old.reject(Error('old synthetic verifier rejected')));assert.equal(returns,2);assert.equal(app.props.privateSession.state,'PRIVATE_SESSION_V2_CONNECTED_SOURCE_ONLY');
});
test('saved locale/session rerender does not clean up the callback listener',async t=>{
 const bootstrap=deferred();let returns=0;const app=await makeMounted(async()=>makeController({handleReturn:async()=>{returns++;return rejected}}),{bootstrap});t.after(()=>app.unmount());
 await app.mutate(()=>bootstrap.resolve({locale:'zh-Hans',session:{token:'synthetic session'}}));assert.equal(app.metrics.adds,1);assert.equal(app.metrics.removes,0);assert.equal(app.metrics.initialReads,1);await app.event(url);assert.equal(returns,1);
});
test('actual unmount removes the listener and blocks late factory delivery',async()=>{
 const old=deferred();let returns=0;const app=await makeMounted(async()=>old.promise,{initialURL:url});await app.unmount();await act(async()=>{old.resolve(makeController({handleReturn:async()=>{returns++;return rejected}}));await tick()});assert.equal(app.metrics.removes,1);assert.equal(app.metrics.lateStateWrites,0);assert.equal(returns,0);
});
for(const failure of [false,true])test(`old handler ${failure?'error':'success'} after Close does not clear new busy`,async t=>{
 const old=deferred(),next=deferred();let factories=0;const app=await makeMounted(async()=>++factories===1?makeController({handleReturn:async()=>old.promise}):makeController({beginYNX:async()=>next.promise}));t.after(()=>app.unmount());
 await app.mutate(()=>app.props.connectYNXWallet());await app.event(url);await app.mutate(()=>app.props.closeWalletChooser());let pending;await app.mutate(()=>{pending=app.props.connectYNXWallet()});assert.equal(app.props.walletBusy,true);const writes=app.metrics.stateWrites;
 await app.mutate(()=>failure?old.reject(Error('old failed')):old.resolve(rejected));assert.equal(app.metrics.stateWrites,writes);assert.equal(app.props.walletBusy,true);assert.equal(app.props.walletBusy,true);
 await app.mutate(()=>next.resolve(connecting));await app.mutate(()=>pending);assert.equal(app.props.nativeAuthorizationPending,true);assert.equal(app.props.privateSession,null);
});
