import assert from "node:assert/strict";
import test from "node:test";
import { parseWalletConnectLaunchLink } from "./walletConnectLaunchLinkPolicy";
const uri=`wc:${"a".repeat(64)}@2?relay-protocol=irn&symKey=${"b".repeat(64)}`;
test("exact app and universal links carry one canonical WalletConnect v2 payload",()=>{assert.equal(parseWalletConnectLaunchLink(`ynxwallet://open?uri=${encodeURIComponent(uri)}`),uri);assert.equal(parseWalletConnectLaunchLink(`https://www.ynxweb4.com/dapp/wallet/open?uri=${encodeURIComponent(uri)}`),uri);assert.equal(parseWalletConnectLaunchLink("ynxwallet://open"),null)});
test("query, encoding and exact-route widening fail closed",()=>{for(const value of [`ynxwallet://open?uri=${uri}`,`ynxwallet://open?uri=${encodeURIComponent(uri)}&x=1`,`ynxwallet://open?uri=${encodeURIComponent(uri)}#x`,`https://www.ynxweb4.com/dapp/wallet/open?uri=${encodeURIComponent(uri)}&x=1`])assert.throws(()=>parseWalletConnectLaunchLink(value));assert.equal(parseWalletConnectLaunchLink(`ynxwallet://authorize?uri=${encodeURIComponent(uri)}`),null)});
