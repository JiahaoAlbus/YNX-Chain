import { cp, mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { compilerReadiness, COMPILER_CLOSURE_SHA256 } from './compiler-pin.mjs';
import { bundleSolidityImportParser } from './bundle-solidity-import-parser.mjs';
const developer = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function bundleSolidityLanguageRuntime(inputArg, toolsArg) {
  const input = await realpath(inputArg), tools = await realpath(toolsArg);
  if (!tools.startsWith(join(developer, '.ynx-developer-candidates') + '/')) throw Error('Bundle only into an owned candidate extension.');
  const state = compilerReadiness(input);
  if (!state.available || state.closureSha256 !== COMPILER_CLOSURE_SHA256) throw Error('Use the existing reviewed complete compiler closure.');
  const distribution = JSON.parse(await readFile(join(dirname(dirname(input)), 'distribution.json'), 'utf8'));
  if (distribution.manifestSha256 !== state.closureSha256) throw Error('The compiler distribution receipt differs.');
  const output = join(tools, 'compiler'); await mkdir(output);
  await cp(dirname(input), join(output, 'node_modules'), { recursive: true });
  const copied = compilerReadiness(join(output, 'node_modules/solc'));
  if (!copied.available || copied.closureSha256 !== state.closureSha256) throw Error('The compiler copy differs from its reviewed input.');
  const scripts = {};
  for (const name of ['compiler-worker.mjs', 'compiler-pin.mjs', 'solidity-semantic-index.mjs']) {
    const bytes = await readFile(new URL(name, import.meta.url));
    await writeFile(join(output, name), bytes, { flag: 'wx' });
    scripts[name] = createHash('sha256').update(bytes).digest('hex');
  }
  const importParser = await bundleSolidityImportParser(output);
  await writeFile(join(output, 'distribution.json'), JSON.stringify({ ...distribution, scripts, importParser: { closureSha256: importParser.closureSha256, packages: importParser.packages }, copiedClosureVerified: true, scope: 'Owned read-only editor language analysis; no project execution, network, signing or new identity/Host binding.' }, null, 2) + '\n', { flag: 'wx' });
  return { output, closureSha256: copied.closureSha256, scripts };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await bundleSolidityLanguageRuntime(...process.argv.slice(2))));
