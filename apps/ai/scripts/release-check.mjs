import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,stat} from "node:fs/promises";

const root=new URL("../",import.meta.url);
const json=async path=>JSON.parse(await readFile(new URL(path,root),"utf8"));
const release=await json("product-release.json");
const artifacts=await json("artifact-manifest.json");
const integration=await json("integration/central-integration.json");
const required=["productId","name","branch","commit","version","surfaces","implementedLocal","testedLocal","installedLocal","integratedCentral","deployedStaging","deployedPublic","downloadHosted","productionSigned","storeReleased","publicUrls","healthUrls","artifactUrls","sha256","bytes","signingClass","minOS","installEvidence","centralIntegration","knownLimitations","generatedAt"];
for(const field of required)assert.ok(Object.hasOwn(release,field),`product-release missing ${field}`);
assert.equal(release.productId,"ynx-ai");
assert.equal(release.branch,"codex/ecosystem-ai");
assert.equal(release.integratedCentral,false);
assert.equal(release.deployedStaging,false);
assert.equal(release.deployedPublic,false);
assert.equal(release.downloadHosted,false);
assert.equal(release.productionSigned,false);
assert.equal(release.storeReleased,false);
assert.equal(release.generationLive,false);
assert.deepEqual(release.publicUrls,[]);
assert.deepEqual(release.healthUrls,[]);
assert.deepEqual(release.artifactUrls,[]);
assert.equal(integration.claims.integratedCentral,false);
assert.equal(integration.claims.generationLive,false);
if(process.env.REQUIRE_RELEASE_COMMIT==="1")assert.match(release.commit,/^[0-9a-f]{40}$/);

const apk=artifacts.artifacts.find(item=>item.mediaType==="application/vnd.android.package-archive");
assert.ok(apk);
try{
  const path=new URL(apk.path.replace(/^apps\/ai\//,""),root);
  const data=await readFile(path);
  const info=await stat(path);
  assert.equal(info.size,apk.bytes);
  assert.equal(createHash("sha256").update(data).digest("hex"),apk.sha256);
}catch(error){
  if(error?.code!=="ENOENT")throw error;
}

const [server,web,mobile,workflow,envExample,uiAudit,evidence,sbom,dependencyReview,gatewayPatch,walletPatch]=await Promise.all([
  readFile(new URL("../../internal/aiproduct/server.go",root),"utf8"),
  readFile(new URL("web/app.js",root),"utf8"),
  readFile(new URL("mobile/src/api.ts",root),"utf8"),
  readFile(new URL("../../.github/workflows/ynx-ai-mobile.yml",root),"utf8"),
  readFile(new URL(".env.example",root),"utf8"),
  readFile(new URL("UI_DESIGN_AUDIT.md",root),"utf8"),
  readFile(new URL("evidence-index.json",root),"utf8"),
  json("sbom.cdx.json"),
  readFile(new URL("DEPENDENCY_REVIEW.md",root),"utf8"),
  readFile(new URL("integration/central-ai-gateway-post.patch",root),"utf8"),
  readFile(new URL("integration/wallet-registry.patch",root),"utf8")
]);
assert.doesNotMatch(server+web+mobile,/OPENAI_API_KEY\s*=|sk-[A-Za-z0-9]{20,}/);
assert.doesNotMatch(mobile,/\?prompt=|searchParams\.set\(["']prompt/);
assert.match(server,/http\.MethodPost, "\/ai\/stream"/);
assert.match(server,/AllowLocalFixtureAuth/);
assert.match(envExample,/YNX_AI_ALLOW_LOCAL_FIXTURE_AUTH=0/);
for(const command of ["xcodebuild","simctl install","simctl launch","simctl openurl","shasum -a 256"])assert.ok(workflow.includes(command),`iOS CI missing ${command}`);
assert.match(uiAudit,/Remaining limitations/);
assert.match(evidence,/not-integrated-central/);
assert.equal(sbom.bomFormat,"CycloneDX");
assert.equal(sbom.specVersion,"1.5");
assert.ok(sbom.components.length>100,"SBOM must contain transitive Go/npm components");
assert.match(dependencyReview,/pnpm licenses list --json --prod/);
assert.match(gatewayPatch,/HandleFunc\("POST \/ai\/stream"/);
assert.match(walletPatch,/ai:attachments/);
console.log(JSON.stringify({ok:true,productId:release.productId,status:{implementedLocal:release.implementedLocal,testedLocal:release.testedLocal,installedLocal:release.installedLocal,integratedCentral:false,generationLive:false},apk:{sha256:apk.sha256,bytes:apk.bytes,signingClass:apk.signingClass}}));
