import {realpath} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
// The production loader inspects its fixed vendor prefix; this build-time gate
// runs that same resolver without executing protected SDK entries. A projected
// package additionally runs its pinned Node IO custody verifier, reported as
// such rather than claiming the artifact check is pure data or zero execution.
export async function verifyPackagedSDKResolution(root){
 if(resolve(root)!==root||await realpath(root)!==root)throw Error('Canonical packaged Developer root required');
 const {inspectBundledIdentitySDK}=await import(pathToFileURL(join(root,'desktop/identity-sdk-loader.mjs')).href);
 return inspectBundledIdentitySDK();
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3)throw Error('Exact packaged Developer root required');
 console.log(JSON.stringify(await verifyPackagedSDKResolution(process.argv[2])));
}
