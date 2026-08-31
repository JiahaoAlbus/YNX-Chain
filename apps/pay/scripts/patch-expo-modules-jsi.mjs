import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(join(process.cwd(), 'package.json'));
const packageJsonPath = require.resolve('expo-modules-jsi/package.json');
const packageRoot = dirname(packageJsonPath);
const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));

const supportedVersions = new Set(['57.0.3', '57.0.4']);
if (!supportedVersions.has(packageJson.version)) {
  throw new Error(
    `Refusing to patch unsupported expo-modules-jsi version ${packageJson.version}; expected 57.0.3 or 57.0.4`,
  );
}

const sourcePath = join(
  packageRoot,
  'apple',
  'Sources',
  'ExpoModulesJSI',
  'Coding',
  'JavaScriptCodable+Date.swift',
);
const original = 'abs(milliseconds) <= maxJavaScriptDateMilliseconds';
const replacement = 'Swift.abs(milliseconds) <= maxJavaScriptDateMilliseconds';
const source = await readFile(sourcePath, 'utf8');
const originalCount = source.split(original).length - 1;
const replacementCount = source.split(replacement).length - 1;

if (replacementCount === 1 && originalCount === 1) {
  console.log('expo-modules-jsi Swift 6.2 compatibility patch already applied');
  process.exit(0);
}
if (originalCount !== 1 || replacementCount !== 0) {
  throw new Error(
    `Refusing ambiguous expo-modules-jsi patch: original=${originalCount}, replacement=${replacementCount}`,
  );
}

await writeFile(sourcePath, source.replace(original, replacement));
console.log('Applied expo-modules-jsi Swift 6.2 compatibility patch');
