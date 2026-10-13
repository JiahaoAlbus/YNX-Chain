import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, rename, chmod, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { desktopReleaseIdentity, verifyDesktopPackage, relocateDesktopPackage, relocateDesktopRuntimeSource, desktopAsarHeaderIntegrity, PACKAGED_RELOCATION_RULES, PACKAGED_RELOCATION_RECEIPT } from "../scripts/release-provenance.mjs";
import afterPack, {updatedMacAsarIntegrity} from "../scripts/after-pack.mjs";

const actualProject = fileURLToPath(new URL("..", import.meta.url));
const asarCLI = createRequire(path.join(actualProject, "package.json")).resolve("@electron/asar/bin/asar.js");
const asar = createRequire(path.join(actualProject, "package.json"))("@electron/asar");

test("electron-builder preserves dependency manifests for byte-exact provenance", async () => {
  const metadata = JSON.parse(await readFile(path.join(actualProject, "package.json"), "utf8"));
  assert.equal(metadata.build.removePackageScripts, false);
});

async function fixture(t, { includeRegistry = true, runtimeMetadata = {} } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "ynx-desktop-provenance-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = path.join(root, "apps/wallet-desktop"), stage = path.join(root, "package"), resources = path.join(root, "resources");
  const files = { "apps/wallet-desktop/package.json": JSON.stringify({name:"fixture",version:"0.6.4",...runtimeMetadata}),
    "apps/wallet-desktop/src/main.mjs": "export const fixture = true;\n",
    "packages/wallet-auth/package.json": '{"name":"@ynx-chain/wallet-auth","version":"1.1.0"}',
    "packages/wallet-auth/src/index.js": "export const fixture = 1;\n",
    "packages/wallet-auth/product-session-registry.json": '{"fixture":"registered-products"}\n',
    "packages/wallet-auth/src/runtime.json": '{"fixture":true}\n',
    "packages/wallet-auth/src/index.d.ts": "export declare const fixture: number;\n" };
  if (!includeRegistry) delete files["packages/wallet-auth/product-session-registry.json"];
  // PUBLIC text stand-ins faithfully reproduce all approved normal operands and
  // the static Vault/custodian/joint cycle. They are archived, never evaluated.
  for(const rule of PACKAGED_RELOCATION_RULES){
    files[rule.sourcePath]=(files[rule.sourcePath]??"")+rule.operands.map(operand=>operand.kind==="from"?`import {} from '${operand.from}';\n`:`const publicNativeURL = new URL('${operand.from}', import.meta.url);\n`).join("");
  }
  files["apps/wallet-desktop/src/password-wallet-vault.mjs"]+="import {} from './original-admission-custodian.mjs';\n";
  files["apps/wallet-desktop/src/original-admission-custodian.mjs"]+="import {} from './password-wallet-vault.mjs';\n";
  for(const rule of PACKAGED_RELOCATION_RULES){
    for(const operand of rule.operands){
      const target=path.posix.normalize(path.posix.join(path.posix.dirname(rule.sourcePath),operand.from));
      files[target]??=target.endsWith(".node")?"PUBLIC DATA ONLY — not a native module\n":"export const publicStandin = true;\n";
    }
  }
  for (const [name, content] of Object.entries(files)) { await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), content); }
  const git = args => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git(["init"]); git(["add", "apps", "packages"]); git(["-c", "user.name=YNX synthetic test", "-c", "user.email=fixture@example.invalid", "commit", "-m", "synthetic fixture"]);
  await symlink(path.join(actualProject, "node_modules"), path.join(project, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  await mkdir(resources);
  for (const [name, content] of Object.entries(files)) {
    if (name.endsWith(".d.ts")) continue; // Match electron-builder's actual package filter.
    const packed = name.startsWith("apps/wallet-desktop/") ? name.slice("apps/wallet-desktop/".length) : `node_modules/@ynx-chain/wallet-auth/${name.slice("packages/wallet-auth/".length)}`;
    await mkdir(path.dirname(path.join(stage, packed)), { recursive: true }); await writeFile(path.join(stage, packed), content);
  }
  const savedSHA = process.env.GITHUB_SHA;
  process.env.GITHUB_SHA = git(["rev-parse", "HEAD"]).toString().trim();
  t.after(() => { if (savedSHA === undefined) delete process.env.GITHUB_SHA; else process.env.GITHUB_SHA = savedSHA; });
  const identity = desktopReleaseIdentity(project, "0.6.4");
  await writeFile(path.join(resources, "ynx-wallet-build-identity.json"), JSON.stringify(identity));
  // This pinned ASAR version resolves createPackage before its write stream's
  // final flush. Waiting for the packaging process to exit matches release use
  // and prevents a concurrent test from reading a half-written archive.
  const rawPack = () => execFileSync(process.execPath, [asarCLI, "pack", stage, path.join(resources, "app.asar"), "--unpack", "original-auth-identity.node"], { stdio: "pipe" });
  const pack = () => {rawPack();relocateDesktopPackage(resources,project);};
  await pack(); return { root, project, stage, resources, identity, pack, rawPack, files,
    expectedFiles:Object.keys(files).filter(name=>!name.endsWith(".d.ts")&&(name.startsWith("apps/wallet-desktop/src/")||name.startsWith("packages/wallet-auth/src/")||["packages/wallet-auth/package.json","packages/wallet-auth/product-session-registry.json"].includes(name))).length };
}

for(const field of ["imports","exports"]){
  for(const nested of [false,true])test(`conditional resolution rejects reordered ${field} ${nested?"nested":"direct"} conditions`,async t=>{
    const conditions={node:"./src/main.mjs",default:"./src/fallback.mjs"};
    const wrap=value=>field==="imports"?{"#entry":nested?{import:value,default:"./src/fallback.mjs"}:value}:nested?{".":{import:value,default:"./src/fallback.mjs"}}:value;
    const f=await fixture(t,{runtimeMetadata:{[field]:wrap(conditions)}}),file=path.join(f.stage,"package.json"),metadata=JSON.parse(await readFile(file,"utf8"));
    metadata[field]=wrap({default:conditions.default,node:conditions.node});await writeFile(file,JSON.stringify(metadata));await f.pack();
    assert.throws(()=>verifyDesktopPackage(f.resources,f.project),new RegExp(`Packaged runtime metadata differs: ${field}`));
  });
}
test("conditional resolution preserves matching recursive mapping and release version",async t=>{
  const f=await fixture(t,{runtimeMetadata:{imports:{"#entry":{node:{import:["./src/main.mjs","./src/fallback.mjs"],default:"./src/main.mjs"},default:null}},exports:{".":{node:"./src/main.mjs",default:"./src/fallback.mjs"}}}});
  assert.equal(verifyDesktopPackage(f.resources,f.project).runtimePackageMetadataVerified,true);
});
test("conditional resolution does not impose execution order on dependency names",async t=>{
  const f=await fixture(t,{runtimeMetadata:{dependencies:{first:"1.0.0",second:"2.0.0"}}}),file=path.join(f.stage,"package.json"),metadata=JSON.parse(await readFile(file,"utf8"));
  metadata.dependencies={second:"2.0.0",first:"1.0.0"};await writeFile(file,JSON.stringify(metadata));await f.pack();
  assert.equal(verifyDesktopPackage(f.resources,f.project).runtimePackageMetadataVerified,true);
});

test("every runtime Wallet and SDK byte matches the exact commit, with excluded declarations explicit", async t => {
  const f = await fixture(t), result = verifyDesktopPackage(f.resources, f.project);
  assert.equal(result.files.length, f.expectedFiles); assert.equal(result.packagedSourceVerified, true);
  assert.deepEqual(result.excludedTypeDeclarations, ["packages/wallet-auth/src/index.d.ts"]);
  assert.equal(result.sourceVerificationScope, "every runtime Wallet and SDK source");
  assert.equal(result.sourceCommit, f.identity.sourceCommit); assert.equal(result.installedRuntimeVerified, false);
  assert.equal(result.productionSigned, false); assert.equal(result.storeReleased, false);
  assert.equal(result.runtimePackageMetadataVerified,true);
  assert.deepEqual(result.verifiedRuntimePackageFields,["name","main","type","imports","exports","dependencies","optionalDependencies","engines","os","cpu"]);
  assert.equal(desktopReleaseIdentity(f.project, "0.0.9").sourceVersion, "0.6.4"); // Existing upgrade-preflight stays truthful.
});

test("a missing runtime JSON remains a hard verification failure", async t => {
  const f = await fixture(t);
  await rm(path.join(f.stage, "node_modules/@ynx-chain/wallet-auth/src/runtime.json")); await f.pack();
  assert.throws(() => verifyDesktopPackage(f.resources, f.project), /was not found in this archive/);
});

test("changed packaged SDK or forged identity fails verification", async t => {
  const f = await fixture(t), file = path.join(f.stage, "node_modules/@ynx-chain/wallet-auth/src/index.js"), original = await readFile(file);
  await writeFile(file, "export const fixture = 'altered';\n"); await f.pack();
  assert.throws(() => verifyDesktopPackage(f.resources, f.project), /Packaged source differs/);
  await writeFile(file, original); await f.pack();
  await writeFile(path.join(f.resources, "ynx-wallet-build-identity.json"), JSON.stringify({ ...f.identity, sourceCommit: "a".repeat(40) }));
  assert.throws(() => verifyDesktopPackage(f.resources, f.project), /Embedded build identity/);
});

test("dirty tracked source and a different CI commit cannot acquire release identity", async t => {
  const f = await fixture(t);
  process.env.GITHUB_SHA = "a".repeat(40);
  assert.throws(() => desktopReleaseIdentity(f.project, "0.6.4"), /CI source and checkout differ/);
  process.env.GITHUB_SHA = f.identity.sourceCommit;
  await writeFile(path.join(f.project, "src/main.mjs"), "export const changed = true;\n");
  assert.throws(() => desktopReleaseIdentity(f.project, "0.6.4"));
});

for(const patch of [{main:"injected-entry.mjs"},{type:"commonjs"},{imports:{"#authority":"./injected-entry.mjs"}},{dependencies:{"@ynx-chain/wallet-auth":"file:../unreviewed-sdk"}},{name:"different-product"},{exports:{".":"./injected-entry.mjs"}},{optionalDependencies:{"unreviewed-extra":"1.0.0"}},{engines:{node:">=999"}}]){
  test(`runtime package metadata cannot substitute source-bound execution ${Object.keys(patch).join(",")}`,async t=>{
    const f=await fixture(t),file=path.join(f.stage,"package.json"),metadata=JSON.parse(await readFile(file,"utf8"));
    await writeFile(file,JSON.stringify({...metadata,...patch}));await f.pack();
    assert.throws(()=>verifyDesktopPackage(f.resources,f.project),/Packaged runtime metadata differs/);
  });
}
test("required runtime metadata cannot be omitted from otherwise matching source",async t=>{
  const f=await fixture(t),file=path.join(f.stage,"package.json"),metadata=JSON.parse(await readFile(file,"utf8"));
  delete metadata.name;await writeFile(file,JSON.stringify(metadata));await f.pack();
  assert.throws(()=>verifyDesktopPackage(f.resources,f.project),/Packaged runtime metadata differs: name/);
});
test("explicit release version change remains compatible with unchanged source runtime fields",async t=>{
  const f=await fixture(t),file=path.join(f.stage,"package.json"),metadata=JSON.parse(await readFile(file,"utf8"));
  metadata.version="0.6.5";await writeFile(file,JSON.stringify(metadata));await f.pack();
  const identity=desktopReleaseIdentity(f.project,"0.6.5");await writeFile(path.join(f.resources,"ynx-wallet-build-identity.json"),JSON.stringify(identity));
  const result=verifyDesktopPackage(f.resources,f.project);assert.equal(result.version,"0.6.5");assert.equal(result.sourceVersion,"0.6.4");assert.equal(result.runtimePackageMetadataVerified,true);assert.equal(result.productionSigned,false);
});


test("SDK root registry is mandatory in the packaged archive", async t => {
  const f = await fixture(t);
  await rm(path.join(f.stage, "node_modules/@ynx-chain/wallet-auth/product-session-registry.json")); await f.pack();
  assert.throws(() => verifyDesktopPackage(f.resources, f.project), /was not found in this archive/);
});

test("SDK root registry tampering is rejected even when src bytes match", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.stage, "node_modules/@ynx-chain/wallet-auth/product-session-registry.json"), '{"fixture":"other-products"}\n'); await f.pack();
  assert.throws(() => verifyDesktopPackage(f.resources, f.project), /Packaged source differs: packages\/wallet-auth\/product-session-registry\.json/);
});

test("SDK root registry must exist in the selected source commit", async t => {
  const f = await fixture(t, { includeRegistry: false });
  assert.throws(() => verifyDesktopPackage(f.resources, f.project), /Required runtime asset is missing from the selected commit: packages\/wallet-auth\/product-session-registry\.json/);
});

function normalEdges(archive) {
  asar.uncache(archive);
  const names=new Set(asar.listPackage(archive).map(name=>name.replace(/^\//,"")));
  const edges=[];
  for(const rule of PACKAGED_RELOCATION_RULES){
    const body=asar.extractFile(archive,path.normalize(rule.packedPath)).toString("utf8");
    for(const match of body.matchAll(/(?:from\s*|new\s+URL\s*\(\s*)['"](\.[^'"]+)['"]/g)){
      const target=path.posix.normalize(path.posix.join(path.posix.dirname(rule.packedPath),match[1]));
      edges.push({from:rule.packedPath,target,exists:names.has(target)});
    }
  }
  return edges;
}

test("R22 normal ASAR public graph parent missing paths RED becomes static one-copy closure", async t=>{
  const f=await fixture(t),archive=path.join(f.resources,"app.asar");
  f.rawPack();
  const before=normalEdges(archive),missing=before.filter(edge=>!edge.exists);
  assert.equal(missing.length,17);
  console.log(JSON.stringify({evidence:"R22_PUBLIC_PARENT_NORMAL_ASAR_LAYOUT_RED",missing,productEvaluation:0}));
  const native=path.join(archive+".unpacked/native/original-auth-identity.node"),nativeBefore=await readFile(native);
  const receipt=relocateDesktopPackage(f.resources,f.project),after=normalEdges(archive);
  assert.equal(after.filter(edge=>!edge.exists).length,0);
  const sdkJoint="node_modules/@ynx-chain/wallet-auth/src/original-auth-identity-private-joint-registration.js";
  assert.ok(after.some(e=>e.from===sdkJoint&&e.target==="src/password-wallet-vault.mjs"));
  assert.ok(after.some(e=>e.from==="src/password-wallet-vault.mjs"&&e.target==="src/original-admission-custodian.mjs"));
  assert.ok(after.some(e=>e.from==="src/original-admission-custodian.mjs"&&e.target===sdkJoint));
  assert.ok(!receipt.after.some(row=>row.path.startsWith("node_modules/apps/")||row.path.startsWith("packages/")));
  assert.deepEqual(await readFile(native),nativeBefore);
  const result=verifyDesktopPackage(f.resources,f.project);
  assert.equal(result.staticPathRelocationVerified,true);assert.equal(result.staticPathRelocation.length,7);
  assert.equal(result.installedRuntimeVerified,false);
  assert.equal(execFileSync("git",["status","--porcelain","--untracked-files=no"],{cwd:f.root,encoding:"utf8"}),"");
  console.log(JSON.stringify({evidence:"R22_PUBLIC_STATIC_NORMAL_ASAR_GRAPH_GREEN",edgeCount:after.length,relocatedFiles:7,productEvaluation:0,nativeLoad:0}));
});

test("R22 recipe preserves actual source static linking and only agreed operands",async ()=>{
  for(const rule of PACKAGED_RELOCATION_RULES){
    const sourcePath=rule.sourcePath.startsWith("apps/wallet-desktop/")?path.join(actualProject,rule.sourcePath.slice("apps/wallet-desktop/".length)):path.join(actualProject,"../..",rule.sourcePath);
    const original=await readFile(sourcePath),result=relocateDesktopRuntimeSource(rule.sourcePath,original);
    assert.equal(result.operands.length,rule.operands.length);
    let restored=result.bytes.toString("utf8");
    for(const operand of rule.operands) restored=restored.replace(operand.to,operand.from);
    assert.equal(restored,original.toString("utf8"));
    assert.equal(result.bytes.toString("utf8").includes("await import("),original.toString("utf8").includes("await import("));
  }
  // Relocation must preserve Auth's actual decoder logic, not manufacture a
  // decoder or require that a known defect stay forever after Auth fixes it.
  const jointPath="packages/wallet-auth/src/original-auth-identity-private-joint-registration.js";
  const original=await readFile(path.join(actualProject,"../..",jointPath)),body=relocateDesktopRuntimeSource(jointPath,original).bytes.toString("utf8");
  assert.equal(body.includes(".pathname"),original.toString("utf8").includes(".pathname"));
  assert.equal(body.includes("fileURLToPath"),original.toString("utf8").includes("fileURLToPath"));
  console.log(JSON.stringify({evidence:"R22_AUTH_JOINT_LOADER_DECODER_LOGIC_PRESERVED_NOT_IMPLEMENTED",existingPathname:original.toString("utf8").includes(".pathname"),productEvaluation:0}));
});

for(const kind of ["missing","duplicate","unknown"])test(`R22 closed operand recipe rejects ${kind} operands`,async()=>{
  const rule=PACKAGED_RELOCATION_RULES[0],input=`import {} from '${rule.operands[0].from}';\n`;
  const body=kind==="missing"?"export const publicOnly=true;":kind==="duplicate"?input+input:input+"import {} from '../../../packages/wallet-auth/src/unapproved.js';\n";
  assert.throws(()=>relocateDesktopRuntimeSource(rule.sourcePath,Buffer.from(body)),/Relocation operand count differs|Unlisted repository operand/);
});
test("R22 unlisted runtime source cannot acquire a repository escape operand",()=>{
  assert.throws(()=>relocateDesktopRuntimeSource("packages/wallet-auth/src/unlisted.js",Buffer.from("import {} from '../../../apps/wallet-desktop/src/foreign.mjs';")),/Unlisted repository operand/);
});
test("R22 relocation rejects altered listed source before archive replacement",async t=>{
  const f=await fixture(t),p=path.join(f.stage,"src/main.mjs");
  await writeFile(p,(await readFile(p)).toString()+"export const foreignLogic=true;\n");f.rawPack();
  const archive=path.join(f.resources,"app.asar"),before=await readFile(archive);
  assert.throws(()=>relocateDesktopPackage(f.resources,f.project),/Relocation input differs/);
  assert.deepEqual(await readFile(archive),before);
});
test("R22 deterministic relocation is not silently applied twice",async t=>{
  const f=await fixture(t),before=await readFile(path.join(f.resources,"app.asar"));
  assert.throws(()=>relocateDesktopPackage(f.resources,f.project),/Relocation input differs/);
  assert.deepEqual(await readFile(path.join(f.resources,"app.asar")),before);
});
for(const field of ["recipe","sourceCommit","operandCount"])test(`R22 forged relocation receipt ${field} rejects`,async t=>{
  const f=await fixture(t),p=path.join(f.resources,PACKAGED_RELOCATION_RECEIPT),receipt=JSON.parse(await readFile(p,"utf8"));
  if(field==="operandCount")receipt.files[0].operands[0].count=2;else receipt[field]="forged";
  await writeFile(p,JSON.stringify(receipt));assert.throws(()=>verifyDesktopPackage(f.resources,f.project),/relocation receipt differs/);
});
test("R22 additional executable runtime member is rejected even with a fresh receipt",async t=>{
  const f=await fixture(t);await writeFile(path.join(f.stage,"src/foreign.mjs"),"export const foreign=true;\n");f.pack();
  assert.throws(()=>verifyDesktopPackage(f.resources,f.project),/Unlisted packaged runtime member/);
});
test("R22 unpacked native placeholder tampering rejects without loading it",async t=>{
  const f=await fixture(t),p=path.join(f.resources,"app.asar.unpacked/native/original-auth-identity.node");
  await writeFile(p,"PUBLIC ALTERED — still not a module");assert.throws(()=>verifyDesktopPackage(f.resources,f.project),/archive differs from relocation receipt/);
});
test("R22 nonlisted SDK body remains byte-exact, not relaxed by relocation",async t=>{
  const f=await fixture(t);await writeFile(path.join(f.stage,"node_modules/@ynx-chain/wallet-auth/src/index.js"),"export const altered=true;\n");f.pack();
  assert.throws(()=>verifyDesktopPackage(f.resources,f.project),/Packaged source differs/);
});
test("R22 runtime entrypoint guard remains strict after static relocation",async t=>{
  const f=await fixture(t),p=path.join(f.stage,"package.json"),metadata=JSON.parse(await readFile(p,"utf8"));metadata.main="foreign.mjs";
  await writeFile(p,JSON.stringify(metadata));f.pack();assert.throws(()=>verifyDesktopPackage(f.resources,f.project),/Packaged runtime metadata differs: main/);
});
test("R22 untouched archive files and literal symlink survive data repack",async t=>{
  const f=await fixture(t);await mkdir(path.join(f.stage,"public"));await writeFile(path.join(f.stage,"public/sentinel.txt"),"PUBLIC SENTINEL\n");
  await symlink("sentinel.txt",path.join(f.stage,"public/link"));f.rawPack();
  const receipt=relocateDesktopPackage(f.resources,f.project);
  for(const row of receipt.before.filter(row=>row.path.startsWith("public/")))assert.deepEqual(receipt.after.find(other=>other.path===row.path),row);
  assert.equal(verifyDesktopPackage(f.resources,f.project).staticPathRelocationVerified,true);
});

test("R22 followup header integrity agrees with cached builder algorithm",async t=>{
  const f=await fixture(t),require=createRequire(path.join(actualProject,"package.json"));
  const {computeData}=require("app-builder-lib/out/asar/integrity.js");
  const data=await computeData({resourcesPath:f.resources,resourcesRelativePath:"Resources",resourcesDestinationPath:f.resources,extraResourceMatchers:[]});
  assert.deepEqual(desktopAsarHeaderIntegrity(f.resources,f.project),data["Resources/app.asar"]);
});
test("R22 followup Mac normal afterPack updates header integrity before signing",{skip:process.platform!=="darwin"},async t=>{
  const f=await fixture(t);f.rawPack();
  const stale=desktopAsarHeaderIntegrity(f.resources,f.project);
  const appOutDir=path.join(f.root,"PUBLIC-DATA-OUTPUT"),contents=path.join(appOutDir,"PUBLIC Wallet.app/Contents"),resources=path.join(contents,"Resources"),plist=path.join(contents,"Info.plist");
  await mkdir(contents,{recursive:true});await rename(f.resources,resources);
  execFileSync("plutil",["-create","xml1",plist]);
  const other={algorithm:"SHA256",hash:"1".repeat(64)};
  execFileSync("plutil",["-insert","ElectronAsarIntegrity","-json",JSON.stringify({"Resources/app.asar":stale,"Resources/other.asar":other}),plist]);
  await afterPack({appOutDir,electronPlatformName:"darwin",packager:{projectDir:f.project,appInfo:{version:"0.6.4",productFilename:"PUBLIC Wallet"}}});
  const current=JSON.parse(execFileSync("plutil",["-extract","ElectronAsarIntegrity","json","-o","-",plist],{encoding:"utf8"}));
  assert.notDeepEqual(current["Resources/app.asar"],stale);
  assert.deepEqual(current["Resources/app.asar"],desktopAsarHeaderIntegrity(resources,f.project));
  assert.deepEqual(current["Resources/other.asar"],other);
  assert.equal(verifyDesktopPackage(resources,f.project).macAsarIntegrityVerified,true);
  execFileSync("plutil",["-replace","ElectronAsarIntegrity","-json",JSON.stringify({"Resources/app.asar":stale}),plist]);
  assert.throws(()=>verifyDesktopPackage(resources,f.project),/Mac ASAR integrity metadata differs/);
});
for(const existing of [null,[],{}, {"Resources/app.asar":{algorithm:"DISABLED"}}])test(`R22 followup missing or disabled integrity metadata refuses ${JSON.stringify(existing)}`,()=>{
  assert.throws(()=>updatedMacAsarIntegrity(existing,{algorithm:"SHA256",hash:"a".repeat(64)}),/Expected normal Mac ASAR integrity/);
});
test("R22 followup unpacked native executable mode is preserved and tampering rejected",async t=>{
  const f=await fixture(t);f.rawPack();const native=path.join(f.resources,"app.asar.unpacked/native/original-auth-identity.node");await chmod(native,0o755);
  relocateDesktopPackage(f.resources,f.project);assert.equal((await stat(native)).mode&0o777,0o755);
  assert.equal(verifyDesktopPackage(f.resources,f.project).staticPathRelocationVerified,true);
  await chmod(native,0o644);assert.throws(()=>verifyDesktopPackage(f.resources,f.project),/archive differs from relocation receipt/);
});
test("R22 followup percent and space packaging paths retain sole SDK identity",async t=>{
  const f=await fixture(t);f.rawPack();const moved=path.join(f.root,"PUBLIC space % # Unicode 中文 Resources");await rename(f.resources,moved);
  const receipt=relocateDesktopPackage(moved,f.project);assert.equal(receipt.files.length,7);assert.equal(normalEdges(path.join(moved,"app.asar")).filter(e=>!e.exists).length,0);
  assert.equal(verifyDesktopPackage(moved,f.project).staticPathRelocationVerified,true);
  // This is data graph evidence only; neither Auth loader nor .node executes.
});
