// Import the complete original frozen supplier closure; no alternate SDK,
// transport or manifest codec. Tests supply a PUBLIC Source recognizer only.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {openNativePayProductSource} from '../product-source.mjs';
const root=process.env.PAY_CLOUD_SOURCE_ROOT;
if(!root||!path.isAbsolute(root))throw Error('Verified original Cloud closure required');
const at=relative=>pathToFileURL(path.join(root,relative));
export const {YNXCloudClient}=await import(at('apps/cloud/sdk/index.js'));
export const {CloudDeploymentV2Client}=await import(at('apps/cloud/client/deployment-v2-client.mjs'));
export const manifestFixtureURL=at('apps/cloud/client/node_modules/@ynx-chain/open-protocol/test/fixtures/deployment-v2-manifest.json');
export async function openPublicCloudConsumer({client,selection,period,ref,current=()=>{}}){
 const loan={pay:{},current,cloudClient:client,
  readOriginalCloudBillLocator(input,fence){fence();if(input.productId!==ref.productId||input.sourceOrder!==ref.sourceOrder)throw Error('Original locator reference changed');return{selection,utcDay:period};},
  retire(){},async join(){},async close(){}};
 return openNativePayProductSource({acquireOriginalProductSource:async()=>loan,isOriginalProductSource:value=>value===loan});
}
