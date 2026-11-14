// Own-process synthetic network instrument. These are Node helpers, never WebKit process claims.
import { fork, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import tls from 'node:tls';
const role = process.argv[2], filename = fileURLToPath(import.meta.url);
const send = value => { if (process.connected) process.send(value); };
const sockets = new Set(); let server, configuration, blocked = true;
const keep = socket => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); return socket; };

if (role === 'route') {
  process.on('message', async message => {
    if (message.type === 'init') {
      configuration = message.configuration;
      server = net.createServer(socket => {
        keep(socket); let header = '';
        socket.on('data', function receive(chunk) {
          header += chunk.toString('ascii'); if (header.length > 8192) { socket.destroy(); return; }
          if (!header.includes('\r\n\r\n')) return; socket.off('data', receive);
          if (!header.startsWith(`CONNECT ${configuration.hostname}:${configuration.targetPort} HTTP/1.1\r\n`)) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
          const upstream = keep(net.connect({ host: '127.0.0.1', port: configuration.targetPort }, () => {
            socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); socket.pipe(upstream); upstream.pipe(socket);
          }));
          socket.on('close', () => upstream.destroy()); upstream.on('close', () => socket.destroy());
        });
      });
      server.listen(0, '127.0.0.1', () => send({ type: 'ready', pid: process.pid, port: server.address().port }));
    }
    if (message.type === 'drop-owned-link') {
      for (const socket of sockets) socket.destroy();
      server.close(() => send({ type: 'link-closed', id: message.id }));
    }
  });
} else if (role === 'network') {
  async function probe(message) {
    if (blocked && !message.forceDirect) return { decision: 'blocked', dispatched: false };
    const raw = keep(net.connect({ host: '127.0.0.1', port: message.forceDirect ? configuration.targetPort : configuration.routePort }));
    await new Promise((resolve, reject) => { raw.once('connect', resolve); raw.once('error', reject); });
    if (!message.forceDirect) {
      raw.write(`CONNECT ${configuration.hostname}:${configuration.targetPort} HTTP/1.1\r\nHost: ${configuration.hostname}\r\n\r\n`);
      await new Promise((resolve, reject) => { raw.once('data', data => data.toString().startsWith('HTTP/1.1 200') ? resolve() : reject(new Error('CONNECT rejected'))); raw.once('error', reject); });
    }
    const secure = keep(tls.connect({ socket: raw, servername: configuration.hostname, ca: configuration.ca }));
    await new Promise((resolve, reject) => { secure.once('secureConnect', resolve); secure.once('error', reject); });
    secure.write(`GET /https?probe=${message.probeID} HTTP/1.1\r\nHost: ${configuration.hostname}\r\nConnection: keep-alive\r\n\r\n`);
    const received = await new Promise((resolve, reject) => { secure.once('data', data => resolve(data.toString().startsWith('HTTP/1.1 200'))); secure.once('error', reject); });
    return { decision: message.forceDirect ? 'intentionally-direct-negative' : 'helper-routed', dispatched: true, tlsVerified: true, targetHTTP200: received };
  }
  process.on('message', async message => {
    if (message.type === 'init') { configuration = message.configuration; blocked = false; send({ type: 'ready', pid: process.pid }); }
    if (message.type === 'block') { blocked = true; send({ id: message.id, type: 'blocked-readback', state: 'blocked', pid: process.pid }); }
    if (message.type === 'probe') { try { send({ id: message.id, ...await probe(message) }); } catch (error) { send({ id: message.id, error: error.message }); } }
  });
} else if (role === 'root') {
  const children = []; let route, network, initialized, configuration;
  const pending = new Map();
  const childRPC = (child, value) => new Promise((resolve, reject) => {
    const id = `child-${Date.now()}-${Math.random()}`; const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Owned helper IPC timed out')); }, 5000);
    pending.set(id, value => { clearTimeout(timeout); resolve(value); }); child.send({ ...value, id });
  });
  const launch = childRole => {
    const child = fork(filename, [childRole], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }); children.push(child);
    child.on('message', value => { if (pending.has(value.id)) { pending.get(value.id)(value); pending.delete(value.id); } });
    return child;
  };
  process.on('message', async message => {
    try {
      if (message.type === 'init') {
        configuration = message.configuration; route = launch('route');
        route.once('message', value => {
          network = launch('network');
          network.once('message', () => {
            initialized = true;
            send({ type: 'ready', rootPID: process.pid, routePID: route.pid, networkPID: network.pid, routePort: value.port, executable: process.execPath });
          });
          network.send({ type: 'init', configuration: { ...configuration, routePort: value.port } });
        });
        route.send({ type: 'init', configuration });
      }
      if (message.type === 'probe' && initialized) send({ ...await childRPC(network, message), id: message.id });
      if (message.type === 'block' && initialized) send({ ...await childRPC(network, { type: 'block' }), id: message.id });
      if (message.type === 'fault' && initialized) {
        let effect;
        if (message.scenario === 'wifiswitch') { effect = await childRPC(route, { type: 'drop-owned-link' }); effect = { type: 'owned-socket-link-loss', actualWiFiChanged: false, observed: effect.type }; }
        else if (message.scenario === 'sleepwake') {
          route.kill('SIGSTOP'); await new Promise(resolve => setTimeout(resolve, 40));
          const observedState = execFileSync('/bin/ps', ['-p', String(route.pid), '-o', 'state='], { encoding: 'utf8' }).trim(); route.kill('SIGCONT');
          effect = { type: 'owned-process-suspend-resume', actualSystemSleep: false, signals: ['SIGSTOP', 'SIGCONT'], observedState };
        } else if (['killroute', 'crash'].includes(message.scenario)) {
          const signal = message.scenario === 'crash' ? 'SIGKILL' : 'SIGTERM';
          effect = await new Promise(resolve => { route.once('exit', (code, receivedSignal) => resolve({ type: 'owned-route-exit', code, signal: receivedSignal })); route.kill(signal); });
        } else throw new Error('Only the four owned-helper fault scenarios are allowed');
        const readback = await childRPC(network, { type: 'block' }); send({ id: message.id, effect, readback });
      }
      if (message.type === 'stop') {
        for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        setTimeout(() => process.exit(0), 25);
      }
    } catch (error) { send({ id: message.id, error: error.message }); }
  });
  process.on('disconnect', () => { for (const child of children) child.kill('SIGKILL'); process.exit(0); });
}
if (role !== 'root') process.on('disconnect', () => { for (const socket of sockets) socket.destroy(); if (server) server.close(); process.exit(0); });
