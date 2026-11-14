import { join, resolve, relative, basename, posix } from 'node:path';

const safeRelative = value => typeof value === 'string' && value !== '.' && !value.startsWith('/')
  && !value.includes('\\') && posix.normalize(value) === value && !value.split('/').includes('..');
const binarySnapshot = path => /\.(?:o|node|dylib|so)$/.test(path);
export function ownedUndefinedSymbols(output) {
  return output.split('\n').map(line => line.trim()).filter(line => /(?:^|\s)(?:_OBJC_(?:CLASS|METACLASS)_\$_YNX|_YNX|_ynx_|_PayRoot|_pay_root_|_napi_|_node_api_)/.test(line));
}
export function selectNativeSources(rows, sdkMap, ownPins) {
  const sdk = new Map(sdkMap.SDKRows.map(row => [row.captured.relativePath, row]));
  const selected = [], seen = new Set();
  for (const row of rows) {
    const key = row.relativePath;
    if (!safeRelative(key) || seen.has(key)) throw Error('Unsafe or duplicate native source path');
    seen.add(key);
    if (binarySnapshot(key)) continue; // Captured warm objects are not build inputs.
    let pin, origin;
    if (key.startsWith('packages/wallet-auth/')) {
      const mapped = sdk.get(key);
      if (!mapped || mapped.captured.sha256 !== row.sha256 || mapped.captured.bytes !== row.bytes
        || !['MATCH', 'CURRENT_SUCCESSOR_DIFF'].includes(mapped.state)) throw Error('Unmapped current SDK input');
      if (mapped.state === 'MATCH' && (mapped.current.sha256 !== row.sha256 || mapped.current.bytes !== row.bytes)) throw Error('Current SDK MATCH identity differs');
      pin = mapped.current; origin = 'current-SDK';
    } else if (key.startsWith('apps/developer/desktop/macos/')) {
      pin = ownPins.get(key); origin = 'own-App';
      if (!pin) throw Error('Missing fixed own App input');
    } else { pin = row; origin = 'original-Main-Core'; }
    if (!pin || !Number.isSafeInteger(pin.bytes) || !/^[a-f0-9]{64}$/.test(pin.sha256)) throw Error('Unpinned native input');
    selected.push({ ...pin, relativePath: key, origin });
  }
  return selected;
}

// Regenerate only the explicitly linked objects. Recorded but unlinked Pay or
// NAPI objects never enter this Cocoa recipe. This function runs no tools.
export function createNativeLinkPlan({ recipe, inputs, workRoot, binary, minimumOS }) {
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(minimumOS) || Number(minimumOS.split('.')[0]) < 13) throw Error('Invalid measured deployment target');
  if (resolve(workRoot) !== workRoot || resolve(binary) !== binary) throw Error('Absolute build outputs required');
  if (recipe.objectCount !== recipe.explicitObjects.length || recipe.objectCount !== 36
    || recipe.explicitArchives.length !== 1 || !recipe.strictUndefinedError || recipe.ownedUndefined.length) throw Error('Incomplete strict native recipe');
  const sourcePrefix = recipe.capturedSourcePrefix, sources = new Set(inputs.map(row => row.relativePath));
  const objectMap = new Map(), names = new Set();
  for (const row of recipe.explicitObjects) {
    const name = basename(row.object.path);
    if (names.has(name) || !name.endsWith('.o') || row.recordedCompileCommands.length !== 1) throw Error('Ambiguous native object');
    if (/original-auth-identity-node|original-product-device-v5-factory/.test(name)) throw Error('NAPI object is not a Cocoa input');
    names.add(name); objectMap.set(row.object.path, join(workRoot, 'objects', name));
  }
  const sourcePath = path => {
    if (!path.startsWith(sourcePrefix + '/')) throw Error('Source escaped captured closure');
    const key = relative(sourcePrefix, path);
    if (!safeRelative(key) || (!sources.has(key) && !inputs.some(row => row.relativePath.startsWith(key + '/')))) throw Error('Source is not in verified closure');
    return join(workRoot, 'source', key);
  };
  for (const archive of recipe.explicitArchives) {
    const key = relative(sourcePrefix, archive.path), input = inputs.find(row => row.relativePath === key);
    if (!input || input.bytes !== archive.bytes || input.sha256 !== archive.sha256) throw Error('Original Core archive differs');
  }
  const rewrite = arg => {
    if (objectMap.has(arg)) return objectMap.get(arg);
    if (arg.startsWith('-I' + sourcePrefix + '/')) return '-I' + sourcePath(arg.slice(2));
    if (arg.startsWith('-I') && arg !== '-I') throw Error('Unmapped include directory');
    if (arg.startsWith(sourcePrefix + '/')) return sourcePath(arg);
    if (arg.startsWith('-mmacosx-version-min=')) return '-mmacosx-version-min=' + minimumOS;
    if (arg === recipe.target) return 'arm64-apple-macosx' + minimumOS;
    if (arg.startsWith('/') && !['/usr/bin/clang', '/usr/bin/clang++', '/usr/bin/xcrun'].includes(arg)) throw Error('Unmapped absolute recipe argument');
    return arg;
  };
  const commands = recipe.explicitObjects.map(row => {
    const recorded = row.recordedCompileCommands[0], argv = recorded.argv.map(rewrite);
    if (!['/usr/bin/clang', '/usr/bin/clang++', '/usr/bin/xcrun'].includes(argv[0])) throw Error('Unexpected native compiler');
    if (argv[0] === '/usr/bin/xcrun' && argv[1] !== 'swiftc') throw Error('Unexpected xcrun tool');
    if (argv[argv.indexOf('-o') + 1] !== objectMap.get(row.object.path)) throw Error('Object output mismatch');
    if (argv[0] === '/usr/bin/xcrun') argv.push('-module-cache-path', join(workRoot, 'module-cache'));
    else argv.push('-Werror=unguarded-availability', '-Werror=unguarded-availability-new', '-fmodules-cache-path=' + join(workRoot, 'module-cache'));
    return { name: recorded.name, argv };
  });
  const linkArgv = recipe.linkArgv.slice();
  const outputIndex = linkArgv.indexOf('-o');
  if (outputIndex < 0 || outputIndex !== linkArgv.length - 2) throw Error('Invalid recorded App output');
  linkArgv[outputIndex + 1] = binary;
  const link = linkArgv.map((arg, index) => index === outputIndex + 1 ? arg : rewrite(arg));
  if (link[0] !== '/usr/bin/xcrun' || link[1] !== 'swiftc' || link.includes('dynamic_lookup')
    || !link.some((arg, index) => arg === '-undefined' && link[index + 2] === 'error')
    || link.filter(arg => arg.endsWith('.o')).length !== objectMap.size
    || [...objectMap.values()].some(object => !link.includes(object))) throw Error('Strict Cocoa link contract changed');
  return { schema: 'YNX_IDE_NORMAL_COCOA_LINK_PLAN/v1', minimumOS,
    executionOwner: 'original A only; a plan does not authorize execution',
    workRoot, binary, inputs, commands, linkArgv: link, capturedObjectsReused: false,
    RootAdmission: false, SourceAdmission: false, NativeAdmission: false };
}
