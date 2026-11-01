// Build-time intake only. Product input cannot select this archive or a callee.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function capture(file, expected) {
  const p = fs.realpathSync(file), before = fs.lstatSync(p);
  if (!before.isFile() || before.isSymbolicLink() || before.mode & 0o022 || before.size <= 0 || before.size > 16 << 20) throw Error('Unsafe Auth link input');
  const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const raw = fs.readFileSync(fd), opened = fs.fstatSync(fd), after = fs.lstatSync(p);
    for (const k of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs', 'mode']) if (before[k] !== opened[k] || opened[k] !== after[k]) throw Error('Auth link input changed');
    const digest = sha(raw);
    if (expected && (digest !== expected.sha256 || raw.length !== expected.bytes)) throw Error('Auth supplier pin mismatch');
    return {path: p, bytes: raw.length, sha256: digest};
  } finally { fs.closeSync(fd); }
}
export function authSourceInput(root, handoff, suppliedPin) {
  if (!handoff && !suppliedPin) return null;
  const supplier = JSON.parse(fs.readFileSync(path.join(root, 'apps/network/internal/authresourcesource/SUPPLIER.json')));
  if (!handoff || !path.isAbsolute(handoff) || suppliedPin !== supplier.handoff.sha256) throw Error('Exact Auth H and independent pinned digest required');
  const hpin = capture(handoff, supplier.handoff), h = JSON.parse(fs.readFileSync(hpin.path));
  capture(h.source.path, h.source);
  for (const i of JSON.parse(fs.readFileSync(h.source.path))) capture(i.path, i);
  const archive = capture(h.archive.path, supplier.archive);
  const audit = spawnSync('/usr/bin/nm', ['-g', archive.path], {encoding: 'utf8', maxBuffer: 8 << 20});
  if (audit.status || /\b(_crosscall2|_runtime\.[^ ]*|_runtime_[^ ]*|_x_cgo_init)\b/.test(audit.stdout)) throw Error('Native archive invalid or contains a second Go runtime');
  const definitions = [...new Set([...audit.stdout.matchAll(/\bT\s+(_ynx_network_[a-z0-9_]+)\b/g)].map(m => m[1]))].sort();
  const header = fs.readFileSync(path.join(root, 'apps/network/internal/authresourcesource/source/network_resource_native.h'), 'utf8');
  const expected = [...new Set([...header.matchAll(/\b(ynx_network_[a-z0-9_]+)\s*\(/g)].map(m => '_' + m[1]))].sort();
  const symbols = definitions.filter(name => expected.includes(name));
  // The original C ABI guard emits each public wrapper and its fixed private
  // _implementation target. Neither set is a second public factory/runtime.
  if (symbols.length !== 19 || JSON.stringify(symbols) !== JSON.stringify(expected) || definitions.some(name => !expected.includes(name) && !expected.some(api => name === api + '_implementation'))) throw Error('Expected the 19 private header ABI wrappers and original implementation targets');
  const cryptoArchive = capture('/opt/homebrew/opt/openssl@3/lib/libcrypto.a');
  return {handoff: hpin, sourceManifest: h.source, archive, cryptoArchive, symbols: symbols.sort(), secondGoRuntime: false, RootAdmission: false, SourceAdmission: false};
}
export function captureAuthLink(input, parent) {
  const directory = fs.mkdtempSync(path.join(parent, '.network-auth-link-'));
  for (const [name, pin] of [['libynx_network_resource_source.a', input.archive], ['libcrypto.a', input.cryptoArchive]]) {
    capture(pin.path, pin);
    const out = path.join(directory, name);
    fs.copyFileSync(pin.path, out, fs.constants.COPYFILE_EXCL);
    if (sha(fs.readFileSync(out)) !== pin.sha256) throw Error('Auth archive copy mismatch');
    fs.chmodSync(out, 0o400);
  }
  // Cgo flag parsing, not shell evaluation. Both libraries are fixed, pinned,
  // static archives in the same private capture directory.
  const flag = '-L' + directory;
  if (/[\r\n\0]/.test(flag) || flag.includes('"') && flag.includes("'")) throw Error('Unrepresentable cgo capture path');
  // cmd/internal/quoted.Split accepts quotes around an ENTIRE element only;
  // quoting the path after an unquoted -L leaves literal quote characters.
  const cgoFlag = !/[\s"']/.test(flag) ? flag : !flag.includes('"') ? '"' + flag + '"' : "'" + flag + "'";
  return {directory, env: {...process.env, CGO_ENABLED: '1', CGO_LDFLAGS: cgoFlag, GOMAXPROCS: '2', GOOS: 'darwin', GOARCH: 'arm64', GOFLAGS: '', GOWORK: 'off'}};
}
