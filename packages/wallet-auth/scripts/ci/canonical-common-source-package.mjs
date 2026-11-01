// Verify this successor's actual source package. No Native/Root/private execution.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const pkg=path.resolve(import.meta.dirname,'../..'),root=path.resolve(pkg,'../..'),out=path.join(root,'canonical-common-source-package');
fs.mkdirSync(out,{recursive:true});
const packed=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json','--pack-destination',out],{cwd:pkg,encoding:'utf8',timeout:120000}))[0];
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'canonical-common-source-'));
const sha=b=>createHash('sha256').update(b).digest('hex');
try {
 execFileSync('tar',['-xzf',path.join(out,packed.filename),'-C',temp]);
 const rows=packed.files.map(r=>{assert(!path.isAbsolute(r.path)&&!r.path.split('/').includes('..'));const b=fs.readFileSync(path.join(temp,'package',r.path));assert.deepEqual(b,fs.readFileSync(path.join(pkg,r.path)),r.path);return {path:r.path,bytes:b.length,sha256:sha(b)};});
 const archive=rows.find(r=>r.path==='native/vendor/link/libynx_artifact_release.a');
 assert.deepEqual(archive,{path:'native/vendor/link/libynx_artifact_release.a',bytes:15553360,sha256:'59aa33100c44cd92187baf568c8184bf3f7b27192ee15ba9a83d3623cf7bc797'});
 const bytes=fs.readFileSync(path.join(out,packed.filename));
 const result={archive:{file:packed.filename,bytes:bytes.length,sha256:sha(bytes)},members:rows.length,allMembersMatchSource:true,NativeCompiled:false,helperExecuted:false,RootAdmission:false,SourceAdmission:false,installed:false,realLogin:false,realRestore:false,realRevoke:false};
 fs.writeFileSync(path.join(out,'MEMBERS.json'),JSON.stringify(rows,null,2)+'\n');fs.writeFileSync(path.join(out,'RESULT.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
