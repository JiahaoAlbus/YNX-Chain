import { proveYNXTestnetRPC, ynxTestnet } from "../index.js";

const source = ynxTestnet.rpcUrls[0];
const asOf = new Date().toISOString();
const result = await proveYNXTestnetRPC(source, { timeoutMs: 12_000 });
console.log(JSON.stringify({ ...result, source, asOf }));
