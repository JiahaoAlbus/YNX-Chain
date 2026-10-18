// Original A build entry only. This creates a library, never an approval or APK.
import {execFileSync} from 'node:child_process';
import {readFileSync, existsSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {createHash} from 'node:crypto';
const [stageArg, compilerArg, outputArg] = process.argv.slice(2);
if (!stageArg || !compilerArg || !outputArg) throw Error('STAGE_NDK_COMPILER_AND_NEW_OUTPUT_REQUIRED');
const stage = resolve(stageArg), compiler = resolve(compilerArg), output = resolve(outputArg);
const source = JSON.parse(readFileSync(join(stage, 'PROVIDER_SOURCE.json'), 'utf8'));
if (source.commit !== 'fd8b8dcf7dda9823a439db04b1e33e2375014568') throw Error('FROZEN_MATH_SOURCE_REQUIRED');
if (!/aarch64-linux-android(?:2[8-9]|[3-9][0-9])-clang$/.test(compiler)) throw Error('ARM64_ANDROID_API28_OR_LATER_NDK_REQUIRED');
if (existsSync(output) || existsSync(output + '.source.json')) throw Error('OUTPUT_ALREADY_EXISTS');
for (const file of [...source.sourceFiles, ...source.ownedFiles.map(f => ({...f, relative: 'packages/wallet-auth/native/android/' + f.relative}))]) {
  const bytes = readFileSync(join(stage, file.relative));
  if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw Error('STAGED_SOURCE_DRIFT:' + file.relative);
}
execFileSync('go', ['build', '-mod=readonly', '-p', '1', '-buildmode=c-shared', '-trimpath', '-o', output, './packages/wallet-auth/native/android'], {
  cwd: stage, stdio: 'inherit', env: {...process.env, GOOS: 'android', GOARCH: 'arm64', CGO_ENABLED: '1', CC: compiler, GOMAXPROCS: '1', GOPROXY: 'off'}
});
const bytes = readFileSync(output);
writeFileSync(output + '.source.json', JSON.stringify({source, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), abi: 1, installed: false, authorized: false, deviceVerified: false}, null, 2) + '\n', {flag: 'wx'});
