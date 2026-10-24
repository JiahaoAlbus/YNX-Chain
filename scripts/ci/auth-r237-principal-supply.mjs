// CI-only materializer. The PUBLIC brand seam exists in an exclusive scratch
// dependency copy only; canonical sources and normal npm payload stay intact.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url)),pkg=path.join(root,'packages/wallet-auth'),fixture=fileURLToPath(new URL('./fixtures/auth-r237-principal/',import.meta.url));
const requireSDK=createRequire(path.join(pkg,'package.json'));
const sha=b=>createHash('sha256').update(b).digest('hex'),fail=c=>{throw Object.assign(Error(c),{code:c})};
export const r237SupplierPin=Object.freeze({bytes:15547,sha256:'64e8e90ad47d06eb446e113524557eaa601896f40f8fdc54591318cc39350c80'});
const generatedPin=Object.freeze({bytes:13801,sha256:'4b848b8a6ddaabc3b565ee8ed3515aa56df8f4f449fa93b3d50921813774caa2'});
const brand='\nexport function r237PUBLICBrand(s){ services.add(s); }\n';
function canonical(p){if(typeof p!=='string'||!path.isAbsolute(p)||path.resolve(p)!==p)fail('R237_PATH');for(let at=p;;at=path.dirname(at)){if(fs.lstatSync(at).isSymbolicLink())fail('R237_SYMLINK');if(at===path.dirname(at))break;}if(fs.realpathSync(p)!==p)fail('R237_PATH');}
function file(p,pin){canonical(p);const st=fs.lstatSync(p);if(!st.isFile())fail('R237_FILE');const raw=fs.readFileSync(p);if(pin&&(raw.length!==pin.bytes||sha(raw)!==pin.sha256))fail('R237_PIN');return raw;}
function row(p,raw){return {path:p,bytes:raw.length,sha256:sha(raw)};}
export function readR237PrincipalSupply(){
 const h=JSON.parse(file(path.join(fixture,'SUPPLIER_HANDOFF.json'),r237SupplierPin)),test=file(path.join(fixture,'test-r237.mjs'),generatedPin),pins=JSON.parse(file(path.join(fixture,'PINS.json')));
 const source=h.sourceDelta?.map(p=>({path:p.relative.slice('source/packages/wallet-auth/'.length),bytes:p.bytes,sha256:p.sha256}));
 if(source?.length!==3||h.newTests!==9||h.tests?.Node24New!==9||h.tests?.skip!==0||h.truth?.realRoot!==false||h.truth?.serviceMounted!==false||pins.kind!=='YNX-R237-PUBLIC-PRINCIPAL-FIXTURE/v1'||pins.PUBLIC!==true||pins.production!==false||pins.Root!==false||pins.SourceAdmitted!==false||JSON.stringify(pins.productionSource)!==JSON.stringify(source)||pins.supplierHandoff?.sha256!==r237SupplierPin.sha256||pins.supplierHandoff?.bytes!==r237SupplierPin.bytes||pins.generatedTest?.sha256!==generatedPin.sha256||pins.generatedTest?.bytes!==generatedPin.bytes)fail('R237_SUPPLY');
 if(JSON.stringify(fs.readdirSync(fixture).sort())!==JSON.stringify(['PINS.json','SUPPLIER_HANDOFF.json','test-r237.mjs']))fail('R237_EXTRA');
 return {source,test};
}
export function prepareR237PrincipalCI({outputRoot}){
 const supplied=readR237PrincipalSupply();
 if(typeof outputRoot!=='string'||!path.isAbsolute(outputRoot)||path.resolve(outputRoot)!==outputRoot||outputRoot===root||outputRoot.startsWith(root+path.sep))fail('R237_OUTPUT_PATH');canonical(path.dirname(outputRoot));
 // Three supplier SHA pins are independent of the next package version.
 const selected=supplied.source.map(pin=>{if(!/^src\/[a-z0-9-]+\.js$/.test(pin.path))fail('R237_SOURCE_PATH');return {pin,raw:file(path.join(pkg,pin.path),pin)};});
 const packageRaw=file(path.join(pkg,'package.json')),metadata=JSON.parse(packageRaw),lockRaw=file(path.join(pkg,'package-lock.json'));
 if(metadata.name!=='@ynx-chain/wallet-auth'||metadata.version!=='1.3.0-pq.3.32-auth.36')fail('R237_PACKAGE_SELECTION');
 const ts=requireSDK('typescript'),nodes=new Map([['test-r237.mjs',supplied.test]]),queue=['test-r237.mjs'],bare=new Set(),names=[];let total=supplied.test.length;
 while(queue.length){
  const relative=queue.shift(),raw=nodes.get(relative);if(relative==='product-session-registry.json')continue;
  const ast=ts.createSourceFile(relative,raw.toString('utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),imports=[];
  function visit(n){
   if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier&&ts.isStringLiteral(n.moduleSpecifier))imports.push(n.moduleSpecifier.text);
   if(ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword&&n.arguments.length===1&&ts.isStringLiteral(n.arguments[0]))imports.push(n.arguments[0].text);
   if(relative==='test-r237.mjs'&&ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.expression.text==='test'&&ts.isStringLiteral(n.arguments[0]))names.push(n.arguments[0].text);
   ts.forEachChild(n,visit);
  }visit(ast);
  for(const spec of imports){
   if(spec.startsWith('node:'))continue;
   let dep;if(spec.startsWith('.'))dep=path.posix.normalize(path.posix.join(path.posix.dirname(relative),spec));
   else if(spec==='@ynx-chain/wallet-auth'||spec.startsWith('@ynx-chain/wallet-auth/')){const actual=requireSDK.resolve(spec);if(!actual.startsWith(pkg+path.sep))fail('R237_SELF_EXPORT');dep=path.relative(pkg,actual).split(path.sep).join('/');}
   else{bare.add(spec);continue;}
   if(dep.startsWith('../')||path.posix.isAbsolute(dep)||!(dep==='product-session-registry.json'||/^((src|native)\/.*|index\.js)$/.test(dep)&&/^.*\.(js|mjs)$/.test(dep)))fail('R237_CLOSURE_PATH');
   if(!nodes.has(dep)){const bytes=file(path.join(pkg,dep));if(bytes.includes(Buffer.from('r237PUBLICBrand')))fail('R237_PRODUCTION_BRAND');nodes.set(dep,bytes);queue.push(dep);total+=bytes.length;if(nodes.size>160||total>2097152)fail('R237_CLOSURE_CAP');}
  }
 }
 if(names.length!==9||new Set(names).size!==9)fail('R237_TEST_SELECTION');
 const registry=file(path.join(pkg,'product-session-registry.json')),nodeModules=fs.realpathSync(path.join(pkg,'node_modules'));
 if(nodeModules!==path.join(pkg,'node_modules')||!fs.lstatSync(nodeModules).isDirectory())fail('R237_DEPENDENCY_ROOT');
 const directDependencies=[...bare].sort().map(spec=>{const p=fs.realpathSync(requireSDK.resolve(spec));if(!p.startsWith(nodeModules+path.sep))fail('R237_DEPENDENCY_ESCAPE');return {specifier:spec,...row(p,file(p))};});
 const outputRows=[];fs.mkdirSync(outputRoot,{mode:0o700});
 try{
  const write=(relative,raw)=>{const target=path.join(outputRoot,relative);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,raw,{flag:'wx',mode:0o600});const r=row(relative,raw);file(target,r);outputRows.push(r);};
  for(const [relative,raw]of nodes)write(relative,relative==='src/original-auth-identity-source-current.js'?Buffer.concat([raw,Buffer.from(brand)]):raw);
  write('package.json',packageRaw);if(!nodes.has('product-session-registry.json'))write('product-session-registry.json',registry);
  // Existing exact-lock CI dependencies are referenced, never copied/scanned.
  fs.symlinkSync(nodeModules,path.join(outputRoot,'node_modules'),'dir');
  for(const p of selected)file(path.join(pkg,p.pin.path),p.pin);
  file(path.join(pkg,'package.json'),row('',packageRaw));file(path.join(pkg,'package-lock.json'),row('',lockRaw));readR237PrincipalSupply();
  return {supplierHandoff:r237SupplierPin,outputRoot,test:path.join(outputRoot,'test-r237.mjs'),testNames:names,files:outputRows,canonicalClosure:[...nodes].filter(([p])=>p!=='test-r237.mjs').map(([p,b])=>row(p,b)),canonicalProductionThree:selected.map(p=>p.pin),packageMetadata:row('package.json',packageRaw),packageLock:row('package-lock.json',lockRaw),dependencies:{nodeModules,directDependencies,fullUnionScanned:false},brandSeam:{temporaryOnly:true,relative:'src/original-auth-identity-source-current.js',appendBytes:Buffer.byteLength(brand),canonicalProductionUnmodified:true,normalPackageContainsBrand:false},dataOnly:true,testsRun:false,Root:false,SourceAdmitted:false,serviceMounted:false,production:false};
 }catch(e){if(e&&typeof e==='object'){e.partialOutputPreserved=true;e.firstCause??=e.code??e.message;}throw e;}
}
