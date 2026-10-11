import { FixtureIntentStore } from "./fixture-intent-store.mjs";
import { fixtureEVMCapabilities } from "./fixture-evm-capabilities.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { Transaction, Wallet, toQuantity } from "ethers";
import { CanonicalTransactionSender } from "../src/canonical-transaction-sender.mjs";
import { CanonicalAccountNetwork, NativeWalletService } from "../src/native-wallet-service.mjs";
import {DesktopKeyLifecycle} from "../src/key-lifecycle.mjs";
import {PermissionEpoch,bindPermissionGuard} from "../src/permission-lease.mjs";
import {mkdtemp,readFile,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {FileTransactionIntentStore} from "../src/transaction-intent-store.mjs";
import {TransactionSubmissions} from "../src/transaction-submissions.mjs";
import {parseFeeModel} from "../src/rpc-capabilities.mjs";

// Public scalar-one fixture. All RPC calls are simulated; no network or real funds.
const wallet = new Wallet(`0x${"1".padStart(64, "0")}`);
const account = wallet.address.toLowerCase();
const recipient = `0x${"22".repeat(20)}`;
const input = () => ({ from: account, to: recipient, value: "0x1", data: "0x1234" });
async function r5HeldNative(t){
 const f=fixture(t),directory=await mkdtemp(join(tmpdir(),'ynx-r5-save-')),filePath=join(directory,'journal.json'),store=new FileTransactionIntentStore({filePath});f.sender.submissions.intentStore=store;
 const proof=JSON.parse(await readFile(new URL('./fixtures/transaction-durability/native-json-contract-fixture.json',import.meta.url),'utf8'));
 const caps=parseFeeModel({version:'ynx-ethereum-native-v1',enabled:true,chainId:'0x1917',transactionType:'0x0',feeYNXT:'1',feeWei:'0xde0b6b3a7640000',gas:'0x61a8',gasPrice:'0x246139ca8000',decimals:18,amountQuantumWei:'0xde0b6b3a7640000',scope:'whole-YNXT plain native transfers',fullEVM:false,eip1559:false,durability:proof.capability});
 const tx={from:account,to:recipient,value:'0xde0b6b3a7640000',chainId:'0x1917',nonce:'0x0',type:0,gasLimit:'0x61a8',gasPrice:caps.gasPrice,data:'0x'};
 // Public fixture creation is not a production signer invocation. Counters
 // below cover the save operation itself, which never calls any producer.
 const raw=await wallet.signTransaction({...tx,from:undefined,nonce:0});await store.reserveOriginal(account,'native');f.sender.submissions.retainOriginal(raw,tx,caps);
 return {...f,store,filePath,raw,hash:Transaction.from(raw).hash,guard:{account,assert(){}}};
}
test('r5 actual native save-only owner publishes exact original and cold readback with zero effects',async t=>{
 const f=await r5HeldNative(t),sub=f.sender.submissions;const saved=await sub.saveOriginal(f.hash,account,f.guard);
 assert.deepEqual(saved,{account,hash:f.hash,savedLocally:true,submitted:false,confirmed:false});assert.equal(f.store.localOriginal(account),null);
 const cold=new FileTransactionIntentStore({filePath:f.filePath});assert.equal((await cold.snapshot())[0].raw,f.raw);const before=await readFile(f.filePath,'utf8');await sub.saveOriginal(f.hash,account,f.guard);assert.equal(await readFile(f.filePath,'utf8'),before);
 assert.equal((await sub.list(account))[0].canRetryExact,false);await assert.rejects(sub.retry(f.hash,account,f.guard));assert.equal(f.state.signs,0);assert.equal(f.state.broadcasts,0);assert.deepEqual(f.state.calls,[]);
});
for(const boundary of ['locked-before','locked-after-write','ack','before-write','readback'])test(`r5 native save-only ${boundary} retains original and never sends`,async t=>{
 const f=await r5HeldNative(t),replace=f.store.filePolicy.replace.bind(f.store.filePolicy);let live=boundary!=='locked-before';const guard={account,assert(){if(!live)throw Error('QA_SAVE_LOCK')}};
 f.store.filePolicy.replace=async(...args)=>{if(boundary==='before-write')throw Error('QA_SAVE_DISK');await replace(...args);if(boundary==='locked-after-write')live=false;if(boundary==='ack')throw Error('QA_SAVE_ACK')};
 const snapshot=f.store.snapshot.bind(f.store),available=f.store.filePolicy.available.bind(f.store.filePolicy);let replaced=false;if(boundary==='readback'){f.store.filePolicy.replace=async(...args)=>{await replace(...args);replaced=true};f.store.filePolicy.available=async p=>{if(replaced&&p===f.filePath)throw Error('QA_SAVE_READBACK');return available(p)}}
 await assert.rejects(f.sender.submissions.saveOriginal(f.hash,account,guard));assert.equal(f.store.localOriginal(account).native.raw,f.raw);
 live=true;f.store.filePolicy.replace=replace;f.store.filePolicy.available=available;
 await f.sender.submissions.saveOriginal(f.hash,account,guard);assert.equal(f.store.localOriginal(account),null);assert.equal((await snapshot())[0].raw,f.raw);
 assert.equal(f.state.signs,0);assert.equal(f.state.broadcasts,0);assert.deepEqual(f.state.calls,[]);
});
test('r5 native duplicate save is serialized and hostile binding has no effect',async t=>{
 const f=await r5HeldNative(t);await assert.rejects(f.sender.submissions.saveOriginal(f.hash,'0x'+'3'.repeat(40),f.guard));await assert.rejects(f.sender.submissions.saveOriginal({raw:f.raw},account,f.guard));
 const replace=f.store.filePolicy.replace.bind(f.store.filePolicy),entered=Promise.withResolvers(),resume=Promise.withResolvers();f.store.filePolicy.replace=async(...args)=>{entered.resolve();await resume.promise;return replace(...args)};
 const first=f.sender.submissions.saveOriginal(f.hash,account,f.guard);await entered.promise;await assert.rejects(f.sender.submissions.saveOriginal(f.hash,account,f.guard));resume.resolve();await first;
 assert.equal((await f.store.snapshot())[0].attempts,1);assert.equal(f.state.signs,0);assert.equal(f.state.broadcasts,0);assert.deepEqual(f.state.calls,[]);
});
for(const schemaVersion of [1,2,5])test(`r6 cold schema${schemaVersion} no-raw original cannot acknowledge save`,async t=>{
 const f=await r5HeldNative(t),held=f.store.localOriginal(account).native;
 const legacy={account,chainId:held.transaction.chainId,nonce:held.transaction.nonce,hash:f.hash,to:held.transaction.to,value:held.transaction.value,capabilities:held.capabilities,attempts:1};
 const intent=schemaVersion===1?legacy:{...legacy,origin:'https://rpc-testnet.ynxweb4.com',raw:null};
 // Only this disposable PUBLIC fixture file is replaced. No user journal is read.
 const journal={schemaVersion,records:[intent],rejections:[],...(schemaVersion===1?{}:{resolutions:[]}),...(schemaVersion===5?{signedPayments:[],payProgress:[],payHistory:[],preparations:[]}:{})};
 await writeFile(f.filePath,JSON.stringify(journal),{mode:0o600});const before=await readFile(f.filePath,'utf8');
 const cold=new FileTransactionIntentStore({filePath:f.filePath});f.sender.submissions.intentStore=cold;
 assert.equal((await cold.snapshot())[0].raw,null);assert.equal(cold.localOriginal(account),null);
 await assert.rejects(f.sender.submissions.saveOriginal(f.hash,account,f.guard));
 assert.equal(await readFile(f.filePath,'utf8'),before);assert.equal((await cold.snapshot())[0].raw,null);
 assert.equal((await f.sender.submissions.list(account))[0].canRetryExact,false);
 assert.equal(f.state.signs,0);assert.equal(f.state.broadcasts,0);assert.deepEqual(f.state.calls,[]);
});
test('r6 cold complete duplicate save validates original binding without rewriting or effects',async t=>{
 const f=await r5HeldNative(t);await f.sender.submissions.saveOriginal(f.hash,account,f.guard);
 const before=await readFile(f.filePath,'utf8'),cold=new FileTransactionIntentStore({filePath:f.filePath});f.sender.submissions.intentStore=cold;
 for(let i=0;i<2;i++)assert.deepEqual(await f.sender.submissions.saveOriginal(f.hash,account,f.guard),{account,hash:f.hash,savedLocally:true,submitted:false,confirmed:false});
 assert.equal((await cold.snapshot())[0].raw,f.raw);assert.equal(await readFile(f.filePath,'utf8'),before);
 await assert.rejects(f.sender.submissions.saveOriginal('0x'+'f'.repeat(64),account,f.guard));
 await assert.rejects(f.sender.submissions.saveOriginal(f.hash,recipient,{account:recipient,assert(){}}));
 await assert.rejects(f.sender.submissions.saveOriginal(f.hash,account,{account,assert(){throw Error('QA_R6_LOCK')}}));
 assert.equal(await readFile(f.filePath,'utf8'),before);assert.equal((await f.sender.submissions.list(account))[0].canRetryExact,false);
 await assert.rejects(f.sender.submissions.retry(f.hash,account,f.guard));assert.equal(f.state.signs,0);assert.equal(f.state.broadcasts,0);assert.deepEqual(f.state.calls,[]);
});
function fixture(t, overrides = {}) {
  const state = { chain: "0x1917", nonce: "0x0", balance: toQuantity(10n ** 18n), gasPrice: "0x3b9aca00", estimate: "0x5208", calls: [], signs: 0, broadcasts: 0, ...overrides };
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body); state.calls.push(request);
    const results = { eth_chainId: state.chain, eth_getTransactionCount: state.nonce, eth_getBalance: state.balance, eth_gasPrice: state.gasPrice, eth_estimateGas: state.estimate, eth_getBlockByNumber: { baseFeePerGas: "0x3b9aca00" }, eth_maxPriorityFeePerGas: "0x5f5e100" };
    if (request.method === "eth_sendRawTransaction") { state.broadcasts++; state.signed = Transaction.from(request.params[0]); results.eth_sendRawTransaction = state.signed.hash; }
    const payload = request.method === state.unavailable ? { error: { code: -32601, message: "method unavailable" } } : { result: results[request.method] };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, ...payload }));
  };
  const network = new CanonicalAccountNetwork({ fetchImpl });
  network.capabilities = async () => fixtureEVMCapabilities;
  // Generic serializer-only tests retain their explicit in-memory journal.
  // Model the new original-owner contract; this is NOT durable marker evidence.
  const store=new FixtureIntentStore();let local=null;
  store.reserveOriginal=async account=>{if(local)throw Error('fixture original conflict');return local={account,kind:'native',native:null,originalCause:null,storageCause:null}};
  store.captureOriginal=(_account,value)=>{local.native=value};store.localOriginal=()=>local;
  store.originalFailed=(_account,error)=>{if(local)local.originalCause=error};store.originalSaved=()=>{local=null};
  store.assertNoSignedPayment=async()=>{if(local)throw Error('fixture original unresolved')};
  const sender = new CanonicalTransactionSender({ intentStore: store, fetchImpl, network });
  const signer = { address: wallet.address, async signTransaction(fields) { state.signs++; return wallet.signTransaction(fields); }, connect() { throw new Error("must never connect and populate after review"); }, sendTransaction() { throw new Error("must never populate after review"); } };
  t.after(() => sender.provider.destroy());
  return { sender, signer, state };
}
for(const boundary of ['initial-marker','after-sign-lock','before-write','persisted-ack','readback'])test(`r4 actual sender original retention at ${boundary}`,async t=>{
 const f=fixture(t,{balance:toQuantity(100n*10n**18n),gasPrice:'0x246139ca8000',estimate:'0x61a8'}),directory=await mkdtemp(join(tmpdir(),'ynx-r4-sender-')),filePath=join(directory,'journal.json'),store=new FileTransactionIntentStore({filePath});f.sender.submissions.intentStore=store;
 const proof=JSON.parse(await readFile(new URL('./fixtures/transaction-durability/native-json-contract-fixture.json',import.meta.url),'utf8'));
 const caps=parseFeeModel({version:'ynx-ethereum-native-v1',enabled:true,chainId:'0x1917',transactionType:'0x0',feeYNXT:'1',feeWei:'0xde0b6b3a7640000',gas:'0x61a8',gasPrice:'0x246139ca8000',decimals:18,amountQuantumWei:'0xde0b6b3a7640000',scope:'whole-YNXT plain native transfers',fullEVM:false,eip1559:false,durability:proof.capability});f.sender.network.capabilities=async()=>caps;
 const reviewed=await f.sender.prepare(account,{from:account,to:recipient,value:'0xde0b6b3a7640000',data:'0x'});let live=true,wire=null;
 const sign=f.signer.signTransaction.bind(f.signer);f.signer.signTransaction=async fields=>{wire=await sign(fields);if(boundary==='after-sign-lock')live=false;return wire};
 const guard={assert:()=>{if(!live)throw Error('QA_LOCKED')},submit:async fn=>{guard.assert();return fn()}};
 const replace=store.filePolicy.replace.bind(store.filePolicy);let writes=0;store.filePolicy.replace=async(...args)=>{writes++;if(boundary==='initial-marker'||boundary==='before-write'&&writes===2)throw Error('QA_BEFORE_WRITE');await replace(...args);if(boundary==='persisted-ack'&&writes===2)throw Error('QA_PERSISTED_ACK')};
 if(boundary==='readback'){const available=store.filePolicy.available.bind(store.filePolicy);store.filePolicy.available=async p=>{if(writes===2&&p===filePath)throw Error('QA_READBACK');return available(p)}}
 await assert.rejects(f.sender.send(f.signer,reviewed,guard));assert.equal(f.state.broadcasts,0);
 if(boundary==='initial-marker'){assert.equal(f.state.signs,0);assert.equal(store.localOriginal(account),null);return}
 assert.equal(f.state.signs,1);assert.equal(store.localOriginal(account).native.raw,wire);assert.equal(Object.isFrozen(store.localOriginal(account).native.transaction),true);
 const rows=await f.sender.submissions.list(account);assert.equal(rows.length,1);assert.equal(rows[0].status,'signed_unpersisted');assert.equal(rows[0].canRetryExact,false);assert.equal(rows[0].localRetention.durable,false);assert.equal('raw' in rows[0],false);
 if(boundary==='after-sign-lock')assert.equal(rows[0].localRetention.originalCause.message,'QA_LOCKED');else assert.ok(rows[0].localRetention.storageCause.message.startsWith('QA_'));
 await assert.rejects(f.sender.submissions.retry(rows[0].hash,account,guard));await assert.rejects(f.sender.prepare(account,{from:account,to:recipient,value:'0xde0b6b3a7640000',data:'0x'}));
 const cold=new FileTransactionIntentStore({filePath});assert.equal(cold.localOriginal(account),null);await assert.rejects(new TransactionSubmissions({intentStore:cold}).assertResolved(account));assert.equal(f.state.signs,1);
});

for(const phase of ["before-sign","after-sign","before-broadcast","unrevoked"])test(`real sender and existing lifecycle permission guard at ${phase}`,async t=>{
  const f=fixture(t),snapshot=await f.sender.prepare(account,input()),epoch=new PermissionEpoch(),origin="https://sender-permission.invalid";
  const life=new DesktopKeyLifecycle({focused:()=>true,authorizer:{available:()=>true,authenticate:async()=>{},method:"controlled-test"}});
  life.setAccount(account);await life.unlock();t.after(()=>life.lock());
  const permission=epoch.lease(origin),entered=Promise.withResolvers(),release=Promise.withResolvers();let held=false;
  const pause=async()=>{if(!held){held=true;entered.resolve();await release.promise;}};
  if(phase==="before-sign") {const verify=f.sender.network.verifyChain.bind(f.sender.network);f.sender.network.verifyChain=async()=>{await pause();return verify();};}
  if(phase==="after-sign") {const sign=f.signer.signTransaction.bind(f.signer);f.signer.signTransaction=async fields=>{const signed=await sign(fields);await pause();return signed;};}
  if(phase==="before-broadcast") {const store=f.sender.submissions.intentStore,add=store.add.bind(store);store.add=async(...args)=>{const result=await add(...args);await pause();return result;};}
  const pending=life.run(lease=>{const guard=bindPermissionGuard(lease,permission);return guard.step(()=>f.sender.send(f.signer,snapshot,guard));}).catch(error=>error);
  if(phase!=="unrevoked") {await entered.promise;await epoch.revoke(origin,async()=>{});release.resolve();}
  const result=await pending;
  if(phase==="unrevoked") {assert.equal(typeof result,"string");assert.equal(f.state.broadcasts,1);assert.equal(f.state.signs,1);}
  else {assert.equal(result?.data?.code,"ACCOUNT_PERMISSION_REVOKED");assert.equal(f.state.broadcasts,0);assert.equal(f.state.signs,phase==="before-sign"?0:1);}
  if(phase==="before-broadcast")assert.equal((await f.sender.submissions.list(account)).length,1,"original signed intent stays recorded; no silent re-sign or broadcast");
});

test("real signing broadcasts only the complete immutable transaction approved before signing", async t => {
  const { sender, signer, state } = fixture(t);
  const transaction = input();
  const snapshot = await sender.prepare(account, transaction);
  assert.deepEqual(snapshot, { ...transaction, chainId: "0x1917", type: 0, nonce: "0x0", gasPrice: "0x3b9aca00", gasLimit: "0x6270" });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(state.signs, 0); assert.equal(state.broadcasts, 0);
  transaction.to = account; transaction.data = "0xdeadbeef";
  assert.throws(() => { snapshot.gasPrice = "0x1"; }, TypeError);
  const reviewedUnsigned = Transaction.from({ ...snapshot, from: undefined, nonce: 0 }).unsignedSerialized;
  state.calls.length = 0;
  const hash = await sender.send(signer, snapshot);
  assert.equal(hash, state.signed.hash);
  assert.equal(state.signed.unsignedSerialized, reviewedUnsigned);
  assert.equal(state.signed.from.toLowerCase(), account);
  const methods = state.calls.map(call => call.method);
  assert.deepEqual(methods.filter(method => method !== "eth_chainId"), ["eth_getTransactionCount", "eth_sendRawTransaction"]);
  assert.equal(methods[0], "eth_chainId");
  assert.equal(methods.at(-2), "eth_chainId", "actual chain is rechecked before original-byte dispatch");
  assert.equal(state.signs, 1);
  await assert.rejects(sender.send(signer, snapshot), error => error.data.code === "UNREVIEWED_TRANSACTION");
  assert.equal(state.signs, 1);
});

test("JSON-RPC gas is mapped to gasLimit and EIP-1559 access lists are copied and frozen", async t => {
  const { sender, signer, state } = fixture(t);
  const accessList = [{ address: recipient, storageKeys: [`0x${"00".repeat(32)}`] }];
  const snapshot = await sender.prepare(account, { ...input(), type: "0x2", gas: "0x7000", accessList });
  assert.equal(snapshot.gasLimit, "0x7000"); assert.equal("gas" in snapshot, false);
  assert.equal(snapshot.maxPriorityFeePerGas, "0x5f5e100");
  assert.equal(snapshot.maxFeePerGas, toQuantity(2_100_000_000n));
  assert.equal("gasPrice" in snapshot, false);
  assert.equal(Object.isFrozen(snapshot.accessList[0].storageKeys), true);
  accessList[0].storageKeys[0] = `0x${"ff".repeat(32)}`;
  assert.equal(snapshot.accessList[0].storageKeys[0], `0x${"00".repeat(32)}`);
  await sender.send(signer, snapshot);
  assert.equal(state.signed.type, 2); assert.equal(state.signed.gasLimit, 0x7000n);
  assert.equal(state.signed.maxFeePerGas, 2_100_000_000n);
  assert.equal(state.signed.data, "0x1234");
});

test("missing RPC fields, fee errors and insufficient balance cannot create a signable snapshot", async t => {
  for (const overrides of [{ unavailable: "eth_gasPrice" }, { unavailable: "eth_estimateGas" }, { unavailable: "eth_getTransactionCount" }, { gasPrice: "0x0" }, { gasPrice: null }, { nonce: "0x00" }, { balance: "0x1" }, { estimate: "0x1" }, { chain: "0x1" }]) {
    const { sender, signer, state } = fixture(t, overrides);
    await assert.rejects(sender.prepare(account, input()), error => !["eth_gasPrice", "eth_estimateGas"].includes(overrides.unavailable) || error.data.code === "RPC_FEE_UNAVAILABLE");
    await assert.rejects(sender.send(signer, input()), error => error.data.code === "UNREVIEWED_TRANSACTION");
    assert.equal(state.signs, 0); assert.equal(state.broadcasts, 0);
  }
});

test("a changed nonce or chain after review requires a new review before any signature", async t => {
  for (const [field, changed, code] of [["nonce", "0x1", "TRANSACTION_NONCE_CHANGED"], ["chain", "0x1", "RPC_CHAIN_MISMATCH"]]) {
    const { sender, signer, state } = fixture(t);
    const snapshot = await sender.prepare(account, input());
    state[field] = changed;
    await assert.rejects(sender.send(signer, snapshot), error => error.data.code === code);
    assert.equal(state.signs, 0); assert.equal(state.broadcasts, 0);
    state[field] = field === "nonce" ? "0x0" : "0x1917";
    await assert.rejects(sender.send(signer, snapshot), error => error.data.code === "UNREVIEWED_TRANSACTION");
  }
});

test("inconsistent, unsupported or user-injected incomplete transactions fail before signing", async t => {
  const { sender, signer, state } = fixture(t);
  for (const changes of [{ gas: "0x5208", gasLimit: "0x6270" }, { gas: "0x5000" }, { gasPrice: "0x1", maxFeePerGas: "0x2" }, { type: 0, maxPriorityFeePerGas: "0x1" }, { type: 0, accessList: [] }, { type: 3 }, { type: null }, { nonce: "0x1" }, { chainId: "0x1" }, { data: "0x1" }, { value: "0x01" }, { authorizationList: [] }]) await assert.rejects(sender.prepare(account, { ...input(), ...changes }));
  const snapshot = await sender.prepare(account, input());
  await assert.rejects(sender.send(signer, { ...snapshot }), error => error.data.code === "UNREVIEWED_TRANSACTION");
  assert.equal(state.signs, 0); assert.equal(state.broadcasts, 0);
});

test("a signer returning different transaction bytes is rejected before broadcasting", async t => {
  const { sender, state } = fixture(t);
  const snapshot = await sender.prepare(account, input());
  await assert.rejects(sender.send({ address: wallet.address, signTransaction: fields => wallet.signTransaction({ ...fields, data: "0xdeadbeef" }) }, snapshot), error => error.data.code === "TRANSACTION_SNAPSHOT_MISMATCH");
  assert.equal(state.broadcasts, 0);
});

test("native transfer uses the same RPC-prepared snapshot through real signing", async t => {
  const { sender, state } = fixture(t, { estimate: toQuantity(25_000), gasPrice: toQuantity(40_000_000_000_000n), balance: toQuantity(2n * 10n ** 18n) });
  let keyReads = 0;
  const vault = { async status() { return { initialized: true, account }; }, async withSecret(action) { keyReads++; return action("1".padStart(64, "0"), { account }); } };
  const native = new NativeWalletService({ vault, network: sender.network, sender });
  const review = await native.prepareTransfer({ to: recipient, amount: "0.1" });
  assert.equal(review.maximumFee, "1.2"); assert.equal(review.total, "1.3");
  assert.equal(review.transaction.gasLimit, toQuantity(30_000));
  assert.equal(review.transaction.nonce, "0x0");
  assert.equal(keyReads, 0); assert.equal(state.broadcasts, 0);
  const expected = Transaction.from({ ...review.transaction, from: undefined, nonce: 0 }).unsignedSerialized;
  await native.transferAction(review.id, "approve");
  assert.equal(keyReads, 1); assert.equal(state.broadcasts, 1);
  assert.equal(state.signed.unsignedSerialized, expected);
});
