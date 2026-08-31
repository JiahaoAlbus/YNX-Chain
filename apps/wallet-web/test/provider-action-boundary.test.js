import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {YNX_CHAIN} from "../src/provider.js";

const plan=JSON.parse(await readFile(new URL("../../../release/integration/wallet-web-provider-action-boundary-20260831.json",import.meta.url),"utf8"));
const origins=["https://wallet.ynxweb4.com","https://app.uniswap.org","https://opensea.io","https://app.safe.global"];
const forbidden=["eth_requestAccounts","eth_accounts","personal_sign","eth_signTypedData_v4","eth_sendTransaction"];

test("confirmation-bound MetaMask action is exact 6423 and cannot request an account or sign",()=>{
  const change=plan.metamaskNetworkChange;
  assert.equal(change.userConfirmationRequired,true);
  assert.deepEqual(change.targetOrigins,origins);
  assert.deepEqual(change.chain,{cosmosChainId:"ynx_6423-1",evmChainId:6423,evmChainHex:"0x1917",chainName:YNX_CHAIN.chainName,nativeCurrency:YNX_CHAIN.nativeCurrency,rpcUrls:YNX_CHAIN.rpcUrls,blockExplorerUrls:YNX_CHAIN.blockExplorerUrls});
  assert.deepEqual(change.forbiddenMethods,forbidden);
  assert.equal(change.noAutomaticRollback,true);
  assert.deepEqual(change.steps.map(({method})=>method),["wallet_switchEthereumChain","wallet_addEthereumChain","wallet_switchEthereumChain","eth_chainId"]);
  assert.equal(change.steps.at(-1).expectedResult,YNX_CHAIN.chainId);
  for(const step of change.steps)assert.equal(forbidden.includes(step.method),false);
});

test("candidate extension identity remains separate from MetaMask and is not treated as installed",()=>{
  const candidate=plan.ynxExtensionCandidate;
  assert.equal(plan.candidate.sourceCommit,"5a1f6e176b6ece953b22d8d62d94d401d69668bd");
  assert.equal(plan.candidate.publicRuntimeDeployed,false);
  assert.equal(candidate.userConfirmationRequired,true);
  assert.equal(candidate.installationPerformed,false);
  assert.deepEqual(candidate.eligibleOrigins,origins);
  assert.deepEqual(candidate.providerIdentity,{name:"YNX Wallet",rdns:"com.ynx.wallet",isYNXWallet:true,isMetaMask:false,eip6963:true,eip1193:true});
  assert.deepEqual(candidate.forbiddenActionsBeforeConfirmation,["extensionInstallation","eth_requestAccounts","wallet_switchEthereumChain","wallet_addEthereumChain","personal_sign","eth_signTypedData_v4","eth_sendTransaction"]);
  const archive=new URL("../artifacts/ynx-wallet-chrome-edge-0.1.0.zip",import.meta.url);
  const manifest=JSON.parse(execFileSync("unzip",["-p",archive.pathname,"manifest.json"],{encoding:"utf8"}));
  const provider=execFileSync("unzip",["-p",archive.pathname,"page-provider.js"],{encoding:"utf8"});
  assert.deepEqual(manifest.host_permissions,["https://*/*"]);
  assert.match(provider,/rdns:"com\.ynx\.wallet"/);
  assert.match(provider,/isYNXWallet:true/);
  assert.match(provider,/isMetaMask:false/);
  assert.match(provider,/eip6963:requestProvider/);
  assert.equal(plan.truth.ynxExtensionInstalled,false);
  assert.equal(plan.truth.ynxProviderDirectlyObserved,false);
});
