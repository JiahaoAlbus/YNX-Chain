import { useEffect, useMemo, useState } from "react";
import { Button } from "../components/ui/button";
import { chainRpc, debugChainBlock, debugChainTransaction, loadChainCompiler, loadChainStatus, type ChainStatus } from "../runtime/client";

const RPC_METHODS = ["eth_chainId", "eth_blockNumber", "eth_gasPrice", "eth_getBalance", "eth_getCode", "eth_getTransactionCount", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_call", "eth_estimateGas", "eth_getLogs", "eth_getBlockByNumber"];
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
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [method, setMethod] = useState("eth_chainId"),
    [params, setParams] = useState("[]"),
    [rpcResult, setRpcResult] = useState(""),
    [lookup, setLookup] = useState(""),
    [debug, setDebug] = useState<any>(),
    [estimate, setEstimate] = useState<{ gas: string; gasPrice: string; maxFeeWei: string }>(),
    wallet = useMemo(() => Boolean((globalThis as any).ynxWallet), []),
    artifact = useMemo(() => {
      try {
        const manifest = JSON.parse(files[".ynx-build/manifest.json"] || "null"),
          bytecode = manifest?.artifacts?.find((item: any) => item.path?.endsWith(".bin"));
        return manifest?.protocolVersion === "ynx-code-artifact/v1" && bytecode && files[bytecode.path] ? { manifest, bytecode } : null;
      } catch {
        return null;
      }
    }, [files]);
  const refresh = async () => {
    setBusy(true);
    setError("");
    try {
      const [live, toolchain] = await Promise.all([loadChainStatus(), loadChainCompiler()]);
      setStatus(live);
      setCompiler(toolchain);
    } catch (value) {
      setError(value instanceof Error ? value.message : "YNX Testnet is unavailable.");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
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
          Refresh
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
          <b>{wallet ? "YNX Wallet provider detected" : "YNX Wallet is not installed"}</b>
          <p>Wallet must review, sign and submit. YNX Code never receives a private key. A submitted hash is not success until the authoritative receipt confirms it.</p>
          {wallet ? (
            <Button disabled>Deployment review requires the canonical Wallet gate</Button>
          ) : (
            <a href="https://ynxweb4.com/wallet" target="_blank" rel="noreferrer">
              Install or open YNX Wallet ↗
            </a>
          )}
        </div>
      </details>
      {error && <div className="collab-error">{error}</div>}
      <div className="honest-boundary">RPC tools are read-only. Contract mutation remains Wallet-only and is unavailable until the exact provider and receipt gates pass.</div>
    </section>
  );
}
