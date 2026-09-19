// Configuration example only: no account requests, signatures or network mutations.
import {getTestnetEndpoints, testnetEndpointProfiles, YNXClient} from "../js/index.js";
const endpoints = getTestnetEndpoints();
const client = new YNXClient({restUrl: endpoints.nativeRest, evmUrl: endpoints.evmJsonRpc});
console.log(JSON.stringify({chainId: testnetEndpointProfiles.chainId, restUrl: client.restUrl,
  evmUrl: client.evmUrl, faucet: endpoints.faucet, candidateAliases: testnetEndpointProfiles.candidate,
  activation: testnetEndpointProfiles.activation, mainnetEnabled: false}, null, 2));
