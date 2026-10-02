import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';

test('Creator serves its complete runtime but does not expose source receipts or build scripts', async () => {
  const reservation=createServer();
  reservation.listen(0,'127.0.0.1');
  await once(reservation,'listening');
  const port=reservation.address().port;
  await new Promise(resolve=>reservation.close(resolve));
  const server=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  try {
    await Promise.race([
      once(server.stdout,'data'),
      once(server,'exit').then(([code])=>{throw new Error(`server exited ${code}`);}),
      new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('server startup timeout')),5000);timer.unref();}),
    ]);
    const origin=`http://127.0.0.1:${port}`;
    for(const path of ['/', '/video/studio/', '/wallet-auth/callback', '/session-events.js', '/assets/ynx-logo.png', '/product-session-sdk.js', '/i18n/catalog.json', '/ynx-wallet-transports-2ece0cb329.mjs']) {
      const response=await fetch(origin+path);
      assert.equal(response.status,200,path);
      assert.equal(response.headers.get('x-content-type-options'),'nosniff');
      await response.arrayBuffer();
    }
    for(const path of ['/server.mjs','/build.mjs','/app.test.mjs','/package.json','/product-release.json','/dist/creator-studio.manifest.json','/video/studio/server.mjs']) {
      const response=await fetch(origin+path);
      assert.equal(response.status,404,path);
      await response.text();
    }
    const rejected=await fetch(origin+'/app.js',{method:'POST',body:'test'});
    assert.equal(rejected.status,405);
    assert.equal(rejected.headers.get('allow'),'GET, HEAD');
  } finally {
    server.kill();
    await once(server,'exit');
  }
});
