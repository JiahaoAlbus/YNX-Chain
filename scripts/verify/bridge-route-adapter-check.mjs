import {readFileSync} from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const json = (path) => JSON.parse(read(path));
const fail = (message) => { throw new Error(message); };
const provider = json("docs/bridge/provider-status.json");
const manifest = json("docs/bridge/consumer-integration-manifest.json");
const docs = read("docs/bridge/ROUTE_ADAPTER.md");
const types = read("internal/bridgegateway/types.go");
const server = read("internal/bridgegateway/server.go");
const sdk = read("sdk/bridge/index.js");
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
if (manifest.routeCatalog?.path !== "/bridge/routes" || manifest.routeCatalog?.quotesExecutable !== false || manifest.routeCatalog?.deployedPublic !== false) fail("route catalog handoff overclaims availability");
if (!server.includes('GET /bridge/routes') || !sdk.includes("async getRoutes()") || !sdk.includes("configured-fail-closed-candidates-not-live-provider-quotes")) fail("runtime or SDK route catalog is missing");
if (provider.officialReference !== "https://developers.circle.com/cctp/references/contract-addresses" || provider.ynxListedOnInspectedReference !== false || provider.ynxRouteStatus !== "unavailable" || provider.contractsConfigured !== false || provider.credentialsPresent !== false || provider.fundingPresent !== false || provider.testedRemote !== false || provider.deployedPublic !== false) fail("provider record overclaims support");
for (const field of ["license","terms","jurisdiction","authentication","rateLimit","dataRetention","dataRights","version","health","fallback","outageMode"]) if (!(field in provider.operationalReview)) fail("missing provider operational field " + field);
for (const field of ["Provider","Contracts","Tokens","Fees","Slippage","Time","Risk","Finality","Refund","Destination"]) if (!docs.toLowerCase().includes(field.toLowerCase())) fail("route disclosure field missing: " + field);
console.log("bridge route adapter check passed: five classifications, public fail-closed catalog, null quote semantics, credential boundary, and unavailable CCTP candidate");
