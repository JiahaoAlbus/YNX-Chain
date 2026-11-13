import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {shopArchiveRole, shopRequiredSymbols, shopNativeRequiredSymbols, shopBorrowSymbols} from './combined-archive-symbols.mjs';

export const shopRole = shopArchiveRole;
export const shopLinkCommit = '85fdcec58e591d8ef1ce072430b37bf201192635';
export const shopLinkTree = 'c5e7ff3bdcfe90fc7263f7329b46b9ccaa4bd62e';
export const shopPackage = 'authowned/productreadsource';
export const shopImportPath = 'github.com/JiahaoAlbus/YNX-Chain/' + shopPackage;
export const shopImportFile = 'shop_transport_import.go';

const handoffPin = {bytes: 10832, sha256: 'e07b6c95f8edec94c1a32ec15ae64c5dfd870350df030d7b4db4b1054158b98a'};
const originalCore = {bytes: 61042, sha256: '9e532bc1d84a856f451b879c0234828f3e37c31b8383f13be5280612bfc1199b'};
const originalPayHeaders = {bytes: 1821, sha256: '23ef1ded16ea80dab04f33e3e9d8b0fa6a487364a7d405b2a21f50e38b8ed42d'};
const originalNativeCore = {bytes: 10487, sha256: 'f364837c7f0593ca09a760e97b433c11993d1d976a1eb48256a5abd2cbaea6ba'};
const originalSDKHeader = {bytes: 1787, sha256: 'b7f69ca366aa3d95b567b583f54f3fb26096937cc3c21c16f8a8c6d85daf2053'};
const shopGoNames = ['authority.go', 'capture.go', 'contract.go', 'physical.go', 'runtime.go', 'sdk_input.go', 'sdk_output.go',
  'shop_client_transport_original.go', 'shop_private_client.go', 'shop_private_client_cgo.go', 'shop_proof_carrier_cgo.go',
  'shop_source_constraints.go', 'shop_source_constraints_cgo.go'];
export const shopCgoNames = Object.freeze(['shop_private_client_cgo.go', 'shop_proof_carrier_cgo.go', 'shop_source_constraints_cgo.go']);
const headerPaths = ['ShopMainProofPrivate.h', 'ShopMainSessionPrivate.h', 'ShopOwnedExchangePrivate.h', 'ShopProofCarrierPrivate.h',
  'ShopSourceConstraintsPrivate.h', 'native/OriginalProductSessionProofV2Private.h', 'native/ShopOriginalPrivateClient.h'];
export const shopABIHeaderNames = Object.freeze(['ShopOwnedExchangePrivate.h', 'ShopProofCarrierPrivate.h',
  'ShopSourceConstraintsPrivate.h', 'ShopOriginalPrivateClient.h']);

const hash = raw => createHash('sha256').update(raw).digest('hex');
const need = (ok, reason) => {if (!ok) throw Error('original Shop archive: ' + reason);};
const samePin = (actual, expected) => actual?.bytes === expected?.bytes && actual?.sha256 === expected?.sha256;
const exact = (actual, expected) => Array.isArray(actual) && actual.length === new Set(actual).size &&
  JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());

function readPinned(row) {
  need(path.isAbsolute(row?.path ?? '') && Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= 16 << 20 &&
    /^[0-9a-f]{64}$/.test(row.sha256 ?? ''), 'absolute bounded input pin required');
  const stat = fs.lstatSync(row.path);
  need(stat.isFile() && !stat.isSymbolicLink() && stat.size === row.bytes, 'original regular input size differs: ' + row.path);
  const raw = fs.readFileSync(row.path);
  need(raw.length === row.bytes && hash(raw) === row.sha256, 'original input bytes differ: ' + row.path);
  return raw;
}

export function verifyShopArchiveBase(selected, core, auth, native, linkCommit) {
  need(selected.id === 'core19/49' && !selected.preparedComposition && samePin(core, originalCore) &&
    samePin(auth, originalPayHeaders) && samePin(native, originalNativeCore) && linkCommit === shopLinkCommit,
    'exact original A Core19/Pay8/Native baseline and LINK85fd required');
}

export function loadShopLegacyArchiveInputs(file, digest) {
  need(digest === handoffPin.sha256, 'exact original Auth source selection required');
  const handoff = {...handoffPin, path: path.resolve(file)};
  const supplied = JSON.parse(readPinned(handoff));
  need(supplied.schema === 'AUTH_SHOP_LEGACY_COMBINED_INPUTS/v1' && supplied.state === 'EXACT_PRODUCTION_SOURCE_SELECTION_ONLY' &&
    supplied.linkCommit === shopLinkCommit && supplied.linkCI === 42445390661 &&
    supplied.archiveRules?.existingRoles?.core === 19 && supplied.archiveRules.existingRoles.link === 22 &&
    supplied.archiveRules.existingRoles.pay === 8 && supplied.archiveRules.newShopRole === 13 &&
    supplied.archiveRules.totalStrongRoleExports === 62 && supplied.archiveRules.oneOriginalCArchive === true,
  'exact legacy source role and LINK cohort required');
  need(exact(supplied.goStrong, shopRequiredSymbols) && exact(supplied.cppImports, shopNativeRequiredSymbols) &&
    exact(supplied.goToCpp, shopBorrowSymbols), 'exact Go13, Native11 and borrow2 ownership required');
  need(exact(supplied.files?.map(row => row.relative), [...shopGoNames.map(name => 'productreadsource/' + name), ...headerPaths]),
    'complete original Go13 and private header7 inventory required');
  const files = supplied.files.map(row => ({row, repositoryPath: 'authowned/' + row.relative, bytes: readPinned(row)}));
  const proof = JSON.parse(readPinned(supplied.proof));
  const custody = JSON.parse(readPinned(supplied.custodyProgress));
  need(samePin(custody.parent, supplied.proof) && proof.sourcePins, 'same proof and custody source chain required');
  const proofSources = JSON.parse(readPinned(proof.sourcePins));
  const proofPins = new Map(proofSources.map(row => [row.relative, row]));
  for (const {row} of files) need(samePin(row, proofPins.get('source/' + row.relative)), 'original proof source differs: ' + row.relative);
  const sdkHeader = proof.dependencies.find(row => samePin(row, originalSDKHeader));
  const stagedSDKHeader = files.find(({row}) => row.relative === 'native/OriginalProductSessionProofV2Private.h');
  need(sdkHeader && stagedSDKHeader.bytes.equals(readPinned(sdkHeader)), 'original SDK V2 header bytes required');
  const nativeResult = JSON.parse(readPinned(supplied.nativeObjects));
  const nativeObject = nativeResult.combined;
  const borrowObject = nativeResult.objects?.filter(row => path.basename(row.path) === 'ShopProofLoan.o');
  need(path.basename(nativeObject?.path ?? '') === 'legacy-objects.o' && borrowObject?.length === 1 &&
    exact(nativeResult.authGoImports?.map(symbol => symbol.slice(1)), shopNativeRequiredSymbols),
    'original Native relocation and borrow provider required');
  const pins = [handoff, supplied.proof, proof.sourcePins, sdkHeader, supplied.custodyProgress, supplied.nativeObjects,
    nativeObject, borrowObject[0], ...supplied.files];
  readPinned(nativeObject);
  readPinned(borrowObject[0]);
  return {handoff, files, pins, nativeUndefined: supplied.nativeObjects, nativeObject, borrowObject: borrowObject[0]};
}

export function verifyShopLegacyArchiveInputsUnchanged(shop) {
  for (const pin of shop.pins) readPinned(pin);
}

export function verifyShopCommandDependencyClosure(rows, main) {
  const shop = rows.get(shopImportPath);
  need(main.Imports.includes(shopImportPath) && shop?.Name === 'productreadsource' && shop.DepOnly === true &&
    shop.Imports?.includes('github.com/JiahaoAlbus/YNX-Chain/internal/securelink') &&
    exact(shop.GoFiles, shopGoNames.filter(name => !shopCgoNames.includes(name))) && exact(shop.CgoFiles, shopCgoNames) &&
    !shop.Module?.Replace && shop.Module?.Main === true && shop.Module.Path === 'github.com/JiahaoAlbus/YNX-Chain',
  'original command must directly reach exact Auth Shop Go13 and LINK in its sole module');
  need(![...rows.keys()].some(name => name === 'github.com/cometbft/cometbft' || name.startsWith('github.com/cometbft/cometbft/')),
    'the original Core19 archive closure must not require additional Comet source');
}
