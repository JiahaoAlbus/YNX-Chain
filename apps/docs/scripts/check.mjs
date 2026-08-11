import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
const css=await readFile(new URL('../web/styles.css',import.meta.url),'utf8');
const js=await readFile(new URL('../web/app-secure.js',import.meta.url),'utf8');
const release=JSON.parse(await readFile(new URL('../product-release.json',import.meta.url),'utf8'));
const metadata=JSON.parse(await readFile(new URL('../public-product-metadata.json',import.meta.url),'utf8'));
const manifest=JSON.parse(await readFile(new URL('../evidence/ARTIFACT_MANIFEST.json',import.meta.url),'utf8'));
const registry=JSON.parse(await readFile(new URL('../../../packages/wallet-auth/central-registry.json',import.meta.url),'utf8'));
for(const required of ['<main','aria-live','conflict recovery','sign in with ynx wallet']) if(!html.toLowerCase().includes(required)) throw new Error(`missing ${required}`);
for(const required of ['prefers-reduced-motion','#002fa7']) if(!css.toLowerCase().includes(required)) throw new Error(`missing ${required}`);
for(const required of ['baseVersion','localStorage','presence','citations','window.ynxWallet?.authorize','YNX_PRODUCT_SESSION_CHALLENGE_V1']) if(!js.includes(required)) throw new Error(`missing workflow ${required}`);
for(const required of ['https://web4.ynxweb4.com/docs-app/auth/callback',"'/docs-app/api/v1'"]) if(!js.includes(required)) throw new Error(`missing public routing ${required}`);
if(js.includes('docs.staging.ynx.network')) throw new Error('staging callback leaked into the public Docs client');
if(/sessionStorage|requestSession|local-smoke-device|dev-signed/.test(js)) throw new Error('legacy or persisted Docs session flow detected');
if(!html.includes('src="app-secure.js"')||html.includes('src="app.js"'))throw new Error('production HTML is not bound exclusively to the secure Docs client');
if(html.includes('value="pdf"'))throw new Error('PDF is advertised without an implementation');
if(!/^[0-9a-f]{40}$/.test(release.sourceCommit)||release.runtimeSourceCommit!==release.sourceCommit)throw new Error('Docs source identity is invalid');
if(!release.states.integratedCentral||release.states.deployedPublic||release.states.downloadHosted||release.states.productionSigned||release.states.storeReleased)throw new Error('Docs release state overclaims or misses central integration');
if(metadata.runtimePublicUrl!==null||metadata.downloadUrl!==null||metadata.status!=='integrated-candidate-not-currently-public')throw new Error('public metadata overclaims the current Docs candidate');
const expectedScopes=['ai.use','audit.read','comments.write','data.delete','documents.read','documents.write','sharing.manage'];
for(const [productId,client,bundle,callback] of [['docs-mobile','ynx-docs-mobile-v1','com.ynxweb4.docs','ynxdocs://wallet-auth/callback'],['docs-web','ynx-docs-web-v1','web.ynx.docs','https://web4.ynxweb4.com/docs-app/auth/callback']]){
  const product=registry.products.find(item=>item.productId===productId);
  if(!product?.enabled||product.reviewState!=='approved'||product.productClientId!==client||product.requestingProduct!=='docs'||product.bundleId!==bundle||product.callbacks.join()!==callback||JSON.stringify(product.scopes)!==JSON.stringify(expectedScopes))throw new Error(`central Wallet binding drift for ${productId}`);
}
const artifact=await readFile(new URL('../release/YNX-Docs-1.0.0-testnet-preview.apk',import.meta.url));
const recorded=manifest.artifacts[0];
if(recorded.sha256!==createHash('sha256').update(artifact).digest('hex')||recorded.bytes!==artifact.length||release.historicalArtifact.currentSourceArtifact!==false)throw new Error('historical Docs artifact evidence drift');
console.log(`YNX Docs static, accessibility, recovery and release-truth checks passed for ${release.sourceCommit.slice(0,12)}`);
