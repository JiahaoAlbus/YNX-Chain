// Build-time production inventory; never imports, initializes or starts a client.
// Add this dependency inventory to the SAME canonical SDK/Native tuple. It is
// not permission to mix a newer JS package with an older Auth/Native release.
import {constants,openSync,closeSync,fstatSync,readFileSync,lstatSync,readdirSync} from 'node:fs';
import {resolve,join,dirname,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const nameOK=name=>typeof name==='string'&&/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name)&&!name.split('/').some(p=>p==='.'||p==='..');
function ordinary(path,directory=false){
 let cursor=resolve(path);const leaf=cursor;
 for(;;){const stat=lstatSync(cursor);if(stat.isSymbolicLink())fail('WC_RUNTIME_SYMLINK');if(cursor===leaf&&(directory?!stat.isDirectory():!stat.isFile()))fail('WC_RUNTIME_NONREGULAR');const parent=dirname(cursor);if(parent===cursor)break;cursor=parent;}
 return leaf;
}
function stableFile(path){
 ordinary(path);const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const before=fstatSync(fd),bytes=readFileSync(fd),after=fstatSync(fd),named=lstatSync(path);if(!before.isFile()||!named.isFile()||named.isSymbolicLink()||['dev','ino','size','mtimeMs','ctimeMs','mode'].some(k=>before[k]!==after[k]||after[k]!==named[k])||bytes.length!==after.size)fail('WC_RUNTIME_SOURCE_CHANGED');return {bytes,mode:after.mode&0o777};}finally{closeSync(fd);}
}
const json=path=>{try{return JSON.parse(stableFile(path).bytes);}catch(error){if(error.code?.startsWith('WC_RUNTIME_'))throw error;fail('WC_RUNTIME_JSON_INVALID');}};
const safeRelative=(root,path)=>{const out=relative(root,path).split(sep).join('/');if(!out||out.startsWith('../')||out==='..'||out.startsWith('/'))fail('WC_RUNTIME_ROOT_ESCAPE');return out;};
function dependencies(meta){return {...meta.dependencies,...meta.optionalDependencies};}
/** Inventory whole selected production packages, retaining controls, licenses,
 * optional platform resources and nested resolution; dev packages are not roots.
 * A pinned installed lock and canonical source/package pins remain role inputs.
 */
export function collectWalletConnectRuntimeClosure(inputRoot){
 const root=ordinary(inputRoot,true),rootMeta=json(join(root,'package.json'));
 const lockPath=join(root,'node_modules/.package-lock.json'),lockFile=stableFile(lockPath);
 let lock;try{lock=JSON.parse(lockFile.bytes);}catch{fail('WC_RUNTIME_LOCK_INVALID');}
 if(lock.lockfileVersion!==3||!lock.packages||typeof lock.packages!=='object')fail('WC_RUNTIME_LOCK_INVALID');
 const selected=new Map(),edges=[],optionalAbsent=[];
 function locate(from,name){
  if(!nameOK(name))fail('WC_RUNTIME_DEPENDENCY_NAME_INVALID');
  let cursor=from;
  for(;;){if(cursor!==root&&relative(root,cursor).startsWith('..'))fail('WC_RUNTIME_ROOT_ESCAPE');if(!cursor.endsWith(`${sep}node_modules`)){const candidate=join(cursor,'node_modules',name);try{lstatSync(candidate);ordinary(candidate,true);return candidate;}catch(error){if(error.code!=='ENOENT')throw error;}}
   if(cursor===root)break;cursor=dirname(cursor);
  }return null;
 }
 function visit(from,name,requested,optional=false){
  const dir=locate(from,name);if(!dir){if(optional){optionalAbsent.push({from:from===root?'.':safeRelative(root,from),name,requested});return;}fail('WC_RUNTIME_DEPENDENCY_MISSING');}
  const path=safeRelative(root,dir),meta=json(join(dir,'package.json')),locked=lock.packages[path];
  if(!locked||locked.link||locked.dev===true)fail('WC_RUNTIME_LOCK_SELECTION_INVALID');
  if(meta.name!==name||typeof meta.version!=='string'||locked.version!==meta.version||(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(requested)&&requested!==meta.version))fail('WC_RUNTIME_VERSION_MISMATCH');
  edges.push({from:from===root?'.':safeRelative(root,from),name,requested,to:path,version:meta.version});
  if(selected.has(path))return;selected.set(path,{path,name,version:meta.version,integrity:locked.integrity??null,resolved:locked.resolved??null});
  for(const [child,range]of Object.entries(dependencies(meta)).sort(([a],[b])=>cmp(a,b))){if(typeof range!=='string')fail('WC_RUNTIME_DEPENDENCY_NAME_INVALID');visit(dir,child,range,Object.hasOwn(meta.optionalDependencies??{},child));}
  for(const [peer,range]of Object.entries(meta.peerDependencies??{}).sort(([a],[b])=>cmp(a,b))){if(Object.hasOwn(dependencies(meta),peer))continue;visit(dir,peer,range,meta.peerDependenciesMeta?.[peer]?.optional===true);}
 }
 // All package-declared production roots avoid source parsing omissions. Core
 // is additionally explicit: the public client dynamically imports it directly.
 for(const [name,range]of Object.entries(dependencies(rootMeta)).sort(([a],[b])=>cmp(a,b)))visit(root,name,range,Object.hasOwn(rootMeta.optionalDependencies??{},name));
 if(rootMeta.dependencies?.['@walletconnect/sign-client'])visit(root,'@walletconnect/core',rootMeta.dependencies['@walletconnect/sign-client']);
 const files=[];
 function add(path){const record=stableFile(path);files.push({path:safeRelative(root,path),size:record.bytes.length,sha256:hash(record.bytes),mode:record.mode});}
 function tree(dir){ordinary(dir,true);for(const entry of readdirSync(dir).sort()){if(entry==='node_modules')continue;const path=join(dir,entry),stat=lstatSync(path);if(stat.isSymbolicLink())fail('WC_RUNTIME_SYMLINK');if(stat.isDirectory())tree(path);else if(stat.isFile())add(path);else fail('WC_RUNTIME_NONREGULAR');}}
 // Root SDK source/metadata is independently pinned by the canonical package;
 // this collector neither strips it nor creates a second SDK installation.
 add(join(root,'package.json'));for(const pkg of selected.values())tree(join(root,pkg.path));
 files.sort((a,b)=>cmp(a.path,b.path));edges.sort((a,b)=>cmp(JSON.stringify(a),JSON.stringify(b)));
 if(hash(stableFile(lockPath).bytes)!==hash(lockFile.bytes))fail('WC_RUNTIME_SOURCE_CHANGED');
 return {kind:'YNX-WALLETCONNECT-PRODUCTION-CLOSURE/v1',sdk:{name:rootMeta.name,version:rootMeta.version},entry:'@ynx-chain/wallet-auth/walletconnect-dapp-connection',selection:'all-declared-production-dependencies-plus-direct-core',installedLock:{path:'node_modules/.package-lock.json',size:lockFile.bytes.length,sha256:hash(lockFile.bytes)},packages:[...selected.values()].sort((a,b)=>cmp(a.path,b.path)),edges,optionalAbsent:optionalAbsent.sort((a,b)=>cmp(JSON.stringify(a),JSON.stringify(b))),files,networkInitialized:false,nativeLoaded:false,qualified:false};
}
export function verifyWalletConnectRuntimeClosure(inputRoot,expected){
 const actual=collectWalletConnectRuntimeClosure(inputRoot);
 if(JSON.stringify(actual)!==JSON.stringify(expected))fail('WC_RUNTIME_MANIFEST_MISMATCH');
 return {verified:true,packages:actual.packages.length,files:actual.files.length,networkInitialized:false,nativeLoaded:false,qualified:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){if(process.argv.length!==3)throw new Error('usage: node walletconnect-runtime-closure.mjs <installed-canonical-sdk-root>');process.stdout.write(`${JSON.stringify(collectWalletConnectRuntimeClosure(process.argv[2]),null,2)}\n`);}
