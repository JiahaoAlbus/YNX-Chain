import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { network } from "hardhat";

const required=(name)=>{const value=process.env[name]?.trim();if(!value)throw new Error(`Missing required env: ${name}`);return value};
required("YNX_EVM_RPC_URL");required("DEPLOYER_PRIVATE_KEY");
const {ethers}=await network.connect();
const [deployer]=await ethers.getSigners();
const chainId=Number((await ethers.provider.getNetwork()).chainId);
const expectedChain=Number(process.env.DEX_EXPECTED_CHAIN_ID||6423);
if(chainId!==expectedChain)throw new Error(`Refusing deployment to chain ${chainId}; expected ${expectedChain}`);
if((await ethers.provider.getBalance(deployer.address.toLowerCase()))===0n)throw new Error("Testnet deployer has no YNXT gas balance");

const unit=10n**18n,maxSupply=100_000_000n*unit,initialSupply=10_000_000n*unit;
const txs=[];
async function deployed(name,args){const contract=await ethers.deployContract(name,args);const receipt=await contract.deploymentTransaction().wait();await contract.waitForDeployment();txs.push({kind:"deploy",contract:name,address:await contract.getAddress(),hash:receipt.hash,blockNumber:receipt.blockNumber});return contract}
async function sent(kind,promise){const tx=await promise;const receipt=await tx.wait();txs.push({kind,hash:receipt.hash,blockNumber:receipt.blockNumber});return receipt}

const assetA=await deployed("YNXTestnetAsset",["YNX Wrapped Test Asset","WYNXT_TEST",maxSupply,initialSupply]);
const assetB=await deployed("YNXTestnetAsset",["YNX Dollar Test Credit","YUSD_TEST",maxSupply,initialSupply]);
const oracle=await deployed("YNXTestnetOracle",[]);
const addresses=[await assetA.getAddress(),await assetB.getAddress()];
const [token0,token1]=[...addresses].sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase()));
const now=Number((await ethers.provider.getBlock("latest")).timestamp);
const sourceHash=ethers.keccak256(ethers.toUtf8Bytes(`ynx-testnet-owned-liquidity:${chainId}:${now}`));
for(const token of addresses)await sent("oracle-price",oracle.setPrice(token,unit,now,0,sourceHash));
await sent("oracle-pair",oracle.setPair(token0,token1,1n<<96n,0,0,now,sourceHash));

const defaults={baseFeeBps:30,maxFeeBps:500,volatilityMultiplierBps:5000,depthMultiplierBps:10000,divergenceMultiplierBps:10000,toxicMultiplierBps:5000,jitFeeBps:50,depegToleranceBps:100,guardBlocks:2,oracleMaxAge:300,flowWindow:60};
const factory=await deployed("YNXProtectedDexFactory",[deployer.address,deployer.address,addresses,await oracle.getAddress(),defaults]);
const router=await deployed("YNXDexRouter",[await factory.getAddress()]);
const quoter=await deployed("YNXDexQuoter",[await router.getAddress()]);
const stableFactory=await deployed("YNXStableFactory",[deployer.address,deployer.address,addresses]);
const stableRouter=await deployed("YNXDexRouter",[await stableFactory.getAddress()]);
const stableQuoter=await deployed("YNXDexQuoter",[await stableRouter.getAddress()]);
const vault=await deployed("YNXStrategyVault",[deployer.address,deployer.address,await router.getAddress(),await oracle.getAddress(),addresses]);
const fairFlow=await deployed("YNXFairFlow",[deployer.address,deployer.address,await factory.getAddress(),unit/10n]);

await sent("cpmm-pool-create",factory.createPool(addresses[0],addresses[1]));
const cpmmPool=await factory.getPool(addresses[0],addresses[1]);
await sent("stable-pool-create",stableFactory.createPool(addresses[0],addresses[1],200,4));
const stablePool=await stableFactory.getPool(addresses[0],addresses[1]);
for(const token of [assetA,assetB]){
  await sent("approve-cpmm-router",token.approve(await router.getAddress(),ethers.MaxUint256));
  await sent("approve-stable-router",token.approve(await stableRouter.getAddress(),ethers.MaxUint256));
}
let deadline=BigInt((await ethers.provider.getBlock("latest")).timestamp+3600);
await sent("cpmm-seed-liquidity",router.addLiquidity(addresses[0],addresses[1],1_000_000n*unit,1_000_000n*unit,deployer.address,deadline));
await sent("stable-seed-liquidity",stableRouter.addLiquidity(addresses[0],addresses[1],500_000n*unit,500_000n*unit,deployer.address,deadline));

const swaps=[];
for(let index=0;index<20;index+=1){
  if(index%5===0){const asOf=Number((await ethers.provider.getBlock("latest")).timestamp);await sent("oracle-refresh",oracle.setPair(token0,token1,1n<<96n,0,0,asOf,sourceHash))}
  const path=index%2===0?addresses:[addresses[1],addresses[0]];
  const amount=(100n+BigInt(index))*unit;
  const quote=await router.quoteExactInput(amount,path);
  deadline=BigInt((await ethers.provider.getBlock("latest")).timestamp+600);
  const receipt=await sent("cpmm-swap",router.swapExactInput(amount,quote[1]*99n/100n,path,deployer.address,deadline));
  swaps.push({index,path,amountIn:amount.toString(),quotedAmountOut:quote[1].toString(),hash:receipt.hash,blockNumber:receipt.blockNumber});
}

const commit=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const latest=await ethers.provider.getBlock("latest");
const manifest={schemaVersion:1,productId:"ynx-dex",release:"0.2.0-public-testnet-preview",network:"YNX Testnet",chainId,mainnet:false,audited:false,productionLiquidity:false,sourceCommit:commit,deployedAt:new Date(Number(latest.timestamp)*1000).toISOString(),administrator:{address:deployer.address,model:"single-signer public Testnet operator; not production multisig"},assets:[{symbol:"WYNXT_TEST",address:addresses[0],classification:"non-redeemable Testnet ERC-20; not wrapped native YNXT"},{symbol:"YUSD_TEST",address:addresses[1],classification:"non-redeemable Testnet credit; no stable-value claim"}],oracle:{address:await oracle.getAddress(),classification:"controller-written owned Testnet observation; no external price claim",sourceHash},factory:{address:await factory.getAddress()},lpProtection:{address:await factory.lpProtection()},router:{address:await router.getAddress()},quoter:{address:await quoter.getAddress()},cpmmPool:{address:cpmmPool,seedLiquidity:{tokenA:(1_000_000n*unit).toString(),tokenB:(1_000_000n*unit).toString()}},stableFactory:{address:await stableFactory.getAddress()},stableRouter:{address:await stableRouter.getAddress()},stableQuoter:{address:await stableQuoter.getAddress()},stablePool:{address:stablePool,amplification:200,swapFeeBps:4,seedLiquidity:{tokenA:(500_000n*unit).toString(),tokenB:(500_000n*unit).toString()}},strategyVault:{address:await vault.getAddress(),configured:false,paused:true},fairFlow:{address:await fairFlow.getAddress(),minimumSolverBondWei:(unit/10n).toString(),activeBatches:0},seedSwaps:swaps,transactions:txs};
const output=process.env.DEX_DEPLOYMENT_MANIFEST_PATH||"tmp/dex/public-testnet-manifest.json";
await mkdir(dirname(output),{recursive:true});await writeFile(output,`${JSON.stringify(manifest,null,2)}\n`,{mode:0o600});
console.log(JSON.stringify({manifest:output,chainId,deployer:deployer.address,assets:manifest.assets,factory:manifest.factory.address,router:manifest.router.address,cpmmPool,stableFactory:manifest.stableFactory.address,stableRouter:manifest.stableRouter.address,stablePool,strategyVault:manifest.strategyVault.address,fairFlow:manifest.fairFlow.address,seedSwaps:swaps.length,transactions:txs.length,commit},null,2));
