'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function identity(item, directory) {
  if (!path.isAbsolute(item) || await fs.realpath(item) !== item) throw Error('Select a canonical installed Go toolchain.');
  for (let current = item; ; current = path.dirname(current)) {
    const stat = await fs.lstat(current);
    if (![0, process.getuid()].includes(stat.uid) || stat.mode & 0o022 || stat.isSymbolicLink() || (current === item && !directory ? !stat.isFile() || !(stat.mode & 0o111) : !stat.isDirectory())) throw Error('The selected Go toolchain is writable by another user or has an unsafe path.');
    if (current === '/') return { dev: String((await fs.lstat(item)).dev), ino: String((await fs.lstat(item)).ino) };
  }
}
async function inspectToolchain(root) {
  const rootIdentity = await identity(root, true), executable = path.join(root, 'bin/go');
  const binaryIdentity = await identity(executable, false), binarySha256 = sha(await fs.readFile(executable));
  const env = { PATH:'/usr/bin:/bin', GOROOT:root, GOTOOLCHAIN:'local', GOENV:'off', GOPROXY:'off', GOSUMDB:'off' };
  const version = (await execFile(executable, ['version'], {env,timeout:5000,maxBuffer:16384})).stdout.trim();
  if (!/^go version go1\.\d+(?:\.\d+)? (?:darwin|linux|windows)\/(?:arm64|amd64)$/.test(version)) throw Error('This installed Go version is not supported by the local task adapter.');
  const goroot = (await execFile(executable, ['env','GOROOT'], {env,timeout:5000,maxBuffer:16384})).stdout.trim();
  if (goroot !== root) throw Error('Go returned a different toolchain root.');
  for (const name of ['src','pkg','bin']) await identity(path.join(root,name), true);
  const afterRoot = await identity(root,true), afterBinary = await identity(executable,false);
  if (JSON.stringify(rootIdentity)!==JSON.stringify(afterRoot) || JSON.stringify(binaryIdentity)!==JSON.stringify(afterBinary) || binarySha256!==sha(await fs.readFile(executable))) throw Error('The selected Go toolchain changed during inspection.');
  return {root,executable,version,binarySha256,rootIdentity,binaryIdentity};
}
async function admittedToolchain(environment) {
  const root=environment.YNX_IDE_GO_ROOT,executable=environment.YNX_IDE_GO_ENTRY,version=environment.YNX_IDE_GO_VERSION,binarySha256=environment.YNX_IDE_GO_SHA;
  if(!root && !executable && !version && !binarySha256)throw Object.assign(Error('Select an installed Go toolchain for this project before running.'),{code:'YNX_GO_SELECTION_REQUIRED'});
  if(!root || executable!==path.join(root,'bin/go') || typeof version!=='string' || !/^[a-f0-9]{64}$/.test(binarySha256||''))throw Error('This runtime has no verified Go toolchain supplier. Local Go may already be installed; reopen with a runtime that supports Go toolchain selection. No download or installation was performed.');
  const actual=await inspectToolchain(root);
  if(actual.executable!==executable || actual.version!==version || actual.binarySha256!==binarySha256)throw Error('The runtime Go toolchain metadata does not match the installed binary. Reopen the project after configuring its toolchain.');
  return actual;
}
async function verifyToolchain(saved, environment) {
  // A workspace setting records a choice; it cannot grant a new OS read root.
  if (!saved || saved.root !== environment.YNX_IDE_GO_ROOT) throw Object.assign(Error('This Go toolchain is not admitted by the local runtime. Choose an available local Go toolchain.'), {code:'YNX_GO_CONFIGURATION_STALE'});
  const actual = await admittedToolchain(environment);
  if (JSON.stringify(saved)!==JSON.stringify(actual)) throw Object.assign(Error('The installed Go toolchain changed. Configure Go for this project again.'), {code:'YNX_GO_CONFIGURATION_STALE'});
  return actual;
}
async function privateDirectory(directory, root) {
  const relative=path.relative(root,directory);
  if (!relative || relative==='..' || relative.startsWith('..'+path.sep) || path.isAbsolute(relative)) throw Error('Go output and cache must remain inside this project.');
  let current=root;
  for(const part of relative.split(path.sep)) {
    current=path.join(current,part);
    try {await fs.mkdir(current,{mode:0o700});} catch(error){if(error.code!=='EEXIST')throw error;}
    const stat=await fs.lstat(current);
    if(!stat.isDirectory() || stat.isSymbolicLink() || stat.uid!==process.getuid() || (stat.mode&0o777)!==0o700 || await fs.realpath(current)!==current)throw Error('Go requires private project output and cache directories. Existing paths were preserved.');
  }
  return directory;
}
module.exports={inspectToolchain,admittedToolchain,verifyToolchain,privateDirectory};
