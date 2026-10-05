// Theia 1.76 reconnect recovery must retire both the socket generation and the
// plugin RPC listener. Editors and unsaved models deliberately remain in place.
function negotiateReconnect() {
  const { ConnectionManagementMessages: messages } = require('@theia/core/lib/common/messaging/connection-management');
  const { FrontendApplicationConfigProvider } = require('@theia/core/lib/browser/frontend-application-config-provider');
  const socket = this.socket, channel = this.currentChannel;
  const listener = hasConnection => {
    socket.off(messages.RECONNECT, listener);
    if (socket !== this.socket || channel !== this.currentChannel) return;
    if (hasConnection) { this.writeBuffer.flush(socket); return; }
    if (FrontendApplicationConfigProvider.get().reloadOnReconnect) { window.location.reload(); return; }
    // connect emits asynchronously. Clearing the old generation first makes its
    // connect event negotiate INITIAL_CONNECT exactly once, never RECONNECT too.
    this.currentChannel = undefined;
    channel.onCloseEmitter.fire({ reason: 'reconnecting channel' });
    channel.close();
    this.writeBuffer.drain();
    socket.disconnect();
    socket.connect();
  };
  socket.on(messages.RECONNECT, listener);
  socket.emit(messages.RECONNECT, this.frontendIdProvider.getId());
}

function createServerRpc(pluginHostId) {
  const { BasicChannel } = require('@theia/core/lib/common/message-rpc/channel');
  const { Uint8ArrayWriteBuffer, Uint8ArrayReadBuffer } = require('@theia/core/lib/common/message-rpc/uint8-array-message-buffer');
  const { RPCProtocolImpl } = require('@theia/plugin-ext/lib/common/rpc-protocol');
  let retired = false;
  const channel = new BasicChannel(() => {
    const writer = new Uint8ArrayWriteBuffer();
    writer.onCommit(buffer => {
      // A batch queued before disposal must not cross into the replacement host.
      if (!retired) this.server.onMessage(pluginHostId, buffer);
    });
    return writer;
  });
  const rpc = new RPCProtocolImpl(channel);
  const subscription = this.watcher.onPostMessageEvent(received => {
    if (!retired && pluginHostId === received.pluginHostId) {
      channel.onMessageEmitter.fire(() => new Uint8ArrayReadBuffer(received.message));
    }
  });
  rpc.toDispose.push({ dispose() {
    retired = true;
    subscription.dispose();
    channel.onCloseEmitter.fire({ reason: 'plugin host connection retired' });
    rpc.rpc.channel.close();
  } });
  return rpc;
}

function install() {
  const { WebSocketConnectionSource } = require('@theia/core/lib/browser/messaging/ws-connection-source');
  const { HostedPluginSupport } = require('@theia/plugin-ext/lib/hosted/browser/hosted-plugin');
  WebSocketConnectionSource.prototype.negogiateReconnect = negotiateReconnect;
  HostedPluginSupport.prototype.createServerRpc = createServerRpc;
}
module.exports = { negotiateReconnect, createServerRpc, install };
