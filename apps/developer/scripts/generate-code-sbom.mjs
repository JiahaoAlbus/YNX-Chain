import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync, lstatSync, realpathSync, readlinkSync } from "node:fs";
import { join, dirname, resolve, relative, sep, basename, isAbsolute } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { fileURLToPath } from "node:url";
import {CONTROL_MATCHED_VARIANT,matchedNodePackageSourceRoles} from './c6-control-matched-input.mjs';
export function addMatchedNodeSBOMComponent(components,roles){
 if(roles?.sourceVariant!==CONTROL_MATCHED_VARIANT)return;
 const checked=matchedNodePackageSourceRoles({schema:'YNX_IDE_CONTROL_MATCHED_WHOLE_NORMAL_PRODUCT/v1',NativeBuildOrRelinkRequested:false,SDKResourceOnlySuccessor:true,roles:{CocoaCompiledSDK:roles.CocoaCompiledSDK,CocoaCPPBase:roles.compiledCocoaNativeSourceCommit},matchedNode:{sourceRoles:roles.matchedNodeSourceRoles,record:roles.matchedNodeRecord,image:roles.matchedNodeImage}});
 components.push({type:'library','bom-ref':'ynx:wallet-control-node:sha256:'+checked.matchedNodeImage.sha256,name:'YNX matched Wallet Control Node composite',version:checked.matchedNodeImage.sha256,scope:'required',hashes:[{alg:'SHA-256',content:checked.matchedNodeImage.sha256}],properties:[...Object.entries(checked.matchedNodeSourceRoles).map(([name,value])=>({name:'ynx:'+name,value:String(value)})),{name:'ynx:originalMatchingRecordSHA256',value:checked.matchedNodeRecord.sha256},{name:'ynx:recordedObjectCount',value:'87'},{name:'ynx:inheritedCocoaCompiledSDK',value:checked.CocoaCompiledSDK}]});
}
const R21_VARIANT='R21_COCOA_SUCCESSOR_NORMAL_PRODUCT';
const cocoaRevision = variant => ({ [R21_VARIANT]:'R21', R22_COCOA_SUCCESSOR_NORMAL_PRODUCT:'R22', R23_COCOA_SUCCESSOR_NORMAL_PRODUCT:'R23', R579_COCOA_SUCCESSOR_NORMAL_PRODUCT:'579' })[variant];
const R21_GO_ARCHIVE='packages/wallet-auth/native/vendor/link/libynx_artifact_release.a';
const R21_OBJECTS=[1,10,11,12,13,14,18,19,22,24,25].map(n=>`original-auth-common.arm64.${n}.o`);
const R21_COMMANDS=['compile-new-main','strict-c6-Cocoa-napi-free-closure-relink','normal-c6-Cocoa-relative-libssl.3.dylib','normal-c6-Cocoa-relative-libcrypto.3.dylib'];
const isSHA256=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const isCommit=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const isPin=row=>typeof row?.path==='string'&&isAbsolute(row.path)&&resolve(row.path)===row.path&&Number.isSafeInteger(row.bytes)&&row.bytes>0&&isSHA256(row.sha256);
const equal=isDeepStrictEqual;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

function readR21CocoaReceipt(pin){
 if(!isPin(pin))throw Error('R21 Cocoa SBOM execution receipt pin differs');
 const stat=lstatSync(pin.path);
 if(!stat.isFile()||stat.size!==pin.bytes||realpathSync(pin.path)!==pin.path)throw Error('R21 Cocoa SBOM execution receipt path differs');
 const bytes=readFileSync(pin.path);
 if(bytes.length!==pin.bytes||digest(bytes)!==pin.sha256)throw Error('R21 Cocoa SBOM execution receipt bytes differ');
 return JSON.parse(bytes);
}

function assertR21CocoaSBOM(native,sourceCommit,plan,roles,execution,receipt){
 const refuse=()=>{throw Error('R21 Cocoa SBOM source roles or linked roster differ');};
 const revision=cocoaRevision(native.sourceVariant);
 const receiptRoles = revision === '579' ? receipt?.roles : receipt?.sourceRoles;
 const receiptSchema = revision === '579' ? 'YNX_IDE_579_COCOA_INPUT_PREFLIGHT/v1' : `YNX_IDE_${revision}_COCOA_EXECUTION/v1`;
 if(plan?.schema!==`YNX_IDE_${revision}_COCOA_PRODUCT_PLAN/v1`||plan.variant!==native.sourceVariant||
    !isCommit(sourceCommit)||plan.sourceCommit!==sourceCommit||native.sourceCommit!==sourceCommit||execution?.sourceCommit!==sourceCommit||
    roles?.applicationSourceCommit!==sourceCommit||roles.assembledSourceCommit!==sourceCommit||roles.originalNativeReceiptsPreserved!==true||
    roles.sourceVariant!==CONTROL_MATCHED_VARIANT||plan.SDKSourceCommit!==native.SDKSourceCommit||roles.SDKResourceSourceCommit!==native.SDKSourceCommit||
    native.objects!==13||plan.objectCount!==13||native.commandCount!==0||!equal(plan.commands,[])||
    execution.complete!==true||!equal(execution.ownedUndefined,[])||!isPin(plan.cocoaExecution)||
    !equal(execution.cocoaExecution,plan.cocoaExecution)||!equal(roles.compiledCocoaReceipt,plan.cocoaExecution)||
    receipt?.schema!==receiptSchema||receipt.complete!==true||receipt.error!==null||
    !isPin(receipt.output)||execution.binarySHA256!==receipt.output.sha256||
    native.linkedBinarySHA256BeforeAdhocSigning!==receipt.output.sha256||
    !equal(plan.sourceRoles,receiptRoles)||!equal(execution.sourceRoles,receiptRoles))refuse();
 const r=receiptRoles;
 if(!r||!isCommit(receipt.sourceCommit)||!isCommit(receipt.sourceTree)||
    r.compiledCocoaApplication!==receipt.sourceCommit||r.compiledCocoaApplicationTree!==receipt.sourceTree||
    roles.compiledCocoaApplication!==receipt.sourceCommit||roles.compiledCocoaApplicationTree!==receipt.sourceTree||
    roles.compiledSDKSourceCommit!==r.compiledCocoaSDK||roles.CocoaCompiledSDK!==r.compiledCocoaSDK||
    roles.compiledNativeSourceCommit!==r.compiledCocoaCPP||roles.compiledCocoaNativeSourceCommit!==r.compiledCocoaCPP||
    !equal(roles.matchedNodeSourceRoles,r.NodeComposite)||r.SDKResource!==native.SDKSourceCommit||
    r.NodeComposite?.projectControlSource!==r.SDKResource)refuse();
 const inputs=receipt.retainedLinkInputs, main=receipt.mainObject;
 if(!Array.isArray(inputs)||inputs.length!==13||inputs.some(row=>!isPin(row))||!isPin(main)||
    !equal(inputs.map(row=>basename(row.path)),[...R21_OBJECTS,'ynx-wallet-admission-parent.m.o','libynx_artifact_release.a'])||
    basename(main.path)!=='main.m.o'||new Set([...inputs,main].map(row=>row.path)).size!==14||
    !equal(plan.retainedLinkInputs,inputs)||!equal(plan.mainObject,main))refuse();
 const archive=inputs.at(-1), archiveFields={bytes:archive.bytes,sha256:archive.sha256};
 if(!equal(plan.inputs,[{...archive,relativePath:R21_GO_ARCHIVE}])||
    !equal(native.originalCoreArchives,[{path:R21_GO_ARCHIVE,...archiveFields}]))refuse();
 const commands=receipt.commands;
 if(!Array.isArray(commands)||!equal(commands.map(command=>command?.name),R21_COMMANDS)||
    commands.some(command=>!Array.isArray(command.argv)||command.argv.some(value=>typeof value!=='string'))||
    !equal(plan.compiledCommands,commands)||
    !equal(receipt.results,R21_COMMANDS.map(name=>({name,status:0,signal:null}))))refuse();
 const linkInputs=commands[1].argv.filter(value=>/\.(?:o|a)$/.test(value));
 if(!equal(linkInputs,[...inputs.slice(0,11).map(row=>row.path),main.path,...inputs.slice(11).map(row=>row.path)])||
    !equal(commands[0].argv.filter(value=>value.endsWith('.o')),[main.path]))refuse();
}

export function assertNativeSBOMSourceShape(native,sourceCommit,plan,roles,execution,cocoaReceipt){
 if(native.schema!=='YNX_IDE_NORMAL_COCOA_LINK_DISTRIBUTION/v1'||!/^[a-f0-9]{40}$/.test(native.SDKSourceCommit))throw Error('Native SBOM closure identity differs');
 if(cocoaRevision(native.sourceVariant)){assertR21CocoaSBOM(native,sourceCommit,plan,roles,execution,cocoaReceipt);return;}
 if(!plan){if(native.sourceCommit!==sourceCommit||native.objects!==36)throw Error('Native SBOM closure identity differs');return;}
 if(native.sourceVariant==='C6_DIAGNOSTIC_NORMAL_PRODUCT'){
  const cocoa=plan.CocoaPlan;
  const commandCustody=plan.reusedCocoaExecution ? plan.commands?.length===0&&Array.isArray(cocoa?.commands)&&cocoa.commands.length>0&&JSON.stringify(roles?.compiledCocoaReceipt)===JSON.stringify(plan.reusedCocoaExecution)&&roles?.compiledSDKSourceCommit==='98956ed2bbac8bb5c86de83c4f1df24314e19bf0' : JSON.stringify(plan.commands)===JSON.stringify(cocoa?.commands);
  if(plan.schema!=='YNX_IDE_C6_PRODUCT_PLAN/v1'||plan.variant!==native.sourceVariant||!Array.isArray(plan.commands)||!Array.isArray(cocoa?.qualifiedObjects)||!Array.isArray(cocoa.retainedRootObjects)||cocoa.retainedRootObjects.length!==2||!cocoa.qualifiedObjects.length||plan.objectCount!==cocoa.qualifiedObjects.length+cocoa.retainedRootObjects.length||cocoa.objectCount!==plan.objectCount||native.objects!==plan.objectCount||native.commandCount!==plan.commands.length||!commandCustody||plan.sourceCommit!==sourceCommit||native.sourceCommit!==sourceCommit||roles?.applicationSourceCommit!==sourceCommit||roles.assembledSourceCommit!==sourceCommit||roles.compiledNativeSourceCommit!==cocoa.sourceRoles?.CPP||roles.SDKResourceSourceCommit!==native.SDKSourceCommit||plan.SDKSourceCommit!==native.SDKSourceCommit||roles.originalNativeReceiptsPreserved!==true)throw Error('C6 native SBOM source roles differ');
  return;
 }
 if(plan.schema!=='YNX_IDE_CURRENT_PRODUCT_QA_LINK_PLAN/v1'||!Array.isArray(plan.commands)||native.objects!==plan.commands.length||roles?.applicationSourceCommit!==sourceCommit||roles.assembledSourceCommit!==native.sourceCommit||roles.compiledNativeSourceCommit!==plan.compiledSource?.commit||roles.SDKResourceSourceCommit!==native.SDKSourceCommit||roles.originalNativeReceiptsPreserved!==true)throw Error('Current native SBOM source roles differ');
}

export function generateCodeSbom(output, runtimeNode, npmPackagePath, sourceCommit) {
if (!output || !runtimeNode || !npmPackagePath || !/^[0-9a-f]{40}$/.test(sourceCommit || "")) throw new Error("SBOM output, runtime, npm package and source commit are required.");
const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const npmPackage = JSON.parse(readFileSync(npmPackagePath, "utf8"));
const nodeVersion = execFileSync(runtimeNode, ["--version"], { encoding: "utf8" }).trim().replace(/^v/, "");
const components = [];
for (const [location, record] of Object.entries(lock.packages || {})) {
  if (!location.startsWith("node_modules/") || !record?.version) continue;
  const name = location.slice("node_modules/".length);
  if (!name || name.includes("/node_modules/")) continue;
  const component = {
    type: "library",
    "bom-ref": `pkg:npm/${name.replace(/^@/, "%40")}@${record.version}`,
    name,
    version: record.version,
    purl: `pkg:npm/${name.replace(/^@/, "%40")}@${record.version}`,
    scope: record.dev ? "optional" : "required",
    properties: [{ name: "ynx:lockfilePath", value: location }],
  };
  if (record.license) component.licenses = [{ license: { name: record.license } }];
  if (record.integrity) component.hashes = [{ alg: "SHA-512", content: Buffer.from(record.integrity.replace(/^sha512-/, ""), "base64").toString("hex") }];
  components.push(component);
}
components.push(
  { type: "framework", "bom-ref": `pkg:generic/node.js@${nodeVersion}`, name: "Node.js", version: nodeVersion, scope: "required" },
  { type: "application", "bom-ref": `pkg:npm/npm@${npmPackage.version}`, name: "npm", version: npmPackage.version, purl: `pkg:npm/npm@${npmPackage.version}`, scope: "required" },
);
const compilerReceipt = join(dirname(output), 'code/apps/developer/compiler-runtime/distribution.json');
if (existsSync(compilerReceipt)) {
  const compiler = JSON.parse(readFileSync(compilerReceipt, 'utf8'));
  if (!compiler.copiedClosureVerified || !compiler.compiler?.available) throw Error('Compiler SBOM requires a verified copied closure.');
  for (const record of compiler.packages) {
    const purl = `pkg:npm/${record.name.replace(/^@/, '%40')}@${record.version}`;
    let component = components.find(row => row['bom-ref'] === purl);
    if (!component) {
      component = { type: 'library', 'bom-ref': purl, name: record.name, version: record.version, purl, scope: 'required', properties: [] };
      if (record.license) component.licenses = [{ license: { name: record.license } }];
      components.push(component);
    }
    component.properties.push({ name: 'ynx:compilerClosureSha256', value: compiler.manifestSha256 });
  }
}
addPackagedServiceComponents(components, join(dirname(output), 'code/apps/developer'));
const nativeReceiptPath=join(dirname(output),'native-link/distribution.json');
if(existsSync(nativeReceiptPath)) {
  const native=JSON.parse(readFileSync(nativeReceiptPath,'utf8'));
  let currentPlan,currentRoles,currentExecution,cocoaReceipt;
  const binding=join(dirname(output),'code/apps/developer/identity-sdk-projection-binding.json');
  if(existsSync(binding)){
    const tree=execFileSync('/usr/bin/git',['rev-parse','HEAD^{tree}'],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8'}).trim();
    currentRoles=JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL('./verify-current-package-source-roles.mjs',import.meta.url)),resolve(dirname(output),'../..'),sourceCommit,tree],{encoding:'utf8'}));
    const raw=readFileSync(join(dirname(output),'native-link/plan.json')),execution=readFileSync(join(dirname(output),'native-link/execution.json'));
    if(createHash('sha256').update(raw).digest('hex')!==native.planSHA256||createHash('sha256').update(execution).digest('hex')!==native.executionSHA256)throw Error('Native SBOM original receipts changed');
    currentPlan=JSON.parse(raw);
    if(cocoaRevision(native.sourceVariant)){
      currentExecution=JSON.parse(execution);
      if(!equal(currentPlan.cocoaExecution,currentRoles.compiledCocoaReceipt))throw Error('R21 Cocoa SBOM execution custody differs');
      cocoaReceipt=readR21CocoaReceipt(currentPlan.cocoaExecution);
    }
  }
  assertNativeSBOMSourceShape(native,sourceCommit,currentPlan,currentRoles,currentExecution,cocoaReceipt);
  addMatchedNodeSBOMComponent(components,currentRoles);
  components.push({type:'library','bom-ref':`ynx:wallet-auth-native:${native.SDKSourceCommit}`,name:'YNX Wallet/Auth native Cocoa source',version:native.SDKSourceCommit,scope:'required',properties:[{name:'ynx:linkPlanSHA256',value:native.planSHA256},{name:'ynx:redistributionNoticeStatus',value:native.redistributionNoticeStatus}]});
  if(cocoaRevision(native.sourceVariant)){
    const properties=components.at(-1).properties;
    const retained=cocoaReceipt.retainedLinkInputs.slice(0,-1);
    const objectRoster=[...retained.slice(0,11).map(row=>({role:'retained CPP object',...row})),
      {role:'compiled Cocoa main',...cocoaReceipt.mainObject},{role:'retained Cocoa parent',...retained[11]}];
    properties.push(
      {name:'ynx:compiledNativeSourceCommit',value:currentRoles.compiledNativeSourceCommit},
      {name:'ynx:compiledCocoaApplication',value:currentRoles.compiledCocoaApplication},
      {name:'ynx:compiledCocoaApplicationTree',value:currentRoles.compiledCocoaApplicationTree},
      {name:'ynx:compiledCocoaSDK',value:currentRoles.CocoaCompiledSDK},
      {name:'ynx:assemblyProducerCommit',value:currentRoles.assembledSourceCommit},
      {name:'ynx:recordedProducerCommands',value:'0'},
      {name:'ynx:recordedCocoaExecutionCommands',value:String(cocoaReceipt.commands.length)},
      {name:'ynx:recordedObjects',value:String(objectRoster.length)},
      {name:'ynx:recordedObjectsFieldMeaning',value:'Eleven retained CPP objects, retained Cocoa parent, and newly compiled Cocoa main; archive recorded separately'},
      {name:'ynx:compiledCocoaReceiptSHA256',value:currentPlan.cocoaExecution.sha256},
      {name:'ynx:linkedObjectRoster',value:JSON.stringify(objectRoster.map(({path,...row})=>({name:basename(path),...row})))});
  } else if(currentRoles)components.at(-1).properties.push({name:'ynx:compiledNativeSourceCommit',value:currentRoles.compiledNativeSourceCommit},{name:'ynx:assemblyProducerCommit',value:currentRoles.assembledSourceCommit},{name:'ynx:recordedProducerCommands',value:String(native.sourceVariant==='C6_DIAGNOSTIC_NORMAL_PRODUCT'?native.commandCount:native.objects)},{name:'ynx:recordedObjects',value:String(native.objects)},{name:'ynx:recordedObjectsFieldMeaning',value:native.sourceVariant==='C6_DIAGNOSTIC_NORMAL_PRODUCT'?'Exact reused object count; actual compiler/link commands recorded separately':'Legacy field name; exact original plan command count, not a claim of translation-unit count'});
  for(const archive of native.originalCoreArchives) {
    if(!/^[a-f0-9]{64}$/.test(archive.sha256))throw Error('Native Core archive identity differs');
    components.push({type:'library','bom-ref':`ynx:artifact-release-core:sha256:${archive.sha256}`,name:'YNX original artifact release Core archive',scope:'required',hashes:[{alg:'SHA-256',content:archive.sha256}]});
  }
}
components.sort((a, b) => a["bom-ref"].localeCompare(b["bom-ref"]));
const serialSeed = createHash("sha256").update(`${sourceCommit}\n${nodeVersion}\n${npmPackage.version}\n${components.map(value => value["bom-ref"]).join("\n")}`).digest("hex");
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: `urn:uuid:${serialSeed.slice(0,8)}-${serialSeed.slice(8,12)}-4${serialSeed.slice(13,16)}-a${serialSeed.slice(17,20)}-${serialSeed.slice(20,32)}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: { type: "application", "bom-ref": "pkg:npm/%40ynx/code-desktop@0.2.0", name: "YNX Code Desktop", version: "0.2.0" },
    properties: [
      { name: "ynx:sourceCommit", value: sourceCommit },
      { name: "ynx:dependencySource", value: "apps/developer/package-lock.json" },
      { name: "ynx:artifactClass", value: "unsigned-testnet-preview" },
    ],
  },
  components,
};
writeFileSync(output, `${JSON.stringify(sbom, null, 2)}\n`, { mode: 0o644 });
console.log(`Generated CycloneDX SBOM with ${components.length} components for Node ${nodeVersion} and npm ${npmPackage.version}.`);

return sbom;
}

// Read the packaged closure, never import or evaluate its dependency code.
export function addPackagedServiceComponents(components, packagedRoot) {
  if (!existsSync(packagedRoot)) return;
  const root = realpathSync(packagedRoot);
  const inside = target => {
    const real = realpathSync(target);
    const path = relative(root, real);
    if (path === '..' || path.startsWith('..' + sep) || path.startsWith(sep)) throw Error('Service dependency escapes packaged root: ' + target);
    return real;
  };
  const services = join(root, 'services');
  // A retained command symlink can require a service closure even when that
  // closure was omitted entirely; missing services must not silently disappear.
  const bin = join(root, 'node_modules/.bin');
  if (existsSync(bin)) for (const name of readdirSync(bin).sort()) {
    const entry = join(bin, name);
    if (!lstatSync(entry).isSymbolicLink()) continue;
    const target = resolve(dirname(entry), readlinkSync(entry));
    const rel = relative(root, target);
    if (rel === 'services' || rel.startsWith('services' + sep)) inside(entry);
  }
  if (!existsSync(services)) return;
  inside(services);
  const add = folder => {
    inside(folder);
    const metadataPath = join(folder, 'package.json');
    inside(metadataPath);
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    if (typeof metadata.name !== 'string' || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(metadata.name) || typeof metadata.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(metadata.version)) throw Error('Invalid required service dependency metadata: ' + metadataPath);
    const purl = 'pkg:npm/' + metadata.name.replace(/^@/, '%40') + '@' + metadata.version;
    let component = components.find(row => row['bom-ref'] === purl);
    if (!component) {
      component = { type: 'library', 'bom-ref': purl, name: metadata.name, version: metadata.version, purl, scope: 'required', properties: [] };
      components.push(component);
    }
    component.scope = 'required';
    component.properties ||= [];
    const location = relative(root, folder).split(sep).join('/');
    if (!component.properties.some(item => item.name === 'ynx:packagedServicePath' && item.value === location)) component.properties.push({ name: 'ynx:packagedServicePath', value: location });
    const license = typeof metadata.license === 'string' ? metadata.license : metadata.license?.type;
    if (license) {
      component.licenses ||= [];
      if (!component.licenses.some(item => item.license?.name === license)) component.licenses.push({ license: { name: license } });
    }
  };
  const walkModules = (modules, ancestors = new Set()) => {
    if (!existsSync(modules)) return;
    const real = inside(modules);
    if (ancestors.has(real)) return;
    const next = new Set(ancestors).add(real);
    for (const name of readdirSync(modules).sort()) {
      if (name.startsWith('.')) continue;
      const entry = join(modules, name);
      const packages = name.startsWith('@') ? readdirSync(inside(entry)).sort().map(child => join(entry, child)) : [entry];
      for (const folder of packages) {
        if (!lstatSync(folder).isDirectory() && !lstatSync(folder).isSymbolicLink()) throw Error('Invalid service dependency entry: ' + folder);
        add(folder);
        walkModules(join(folder, 'node_modules'), next);
      }
    }
  };
  for (const service of readdirSync(services).sort()) {
    const folder = join(services, service);
    if (lstatSync(folder).isDirectory() || lstatSync(folder).isSymbolicLink()) {
      inside(folder);
      walkModules(join(folder, 'node_modules'));
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) generateCodeSbom(...process.argv.slice(2));
