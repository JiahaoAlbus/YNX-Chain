import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import hre from "hardhat";

const localDir = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(fs.readFileSync(path.join(localDir, "asset-catalog.json"), "utf8"));
const { ethers } = await hre.network.connect();
assert.equal((await ethers.provider.getNetwork()).chainId, 6423n);
const [admin, , , treasury] = await ethers.getSigners();
const Asset = await ethers.getContractFactory("TestAsset");
const DvP = await ethers.getContractFactory("TestDvP");
const [stockSpec, cashSpec] = catalog.assets;
const stock = await Asset.deploy(stockSpec.name, stockSpec.symbol, BigInt(stockSpec.maximumUnits), admin.address, admin.address);
const cash = await Asset.deploy(cashSpec.name, cashSpec.symbol, BigInt(cashSpec.maximumUnits), admin.address, admin.address);
await Promise.all([stock.waitForDeployment(), cash.waitForDeployment()]);
const settlement = await DvP.deploy(await stock.getAddress(), await cash.getAddress(), treasury.address, catalog.settlement.feeBps);
await settlement.waitForDeployment();
assert.equal(await stock.symbol(), stockSpec.symbol);
assert.equal(await cash.symbol(), cashSpec.symbol);
assert.equal(await stock.cap(), BigInt(stockSpec.maximumUnits));
assert.equal(await cash.cap(), BigInt(cashSpec.maximumUnits));
assert.equal(await settlement.feeBps(), BigInt(catalog.settlement.feeBps));
const manifest = {
  manifestVersion: "ynx-test-market-dry-run-v1",
  network: catalog.network,
  chainId: catalog.chainId,
  testOnly: true,
  environment: "ephemeral-hardhat-qa6423",
  actualTestnetDeployment: "NOT_VERIFIED",
  publicAddresses: null,
  constructorInputs: {
    stock: { name: stockSpec.name, symbol: stockSpec.symbol, cap: stockSpec.maximumUnits, admin: "CONFIGURE_QA_ADMIN", issuer: "CONFIGURE_QA_ISSUER" },
    cash: { name: cashSpec.name, symbol: cashSpec.symbol, cap: cashSpec.maximumUnits, admin: "CONFIGURE_QA_ADMIN", issuer: "CONFIGURE_QA_ISSUER" },
    settlement: { stock: "DEPLOYED_TEST_AAPL", cash: "DEPLOYED_TUSD", feeRecipient: "CONFIGURE_QA_FEE_RECIPIENT", feeBps: catalog.settlement.feeBps }
  },
  creationBytecodeKeccak256: {
    TestAsset: ethers.keccak256(Asset.bytecode),
    TestDvP: ethers.keccak256(DvP.bytecode)
  },
  localDeploymentChecks: "PASS"
};
const destination = path.join(localDir, "deployment-manifest.dry-run.json");
fs.writeFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ status: "PASS", manifest: destination, actualTestnetDeployment: "NOT_VERIFIED", publicAddresses: null }));
