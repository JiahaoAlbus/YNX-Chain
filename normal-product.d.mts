/** Build custody only. No Source/Root admission, Native factory or public provider. */
export interface Pin {readonly path:string;readonly bytes:number;readonly sha256:string;readonly mode?:number;}
export interface Asset extends Pin {readonly relative:string;readonly role:string;readonly sourceMode:number;readonly machO:boolean;}
export interface MatchedNodeSourceRoles {readonly CPPBase:'3c9ead1f8a5920fb2428553dfed4e6943f882968';readonly SwiftBase:'c6af5521c96433f44b5fa91597fb30415a47c1d6';readonly originalFiniteNAPIProducer:'86d0d24c052843516c6cf79e2fe2ee859d43358a';readonly projectControlSource:'4a807cdc6e09c25467f06cc912a655a294ccc975';readonly NodeOriginalSourceUnchanged:true;readonly NodeCompileClosureChanged:true;}
export interface ProductRoles {readonly SDKPublic:'4a807cdc6e09c25467f06cc912a655a294ccc975';readonly CocoaCompiledSDK:'98956ed2bbac8bb5c86de83c4f1df24314e19bf0';readonly NativeCPP:'3c9ead1f8a5920fb2428553dfed4e6943f882968';readonly NativeSwift:'c6af5521c96433f44b5fa91597fb30415a47c1d6';readonly NodeComposite:MatchedNodeSourceRoles;readonly helperCompile:string;readonly helperRecordProducer:string;readonly P03Consumer:string;readonly P03DiagnosticConsumer:string;readonly P03AssemblyBaseline:string;readonly P03CoreFrontend:string;}
export function readRegular(path:string,expected?:Pin):Buffer;
export function ownedCocoaUndefinedDATA(text:string):string[];
export function planNormalProduct():{readonly roles:ProductRoles;readonly assets:readonly Omit<Asset,'path'>[];readonly compilerExecuted:false;readonly NativeLoaded:false;readonly RootAdmission:false;readonly SourceAdmission:false;readonly finite7:false;};
export function copyDiagnosticSDK(destination:string):{SDKSourceCommit:string;files:number;NativeLoaded:false};
export function stageDiagnosticAssets(developer:string):{staged:13;roles:ProductRoles;RootAdmission:false;SourceAdmission:false};
export function verifyDiagnosticAssets(developer:string):{assets:13;byteAndModeExact:true;sourceRoles:ProductRoles;RootAdmission:false;SourceAdmission:false};
export function adoptDiagnosticCocoa(args:{readonly receipt:string;readonly binary:string}):Promise<{binary:string;compiledSourceRoles:Readonly<Record<string,string>>;compilerExecutedByAdapter:false;RootAdmission:false;SourceAdmission:false;SDKResourceSource:string;CocoaSourceRoleUnchanged:true;SDKJSChangedRequiresNoCocoaRebuild:true}>;
export function postNestedDiagnostic(canonicalApp:string):Promise<Pin>;
