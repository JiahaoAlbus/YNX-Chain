import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {mkdtemp,chmod,rm} from 'node:fs/promises';
import {once} from 'node:events';
import path from 'node:path';
import {createRequire} from 'node:module';

test('actual fork cannot use inherited native handle or shutdown the parent connection',async t=>{
  const directory=await mkdtemp('/tmp/ynx-caller-fork-');await chmod(directory,0o700);
  const socketPath=path.join(directory,'peer.sock'), sockets=new Set();
  const server=net.createServer(socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  server.listen(socketPath);await once(server,'listening');await chmod(socketPath,0o600);
  t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});});
  const binding=createRequire(import.meta.url)('./build/caller-fork-test.node');
  const handle=await binding.connectUnix({socketPath,serverUID:process.geteuid(),serverPID:process.pid,timeoutMs:1000});
  t.after(()=>binding.retire(handle));
  assert.equal(binding.forkProbe(handle),true);
  assert.equal(binding.current(handle).selfPID,process.pid);
  assert.equal(binding.current(handle).peerPID,process.pid);
  assert.equal(Object.hasOwn(createRequire(import.meta.url)('./build/caller.node'),'forkProbe'),false);
});
