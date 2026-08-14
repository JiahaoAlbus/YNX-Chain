#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { buildPublicERC4337MetadataCandidate } from "../src/public-erc4337-metadata.js";

if (process.env.YNX_WALLET_PUBLIC_METADATA_PROMOTION !== "1") throw new Error("YNX_WALLET_PUBLIC_METADATA_PROMOTION=1 is required for explicit public metadata promotion");
const candidate = buildPublicERC4337MetadataCandidate({
  deployment: await boundedJSON(required("YNX_WALLET_PUBLIC_DEPLOYMENT_EVIDENCE")),
  monitor: await boundedJSON(required("YNX_WALLET_PUBLIC_MONITOR_EVIDENCE")),
  sponsoredReceipt: await boundedJSON(required("YNX_WALLET_PUBLIC_SPONSORED_RECEIPT_EVIDENCE")),
  explorerBaseUrl: required("YNX_EXPLORER_PUBLIC_BASE_URL"),
});
console.log(JSON.stringify(candidate, null, 2));

async function boundedJSON(path) { const text = await readFile(path, "utf8"); if (Buffer.byteLength(text) > 1_048_576) throw new Error("public evidence input exceeds 1 MiB"); return JSON.parse(text); }
function required(name) { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
