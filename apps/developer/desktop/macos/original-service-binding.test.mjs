import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const folder = fileURLToPath(new URL('.', import.meta.url));
let scratch, probe, buildFailure;
function build() {
  if (buildFailure) throw buildFailure;
  if (probe) return probe;
  scratch = mkdtempSync(join(tmpdir(), 'ynx-private-input-public-'));
  const main = join(scratch, 'main.mm');
  writeFileSync(main, `#import "${join(folder, 'ynx-original-service-binding.h')}"\nint main(){@autoreleasepool{NSData *data=[NSFileHandle.fileHandleWithStandardInput readDataToEndOfFile];NSString *raw=[[NSString alloc]initWithData:data encoding:NSUTF8StringEncoding];NSError *error=nil;YNXOriginalServiceRequest *value=[YNXOriginalServiceRequest captureCanonicalInput:raw error:&error];if(!value){fprintf(stderr,"%s",error.localizedDescription.UTF8String);return 2;}NSData *out=[value.raw dataUsingEncoding:NSUTF8StringEncoding];[NSFileHandle.fileHandleWithStandardOutput writeData:out];return 0;}}\n`);
  const executable = join(scratch, 'probe');
  const compiled = spawnSync('/Library/Developer/CommandLineTools/usr/bin/clang++', ['-fobjc-arc', '-std=c++17', '-mmacosx-version-min=15.0', '-isysroot', '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk', '-I/usr/local/include/node', '-fmodules-cache-path=' + join(scratch, 'modules'), main, join(folder, 'ynx-original-service-binding.mm'), '-framework', 'Foundation', '-Wl,-undefined,dynamic_lookup', '-o', executable], { encoding: 'utf8', timeout: 15000 });
  if (compiled.status !== 0) { buildFailure = new Error(compiled.stderr); throw buildFailure; }
  probe = executable;
  return probe;
}
const canonical = value => JSON.stringify(value, Object.keys(value).sort());
const packet = { body: null, operation: 'beginYNX', phase: 'time', proofHeader: null, requestId: 'req_abcdefghijkl' };
function run(raw) { return spawnSync(build(), [], { input: raw, encoding: 'utf8', timeout: 3000 }); }
after(() => { if (scratch) rmSync(scratch, { recursive: true, force: true }); });
test('PUBLIC actual Native TU captures time request unchanged', () => {
  const raw = canonical(packet), result = run(raw);
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, raw);
});
test('PUBLIC actual Native TU retains Unicode and proof bytes unchanged', () => {
  const raw = canonical({ ...packet, phase: 'effect', body: '{"approval":"雪/蓝","request":"原样"}', proofHeader: null });
  const result = run(raw); assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, raw);
});
for (const [name, raw] of [
  ['noncanonical ordering', JSON.stringify({ requestId: packet.requestId, ...packet })],
  ['arbitrary phase', canonical({ ...packet, phase: 'business' })],
  ['extra endpoint', canonical({ ...packet, endpoint: 'https://example.invalid' })],
  ['clock proof', canonical({ ...packet, proofHeader: 'untrusted' })],
  ['capacity', canonical({ ...packet, body: 'x'.repeat(66000) })],
]) test(`PUBLIC actual Native TU refuses ${name}`, () => { const result = run(raw); assert.equal(result.status, 2, JSON.stringify({status: result.status, signal: result.signal, stderr: result.stderr, error: result.error?.message})); });
