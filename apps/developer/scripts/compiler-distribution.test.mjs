import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, writeFile, appendFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { compilerReadiness } from './compiler-pin.mjs';

test('standalone distribution compiles outside the checkout and rejects altered transitive code before loading it', async t => {
  const input = process.env.YNX_IDE_SOLC_INPUT;
  if (!input || !compilerReadiness(input).closureSha256) return t.skip('Supply the reviewed complete compiler distribution.');
  const qa = await mkdtemp(join(tmpdir(), 'ynx-solc-distribution-'));
  const scripts = join(qa, 'scripts'); await mkdir(scripts);
  const modules = join(qa, 'node_modules'); await cp(dirname(input), modules, { recursive: true });
  for (const name of ['compiler-pin.mjs', 'compiler-worker.mjs', 'solidity-semantic-index.mjs']) await cp(fileURLToPath(new URL(name, import.meta.url)), join(scripts, name));
  const relocated = join(modules, 'solc');
  async function compile(mode) {
    const worker = new Worker(join(scripts, 'compiler-worker.mjs'), {
      env: { ...process.env, NODE_PATH: '', YNX_IDE_SOLC_INPUT: relocated },
      workerData: { name: 'Entry', ...(mode ? { mode } : {}), sourceName: 'Entry.sol', sources: {
        'Entry.sol': { content: 'pragma solidity 0.8.24; import "./Lib.sol"; contract Entry { function run() external pure returns(uint) { return Lib.run(); } }' },
        'Lib.sol': { content: 'pragma solidity 0.8.24; library Lib { function run() internal pure returns(uint) { return 42; } }' },
      } },
    });
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Standalone compiler deadline exceeded.')), 15000);
        worker.once('message', value => { clearTimeout(timer); resolve(value); });
        worker.once('error', error => { clearTimeout(timer); reject(error); });
        worker.once('exit', code => { clearTimeout(timer); reject(Error(`Compiler exited before result: ${code}`)); });
      });
    } finally { await worker.terminate(); }
  }
  const result = await compile();
  assert.equal(result.ok, true); assert.equal(result.contractName, 'Entry');
  assert.ok(result.abi.some(row => row.name === 'run')); assert.match(result.bytecode, /^0x[0-9a-f]+$/);
  const analysis = await compile('analysis'); assert.equal(analysis.ok, true);
  assert.ok(analysis.semantics.references.some(row => row.location.file === 'Entry.sol' && analysis.semantics.declarations.some(declaration => declaration.id === row.targetId && declaration.location.file === 'Lib.sol')));
  assert.equal(analysis.bytecode, undefined);
  const marker = join(qa, 'altered-module-executed');
  await appendFile(join(modules, 'js-sha3', 'src', 'sha3.js'), `\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');\n`);
  const rejected = await compile();
  assert.equal(rejected.ok, false); assert.equal(rejected.code, 'compiler_pin_mismatch');
  assert.equal(rejected.bytecode, undefined); await assert.rejects(access(marker), { code: 'ENOENT' });
  await writeFile(join(qa, 'receipt.json'), JSON.stringify({ input, qa, result, analysis, rejected, noAlteredCodeExecuted: true }, null, 2));
  t.diagnostic(`Preserved standalone proof at ${qa}/receipt.json`);
});
