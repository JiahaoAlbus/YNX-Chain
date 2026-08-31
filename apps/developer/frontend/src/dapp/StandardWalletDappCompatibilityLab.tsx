import { useEffect, useMemo, useState } from "react";
import { Button } from "../components/ui/button";
import {
  DAPP_COMPATIBILITY_PROFILES,
  executeDappCompatibilityOperation,
  type TestnetTransactionRequest,
} from "./standard-wallet-dapp-profiles";
import {
  connectDeveloperWebWallet,
  disconnectDeveloperWebWallet,
  discoverDeveloperWebWalletChoices,
  subscribeDeveloperWebWalletEvents,
  type DeveloperWebWalletChoice,
} from "../wallet/safe-authorize-launcher";
import type { StandardWalletConnectState } from "../../../vendor/wallet-auth/src/index.js";
import { WalletIdentityMark } from "../wallet/WalletIdentityMark";

const initialTransaction: TestnetTransactionRequest = { to: "", value: "", data: "" };

/** A visible, executable consumer lab. It never turns its test responses into runtime claims. */
export function StandardWalletDappCompatibilityLab() {
  const [choices, setChoices] = useState<readonly DeveloperWebWalletChoice[]>([]);
  const [connection, setConnection] = useState<StandardWalletConnectState>();
  const [account, setAccount] = useState("");
  const [selectedKind, setSelectedKind] = useState<"ynx-wallet" | "metamask">();
  const [status, setStatus] = useState("Discovering independently installed standard Wallet providers…");
  const [transaction, setTransaction] = useState<TestnetTransactionRequest>(initialTransaction);
  const connectedChoice = useMemo(() => choices.find((choice) => choice.kind === selectedKind), [choices, selectedKind]);

  const refreshDiscovery = async () => {
    const discovery = await discoverDeveloperWebWalletChoices();
    setChoices(discovery.choices);
    if (discovery.status !== "ready") setStatus("No unambiguous YNX Wallet or MetaMask provider is available. Use an official installation; this page does not open a custom scheme, frame, popup, or blank tab.");
  };

  useEffect(() => {
    void refreshDiscovery().catch(() => setStatus("Provider discovery failed closed. No account request was sent."));
  }, []);

  useEffect(() => {
    if (!connection || connection.status !== "connected" || !selectedKind) return;
    let stopped = false;
    let unsubscribe: () => void = () => undefined;
    void subscribeDeveloperWebWalletEvents(selectedKind, connection, (next) => {
      if (stopped) return;
      setConnection(next);
      setAccount(next.account || "");
      setStatus(next.status === "connected" ? `Connected ${selectedKind === "ynx-wallet" ? "YNX Wallet" : "MetaMask"} account updated.` : `Selected provider changed state: ${next.status}.`);
    }).then((stop) => {
      unsubscribe = stop;
    }).catch(() => setStatus("Provider event subscription is unavailable; no connection state was inferred."));
    return () => { stopped = true; unsubscribe(); };
  }, [connection?.status, selectedKind]);

  const connect = async (kind: "ynx-wallet" | "metamask") => {
    setStatus(`Requesting YNX Testnet 0x1917 and an account only from the selected ${kind === "ynx-wallet" ? "YNX Wallet" : "MetaMask"} provider…`);
    try {
      const result = await connectDeveloperWebWallet(kind);
      setConnection(result.connection);
      setSelectedKind(result.providerKind || undefined);
      setAccount(result.account || "");
      setStatus(result.status === "connected" ? `${result.providerKind === "ynx-wallet" ? "YNX Wallet" : "MetaMask"} is selected on YNX Testnet 0x1917. No signature or transaction has been requested.` : `Connection did not complete: ${result.detail}.`);
    } catch (error) {
      setStatus(`The selected provider rejected or failed the request: ${error instanceof Error ? error.message : "unknown EIP-1193 error"}.`);
    }
  };

  const runProfile = async (profileId: string) => {
    if (!connectedChoice || !account) {
      setStatus("Choose and connect a real YNX Wallet or MetaMask provider before invoking a DApp profile.");
      return;
    }
    try {
      const response = await executeDappCompatibilityOperation(connectedChoice.candidate.provider, profileId, account, transaction);
      setStatus(`The selected provider returned a response for ${profileId}: ${typeof response === "string" ? response : JSON.stringify(response)}. This UI does not treat that response as an on-chain confirmation.`);
    } catch (error) {
      setStatus(`${profileId} was rejected or failed closed: ${error instanceof Error ? error.message : "unknown EIP-1193 error"}.`);
    }
  };

  const disconnect = () => {
    if (!connection) return;
    setConnection(disconnectDeveloperWebWallet(connection));
    setAccount("");
    setSelectedKind(undefined);
    setStatus("This page forgot its local Standard Wallet connection. The independently installed Wallet keeps its own permissions.");
  };

  return (
    <details>
      <summary>DAPP COMPATIBILITY LAB</summary>
      <div className="wallet-boundary">
        <b>Third-party standard Wallet entry point</b>
        <p>YNX Wallet and MetaMask are independently discovered EIP-6963/EIP-1193 providers. Their visible identity marks and names are distinct; the MetaMask marker is an original neutral identifier, not a copied MetaMask logo, and no YNX asset is used as MetaMask identity.</p>
        <div aria-label="Standard Wallet identity reference" className="chain-tool">
          <span><WalletIdentityMark kind="ynx-wallet" /><b>YNX Wallet</b> · expected identity: <code>com.ynx.wallet</code>, <code>isYNXWallet=true</code>, <code>isMetaMask=false</code></span>
          <span><WalletIdentityMark kind="metamask" /><b>MetaMask</b> · expected identity: <code>isMetaMask=true</code>, <code>isYNXWallet=false</code></span>
          <small>These are identity references only. The detected-provider controls below remain the sole availability and connection signal.</small>
        </div>
        {choices.length ? (
          <p>{choices.map((choice) => <Button key={choice.kind} variant="ghost" onClick={() => connect(choice.kind)}><WalletIdentityMark kind={choice.kind} />{`Connect ${choice.label}`}</Button>)}</p>
        ) : <p>No provider is selected automatically. Install YNX Wallet or MetaMask to run a real browser flow.</p>}
        {connection?.status === "connected" && <Button variant="ghost" onClick={disconnect}>Disconnect this app</Button>}
        <p>{status}</p>
        {DAPP_COMPATIBILITY_PROFILES.map((profile) => (
          <div className="chain-tool" key={profile.id}>
            <b>{profile.title}</b>
            <small>{profile.audience} · {profile.description}</small>
            {profile.operation === "send_transaction" && (
              <>
                <input aria-label="Testnet recipient" value={transaction.to} onChange={(event) => setTransaction({ ...transaction, to: event.target.value.trim() })} placeholder="Recipient 0x address" />
                <input aria-label="Testnet value" value={transaction.value} onChange={(event) => setTransaction({ ...transaction, value: event.target.value.trim() })} placeholder="Value quantity, e.g. 0x0" />
                <input aria-label="Testnet data" value={transaction.data || ""} onChange={(event) => setTransaction({ ...transaction, data: event.target.value.trim() })} placeholder="Optional data, e.g. 0x" />
              </>
            )}
            {profile.operation === "walletconnect" ? (
              <small>Runtime boundary: supply an actual configured WalletConnect v2 EIP-1193 adapter through the accepted DApp Connect SDK. No fixture, QR placeholder, or simulated session is offered here.</small>
            ) : (
              <Button variant="ghost" disabled={!account} onClick={() => runProfile(profile.id)}>{profile.operation === "connect" ? "Report selected connection" : `Run ${profile.operation}`}</Button>
            )}
          </div>
        ))}
        <p>Reject, accountsChanged, chainChanged, and disconnect remain provider events. An optional Product Session or RPC-probe failure must not erase the selected Standard Wallet connection.</p>
      </div>
    </details>
  );
}
