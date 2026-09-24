import assert from "node:assert/strict";
import test from "node:test";
import { Transaction, Wallet } from "ethers";
import { EVM_CHAIN_HEX, WalletConnectBroadcastJournal, prepareEvmRequest, signPreparedEvmRequest } from "./evm";

const secret = "0".repeat(63) + "1", account = new Wallet(`0x${secret}`).address.toLowerCase(), other = "0x" + "2".repeat(40);
const model={version:"ynx-local-durability-v1",scope:"local-snapshot",receiptField:"ynxDurability",transactionStatusMethod:"ynx_getTransactionDurability",nativeTransactionField:"ynxNativeTransaction",minedStatus:"durable",pendingStatus:"pending_durable",consensusFinality:false};
const transferRpc = async (method: string): Promise<unknown> => ({ eth_chainId: EVM_CHAIN_HEX, eth_getTransactionCount: "0x1", eth_gasPrice: "0x246139ca8000", eth_estimateGas: "0x61a8", eth_getBalance: "0x56bc75e2d63100000",ynx_getDurabilityModel:model } as any)[method];

test("connection/signing does not require a positive balance", async () => {
  const review = await prepareEvmRequest(account, "personal_sign", ["0x6869", account], async () => { throw new Error("RPC must not be called"); });
  assert.equal(review.review.messageText, "hi"); assert.match(await signPreparedEvmRequest(secret, review, () => {}) as string, /^0x[0-9a-f]{130}$/);
});

test("typed data is bound to chain 6423 and selected account", async () => {
  const typed = JSON.stringify({ domain: { name: "YNX", version: "1", chainId: 6423 }, types: { Permit: [{ name: "value", type: "uint256" }] }, primaryType: "Permit", message: { value: "1" } });
  const review = await prepareEvmRequest(account, "eth_signTypedData_v4", [account, typed]); assert.equal(review.method, "eth_signTypedData_v4");
  await assert.rejects(() => prepareEvmRequest(account, "eth_signTypedData_v4", [account, typed.replace("6423", "1")]), /YNX Testnet/);
  await assert.rejects(() => prepareEvmRequest(account, "personal_sign", ["0x00", other]), /parameters/i);
});

test("transaction validates nonce fee estimate and balance before signing", async () => {
  const prepared = await prepareEvmRequest(account, "eth_sendTransaction", [{ from: account, to: other, value: "0xde0b6b3a7640000" }], transferRpc);
  const signed: any = await signPreparedEvmRequest(secret, prepared, () => {}); assert.match(signed.transactionHash, /^0x[0-9a-f]{64}$/);
  await assert.rejects(() => prepareEvmRequest(account, "eth_sendTransaction", [{ from: account, to: other, value: "0x1", data: "0x1234" }], transferRpc), /Contract calls/);
  await assert.rejects(() => prepareEvmRequest(account, "eth_sendTransaction", [{ from: account, to: other, value: "0xde0b6b3a7640000", nonce: "0x2" }], transferRpc), /nonce changed/i);
  await assert.rejects(() => prepareEvmRequest(account,"eth_sendTransaction",[{from:account,to:other,value:"0xde0b6b3a7640000",gas:"0x61a8",gasLimit:"0x61a8"}],transferRpc),/never both/);
  for(const type of [1,"0x1",2])await assert.rejects(()=>prepareEvmRequest(account,"eth_sendTransaction",[{from:account,to:other,value:"0xde0b6b3a7640000",type}],transferRpc),/type-0/);
});

test("broadcast ACK loss is persisted and blocks replacement after restart", async () => {
  const values = new Map<string, string>(); const storage = { getItem: async (key: string) => values.get(key) ?? null, setItem: async (key: string, value: string) => { values.set(key, value); }, deleteItem: async (key: string) => { values.delete(key); } };
  const prepared = await prepareEvmRequest(account, "eth_sendTransaction", [{ from: account, to: other, value: "0xde0b6b3a7640000" }], transferRpc); const signed: any = await signPreparedEvmRequest(secret, prepared, () => {});
  const first = new WalletConnectBroadcastJournal(storage); await assert.rejects(() => first.broadcast(account, signed, async method => { if(method==="eth_chainId")return EVM_CHAIN_HEX;if(method==="ynx_getDurabilityModel")return model;throw new Error("stream reset"); }), /uncertain/);
  assert.equal((await first.read(account))?.status, "uncertain");
  await assert.rejects(() => new WalletConnectBroadcastJournal(storage).broadcast(account, signed, async () => signed.transactionHash), /prior.*resolution/i);
});

test("failed durability preflight saves original bytes without calling sendRawTransaction",async()=>{
  const values=new Map<string,string>(),storage={getItem:async(key:string)=>values.get(key)??null,setItem:async(key:string,value:string)=>{values.set(key,value)},deleteItem:async(key:string)=>{values.delete(key)}};
  const prepared=await prepareEvmRequest(account,"eth_sendTransaction",[{from:account,to:other,value:"0xde0b6b3a7640000"}],transferRpc),signed:any=await signPreparedEvmRequest(secret,prepared,()=>{});let sends=0;
  const journal=new WalletConnectBroadcastJournal(storage);await assert.rejects(()=>journal.broadcast(account,signed,async method=>{if(method==="eth_chainId")return EVM_CHAIN_HEX;if(method==="eth_sendRawTransaction")sends++;throw new Error("capability unavailable")}),/capability unavailable/);
  assert.equal(sends,0);assert.equal((await journal.read(account))?.rawTransaction,signed.rawTransaction);
});

test("locking during durability preflight prevents signed transaction broadcast",async()=>{
  const values=new Map<string,string>(),storage={getItem:async(key:string)=>values.get(key)??null,setItem:async(key:string,value:string)=>{values.set(key,value)},deleteItem:async(key:string)=>{values.delete(key)}};
  const prepared=await prepareEvmRequest(account,"eth_sendTransaction",[{from:account,to:other,value:"0xde0b6b3a7640000"}],transferRpc),signed:any=await signPreparedEvmRequest(secret,prepared,()=>{});
  let release!:()=>void,entered!:()=>void,active=true,sends=0;const gate=new Promise<void>(resolve=>{release=resolve}),started=new Promise<void>(resolve=>{entered=resolve});
  const binding={topic:"a".repeat(64),requestId:7,sessionBinding:"b".repeat(64),requestDigest:"c".repeat(64)};
  const journal=new WalletConnectBroadcastJournal(storage),pending=journal.broadcastAuthorized(account,signed,()=>{if(!active)throw new Error("wallet locked")},binding,async method=>{if(method==="eth_chainId")return EVM_CHAIN_HEX;if(method==="ynx_getDurabilityModel"){entered();await gate;return model}if(method==="eth_sendRawTransaction")sends++;return signed.transactionHash});
  await started;active=false;release();await assert.rejects(pending,/wallet locked/);
  assert.equal(sends,0);assert.equal((await journal.read(account))?.transactionHash,signed.transactionHash);assert.deepEqual((await journal.read(account))?.binding,binding);
});

test("only exact successful receipt releases a saved transaction", async () => {
  const values = new Map<string, string>(); const storage = { getItem: async (key: string) => values.get(key) ?? null, setItem: async (key: string, value: string) => { values.set(key, value); }, deleteItem: async (key: string) => { values.delete(key); } };
  const prepared = await prepareEvmRequest(account, "eth_sendTransaction", [{ from: account, to: other, value: "0xde0b6b3a7640000" }], transferRpc); const signed: any = await signPreparedEvmRequest(secret, prepared, () => {}); const journal = new WalletConnectBroadcastJournal(storage);
  await journal.broadcast(account, signed, async method => method === "eth_chainId"?EVM_CHAIN_HEX:method==="ynx_getDurabilityModel"?model:signed.transactionHash); assert.equal((await journal.read(account))?.status, "acknowledged");
  assert.equal((await journal.refresh(account, async method=>method==="eth_chainId"?EVM_CHAIN_HEX:method==="ynx_getDurabilityModel"?model:{version:model.version,scope:model.scope,status:"pending_durable",transactionHash:signed.transactionHash,checkpointBlockNumber:"0x1",checkpointBlockHash:"0x"+"a".repeat(64),snapshotIntegrity:"0x"+"b".repeat(64)}))?.status, "acknowledged");
  const tx=Transaction.from(signed.rawTransaction),blockHash="0x"+"c".repeat(64),proof={version:model.version,scope:model.scope,status:"durable",transactionHash:signed.transactionHash,blockNumber:"0x2",blockHash,checkpointBlockNumber:"0x2",checkpointBlockHash:blockHash,snapshotIntegrity:"0x"+"d".repeat(64)};
  const receipt={transactionHash:signed.transactionHash,from:account,to:other,blockNumber:"0x2",blockHash,status:"0x1",type:"0x0",contractAddress:null,gasUsed:"0x61a8",effectiveGasPrice:"0x246139ca8000",ynxFeeWei:"0xde0b6b3a7640000",ynxDurability:proof,ynxNativeTransaction:{type:"transfer",amountYNXT:String(tx.value/10n**18n),feeYNXT:"1",nonce:String(tx.nonce+1)}};
  assert.equal((await journal.refresh(account,async method=>method==="eth_chainId"?EVM_CHAIN_HEX:method==="ynx_getDurabilityModel"?model:method==="ynx_getTransactionDurability"?proof:receipt))?.status,"confirmed");await journal.acknowledgeTerminal(account);assert.equal(await journal.read(account),null);
});
