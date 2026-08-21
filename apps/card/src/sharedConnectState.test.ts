import test from "node:test";
import assert from "node:assert/strict";
import {createStandardWalletConnectState,reduceStandardWalletConnectState} from "@ynx-chain/wallet-auth";
import {readFileSync} from "node:fs";

test("Card consumes the shared standard-wallet reducer and closes its chooser only after account plus 0x1917",()=>{let state=createStandardWalletConnectState();state=reduceStandardWalletConnectState(state,{type:"BEGIN",pendingIntent:"card_shared_connect_20260822"});state=reduceStandardWalletConnectState(state,{type:"PROVIDER_SELECTED",providerKind:"metamask"});state=reduceStandardWalletConnectState(state,{type:"ACCOUNT_APPROVED",account:"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"});state=reduceStandardWalletConnectState(state,{type:"CHAIN_CONFIRMED",chainId:"0x1917"});assert.equal(state.status,"connected");assert.equal(state.chooserOpen,false);assert.equal(state.account,"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");});
test("Card shared connection consumption has no browser RPC fetch prerequisite",()=>{const app=readFileSync(new URL("../App.tsx",import.meta.url),"utf8"),wallet=readFileSync(new URL("wallet.ts",import.meta.url),"utf8");assert.match(app,/reduceStandardWalletConnectState/);assert.doesNotMatch(app,/fetch\([^)]*evm\.ynxweb4\.com/);assert.doesNotMatch(wallet,/fetch\([^)]*evm\.ynxweb4\.com/);});
