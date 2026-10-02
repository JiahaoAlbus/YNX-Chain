import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import { defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatEthers],
  solidity: { preferWasm: true, compilers: [{ version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 } } }] },
  paths: { sources: "./contracts/ynx-test-market", artifacts: "./contracts/ynx-test-market/artifacts", cache: "./contracts/ynx-test-market/cache" },
  networks: { qa6423: { type: "edr-simulated", chainType: "l1", chainId: 6423 } },
});
