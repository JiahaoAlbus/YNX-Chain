// BUILD ONLY: TypeScript is the original builder checkout's npm-ci dev tool.
// This module is not copied to the SDK product, imported by Native or published.
import ts from '../../packages/wallet-auth/node_modules/typescript/lib/typescript.js';
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex'),fail=c=>{throw Object.assign(Error(c),{code:c})};
export function analyzeSDK35ProductSourceImports({prefix,files,excluded}){
 const removed=new Set(excluded.map(x=>x.path)),all=new Set(files.map(x=>x.path)),sources=[],edges=[],unresolved=[];
 for(const pin of files){
  if(pin.path.startsWith('node_modules/')||removed.has(pin.path)||! /\.(?:mjs|cjs|js)$/.test(pin.path))continue;
  const file=path.join(prefix,pin.path);for(let at=file;;at=path.dirname(at)){if(fs.lstatSync(at).isSymbolicLink())fail('SDK35_PRODUCT_SOURCE_SYMLINK');if(at===path.dirname(at))break;}
  const st=fs.lstatSync(file);if(!st.isFile()||st.size!==pin.bytes)fail('SDK35_PRODUCT_SOURCE_PIN');const raw=fs.readFileSync(file);if(sha(raw)!==pin.sha256)fail('SDK35_PRODUCT_SOURCE_PIN');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(raw),tree=ts.createSourceFile(pin.path,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);if(tree.parseDiagnostics.length)fail('SDK35_PRODUCT_SOURCE_SYNTAX');sources.push({...pin});
  function inspect(node){
   let spec,kind;
   if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)){if(node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)){spec=node.moduleSpecifier.text;kind='module';}}
   else if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&node.expression.text==='require')){kind=node.expression.kind===ts.SyntaxKind.ImportKeyword?'import()':'require()';if(node.arguments.length===1&&ts.isStringLiteralLike(node.arguments[0]))spec=node.arguments[0].text;else unresolved.push({source:pin.path,line:tree.getLineAndCharacterOfPosition(node.getStart(tree)).line+1,kind});}
   else if(ts.isNewExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='URL'&&node.arguments?.length===2&&node.arguments[1].getText(tree)==='import.meta.url'){kind='new URL';if(ts.isStringLiteralLike(node.arguments[0]))spec=node.arguments[0].text;else unresolved.push({source:pin.path,line:tree.getLineAndCharacterOfPosition(node.getStart(tree)).line+1,kind});}
   if(spec!==undefined&&spec.startsWith('.')){
    let target;try{const url=new URL(spec,'file:///SDK/'+pin.path);target=decodeURIComponent(url.pathname);target=target.startsWith('/SDK/')?target.slice(5):target;}catch{fail('SDK35_PRODUCT_SOURCE_SPECIFIER');}target=path.posix.normalize(target);if(removed.has(target)||[target+'.js',target+'.mjs',target+'/index.js',target+'/index.mjs'].some(x=>removed.has(x)))fail('SDK35_PRODUCT_EXCLUDED_SOURCE_EDGE');
    edges.push({source:pin.path,specifier:spec,target,kind,contained:all.has(target)});
   }
   ts.forEachChild(node,inspect);
  }inspect(tree);
 }
 return {kind:'YNX_SDK35_BUILD_STATIC_SOURCE_ANALYSIS/v1',typescript:ts.version,sources,edges,unresolvedComputedEdges:unresolved,noStaticEdgeToExcludedFiles:true,computedEdgesProven:false,NativeAdmission:false,SourceAdmission:false,activation:false};
}
