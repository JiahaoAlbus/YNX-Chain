export type ConnectedAppInventoryItem=Readonly<{
  requestingProduct:string;
  productClientId:string;
  bundleId:string;
  sessionBindings:readonly string[];
  activeSessionBindings:readonly string[];
  approvalDigests:readonly string[];
  deviceBindings:readonly string[];
  active:boolean;
}>;

export type SessionInventoryItem=Readonly<{
  sessionBinding:string;
  requestingProduct:string;
  productClientId:string;
  bundleId:string;
  deviceBinding:string;
  approvalDigest:string;
  scopes:readonly string[];
  purpose:string;
  issuedAt:string;
  expiresAt:string;
  active:boolean;
  inactiveReasons:readonly string[];
}>;

export type DeviceInventoryItem=Readonly<{
  deviceBinding:string;
  requestingProduct:string;
  productClientId:string;
  bundleId:string;
  sessionBindings:readonly string[];
  activeSessionBindings:readonly string[];
  revoked:boolean;
}>;

export type WalletSessionInventory=Readonly<{
  schemaVersion:1;
  account:string;
  asOf:string;
  connectedApps:readonly ConnectedAppInventoryItem[];
  devices:readonly DeviceInventoryItem[];
  sessions:readonly SessionInventoryItem[];
  approvalCount:number;
}>;

export type WalletGatewayBridgeRequest=Readonly<{
  method:"POST";
  path:"/v1/wallet/sessions";
  contentType:"application/json";
  body:"{}";
}>;

export type WalletGatewayBridgeResponse=Readonly<{
  status:number;
  body:string;
}>;

export type WalletGatewayBridge=(request:WalletGatewayBridgeRequest)=>Promise<WalletGatewayBridgeResponse>;

export class WalletSessionInventoryClient{
  readonly #bridge:WalletGatewayBridge;
  constructor(bridge:WalletGatewayBridge){if(typeof bridge!=="function")throw new Error("Canonical Wallet Gateway bridge is unavailable");this.#bridge=bridge}

  async load(account:string,now=new Date()):Promise<WalletSessionInventory>{
    if(!/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(account))throw new Error("Selected Wallet account is invalid");
    if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw new Error("Wallet inventory clock is invalid");
    const response=await this.#bridge({method:"POST",path:"/v1/wallet/sessions",contentType:"application/json",body:"{}"});
    if(!Number.isSafeInteger(response?.status)||typeof response?.body!=="string"||response.body.length<2||response.body.length>1_048_576)throw new Error("Canonical Wallet Gateway response is invalid");
    let value:unknown;try{value=JSON.parse(response.body)}catch{throw new Error("Canonical Wallet Gateway returned non-JSON")};
    if(response.status!==200)throw new Error(`Canonical Wallet Gateway rejected session inventory (${response.status}): ${gatewayError(value)}`);
    const payload=exactObject(value,["ok","result","schemaVersion","stateDigest"],"Gateway inventory envelope");
    if(payload.ok!==true||payload.schemaVersion!==1||!digest(payload.stateDigest))throw new Error("Canonical Wallet Gateway inventory envelope is invalid");
    const result=parseInventory(payload.result);
    if(result.account!==account)throw new Error("Canonical Wallet Gateway inventory account does not match the selected Wallet");
    const asOf=Date.parse(result.asOf);
    if(asOf>now.getTime()+60_000||now.getTime()-asOf>5*60_000)throw new Error("Canonical Wallet Gateway inventory is stale or issued in the future");
    return result;
  }
}

function parseInventory(value:unknown):WalletSessionInventory{
  const input=exactObject(value,["schemaVersion","account","asOf","connectedApps","approvals","devices","sessions"],"Wallet session inventory");
  if(input.schemaVersion!==1||typeof input.account!=="string"||typeof input.asOf!=="string"||new Date(input.asOf).toISOString()!==input.asOf)throw new Error("Wallet session inventory identity is invalid");
  const connectedApps=array(input.connectedApps,"connectedApps").map(parseConnectedApp);
  const approvals=array(input.approvals,"approvals").map(parseApproval);
  const devices=array(input.devices,"devices").map(parseDevice);
  const sessions=array(input.sessions,"sessions").map(parseSession);
  unique(connectedApps.map(item=>`${item.productClientId}\n${item.bundleId}`),"connected App");
  unique(devices.map(item=>item.deviceBinding),"device");
  unique(sessions.map(item=>item.sessionBinding),"session");
  return Object.freeze({schemaVersion:1,account:input.account,asOf:input.asOf,connectedApps:Object.freeze(connectedApps),devices:Object.freeze(devices),sessions:Object.freeze(sessions),approvalCount:approvals.length});
}

function parseApproval(value:unknown){
  const item=exactObject(value,["approvalDigest","requestingProduct","productClientId","bundleId","sessionBindings","activeSessionBindings","revoked"],"approval");
  strings(item,["requestingProduct","productClientId","bundleId"]);if(!digest(item.approvalDigest)||typeof item.revoked!=="boolean")throw new Error("Connected approval entry is invalid");
  return Object.freeze({approvalDigest:item.approvalDigest,sessionBindings:digests(item.sessionBindings,"sessionBindings"),activeSessionBindings:digests(item.activeSessionBindings,"activeSessionBindings"),revoked:item.revoked});
}

function parseConnectedApp(value:unknown):ConnectedAppInventoryItem{
  const item=exactObject(value,["requestingProduct","productClientId","bundleId","sessionBindings","activeSessionBindings","approvalDigests","deviceBindings","active"],"connected App");
  strings(item,["requestingProduct","productClientId","bundleId"]);if(typeof item.active!=="boolean")throw new Error("Connected App active state is invalid");
  return Object.freeze({...item,requestingProduct:item.requestingProduct as string,productClientId:item.productClientId as string,bundleId:item.bundleId as string,sessionBindings:digests(item.sessionBindings,"sessionBindings"),activeSessionBindings:digests(item.activeSessionBindings,"activeSessionBindings"),approvalDigests:digests(item.approvalDigests,"approvalDigests"),deviceBindings:digests(item.deviceBindings,"deviceBindings"),active:item.active});
}

function parseDevice(value:unknown):DeviceInventoryItem{
  const item=exactObject(value,["deviceBinding","requestingProduct","productClientId","bundleId","productDeviceAlgorithm","productDeviceKey","sessionBindings","activeSessionBindings","revoked"],"device");
  strings(item,["requestingProduct","productClientId","bundleId"]);if(!digest(item.deviceBinding)||item.productDeviceAlgorithm!=="p256-sha256"||typeof item.productDeviceKey!=="string"||typeof item.revoked!=="boolean")throw new Error("Connected device entry is invalid");
  return Object.freeze({deviceBinding:item.deviceBinding,requestingProduct:item.requestingProduct as string,productClientId:item.productClientId as string,bundleId:item.bundleId as string,sessionBindings:digests(item.sessionBindings,"sessionBindings"),activeSessionBindings:digests(item.activeSessionBindings,"activeSessionBindings"),revoked:item.revoked});
}

function parseSession(value:unknown):SessionInventoryItem{
  const item=exactObject(value,["sessionBinding","requestingProduct","productClientId","bundleId","callback","productDeviceAlgorithm","productDeviceKey","deviceBinding","approvalDigest","scopes","purpose","issuedAt","expiresAt","active","inactiveReasons"],"session");
  strings(item,["requestingProduct","productClientId","bundleId","purpose","issuedAt","expiresAt"]);if(!digest(item.sessionBinding)||!digest(item.deviceBinding)||!digest(item.approvalDigest)||typeof item.active!=="boolean")throw new Error("Connected session entry is invalid");
  return Object.freeze({sessionBinding:item.sessionBinding,requestingProduct:item.requestingProduct as string,productClientId:item.productClientId as string,bundleId:item.bundleId as string,deviceBinding:item.deviceBinding,approvalDigest:item.approvalDigest,scopes:texts(item.scopes,"scopes"),purpose:item.purpose as string,issuedAt:item.issuedAt as string,expiresAt:item.expiresAt as string,active:item.active,inactiveReasons:texts(item.inactiveReasons,"inactiveReasons")});
}

function exactObject(value:unknown,fields:readonly string[],label:string):Record<string,unknown>{if(!object(value)||Object.keys(value).sort().join("\n")!==[...fields].sort().join("\n"))throw new Error(`${label} fields are invalid`);return value}
function object(value:unknown):value is Record<string,unknown>{return typeof value==="object"&&value!==null&&!Array.isArray(value)}
function array(value:unknown,label:string):unknown[]{if(!Array.isArray(value)||value.length>250)throw new Error(`${label} is invalid`);return value}
function texts(value:unknown,label:string):readonly string[]{const items=array(value,label);if(items.some(item=>typeof item!=="string"||item.length<1||item.length>500))throw new Error(`${label} is invalid`);return Object.freeze(items as string[])}
function digests(value:unknown,label:string):readonly string[]{const items=texts(value,label);if(items.some(item=>!digest(item)))throw new Error(`${label} is invalid`);unique(items,label);return items}
function digest(value:unknown):value is string{return typeof value==="string"&&/^[0-9a-f]{64}$/.test(value)}
function strings(value:Record<string,unknown>,fields:readonly string[]){if(fields.some(field=>typeof value[field]!=="string"||(value[field] as string).length<1||(value[field] as string).length>500))throw new Error("Wallet session inventory text field is invalid")}
function unique(values:readonly string[],label:string){if(new Set(values).size!==values.length)throw new Error(`Wallet session inventory contains duplicate ${label} entries`)}
function gatewayError(value:unknown){if(!object(value)||!object(value.error)||typeof value.error.code!=="string")return"unknown error";return value.error.code}
