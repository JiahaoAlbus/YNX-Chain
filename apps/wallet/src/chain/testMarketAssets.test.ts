import assert from "node:assert/strict";
import { test } from "node:test";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Interface } from "ethers";
import { TEST_MARKET_DIRECTORY, TestMarketAssetClient, type TestMarketDirectory } from "./testMarketAssets";

const ABI = new Interface([
  "function TEST_MARKER() view returns (bytes32)", "function CHAIN_ID() view returns (uint256)",
  "function name() view returns (string)", "function symbol() view returns (string)",
  "function decimals() view returns (uint8)", "function cap() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)",
  "function stock() view returns (address)", "function tusd() view returns (address)",
  "function stockCodeHash() view returns (bytes32)", "function tusdCodeHash() view returns (bytes32)",
]);
const ACCOUNT = `0x${"d".repeat(40)}`;
const STOCK = `0x${"a".repeat(40)}`;
const CASH = `0x${"b".repeat(40)}`;
const DVP = `0x${"c".repeat(40)}`;
const BLOCK = `0x${"e".repeat(64)}`;
const TX = `0x${"f".repeat(64)}`;
const TX_CASH = `0x${"8".repeat(64)}`;
const TX_DVP = `0x${"7".repeat(64)}`;
const CODE = { [STOCK]: "0x6001", [CASH]: "0x6002", [DVP]: "0x6003" };
const hash = (code:string) => `0x${bytesToHex(keccak_256(Uint8Array.from(code.slice(2).match(/../g)!.map(byte=>parseInt(byte,16)))))}`;
const marker = `0x${Array.from(new TextEncoder().encode("YNX-6423-TEST-ONLY"), byte=>byte.toString(16).padStart(2,"0")).join("").padEnd(64,"0")}`;
const VERIFIED: TestMarketDirectory = {
  version:"ynx-test-market-wallet-v1",network:"ynx_6423-1",chainId:6423,testOnly:true,status:"VERIFIED",
  sourceManifestSha256:`0x${"1".repeat(64)}`,
  deployment:{stock:STOCK,cash:CASH,dvp:DVP,
    stockCodeHash:hash(CODE[STOCK]!),cashCodeHash:hash(CODE[CASH]!),dvpCodeHash:hash(CODE[DVP]!),
    receipts:{stock:{blockNumber:10,blockHash:BLOCK,transactionHash:TX},
      cash:{blockNumber:10,blockHash:BLOCK,transactionHash:TX_CASH},
      dvp:{blockNumber:10,blockHash:BLOCK,transactionHash:TX_DVP}}},
};

function fixture(override?:(method:string,params:any[])=>unknown){
  const methods:string[]=[];
  const fetcher=async (_url:string,init?:RequestInit):Promise<Response>=>{
    const request=JSON.parse(String(init?.body));
    const {method,params}=request;
    methods.push(method);
    let result:unknown;
    if(method==="eth_chainId")result="0x1917";
    else if(method==="eth_blockNumber")result="0xb";
    else if(method==="eth_getTransactionReceipt")result={transactionHash:params[0],blockNumber:"0xa",blockHash:BLOCK,status:"0x1",
      contractAddress:params[0]===TX?STOCK:params[0]===TX_CASH?CASH:DVP};
    else if(method==="eth_getBlockByNumber")result={number:params[0],hash:BLOCK};
    else if(method==="eth_getCode")result=CODE[params[0] as keyof typeof CODE];
    else if(method==="eth_call"){
      const {to,data}=params[0];
      const parsed=ABI.parseTransaction({data});
      assert.ok(parsed);
      const name=parsed.name;
      const stock=to===STOCK;
      const value:unknown=name==="TEST_MARKER"?marker:name==="CHAIN_ID"?6423n:
        name==="name"?stock?"YNX Test AAPL":"YNX Test USD":
        name==="symbol"?stock?"TEST-AAPL":"tUSD":name==="decimals"?6n:
        name==="cap"?stock?1_000_000_000_000n:10_000_000_000_000n:
        name==="balanceOf"?stock?1_250_000n:5_000_000n:
        name==="allowance"?stock?500_000n:0n:
        name==="stock"?STOCK:name==="tusd"?CASH:
        name==="stockCodeHash"?hash(CODE[STOCK]!):hash(CODE[CASH]!);
      result=ABI.encodeFunctionResult(name,[value]);
    }else throw new Error(`Unexpected ${method}`);
    if(override){const replacement=override(method,params);if(replacement!==undefined)result=replacement;}
    return new Response(JSON.stringify({jsonrpc:"2.0",id:request.id,result}),{headers:{"content-type":"application/json"}});
  };
  return {fetcher,methods};
}

test("default directory fails closed before any network call",async()=>{
  const {fetcher,methods}=fixture();
  await assert.rejects(new TestMarketAssetClient("http://127.0.0.1:8545",fetcher).read(ACCOUNT),/not verified/);
  assert.equal(TEST_MARKET_DIRECTORY.deployment,null);
  assert.deepEqual(methods,[]);
});

test("a pinned fixture reads exact-block real values and never broadcasts",async()=>{
  const {fetcher,methods}=fixture();
  const views=await new TestMarketAssetClient("http://127.0.0.1:8545",fetcher,()=>new Date("2026-09-25T00:00:00Z")).read(ACCOUNT,VERIFIED);
  assert.deepEqual(views.map(view=>[view.symbol,view.balanceUnits,view.allowanceToDvpUnits]),[["TEST-AAPL","1250000","500000"],["tUSD","5000000","0"]]);
  assert.ok(views.every(view=>view.blockNumber===11&&view.blockHash===BLOCK&&!view.transferAvailable&&!view.approvalAvailable&&!view.orderApprovalAvailable));
  assert.ok(methods.includes("eth_getTransactionReceipt"));
  assert.ok(!methods.includes("eth_sendRawTransaction"));
});

test("wrong chain, missing receipt, mismatched code and reorg all fail closed",async()=>{
  const scenarios:[string,(method:string,params:any[])=>unknown,RegExp][]=[
    ["chain",method=>method==="eth_chainId"?"0x1":undefined,/chain mismatch/],
    ["receipt",method=>method==="eth_getTransactionReceipt"?null:undefined,/receipt mismatch/],
    ["address",(method,params)=>method==="eth_getTransactionReceipt"&&params[0]===TX_CASH?
      {transactionHash:TX_CASH,blockNumber:"0xa",blockHash:BLOCK,status:"0x1",contractAddress:STOCK}:undefined,/receipt mismatch/],
    ["code",(method,params)=>method==="eth_getCode"&&params[0]===STOCK?"0x6000":undefined,/code hash mismatch/],
  ];
  for(const [,override,error] of scenarios){const {fetcher}=fixture(override);await assert.rejects(new TestMarketAssetClient("http://127.0.0.1:8545",fetcher).read(ACCOUNT,VERIFIED),error);}
  let blockReads=0;
  const {fetcher}=fixture((method,params)=>{
    if(method==="eth_getBlockByNumber"&&params[0]==="0xb"&&++blockReads===2)return {number:"0xb",hash:`0x${"9".repeat(64)}`};
    return undefined;
  });
  await assert.rejects(new TestMarketAssetClient("http://127.0.0.1:8545",fetcher).read(ACCOUNT,VERIFIED),/block changed/);
});

test("metadata and settlement mismatches cannot expose balances",async()=>{
  for(const [target,expected] of [["TEST_MARKER",/metadata mismatch/],["stock",/settlement binding mismatch/]] as const){
    const {fetcher,methods}=fixture((method,params)=>{
      if(method!=="eth_call")return undefined;
      const parsed=ABI.parseTransaction({data:params[0].data});
      if(parsed?.name!==target)return undefined;
      return ABI.encodeFunctionResult(target,[target==="TEST_MARKER"?`0x${"0".repeat(64)}`:CASH]);
    });
    await assert.rejects(new TestMarketAssetClient("http://127.0.0.1:8545",fetcher).read(ACCOUNT,VERIFIED),expected);
    assert.ok(methods.length>0);
  }
});

test("directory cannot acquire authority from dry-run or incomplete pins",async()=>{
  const {fetcher,methods}=fixture();
  const client=new TestMarketAssetClient("http://127.0.0.1:8545",fetcher);
  await assert.rejects(client.read(ACCOUNT,{...VERIFIED,status:"NOT_VERIFIED"}),/not verified/);
  await assert.rejects(client.read(ACCOUNT,{...VERIFIED,deployment:{...VERIFIED.deployment!,stock:"DEPLOYED_TEST_AAPL"}}),/incomplete/);
  assert.deepEqual(methods,[]);
});
