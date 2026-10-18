import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {pqPairedRecipe} from './pq-paired-recipe.mjs';

const {values}=parseArgs({options:{'source-root':{type:'string'},commit:{type:'string'},'output-dir':{type:'string'},n:{type:'string',default:'1'},trial:{type:'string',default:'1'},write:{type:'boolean',default:false}}});
if(!values['source-root']||!values.commit||!values['output-dir'])throw Error('--source-root --commit FULL_SHA --output-dir NEW_CASE_DIR required; never starts Go');
const sourceRoot=path.resolve(values['source-root']),outputDir=path.resolve(values['output-dir']);
const git=args=>execFileSync('/usr/bin/git',['-C',sourceRoot,...args],{encoding:'utf8',timeout:1500,maxBuffer:1024*1024}).trim();
const head=git(['rev-parse','HEAD']),dirty=git(['status','--porcelain','--untracked-files=normal']);
let baseAncestor=false;try{git(['merge-base','--is-ancestor','aa97f102fc72ee89ef3c61b6125256b288694b39',values.commit]);baseAncestor=true}catch{throw Error('candidate is not the frozen production baseline or its descendant')}
let successFixture='';try{successFixture=git(['show',values.commit+':internal/chain/pq_batch_success_test.go'])}catch{/* recipe rejects missing frozen fixture, not the working-tree substitute */}
let measurementSource='';try{measurementSource=git(['show',values.commit+':internal/chain/pq_batch_measurement.go'])}catch{/* reject missing committed production API */}
const overlaySource=fileURLToPath(new URL('./overlays/pq_paired_performance_test.go.in',import.meta.url));
const target=path.join(sourceRoot,'internal/chain/pq_paired_performance_test.go');
const recipe=pqPairedRecipe({sourceRoot,commit:values.commit,head,dirty,baseAncestor,successFixture,measurementSource,overlaySource,outputDir,n:Number(values.n),trial:Number(values.trial),targetExists:fs.existsSync(target)});
if(fs.realpathSync(sourceRoot)!==sourceRoot||fs.realpathSync(overlaySource)!==overlaySource)throw Error('source and overlay must not be symlink aliases');
if(fs.existsSync(outputDir))throw Error('preserve existing case output directory');
recipe.sourcePins={};
for(const relative of ['go.mod','go.sum','internal/chain/pq_batch.go','internal/chain/pq_batch_measurement.go','internal/chain/devnet.go','internal/chain/replication.go','internal/chain/transaction_durability.go','internal/chain/pq_authorization_test.go','internal/chain/pq_batch_success_test.go']){
  const raw=execFileSync('/usr/bin/git',['-C',sourceRoot,'show',values.commit+':'+relative],{timeout:1500,maxBuffer:4*1024*1024});
  recipe.sourcePins[relative]={bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')};
}
const raw=fs.readFileSync(overlaySource);recipe.overlayPin={sourcePath:overlaySource,path:recipe.overlay.Replace[target],bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')};
if(head!==git(['rev-parse','HEAD'])||git(['status','--porcelain','--untracked-files=normal'])!=='')throw Error('source changed during preparation');
if(values.write){
  fs.mkdirSync(outputDir,{mode:0o700});
  fs.writeFileSync(recipe.overlayPin.path,raw,{flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(outputDir,'overlay.json'),JSON.stringify(recipe.overlay,null,2)+'\n',{flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(outputDir,'prepared.json'),JSON.stringify(recipe,null,2)+'\n',{flag:'wx',mode:0o600});
}
console.log(JSON.stringify(recipe,null,2));
