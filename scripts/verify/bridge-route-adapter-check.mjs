import {readFileSync} from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const json = (path) => JSON.parse(read(path));
const fail = (message) => { throw new Error(message); };
const provider = json("docs/bridge/provider-status.json");
const manifest = json("docs/bridge/consumer-integration-manifest.json");
const docs = read("docs/bridge/ROUTE_ADAPTER.md");
const types = read("internal/bridgegateway/types.go");
const server = read("internal/bridgegateway/server.go");
const providerRuntime = read("internal/bridgegateway/provider_runtime.go");
const providerCheck = read("scripts/verify/bridge-provider-check.sh");
const sdk = read("sdk/bridge/index.js");
const assetDocs = read("docs/bridge/ASSET_CATALOG.md");
const classifications = [
  "official-stablecoin-transfer-candidate",
  "proof-based-canonical-bridge-candidate",
  "external-bridge-adapter",
  "route-aggregator",
  "manual-operator-testnet-transfer",
];

for (const classification of classifications) {
  if (!docs.includes(classification) || !types.includes(classification)) fail("missing route classification " + classification);
}
if (manifest.publicRead?.routes?.path !== "/bridge/routes" || manifest.publicRead?.routes?.source !== "ynx-bridge-route-registry" || manifest.publicRead?.routes?.quotesExecutable !== false || manifest.publicRead?.routes?.deployedPublic !== false || manifest.runtimeTruth?.providerStatus !== "unavailable-no-verified-provider-connection" || manifest.runtimeTruth?.deployedPublic !== false) fail("route catalog handoff overclaims availability");
if (!server.includes('GET /bridge/routes') || !sdk.includes("async getRoutes()") || !sdk.includes("configured-fail-closed-candidates-not-live-provider-quotes")) fail("runtime or SDK route catalog is missing");
if (!server.includes('GET /bridge/assets') || !sdk.includes("async getAssets()") || !sdk.includes("configured-token-allowlist-candidates-not-verified-contracts")) fail("runtime or SDK asset catalog is missing");
if (!server.includes('GET /bridge/status') || !sdk.includes("async getStatus()") || !sdk.includes("local-coordinator-and-configured-candidates-not-public-provider-health")) fail("runtime or SDK status surface is missing");
for (const assetClass of ["testnet-stablecoin","wrapped-test-asset","ynxt-bridge-candidate","other-testnet-asset-candidate"]) if (!assetDocs.includes(assetClass) || !types.includes(assetClass)) fail("missing asset classification " + assetClass);
if (!assetDocs.includes("canonical-to-canonical") || !types.includes("canonical-to-canonical")) fail("native stablecoin canonicality boundary is missing");
if (provider.officialReference !== "https://developers.circle.com/cctp/references/contract-addresses" || provider.ynxListedOnInspectedReference !== false || provider.ynxRouteStatus !== "unavailable" || provider.contractsConfigured !== false || provider.credentialsPresent !== false || provider.fundingPresent !== false || provider.testedRemote !== false || provider.deployedPublic !== false) fail("provider record overclaims support");
if (provider.providerAPIProbe?.testedRemote !== true || provider.providerAPIProbe?.ynxRouteEvidence !== false || provider.providerAPIProbe?.endpoint !== "https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/0/6") fail("official provider API probe is missing or conflated with YNX route evidence");
if (!providerRuntime.includes("circle-cctp-v2") || !providerRuntime.includes("/v2/burn/USDC/fees/") || !providerRuntime.includes("provider redirects are not allowed") || !providerCheck.includes("iris-api-sandbox.circle.com/v2/burn/USDC/fees/0/6")) fail("Circle CCTP V2 provider runtime or remote gate is missing");
for (const field of ["license","terms","jurisdiction","authentication","rateLimit","dataRetention","dataRights","version","health","fallback","outageMode"]) if (!(field in provider.operationalReview)) fail("missing provider operational field " + field);
for (const field of ["Provider","Contracts","Tokens","Fees","Slippage","Time","Risk","Finality","Refund","Destination"]) if (!docs.toLowerCase().includes(field.toLowerCase())) fail("route disclosure field missing: " + field);
console.log("bridge route adapter check passed: official Circle CCTP V2 fee adapter connected on supported domains, YNX route unavailable, credential boundary preserved");
