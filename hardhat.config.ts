import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatEthers],
  solidity: {
    version: "0.8.24",
    preferWasm: true,
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test/contracts",
    artifacts: "./artifacts",
    cache: "./cache/hardhat"
  },
  networks: {
    dexTest: {
      type: "edr-simulated",
      chainType: "l1"
    },
    ynxTestnet: {
      type: "http",
      chainType: "l1",
      url: configVariable("YNX_EVM_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
      chainId: 6423
    }
  }
});
