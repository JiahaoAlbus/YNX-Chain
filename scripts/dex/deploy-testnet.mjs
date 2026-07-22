import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { network } from "hardhat";

const required=(name)=>{const value=process.env[name]?.trim();if(!value)throw new Error(`Missing required env: ${name}`);return value};
required("YNX_EVM_RPC_URL");required("DEPLOYER_PRIVATE_KEY");
const governance=required("DEX_GOVERNANCE_ADDRESS");const feeRecipient=required("DEX_PROTOCOL_FEE_RECIPIENT");
const vaultOwner=required("DEX_VAULT_OWNER_ADDRESS");const quantEngine=required("DEX_QUANT_ENGINE_ADDRESS");const vaultOracle=required("DEX_VAULT_ORACLE_ADDRESS");
let tokens;try{tokens=JSON.parse(required("DEX_INITIAL_TOKEN_ADDRESSES"))}catch{throw new Error("DEX_INITIAL_TOKEN_ADDRESSES must be strict JSON")}
if(!Array.isArray(tokens)||tokens.length<2||tokens.length>64||new Set(tokens.map(String.toLowerCase)).size!==tokens.length)throw new Error("DEX token allowlist must contain 2..64 unique addresses");
const connection=await network.connect();const {ethers}=connection;const providerNetwork=await ethers.provider.getNetwork();
if(providerNetwork.chainId!==6423n)throw new Error(`Refusing deployment to chain ${providerNetwork.chainId}`);
for(const [name,address] of [["governance",governance],["fee recipient",feeRecipient],["vault owner",vaultOwner],["quant engine",quantEngine],["vault oracle",vaultOracle],...tokens.map((token,index)=>[`token ${index}`,token])]){if(!ethers.isAddress(address))throw new Error(`Invalid ${name} address`)}
const deployer=(await ethers.getSigners())[0];const balance=await ethers.provider.getBalance(deployer.address);if(balance===0n)throw new Error("Testnet deployer has no YNXT gas balance");
for(const token of tokens){if((await ethers.provider.getCode(token))==="0x")throw new Error(`Unsupported token has no contract code: ${token}`)}
if((await ethers.provider.getCode(vaultOracle))==="0x")throw new Error("Vault oracle has no contract code");
const factory=await ethers.deployContract("YNXDexFactory",[governance,feeRecipient,tokens]);const factoryReceipt=await factory.deploymentTransaction().wait();await factory.waitForDeployment();
const router=await ethers.deployContract("YNXDexRouter",[await factory.getAddress()]);const routerReceipt=await router.deploymentTransaction().wait();await router.waitForDeployment();
const quoter=await ethers.deployContract("YNXDexQuoter",[await router.getAddress()]);const quoterReceipt=await quoter.deploymentTransaction().wait();await quoter.waitForDeployment();
const strategyVault=await ethers.deployContract("YNXStrategyVault",[vaultOwner,quantEngine,await router.getAddress(),vaultOracle,tokens]);const strategyVaultReceipt=await strategyVault.deploymentTransaction().wait();await strategyVault.waitForDeployment();
const commit=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();const block=await ethers.provider.getBlock("latest");
const manifest={schemaVersion:2,productId:"ynx-dex",network:"YNX Testnet",chainId:6423,mainnet:false,audited:false,productionLiquidity:false,contractVersion:"ynx-dex-cpmm-v1-vault-v1",sourceCommit:commit,compiler:{version:"0.8.24",optimizer:true,runs:200,evmVersion:"shanghai"},deployer:deployer.address,governance,governanceModel:"two-day on-chain delay; multisig candidate requires owner verification",protocolFeeRecipient:feeRecipient,tokens,factory:{address:await factory.getAddress(),transactionHash:factoryReceipt.hash,blockNumber:factoryReceipt.blockNumber},router:{address:await router.getAddress(),transactionHash:routerReceipt.hash,blockNumber:routerReceipt.blockNumber},quoter:{address:await quoter.getAddress(),transactionHash:quoterReceipt.hash,blockNumber:quoterReceipt.blockNumber},strategyVault:{address:await strategyVault.getAddress(),transactionHash:strategyVaultReceipt.hash,blockNumber:strategyVaultReceipt.blockNumber,owner:vaultOwner,engine:quantEngine,oracle:vaultOracle,configured:false,paused:true,performanceFeeBps:0},deployedAt:new Date(Number(block.timestamp)*1000).toISOString(),sourceVerification:{status:"not-submitted",verifierUrl:process.env.YNX_CONTRACT_VERIFIER_URL||null},pools:[]};
const output=process.env.DEX_DEPLOYMENT_MANIFEST_PATH||"tmp/dex/deployment-manifest.json";await mkdir(dirname(output),{recursive:true});await writeFile(output,`${JSON.stringify(manifest,null,2)}\n`,{mode:0o600});console.log(JSON.stringify({manifest:output,factory:manifest.factory.address,router:manifest.router.address,quoter:manifest.quoter.address,strategyVault:manifest.strategyVault.address,commit},null,2));
if(typeof connection.close==="function")await connection.close();
