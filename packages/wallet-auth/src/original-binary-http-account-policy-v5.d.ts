/** Internal original Host supplier; creates no Principal/device/HTTP signer. */
export interface OriginalBinaryV5AccountPolicyOwner {runBinaryV5:import('./product-session-gateway-node-host.js').OriginalAccountPolicyBinaryV5Runner;retire():void;join():void;close():void;status():Readonly<{closed:boolean;unknown:boolean;phase:string;entered:boolean}>;}
/** Zero input; independently release-admitted manifest/node only. Empty -> ACCOUNT_POLICY_BINARY_V5_NOT_SUPPLIED. */
export function acquireOriginalBinaryV5AccountPolicyRunner():Promise<Readonly<{owner:OriginalBinaryV5AccountPolicyOwner;error:unknown|null}>>;
export function assertOriginalBinaryV5AccountPolicyOwner(owner:unknown):OriginalBinaryV5AccountPolicyOwner;
