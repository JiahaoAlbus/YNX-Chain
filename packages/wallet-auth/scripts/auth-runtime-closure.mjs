// Build-time inventory only. Never imports a target module, fetches a resource,
// starts a Source or grants trust. Native separately pins and protects originals.
// AST checks cover the reviewed frozen graph, not arbitrary adversarial JS.
import ts from 'typescript';
import {lstatSync,readdirSync,readFileSync,existsSync} from 'node:fs';
import {resolve,dirname,join,relative,sep,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isBuiltin} from 'node:module';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
export const AUTH_RUNTIME_MANIFEST_VERSION='YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1';
export const AUTH_RUNTIME_MANIFEST_PATH='native/original-ide-auth-runtime-manifest.json';
export const AUTH_RUNTIME_REQUIRED_FILES=Object.freeze(['package.json','native/original-auth-identity-source-verifier.mjs','native/original-ide-auth-proof-dispatch.mjs','native/original-auth-identity-v2-contract.mjs','src/auth-identity-verification.js','src/pq-wallet-policy.js','src/pq-wallet-authorization.js']);
const defaults=['native/original-auth-identity-source-verifier.mjs','src/auth-identity-verification.js'];
const failure=code=>{throw Object.assign(new Error(code),{code});};
const ascii=p=>typeof p==='string'&&/^[\x20-\x7e]+$/.test(p)&&!p.includes('\\')&&!p.startsWith('/')&&!p.endsWith('/')&&p.split('/').every(v=>v&&v!=='.'&&v!=='..');
function regularPath(path,wantDirectory=false){
 const absolute=resolve(path);let cursor=absolute;
 while(true){const st=lstatSync(cursor);if(st.isSymbolicLink())failure('AUTH_RUNTIME_SYMLINK');if(cursor===absolute&&(wantDirectory?!st.isDirectory():!st.isFile()))failure('AUTH_RUNTIME_NONREGULAR');if(cursor===dirname(cursor))break;cursor=dirname(cursor);}
 return absolute;
}
function plain(v,keys){
 if(!v||Object.getPrototypeOf(v)!==Object.prototype)failure('AUTH_RUNTIME_MANIFEST_SCHEMA');
 const ds=Object.getOwnPropertyDescriptors(v),actual=Reflect.ownKeys(ds);
 if(actual.length!==keys.length||keys.some(k=>!ds[k]||!Object.hasOwn(ds[k],'value'))||actual.some(k=>!keys.includes(k)))failure('AUTH_RUNTIME_MANIFEST_SCHEMA');
}
function canonical(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';}
function resolverBatch(items){
 if(!items.length)return [];
 const code="import {readFileSync} from 'node:fs'; const rows=JSON.parse(readFileSync(0,'utf8')); console.log(JSON.stringify(rows.map(r=>import.meta.resolve(r.specifier,r.parent))));";
 const env={...process.env};delete env.NODE_OPTIONS;
 const child=spawnSync(process.execPath,['--experimental-import-meta-resolve','--input-type=module','-e',code],{input:JSON.stringify(items),encoding:'utf8',env,timeout:30000,maxBuffer:8<<20});
 if(child.error)throw child.error;if(child.status!==0)failure('AUTH_RUNTIME_IMPORT_RESOLUTION_FAILED');
 const values=JSON.parse(child.stdout);if(!Array.isArray(values)||values.length!==items.length)failure('AUTH_RUNTIME_IMPORT_RESOLUTION_FAILED');return values;
}
function moduleReferences(raw,file){
 const sf=ts.createSourceFile(file,raw,ts.ScriptTarget.Latest,true,file.endsWith('.cjs')?ts.ScriptKind.JS:ts.ScriptKind.JS);
 if(sf.parseDiagnostics.length)failure('AUTH_RUNTIME_MODULE_PARSE');
 const refs=[];const resourceReaders=new Set(['readFileSync','readFile']);
 for(const statement of sf.statements)if(ts.isImportDeclaration(statement)&&statement.importClause?.namedBindings&&ts.isNamedImports(statement.importClause.namedBindings))for(const item of statement.importClause.namedBindings.elements)if(['readFileSync','readFile'].includes((item.propertyName??item.name).text))resourceReaders.add(item.name.text);
 const literal=n=>n&&(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n));
 const add=(node,kind)=>{if(literal(node)&&['node:module','module','node:vm','vm','node:child_process','child_process','node:worker_threads','worker_threads'].includes(node.text))failure('AUTH_RUNTIME_INDIRECT_CODE_UNSUPPORTED');if(!literal(node))failure('AUTH_RUNTIME_DYNAMIC_IMPORT_UNSUPPORTED');refs.push({specifier:node.text,kind});};
 function visit(n){
  if(ts.isImportDeclaration(n)||ts.isExportDeclaration(n)){if(n.moduleSpecifier)add(n.moduleSpecifier,'import');}
  if(ts.isNewExpression(n)&&n.expression.getText(sf)==='Function')failure('AUTH_RUNTIME_INDIRECT_CODE_UNSUPPORTED');
  if(ts.isCallExpression(n)){
   const expr=n.expression;
   if(expr.kind===ts.SyntaxKind.ImportKeyword){if(n.arguments.length!==1)failure('AUTH_RUNTIME_IMPORT_ATTRIBUTES_UNSUPPORTED');add(n.arguments[0],'dynamic-import');}
   if((ts.isIdentifier(expr)&&expr.text==='require')||(ts.isPropertyAccessExpression(expr)&&expr.name.text==='require'))failure('AUTH_RUNTIME_REQUIRE_UNSUPPORTED');
   if(ts.isPropertyAccessExpression(expr)&&expr.getText(sf)==='import.meta.resolve'){if(n.arguments.length!==1)failure('AUTH_RUNTIME_RESOLVE_UNSUPPORTED');add(n.arguments[0],'resolve');}
   if((ts.isIdentifier(expr)&&['eval','Function','createRequire'].includes(expr.text))||(ts.isPropertyAccessExpression(expr)&&['globalThis','window','global'].includes(expr.expression.getText(sf))&&['eval','Function'].includes(expr.name.text)))failure('AUTH_RUNTIME_INDIRECT_CODE_UNSUPPORTED');
   // The only resource read used by this graph is readFileSync(new URL(...)).
   // Whole-package inventory covers it; explicitly resolve its static base.
   if((ts.isIdentifier(expr)&&resourceReaders.has(expr.text))||(ts.isPropertyAccessExpression(expr)&&['readFileSync','readFile'].includes(expr.name.text))){
    const resource=n.arguments[0];
    if(!resource||!ts.isNewExpression(resource)||resource.expression.getText(sf)!=='URL'||resource.arguments?.length!==2||!literal(resource.arguments[0]))failure('AUTH_RUNTIME_RESOURCE_UNSUPPORTED');
    const base=resource.arguments[1];
    if(base.getText(sf)==='import.meta.url')refs.push({specifier:resource.arguments[0].text,kind:'resource'});
    else if(!(ts.isCallExpression(base)&&base.expression.getText(sf)==='import.meta.resolve'&&base.arguments.length===1&&literal(base.arguments[0])))failure('AUTH_RUNTIME_RESOURCE_UNSUPPORTED');
    else refs.push({specifier:base.arguments[0].text,kind:'resource-base',resource:resource.arguments[0].text});
   }
  }
  ts.forEachChild(n,visit);
 }
 visit(sf);return refs;
}
export function generateAuthRuntimeClosure(packageRoot,{entries=defaults}={}){
 if(typeof packageRoot!=='string'||!isAbsolute(packageRoot)||resolve(packageRoot)!==packageRoot)failure('AUTH_RUNTIME_ROOT_INVALID');
 const root=regularPath(packageRoot,true),files=new Map(),queue=[],queued=new Set(),edges=[],packages=new Set();
 const inside=path=>{const p=resolve(path),r=relative(root,p).split(sep).join('/');if(!ascii(r)||r.startsWith('../'))failure('AUTH_RUNTIME_ESCAPE');return r;};
 const addFile=path=>{const r=inside(path);if(r===AUTH_RUNTIME_MANIFEST_PATH)return;if(files.has(r))return;regularPath(path);const before=lstatSync(path),raw=readFileSync(path),after=lstatSync(path);regularPath(path);if(!raw.length)failure('AUTH_RUNTIME_EMPTY_FILE');if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||raw.length!==after.size)failure('AUTH_RUNTIME_FILE_CHANGED');files.set(r,Object.freeze({bytes:raw.length,path:r,sha256:createHash('sha256').update(raw).digest('hex')}));if(files.size>30000)failure('AUTH_RUNTIME_INVENTORY_CAPACITY');};
 const walk=dir=>{regularPath(dir,true);for(const name of readdirSync(dir).sort()){const path=join(dir,name),st=lstatSync(path);if(st.isSymbolicLink())failure('AUTH_RUNTIME_SYMLINK');if(st.isDirectory()){if(name!=='node_modules')walk(path);}else addFile(path);}};
 const controls=path=>{for(let d=dirname(path);;d=dirname(d)){if(d!==root&&!d.startsWith(root+sep))failure('AUTH_RUNTIME_ESCAPE');const p=join(d,'package.json');if(existsSync(p))addFile(p);if(d===root)break;}};
 const enqueue=path=>{inside(path);regularPath(path);addFile(path);controls(path);if(!queued.has(path)&&/\.(mjs|cjs|js)$/.test(path)){queued.add(path);queue.push(path);}};
 const inventoryPackage=path=>{const r=inside(path),parts=r.split('/');let i=parts.lastIndexOf('node_modules');if(i<0)return;const count=parts[i+1]?.startsWith('@')?3:2;const dir=join(root,...parts.slice(0,i+count));if(!packages.has(dir)){packages.add(dir);walk(dir);}};
 function checkCandidate(specifier,parent){
  if(isBuiltin(specifier))return;
  if(specifier.startsWith('file:')||specifier.startsWith('./')||specifier.startsWith('../')){const path=fileURLToPath(new URL(specifier,pathToFileURL(parent)));inside(path);regularPath(path);return;}
  if(specifier.startsWith('#'))return; // actual Node imports map and controls pinned
  if(specifier.includes(':')||specifier.startsWith('/'))failure('AUTH_RUNTIME_IMPORT_UNSUPPORTED');
  const pieces=specifier.split('/'),name=pieces[0].startsWith('@')?pieces.slice(0,2).join('/'):pieces[0];
  for(let d=dirname(parent);;d=dirname(d)){
   if(d!==root&&!d.startsWith(root+sep))failure('AUTH_RUNTIME_ESCAPE');
   const candidate=join(d,'node_modules',name);
   // lstat catches dangling aliases too; do not let resolver realpath hide one.
   let st;try{st=lstatSync(candidate);}catch(e){if(e.code!=='ENOENT'&&e.code!=='ENOTDIR')throw e;}
   if(st){regularPath(candidate,true);break;}
   if(d===root)break;
  }
 }
 for(const required of AUTH_RUNTIME_REQUIRED_FILES)addFile(join(root,required));
 for(const folder of ['src','native'])if(existsSync(join(root,folder)))walk(join(root,folder));
 if(!Array.isArray(entries)||!entries.length||new Set(entries).size!==entries.length)failure('AUTH_RUNTIME_ENTRIES_INVALID');
 for(const entry of entries){if(!ascii(entry)||entry===AUTH_RUNTIME_MANIFEST_PATH)failure('AUTH_RUNTIME_ENTRIES_INVALID');enqueue(join(root,entry));}
 while(queue.length){
  const round=queue.splice(0),requests=[];
  for(const file of round){for(const ref of moduleReferences(readFileSync(file,'utf8'),file)){checkCandidate(ref.specifier,file);requests.push({...ref,parent:pathToFileURL(file).href});}}
  const values=resolverBatch(requests);
  for(let i=0;i<requests.length;i++){
   const ref=requests[i],target=values[i];edges.push(Object.freeze({from:inside(fileURLToPath(ref.parent)),specifier:ref.specifier,kind:ref.kind,resolved:target.startsWith('file:')?inside(fileURLToPath(target)):target}));
   if(target.startsWith('node:'))continue;if(!target.startsWith('file:'))failure('AUTH_RUNTIME_IMPORT_UNSUPPORTED');
   const path=fileURLToPath(target);inventoryPackage(path);enqueue(path);
   if(ref.kind==='resource-base'){const resource=fileURLToPath(new URL(ref.resource,target));inventoryPackage(resource);addFile(resource);controls(resource);}
  }
 }
 const manifest=Object.freeze({files:Object.freeze([...files.values()].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)),version:AUTH_RUNTIME_MANIFEST_VERSION});
 const report=Object.freeze({entries:Object.freeze([...entries].sort()),edges:Object.freeze(edges),node:process.versions.node,conditions:Object.freeze({mode:'actual-node-esm-defaults',custom:Object.freeze([])}),dataOnly:true,nativeAdmission:false});
 return Object.freeze({manifest,report});
}
export function validateAuthRuntimeClosure(packageRoot,input,options){
 let manifest=input;if(typeof input==='string'){try{manifest=JSON.parse(input);}catch{failure('AUTH_RUNTIME_MANIFEST_SCHEMA');}}
 plain(manifest,['version','files']);if(manifest.version!==AUTH_RUNTIME_MANIFEST_VERSION||!Array.isArray(manifest.files)||!manifest.files.length)failure('AUTH_RUNTIME_MANIFEST_SCHEMA');
 const arrayDescriptors=Object.getOwnPropertyDescriptors(manifest.files);if(Object.getPrototypeOf(manifest.files)!==Array.prototype||Reflect.ownKeys(arrayDescriptors).length!==manifest.files.length+1||Object.values(arrayDescriptors).some(d=>!Object.hasOwn(d,'value')))failure('AUTH_RUNTIME_MANIFEST_SCHEMA');
 let last='';for(const row of manifest.files){plain(row,['path','bytes','sha256']);if(!ascii(row.path)||row.path<=last||row.path===AUTH_RUNTIME_MANIFEST_PATH||!Number.isSafeInteger(row.bytes)||row.bytes<=0||typeof row.sha256!=='string'||!/^[0-9a-f]{64}$/.test(row.sha256))failure('AUTH_RUNTIME_MANIFEST_SCHEMA');last=row.path;}
 const raw=canonical(manifest);if(typeof input==='string'&&raw!==input)failure('AUTH_RUNTIME_MANIFEST_CANONICAL');
 const generated=generateAuthRuntimeClosure(packageRoot,options);if(canonical(generated.manifest)!==raw)failure('AUTH_RUNTIME_CLOSURE_MISMATCH');return generated;
}
