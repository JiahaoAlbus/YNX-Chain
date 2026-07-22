import { readFileSync } from "node:fs";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const manifest = read("docs/bridge/consumer-integration-manifest.json");
const vectors = read("docs/bridge/consumer-lifecycle-vectors.json");
const provider = read("docs/bridge/provider-status.json");
const fail = (message) => { throw new Error(message); };

if (manifest.schemaVersion !== 1 || manifest.currentIntegrationState !== "handoff_only_not_integrated") fail("manifest integration state is invalid");
if (manifest.publicRead.path !== "/bridge/transparency" || manifest.publicRead.deployedPublic !== false) fail("public read boundary is invalid");
if (manifest.protectedCoordinatorBoundary.consumerCredentialAccess !== false || manifest.protectedCoordinatorBoundary.browserCredentialAccess !== false || manifest.protectedCoordinatorBoundary.walletSecretAccess !== false || manifest.protectedCoordinatorBoundary.centralGatewayIntegrated !== false) fail("protected boundary is invalid");
const expectedConsumers = ["wallet","pay","exchange","dex","finance","explorer","monitor","trust"];
if (manifest.consumers.map(({id}) => id).join(",") !== expectedConsumers.join(",")) fail("consumer set or order is invalid");
const phases = new Set(manifest.lifecycle);
for (const vector of vectors.vectors) {
  if (!phases.has(vector.phase)) fail(`unknown vector phase ${vector.phase}`);
  const confirmed = vector.phase === "destination_confirmed";
  if (vector.assetAvailable !== confirmed || vector.mayPay !== confirmed || vector.mayCreditExchange !== confirmed) fail(`availability overclaim in ${vector.id}`);
}
if (provider.provider !== "Circle" || provider.product !== "CCTP" || provider.ynxListedOnInspectedReference !== false || provider.ynxRouteStatus !== "unavailable" || provider.credentialsPresent !== false || provider.contractsConfigured !== false || provider.testedRemote !== false || provider.deployedPublic !== false) fail("provider status overclaims availability");
const serialized = JSON.stringify({manifest,vectors,provider});
for (const forbidden of ["Codex", "Worktree", "/Users/", "localhost", "127.0.0.1"]) if (serialized.includes(forbidden)) fail(`public handoff contains forbidden internal value ${forbidden}`);
console.log("bridge integration check passed: eight consumer contracts, destination-confirmed availability gate, protected credential boundary, and unavailable CCTP status");
