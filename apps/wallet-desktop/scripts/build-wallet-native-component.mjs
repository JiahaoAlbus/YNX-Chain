import {execFileSync} from 'node:child_process';
import {readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import * as originalBuild from './build-original-auth-identity-native.mjs';
import {composeWalletPublisherNativeBuildPlan,WALLET_PUBLISHER_NATIVE_INPUTS} from './wallet-publisher-native-build.mjs';
const here=fileURLToPath(import.meta.url),app=path.resolve(path.dirname(here),'..'),repo=path.resolve(app,'../..');
const hash=b=>createHash('sha256').update(b).digest('hex');
function assertMatchedOriginalBuild(){
 const sdk=JSON.parse(readFileSync(path.join(repo,'packages/wallet-auth/package.json')));
 if(sdk.version!=='1.3.0-pq.3.32-auth.13')throw Error('WALLET_NATIVE_MATCHED_SDK13_REQUIRED');
 const tool=path.join(app,'scripts/build-original-auth-identity-native.mjs'),toolStat=lstatSync(tool),toolBytes=readFileSync(tool);
 if(!toolStat.isFile()||toolStat.isSymbolicLink()||toolBytes.length!==10764||hash(toolBytes)!=='ae074c5d82d29c2b10a5ef0a55947ccc8a4a127745308a464c8c465035e0ee81')throw Error('WALLET_NATIVE_ORIGINAL_BUILD_TOOL_DIFFERS');
}
export function walletNativeComponentBuildPlan(arch,headers){
 assertMatchedOriginalBuild();
 for(const pin of WALLET_PUBLISHER_NATIVE_INPUTS){const file=path.join(repo,pin.path),stat=lstatSync(file),bytes=readFileSync(file);if(!stat.isFile()||stat.isSymbolicLink()||bytes.length!==pin.bytes||hash(bytes)!==pin.sha256)throw Error('WALLET_NATIVE_PUBLISHER_SOURCE_DIFFERS');}
 return composeWalletPublisherNativeBuildPlan(originalBuild.originalAuthNativeBuildPlan(arch,headers),repo);
}
if(process.argv[1]&&path.resolve(process.argv[1])===here){
 if(process.platform!=='darwin')throw Error('AUTH_NATIVE_MAC_ONLY');
 assertMatchedOriginalBuild();
 const mode=process.argv[2],helper=mode==='helper',io=mode==='source-current-io';
 if(helper&&process.argv.length!==4||io&&process.argv.length!==5||!helper&&!io&&process.argv.length!==4)throw Error('WALLET_NATIVE_BUILD_ARGUMENTS_INVALID');
 // Helper and separately explicit server IO retain the original supplier plan;
 // the Wallet Keychain class must NEVER be compiled into the privileged helper.
 const plan=helper?originalBuild.originalIDEHelperBuildPlan(process.argv[3]):io?originalBuild.originalAuthSourceCurrentIOBuildPlan(process.platform,process.argv[3],process.argv[4]):walletNativeComponentBuildPlan(mode??'arm64',process.argv[3]);
 for(const {tool,argv} of plan.commands)execFileSync(tool,argv,{stdio:'inherit'});
 if(!io)originalBuild.assertOriginalAuthOwnedSymbols(execFileSync(plan.ownedUndefinedScan.tool,plan.ownedUndefinedScan.argv,{encoding:'utf8'}));
}
