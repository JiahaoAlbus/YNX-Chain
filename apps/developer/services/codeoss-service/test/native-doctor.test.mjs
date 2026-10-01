import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeHostFacts } from '../../../scripts/native-core-doctor.mjs';
test('doctor emits only read-only host facts and never mistakes dir or available ZFS driver for hard quota', async () => {
  const calls = [], facts = await nativeHostFacts({ platform: 'linux', architecture: 'x64', cpuCount: 8, memoryBytes: 32 * 1024 ** 3,
    locate: async name => ['lxc','zfs','zpool'].includes(name) ? '/usr/bin/' + name : null,
    read: async path => path === '/proc/filesystems' ? 'nodev\tsysfs\n\tbtrfs\n' : 'MemAvailable: 19713229 kB\n', fsStats: async () => ({ bavail: 42n, bsize: 4096n }),
    run: async (exe, args) => { calls.push([exe,args]); return { stdout: args[0] === 'query' ? JSON.stringify({ type:'sync',status_code:200,metadata:{environment:{server_version:'5.21.8',kernel_architecture:'x86_64'}} }) : args[0] === 'storage' ? JSON.stringify([{name:'default',driver:'dir',status:'Created'}]) : '' }; } });
  assert.equal(facts.ready,false); assert.equal(facts.projectStorageAdmission,'NOT_VERIFIED'); assert.equal(facts.providerFacts.zfsKernelPresent,false); assert.equal(facts.providerFacts.zfsToolsPresent,true); assert.equal(facts.providerFacts.btrfsQgroupAloneAccepted,false);
  assert.equal(calls.length,3); assert.deepEqual(calls.map(x=>x[1][0]),['query','storage','list']); assert.equal(facts.storagePools[0].configuredSize,null);
});
test('non Linux x64 doctor runs no host commands or filesystem reads', async () => {
  const fail = async()=>{throw Error('must not access host');}; const facts=await nativeHostFacts({platform:'darwin',architecture:'arm64',read:fail,locate:fail,run:fail}); assert.equal(facts.ready,false); assert.equal(facts.lxd,null);
});
