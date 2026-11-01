export interface OriginalIDEPrivateStartupSelection {
 readonly sourceSelection:Readonly<{rootPath:string;rootDigest:string;rolePath:string;roleDigest:string}>;
 readonly receiptSelection:Readonly<{receiptPath:string;receiptDigest:string}>;
 readonly expectedRequest:Readonly<Record<string,unknown>>;
 readonly receiptDirectory:string;
}
export interface OriginalIDEFourOperationAdmission {assertCurrent(input:Readonly<{service:'wallet-product-session-v2';productId:'developer';platform:'macos';gatewayOrigin:'https://wallet-auth.ynxweb4.com';operation:'beginYNX'|'handleReturn'|'restore'|'disconnect'}>):void}
/** Owner-only selection; actual original Resources/server.mjs import.meta.url, checked against process.argv[1]. No renderer/ENV/expected hash argument. */
export function prepareOriginalIDEServiceAdmissionStartup(selection:OriginalIDEPrivateStartupSelection|null,runningBackendModuleURL:string,originalNow:()=>Date):OriginalIDEFourOperationAdmission;
