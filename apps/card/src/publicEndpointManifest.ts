import manifest from "../vendor/public-endpoint-manifest-1.0.0-p0.2.json";

type RecordValue=Record<string,unknown>;

const MANIFEST_VERSION="1.0.0-p0.2";
const MANIFEST_SOURCE_COMMIT="bfd850a2c7bd238e3febc7267ff31be17890888d";
const APP_GATEWAY_ORIGIN="https://gateway.ynxweb4.com";

export function acceptedCardGatewayEndpoint():string{
  return validateAcceptedCardGatewayManifest(manifest);
}

// This validates only the bundled P0 consumer contract. It must never activate
// a remotely supplied manifest or an environment-provided endpoint.
export function validateAcceptedCardGatewayManifest(value:unknown):string{
  const candidate=record(value);
  if(!candidate||candidate.schemaVersion!=="1.0.0"||candidate.manifestVersion!==MANIFEST_VERSION||candidate.sourceCommit!==MANIFEST_SOURCE_COMMIT||candidate.environment!=="testnet"||candidate.evmChainId!==6423||candidate.evmChainHex!=="0x1917")throw manifestFailure();
  const states=record(candidate.endpointStates),appGatewayState=states&&record(states.appGateway);
  if(!appGatewayState||!isUsableState(appGatewayState.status))throw unavailableGateway();
  if(candidate.appGateway!==APP_GATEWAY_ORIGIN)throw manifestFailure();
  const parsed=new URL(APP_GATEWAY_ORIGIN);
  if(parsed.protocol!=="https:"||parsed.hostname!=="gateway.ynxweb4.com"||parsed.port||parsed.username||parsed.password||parsed.pathname!=="/"||parsed.search||parsed.hash)throw manifestFailure();
  return APP_GATEWAY_ORIGIN;
}

function isUsableState(value:unknown):value is "VERIFIED"|"DEGRADED"{return value==="VERIFIED"||value==="DEGRADED"}
function record(value:unknown):RecordValue|null{return typeof value==="object"&&value!==null&&!Array.isArray(value)?value as RecordValue:null}
function manifestFailure():Error{return Object.assign(new Error("Card Gateway is not the fixed accepted Testnet endpoint"),{code:"PRODUCT_SESSION_GATEWAY_UNREACHABLE"})}
function unavailableGateway():Error{return Object.assign(new Error("Card Gateway is unavailable in the accepted Testnet endpoint manifest"),{code:"PRODUCT_SESSION_GATEWAY_UNREACHABLE"})}
