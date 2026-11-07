/** Private build-time SDK role. Never a Source/Root/provider API or public SDK export. */
export type ComponentRole = 'C6_NODE9'|'C6_ORIGINAL_RECORD'|'APPROVED125A_HELPER13'|'APPROVED125A_PLIST'|'APPROVED125A_ORIGINAL_RECORD';
export interface AssetPin {readonly path:string;readonly relative:string;readonly bytes:number;readonly sha256:string;readonly mode:number;readonly role:ComponentRole;readonly machO:boolean;}
export interface SourceRoles {readonly SDKPublic:'98956ed2bbac8bb5c86de83c4f1df24314e19bf0';readonly NativeCPP:'3c9ead1f8a5920fb2428553dfed4e6943f882968';readonly NativeSwift:'c6af5521c96433f44b5fa91597fb30415a47c1d6';readonly helperCompile:'2602137a3f0382acb52c7d82ac51383153bd9f44';readonly helperRecordProducer:'9bf0726f96e66a4947a4a8d823b77b89bcc46ff9';readonly P03Consumer:'8849fc39efb6898fa9621a4f86bd3607cbb4a805';}
export function readRegular(path:string,expected?:{readonly bytes:number;readonly sha256:string;readonly mode?:number}):Uint8Array;
export function finitePath(path:string):string;
export function assertAssetSetDATA(rows:readonly AssetPin[],expected:readonly AssetPin[]):true;
export function planNormalProduct():{readonly roles:SourceRoles;readonly compilerExecuted:false;readonly NativeLoaded:false;readonly RootAdmission:false;readonly SourceAdmission:false;readonly finite7:false};
export function copyDiagnosticSDK(destination:string):{readonly SDKSourceCommit:string;readonly files:number;readonly NativeLoaded:false};
export function stageDiagnosticAssets(developer:string):{readonly staged:number;readonly roles:SourceRoles;readonly RootAdmission:false;readonly SourceAdmission:false};
export function verifyDiagnosticAssets(developer:string):{readonly assets:number;readonly byteAndModeExact:true;readonly sourceRoles:SourceRoles;readonly RootAdmission:false;readonly SourceAdmission:false};
export function postNestedDiagnostic(app:string):Promise<{readonly path:string;readonly bytes:number;readonly sha256:string}>;

export function adoptDiagnosticCocoa(input:{readonly receipt:string;readonly binary:string}):Promise<{readonly binary:string;readonly actualOutput:{readonly path:string;readonly bytes:number;readonly sha256:string};readonly compilerExecutedByAdapter:false;readonly RootAdmission:false;readonly SourceAdmission:false}>;

export function assertExactLeafSet(root:string,expected:readonly string[]):true;

export function ownedCocoaUndefinedDATA(text:string):readonly string[];
