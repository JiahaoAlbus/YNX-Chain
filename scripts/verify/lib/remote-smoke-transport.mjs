import { Agent, buildConnector } from "undici";

export function parseRemoteSmokeTransport(env = process.env) {
  const host = String(env.YNX_REMOTE_CONNECT_HOST || "").trim();
  const portText = String(env.YNX_REMOTE_CONNECT_PORT || "").trim();
  if (!host && !portText) return null;
  if (!host || !portText) throw new Error("YNX_REMOTE_CONNECT_HOST and YNX_REMOTE_CONNECT_PORT must be set together");
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("YNX_REMOTE_CONNECT_PORT must be between 1 and 65535");
  const route = String(env.YNX_REMOTE_PROOF_ROUTE || "explicit-connect-override").trim();
  return { host, port, route };
}

export function remapConnectOptions(options, transport) {
  if (!transport) return options;
  return {
    ...options,
    hostname: transport.host,
    host: transport.host,
    port: String(transport.port),
    servername: options.servername || options.hostname,
  };
}

export function createRemoteSmokeDispatcher(transport, timeoutMs) {
  if (!transport) return null;
  const connector = buildConnector({ timeout: timeoutMs });
  return new Agent({
    connect(options, callback) {
      connector(remapConnectOptions(options, transport), callback);
    },
  });
}

export function remoteSocketTarget(host, port, transport) {
  if (!transport) return { host, port };
  return { host: transport.host, port: transport.port };
}
