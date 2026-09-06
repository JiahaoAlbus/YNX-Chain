import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
const [source,product,out]=process.argv.slice(2);
if(!/^[a-f0-9]{40}$/.test(source)||!['creator','viewer'].includes(product)||!out)throw Error('Usage: build-compatible-recovery.mjs exact-source creator|viewer output.tar.gz');
const root=execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
const dir=product==='creator'?'apps/creator-studio':'apps/video';
const read=path=>execFileSync('git',['show',`${source}:${path}`],{cwd:root,maxBuffer:16*1024*1024});
const metadata=JSON.parse(read(`${dir}/product-session-sdk-source.json`));
if(metadata.sdkSourceCommit!=='529471f3822d2bac43ea47a1ab8004fa2ae79885')throw Error('Recovery requires exact compatible SDK529');
const stage=mkdtempSync(join(tmpdir(),'ynx-compatible-recovery-'));
try{
 const runtime=join(stage,'runtime');mkdirSync(runtime);
 const files={};const put=(path,bytes)=>{if(typeof bytes==='string')bytes=Buffer.from(bytes);writeFileSync(join(runtime,path),bytes);files[path]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};};
 for(const [target,name] of [['index.html','index.html'],['recovery-app.js','app.js'],['controller.js','controller.js'],['recovery.css','style.css'],['server.mjs','server.mjs']])put(target,read(`apps/video/recovery/${name}`));
 for(const name of ['product-session-sdk.js','product-session-registry.json','product-session-sdk-source.json'])put(name,read(`${dir}/${name}`));
 put('package.json',JSON.stringify({type:'module',private:true}));
 const registry=JSON.parse(read(`${dir}/product-session-registry.json`)),registration=registry.products[0];
 put('recovery-config.json',JSON.stringify({productId:registration.productId,origin:registration.webOrigin,scopes:registration.scopes},null,2)+'\n');
 const manifest={schemaVersion:'ynx-compatible-recovery/1',sourceCommit:source,sourceTree:execFileSync('git',['rev-parse',`${source}^{tree}`],{encoding:'utf8'}).trim(),product,mode:'compatible-recovery',sdkSourceCommit:metadata.sdkSourceCommit,admission:false,automaticStorageAccess:false,installedWalletApprovalVerified:false,files};
 writeFileSync(join(runtime,'runtime-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 mkdirSync(resolve(out,'..'),{recursive:true});
 const tar=execFileSync('gtar',['--sort=name','--mtime=@0','--owner=0','--group=0','--numeric-owner','--mode=u=rwX,go=rX','--format=ustar','-C',stage,'-cf','-','runtime'],{maxBuffer:16*1024*1024});
 writeFileSync(out,execFileSync('gzip',['-9','-n'],{input:tar,maxBuffer:16*1024*1024}));
 const bytes=readFileSync(out);console.log(JSON.stringify({sourceCommit:source,product,path:out,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}));
}finally{rmSync(stage,{recursive:true,force:true});}
