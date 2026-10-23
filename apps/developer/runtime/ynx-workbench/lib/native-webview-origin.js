'use strict';
const installed = new WeakSet();
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
// Theia's browser default appends the parent hostname. With a numeric parent
// this yields an invalid URL such as uuid.webview.127.0.0.1. Keep the original
// isolated vhost/resource/WS machinery, using a resolvable loopback subdomain.
// A fresh document namespace also separates views across project windows.
function install(prototype, target = globalThis.window) {
  if (!target?.__ynxNativeFilesystemBridgeEnabled || !target.webkit?.messageHandlers?.ynxLocalWorkbench) return false;
  const location = target.location;
  if (location?.protocol !== 'http:' || location.hostname !== '127.0.0.1' || !/^[1-9][0-9]{0,4}$/.test(location.port || '') || Number(location.port) > 65535) return false;
  if (!prototype) prototype = require('@theia/plugin-ext/lib/main/browser/webview/webview-environment').WebviewEnvironment.prototype;
  if (installed.has(prototype)) return false;
  const original = prototype.externalEndpointUrl;
  if (typeof original !== 'function' || typeof target.crypto?.randomUUID !== 'function') return false;
  const namespace = target.crypto.randomUUID();
  if (!UUID.test(namespace)) return false;
  const origin = location.origin, expected = '{{uuid}}.webview.127.0.0.1:' + location.port;
  const isolated = '{{uuid}}.' + namespace + '.webview.localhost:' + location.port;
  prototype.externalEndpointUrl = async function (...args) {
    const endpoint = await original.apply(this, args);
    // Do not override operator/custom endpoints, another origin, or a future
    // framework URL shape. No same-origin fallback or external host is added.
    if (target.location.origin !== origin || endpoint.scheme !== 'http' || endpoint.authority !== expected || endpoint.path.toString() !== '/webview' || endpoint.query || endpoint.fragment) return endpoint;
    return endpoint.withAuthority(isolated);
  };
  installed.add(prototype);
  return true;
}
module.exports = { install };
