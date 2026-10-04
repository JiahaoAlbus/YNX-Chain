import {readFile,readdir,realpath} from "node:fs/promises";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../../../",import.meta.url));
const toolRequire=createRequire(path.join(root,"apps/wallet/package.json")),parserEntry=toolRequire.resolve("@babel/parser"),parser=toolRequire("@babel/parser");
const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
const parse=text=>parser.parse(text,{sourceType:"module",plugins:["typescript","jsx"]}).program.body;
/** Direct runtime ESM declarations only, not dependency admission. Includes
 * barrel edges; ignores body strings without evaluating any source. Dynamic
 * imports, require(), resolution and full transitive closure are out of scope. */
export function staticModuleSpecifiers(text){
  return parse(text).flatMap(node=>{
    if(!node.source||!["ImportDeclaration","ExportAllDeclaration","ExportNamedDeclaration"].includes(node.type))return[];
    const kind=node.type==="ImportDeclaration"?"import":"reexport";
    if(node.importKind==="type"||node.exportKind==="type")return[];
    if(node.specifiers?.length&&node.specifiers.every(item=>item.importKind==="type"||item.exportKind==="type"))return[];
    return[{kind,specifier:node.source.value,line:node.loc.start.line}];
  });
}
export function sdkImports(text){
  return parse(text).filter(node=>node.type==="ImportDeclaration"&&node.source.value==="@ynx-chain/wallet-auth"&&node.importKind!=="type").flatMap(node=>node.specifiers.filter(item=>item.importKind!=="type").map(item=>({name:item.type==="ImportSpecifier"?(item.imported.name??item.imported.value):item.type==="ImportDefaultSpecifier"?"default":"*",local:item.local.name,line:item.loc.start.line})));
}
function pattern(node){if(!node)return[];if(node.type==="Identifier")return[node.name];if(node.type==="ObjectPattern")return node.properties.flatMap(item=>pattern(item.value??item.argument));if(node.type==="ArrayPattern")return node.elements.flatMap(pattern);if(node.type==="RestElement")return pattern(node.argument);if(node.type==="AssignmentPattern")return pattern(node.left);return[];}
export function exportSyntax(text){
  const names=new Set(),stars=[],named=[];
  for(const node of parse(text)){
    if(node.type==="ExportDefaultDeclaration")names.add("default");
    if(node.type==="ExportAllDeclaration")stars.push(node.source.value);
    if(node.type!=="ExportNamedDeclaration"||node.exportKind==="type")continue;
    const declaration=node.declaration;
    if(declaration?.type==="VariableDeclaration")for(const item of declaration.declarations)for(const name of pattern(item.id))names.add(name);
    else if(["FunctionDeclaration","ClassDeclaration"].includes(declaration?.type)&&declaration.id)names.add(declaration.id.name);
    for(const item of node.specifiers){if(item.exportKind==="type")continue;const name=item.exported.name??item.exported.value;if(node.source&&item.type==="ExportSpecifier")named.push({source:node.source.value,imported:item.local.name??item.local.value,exported:name});else names.add(name);}
  }
  return{names:[...names],stars,named};
}
export async function sourceExportSurface(entry){
  const nodes=new Map(),unresolved=[];
  async function load(file){
    file=await realpath(file);if(nodes.has(file))return file;
    const bytes=await readFile(file),syntax=exportSyntax(bytes.toString("utf8")),node={file,sha256:digest(bytes),syntax,links:new Map(),names:new Set(syntax.names)};nodes.set(file,node);
    for(const specifier of [...syntax.stars,...syntax.named.map(item=>item.source)]){
      if(node.links.has(specifier))continue;
      if(!specifier.startsWith(".")){unresolved.push({file,specifier});node.links.set(specifier,null);continue;}
      node.links.set(specifier,await load(path.resolve(path.dirname(file),specifier)));
    }
    return file;
  }
  const actualEntry=await load(entry);let changed;
  // Union reaches a fixed point for cyclic local barrels. This is deliberately
  // an export-name upper bound, not ESM ambiguity or executable graph admission.
  do{changed=false;for(const node of nodes.values()){
    const add=name=>{if(!node.names.has(name)){node.names.add(name);changed=true}};
    for(const specifier of node.syntax.stars){const linked=nodes.get(node.links.get(specifier));if(linked)for(const name of linked.names)if(name!=="default")add(name);}
    for(const item of node.syntax.named){const linked=nodes.get(node.links.get(item.source));if(linked?.names.has(item.imported))add(item.exported);}
  }}while(changed);
  return{entry:actualEntry,names:[...nodes.get(actualEntry).names].sort(),unresolved,files:[...nodes.values()].map(({file,sha256})=>({file,sha256})).sort((a,b)=>a.file.localeCompare(b.file))};
}
async function sourceFiles(directory){const result=[];for(const entry of await readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())result.push(...await sourceFiles(file));else if(entry.isFile()&&/\.(?:mjs|js|ts|tsx)$/.test(entry.name)&&!/(?:\.test\.|\.d\.ts$)/.test(entry.name))result.push(file);}return result;}
export async function auditCurrentSDK(){
  const sdk=path.join(root,"packages/wallet-auth"),metadata=JSON.parse(await readFile(path.join(sdk,"package.json"),"utf8")),entry=metadata.exports?.["."]?.import;
  if(typeof entry!=="string"||!entry.startsWith("./"))throw Error("No explicit current SDK import entry");
  const exports=await sourceExportSurface(path.join(sdk,entry)),imports=[],sources=[];
  const files=[...await sourceFiles(path.join(root,"apps/wallet/src")),...await sourceFiles(path.join(root,"apps/wallet-desktop/src")),path.join(root,"apps/wallet/App.tsx"),path.join(root,"apps/wallet/index.ts")];
  for(const file of files.sort()){const bytes=await readFile(file),relative=path.relative(root,file);sources.push({file:relative,sha256:digest(bytes)});for(const item of sdkImports(bytes.toString("utf8")))imports.push({file:relative,usage:/Fixture\./.test(relative)?"test-support":"potential-product-source",...item});}
  const missing=imports.filter(item=>item.name!=="*"&&!exports.names.includes(item.name));
  const desktopResolvedPath=await realpath(path.join(root,"apps/wallet-desktop/node_modules/@ynx-chain/wallet-auth")),nativeResolvedPath=await realpath(path.join(root,"apps/wallet/node_modules/@ynx-chain/wallet-auth")),sdkRoot=await realpath(sdk);
  for(const item of [...sources.map(item=>({...item,file:path.join(root,item.file)})),...exports.files])if(digest(await readFile(item.file))!==item.sha256)throw Error("Source changed during static audit");
  const packageBytes=await readFile(path.join(sdk,"package.json"));if(JSON.stringify(JSON.parse(packageBytes))!==JSON.stringify(metadata))throw Error("SDK metadata changed during static audit");
  return{schemaVersion:1,observedAt:new Date().toISOString(),scope:"Direct root SDK runtime import syntax in all owned src/App/index modules, not entrypoint reachability or full dependency graph",status:desktopResolvedPath!==sdkRoot||nativeResolvedPath!==sdkRoot?"SOURCE_BINDING_MISMATCH":exports.unresolved.length?"SOURCE_SURFACE_UNRESOLVED":missing.length?"SOURCE_IMPORT_MISMATCH":"SOURCE_NAMES_PRESENT_NOT_ADMISSION",tool:{parserEntry,parserSHA256:digest(await readFile(parserEntry))},sdk:{packageName:metadata.name,version:metadata.version,entry:exports.entry,packageSHA256:digest(packageBytes),desktopResolvedPath,nativeResolvedPath},imports,missing,exports,sources,readbackStable:true,limits:["AST/source reads only; no SDK module executes","Local export-name union is an upper bound; conflicting star exports, dependency resolution, runtime factories and actual semantics are NOT_VERIFIED","Type-only imports excluded from runtime count; this is not typecheck; src test-support helpers are explicitly tagged and not claimed as launched production modules","No account, journal, network, signing, OS, installer or private Pay execution","Missing required names with fully resolved local barrels proves this local SDK source cannot satisfy those runtime named imports; presence does not prove admission"]};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const result=await auditCurrentSDK();process.stdout.write(JSON.stringify(result,null,2)+"\n");if(result.status!=="SOURCE_NAMES_PRESENT_NOT_ADMISSION")process.exitCode=2;}
