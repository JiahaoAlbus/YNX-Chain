import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,stat} from "node:fs/promises";

const root=new URL("../",import.meta.url);
const json=async path=>JSON.parse(await readFile(new URL(path,root),"utf8"));
const release=await json("product-release.json");
const artifacts=await json("artifact-manifest.json");
const integration=await json("integration/central-integration.json");
const contract=await json("../../release/integration/ynx-ai-contract.json");
const vectors=await json("../../docs/integration/CROSS_PRODUCT_TEST_VECTORS.json");
const productRegistry=await json("../../internal/aiproduct/product-ai-registry.json");
const required=["productId","name","branch","commit","version","surfaces","implementedLocal","testedLocal","installedLocal","integratedCentral","deployedStaging","deployedPublic","downloadHosted","productionSigned","storeReleased","publicUrls","healthUrls","artifactUrls","sha256","bytes","signingClass","minOS","installEvidence","centralIntegration","knownLimitations","generatedAt"];
for(const field of required)assert.ok(Object.hasOwn(release,field),`product-release missing ${field}`);
assert.equal(release.productId,"ynx-ai");
assert.equal(release.branch,"codex/final-ai");
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
assert.equal(productRegistry.schemaVersion,"ynx.ai.product-registry.v1");
assert.equal(productRegistry.registryVersion,"1.0.0");
assert.deepEqual(Object.values(productRegistry.defaultPolicy),Array(Object.keys(productRegistry.defaultPolicy).length).fill("deny"));
const expectedRegistryProducts=["ai","browser","calendar","card","cloud","creator-studio","developer","docs","exchange","explorer","finance","mail","monitor","music","pay","quant","resource","search","seller","shop","social","trust","video","wallet"];
assert.deepEqual(productRegistry.products.map(item=>item.id).sort(),expectedRegistryProducts);
const forbiddenToolVerbs=new Set(["sign","pay","refund","trade","swap","withdraw","issue","freeze","publish","send","delete","ban","mint","burn","execute","deploy","change","rollback"]);
for(const product of productRegistry.products){
  for(const field of ["id","displayName","owner","workflows","allowedContexts","forbiddenContexts","dataClasses","maxContextBytes","tools","requiredApproval","retention","providerModelPolicy","costBudget","audit"])assert.ok(Object.hasOwn(product,field),`registry product ${product.id} missing ${field}`);
  assert.ok(product.maxContextBytes>0&&product.maxContextBytes<=1048576,`registry product ${product.id} has invalid context budget`);
  assert.equal(product.costBudget.maxContextBytes,product.maxContextBytes,`registry product ${product.id} cost/context budget drift`);
  assert.equal(product.providerModelPolicy.selection,"gateway_model_registry_only");
  assert.equal(product.providerModelPolicy.fallback,"truthful_unavailable");
  assert.equal(product.providerModelPolicy.localModelCandidate,"explicit_capability_only");
  assert.equal(product.audit.rawContextStored,false);
  for(const field of ["requestId","accountHash","conversationId","productId","contextType","dataClass","sourceOwner","sourceVersion","asOf","permissionId","referenceHashes"])assert.ok(product.audit.requiredFields.includes(field),`registry product ${product.id} audit missing ${field}`);
  for(const tool of product.tools)assert.equal(forbiddenToolVerbs.has(tool.split("_")[0]),false,`registry product ${product.id} exposes executable tool ${tool}`);
  for(const context of product.allowedContexts){
    assert.ok(context.maxBytes>0&&context.maxBytes<=product.maxContextBytes,`registry context ${product.id}/${context.type} exceeds product budget`);
    assert.ok(context.maxAgeSeconds>0,`registry context ${product.id}/${context.type} lacks freshness bound`);
    assert.ok(["session_scope","explicit_selection","explicit_selection_and_permission"].includes(context.approval),`registry context ${product.id}/${context.type} has invalid approval`);
  }
}
assert.equal(contract.schemaVersion,"ynx.ai.integration.v1");
assert.equal(contract.product.id,"ynx-ai");
assert.equal(contract.product.owner,"14-ai");
assert.equal(contract.product.branch,"codex/final-ai");
assert.equal(contract.product.runtimeSourceCommit,release.commit);
assert.equal(integration.aiGateway.sourceCommit,release.commit);
assert.equal(contract.network.cosmosChainId,"ynx_6423-1");
assert.equal(contract.network.evmChainId,6423);
assert.equal(contract.network.nativeAsset,"YNXT");
assert.equal(contract.walletAuth.productClientId,"ynx-ai-v1");
assert.equal(contract.walletAuth.requestingProduct,"ai");
assert.equal(contract.walletAuth.bundleId,"com.ynxweb4.ai");
assert.deepEqual(contract.walletAuth.callbacks,["ynxai://wallet-auth/callback"]);
assert.deepEqual(contract.walletAuth.orderedScopes,["ai:actions","ai:attachments","ai:conversations","ai:data-control","ai:generate","ai:permissions"]);
assert.equal(contract.walletAuth.failClosedUntilAccepted,true);
assert.equal(contract.walletAuth.localFixtureAuthIsProductionAuthority,false);
assert.equal(contract.generationGateway.route,"POST /ai/stream");
assert.equal(contract.generationGateway.queryParametersAllowed,false);
assert.equal(contract.generationGateway.unknownFieldsAllowed,false);
assert.equal(contract.generationGateway.maxBodyBytes,2097152);
assert.deepEqual(contract.generationGateway.events.map(item=>item.name),["metadata","token","done"]);
assert.equal(contract.productGenerationStream.route,"POST /api/conversations/{id}/generate");
assert.deepEqual(contract.productGenerationStream.events.map(item=>item.name),["metadata","token","done","error"]);
assert.equal(contract.productGenerationStream.providerFailureCreatesAssistantMessage,false);
assert.equal(contract.generationCancellation.ownerBinding,"Wallet account");
assert.equal(contract.generationCancellation.wrongAccountStatus,404);
assert.equal(contract.toolApproval.aiMayExecuteExternalAction,false);
const canonicalErrors=new Map(contract.canonicalErrors.map(item=>[item.code,item]));
assert.equal(canonicalErrors.size,contract.canonicalErrors.length,"canonical error codes must be unique");
for(const [code,status] of [["invalid_request",400],["unsupported_media_type",415],["unauthorized",401],["rate_limited",429],["provider_rate_limited",429],["upstream_error",502],["generation_not_active",404]])assert.equal(canonicalErrors.get(code)?.httpStatus,status,`canonical error mismatch for ${code}`);
for(const field of ["implementedLocal","testedLocal","installedLocal","integratedCentral","deployedStaging","deployedPublic","downloadHosted","productionSigned","storeReleased","generationLive"])assert.equal(contract.releaseStatus[field],release[field],`contract/release mismatch for ${field}`);
assert.equal(vectors.schemaVersion,"ynx.ai.cross-product-vectors.v1");
assert.equal(vectors.contract,"release/integration/ynx-ai-contract.json");
assert.equal(vectors.runtimeSourceCommit,release.commit);
const vectorIds=vectors.vectors.map(item=>item.id);
assert.equal(new Set(vectorIds).size,vectorIds.length,"cross-product vector IDs must be unique");
for(const id of ["AI-WALLET-WRONG-PRODUCT","AI-WALLET-SCOPE-WIDEN","AI-WALLET-REPLAY","AI-GATEWAY-LEGACY-GET","AI-GATEWAY-QUERY-BEARING-POST","AI-GATEWAY-UNSUPPORTED-MEDIA","AI-GATEWAY-UNKNOWN-FIELD","AI-GATEWAY-IMPLICIT-ATTACHMENT","AI-GATEWAY-PROMPT-PRIVACY","AI-PROVIDER-429","AI-CANCEL-WRONG-ACCOUNT","AI-CANCEL-OWNER","AI-ACTION-APPROVED-NOT-EXECUTED","AI-CROSS-PRODUCT-CONTEXT-DENY","AI-BILLING-ACTUAL-USAGE-UNKNOWN"])assert.ok(vectorIds.includes(id),`missing cross-product vector ${id}`);
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

const [main,server,observabilityRuntime,backupRuntime,gatewayServer,gatewayRuntime,productRegistryRuntime,gatewayRegistryPolicy,contentGuard,web,mobile,workflow,envExample,uiAudit,observabilityDoc,sloCapacity,migrationCompatibility,unitEconomics,evidence,sbom,dependencyReview,gatewayPatch,walletPatch]=await Promise.all([
  readFile(new URL("main.go",root),"utf8"),
  readFile(new URL("../../internal/aiproduct/server.go",root),"utf8"),
  readFile(new URL("../../internal/aiproduct/observability.go",root),"utf8"),
  readFile(new URL("../../internal/aiproduct/backup.go",root),"utf8"),
  readFile(new URL("../../internal/aigateway/server.go",root),"utf8"),
  readFile(new URL("../../internal/aigateway/gateway.go",root),"utf8"),
  readFile(new URL("../../internal/aiproduct/product_registry.go",root),"utf8"),
  readFile(new URL("../../internal/aigateway/product_registry_policy.go",root),"utf8"),
  readFile(new URL("../../internal/aigateway/content_guard.go",root),"utf8"),
  readFile(new URL("web/app.js",root),"utf8"),
  readFile(new URL("mobile/src/api.ts",root),"utf8"),
  readFile(new URL("../../.github/workflows/ynx-ai-mobile.yml",root),"utf8"),
  readFile(new URL(".env.example",root),"utf8"),
  readFile(new URL("UI_DESIGN_AUDIT.md",root),"utf8"),
  readFile(new URL("OBSERVABILITY.md",root),"utf8"),
  readFile(new URL("SLO_CAPACITY_PLAN.md",root),"utf8"),
  readFile(new URL("MIGRATION_COMPATIBILITY.md",root),"utf8"),
  readFile(new URL("UNIT_ECONOMICS.md",root),"utf8"),
  readFile(new URL("evidence-index.json",root),"utf8"),
  json("sbom.cdx.json"),
  readFile(new URL("DEPENDENCY_REVIEW.md",root),"utf8"),
  readFile(new URL("integration/central-ai-gateway-post.patch",root),"utf8"),
  readFile(new URL("integration/wallet-registry.patch",root),"utf8")
]);
assert.doesNotMatch(server+web+mobile,/OPENAI_API_KEY\s*=|sk-[A-Za-z0-9]{20,}/);
assert.doesNotMatch(mobile,/\?prompt=|searchParams\.set\(["']prompt/);
assert.match(server,/http\.MethodPost, "\/ai\/stream"/);
assert.match(gatewayServer,/HandleFunc\("POST \/ai\/stream"/);
assert.doesNotMatch(gatewayServer,/HandleFunc\("GET \/ai\/stream"/);
assert.match(gatewayServer,/query parameters are not allowed on the AI stream endpoint/);
assert.match(gatewayServer,/DisallowUnknownFields\(\)/);
assert.match(gatewayServer,/http\.MaxBytesReader/);
assert.match(gatewayServer,/provider_rate_limited/);
assert.match(gatewayServer,/map\[string\]string\{\"code\": code, \"error\": message, \"requestId\": requestID\}/);
assert.match(server,/loadProductAIRegistry\(\)/);
assert.match(server,/handleProductAIRegistry/);
assert.match(server,/validateProductContextSelections/);
assert.match(productRegistryRuntime,/go:embed product-ai-registry\.json/);
assert.match(productRegistryRuntime,/PermissionByGatewayID/);
assert.match(productRegistryRuntime,/ReferenceIDs\s+\[\]string `json:\"-\"`/);
assert.match(productRegistryRuntime,/hashProductAccount/);
assert.match(productRegistryRuntime,/hashProductReference/);
assert.match(server,/payload\[\"accountHash\"\] = hashProductAccount\(session\.Account, conversationID\)/);
assert.match(gatewayServer,/AccountHash\s+string\s+`json:\"accountHash\"`/);
assert.match(gatewayServer,/productContextAudit/);
assert.match(gatewayServer,/request_authorized/);
assert.match(gatewayServer,/audit_unavailable/);
assert.match(gatewayRuntime,/type ProductContextAudit struct/);
assert.match(gatewayRuntime,/AccountHash\s+string\s+`json:\"accountHash,omitempty\"`/);
assert.match(gatewayRuntime,/ProductContexts\s+\[\]ProductContextAudit\s+`json:\"productContexts,omitempty\"`/);
assert.match(gatewayRuntime,/json\.Marshal\(entry\.ProductContexts\)/);
assert.match(gatewayRuntime,/entry\.AccountHash, entry\.PromptHash, contextPayload/);
assert.match(gatewayServer,/guardGenerationContent\(input\)/);
assert.match(gatewayServer,/validProductContextReference/);
assert.match(gatewayRegistryPolicy,/gatewayProductContextPolicies/);
assert.match(contentGuard,/restricted_context/);
assert.match(contentGuard,/containsIndirectPromptInjection/);
assert.match(contentGuard,/containsPaymentCardNumber/);
for(const product of productRegistry.products){
  assert.ok(gatewayRegistryPolicy.includes(`"${product.id}":`),`Gateway registry snapshot missing product ${product.id}`);
  for(const context of product.allowedContexts)assert.ok(gatewayRegistryPolicy.includes(`"${context.type}":`),`Gateway registry snapshot missing context ${product.id}/${context.type}`);
}
assert.match(server,/AllowLocalFixtureAuth/);
assert.match(server,/HandleFunc\("GET \/readyz", s\.handleReady\)/);
assert.match(server,/HandleFunc\("GET \/metrics", s\.handleMetrics\)/);
assert.match(observabilityRuntime,/X-Request-ID/);
assert.match(observabilityRuntime,/r\.Pattern/);
assert.match(observabilityRuntime,/ynx_ai_http_requests_total/);
assert.match(observabilityRuntime,/gatewayReachable/);
assert.doesNotMatch(observabilityRuntime,/RawQuery/);
assert.match(observabilityDoc,/does not claim central Monitor acceptance/);
assert.match(sloCapacity,/These thresholds are regression guards, not production SLOs/);
assert.match(main,/backup-create/);
assert.match(main,/backup-restore/);
assert.match(backupRuntime,/ynx\.ai\.state-backup\.v1/);
assert.match(backupRuntime,/func \(s \*Store\) CreateBackup/);
assert.match(backupRuntime,/func \(s \*Store\) RestoreBackup/);
assert.match(backupRuntime,/backup replay was rejected/);
assert.match(backupRuntime,/would roll back a newer local state/);
assert.match(migrationCompatibility,/does not claim a production migration/);
assert.match(migrationCompatibility,/Restore an authenticated backup into a fresh state path/);
assert.match(migrationCompatibility,/achieved RPO\/RTO/);
assert.match(unitEconomics,/actualUsageReported=false/);
assert.match(unitEconomics,/owner 26 Data Fabric and Billing Ledger/i);
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
