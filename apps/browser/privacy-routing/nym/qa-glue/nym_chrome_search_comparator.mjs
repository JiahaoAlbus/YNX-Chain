import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { lstat, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { createServer, connect, isIP } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const QUERY = 'https://duckduckgo.com/?q=YNX%20browser';
const MAX_FRAME = 2 * 1024 * 1024;

export function publicHost(value) {
  const name = value.toLowerCase();
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(name) && !isIP(name)
    && !/^[0-9.]+$/.test(name) && !name.endsWith('.localhost') && !name.endsWith('.local')
    && !name.endsWith('.internal') && !name.endsWith('.lan') && !name.endsWith('.home') ? name : null;
}

const read = async (socket, count) => {
  while (true) {
    if (socket.destroyed || socket.readableEnded) throw new Error('SOCKS_EOF');
    const bytes = socket.read(count);
    if (bytes) {
      if (bytes.length !== count) throw new Error('SOCKS_SHORT_READ');
      return bytes;
    }
    await new Promise((resolve, reject) => {
      const stop = () => { clear(); reject(new Error('SOCKS_EOF')); };
      const ready = () => { clear(); resolve(); };
      const clear = () => {
        socket.off('readable', ready); socket.off('end', stop);
        socket.off('error', stop); socket.off('close', stop);
      };
      socket.once('readable', ready); socket.once('end', stop);
      socket.once('error', stop); socket.once('close', stop);
    });
  }
};

// No name lookup or Internet fallback exists here. The only dial is the owned
// numerical loopback Nym listener, with the original SOCKS domain frame intact.
export async function makeRelay(upstream, allows) {
  const children = new Set(), seen = new Set();
  function retain(sock) {
    children.add(sock);
    sock.on('error', () => sock.destroy());
    sock.on('close', () => children.delete(sock));
    // The upstream SOCKS acknowledgment may use a substantial part of an
    // interactive request's independent time budget. The comparator still
    // closes every retained socket when its outer deadline or owner ends.
    sock.setTimeout(35000, () => sock.destroy());
    return sock;
  }
  const server = createServer(input => {
    retain(input);
    (async () => {
      const [version, count] = await read(input, 2);
      if (version !== 5 || !count || count > 16 || !(await read(input, count)).includes(0)) throw new Error('SOCKS_METHOD');
      input.write(Buffer.from([5, 0]));
      const prefix = await read(input, 5);
      if (!prefix.subarray(0, 4).equals(Buffer.from([5, 1, 0, 3])) || !prefix[4]) throw new Error('SOCKS_DOMAIN_REQUIRED');
      const name = await read(input, prefix[4]);
      const port = await read(input, 2);
      const host = publicHost(name.toString('latin1'));
      if (!host || !allows(host, port.readUInt16BE())) throw new Error('SOCKS_TARGET_DENIED');
      const target = retain(connect({ host: '127.0.0.1', port: upstream, family: 4 }));
      input.once('close', () => target.destroy());
      target.once('close', () => input.destroy());
      await once(target, 'connect');
      target.write(Buffer.from([5, 1, 0]));
      if (!(await read(target, 2)).equals(Buffer.from([5, 0]))) throw new Error('UPSTREAM_SOCKS_METHOD');
      target.write(Buffer.concat([prefix, name, port]));
      const reply = await read(target, 4);
      if (!reply.subarray(0, 3).equals(Buffer.from([5, 0, 0]))) throw new Error('UPSTREAM_SOCKS_REPLY');
      const kind = reply[3];
      const len = kind === 1 ? 4 : kind === 4 ? 16 : kind === 3 ? (await read(target, 1))[0] : 0;
      if (!len) throw new Error('UPSTREAM_SOCKS_FRAME');
      const bound = await read(target, len + 2);
      input.write(Buffer.concat(kind === 3 ? [reply, Buffer.from([len]), bound] : [reply, bound]));
      seen.add(host);
      input.setTimeout(0); target.setTimeout(0);
      input.pipe(target); target.pipe(input);
    })().catch(() => input.destroy());
  });
  server.maxConnections = 24;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { port: server.address().port, seen, close() {
    for (const sock of children) sock.destroy();
    return new Promise(resolve => server.close(resolve));
  } };
}

class CDP {
  constructor(child, emit) {
    this.pipe = child.stdio[3];
    this.pending = new Map();
    this.next = 0;
    let buffer = Buffer.alloc(0);
    const fail = () => this.stop(new Error('CDP_PIPE_CLOSED'));
    this.pipe.on('error', fail);
    child.stdio[4].on('error', fail);
    child.once('exit', fail);
    child.stdio[4].on('data', part => {
      if (buffer.length + part.length > MAX_FRAME) { this.stop(new Error('CDP_FRAME_LIMIT')); return; }
      buffer = Buffer.concat([buffer, part]);
      for (let nul; (nul = buffer.indexOf(0)) !== -1;) {
        let row;
        try { row = JSON.parse(buffer.subarray(0, nul)); }
        catch { this.stop(new Error('CDP_INVALID_FRAME')); return; }
        buffer = buffer.subarray(nul + 1);
        if (row.id) {
          const resolve = this.pending.get(row.id);
          if (resolve) {
            this.pending.delete(row.id);
            resolve(row.error ? new Error('CDP_COMMAND_REJECTED') : null, row.result);
          }
        } else emit(row);
      }
    });
  }
  stop(error) {
    this.terminal = error;
    for (const resolve of this.pending.values()) resolve(error);
    this.pending.clear();
  }
  call(method, params = {}, sessionId, timeoutMs = 4000) {
    if (this.terminal) return Promise.reject(this.terminal);
    if (this.pending.size > 64) return Promise.reject(new Error('CDP_COMMAND_LIMIT'));
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('CDP_COMMAND_TIMEOUT')), timeoutMs);
      const finish = (error, result) => {
        clearTimeout(timer); this.pending.delete(id);
        if (error) reject(error); else resolve(result);
      };
      this.currentMethod = method;
      this.pending.set(id, finish);
      this.pipe.write(JSON.stringify({ id, method, params, sessionId }) + '\x00', error => {
        if (error) finish(new Error('CDP_PIPE_WRITE'));
      });
    });
  }
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const isDDG = name => name === 'duckduckgo.com' || name.endsWith('.duckduckgo.com');
const errorName = error => error instanceof Error && /^[A-Z_]{3,64}$/.test(error.message)
  ? error.message : 'BROWSER_COMPARATOR_FAILED';

export const renderedShape = `(() => {
  const visible = element => element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
  const challenged = [...document.querySelectorAll('#challenge-form, #anomaly-modal, .anomaly-modal, iframe[src*="captcha"]')].some(visible);
  if (challenged) return { challenge: true };
  const matches = [...document.querySelectorAll('a[data-testid="result-title-a"], a.result__a')]
    .filter(link => link.href && link.textContent.trim() && visible(link)
      && !link.closest('[data-testid*="ad-"], [data-testid*="sponsored"], [data-layout="ad"]'));
  return { complete: document.readyState === 'complete', count: matches.length, firstHref: matches[0]?.href ?? null };
})()`;

function clickTarget(raw, base) {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  try {
    const url = new URL(raw, base);
    const safe = value => value.protocol === 'https:' && !value.username && !value.password
      && (!value.port || value.port === '443') && publicHost(value.hostname);
    if (isDDG(url.hostname)) {
      if (!['r.duckduckgo.com', 'duckduckgo.com', 'links.duckduckgo.com'].includes(url.hostname)) return null;
      const unwrapped = new URL(url.searchParams.get('uddg') ?? 'about:blank');
      return safe(url) && safe(unwrapped) && !isDDG(unwrapped.hostname) ? unwrapped : null;
    }
    return safe(url) ? url : null;
  } catch { return null; }
}

function chromeArgs(profile, port) {
  return ['--headless', '--remote-debugging-pipe', `--user-data-dir=${profile}`,
    `--proxy-server=socks5://127.0.0.1:${port}`, '--proxy-bypass-list=<-loopback>',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--disable-quic', '--webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank'];
}

export async function runBrowserComparator({ profile, url = QUERY, upstream, absoluteMs, fixture = false }) {
  const result = { renderer: 'ADMITTED_GOOGLE_CHROME', installedYNXOrWK: false,
    targetProxyHandshake: false, challenge: false, searchDocument: null,
    visibleOrganicLinks: 0, click: null, browserExit: null, firstFailure: null };
  let child, exitPromise, relay, cdp;
  const main = new URL(url);
  const monotonicEnd = performance.now() + Math.max(0, absoluteMs - Date.now());
  const workRemaining = () => Math.min(absoluteMs - Date.now(), monotonicEnd - performance.now());
  let allowedClickHost = null, candidateHref = null, pageSession, phase = 'search';
  let signalFailure = false, interactionFailed = false, requestsSeen = 0, requestsAllowed = 0;
  const onSignal = () => { signalFailure = true; cdp?.stop(new Error('COMPARATOR_CANCELLED')); };
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, onSignal);
  const timeout = setTimeout(() => cdp?.stop(new Error('COMPARATOR_ABSOLUTE_DEADLINE')), Math.max(1, workRemaining()));
  const valid = () => {
    if (signalFailure) throw new Error('COMPARATOR_CANCELLED');
    if (workRemaining() <= 0) throw new Error('COMPARATOR_ABSOLUTE_DEADLINE');
    if (interactionFailed) throw new Error('COMPARATOR_INTERCEPTION_FAILED');
  };
  const allowed = (host, port) => (port === 443 || (fixture && port === 80))
    && (host === main.hostname || (!fixture && isDDG(host)) || host === allowedClickHost);
  try {
    valid();
    relay = await makeRelay(upstream, allowed);
    child = spawn(CHROME, chromeArgs(profile, relay.port), { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
    exitPromise = new Promise(resolve => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
      child.once('error', () => { cdp?.stop(new Error('COMPARATOR_CHROME_SPAWN')); resolve({ code: null, signal: null }); });
    });
    cdp = new CDP(child, row => {
      if (row.sessionId !== pageSession || !pageSession) return;
      if (!row.params) return;
      const { method, params } = row;
      if (method === 'Fetch.requestPaused') {
        requestsSeen++;
        let permit = false;
        try {
          const to = new URL(params.request.url);
          const port = Number(to.port || (to.protocol === 'https:' ? 443 : 80));
          permit = (to.protocol === 'https:' || (fixture && to.protocol === 'http:'))
            && ['GET', 'HEAD'].includes(params.request.method) && !to.username && !to.password
            && allowed(to.hostname, port)
            && (params.resourceType !== 'Document' || params.frameId === topFrame
              && (phase === 'search' ? to.href === main.href : to.href === candidateHref || to.hostname === allowedClickHost || isDDG(to.hostname)));
        } catch { }
        if (permit) requestsAllowed++;
        cdp.call(permit ? 'Fetch.continueRequest' : 'Fetch.failRequest',
          permit ? { requestId: params.requestId } : { requestId: params.requestId, errorReason: 'BlockedByClient' },
          pageSession).catch(() => { interactionFailed = true; });
      }
      if (method === 'Network.responseReceived' && params.type === 'Document' && params.frameId === topFrame) {
        const response = params.response;
        let name;
        try { name = new URL(response.url).hostname; } catch { return; }
        const evidence = { status: response.status, tls: response.securityDetails?.protocol ?? null,
          hostnameAllowed: allowed(name, fixture ? 80 : 443) };
        if (phase === 'search' && response.url === main.href) result.searchDocument = evidence;
        if (phase === 'click' && name === allowedClickHost) result.click = evidence;
      }
    });
    let topFrame;
    const rootCall = (m, p, sessionId, timeoutMs) => cdp.call(m, p, sessionId, timeoutMs);
    const { targetId } = await rootCall('Target.createTarget', { url: 'about:blank' });
    ({ sessionId: pageSession } = await rootCall('Target.attachToTarget', { targetId, flatten: true }));
    const call = (m, p, timeoutMs) => rootCall(m, p, pageSession, timeoutMs);
    const { frameTree } = await call('Page.getFrameTree');
    topFrame = frameTree.frame.id;
    await call('Page.enable');
    await call('Network.enable');
    await call('Network.setCacheDisabled', { cacheDisabled: true });
    await call('Network.setBypassServiceWorker', { bypass: true });
    await call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    const searchEnd = Math.min(Date.now() + 40_000, Date.now() + workRemaining() - 2000);
    const navigationBudget = searchEnd - Date.now();
    if (navigationBudget <= 0) throw new Error('COMPARATOR_ABSOLUTE_DEADLINE');
    const navigate = await call('Page.navigate', { url: main.href }, navigationBudget);
    if (navigate.errorText) {
      result.navigationError = /^net::ERR_[A-Z_]+$/.test(navigate.errorText) ? navigate.errorText : 'unclassified';
      throw new Error('SEARCH_NAVIGATION_FAILED');
    }

    const evaluate = async expression => (await call('Runtime.evaluate', { expression, returnByValue: true })).result?.value;
    for (; Date.now() < searchEnd; await delay(150)) {
      valid();
      const state = await evaluate(renderedShape);
      if (state?.challenge || [202, 403, 429].includes(result.searchDocument?.status)) {
        result.challenge = state?.challenge === true;
        break;
      }
      if (!state?.count || result.searchDocument?.status !== 200 || (!fixture && !result.searchDocument.tls)) continue;
      result.visibleOrganicLinks = state.count;
      candidateHref = state.firstHref;
      const target = fixture ? new URL(candidateHref, main) : clickTarget(candidateHref, main);
      if (!target || (fixture && target.hostname !== main.hostname)) break;
      allowedClickHost = target.hostname;
      phase = 'click';
      const point = await evaluate(`(() => {
        const a = [...document.querySelectorAll('a[data-testid="result-title-a"],a.result__a')]
          .find(link => link.href === ${JSON.stringify(candidateHref)});
        if (!a || a.target === '_blank') return null;
        a.scrollIntoView({ block: 'center' });
        const rect = a.getBoundingClientRect(), x=rect.left+rect.width/2, y=rect.top+rect.height/2;
        const hit = document.elementFromPoint(x,y);
        return rect.width && rect.height && (hit === a || a.contains(hit)) ? {x,y} : null;
      })()`);
      if (!point) break;
      await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
      result.clickDispatched = true;
      for (const end = Math.min(Date.now()+20_000, Date.now() + workRemaining()-1000); Date.now() < end; await delay(150)) {
        valid();
        if (result.click && await evaluate('document.readyState === "complete"')) {
          const location = await evaluate('location.href');
          if (new URL(location).hostname === allowedClickHost && (fixture || result.click.tls)
              && result.click.status >= 200 && result.click.status < 300) result.click.complete = true;
          break;
        }
      }
      break;
    }
    result.targetProxyHandshake = relay.seen.has(main.hostname);
    if (result.click) result.click.proxyHandshake = relay.seen.has(allowedClickHost);
  } catch (error) {
    result.firstFailure = errorName(error);
    result.lastProtocolCommand = cdp?.currentMethod ?? null;
  } finally {
    clearTimeout(timeout);
    result.requestsSeen = requestsSeen; result.requestsAllowed = requestsAllowed;
    if (relay) result.targetProxyHandshake = relay.seen.has(main.hostname);
    await relay?.close();
    if (child?.pid) {
      if (child.exitCode === null && child.signalCode === null && !cdp.terminal)
        await Promise.race([cdp.call('Browser.close').catch(() => {}), delay(500)]);
      if (child.exitCode === null && child.signalCode === null) {
        await Promise.race([exitPromise, delay(800)]);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        await Promise.race([exitPromise, delay(1000)]);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
      result.browserExit = await Promise.race([exitPromise, delay(1200).then(() => null)]);
      if (result.browserExit?.signal || result.browserExit?.code !== 0) result.firstFailure ??= 'COMPARATOR_BROWSER_CLEANUP_UNCONFIRMED';
    }
    for (const sig of ['SIGINT', 'SIGTERM']) process.off(sig, onSignal);
  }
  return result;
}

async function main() {
  const [directory, seconds, chromePin] = process.argv.slice(2);
  const ttl = Number(seconds) - Date.now() / 1000;
  if (process.argv.length !== 5 || !directory?.startsWith('/Volumes/') || !/^[0-9a-f]{64}$/.test(chromePin)
    || !Number.isFinite(ttl) || ttl < 10 || ttl > 110) throw new Error('COMPARATOR_SCOPE');
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.uid !== process.getuid() || (metadata.mode & 0o777) !== 0o700
    || await realpath(directory) !== directory) throw new Error('COMPARATOR_PRIVATE_SCOPE_REQUIRED');
  const actual = createHash('sha256').update(await readFile(CHROME)).digest('hex');
  if (actual !== chromePin) throw new Error('COMPARATOR_CHROME_PIN');
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', '/Applications/Google Chrome.app'], { stdio: 'ignore', timeout: 5000 });
  execFileSync('/usr/sbin/spctl', ['--assess', '--type', 'execute', '/Applications/Google Chrome.app'], { stdio: 'ignore', timeout: 8000 });
  const profile = await mkdtemp(join(directory, 'chrome-profile-'));
  const data = await runBrowserComparator({ profile, upstream: 63781, absoluteMs: Number(seconds) * 1000 - 5000 });
  await writeFile(join(directory, 'chrome-result.json'), JSON.stringify(data, null, 2) + '\n', { flag:'wx', mode:0o600 });
  console.log(JSON.stringify(data));
  if (!data.browserExit || data.firstFailure) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { console.error(errorName(error)); process.exitCode = 1; });
