import { useEffect, useMemo, useState } from "react";
import { Button } from "../components/ui/button";
import { broadcastDeveloperDeployment, chainRpc, completeDeveloperWalletSession, debugChainBlock, debugChainTransaction, introspectDeveloperWalletSession, loadChainCompiler, loadChainStatus, loadWalletReadiness, type ChainStatus, type WalletReadiness } from "../runtime/client";
import { canonicalJSON, consumeDeveloperDeploymentRequest, consumeDeveloperWalletRequest, createDeveloperSessionIntrospection, createDeveloperWalletCompletion, desktopWalletBridge, openDeveloperDeploymentReview, openDeveloperWalletReview, parseDeveloperDeploymentCallback, saveDeveloperWalletSession, subscribeDeveloperDeploymentCallbacks, subscribeDeveloperWalletCallbacks, ynxAccountToEVM } from "../wallet/transport";
import { enterDeveloperWalletV2Guest, inspectDeveloperWalletV2Runtime } from "../wallet/product-session-v2";
import { closeDeveloperWebWalletConnectionDetails, connectDeveloperWebWallet, disconnectDeveloperWebWallet, discoverDeveloperWebWalletChoices, openDeveloperWebWalletConnectionDetails, restoreDeveloperWebWallet, subscribeDeveloperWebWalletEvents, switchDeveloperWebWalletAccount } from "../wallet/safe-authorize-launcher";
import { StandardWalletDappCompatibilityLab } from "../dapp/StandardWalletDappCompatibilityLab";
import type { StandardWalletConnectState } from "../../../vendor/wallet-auth/src/index.js";

const RPC_METHODS = ["eth_chainId", "eth_blockNumber", "eth_gasPrice", "eth_getBalance", "eth_getCode", "eth_getTransactionCount", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_call", "eth_estimateGas", "eth_getLogs", "eth_getBlockByNumber"];
const WEB_WALLET_PROVIDER_KEY = "ynx.developer.standard-wallet.provider";
const TEMPLATES = {
  counter: {
    label: "Counter + event",
    path: "contracts/Counter.sol",
    source: "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\n\ncontract Counter {\n    uint256 public value;\n    event ValueChanged(address indexed caller, uint256 value);\n    function increment(uint256 amount) external { value += amount; emit ValueChanged(msg.sender, value); }\n}\n",
  },
  anchor: {
    label: "Web4 data anchor",
    path: "contracts/DataAnchor.sol",
    source: '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\n\ncontract DataAnchor {\n    event Anchored(address indexed owner, bytes32 indexed digest, string uri, string mediaType);\n    mapping(bytes32 => address) public ownerOf;\n    function anchor(bytes32 digest, string calldata uri, string calldata mediaType) external {\n        require(ownerOf[digest] == address(0), "already anchored");\n        ownerOf[digest] = msg.sender;\n        emit Anchored(msg.sender, digest, uri, mediaType);\n    }\n}\n',
  },
  payments: {
    label: "Batch payment",
    path: "contracts/BatchPayment.sol",
    source: '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\n\ncontract BatchPayment {\n    event Paid(address indexed sender, address indexed recipient, uint256 value);\n    function pay(address payable[] calldata recipients, uint256[] calldata values) external payable {\n        require(recipients.length == values.length && recipients.length <= 100, "invalid batch");\n        uint256 total;\n        for (uint256 i; i < recipients.length; i++) { total += values[i]; (bool ok,) = recipients[i].call{value: values[i]}(""); require(ok, "payment failed"); emit Paid(msg.sender, recipients[i], values[i]); }\n        require(total == msg.value, "value mismatch");\n    }\n}\n',
  },
  pinnedCounter: {
    label: "Pinned YNX write counter",
    path: "contracts/devtools/SampleEVMWriteCounter.sol",
    source: '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n\ncontract SampleEVMWriteCounter {\n    uint256 public count;\n\n    event CountChanged(address indexed caller, uint256 value);\n\n    constructor(uint256 initialCount) {\n        count = initialCount;\n    }\n\n    function increment(uint256 by) external returns (uint256) {\n        count += by;\n        emit CountChanged(msg.sender, count);\n        return count;\n    }\n}\n',
  },
};
const PLATFORM_STARTERS = [
  {
    label: "Rust contract profile · editable",
    files: {
      "contracts/rust/Cargo.toml": '[package]\nname = "ynx_counter"\nversion = "0.1.0"\nedition = "2021"\n\n[lib]\ncrate-type = ["cdylib", "rlib"]\n',
      "contracts/rust/src/lib.rs": "#![no_std]\n\npub struct Counter { value: u64 }\nimpl Counter { pub const fn new() -> Self { Self { value: 0 } } pub fn increment(&mut self, amount: u64) { self.value = self.value.saturating_add(amount); } pub const fn value(&self) -> u64 { self.value } }\n",
      "contracts/rust/README.md": "# Rust contract profile\n\nThis dependency-free profile is editable and locally testable after the reviewed Rust target/toolchain is installed. It is not a deployed YNX contract ABI.\n",
    },
  },
  {
    label: "Move module profile · editing only",
    files: {
      "contracts/move/Move.toml": '[package]\nname = "YNXCounter"\nversion = "0.0.1"\n\n[addresses]\nynx_counter = "0x0"\n',
      "contracts/move/sources/counter.move": "module ynx_counter::counter {\n    public struct Counter has store, drop { value: u64 }\n    public fun increment(counter: &mut Counter, amount: u64) { counter.value = counter.value + amount; }\n}\n",
      "contracts/move/README.md": "# Move module profile\n\nEditing and project structure only. Build/deploy remains unavailable until a reviewed YNX-compatible Move toolchain and runtime are attested.\n",
    },
  },
  {
    label: "Cosmos SDK module profile · editable",
    files: {
      "contracts/cosmos/go.mod": "module ynx.local/counter\n\ngo 1.24\n",
      "contracts/cosmos/x/counter/types/msg.go": 'package types\n\ntype Increment struct {\n\tCreator string `json:"creator"`\n\tAmount uint64 `json:"amount"`\n}\n',
      "contracts/cosmos/README.md": "# Cosmos SDK module profile\n\nThis starter exposes a dependency-free message type for editing. A real Cosmos SDK chain module requires reviewed dependencies, generated codecs and an attested target runtime.\n",
    },
  },
] as const;

export function ChainPanel({ files, onAddFile }: { files: Record<string, string>; onAddFile: (path: string, content: string) => void }) {
  const [status, setStatus] = useState<ChainStatus>(),
    [compiler, setCompiler] = useState<any>(),
    [walletReadiness, setWalletReadiness] = useState<WalletReadiness>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [method, setMethod] = useState("eth_chainId"),
    [params, setParams] = useState("[]"),
    [rpcResult, setRpcResult] = useState(""),
    [lookup, setLookup] = useState(""),
    [debug, setDebug] = useState<any>(),
    [estimate, setEstimate] = useState<{ gas: string; gasPrice: string; maxFeeWei: string }>(),
    [constructorArgs, setConstructorArgs] = useState('["7"]'),
    [walletState, setWalletState] = useState(""),
    [walletV2State, setWalletV2State] = useState("Checking canonical Wallet Product Session v2…"),
    [webWalletDiscovery, setWebWalletDiscovery] = useState<Awaited<ReturnType<typeof discoverDeveloperWebWalletChoices>>>(),
    [webWalletAccount, setWebWalletAccount] = useState<string>(),
    [webWalletConnection, setWebWalletConnection] = useState<StandardWalletConnectState>(),
    wallet = useMemo(() => desktopWalletBridge(), []),
    walletGateReady = Boolean(walletReadiness?.developerBinding.attested && walletReadiness.gateway.remoteDeployed && walletReadiness.gateway.publicDeploymentReady),
    artifact = useMemo(() => {
      try {
        const manifest = JSON.parse(files[".ynx-build/manifest.json"] || "null"), bytecode = manifest?.artifacts?.find((item: any) => item.path?.endsWith(".bin")), metadataPath=bytecode?.path?.replace(/\.bin$/,".metadata.json"),metadata=metadataPath?JSON.parse(files[metadataPath]||"null"):null,source=metadata?.source?files[metadata.source]:null,deployedBytecode=metadata?.deployedBytecode?.object;
        return manifest?.protocolVersion === "ynx-code-artifact/v1" && bytecode && files[bytecode.path] && metadata?.contract && source && typeof deployedBytecode==="string" ? { manifest, bytecode, metadata, source, deployedBytecode } : null;
      } catch {
        return null;
      }
    }, [files]);
  const refresh = async () => {
    setBusy(true);
    setError("");
    try {
      const [live, toolchain, walletGate] = await Promise.all([loadChainStatus(), loadChainCompiler(), loadWalletReadiness().catch(() => undefined)]);
      setStatus(live);
      setCompiler(toolchain);
      setWalletReadiness(walletGate);
    } catch (value) {
      setError(value instanceof Error ? value.message : "YNX Testnet is unavailable.");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    void inspectDeveloperWalletV2Runtime().then(result => {
      if (!result.available) { setWalletV2State("Wallet Product Session v2 requires the native Developer Keychain bridge; browser sessions are not relabeled as secure."); return; }
      const availability = result.options?.availability;
      setWalletV2State(availability?.ynxWalletInstalled ? "Wallet Product Session v2 root factory is ready; YNX Wallet remains the preferred optional connection." : "YNX Wallet is not installed; use the official download or Guest / Try mode.");
    }).catch(() => setWalletV2State("Wallet Product Session v2 is unavailable; no local session was substituted."));
  }, []);
  useEffect(() => {
    if (wallet) return;
    void discoverDeveloperWebWalletChoices().then(setWebWalletDiscovery).catch(() => setWebWalletDiscovery(undefined));
  }, [wallet]);
  useEffect(() => {
    if (wallet) return;
    const providerKind = readStoredWebWalletProvider();
    if (!providerKind) return;
    void restoreDeveloperWebWallet(providerKind).then((result) => {
      setWebWalletConnection(result.connection);
      setWebWalletAccount(result.account || undefined);
      if (result.status !== "connected") clearStoredWebWalletProvider();
    }).catch(() => clearStoredWebWalletProvider());
  }, [wallet]);
  useEffect(() => {
    if (wallet || webWalletConnection?.status !== "connected" || !webWalletConnection.providerKind) return;
    let disposed = false;
    let unsubscribe: () => void = () => {};
    void subscribeDeveloperWebWalletEvents(webWalletConnection.providerKind, webWalletConnection, (connection) => {
      if (disposed) return;
      setWebWalletConnection(connection);
      setWebWalletAccount(connection.account || undefined);
      if (connection.status === "connected") return;
      clearStoredWebWalletProvider();
      setWalletState(connection.status === "wrong-chain" ? "Browser Wallet changed away from YNX Testnet 0x1917. The Standard Wallet connection is no longer active." : "Browser Wallet disconnected or returned no approved account. The Standard Wallet connection is no longer active.");
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unsubscribe = cleanup;
    }).catch(() => {
      if (disposed) return;
      clearStoredWebWalletProvider();
      setWebWalletConnection(undefined);
      setWebWalletAccount(undefined);
    });
    return () => { disposed = true; unsubscribe(); };
  }, [wallet, webWalletConnection?.status, webWalletConnection?.providerKind, webWalletConnection?.account]);
  useEffect(() => {
    const handleOnline = () => void refresh();
    addEventListener("online", handleOnline);
    return () => removeEventListener("online", handleOnline);
  }, []);
  useEffect(() => subscribeDeveloperWalletCallbacks((callbackURL) => {
    setBusy(true); setError(""); setWalletState("Verifying the exact Wallet callback and signing this device's short-lived challenge…");
    void createDeveloperWalletCompletion(callbackURL).then(result => completeDeveloperWalletSession(result.body)).then(async session => {
      await saveDeveloperWalletSession(session);
      consumeDeveloperWalletRequest();
      setWalletState(`Canonical Product Session verified for ${session.account} · expires ${new Date(session.expiresAt).toLocaleTimeString()}. Deployment still requires a separate exact intent and Wallet signature.`);
    }).catch(value => { setWalletState(""); setError(value instanceof Error ? value.message : "YNX Wallet session completion failed closed."); }).finally(() => setBusy(false));
  }), []);
  useEffect(() => subscribeDeveloperDeploymentCallbacks((callbackURL) => {
    setBusy(true);setError("");setWalletState("Verifying Wallet-signed transaction bytes, Product Session and authoritative chain receipt…");
    void parseDeveloperDeploymentCallback(callbackURL).then(async parsed=>{const introspection=await createDeveloperSessionIntrospection(),proof=JSON.parse(introspection.body).proof,body=canonicalJSON({proof,response:parsed.response}),deployment=await broadcastDeveloperDeployment(body);consumeDeveloperDeploymentRequest();setWalletState(`Deployment confirmed · ${deployment.transactionHash} · block ${String(deployment.receipt.blockNumber)}. Explorer verification can now use this authoritative receipt.`)}).catch(value=>{setWalletState("");setError(value instanceof Error?value.message:"YNX deployment failed closed.")}).finally(()=>setBusy(false));
  }), []);
  const runRpc = async () => {
    setBusy(true);
    setError("");
    try {
      const value = JSON.parse(params);
      if (!Array.isArray(value)) throw new Error("RPC params must be a JSON array.");
      setRpcResult(JSON.stringify(await chainRpc(method, value), null, 2));
    } catch (value) {
      setError(value instanceof Error ? value.message : "RPC failed.");
    } finally {
      setBusy(false);
    }
  };
  const inspect = async () => {
    setBusy(true);
    setError("");
    setDebug(undefined);
    try {
      const value = lookup.trim();
      setDebug(
        /^0x[0-9a-f]{64}$/i.test(value)
          ? await debugChainTransaction(value)
          : /^[0-9]{1,20}$/.test(value)
            ? await debugChainBlock(value)
            : (() => {
                throw new Error("Enter a 0x transaction hash or decimal block height.");
              })(),
      );
    } catch (value) {
      setError(value instanceof Error ? value.message : "Lookup failed.");
    } finally {
      setBusy(false);
    }
  };
  const estimateDeployment = async () => {
    if (!artifact) return;
    setBusy(true);
    setError("");
    setEstimate(undefined);
    try {
      const bytecode = files[artifact.bytecode.path]?.trim();
      if (!bytecode || !/^[0-9a-f]+$/i.test(bytecode) || bytecode.length % 2) throw new Error("Verified artifact bytecode is invalid.");
      const [gasValue, gasPriceValue] = await Promise.all([chainRpc("eth_estimateGas", [{ data: `0x${bytecode}` }]), chainRpc("eth_gasPrice")]);
      const gas = BigInt(gasValue),
        gasPrice = BigInt(gasPriceValue);
      setEstimate({ gas: gas.toString(), gasPrice: gasPrice.toString(), maxFeeWei: (gas * gasPrice).toString() });
    } catch (value) {
      setError(value instanceof Error ? value.message : "Deployment estimate failed.");
    } finally {
      setBusy(false);
    }
  };
  const openWallet = async (providerKind?: "ynx-wallet" | "metamask") => {
    if (!wallet) {
      if (webWalletConnection?.status === "connected") {
        setWebWalletConnection(openDeveloperWebWalletConnectionDetails(webWalletConnection));
        setWalletState("Wallet connection details opened locally. No account request, custom authorization URI, callback or Product Session was created.");
        return;
      }
      setBusy(true);
      setError("");
      try {
        const result = await connectDeveloperWebWallet(providerKind);
        void discoverDeveloperWebWalletChoices().then(setWebWalletDiscovery).catch(() => setWebWalletDiscovery(undefined));
        setWebWalletConnection(result.connection);
        setWebWalletAccount(result.account || undefined);
        if (result.status === "connected" && result.providerKind) storeWebWalletProvider(result.providerKind);
        else clearStoredWebWalletProvider();
        setWalletState(browserWalletResultMessage(result));
      } catch {
        clearStoredWebWalletProvider();
        setWebWalletConnection(undefined);
        setWebWalletAccount(undefined);
        setWalletState("Browser Wallet discovery failed closed. Retry discovery or choose an official Wallet option; no authorization request, callback or Product Session was created.");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!walletGateReady) return;
    setBusy(true);
    setError("");
    setWalletState("Opening the exact five-minute request in YNX Wallet…");
    try {
      const result = await openDeveloperWalletReview(wallet);
      setWalletState(`Wallet review opened · expires ${new Date(result.expiresAt).toLocaleTimeString()}. No Developer session exists until callback and central Gateway completion both pass.`);
    } catch (value) {
      setWalletState("");
      setError(value instanceof Error ? value.message : "YNX Wallet could not be opened.");
    } finally {
      setBusy(false);
    }
  };
  const disconnectWebWallet = () => {
    if (!webWalletConnection || webWalletConnection.status !== "connected") return;
    setWebWalletConnection(disconnectDeveloperWebWallet(webWalletConnection));
    setWebWalletAccount(undefined);
    clearStoredWebWalletProvider();
    setWalletState("This page forgot its local Standard Wallet connection. The Wallet extension keeps its own permissions; reconnect requires an explicit product click.");
  };
  const switchWebWalletAccount = () => {
    if (!webWalletConnection || webWalletConnection.status !== "connected") return;
    setWebWalletConnection(switchDeveloperWebWalletAccount(webWalletConnection));
    setWebWalletAccount(undefined);
    clearStoredWebWalletProvider();
    setWalletState("Switch the account in the selected Wallet, then reconnect from this page. No account picker, custom URI, callback or Product Session was created.");
  };
  const refreshBrowserWalletDiscovery = async () => {
    if (wallet) return;
    setBusy(true);
    setError("");
    try {
      const result = await discoverDeveloperWebWalletChoices();
      setWebWalletDiscovery(result);
      setWalletState(result.status === "ready" ? `Browser Wallet discovery refreshed. ${result.choices.length === 1 ? "One provider is ready for an explicit connection click." : "Choose YNX Wallet or MetaMask explicitly before any account request."}` : "No unambiguous browser Wallet provider is available yet. You can retry after installing or unlocking a Wallet; no account request was sent.");
    } catch {
      setWebWalletDiscovery(undefined);
      setWalletState("Browser Wallet discovery failed closed. Retry after the extension is ready; no account request was sent.");
    } finally {
      setBusy(false);
    }
  };
  const enterWalletV2Guest = async () => {
    setBusy(true); setError("");
    try {
      const result = await enterDeveloperWalletV2Guest();
      setWalletV2State(result.available ? `${result.sessionState.message} Limits: ${result.sessionState.limitations?.join(", ") || "not signed in"}.` : result.reason);
    } catch (value) { setError(value instanceof Error ? value.message : "Guest mode could not be entered."); }
    finally { setBusy(false); }
  };
  const reviewDeployment=async()=>{if(!wallet||!walletGateReady||!artifact||!estimate)return;setBusy(true);setError("");setWalletState("Revalidating the Product Session, nonce and exact artifact before Wallet review…");try{const proof=await createDeveloperSessionIntrospection(),session=await introspectDeveloperWalletSession(proof.body);if(session.sessionBinding!==proof.session.sessionBinding)throw new Error("Wallet Gateway returned another Product Session.");const nonceValue=await chainRpc("eth_getTransactionCount",[ynxAccountToEVM(session.account),"pending"]),nonce=Number(BigInt(nonceValue))+1,args=JSON.parse(constructorArgs);if(!Array.isArray(args)||args.some(value=>typeof value!=="string"))throw new Error("Constructor arguments must be a JSON array of strings.");const result=await openDeveloperDeploymentReview(wallet,{name:artifact.metadata.contract,source:artifact.source,deployedBytecode:artifact.deployedBytecode,constructorArgs:args,nonce,blockNumber:status?.height||0,gasEstimate:estimate.gas,gasPriceWei:estimate.gasPrice,maxFeeWei:estimate.maxFeeWei,compilerVersion:artifact.manifest.compiler?.version||"unknown"});setWalletState(`Exact deployment review opened · artifact ${result.artifactDigest.slice(0,16)}… · expires ${new Date(result.expiresAt).toLocaleTimeString()}. No broadcast occurs until Wallet returns signed bytes.`)}catch(value){setWalletState("");setError(value instanceof Error?value.message:"Deployment review could not be opened.")}finally{setBusy(false)}};
  return (
    <section className="side-section chain-panel">
      <header>
        <strong>YNX CHAIN</strong>
        <span className={status?.chainId === 6423 ? "chain-live" : ""}>{status ? `height ${status.height}` : "checking"}</span>
      </header>
      <div className="chain-summary">
        <div>
          <b>{status?.network || "YNX Testnet"}</b>
          <span>
            Chain ID {status?.chainId || 6423} · {status?.nativeCurrencySymbol || "YNXT"}
          </span>
        </div>
        <Button variant="ghost" disabled={busy} onClick={refresh}>
          {busy ? "Connecting…" : error ? "Retry connection" : "Refresh"}
        </Button>
        <dl>
          <div>
            <dt>Finality head</dt>
            <dd>{status?.height ?? "—"}</dd>
          </div>
          <div>
            <dt>Validators</dt>
            <dd>{status ? `${status.readyValidatorCount}/${status.validatorCount}` : "—"}</dd>
          </div>
          <div>
            <dt>Pending</dt>
            <dd>{status?.pendingTxCount ?? "—"}</dd>
          </div>
          <div>
            <dt>Compiler</dt>
            <dd>{compiler?.version || compiler?.compilerVersion || "—"}</dd>
          </div>
        </dl>
        <small>{status?.latestBlockHash ? `${status.latestBlockHash.slice(0, 12)}… · ${status.catchingUp ? "catching up" : "synced"}` : "Live identity must verify before use."}</small>
      </div>
      <details open>
        <summary>TRANSACTION DEBUGGER</summary>
        <div className="chain-tool">
          <input value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="Tx hash or block height" />
          <Button disabled={busy || !lookup.trim()} onClick={inspect}>
            Inspect
          </Button>
          {debug && <pre>{JSON.stringify(debug, null, 2)}</pre>}
        </div>
      </details>
      <details>
        <summary>READ-ONLY RPC</summary>
        <div className="chain-tool">
          <select value={method} onChange={(event) => setMethod(event.target.value)}>
            {RPC_METHODS.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <textarea value={params} onChange={(event) => setParams(event.target.value)} spellCheck={false} />
          <Button disabled={busy} onClick={runRpc}>
            Send reviewed RPC
          </Button>
          {rpcResult && <pre>{rpcResult}</pre>}
        </div>
      </details>
      <details>
        <summary>CONTRACT TEMPLATES</summary>
        <div className="chain-templates">
          {Object.entries(TEMPLATES).map(([id, item]) => (
            <button key={id} onClick={() => onAddFile(item.path, item.source)}>
              <b>{item.label}</b>
              <span>{item.path}</span>
            </button>
          ))}
          {PLATFORM_STARTERS.map((item) => (
            <button key={item.label} onClick={() => Object.entries(item.files).forEach(([path, content]) => onAddFile(path, content))}>
              <b>{item.label}</b>
              <span>{Object.keys(item.files).length} reviewed project files</span>
            </button>
          ))}
        </div>
      </details>
      <details open>
        <summary>BUILD ARTIFACT</summary>
        <div className="wallet-boundary">
          {artifact ? (
            <>
              <b>Integrity manifest ready</b>
              <p>
                {artifact.bytecode.path}
                <br />
                {artifact.bytecode.bytes} bytes · {artifact.bytecode.sha256.slice(0, 16)}…<br />
                {Object.keys(artifact.manifest.sourceDigests || {}).length} source digest(s) · {artifact.manifest.compiler?.version}
              </p>
              <Button disabled={busy} onClick={estimateDeployment}>
                Estimate deployment gas
              </Button>
              <label>Constructor args (JSON strings)<input value={constructorArgs} onChange={event=>setConstructorArgs(event.target.value)}/></label>
              {estimate && (
                <p>
                  RPC estimate {estimate.gas} gas · gas price {estimate.gasPrice} wei
                  <br />Maximum estimate {estimate.maxFeeWei} wei
                </p>
              )}
            </>
          ) : (
            <>
              <b>No verified bytecode selected</b>
              <p>Run a Solidity file. ABI, bytecode, source maps and their SHA-256 manifest will be saved under .ynx-build.</p>
            </>
          )}
        </div>
      </details>
      <details open>
        <summary>WALLET & DEPLOYMENT</summary>
        <div className="wallet-boundary">
          <b>{walletGateReady ? (wallet ? "Developer Wallet gate ready" : "Developer Wallet gate ready · desktop required") : walletReadiness?.developerBinding.attested ? "Developer registry attested · public route not ready" : walletReadiness?.gateway.reachable ? "Wallet Gateway online · Developer binding not attested" : "Wallet Gateway unavailable"}</b>
          <p>Wallet must review, sign and submit. YNX Code never receives a private key. A submitted hash is not success until the authoritative receipt confirms it.</p>
          <p>{walletV2State}</p>
          <Button variant="ghost" disabled={busy} onClick={enterWalletV2Guest}>Continue as Guest / Try mode</Button>
          <p>Guest mode remains unsigned: balances, transactions and Chain authority are unavailable. A degraded optional Product Session never disconnects Standard Wallet.</p>
          {wallet ? (
            <><Button disabled={busy || !artifact || !walletGateReady} onClick={() => openWallet()}>Sign in with YNX Wallet</Button><Button disabled={busy||!artifact||!estimate||!walletGateReady} onClick={reviewDeployment}>Review exact contract deployment</Button></>
          ) : (
            <>
              {webWalletDiscovery?.choices.length ? (
                <>
                  <p>{webWalletDiscovery.choices.length > 1 ? "Choose a browser Wallet. No Wallet is selected automatically and no account request is sent until you choose." : `Browser provider ready: ${webWalletDiscovery.detail}. Connect requests accounts and YNX Testnet 0x1917 only after your click.`}</p>
                  {webWalletDiscovery.choices.map((choice) => <Button key={choice.kind} disabled={busy} onClick={() => openWallet(choice.kind)}>{webWalletAccount ? `Reconnect ${choice.label}` : choice.kind === "ynx-wallet" ? "Connect YNX Wallet" : "Connect MetaMask"}</Button>)}
                </>
              ) : <Button disabled={busy} onClick={() => openWallet()}>{webWalletAccount ? "Reconnect browser Wallet" : "Connect browser Wallet"}</Button>}
              <Button variant="ghost" disabled={busy} onClick={refreshBrowserWalletDiscovery}>Retry browser Wallet discovery</Button>
              <p>{webWalletAccount ? `Standard Wallet account ${webWalletAccount} is connected on YNX Testnet 0x1917. Product Session remains optional and separate.` : webWalletDiscovery?.status === "ready" ? "Choose a listed Wallet before any account request is sent." : "No browser Wallet provider is available. The official download and MetaMask choices remain on this page."}</p>
              {webWalletConnection?.status === "connected" && <Button variant="ghost" disabled={busy} onClick={() => setWebWalletConnection(openDeveloperWebWalletConnectionDetails(webWalletConnection))}>Wallet connection details</Button>}
              {webWalletConnection?.chooserOpen && webWalletConnection.chooserMode === "connection-details" && (
                <div className="chain-tool" aria-label="Wallet connection details">
                  <b>Wallet connection details</b>
                  <p>Provider: <b>{webWalletConnection.providerKind === "ynx-wallet" ? "YNX Wallet" : "MetaMask"}</b></p>
                  <p>Account: <code>{webWalletConnection.account}</code></p>
                  <p>Network: <b>YNX Testnet</b> · <code>{webWalletConnection.chainId}</code></p>
                  <p>Product Session: {webWalletConnection.privateService === "degraded" ? "Optional service degraded; Standard Wallet remains connected." : "Optional and separate from this Standard Wallet connection."}</p>
                  <Button variant="ghost" disabled={busy} onClick={disconnectWebWallet}>Disconnect this app</Button>
                  <Button variant="ghost" disabled={busy} onClick={switchWebWalletAccount}>Switch account</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setWebWalletConnection(closeDeveloperWebWalletConnectionDetails(webWalletConnection))}>Close details</Button>
                  <p>These controls are local to this page. They never request accounts, launch a custom URI, open a popup, or create a Product Session.</p>
                </div>
              )}
              <a href={webWalletDiscovery?.launch.fallbackActions[0]?.url || "https://www.ynxweb4.com/dapp/download"}>Download YNX Wallet</a>{" · "}
              <a href={webWalletDiscovery?.launch.fallbackActions[1]?.url || "https://metamask.io/download/"}>Use MetaMask</a>
            </>
          )}
          {walletState && <p>{walletState}</p>}
          {walletReadiness?.gateway.build && <p>Gateway {walletReadiness.gateway.build.release}<br /><code>{walletReadiness.gateway.build.sourceCommit.slice(0, 12)}</code> · registry {walletReadiness.developerBinding.attested ? `${walletReadiness.developerBinding.registrySha256?.slice(0, 12)}…` : "not attested"}</p>}
          {!wallet && <p>Web uses fixed EIP-6963/EIP-1193 only. A user click can request accounts and add/switch YNX Testnet 0x1917; it never launches a custom Wallet scheme, iframe, popup, blank target or simulated session. Native resolver-first canonical callbacks remain separate.</p>}
        </div>
      </details>
      <StandardWalletDappCompatibilityLab />
      {error && <div className="collab-error">{error}</div>}
      <div className="honest-boundary">RPC tools are read-only. Contract mutation remains Wallet-only and is unavailable until the exact provider and receipt gates pass.</div>
    </section>
  );
}

function readStoredWebWalletProvider(): "ynx-wallet" | "metamask" | null {
  try {
    const value = window.sessionStorage.getItem(WEB_WALLET_PROVIDER_KEY);
    return value === "ynx-wallet" || value === "metamask" ? value : null;
  } catch { return null; }
}
function storeWebWalletProvider(providerKind: "ynx-wallet" | "metamask") {
  try { window.sessionStorage.setItem(WEB_WALLET_PROVIDER_KEY, providerKind); } catch { /* browser storage is optional */ }
}
function clearStoredWebWalletProvider() {
  try { window.sessionStorage.removeItem(WEB_WALLET_PROVIDER_KEY); } catch { /* browser storage is optional */ }
}

function browserWalletResultMessage(result: Awaited<ReturnType<typeof connectDeveloperWebWallet>>): string {
  if (result.status === "connected") return `Standard ${result.providerKind === "ynx-wallet" ? "YNX Wallet" : "MetaMask"} connected as ${result.account}. YNX Testnet 0x1917 is selected; no YNX authorization URI, callback or Product Session was created.`;
  if (result.status === "selection-required") return "Select YNX Wallet or MetaMask below before accounts are requested. This page did not open a custom scheme, frame, popup or blank tab.";
  if (result.detail.endsWith("_REJECTED")) return "The selected Wallet rejected this request. No account was retained; unlock or review the Wallet, then retry from this page.";
  if (result.detail === "EIP1193_PROVIDER_DISCONNECTED") return "The selected Wallet is disconnected. Reconnect the extension, then retry browser Wallet discovery; no account was retained.";
  if (result.detail === "EIP1193_PROVIDER_UNAUTHORIZED") return "The selected Wallet did not authorize this page. Retry only after reviewing its permissions; no account was retained.";
  if (result.detail === "EIP1193_CHAIN_NOT_AVAILABLE") return "YNX Testnet 0x1917 could not be added or selected. Verify the Wallet network settings, then retry; no account was retained.";
  return "No unambiguous browser Wallet provider was found. Choose an official Wallet option below; this page did not open a custom scheme, frame, popup or blank tab.";
}
