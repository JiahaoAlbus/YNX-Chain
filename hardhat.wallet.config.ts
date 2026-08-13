import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatEthers],
  solidity: {
    preferWasm: true,
    compilers: [
      {version: "0.8.28", settings: {optimizer: {enabled: true, runs: 200}}}
    ]
  },
  paths: {
    sources: "./contracts/wallet",
    tests: "./test/contracts/wallet",
    artifacts: "./tmp/wallet-hardhat/artifacts",
    cache: "./tmp/wallet-hardhat/cache"
  },
  networks: {
    ynxTestnet: {
      type: "http",
      chainType: "l1",
      url: configVariable("YNX_EVM_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
      chainId: 6423
    }
  }
});
