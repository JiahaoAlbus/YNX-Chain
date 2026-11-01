// Explicit local QA successor of the normal pack hook. This does not publish,
// register a service, install an App, or create release/Root authority.
import afterPack,{updatedMacAsarIntegrity} from './after-pack.mjs';
import {verifyDesktopPackage} from './release-provenance.mjs';
import {assemblePhysicalQACodeLayout} from './physical-code-layout.mjs';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
export default async function qaAfterPack(context){
 if(context.electronPlatformName!=='darwin'||context.arch!==3)throw Error('WALLET_PHYSICAL_QA_ARM64_ONLY');
 const profile=process.env.YNX_WALLET_QA_PROFILE_PATH;
 if(!profile||!path.isAbsolute(profile)||path.normalize(profile)!==profile||fs.realpathSync(profile)!==profile||fs.readdirSync(profile).length)throw Error('WALLET_PHYSICAL_QA_FRESH_PROFILE_REQUIRED');
 await afterPack(context);
 const contents=path.join(context.appOutDir,context.packager.appInfo.productFilename+'.app','Contents'),resources=path.join(contents,'Resources'),plist=path.join(contents,'Info.plist');
 const original=verifyDesktopPackage(resources,context.packager.projectDir);
 const layout=assemblePhysicalQACodeLayout(resources,context.packager.projectDir,profile);
 const existing=JSON.parse(execFileSync('plutil',['-extract','ElectronAsarIntegrity','json','-o','-',plist],{encoding:'utf8'}));
 execFileSync('plutil',['-replace','ElectronAsarIntegrity','-json',JSON.stringify(updatedMacAsarIntegrity(existing,layout.bootstrapAsarHeaderIntegrity)),plist]);
 execFileSync('plutil',['-replace','CFBundleIdentifier','-string','com.ynxweb4.wallet.qa.'+original.sourceCommit.slice(0,12),plist]);
 execFileSync('plutil',['-replace','CFBundleDisplayName','-string','YNX Wallet QA',plist]);
 const checked=verifyDesktopPackage(resources,context.packager.projectDir);
 fs.writeFileSync(path.join(resources,'ynx-wallet-qa-verification.json'),JSON.stringify({sourceCommit:original.sourceCommit,beforePhysicalVerified:original.packagedSourceVerified,physical:checked.physicalCodeLayout,profile,officialRelease:false,installed:false,SourceAdmission:false,RootAdmission:false},null,2)+'\n');
}
