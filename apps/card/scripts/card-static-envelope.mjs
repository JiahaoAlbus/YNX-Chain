import {cpSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {canonical,envelopeFiles,sha256} from './verify-static-artifacts.mjs';

export function envelopeArguments(args,root){
  const parsed={source:resolve(root,'dist-web'),envelope:resolve(root,'deployment-envelope')};
  const seen=new Set();
  for(const arg of args){
    const key=arg.startsWith('--source-dir=')?'source':arg.startsWith('--output-dir=')?'envelope':null;
    if(!key||seen.has(key)||!arg.slice(13))throw new Error('CARD_ENVELOPE_ARGUMENT_INVALID');
    seen.add(key);parsed[key]=resolve(root,arg.slice(13));
  }
  return parsed;
}
export function createCardStaticEnvelope(root,source,target){
  if(existsSync(target))throw new Error('CARD_ENVELOPE_OUTPUT_EXISTS_USE_FRESH_PATH');
  const config=JSON.parse(readFileSync(resolve(root,'vercel.json'),'utf8'));
  const rewrites=[{source:'/api/card/v1/:path*',destination:'https://api.ynxweb4.com/api/card/v1/:path*'},{source:'/api/card/v2/:path*',destination:'https://api.ynxweb4.com/api/card/v2/:path*'},{source:'/wallet-auth/callback',destination:'/'}];
  if(config.outputDirectory!=='dist-web'||config.buildCommand!=='npm run build:web'||canonical(config.rewrites)!==canonical(rewrites))throw new Error('CARD_ENVELOPE_CONFIGURATION_INVALID');
  const identity=JSON.parse(readFileSync(resolve(source,'runtime-identity.json'),'utf8'));
  const pair=identity.cardApiCompatibility;
  if(identity.productId!=='ynx-card'||identity.environment!=='testnet'||identity.productionRealPayments!==false||!pair||pair.frontendSourceCommit!==identity.sourceCommit||pair.frontendSourceTree!==identity.sourceTree||pair.productionRealPayments!==false||![identity.sourceCommit,identity.sourceTree,pair.backendSourceCommit].every(value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value)))throw new Error('CARD_ENVELOPE_IDENTITY_INVALID');
  envelopeFiles(source);
  mkdirSync(target,{recursive:true});
  cpSync(source,resolve(target,'dist-web'),{recursive:true});
  cpSync(resolve(root,'vercel.json'),resolve(target,'vercel.json'));
  const pkg=JSON.parse(readFileSync(resolve(root,'static-deploy-package.json'),'utf8'));
  pkg.scripts={'build:web':'node build-static.mjs'};
  writeFileSync(resolve(target,'package.json'),JSON.stringify(pkg,null,2)+'\n');
  cpSync(resolve(import.meta.dirname,'verify-static-artifacts.mjs'),resolve(target,'build-static.mjs'));
  const manifest={schemaVersion:'ynx.card.static-envelope.v2',sourceCommit:identity.sourceCommit,sourceTree:identity.sourceTree,backendSourceCommit:pair.backendSourceCommit,configCanonicalSha256:sha256(canonical(config)),files:envelopeFiles(target)};
  writeFileSync(resolve(target,'artifact-files.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}
