'use strict';
const fs = require('node:fs');
const path = require('node:path');
// This process consumes the packaged upstream compiler. No project JavaScript
// configuration or package lifecycle hook is evaluated to perform compilation.
function compile(ts, root, file, output) {
  const inside = (candidate, parent) => candidate === parent || candidate.startsWith(parent + path.sep);
  root = fs.realpathSync(root); file = fs.realpathSync(file); output = fs.realpathSync(output);
  if (!inside(file, root) || !inside(output, root) || output === root) throw Error('TypeScript input or output escaped the project.');
  const compilerRoot = fs.realpathSync(path.dirname(ts.getDefaultLibFilePath({})));
  function permitted(candidate) {
    try { const real = fs.realpathSync(candidate); return inside(real, root) || inside(real, compilerRoot); }
    catch { return false; }
  }
  const host = {
    ...ts.sys,
    readFile: name => permitted(name) ? ts.sys.readFile(name) : undefined,
    fileExists: name => permitted(name) && ts.sys.fileExists(name),
    directoryExists: name => permitted(name) && ts.sys.directoryExists(name),
    readDirectory: (...args) => permitted(args[0]) ? ts.sys.readDirectory(...args).filter(permitted) : [],
  };
  let options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
  let files = [file]; let errors = [];
  const config = ts.findConfigFile(path.dirname(file), host.fileExists);
  if (config && inside(fs.realpathSync(config), root)) {
    const parsed = ts.getParsedCommandLineOfConfigFile(config, {}, { ...host, onUnRecoverableConfigFileDiagnostic: diagnostic => errors.push(diagnostic) });
    if (!parsed) throw Error('TypeScript project configuration could not be read.');
    if (parsed.projectReferences?.length) throw Error('This project uses TypeScript build references. Run its configured build task before debugging.');
    options = parsed.options; files = parsed.fileNames; errors.push(...parsed.errors);
    if (!files.includes(file)) throw Error('The active file is excluded by its tsconfig. Choose its configured project task.');
    if (options.noEmit || options.emitDeclarationOnly || options.outFile || options.jsx === ts.JsxEmit.Preserve || options.jsx === ts.JsxEmit.ReactNative)
      throw Error('This configuration does not emit directly runnable Node JavaScript. Use the project runtime/build task.');
    if (![ts.ModuleKind.CommonJS, ts.ModuleKind.Node16, ts.ModuleKind.NodeNext].includes(options.module ?? ts.ModuleKind.CommonJS))
      throw Error('This module configuration requires its project runtime. Use the configured project task.');
  }
  // Preserve the configured language/type semantics; only generated debugger
  // artifacts go into this request's new directory, never the user's outDir.
  options = { ...options, rootDir: root, outDir: output, sourceMap: true, inlineSourceMap: false,
    inlineSources: true, noEmitOnError: true, incremental: false, composite: false,
    declaration: false, declarationMap: false, tsBuildInfoFile: undefined };
  const compilerHost = ts.createCompilerHost(options);
  compilerHost.readFile = host.readFile; compilerHost.fileExists = host.fileExists;
  compilerHost.directoryExists = host.directoryExists;
  compilerHost.realpath = name => permitted(name) ? ts.sys.realpath(name) : name;
  const runtimeSources = new Set(), outputs = new Map();
  compilerHost.writeFile = (name, text, _bom, _error, sources) => {
    name = path.resolve(name);
    if (!inside(name, output)) throw Error('Compiler output escaped its run directory.');
    if (outputs.has(name)) throw Error('Compiler produced a duplicate output path.');
    outputs.set(name, text);
    if (/\.(?:js|mjs|cjs)$/i.test(name)) for (const source of sources || []) {
      if (!source.isDeclarationFile) runtimeSources.add(source.fileName);
    }
  };
  const program = ts.createProgram(files, options, compilerHost);
  errors.push(...ts.getPreEmitDiagnostics(program));
  const format = diagnostics => ts.formatDiagnostics(diagnostics, { getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => '\n' });
  if (errors.some(d => d.category === ts.DiagnosticCategory.Error)) throw Error(format(errors));
  const moduleKind = ts.getEmitModuleKind(options);
  const emittedTypeFor = type => moduleKind === ts.ModuleKind.CommonJS ? 'commonjs'
    : [ts.ModuleKind.Node16, ts.ModuleKind.NodeNext].includes(moduleKind) ? type : 'module';
  // Emit once into this process's buffer. Scope checks need actual JS outputs,
  // not all compiler inputs; no run files are written before those checks pass.
  const emitted = program.emit();
  if (emitted.emitSkipped || emitted.diagnostics.some(d => d.category === ts.DiagnosticCategory.Error)) throw Error(format(emitted.diagnostics));
  const suffix = /\.mts$/i.test(file) ? '.mjs' : /\.cts$/i.test(file) ? '.cjs' : '.js';
  const result = path.join(output, path.relative(root, file).replace(/\.(?:tsx?|mts|cts)$/i, suffix));
  if (!outputs.has(result)) throw Error('The compiler did not emit the selected file.');
  const scopes = new Map([[root, 'commonjs']]);
  // Type declarations are compiler inputs, not output runtime packages. Only
  // sources that actually produced JS need mirrored package scopes.
  for (const sourceName of runtimeSources) {
    if (!inside(sourceName, root)) continue;
    for (let directory = path.dirname(sourceName); inside(directory, root); directory = path.dirname(directory)) {
      const manifest = path.join(directory, 'package.json');
      if (host.fileExists(manifest)) scopes.set(directory, JSON.parse(host.readFile(manifest)).type === 'module' ? 'module' : 'commonjs');
      if (directory === root) break;
    }
  }
  for (const [directory, type] of scopes) {
    const target = path.join(output, path.relative(root, directory));
    const emittedType = emittedTypeFor(type);
    const manifest = path.join(target, 'package.json');
    if (outputs.has(manifest)) {
      const metadataType = JSON.parse(outputs.get(manifest)).type === 'module' ? 'module' : 'commonjs';
      if (metadataType !== emittedType) throw Error('Imported package.json type conflicts with the emitted Node module format. Use the configured project runtime/build task.');
      continue;
    }
    outputs.set(manifest, JSON.stringify({ type: emittedType }));
  }
  for (const [name, text] of outputs) {
    if (!inside(name, output)) throw Error('Compiler output escaped its run directory.');
    fs.mkdirSync(path.dirname(name), { recursive: true });
    fs.writeFileSync(name, text, { flag: 'wx' });
  }
  return result;
}
if (require.main === module) {
  try {
    const [root, file, output] = process.argv.slice(2);
    const ts = require('../runtime/typescript/lib/typescript.js');
    const result = compile(ts, root, file, output);
    console.log(`TypeScript ${ts.version}: ${result}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { compile };
