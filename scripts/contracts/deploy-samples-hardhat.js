import { network } from "hardhat";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

requireEnv("YNX_EVM_RPC_URL");
requireEnv("DEPLOYER_PRIVATE_KEY");

const connection = await network.connect();
const { ethers } = connection;
const deployer = (await ethers.getSigners())[0];

const erc20Factory = await ethers.getContractFactory("SampleYNXTCompatibleERC20", deployer);
const erc20 = await erc20Factory.deploy(ethers.parseEther("1000000"));
await erc20.waitForDeployment();

const erc721Factory = await ethers.getContractFactory("SampleYNXTCompatibleERC721", deployer);
const erc721 = await erc721Factory.deploy("YNX Sample NFT", "YSN");
await erc721.waitForDeployment();

const resourceFactory = await ethers.getContractFactory("YnxResourceMarketEscrow", deployer);
const resourceMarket = await resourceFactory.deploy(await deployer.getAddress());
await resourceMarket.waitForDeployment();

const result = {
  network: "YNX Testnet",
  chainId: 6423,
  nativeCurrency: "YNXT",
  deployer: await deployer.getAddress(),
  contracts: {
    erc20: await erc20.getAddress(),
    erc721: await erc721.getAddress(),
    resourceMarket: await resourceMarket.getAddress()
  }
};

console.log(JSON.stringify(result, null, 2));
if (typeof connection.close === "function") {
  await connection.close();
}
