const test=require('node:test'),assert=require('node:assert/strict');
const {makeMounted,deferred}=require('./card-native-callback-fixture.cjs');
const account='0x'+'a'.repeat(40),other='0x'+'b'.repeat(40);
const approved={status:'connected',account,chainId:'0x1917',error:null};

test('actual Card Web YNX action opens Hosted synchronously and publishes only approved account',async t=>{
  const approval=deferred();let opens=0,disconnects=0,notify;
  const app=await makeMounted(async()=>{throw Error('native factory prohibited')},{platform:'web',hostedFactory:({onState})=>{
    notify=onState;return {connect(){opens++;return approval.promise},disconnect:async()=>{disconnects++;notify({status:'disconnected',account:null,chainId:null,error:null})},getState:()=>({status:'disconnected'})};
  }});t.after(()=>app.unmount());
  let pending;await app.mutate(()=>{pending=app.props.connectYNXWallet()});
  assert.equal(opens,1);assert.equal(app.props.walletSession,null);
  await app.mutate(()=>approval.resolve(approved));await app.mutate(()=>pending);
  assert.equal(app.props.walletSession.address,account);assert.equal(app.props.standardWalletState.status,'connected');assert.equal(app.props.standardWalletState.chooserOpen,false);assert.equal(app.props.hostedWalletConnected,true);assert.equal(app.props.privateSession,null);
  await app.mutate(()=>notify({status:'disconnected',account:null,chainId:null,error:'HOSTED_ACCOUNT_CHANGED'}));
  assert.equal(app.props.walletSession,null);assert.equal(app.props.privateSession,null);assert.equal(app.props.walletError,'en:accountChanged');
  assert.ok(disconnects>=0);
});

test('actual Card Web rejection and explicit disconnect never become approval',async t=>{
  const approval=deferred();let opens=0;
  const app=await makeMounted(async()=>{throw Error('native factory prohibited')},{platform:'web',hostedFactory:()=>({connect(){opens++;return approval.promise},disconnect:async()=>{},getState:()=>({status:'disconnected'})})});t.after(()=>app.unmount());
  let pending;await app.mutate(()=>{pending=app.props.connectYNXWallet()});assert.equal(opens,1);
  await app.mutate(()=>approval.resolve({status:'rejected',account:null,chainId:null,error:'USER_REJECTED'}));await app.mutate(()=>pending);
  assert.equal(app.props.walletSession,null);assert.equal(app.props.walletError,'en:rejected');
  await app.mutate(()=>app.props.disconnectWallet());assert.equal(app.props.walletSession,null);
});

test('actual Card Web account switch requests a new popup in the same action and drops old subject',async t=>{
  const next=deferred();let opens=0;
  const app=await makeMounted(async()=>{throw Error('native factory prohibited')},{platform:'web',hostedFactory:()=>({connect(){opens++;return opens===1?Promise.resolve(approved):next.promise},disconnect:async()=>{},getState:()=>({status:'disconnected'})})});t.after(()=>app.unmount());
  await app.mutate(()=>app.props.connectYNXWallet());assert.equal(app.props.walletSession.address,account);
  let switching;await app.mutate(()=>{switching=app.props.switchWalletAccount()});assert.equal(opens,2);assert.equal(app.props.walletSession,null);
  await app.mutate(()=>next.resolve({status:'connected',account:other,chainId:'0x1917',error:null}));await app.mutate(()=>switching);
  assert.equal(app.props.walletSession.address,other);assert.equal(app.props.standardWalletState.account,other);
});

test('failed MetaMask choice after Hosted closes old subject instead of retaining a fake Card account',async t=>{
  let disconnected=0;
  const app=await makeMounted(async()=>{throw Error('native factory prohibited')},{platform:'web',hostedFactory:()=>({connect:()=>Promise.resolve(approved),disconnect:async()=>{disconnected++},getState:()=>({status:'disconnected'})})});t.after(()=>app.unmount());
  await app.mutate(()=>app.props.connectYNXWallet());assert.equal(app.props.walletSession.address,account);
  await app.mutate(()=>app.props.connectMetaMaskWallet());
  assert.ok(disconnected>=1);assert.equal(app.props.walletSession,null);assert.equal(app.props.privateSession,null);assert.notEqual(app.props.standardWalletState.status,'connected');
});

test('late Hosted approval after explicit MetaMask choice cannot resurrect the old YNX subject',async t=>{
  const approval=deferred();
  const app=await makeMounted(async()=>{throw Error('native factory prohibited')},{platform:'web',hostedFactory:()=>({connect:()=>approval.promise,disconnect:async()=>{},getState:()=>({status:'disconnected'})})});t.after(()=>app.unmount());
  let old;await app.mutate(()=>{old=app.props.connectYNXWallet()});
  await app.mutate(()=>app.props.connectMetaMaskWallet());
  await app.mutate(()=>approval.resolve(approved));await app.mutate(()=>old);
  assert.equal(app.props.walletSession,null);assert.notEqual(app.props.standardWalletState.status,'connected');assert.equal(app.props.privateSession,null);
});

test('standard identity switch invalidates private Card proof use before revocation readback',async t=>{
  const revocation=deferred();let disconnects=0;
  const app=await makeMounted(async()=>{throw Error('native factory prohibited')},{platform:'web',webSession:{beginCardWebSession:async()=>({status:'connected',session:{account:'ynx1'+'a'.repeat(38),sessionBinding:'synthetic private binding',expiresAt:'2099-01-01T00:00:00Z'}}),disconnectCardWebSession:()=>{disconnects++;return revocation.promise}},hostedFactory:()=>({connect:()=>Promise.resolve(approved),disconnect:async()=>{},getState:()=>({status:'disconnected'})})});t.after(()=>app.unmount());
  await app.mutate(()=>app.props.enablePrivateServices());
  assert.equal(app.props.privateSession?.state,'PRIVATE_SESSION_V2_CONNECTED_SOURCE_ONLY');
  await app.mutate(()=>app.props.connectYNXWallet());
  assert.equal(disconnects,1);assert.equal(app.props.privateSession,null);assert.equal(app.props.providerClient,null);assert.equal(app.props.walletSession.address,account);
  await app.mutate(()=>revocation.resolve({status:'revocation-pending'}));
  assert.equal(app.props.walletSession.address,account);assert.equal(app.props.standardWalletState.status,'connected');
  assert.equal(app.props.privateSession?.state,'PRIVATE_SERVICE_DEGRADED');
});
