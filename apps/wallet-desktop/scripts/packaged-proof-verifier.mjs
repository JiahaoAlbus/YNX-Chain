import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {verifyPackagedPQVerifierAssets} from '../src/wallet-pq-verifier-assets.mjs';
import {originalPQVerifierReceipt} from '../src/wallet-pq-verifier-receipt.mjs';
const files=['SOURCE.json','manifest.json','darwin-arm64/ynx-consensus-proof-verify'];
const canonical=value=>{if(typeof value!=='string'||!path.isAbsolute(value)||path.normalize(value)!==value)throw Error('PQ_VERIFIER_BUILD_STAGE_REQUIRED');};
/** Build-only exact asset transfer, before outer sealing. No signer or
 * downloader, and no runtime ENV/path fallback. Failed/partial output is left
 * for the sole original builder to inspect, never overwritten or called good.
 */
export async function installPackagedPQVerifierAssets(resourcesPath,stagePath){
 canonical(resourcesPath);canonical(stagePath);
 if(await fs.realpath(resourcesPath)!==resourcesPath||await fs.realpath(stagePath)!==stagePath)throw Error('PQ_VERIFIER_BUILD_STAGE_UNVERIFIED');
 await verifyPackagedPQVerifierAssets(stagePath,originalPQVerifierReceipt);
 const target=path.join(resourcesPath,'consensus-proof-verifier');
 await fs.mkdir(target,{mode:0o755});await fs.mkdir(path.join(target,'darwin-arm64'),{mode:0o755});
 for(const relative of files){
  const destination=path.join(target,relative);
  await fs.copyFile(path.join(stagePath,'consensus-proof-verifier',relative),destination,constants.COPYFILE_EXCL);
  await fs.chmod(destination,relative.startsWith('darwin-arm64/')?0o755:0o644);
 }
 // Copy/permission failures and source replacement cannot produce a usable
 // candidate: validate both independent original pins and the destination.
 await verifyPackagedPQVerifierAssets(stagePath,originalPQVerifierReceipt);
 await verifyPackagedPQVerifierAssets(resourcesPath,originalPQVerifierReceipt);
 return Object.freeze({sourceCommit:originalPQVerifierReceipt.sourceCommit,bundledSha256:originalPQVerifierReceipt.bundled.sha256,installed:true,outerSealed:false});
}
