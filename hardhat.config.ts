import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatEthers],
  solidity: {
    preferWasm: true,
    compilers: [
      {version: "0.8.24", settings: {optimizer: {enabled: true, runs: 200}}},
      {version: "0.8.28", settings: {optimizer: {enabled: true, runs: 200}}}
    ],
    overrides: {
      "contracts/devtools/SampleEVMWriteCounter.sol": {version: "0.8.24", settings: {optimizer: {enabled: true, runs: 200}}},
      "contracts/resource-market/YnxResourceMarketEscrow.sol": {version: "0.8.24", settings: {optimizer: {enabled: true, runs: 200}}},
      "contracts/tokens/SampleYNXTCompatibleERC20.sol": {version: "0.8.24", settings: {optimizer: {enabled: true, runs: 200}}},
      "contracts/tokens/SampleYNXTCompatibleERC721.sol": {version: "0.8.24", settings: {optimizer: {enabled: true, runs: 200}}},
      "contracts/trust/LotLineageRegistry.sol": {version: "0.8.24", settings: {optimizer: {enabled: true, runs: 200}}}
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test/contracts",
    artifacts: "./artifacts",
    cache: "./cache/hardhat"
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
