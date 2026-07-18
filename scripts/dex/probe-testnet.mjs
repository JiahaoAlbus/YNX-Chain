import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const rpc=process.env.YNX_EVM_RPC_URL||"https://evm.ynxweb4.com";
let id=0;
async function call(method,params=[]){const response=await fetch(rpc,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:++id,method,params}),signal:AbortSignal.timeout(10_000)});if(!response.ok)throw new Error(`${method} HTTP ${response.status}`);const value=await response.json();if(value.jsonrpc!=="2.0"||value.id!==id||value.error||!("result" in value))throw new Error(`${method} invalid JSON-RPC response`);return value.result}
const destination=path.resolve("docs/evidence/dex/testnet/rpc-probe.json");
let evidence;
try{
 const chainId=await call("eth_chainId");
 if(chainId!=="0x1917")throw new Error(`expected YNX Testnet chain 6423, received ${chainId}`);
 const blockNumber=await call("eth_blockNumber");
 if(!/^0x[0-9a-f]+$/.test(blockNumber))throw new Error("invalid latest block quantity");
 evidence={schemaVersion:1,productId:"ynx-dex",observedAt:new Date().toISOString(),endpoint:rpc,network:"YNX Testnet",chainIdHex:chainId,chainIdDecimal:Number.parseInt(chainId.slice(2),16),latestBlockHex:blockNumber,latestBlockDecimal:Number.parseInt(blockNumber.slice(2),16),rpcReachable:true,dexDeploymentObserved:false,deploymentManifest:"dex/ynx-testnet.integration.json",reason:"Factory, router, wrapped YNXT, reviewed test tokens, deployer authority, governance owner, and verifier evidence are not configured. RPC reachability is not deployment evidence.",claims:{implementedLocal:false,testedLocal:false,installedLocal:false,integratedCentral:false,deployedStaging:false,deployedPublic:false,downloadHosted:false,productionSigned:false,storeReleased:false,mainnet:false,audited:false,productionLiquidity:false}};
}catch(error){evidence={schemaVersion:1,productId:"ynx-dex",observedAt:new Date().toISOString(),endpoint:rpc,network:"YNX Testnet",expectedChainId:6423,rpcReachable:false,dexDeploymentObserved:false,errorClass:error instanceof Error?error.name:"UnknownError",error:error instanceof Error?error.message:String(error),reason:"The configured public RPC did not answer this probe. No deployment, transaction, pool, swap, LP, verifier, or public availability claim can be made.",claims:{implementedLocal:false,testedLocal:false,installedLocal:false,integratedCentral:false,deployedStaging:false,deployedPublic:false,downloadHosted:false,productionSigned:false,storeReleased:false,mainnet:false,audited:false,productionLiquidity:false}};process.exitCode=2}
await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,JSON.stringify(evidence,null,2)+"\n",{mode:0o644});console.log(JSON.stringify({rpcReachable:evidence.rpcReachable,destination}));
