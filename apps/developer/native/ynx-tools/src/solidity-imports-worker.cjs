const { parentPort, workerData } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs'), { createHash } = require('node:crypto');
function verifyParser(root) {
  const files = {};
  function visit(directory, prefix) {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name), stat = fs.lstatSync(file), key = prefix + '/' + name;
      if (stat.isDirectory()) visit(file, key);
      else if (stat.isFile()) files[key] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      else throw Error('Import parser inputs cannot contain links or special files.');
    }
  }
  visit(path.join(root, 'node_modules'), 'node_modules');
  const actual = createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)))).digest('hex');
  if (actual !== '4a71ce3d18805d970782045516bea34a305545cf9d535a5bfc99106aa2440ccb') throw Error('The retained local import parser closure changed.');
}
(async () => {
  const pin = await import(pathToFileURL(path.join(workerData.compiler, 'compiler-pin.mjs')).href);
  pin.assertCompilerPin(); const solc = pin.loadPinnedCompiler();
  let recoveryParser;
  parentPort.on('message', async ({ unit, content, remappings = [] }) => {
    try {
      if (typeof content !== 'string' || Buffer.byteLength(content) > 262144) throw Error('Local source exceeds its parse boundary.');
      if (!Array.isArray(remappings) || remappings.length > 128 || remappings.some(row => typeof row !== 'string' || row.length > 1024)) throw Error('Local remappings exceed their parse boundary.');
      const parse = (text, mappings) => JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { [unit]: { content: text } }, settings: { stopAfter: 'parsing', remappings: mappings, outputSelection: { '*': { '': ['ast'] } } } })));
      const output = parse(content, remappings), baseline = remappings.length ? parse(content, []) : output;
      const importsOf = value => value.sources?.[unit]?.ast?.nodes?.filter(row => row.nodeType === 'ImportDirective');
      const probe = (text, original) => {
        if (!remappings.length) return {};
        let marker = '__ynx_import_probe__/';
        while (importsOf(original)?.some(row => row.absolutePath.startsWith(marker))) marker = '_' + marker;
        // Ask the same compiler whether a mapping matched, even for an
        // identity target. The marker never reaches the actual snapshot.
        const mapped = parse(text, remappings.map(row => row.slice(0, row.indexOf('=') + 1) + marker));
        return { marker, mapped };
      };
      const mappedImport = (node, checked) => ({ file: node.file, unit: node.absolutePath, remapped: !!checked.marker && !!importsOf(checked.mapped)?.find(row => row.src === node.src)?.absolutePath.startsWith(checked.marker) });
      const errors = (output.errors || []).filter(row => row.severity === 'error');
      const checked = errors.length ? {} : probe(content, baseline);
      let imports = importsOf(output)?.map(row => mappedImport(row, checked));
      if (errors.length) {
        // Recover structural import nodes while the user is midway through a
        // function. solc still decodes each literal and resolves source names.
        if (!recoveryParser) {
          const parserRoot = path.join(workerData.compiler, 'parser'); verifyParser(parserRoot);
          const { Parser } = await import(pathToFileURL(path.join(parserRoot, 'node_modules/@nomicfoundation/slang/target/generated/parser/index.mjs')).href);
          recoveryParser = Parser.create('0.8.24');
        }
        imports = []; let visited = 0;
        for (const cursor of recoveryParser.parseFileContents(content).tree.descendants()) {
          if (++visited > 100000) throw Error('The partial Solidity syntax tree exceeds its boundary.');
          if (cursor.node.kind !== 'ImportDirective') continue;
          const text = cursor.node.unparse(), isolated = parse(text, remappings), original = remappings.length ? parse(text, []) : isolated;
          if ((isolated.errors || []).some(row => row.severity === 'error')) continue;
          const node = isolated.sources?.[unit]?.ast?.nodes?.find(row => row.nodeType === 'ImportDirective');
          if (!node) continue;
          imports.push(mappedImport(node, probe(text, original)));
        }
      }
      if (!imports || imports.length > 256) throw Error('Local source import tree exceeds its boundary.');
      parentPort.postMessage({ imports });
    } catch (error) { parentPort.postMessage({ error: error.message }); }
  });
  parentPort.postMessage({ ready: true });
})().catch(error => parentPort.postMessage({ error: error.message }));
