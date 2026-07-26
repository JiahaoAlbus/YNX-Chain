#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createWalletGatewayServer,
  loadRegistry,
} from "../../internal/walletgateway/server.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const statePath = process.env.YNX_WALLET_GATEWAY_STATE_PATH ?? "/var/lib/ynx-chain/wallet-gateway/state.json";
const registryPath = process.env.YNX_WALLET_GATEWAY_REGISTRY_PATH
  ?? resolve(repositoryRoot, "packages/wallet-auth/central-registry.json");
const { host, port } = parseAddress(process.env.YNX_WALLET_GATEWAY_HTTP_ADDR ?? "127.0.0.1:6438");

mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
const runtime = createWalletGatewayServer({
  registry: loadRegistry(registryPath),
  statePath,
  build: {
    commit: process.env.YNX_BUILD_COMMIT,
    release: process.env.YNX_BUILD_RELEASE,
    buildTime: process.env.YNX_BUILD_TIME,
  },
});

runtime.server.listen(port, host, () => {
  process.stdout.write(`YNX canonical Wallet Gateway listening on http://${host}:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    runtime.server.close(error => {
      process.exitCode = error ? 1 : 0;
    });
  });
}

function parseAddress(value) {
  const match = /^([^:]+):([0-9]{1,5})$/.exec(value);
  const port = match ? Number(match[2]) : 0;
  if (!match || port < 1 || port > 65535) {
    throw new Error("YNX_WALLET_GATEWAY_HTTP_ADDR must be host:port");
  }
  return { host: match[1], port };
}
