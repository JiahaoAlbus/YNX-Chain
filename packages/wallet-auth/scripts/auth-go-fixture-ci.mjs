// Test-fixture materialization only. No Go/Node child process, server, provider,
// Native module, environment override or production configuration is executed.
import {readFileSync,writeFileSync,lstatSync,realpathSync,readdirSync,mkdirSync,accessSync,constants} from 'node:fs';
import {resolve,join,dirname,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const fail=code=>{throw Object.assign(Error(code),{code});},hash=raw=>createHash('sha256').update(raw).digest('hex');
const oldConstant='const fixtureNode = "/Users/huangjiahao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"';
const goPrefix='internal/developerauthority/',testFile=goPrefix+'original_source_process_test.go',sqlFile=goPrefix+'control_capture_schema.sql';
const publicJSON=['packages/wallet-auth/test/fixtures/native-control-public-interop.json','packages/wallet-auth/test/fixtures/native-control-154a7b211-public-interop.json'];
const maxBytes=2097152,maxFiles=32;
function absolute(p){if(typeof p!=='string'||!isAbsolute(p)||resolve(p)!==p)fail('AUTH_GO_FIXTURE_PATH');return p;}
function noLinks(p){for(let at=absolute(p);;at=dirname(at)){const st=lstatSync(at);if(st.isSymbolicLink())fail('AUTH_GO_FIXTURE_SYMLINK');if(at===dirname(at))break;}}
function relative(p){if(typeof p!=='string'||p.includes('\\')||p.includes('\0')||isAbsolute(p)||p.split('/').some(s=>!s||s==='.'||s==='..')||p.split('/').length>6)fail('AUTH_GO_FIXTURE_PATH');return p;}
function scan(root,allowed){const found=[];let bytes=0,entries=0;function visit(dir,depth){if(depth>6)fail('AUTH_GO_FIXTURE_SCOPE');for(const name of readdirSync(dir).sort()){if(++entries>256)fail('AUTH_GO_FIXTURE_CAP');const file=join(dir,name),st=lstatSync(file),relativeName=file.slice(root.length+1).split(sep).join('/');if(st.isSymbolicLink())fail('AUTH_GO_FIXTURE_SYMLINK');if(st.isDirectory()){if(!allowed.some(p=>p.startsWith(relativeName+'/')))fail('AUTH_GO_FIXTURE_EXTRA_OR_MISSING');visit(file,depth+1);}else{if(!st.isFile())fail('AUTH_GO_FIXTURE_NOT_REGULAR');bytes+=st.size;found.push(relativeName);if(found.length>maxFiles||bytes>maxBytes)fail('AUTH_GO_FIXTURE_CAP');}}}visit(root,0);return found.sort();}
function load(root,files){
 const expected=files.map(p=>p.path).sort(),names=scan(root,expected);if(JSON.stringify(names)!==JSON.stringify(expected))fail('AUTH_GO_FIXTURE_EXTRA_OR_MISSING');
 let total=0;const captured=[];for(const p of files){const file=join(root,p.path),st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink())fail('AUTH_GO_FIXTURE_NOT_REGULAR');if(st.size!==p.bytes||(total+=st.size)>maxBytes)fail('AUTH_GO_FIXTURE_INPUT_DIFFERS');const raw=readFileSync(file);if(raw.length!==p.bytes||hash(raw)!==p.sha256)fail('AUTH_GO_FIXTURE_INPUT_DIFFERS');captured.push({pin:p,raw});}return captured;
}
/** files are trusted supply-relative exact pins, not discovered authority.
 * fixtureRoot must contain precisely the formal internal/developerauthority
 * 27 Go + control_capture_schema.sql and the two exact PUBLIC JSON paths.
 * The output is a new exclusive CI test copy; original production pins remain
 * unchanged. nodeExecutable must be this actual running Node's real path. */
export function prepareAuthGoFixtureCIData({fixtureRoot,files,nodeExecutable,outputRoot}){
 absolute(fixtureRoot);absolute(outputRoot);absolute(nodeExecutable);noLinks(fixtureRoot);noLinks(dirname(outputRoot));
 if(realpathSync(fixtureRoot)!==fixtureRoot||!lstatSync(fixtureRoot).isDirectory()||realpathSync(dirname(outputRoot))!==dirname(outputRoot))fail('AUTH_GO_FIXTURE_PATH');
 if(outputRoot===fixtureRoot||outputRoot.startsWith(fixtureRoot+sep))fail('AUTH_GO_FIXTURE_OUTPUT_SCOPE');
 if(realpathSync(nodeExecutable)!==nodeExecutable||nodeExecutable!==realpathSync(process.execPath))fail('AUTH_GO_FIXTURE_NODE');
 noLinks(nodeExecutable);if(!lstatSync(nodeExecutable).isFile())fail('AUTH_GO_FIXTURE_NODE');accessSync(nodeExecutable,constants.X_OK);
 if(!Array.isArray(files)||files.length!==30||files.length>maxFiles)fail('AUTH_GO_FIXTURE_SCOPE');
 const pins=files.map(p=>{if(!p||Object.keys(p).sort().join('|')!=='bytes|path|sha256')fail('AUTH_GO_FIXTURE_PIN');const name=relative(p.path);if(!Number.isSafeInteger(p.bytes)||p.bytes<0||p.bytes>maxBytes||typeof p.sha256!=='string'||!/^[a-f0-9]{64}$/.test(p.sha256))fail('AUTH_GO_FIXTURE_PIN');return{path:name,bytes:p.bytes,sha256:p.sha256};});
 const go=pins.filter(p=>p.path.startsWith(goPrefix)&&/^[A-Za-z0-9_]+\.go$/.test(p.path.slice(goPrefix.length)));
 if(new Set(pins.map(p=>p.path)).size!==pins.length||go.length!==27||!pins.some(p=>p.path===testFile)||!pins.some(p=>p.path===sqlFile)||publicJSON.some(name=>!pins.some(p=>p.path===name))||pins.some(p=>!go.includes(p)&&p.path!==sqlFile&&!publicJSON.includes(p.path)))fail('AUTH_GO_FIXTURE_SCOPE');
 if(pins.reduce((n,p)=>n+p.bytes,0)>maxBytes)fail('AUTH_GO_FIXTURE_CAP');
 const captured=load(fixtureRoot,pins),entry=captured.find(p=>p.pin.path===testFile);
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(entry.raw);}catch{fail('AUTH_GO_FIXTURE_TEST_ENCODING');}
 if(text.split(oldConstant).length!==2||!text.split(/\r?\n/).some(line=>line===oldConstant))fail('AUTH_GO_FIXTURE_NODE_CONSTANT');
 const replacement='const fixtureNode = '+JSON.stringify(nodeExecutable),changed=Buffer.from(text.replace(oldConstant,replacement),'utf8');
 // mkdir is exclusive. A partial output on any later error is retained for
 // diagnosis; neither a retry nor recursive deletion is performed here.
 mkdirSync(outputRoot,{mode:0o700});const outputs=[];
 for(const {pin,raw}of captured){const dest=join(outputRoot,pin.path);mkdirSync(dirname(dest),{recursive:true,mode:0o700});const bytes=pin.path===testFile?changed:raw;writeFileSync(dest,bytes,{flag:'wx',mode:0o600});outputs.push({path:pin.path,bytes:bytes.length,sha256:hash(bytes)});}
 load(fixtureRoot,pins);load(outputRoot,outputs);
 const freeze=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};
 return freeze({fixtureRoot,outputRoot,nodeExecutable,originalFiles:pins,preparedFiles:outputs,testOnlyNodeConstant:{path:testFile,replacements:1,originalSHA256:entry.pin.sha256,preparedSHA256:hash(changed)},originalProductionUnchanged:true,prepared:true,dataOnly:true,GoExecuted:false,GoServer:false,Source:false,Root:false,Native:false,production:false});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==6||process.argv[2]!=='--request'||process.argv[4]!=='--output')fail('AUTH_GO_FIXTURE_ARGUMENTS');
 const requestPath=absolute(process.argv[3]);noLinks(requestPath);const st=lstatSync(requestPath);if(!st.isFile()||st.size>65536)fail('AUTH_GO_FIXTURE_CAP');
 const request=JSON.parse(readFileSync(requestPath,'utf8'));if(Object.hasOwn(request,'outputRoot'))fail('AUTH_GO_FIXTURE_ARGUMENTS');
 console.log(JSON.stringify(prepareAuthGoFixtureCIData({...request,outputRoot:absolute(process.argv[5])})));
}
