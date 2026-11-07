import { execFileSync, spawnSync } from "node:child_process";
import { readFile,stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {withMacDmgSource} from './mac-dmg-source.mjs';
import {verifyPackagedPQVerifierAssets} from '../src/wallet-pq-verifier-assets.mjs';
import {originalPQVerifierReceipt} from '../src/wallet-pq-runtime-component.mjs';
import {assertSelectedProofVerifierForSDK} from './proof-verifier-source-policy.mjs';
import {verifySDK13HelperBundle,SDK13_HELPER_ASSET,SDK13_HELPER_PLIST} from './sdk13-native-component.mjs';
import {assertNativeComponentGitSourceClosure} from './native-component-source-closure.mjs';
import {stageDesktopNative49C6Input} from './desktop-native49-c6-pack.mjs';
import {verifyPortableRuntimePackage} from './portable-runtime-pack.mjs';

if (process.platform !== "darwin") throw new Error("Build the macOS package on macOS");
const arch = process.argv[2] || "universal";
if (!["arm64", "x64", "universal"].includes(arch)) throw new Error("Choose arm64, x64 or universal");
const root = fileURLToPath(new URL("..", import.meta.url));
// Narrow normal-entry overrides for an already pinned local distribution.
// Never silently drop flags or pass arbitrary builder configuration through.
const extra=process.argv.slice(3),builderOptions=[];let electronDist=null,noRebuild=false,proofVerifierStage=null,physicalQA=false,qaOutput=null,c6Input=null;
for(const option of extra){
  if(option.startsWith('--native49-c6-component-input=')&&c6Input===null){
    c6Input=option.slice('--native49-c6-component-input='.length);
    if(arch!=='arm64'||!path.isAbsolute(c6Input)||path.normalize(c6Input)!==c6Input||c6Input.includes('\0'))throw Error('C6_ABSOLUTE_ARM64_INPUT_REQUIRED');
  }else if(option.startsWith('--config.electronDist=')&&electronDist===null){
    electronDist=option.slice('--config.electronDist='.length);
    if(!path.isAbsolute(electronDist)||electronDist.includes('\0')||electronDist.split('/').some(p=>p==='.'||p==='..'))throw Error('LOCAL_ELECTRON_DIST_ABSOLUTE_REQUIRED');
  }else if(option.startsWith('--proof-verifier-stage=')&&proofVerifierStage===null){
    proofVerifierStage=option.slice('--proof-verifier-stage='.length);
    if(arch!=='arm64'||!path.isAbsolute(proofVerifierStage)||path.normalize(proofVerifierStage)!==proofVerifierStage||proofVerifierStage.includes('\0'))throw Error('PQ_VERIFIER_BUILD_STAGE_INVALID');
  }else if(option==='--config.npmRebuild=false'&&!noRebuild)noRebuild=true;
  else if(option==='--qa-physical-layout'&&!physicalQA)physicalQA=true;
  else if(option.startsWith('--qa-output=')&&qaOutput===null){qaOutput=option.slice('--qa-output='.length);if(!path.isAbsolute(qaOutput)||path.normalize(qaOutput)!==qaOutput||qaOutput.includes('\0'))throw Error('LOCAL_QA_OUTPUT_ABSOLUTE_REQUIRED');builderOptions.push('--config.directories.output='+qaOutput);}
  else throw Error('UNSUPPORTED_MAC_BUILD_OPTION');
}
if((electronDist!==null)!==noRebuild)throw Error('LOCAL_ELECTRON_DIST_AND_NO_REBUILD_REQUIRED');
if(qaOutput!==null&&!physicalQA)throw Error('LOCAL_QA_OUTPUT_REQUIRES_PHYSICAL_QA');
if(physicalQA){if(arch!=='arm64'||!path.isAbsolute(process.env.YNX_WALLET_QA_PROFILE_PATH??''))throw Error('LOCAL_PHYSICAL_QA_PROFILE_REQUIRED');builderOptions.push('--config.afterPack=scripts/qa-physical-after-pack.mjs');}
if(arch==='arm64'&&proofVerifierStage===null)throw Error('PQ_VERIFIER_BUILD_STAGE_REQUIRED');
const matchedSDK=JSON.parse(await readFile(new URL('../../../packages/wallet-auth/package.json',import.meta.url),'utf8'));
assertSelectedProofVerifierForSDK(matchedSDK.version,originalPQVerifierReceipt);
if(proofVerifierStage!==null)await verifyPackagedPQVerifierAssets(proofVerifierStage,originalPQVerifierReceipt);
const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
if(electronDist!==null){
  if(!(await stat(electronDist)).isDirectory()||!(await stat(path.join(electronDist,'Electron.app/Contents/MacOS/Electron'))).isFile())throw Error('LOCAL_ELECTRON_DIST_INCOMPLETE');
  const version=(await readFile(path.join(electronDist,'version'),'utf8')).trim();
  if(version!==metadata.devDependencies.electron)throw Error('LOCAL_ELECTRON_VERSION_MISMATCH');
  builderOptions.push('--config.electronDist='+electronDist,'--config.npmRebuild=false');
}
// Fixed module must be frozen in a separately authorized native build first.
// Packaging never silently compiles/downloads a missing authority implementation.
const originalAuthNative=await stat(path.join(root,'native/original-auth-identity.node'));
if(!originalAuthNative.isFile()||originalAuthNative.size===0)throw Error('AUTH_NATIVE_FROZEN_MODULE_REQUIRED');
if(['1.3.0-pq.3.32-auth.46','1.3.0-pq.3.32-auth.49'].includes(matchedSDK.version)){
  const sourceRoot=execFileSync('git',['rev-parse','--show-toplevel'],{cwd:root,encoding:'utf8'}).trim();
  const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  assertNativeComponentGitSourceClosure(sourceRoot,sourceCommit,await readFile(path.join(root,'native/original-auth-identity-build.json')));
}
if(c6Input!==null){stageDesktopNative49C6Input(root,c6Input);builderOptions.unshift('--config='+fileURLToPath(new URL('./desktop-native49-c6-builder-config.mjs',import.meta.url)));}
const buildEnvironment={...process.env,YNX_WALLET_PROOF_VERIFIER_RESOURCES_STAGE:proofVerifierStage??''};
if(physicalQA){buildEnvironment.CSC_IDENTITY_AUTO_DISCOVERY='false';for(const key of ['CSC_LINK','CSC_KEY_PASSWORD','CSC_NAME','CSC_IDENTITY_NAME'])delete buildEnvironment[key];}
const result = spawnSync(process.execPath, [fileURLToPath(new URL("../node_modules/electron-builder/cli.js", import.meta.url)), "--mac", "--dir", `--${arch}`, "--publish", "never", ...builderOptions], {
  stdio: "inherit", cwd: root, env: buildEnvironment
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const appDir = path.join(qaOutput??path.join(root,'dist'), arch === "x64" ? "mac" : `mac-${arch}`, `${metadata.build.productName}.app`);
// Outer signing is complete. Never regenerate the Native record here to hide
// changed nested bytes; a mismatch is a failed package, including physical QA.
verifyPortableRuntimePackage(path.join(appDir,'Contents','Resources'),root);
// Fail before DMG production if outer packaging/signing omitted, moved or
// rewrote either member of the frozen SDK46 original helper pair.
if(['1.3.0-pq.3.32-auth.46','1.3.0-pq.3.32-auth.49'].includes(matchedSDK.version))verifySDK13HelperBundle(
  path.join(appDir,'Contents'),
  await readFile(path.resolve(root,'../..',SDK13_HELPER_ASSET)),
  await readFile(path.resolve(root,'../..',SDK13_HELPER_PLIST))
);
if(physicalQA){process.stdout.write(JSON.stringify({qaApp:appDir,officialRelease:false,installed:false,SourceAdmission:false,RootAdmission:false})+'\n');process.exit(0);}
// Verify again AFTER builder signing. The exact nested binary is signIgnored;
// any unexpected re-sign/rewrite is a failed build, not a replacement receipt.
if(proofVerifierStage!==null)await verifyPackagedPQVerifierAssets(path.join(appDir,'Contents','Resources'),originalPQVerifierReceipt);
const output = path.join(root, "dist", `ynx-wallet-macos-${metadata.version}-${arch}.dmg`);
await withMacDmgSource(appDir,async stage=>{
  // Native disk image creation avoids dmg-builder's optional Python/Finder dependency.
  execFileSync("/usr/bin/hdiutil", ["create", "-volname", metadata.build.productName, "-srcfolder", stage, "-ov", "-format", "UDZO", output], { stdio: "inherit" });
  console.log(`Created ${output}`);
});
