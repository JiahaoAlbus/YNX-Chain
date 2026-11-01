// Normal SDK source + finite bundled runtime provenance. No Native/Root build.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const pkg=path.resolve(import.meta.dirname,'../..'),root=path.resolve(pkg,'../..'),out=path.join(root,'canonical-common-source-package');
fs.mkdirSync(out,{recursive:true});
const packed=JSON.parse(execFileSync('npm',['pack','--workspaces=false','--ignore-scripts','--json','--pack-destination',out],{cwd:pkg,encoding:'utf8',timeout:120000}))[0];
const cache=execFileSync('npm',['config','get','cache'],{cwd:pkg,encoding:'utf8'}).trim();
const resultPath=path.join(out,'CLOSED_BUNDLE_RESULT.json');
execFileSync('python3',[path.join(pkg,'scripts/ci/verify-closed-runtime-bundle.py'),path.join(out,packed.filename),pkg,cache,resultPath],{stdio:'inherit',timeout:120000});
const proof=JSON.parse(fs.readFileSync(resultPath));
if(proof.members!==packed.files.length||proof.bundlePackages!==6||proof.bundledMembers!==366)throw Error('NORMAL_PACKAGE_CLOSED_BUNDLE_INVENTORY_DIFFERS');
const archive=proof.rows.find(r=>r.path==='native/vendor/link/libynx_artifact_release.a');
if(archive?.bytes!==15553360||archive.sha256!=='59aa33100c44cd92187baf568c8184bf3f7b27192ee15ba9a83d3623cf7bc797')throw Error('NORMAL_PACKAGE_ORIGINAL_LINK_ARCHIVE_DIFFERS');
fs.writeFileSync(path.join(out,'MEMBERS.json'),JSON.stringify(proof.rows,null,2)+'\n');
const result={...proof};delete result.rows;
fs.writeFileSync(path.join(out,'RESULT.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,origins:undefined}));
