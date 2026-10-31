#!/usr/bin/env node
// Feed the normal target's `go list -deps -json` output, with its exact tags.
// Never archive the whole checkout to describe that target's production inputs.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const [sourceArg, depsFile, outputArg, reportFile] = process.argv.slice(2);
assert.ok(sourceArg && depsFile && outputArg && reportFile,
  'usage: production_source_closure.mjs SOURCE GO_DEPS_JSONSTREAM NEW_OUTPUT REPORT');
const source = fs.realpathSync(sourceArg), output = path.resolve(outputArg);
assert.ok(!output.startsWith(source + path.sep) && output !== source,
  'output must be outside the source checkout');
assert.ok(!fs.existsSync(output), 'preserve existing closures');
const raw = fs.readFileSync(depsFile, 'utf8'), packages = [];
let at = 0;
while (at < raw.length) {
  while (/\s/.test(raw[at] ?? 'x')) at++;
  if (at === raw.length) break;
  assert.equal(raw[at], '{', 'expected concatenated go list JSON objects');
  const start = at;
  let depth = 0, string = false, escape = false, complete = false;
  for (; at < raw.length; at++) {
    const c = raw[at];
    if (string) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') string = false;
      continue;
    }
    if (c === '"') string = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      packages.push(JSON.parse(raw.slice(start, ++at)));
      complete = true;
      break;
    }
  }
  assert.ok(complete, 'truncated go list object');
}
assert.ok(packages.length, 'no normal production dependencies');
const inside = file => file === source || file.startsWith(source + path.sep);
const fields = ['GoFiles', 'CgoFiles', 'CFiles', 'CXXFiles', 'MFiles',
  'HFiles', 'FFiles', 'SFiles', 'SwigFiles', 'SwigCXXFiles', 'SysoFiles', 'EmbedFiles'];
const selected = new Map(), modules = new Set([source]), inventory = [];
for (const pkg of packages) {
  assert.ok(!pkg.Error && !pkg.DepsErrors?.length && !pkg.Incomplete, pkg.ImportPath);
  if (pkg.Goroot || !pkg.Dir || !inside(path.resolve(pkg.Dir))) continue;
  const files = [...new Set(fields.flatMap(key => pkg[key] ?? []))];
  inventory.push({importPath: pkg.ImportPath, files,
    cgoCFLAGS: pkg.CgoCFLAGS ?? [], cgoCPPFLAGS: pkg.CgoCPPFLAGS ?? [],
    cgoCXXFLAGS: pkg.CgoCXXFLAGS ?? [], cgoLDFLAGS: pkg.CgoLDFLAGS ?? [],
    cgoPkgConfig: pkg.CgoPkgConfig ?? []});
  for (const name of files) {
    const file = path.resolve(pkg.Dir, name), relative = path.relative(source, file);
    assert.ok(inside(file) && inside(fs.realpathSync(file)), file);
    assert.ok(!relative.endsWith('_test.go') &&
      !/(^|\/)(controls|testsupport|testdata)(\/|$)/.test(relative), relative);
    assert.ok(fs.lstatSync(file).isFile(), 'regular production input required: ' + relative);
    selected.set(relative, file);
  }
  for (const mod of [pkg.Module, pkg.Module?.Replace])
    if (mod?.Dir && inside(path.resolve(mod.Dir))) modules.add(mod.Dir);
}
assert.ok(inventory.length, 'no local production packages');
for (const dir of modules) for (const name of ['go.mod', 'go.sum']) {
  const file = path.join(dir, name);
  if (fs.existsSync(file)) selected.set(path.relative(source, file), file);
}
// Check every input before creating anything, so a refusal leaves no partial tree.
const files = [...selected].sort(([a], [b]) => a.localeCompare(b)).map(([file, absolute]) => {
  assert.ok(fs.lstatSync(absolute).isFile() && inside(fs.realpathSync(absolute)), file);
  const bytes = fs.readFileSync(absolute);
  return {file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
});
fs.mkdirSync(output, {recursive: true});
for (const row of files) {
  const destination = path.join(output, row.file);
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  const bytes = fs.readFileSync(selected.get(row.file));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256, row.file);
  fs.writeFileSync(destination, bytes, {flag: 'wx'});
}
const externalModules = [...new Map(packages.filter(p => p.Module && !p.Goroot &&
  !inside(path.resolve(p.Dir ?? '/'))).map(p => [p.Module.Path,
  {path: p.Module.Path, version: p.Module.Version, sum: p.Module.Sum,
    replacement: p.Module.Replace}])).values()];
const report = {source, output, selection: fields,
  localPackages: inventory.length, files, packages: inventory, externalModules,
  testSourceCopied: false, testEvidenceIncluded: false,
  rootAdmission: false, installed: false};
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({output, packages: inventory.length, files: files.length}));
