const test=require('node:test'),assert=require('node:assert/strict');
const {makeMounted,deferred}=require('./card-native-callback-fixture.cjs');

const disconnected={status:'disconnected'};
const connected={status:'connected',session:{account:'ynx1'+'a'.repeat(38),sessionBinding:'synthetic private session',expiresAt:'2099-01-01T00:00:00Z'}};
const web=webSession=>makeMounted(async()=>{throw Error('native factory prohibited')},{platform:'web',webSession});

test('old private approval failure cannot overwrite a later Web disconnect',async t=>{
  const first=deferred();
  const app=await web({beginCardWebSession:()=>first.promise,disconnectCardWebSession:async()=>disconnected});
  t.after(()=>app.unmount());
  let pending;
  await app.mutate(()=>{pending=app.props.enablePrivateServices()});
  assert.equal(app.props.__testBusy,true);
  await app.mutate(()=>app.props.disconnectNativeWallet());
  assert.equal(app.props.privateSession,null);
  assert.equal(app.props.__testBusy,false);
  const writes=app.metrics.stateWrites;
  await app.mutate(()=>first.reject(Error('old private approval failed')));
  await app.mutate(()=>pending);
  assert.equal(app.metrics.stateWrites,writes);
  assert.equal(app.props.privateSession,null);
  assert.equal(app.props.__testBusy,false);
});

test('old base-scope failure cannot overwrite later Finance-scope approval',async t=>{
  const base=deferred();
  const app=await web({beginCardWebSession:finance=>finance?Promise.resolve(connected):base.promise});
  t.after(()=>app.unmount());
  let old;
  await app.mutate(()=>{old=app.props.enablePrivateServices()});
  assert.equal(app.props.__testBusy,true);
  await app.mutate(()=>app.props.requestFinancePermission());
  assert.equal(app.props.privateSession?.state,'PRIVATE_SESSION_V2_CONNECTED_SOURCE_ONLY');
  assert.equal(app.props.__testBusy,false);
  const writes=app.metrics.stateWrites;
  await app.mutate(()=>base.reject(Error('old base-scope approval failed')));
  await app.mutate(()=>old);
  assert.equal(app.metrics.stateWrites,writes);
  assert.equal(app.props.privateSession?.state,'PRIVATE_SESSION_V2_CONNECTED_SOURCE_ONLY');
  assert.equal(app.props.__testBusy,false);
});
