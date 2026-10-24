// Read-only metadata diagnosis for the first R202 Linux CI OPEN failure.
// No Go invocation, private cause, source contents, ENV dump or permission edits.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

if (process.argv.length !== 2 || process.platform !== 'linux' || process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true') throw Error('AUTH_DIAGNOSTICS_CI_ONLY');
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const evidence = path.join(packageRoot, '.ci-evidence/auth-r202-path-diagnostics');
fs.mkdirSync(path.dirname(evidence), {recursive: true});
fs.mkdirSync(evidence, {mode: 0o700});
function metadata(target) {
  try {
    const s = fs.lstatSync(target);
    const uidAllowed = s.uid === 0 || s.uid === process.geteuid();
    return {path: target, uid: s.uid, gid: s.gid, mode: (s.mode & 0o7777).toString(8), nlink: s.nlink,
      regularFile: s.isFile(), directory: s.isDirectory(), symlink: s.isSymbolicLink(),
      uidAllowed, groupOrWorldWritable: (s.mode & 0o022) !== 0,
      productionDirectoryMetadataPredicate: uidAllowed && (s.mode & 0o022) === 0 && s.isDirectory() && !s.isSymbolicLink()};
  } catch (e) { return {path: target, unavailable: e.code ?? 'UNKNOWN'}; }
}
function ancestry(target) {
  const result = [];
  for (let current = target; ; current = path.dirname(current)) {
    result.push(metadata(current));
    if (current === path.dirname(current)) break;
  }
  return result;
}
const node = fs.realpathSync(process.execPath), home = os.homedir();
const report = {schema: 'YNX-AUTH-R202-CI-PATH-DIAGNOSTICS/v1',
  originalFailureRun: 40063849593, at: new Date().toISOString(),
  node: {requested: process.execPath, realpath: node, version: process.version, file: metadata(node), ancestors: ancestry(path.dirname(node))},
  publicFixtureHome: {path: home, realpath: fs.realpathSync(home), ancestors: ancestry(home)},
  limits: fs.readFileSync('/proc/self/limits', 'utf8'),
  readOnlyDiagnosis: true, productionSourceChanged: false, privateCauseRead: false,
  GoExecuted: false, SourceMounted: false, Root: false, realUserFlow: false};
fs.writeFileSync(path.join(evidence, 'PATH_METADATA.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600});
process.stdout.write('Read-only CI path metadata captured; no Go tests or production changes.\n');
