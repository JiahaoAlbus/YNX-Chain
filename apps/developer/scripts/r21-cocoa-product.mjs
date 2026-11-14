import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { c6Input } from './c6-diagnostic-product.mjs';
import { CONTROL_MATCHED_VARIANT, matchedNodePackageSourceRoles } from './c6-control-matched-input.mjs';
import { verifyPhysicalPin } from './next-product-supplier-input.mjs';

export const R21_VARIANT = 'R21_COCOA_SUCCESSOR_NORMAL_PRODUCT';
export const R21_HANDOFF = Object.freeze({
  path: '/REDACTED_VOLUME/YNX-large-work/wallet-auth-owned-ci-20261026/sdk49-ide-r21-cocoa-successor-20261113/R21_ACTUAL_PACKAGE_SUPPLIER.json',
  bytes: 2824,
  sha256: '8b30bc494545a7649ba0cc027de6d521705b382cdbb980b929b38d4a5cd11380',
});
export const R22_VARIANT = 'R22_COCOA_SUCCESSOR_NORMAL_PRODUCT';
export const R22_HANDOFF = Object.freeze({
  path: '/REDACTED_VOLUME/YNX-large-work/wallet-auth-owned-ci-20261026/sdk49-ide-r22-explorer-cocoa-successor-20261114/R22_ACTUAL_PACKAGE_SUPPLIER.json',
  bytes: 4278,
  sha256: '85ecf6b998c15ab705a211eddcddc22c102b73ef86f744bc3d91d4365954beb5',
});
export const R23_VARIANT = 'R23_COCOA_SUCCESSOR_NORMAL_PRODUCT';
export const R23_HANDOFF = Object.freeze({"path": "/REDACTED_VOLUME/YNX-large-work/wallet-auth-owned-ci-20261026/sdk49-ide-r23-explorer-cocoa-successor-20261114/R23_ACTUAL_PACKAGE_SUPPLIER.json", "bytes": 3048, "sha256": "a4b0117c8e2e45c53618c80dd90b9004e199ef8f6b34c584c97e9b5cb8aa4aed"});
const r23VerifierFiles = Object.freeze([{"path": "/REDACTED_VOLUME/YNX-large-work/coordination-v5-20261031/owners/P03/qa-builds/r23-sdk-verifier-575da0c/r23-cocoa-successor.mjs", "bytes": 7745, "sha256": "bc847a0673a4ffdae90bb30ce8b33d6b878b68042045f736808f594ec375fd44"}, {"path": "/REDACTED_VOLUME/YNX-large-work/coordination-v5-20261031/owners/P03/qa-builds/r23-sdk-verifier-575da0c/r23-cocoa-package.mjs", "bytes": 7929, "sha256": "fec29312d1f6d866b76bea45d467d4518ab8838c98446257c2b2fca89a6ae45e"}, {"path": "/REDACTED_VOLUME/YNX-large-work/coordination-v5-20261031/owners/P03/qa-builds/r23-sdk-verifier-575da0c/r22-cocoa-successor.mjs", "bytes": 9273, "sha256": "cc7d2fcae2fea6cfcba914e53cb476c1a48548012f351418803f44077a9916e5"}, {"path": "/REDACTED_VOLUME/YNX-large-work/coordination-v5-20261031/owners/P03/qa-builds/r23-sdk-verifier-575da0c/r21-cocoa-successor.mjs", "bytes": 7948, "sha256": "ce5d8e69b33969b093c69025cd547f36b32ece83bbc38dbd35ea4c1db6ed98b3"}, {"path": "/REDACTED_VOLUME/YNX-large-work/coordination-v5-20261031/owners/P03/qa-builds/r23-sdk-verifier-575da0c/normal-product.mjs", "bytes": 13247, "sha256": "5cc9d98893176dd7b1204387ddcb7d3ef78d9b56ce4b28d230b7e813092d6e56"}, {"path": "/REDACTED_VOLUME/YNX-large-work/coordination-v5-20261031/owners/P03/qa-builds/r23-sdk-verifier-575da0c/NORMAL_PRODUCT_CONTRACT.json", "bytes": 770481, "sha256": "b45f1f4e8c7f817d5781893f048757109a46366b19966daf0682a52c71729a98"}]);
export const R579_VARIANT = 'R579_COCOA_SUCCESSOR_NORMAL_PRODUCT';
export const R579_HANDOFF = Object.freeze({path:'/REDACTED_VOLUME/YNX-large-work/wallet-auth-owned-ci-20261026/sdk49-ide-579-fixture-8f-20261114/579_ACTUAL_PACKAGE_SUPPLIER.json',bytes:3430,sha256:'19cedf133566afd5ae2c6c663f88c0485525bcdd1d1504faa04e46ebb1da579e'});
const r579Verifier = Object.freeze({path:'/REDACTED_VOLUME/YNX-large-work/wallet-auth-owned-ci-20261026/sdk49-ide-579-strict-verify-successor-20261114-B4DG51/supplier-579-cocoa.mjs',bytes:10986,sha256:'20b939041ff15feb31bf1e258ec85275a89bc0283144f855e9accff1d49dd401'});
const r579StrictChild = Object.freeze({path:'/REDACTED_VOLUME/YNX-large-work/wallet-auth-owned-ci-20261026/sdk49-ide-579-strict-verify-successor-20261114-B4DG51/strict-child.mjs',bytes:1801,sha256:'19fbbe16c3adf1ec37e1a629fd9fe274f221f2d0b9b7dadc1b57b87e2b335c47'});
const revisions = {
  [R579_VARIANT]: { id: '579', pin: R579_HANDOFF },
  [R23_VARIANT]: { id: 'R23', pin: R23_HANDOFF },
  [R21_VARIANT]: { id: 'R21', pin: R21_HANDOFF },
  [R22_VARIANT]: { id: 'R22', pin: R22_HANDOFF },
};
export const cocoaVariantForHandoff = path => Object.keys(revisions).find(key => revisions[key].pin.path === path);
const sourceRoot = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const binarySuffix = '/Contents/MacOS/YNXDeveloper';
const developerPath = 'Contents/Resources/code/apps/developer';
const boundaries = Object.freeze({ RootAdmission: false, SourceAdmission: false, NativeAdmission: false });
const readJSON = async path => JSON.parse(await readFile(path));
const writeJSON = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const git = (...args) => execFileSync('/usr/bin/git', ['-C', sourceRoot, ...args], { encoding: 'utf8' }).trim();

async function readPinnedJSON(pin) {
  await verifyPhysicalPin(pin);
  const bytes = await readFile(pin.path);
  if (bytes.length !== pin.bytes || createHash('sha256').update(bytes).digest('hex') !== pin.sha256) {
    throw Error('R21 pinned JSON changed: ' + pin.path);
  }
  return JSON.parse(bytes);
}

async function supplier(variant) {
  const { id, pin } = revisions[variant];
  const handoff = await readPinnedJSON(pin);
  if (variant === R579_VARIANT) {
    await verifyPhysicalPin(r579Verifier);
    await verifyPhysicalPin(r579StrictChild);
    const verifier = await import(pathToFileURL(r579Verifier.path).href);
    if (!isDeepStrictEqual(verifier.verify579Supplier(), handoff)) throw Error('Exact 579 Cocoa and Core supplier required');
    return { handoff, pin, id, verify: () => verifier.verify579Supplier(),
      adopt: (_receipt, binary) => verifier.adopt579Cocoa(binary),
      verifyAssembly: verifier.verify579Assembly, verifyPostNested: verifier.verify579PostNested,
      readOuterSignedMain: verifier.read579OuterSignedMain };
  }
  if (variant === R23_VARIANT) {
    for (const record of r23VerifierFiles) await verifyPhysicalPin(record);
    const cocoa = await import(pathToFileURL("/REDACTED_VOLUME/YNX-large-work/coordination-v5-20261031/owners/P03/qa-builds/r23-sdk-verifier-575da0c/r23-cocoa-successor.mjs").href);
    const packaging = await import(pathToFileURL("/REDACTED_VOLUME/YNX-large-work/coordination-v5-20261031/owners/P03/qa-builds/r23-sdk-verifier-575da0c/r23-cocoa-package.mjs").href);
    const verified = packaging.verifyR23Supplier({receiptPin:handoff.receipt,corePin:handoff.core.pin,coreStatePin:handoff.core.state,coreTerminalPin:handoff.core.terminal});
    if (!isDeepStrictEqual(verified, handoff)) throw Error('Exact R23 Cocoa and Core supplier required');
    return { handoff:handoff, pin, id, verify:cocoa.verifyR23CocoaSuccessor, adopt:cocoa.adoptR23CocoaSuccessor,
      verifyAssembly:packaging.verifyR23Assembly, verifyPostNested:packaging.verifyR23PostNested, readOuterSignedMain:packaging.readR23OuterSignedMain };
  }
  if (handoff.schema !== `YNX_IDE_${id}_COCOA_PACKAGE_SUPPLIER/v1` ||
      handoff.wholeLinkVerified !== true || handoff.originalMatchedResourcesUnchanged !== true ||
      Object.keys(boundaries).some(key => handoff[key] !== false)) {
    throw Error('Exact R21 Cocoa supplier required');
  }
  if (variant === R22_VARIANT &&
      (handoff.core.sourceCommit !== handoff.compiledCocoaApplication ||
       handoff.core.sourceTree !== handoff.compiledCocoaApplicationTree)) {
    throw Error('R22 Cocoa and Core must share the compiled source');
  }
  for (const pin of [handoff.cocoaVerifier, handoff.packageVerifier]) await verifyPhysicalPin(pin);
  const cocoa = await import(pathToFileURL(handoff.cocoaVerifier.path).href);
  const packaging = await import(pathToFileURL(handoff.packageVerifier.path).href);
  return { handoff, pin, id,
    verify: cocoa[`verify${id}CocoaSuccessor`],
    adopt: cocoa[`adopt${id}CocoaSuccessor`],
    verifyAssembly: packaging[`verify${id}Assembly`],
    verifyPostNested: packaging[`verify${id}PostNested`],
    readOuterSignedMain: packaging[`read${id}OuterSignedMain`],
  };
}

function checkCocoa(handoff, verified) {
  if (!isDeepStrictEqual(verified.output, handoff.output) || !isDeepStrictEqual(verified.roles, handoff.roles)) {
    throw Error('R21 Cocoa readback differs from supplier');
  }
}

export async function buildR21Product({ workRoot, binary, minimumOS, execute, variant = R21_VARIANT }) {
  if (minimumOS !== '15.0' || !binary.endsWith('.app' + binarySuffix)) throw Error('Exact R21 App layout and deployment target required');
  const { handoff, pin, id, verify, adopt, verifyAssembly } = await supplier(variant);
  const sourceCommit = git('rev-parse', 'HEAD');
  const assemblyTree = git('rev-parse', 'HEAD^{tree}');
  verifyAssembly(sourceRoot, sourceCommit, assemblyTree);
  checkCocoa(handoff, verify(handoff.receipt));
  const receipt = await readPinnedJSON(handoff.receipt);
  const archive = receipt.retainedLinkInputs.find(row => row.path.endsWith('/libynx_artifact_release.a'));
  if (!archive || receipt.retainedLinkInputs.length !== 13 || receipt.commands.length !== 4) {
    throw Error('Exact R21 Cocoa command and link roster required');
  }
  const plan = {
    schema: `YNX_IDE_${id}_COCOA_PRODUCT_PLAN/v1`, variant, sourceCommit, assemblyTree,
    SDKSourceCommit: handoff.roles.SDKResource, sourceRoles: handoff.roles, supplierHandoff: pin,
    cocoaExecution: handoff.receipt, objectCount: 13, commands: [], compiledCommands: receipt.commands,
    retainedLinkInputs: receipt.retainedLinkInputs, mainObject: receipt.mainObject,
    inputs: [{ ...archive, relativePath: 'packages/wallet-auth/native/vendor/link/libynx_artifact_release.a' }],
    binary, minimumOS, ...boundaries,
  };
  await mkdir(workRoot, { mode: 0o700 });
  await writeJSON(join(workRoot, 'plan.json'), plan);
  if (!execute) return plan;

  checkCocoa(handoff, adopt(handoff.receipt, binary));
  const { contract, module } = await c6Input();
  const undefinedText = execFileSync('/usr/bin/nm', ['-u', binary], { encoding: 'utf8', maxBuffer: 16 << 20 });
  const ownedUndefined = module.ownedCocoaUndefinedDATA(undefinedText);
  if (ownedUndefined.length || contract.roles.SDKPublic !== handoff.roles.SDKResource) throw Error('R21 matched assets or owned symbols differ');
  await writeFile(join(workRoot, 'undefined.txt'), undefinedText, { flag: 'wx' });
  await module.stageDiagnosticAssets(join(binary.slice(0, -binarySuffix.length), developerPath));
  verifyAssembly(sourceRoot, sourceCommit, assemblyTree);
  await writeJSON(join(workRoot, 'execution.json'), {
    sourceCommit, complete: true, ownedUndefined, binarySHA256: handoff.output.sha256,
    cocoaExecution: handoff.receipt, sourceRoles: handoff.roles, ...boundaries,
  });
  return { staged: true, binary, sourceCommit, sourceRoles: handoff.roles };
}

export async function r21SourceRoles(app, assemblyCommit, assemblyTree, variant = R21_VARIANT) {
  const { handoff, pin, verify, verifyAssembly } = await supplier(variant);
  const assembly = verifyAssembly(sourceRoot, assemblyCommit, assemblyTree);
  checkCocoa(handoff, verify(handoff.receipt));
  const native = join(app, 'Contents/Resources/native-link');
  const plan = await readJSON(join(native, 'plan.json'));
  const execution = await readJSON(join(native, 'execution.json'));
  if (plan.variant !== variant || plan.sourceCommit !== assemblyCommit || plan.assemblyTree !== assemblyTree ||
      execution.sourceCommit !== assemblyCommit || execution.complete !== true || execution.ownedUndefined?.length !== 0 ||
      execution.binarySHA256 !== handoff.output.sha256 || !isDeepStrictEqual(plan.supplierHandoff, pin) ||
      ![plan, execution].every(row => isDeepStrictEqual(row.cocoaExecution, handoff.receipt) &&
        isDeepStrictEqual(row.sourceRoles, handoff.roles))) throw Error('R21 packaged source roles differ');
  const { contract, module } = await c6Input();
  const developer = join(app, developerPath);
  const loader = 'desktop/identity-sdk-loader.mjs';
  if (!(await readFile(join(developer, loader))).equals(await readFile(join(sourceRoot, 'apps/developer', loader)))) {
    throw Error('R21 packaged SDK loader differs from assembly');
  }
  module.verifyDiagnosticAssets(developer);
  return {
    schema: 'YNX_IDE_CURRENT_PACKAGE_SOURCE_ROLES/v1',
    applicationSourceCommit: assemblyCommit, applicationSourceTree: assemblyTree, ...assembly,
    compiledNativeSourceCommit: handoff.roles.compiledCocoaCPP,
    compiledNativeSwiftSourceCommit: contract.roles.NativeSwift,
    SDKResourceSourceCommit: handoff.roles.SDKResource,
    consumerVariantSourceCommit: contract.roles.P03Consumer,
    diagnosticConsumerSourceCommit: contract.roles.P03DiagnosticConsumer,
    compiledSDKSourceCommit: handoff.roles.compiledCocoaSDK,
    compiledCocoaReceipt: handoff.receipt,
    helperCompileSourceCommit: contract.roles.helperCompile,
    sourceVariant: CONTROL_MATCHED_VARIANT, ...matchedNodePackageSourceRoles(contract),
    originalNativeReceiptsPreserved: true, ...boundaries, finite7: false,
  };
}

export async function finalizeR21(app, variant = R21_VARIANT) {
  const { handoff, verifyPostNested } = await supplier(variant);
  return verifyPostNested({
    app, receiptPin: handoff.receipt, sourceRoot,
    assemblyCommit: git('rev-parse', 'HEAD'), assemblyTree: git('rev-parse', 'HEAD^{tree}'),
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, app, before] = process.argv.slice(2);
  if (mode === '--verify-core' && [5, 6].includes(process.argv.length)) {
    const variant = process.argv.length === 6 ? cocoaVariantForHandoff(resolve(process.argv[5])) : R22_VARIANT;
    if (![R22_VARIANT, R23_VARIANT, R579_VARIANT].includes(variant)) throw Error('Exact successor supplier required');
    const { handoff } = await supplier(variant);
    const pinPath = variant === R579_VARIANT ? handoff.core.pin : handoff.core.pin.path;
    if (app !== handoff.core.path || before !== pinPath) throw Error('Exact Core input required');
    if (variant !== R579_VARIANT) {
      for (const record of [handoff.core.pin, handoff.core.state, handoff.core.terminal, handoff.core.manifest]) {
        await verifyPhysicalPin(record);
      }
    }
    process.exit(0);
  }
  if (mode !== '--post-outer' || !app || !before || process.argv.length !== 5) throw Error('R21 App and pre-outer record required');
  const plan = await readJSON(join(resolve(app), 'Contents/Resources/native-link/plan.json'));
  const { readOuterSignedMain } = await supplier(plan.variant);
  console.log(JSON.stringify(await readOuterSignedMain(resolve(app), await readJSON(before))));
}
