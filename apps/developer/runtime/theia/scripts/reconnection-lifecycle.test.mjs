import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
const require = createRequire(new URL('../package.json', import.meta.url));
require('reflect-metadata');
globalThis.window = { localStorage: { getItem: () => null }, location: { reload() { assert.fail('must preserve live unsaved editors'); } } };
const { FrontendApplicationConfigProvider } = require('@theia/core/lib/browser/frontend-application-config-provider');
FrontendApplicationConfigProvider.set({ reloadOnReconnect: false });
const { Emitter } = require('@theia/core/lib/common/event');
const { BasicChannel } = require('@theia/core/lib/common/message-rpc/channel');
const { Uint8ArrayReadBuffer, Uint8ArrayWriteBuffer } = require('@theia/core/lib/common/message-rpc/uint8-array-message-buffer');
const { SocketWriteBuffer } = require('@theia/core/lib/common/messaging/socket-write-buffer');
const { RPCProtocolImpl } = require('@theia/plugin-ext/lib/common/rpc-protocol');
const module = { exports: {} };
vm.runInNewContext(readFileSync(new URL('../../ynx-workbench/lib/reconnection-lifecycle.js', import.meta.url), 'utf8'), { module, require, window });
const { negotiateReconnect, createServerRpc } = module.exports;
const tick = () => new Promise(resolve => setImmediate(resolve));

test('negative control: upstream disposed RPC still answers fresh LoggerMain request with missing-handler error', async () => {
  const source = readFileSync(require.resolve('@theia/plugin-ext/lib/hosted/browser/hosted-plugin'), 'utf8');
  const method = source.slice(source.indexOf('    createServerRpc(pluginHostId) {'), source.indexOf('    async updateStoragePath()', source.indexOf('    createServerRpc(pluginHostId) {')));
  const legacy = vm.runInNewContext('({' + method + '}).createServerRpc', {
    channel_1: { BasicChannel }, uint8_array_message_buffer_1: { Uint8ArrayReadBuffer, Uint8ArrayWriteBuffer }, rpc_protocol_1: { RPCProtocolImpl },
  });
  const events = new Emitter();
  const remote = new BasicChannel(() => { const writer = new Uint8ArrayWriteBuffer(); writer.onCommit(message => events.fire({ pluginHostId: 'node', message })); return writer; });
  const host = new RPCProtocolImpl(remote);
  const old = legacy.call({ watcher: { onPostMessageEvent: events.event }, server: { onMessage: (id, bytes) => remote.onMessageEmitter.fire(() => new Uint8ArrayReadBuffer(bytes)) } }, 'node');
  old.set({ id: 'LoggerMain' }, { $log: () => undefined }); old.dispose();
  await assert.rejects(host.getProxy({ id: 'LoggerMain' }).$log('after reconnect'), /no local service handler with id LoggerMain/);
  host.dispose(); remote.onCloseEmitter.fire({ reason: 'test end' }); remote.close(); events.dispose();
});

test('expired transport negotiates one fresh connection, preserves editor references and cancels old requests', async () => {
  const socket = new EventEmitter(), sent = [], listeners = new EventEmitter();
  socket.on = listeners.on.bind(listeners); socket.off = listeners.off.bind(listeners);
  socket.emit = (...args) => sent.push(args);
  socket.disconnect = () => {}; socket.connect = () => queueMicrotask(() => context.currentChannel ? negotiateReconnect.call(context) : socket.emit('initialConnection', 'same-frontend'));
  const channel = new BasicChannel(() => new Uint8ArrayWriteBuffer());
  let closed = 0; channel.onClose(() => closed++);
  const editor = { dirty: true, text: 'unsaved new content', selection: [4, 7] };
  const buffer = new SocketWriteBuffer(); buffer.buffer(new Uint8Array([1, 2]));
  const context = { socket, currentChannel: channel, writeBuffer: buffer, frontendIdProvider: { getId: () => 'same-frontend' }, editor };
  negotiateReconnect.call(context); listeners.emit('reconnect', false); await tick();
  assert.deepEqual(sent.map(x => x[0]), ['reconnect', 'initialConnection']);
  assert.equal(closed, 1); assert.equal(context.currentChannel, undefined);
  assert.equal(buffer.disconnectedBuffer, undefined);
  assert.equal(context.editor, editor); assert.equal(editor.text, 'unsaved new content'); assert.equal(editor.dirty, true);
  assert.equal(listeners.listenerCount('reconnect'), 0);
});

test('retained backend connection flushes buffered work without replacing its channel', () => {
  const socket = new EventEmitter(), listeners = new EventEmitter(), sent = [];
  socket.on = listeners.on.bind(listeners); socket.off = listeners.off.bind(listeners); socket.emit = () => {}; socket.send = bytes => sent.push(bytes);
  const writeBuffer = new SocketWriteBuffer(); writeBuffer.buffer(new Uint8Array([3, 4]));
  const channel = {}; const context = { socket, currentChannel: channel, writeBuffer, frontendIdProvider: { getId: () => 'same' } };
  negotiateReconnect.call(context); listeners.emit('reconnect', true);
  assert.equal(context.currentChannel, channel); assert.deepEqual([...sent[0]], [3, 4]);
});

test('actual plugin RPC retires old watcher and queued batches; replacement LoggerMain receives each request once', async () => {
  const events = new Emitter(), delivered = [], serverChannel = new BasicChannel(() => {
    const writer = new Uint8ArrayWriteBuffer(); writer.onCommit(message => events.fire({ pluginHostId: 'node', message })); return writer;
  });
  const host = new RPCProtocolImpl(serverChannel);
  const context = { watcher: { onPostMessageEvent: events.event }, server: { onMessage(id, bytes) {
    delivered.push(bytes); serverChannel.onMessageEmitter.fire(() => new Uint8ArrayReadBuffer(bytes));
  } } };
  const old = createServerRpc.call(context, 'node');
  old.set({ id: 'LoggerMain' }, { $log: () => assert.fail('retired handler received a request') });
  const pending = old.getProxy({ id: 'NeverReplies' }).$wait();
  const rejected = assert.rejects(pending, /connection retired/);
  old.dispose(); await rejected; await tick();
  assert.equal(delivered.length, 0, 'old queued batch must not reach new host');
  const fresh = createServerRpc.call(context, 'node'); let count = 0;
  fresh.set({ id: 'LoggerMain' }, { $log: value => { count++; return value; } });
  assert.equal(await host.getProxy({ id: 'LoggerMain' }).$log('saved'), 'saved');
  assert.equal(count, 1);
  fresh.dispose(); host.dispose(); serverChannel.onCloseEmitter.fire({ reason: 'test end' }); serverChannel.close(); events.dispose();
});
