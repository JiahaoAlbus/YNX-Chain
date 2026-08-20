import assert from "node:assert/strict";

const base=process.env.YNX_CODE_CHECK_BASE||"http://127.0.0.1:4215",hash=process.env.YNX_CODE_CHAIN_TX||"0x2d61e641fb6cafbf762beade5fd3dfe614cb360c35707a0827365992be8acab0";
const health=await fetch(`${base}/runtime/health`),cookie=health.headers.get("set-cookie")?.split(";")[0];assert.equal(health.status,200);assert.ok(cookie);
const request=async(path,options={})=>{const response=await fetch(`${base}${path}`,{...options,headers:{cookie,...(options.body?{"content-type":"application/json"}:{}),...options.headers}}),value=await response.json();if(!response.ok)throw new Error(`${path}: ${JSON.stringify(value)}`);return value};
const live=await request("/runtime/chain/status");assert.equal(live.status.chainId,6423);assert.equal(live.status.nativeCurrencySymbol,"YNXT");assert.equal(live.status.network,"YNX Testnet");assert.equal(live.status.publicNetwork,true);assert.equal(live.status.catchingUp,false);assert.ok(live.status.height>0);
const rpc=async(method,params=[])=>(await request("/runtime/chain/rpc",{method:"POST",body:JSON.stringify({protocolVersion:"ynx-code-chain/v1",method,params})})).result;
assert.equal(await rpc("eth_chainId"),"0x1917");assert.ok(BigInt(await rpc("eth_blockNumber"))>0n);
assert.equal(await rpc("net_version"),"6423");
const latestBlock=await rpc("eth_getBlockByNumber",["latest",false]);assert.equal(latestBlock.number,await rpc("eth_blockNumber"));assert.ok(typeof latestBlock.hash==="string"&&/^0x[0-9a-f]{64}$/i.test(latestBlock.hash));
const compiler=await request("/runtime/chain/compiler");assert.equal(String(compiler.compiler.version??compiler.compiler.compilerVersion),"0.8.24");
const block=await request(`/runtime/chain/blocks/${live.status.height}`);assert.equal(Number(block.record?.height??BigInt(block.block.number)),live.status.height);
const transaction=await request(`/runtime/chain/transactions/${hash}`);assert.equal(transaction.record.hash.toLowerCase(),hash.toLowerCase());assert.equal(transaction.transaction.hash.toLowerCase(),hash.toLowerCase());assert.equal(transaction.receipt.transactionHash.toLowerCase(),hash.toLowerCase());assert.equal(transaction.receipt.status,"0x1");assert.equal(transaction.confirmed,true);
const rejected=await fetch(`${base}/runtime/chain/rpc`,{method:"POST",headers:{cookie,"content-type":"application/json"},body:JSON.stringify({protocolVersion:"ynx-code-chain/v1",method:"eth_sendTransaction",params:[]})});assert.equal(rejected.status,400);
console.log(`YNX Chain tools passed · height ${live.status.height} · tx ${hash.slice(0,14)}… · compiler 0.8.24`);
