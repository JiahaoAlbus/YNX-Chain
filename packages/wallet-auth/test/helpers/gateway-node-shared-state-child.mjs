import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { CanonicalWalletGatewayNodeHost } from "../../src/gateway-node-host.js";

const NOW = new Date("2026-07-15T12:00:00.000Z");
const statePath = process.argv[2];
const registry = JSON.parse(readFileSync(new URL("../../central-registry.json", import.meta.url), "utf8"));
const social = registry.products.find(item => item.productId === "social");
social.reviewState = "approved";
social.enabled = true;

const host = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
const server = createServer(host.handler());
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
process.send?.({ port: server.address().port });

process.on("message", message => {
  if (message !== "close") return;
  server.close(() => process.exit(0));
});
