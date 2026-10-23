// Source preparation only. Original A executes the existing Native build tool.
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join,dirname,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
const here=fileURLToPath(import.meta.url);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const hash=raw=>createHash('sha256').update(raw).digest('hex');
export function verifySDK332R140Source(sourceRoot){
  if(typeof sourceRoot!=='string'||!isAbsolute(sourceRoot)||resolve(sourceRoot)!==sourceRoot)fail('SDK332_R140_ROOT_INVALID');
  const root=realpathSync(sourceRoot);
  const contract=JSON.parse(readFileSync(join(root,'packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json')));
  const pkg=JSON.parse(readFileSync(join(root,'packages/wallet-auth/package.json')));
  if(contract.version!=='1.3.0-pq.3.32-auth.10'||pkg.version!==contract.version||!isDeepStrictEqual(pkg.exports,contract.publicExports))fail('SDK332_R140_PACKAGE_SELECTION_INVALID');
  // Pure deployment codecs join this canonical Auth line; independent file pins
  // bind the supplier bytes while Native selection remains the matching64 Node/69 paired inputs.
  const pure=['pq-contract-deployment-transport.js','pq-contract-deployment-transport.d.ts','pq-contract-deployment-transport-node.js','pq-contract-deployment-transport-node.d.ts'].map(n=>'packages/wallet-auth/src/'+n);
  if(!Array.isArray(contract.pureDeploymentInputs)||JSON.stringify(contract.pureDeploymentInputs.map(p=>p.path))!==JSON.stringify(pure))fail('SDK332_R140_DEPLOYMENT_INVENTORY_INVALID');
  if(!Array.isArray(contract.NativeInputs)||contract.NativeInputs.length!==64||!Array.isArray(contract.HelperInputs)||contract.HelperInputs.length!==5)fail('SDK332_R140_NATIVE_INVENTORY_INVALID');
  const seen=new Set();
  for(const pin of [...contract.NativeInputs,...contract.HelperInputs,...contract.pureDeploymentInputs,contract.normalBuildTool]){
    if(typeof pin.path!=='string'||isAbsolute(pin.path)||pin.path.includes('\\')||pin.path.split('/').some(p=>!p||p==='.'||p==='..')||!resolve(root,pin.path).startsWith(root+'/')||seen.has(pin.path))fail('SDK332_R140_NATIVE_PATH_INVALID');
    seen.add(pin.path);const file=join(root,pin.path),st=lstatSync(file);
    if(!st.isFile()||st.isSymbolicLink())fail('SDK332_R140_NATIVE_NOT_REGULAR');
    const raw=readFileSync(file);
    if(raw.length!==pin.bytes||hash(raw)!==pin.sha256)fail('SDK332_R140_NATIVE_INPUT_DIFFERS');
  }
  return {root,contract};
}
export async function sdk332R140NativePlan(sourceRoot,headersRoot,arch='arm64'){
  const {root,contract}=verifySDK332R140Source(sourceRoot);
  const tool=join(root,contract.normalBuildTool.path);
  const {originalAuthNativeBuildPlan,originalIDEHelperBuildPlan}=await import(pathToFileURL(tool).href);
  const plan=originalAuthNativeBuildPlan(arch,headersRoot),helperPlan=originalIDEHelperBuildPlan(arch);
  if(plan.sources.length!==12||helperPlan.sources.length!==11||plan.minimumSystemVersion!=='13.0')fail('SDK332_R140_NORMAL_RECIPE_DIFFERS');
  for(const selected of [plan,helperPlan])if(!isDeepStrictEqual(selected.ownedUndefinedScan,{tool:'/usr/bin/nm',argv:['-u',selected.output],rejectPattern:'YNX|ynx'}))fail('SDK332_R140_OWNED_SYMBOL_GUARD_MISSING');
  for(const command of plan.commands.filter(c=>c.tool==='/usr/bin/clang++')){
    for(const flag of ['-DNAPI_VERSION=8','-fobjc-arc','-std=c++17','-lbsm','-mmacosx-version-min=13.0'])if(!command.argv.includes(flag))fail('SDK332_R140_NORMAL_RECIPE_DIFFERS');
    for(const framework of ['Foundation','Security','AppKit','ServiceManagement'])if(!command.argv.some((v,i)=>v==='-framework'&&command.argv[i+1]===framework))fail('SDK332_R140_NORMAL_RECIPE_DIFFERS');
  }
  return {version:contract.version,sourceRoot:root,NativeInputs:contract.NativeInputs,
    HelperInputs:contract.HelperInputs,helperPlan,normalHelperBuildCommand:{tool:process.execPath,argv:[tool,'helper',arch]},normalBuildTool:contract.normalBuildTool,normalBuildCommand:{tool:process.execPath,argv:[tool,arch,headersRoot]},
    plan,rebuildRequired:true,prebuiltSDK330ModuleAllowed:false,prebuiltR140ModuleAllowed:false,pairedBuildRequired:true,contractRelayProducerRequired:true,contractRelayProducerQualified:false,artifactNativeEffectQualified:false,NativeBuild:false,grant:false};
}
if(process.argv[1]&&resolve(process.argv[1])===here){
  if(process.argv.length<3||process.argv.length>4)fail('SDK332_R140_PINNED_HEADERS_REQUIRED');
  console.log(JSON.stringify(await sdk332R140NativePlan(resolve(dirname(here),'../../..'),process.argv[2],process.argv[3]??'arm64'),null,2));
}
