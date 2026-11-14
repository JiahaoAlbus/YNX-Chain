import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

// This creates network probes, not an isolation shim. Native policy and OS routing stay authoritative.
export function buildWebKitBootstrap({ runID, httpsPort, stunPort, stunIPv6Port, targetHost = `${runID}.leak.test`, publicFixture, expectedWssSHA256 }) {
  if (!/^[a-z0-9-]{1,40}$/.test(runID) || !Number.isInteger(stunPort) || stunPort < 1024 || stunPort > 65535) throw new Error('Run-bound fixture and owned STUN port required');
  let configuration;
  if (publicFixture) {
    if (publicFixture.nonce !== runID || !Array.isArray(publicFixture.origins) || publicFixture.origins.length < 1 || publicFixture.origins.length > 2 || ![publicFixture.responseSHA256, publicFixture.downloadSHA256].every(value => /^[a-f0-9]{64}$/.test(value))) throw new Error('Explicit public origins, run nonce and exact response/download hashes required');
    for (const origin of publicFixture.origins) { const url = new URL(origin); if (url.protocol !== 'https:' || url.origin !== origin || url.port || url.username || url.password || url.search || url.hash || isIP(url.hostname.replace(/^\[|\]$/g, ''))) throw new Error('Public fixture requires exact HTTPS443 DNS origins without credentials/path/query/fragment'); }
    const prefix = `/ynx-route-probe/${runID}`;
    configuration = { runID, base: publicFixture.origins[0] + prefix, cross: (publicFixture.origins[1] ?? publicFixture.origins[0]) + prefix, proofPath: '/proof', expectedResponseSHA256: publicFixture.responseSHA256, expectedDownloadSHA256: publicFixture.downloadSHA256, expectedWssSHA256, stun: `stun:127.0.0.1:${stunPort}` };
  } else {
    if (![`${runID}.leak.test`, '127.0.0.1'].includes(targetHost) || !Number.isInteger(httpsPort) || httpsPort < 1024 || httpsPort > 65535) throw new Error('Only this run and explicit owned loopback fixture targets permitted');
    configuration = { runID, base: `https://${targetHost}:${httpsPort}`, cross: `https://frame.${runID}.leak.test:${httpsPort}`, proofPath: '/https', stun: `stun:127.0.0.1:${stunPort}` };
  }
  if (stunIPv6Port !== undefined) { if (!Number.isInteger(stunIPv6Port) || stunIPv6Port < 1024 || stunIPv6Port > 65535) throw new Error('Exact owned IPv6 STUN port required'); configuration.stun6 = `stun:[::1]:${stunIPv6Port}`; }
  const script = String.raw`
(() => {
  'use strict';
  const cfg = __CONFIG__; const resources = [];
  const emit = value => window.webkit.messageHandlers.p05Probe.postMessage({runID: cfg.runID, ...value});
  const runPhase = async phase => {
    if (!['baseline','after-fault'].includes(phase)) throw Error('Invalid phase');
    resources.splice(0).forEach(value => value.close());
    const id = kind => phase + '-' + kind;
    emit({phase, kind:'phase-started'});
    fetch(cfg.base + cfg.proofPath + '?probe=' + id('https'), {cache:'no-store'}).then(async response => {
      if (!response.ok) { emit({phase, probeID:id('https'), kind:'https', status:'http-error'}); return; }
      const bytes = await response.arrayBuffer();
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2,'0')).join('');
      emit({phase, probeID:id('https'), kind:'https', status:cfg.expectedResponseSHA256 && digest === cfg.expectedResponseSHA256 ? 'body-match' : 'body-mismatch'});
    }).catch(() => emit({phase, probeID:id('https'), kind:'https', status:'rejected'}));
    const ws = new WebSocket(cfg.base.replace('https:', 'wss:') + '/wss?probe=' + id('wss')); resources.push(ws);
    ws.onopen = () => emit({phase, probeID:id('wss'), kind:'wss', status:'open'});
    ws.onerror = () => emit({phase, probeID:id('wss'), kind:'wss', status:'rejected'});
    ws.onmessage = async event => { const bytes = new TextEncoder().encode(String(event.data)); const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join(''); emit({phase,probeID:id('wss'),kind:'wss',status:cfg.expectedWssSHA256 && digest===cfg.expectedWssSHA256?'body-match':'body-mismatch'}); ws.close(); };
    const download = document.createElement('a'); download.href = cfg.base + '/download?probe=' + id('download'); download.download = 'synthetic-download.txt'; document.body.append(download); download.click();
    emit({phase, probeID:id('download'), kind:'download', status:'requested-not-completion'});
    const frame = document.createElement('iframe'); frame.src = cfg.cross + cfg.proofPath + '?probe=' + id('cross-origin'); document.body.append(frame);
    frame.onload = () => emit({phase, probeID:id('cross-origin'), kind:'frame', status:'load-event-not-content-proof'});
    if (typeof RTCPeerConnection !== 'function') { emit({phase, probeID:id('rtc'), kind:'rtc', status:'unavailable-not-no-leak-proof'}); return; }
    const rtc = new RTCPeerConnection({iceServers:[{urls:[cfg.stun,...(cfg.stun6?[cfg.stun6]:[])]}]}); resources.push(rtc); rtc.createDataChannel('p05-synthetic');
    rtc.onicecandidate = event => { if (!event.candidate) return; const address=event.candidate.address||''; emit({phase, probeID:id('rtc'), kind:'ice', candidateType:event.candidate.type||'unknown', addressFamily:address.endsWith('.local')?'mdns':address.includes(':')?'ipv6':/^[0-9]+\./.test(address)?'ipv4':'unknown'}); };
    try { await rtc.setLocalDescription(await rtc.createOffer()); emit({phase, probeID:id('rtc'), kind:'rtc', status:'offer-created'}); } catch { emit({phase, probeID:id('rtc'), kind:'rtc', status:'rejected'}); }
  };
  Object.defineProperty(window, '__p05RunPhase', {value:phase => { void runPhase(phase); }, configurable:false});
  Object.defineProperty(window, '__p05CloseProbes', {value:() => resources.forEach(value => value.close()), configurable:false});
  emit({kind:'bootstrap-ready', phase:'startup'});
})();`;
  const html = '<!doctype html><html><meta charset="utf-8"><title>P05 local synthetic instrument</title><body><script>' + script.replace('__CONFIG__', JSON.stringify(configuration)) + '</script></body></html>';
  return { html, sha256: createHash('sha256').update(html).digest('hex'), configuration, fixtureOnly: true, modifiesNetworkingAPIs: false, targetVerdict: 'INCOMPLETE' };
}
