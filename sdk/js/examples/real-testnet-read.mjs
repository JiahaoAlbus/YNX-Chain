import { callYNXEVM, ynxTestnet } from "../index.js";

const source = ynxTestnet.rpcUrls[0];
const asOf = new Date().toISOString();
const chainId = await callYNXEVM(source, "eth_chainId", [], { timeoutMs: 12_000 });
if (chainId !== ynxTestnet.chainId) throw new Error(`expected ${ynxTestnet.chainId}, received ${String(chainId)}`);
console.log(JSON.stringify({ chainId, network: ynxTestnet.chainName, source, asOf }));
