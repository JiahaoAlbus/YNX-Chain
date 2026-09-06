import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function harness() {
  const handlers = new Map<string, (event: any) => void>();
  const buckets = new Map<string, Map<string, Response>>();
  let online = false;
  let networkResponse = new Response('fresh asset');
  const origin = 'https://monitor.example.invalid';
  const key = (request: Request | string) => new URL(typeof request === 'string' ? request : request.url, origin).href;
  const caches = {
    keys: async () => [...buckets.keys()],
    delete: async (name: string) => buckets.delete(name),
    open: async (name: string) => {
      if (!buckets.has(name)) buckets.set(name, new Map());
      const values = buckets.get(name)!;
      return { keys: async () => [...values.keys()].map(url => new Request(url)), delete: async (request: Request | string) => values.delete(key(request)), match: async (request: Request | string) => values.get(key(request))?.clone(), put: async (request: Request | string, response: Response) => { values.set(key(request), response.clone()); }, addAll: async () => {} };
    },
  };
  vm.runInNewContext(readFileSync('public/sw.js','utf8'), { caches, URL, Response, location: { origin }, self: { addEventListener: (name: string, handler: any) => handlers.set(name, handler), skipWaiting: async () => {}, clients: { claim: async () => {} } }, fetch: async () => { if (!online) throw Error('offline'); return networkResponse.clone(); } });
  const run = async (name: string, request?: Request) => {
    const waits: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    handlers.get(name)!({ request, waitUntil: (promise: Promise<unknown>) => waits.push(promise), respondWith: (promise: Promise<Response>) => { response = promise; } });
    const result = response ? await response : undefined;
    await Promise.all(waits);
    return result;
  };
  return { caches, run, origin, setOnline: (response: Response) => { online = true; networkResponse = response; } };
}

test('SW upgrade removes old status evidence and preserves unrelated caches', async () => {
  const h=harness();
  await (await h.caches.open('ynx-monitor-shell-v1')).put('/status',Response.json({availability:'available',status:'operational'}));
  await (await h.caches.open('ynx-monitor-shell-v3')).put('/connectivity',Response.json({status:'operational'}));
  await (await h.caches.open('unrelated-app')).put('/asset',new Response('preserve'));
  await h.run('activate');
  assert.deepEqual(await h.caches.keys(),['ynx-monitor-shell-v3','unrelated-app']);
  assert.equal(await (await h.caches.open('ynx-monitor-shell-v3')).match('/connectivity'),undefined);
});

test('offline status and connectivity return unavailable even with cached green evidence', async () => {
  const h=harness(), cache=await h.caches.open('ynx-monitor-shell-v3');
  await cache.put('/',new Response('cached HTML shell'));
  for(const path of ['/status','/STATUS?probe=1','/connectivity','/CONNECTIVITY?probe=1']){
    await cache.put(path,Response.json({availability:'available',status:'operational'}));
    const response=await h.run('fetch',new Request(h.origin+path));
    assert.equal(response!.status,503);
    assert.equal(response!.headers.get('Cache-Control'),'no-store');
    assert.equal((await response!.json()).availability,'unavailable');
  }
  assert.equal(await (await h.run('fetch',new Request(h.origin+'/')))!.text(),'cached HTML shell');
});

test('no-store responses remain uncached while offline asset behavior is preserved',async()=>{
  const h=harness();h.setOnline(new Response('fresh private response',{headers:{'Cache-Control':'private, no-store'}}));
  assert.equal(await (await h.run('fetch',new Request(h.origin+'/uncached')))!.text(),'fresh private response');
  assert.equal(await (await h.caches.open('ynx-monitor-shell-v3')).match('/uncached'),undefined);
});


test('case variants and bearer requests never read or write an offline response',async()=>{
  const h=harness(), cache=await h.caches.open('ynx-monitor-shell-v3');
  const paths=['/ops/me','/OPS/me','/OpS/me?account=B','/ops/%6De','/private/custom'];
  for(const path of paths){
    await cache.put(path,Response.json({account:'synthetic-account-A'}));
    const request=new Request(h.origin+path,{headers:{Authorization:'Bearer synthetic-account-B'}});
    await assert.rejects(h.run('fetch',request),/offline/);
  }
  for(const path of ['/OPS/me','/OpS/me?account=B'])await assert.rejects(h.run('fetch',new Request(h.origin+path)),/offline/);
  h.setOnline(Response.json({account:'synthetic-account-B'}));
  const request=new Request(h.origin+'/authenticated-new',{headers:{Authorization:'Bearer synthetic-account-B'}});
  assert.equal((await (await h.run('fetch',request))!.json()).account,'synthetic-account-B');
  assert.equal(await cache.match('/authenticated-new'),undefined);
});
