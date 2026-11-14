import {readFile,writeFile,lstat} from'node:fs/promises';import{join,resolve}from'node:path';import{fileURLToPath}from'node:url';import{createHash,randomUUID}from'node:crypto';import{execFileSync}from'node:child_process';
import{currentSourceProjectionInput}from'./current-source-projection-input.mjs';import{assertBuildOutputDirectory}from'./build-output-root.mjs';
const developer=fileURLToPath(new URL('../',import.meta.url)),owner=resolve(developer,'../../..'),root=join(owner,'qa-builds/app-current-r2-projected-20261101'),app=join(root,'YNX Developer Testnet Preview.app');
const sha=b=>createHash('sha256').update(b).digest('hex');
async function absent(path){try{await lstat(path);}catch(e){if(e.code==='ENOENT')return;throw e;}throw Error('Existing package stage requires reconciliation: '+path);}
export function remainderArtifacts(output,sourceCommit,resumeSBOM){
 if(!/^[a-f0-9]{40}$/.test(sourceCommit)||typeof resumeSBOM!=='boolean')throw Error('Exact producer and stage required');
 const stem='NORMAL_PACKAGE_REMAINDER_'+(resumeSBOM?'SBOM_':'')+sourceCommit;
 return {script:join(output,stem+'.sh'),receipt:join(output,stem+'_SOURCE.json')};
}
export async function finishCurrentProjectionPackage(resumeSBOM=false){
 await currentSourceProjectionInput();await assertBuildOutputDirectory(app);
 const prep=JSON.parse(await readFile(join(root,'PROJECTION_PREPARE.json')));
 if(prep.schema!=='YNX_P03_FRESH_PROJECTION_CANDIDATE_PREPARE/v1'||prep.newApp!==app||prep.oldPartialAppModified!==false||prep.preparedOnly!==true||prep.projectionResult?.archiveVerified!==true||prep.projectionResult?.archivedSources!==4)throw Error('Exact fresh projection preparation must complete first');
 const resources=join(app,'Contents/Resources');for(const rel of ['build-provenance.json','sbom.cdx.json','native-link/actual-current-auth-component.json','native-link/packaged-native-runtime.json'])await absent(join(resources,rel));
 const git=a=>execFileSync('/usr/bin/git',a,{cwd:developer,encoding:'utf8'}).trim();if(git(['status','--porcelain','--untracked-files=no']))throw Error('Committed final package producer required');
 const sourceCommit=git(['rev-parse','HEAD']),sourceTree=git(['rev-parse','HEAD^{tree}']),script=await readFile(join(developer,'scripts/package-local-macos.sh'));
 const committed=execFileSync('/usr/bin/git',['show',sourceCommit+':apps/developer/scripts/package-local-macos.sh'],{cwd:developer});if(!script.equals(committed))throw Error('Normal package remainder source changed');
 let marker='node scripts/verify-macos-compatibility.mjs "$app" "$macos_min_version" "$machine_arch" "$app/Contents/Resources/macos-compatibility.json"';
 let cachedCompatibility;
 if(resumeSBOM){
  const frozen=JSON.parse(await readFile(join(owner,'P03_PROJECTED_MACCOMPAT_EXACT_INPUTS.json')));
  if(frozen.schema!=='YNX_P03_ACTUAL_FULL_MACCOMPAT_EXACT_INPUTS/v1'||frozen.App!==app||frozen.passed!==true||frozen.files.length!==23)throw Error('Exact previous complete scanner result required');
  for(const row of [frozen.report,...frozen.files]){const stat=await lstat(row.path),bytes=await readFile(row.path);if(!stat.isFile()||stat.isSymbolicLink()||bytes.length!==row.bytes||sha(bytes)!==row.sha256)throw Error('Previously scanned App binary or report changed');}
  const report=JSON.parse(await readFile(frozen.report.path));if(report.passed!==true||report.errors.length||report.minimumOS!==frozen.minimumOS)throw Error('Previous complete scanner was not successful');
  cachedCompatibility=frozen;
  marker='node scripts/generate-code-sbom.mjs';
 }
 const text=script.toString(),index=text.indexOf(marker);if(index<0||text.indexOf(marker,index+1)>=0)throw Error('Unique normal package continuation stage required');
 const artifacts=remainderArtifacts(root,sourceCommit,resumeSBOM),remainder=Buffer.from('set -euo pipefail\n'+text.slice(index)),remainderPath=artifacts.script;await writeFile(remainderPath,remainder,{flag:'wx',mode:0o600});
 const runtime=join(developer,'.ynx-developer-candidates/portable-node24-original-input'),identifier=sourceCommit+'-'+randomUUID();
 execFileSync('/usr/libexec/PlistBuddy',['-c','Set YNXQAProfileIdentifier '+identifier,join(app,'Contents/Info.plist')],{stdio:'pipe'});
 const minimum=execFileSync('/usr/libexec/PlistBuddy',['-c','Print LSMinimumSystemVersion',join(app,'Contents/Info.plist')],{encoding:'utf8'}).trim(),branding=join(root,'branding');
 const env={...process.env,...(cachedCompatibility?{compatibility_sha:cachedCompatibility.report.sha256}:{}),PATH:runtime+':/opt/homebrew/bin:/usr/bin:/bin',root,app,macos_min_version:minimum,machine_arch:process.arch==='arm64'?'arm64':'x86_64',platform:'macos-'+(process.arch==='arm64'?'arm64':'x64'),source_commit:sourceCommit,source_tree:sourceTree,source_date:git(['show','-s','--format=%cI','HEAD']),runtime_checkpoint:sourceCommit,local_node_runtime:runtime,node_binary:join(runtime,'node'),npm_root:join(resources,'runtime/npm/node_modules'),branding_root:branding,branding_sha:sha(await readFile(join(resources,'branding-manifest.json'))),qa_profile_identifier:identifier,native_link_input:'/REDACTED_VOLUME/YNX-large-work/wallet-auth-owned-ci-20261026/sdk49-ide-current-r2-product-normal-qa-successor-20261101/execution-current/HANDOFF.json',YNX_DEVELOPER_MACOS_REQUIRE_CLONE:'1',YNX_DEVELOPER_BUILD_OUTPUT_ROOT:join(owner,'qa-builds')};
 if(cachedCompatibility&&minimum!==cachedCompatibility.minimumOS)throw Error('Previously scanned deployment target changed');
 const receipt={schema:'YNX_P03_EXACT_NORMAL_PACKAGE_REMAINDER_SOURCE/v1',at:new Date().toISOString(),producerSourceCommit:sourceCommit,producerSourceTree:sourceTree,baseAssemblySourceCommit:'ba8879bc51744914074b1e1ab7cf8ba712d7db8a',compiledNativeSourceCommit:'674daf87e25f5048dbd95c78631ab0784190c1ab',runtimeCallerSourceCommit:'48738801d27ef3d86ded07641092edcf7d4ff41e',sourceScriptSHA256:sha(script),remainderSHA256:sha(remainder),startsAtLine:text.slice(0,index).split('\n').length,App:app,QAProfile:identifier,compileRepeated:false,frontendRepeated:false,formatterRepeated:false,coreArchiveRepeated:false,scannerRepeated:!resumeSBOM,reusedExactFullScanner:cachedCompatibility?{report:cachedCompatibility.report,binaries:cachedCompatibility.files.length}:null,RootAdmission:false,SourceAdmission:false,NativeAdmission:false};await writeFile(artifacts.receipt,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
 execFileSync('/bin/bash',[remainderPath],{cwd:developer,env,stdio:'inherit',maxBuffer:16*1024*1024});
 console.log(JSON.stringify({normalPackageRemainderComplete:true,App:app,producerSourceCommit:sourceCommit,formalPublication:false,GUI:false}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(process.argv.length!==2&&(process.argv.length!==3||process.argv[2]!=='--resume-sbom'))throw Error('Use fixed current normal package remainder or --resume-sbom');await finishCurrentProjectionPackage(process.argv[2]==='--resume-sbom');}
