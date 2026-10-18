// Development/CI compiler check, never a runtime authority or an install step.
import ts from 'typescript';
import {readFileSync,realpathSync,lstatSync} from 'node:fs';
import path from 'node:path';
const argument=prefix=>process.argv.find(a=>a.startsWith(prefix))?.slice(prefix.length);
const root=realpathSync(argument('--root=')??process.cwd());
const selected=argument('--only=');
const configurations={main:'tsconfig.types.json',browser:'tsconfig.browser-types.json','node-private':'tsconfig.node-private-types.json'};
if(selected&&!Object.hasOwn(configurations,selected))throw Error('SDK_TYPE_PROJECT_UNKNOWN');
const localModules=path.join(root,'node_modules');
if(lstatSync(localModules).isSymbolicLink())throw Error('SDK_TYPE_CLOSURE_CANNOT_USE_NODE_MODULES_ALIAS');
for(const [kind,file] of Object.entries(configurations)){
 if(selected&&kind!==selected)continue;
 if(kind!=='browser'){
  let nodeMeta;
  try{nodeMeta=JSON.parse(readFileSync(path.join(localModules,'@types/node/package.json')));}catch{throw Error('SDK_NODE_TYPES_MISSING_FROM_LOCAL_DECLARED_CLOSURE');}
  const pkg=JSON.parse(readFileSync(path.join(root,'package.json')));
  if(pkg.devDependencies?.['@types/node']!==nodeMeta.version)throw Error('SDK_NODE_TYPES_VERSION_NOT_DECLARED');
 }
 const input=ts.readConfigFile(path.join(root,file),ts.sys.readFile);
 if(input.error)throw Error(ts.flattenDiagnosticMessageText(input.error.messageText,'\n'));
 const config=ts.parseJsonConfigFileContent(input.config,ts.sys,root);
 if(config.errors.length)throw Error(ts.formatDiagnosticsWithColorAndContext(config.errors,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>root,getNewLine:()=> '\n'}));
 const program=ts.createProgram(config.fileNames,config.options);
 const externalTypes=program.getSourceFiles().filter(f=>f.fileName.includes('/node_modules/@types/')&&!path.resolve(f.fileName).startsWith(localModules+path.sep));
 if(externalTypes.length)throw Error('SDK_AMBIENT_ANCESTOR_TYPES_FORBIDDEN:'+externalTypes.map(f=>f.fileName).join(','));
 const nodeFiles=program.getSourceFiles().filter(f=>f.fileName.includes('/node_modules/@types/node/'));
 if(kind==='browser'&&nodeFiles.length)throw Error('SDK_BROWSER_ROOT_MUST_NOT_IMPORT_NODE_TYPES');
 if(kind!=='browser'&&!nodeFiles.length)throw Error('SDK_NODE_PRIVATE_DECLARATION_DID_NOT_LOAD_EXPLICIT_NODE_TYPES');
 const diagnostics=ts.getPreEmitDiagnostics(program);
 if(diagnostics.length)throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>root,getNewLine:()=> '\n'}));
 console.log(JSON.stringify({project:kind,diagnostics:0,nodeTypesFiles:nodeFiles.length,ambientAncestorTypes:0}));
}
