import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatEthers],
  solidity: {
    preferWasm: true,
    compilers: [{version:"0.8.24",settings:{optimizer:{enabled:true,runs:200}}}],
  },
  paths: {
    sources: "./contracts/dex",
    tests: "./test/contracts/dex",
    artifacts: "./tmp/dex-hardhat/artifacts",
    cache: "./tmp/dex-hardhat/cache",
  },
  networks: {
    dexTest: {type:"edr-simulated",chainType:"l1"},
    ynxTestnet: {
      type:"http",
      chainType:"l1",
      url:configVariable("YNX_EVM_RPC_URL"),
      accounts:[configVariable("DEPLOYER_PRIVATE_KEY")],
      chainId:6423,
    },
  },
});
