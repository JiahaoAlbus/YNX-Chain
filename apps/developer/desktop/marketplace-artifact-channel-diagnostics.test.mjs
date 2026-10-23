import test from 'node:test';
import assert from 'node:assert/strict';
import {duplexPair} from 'node:stream';
import artifacts from '../runtime/ynx-workbench/lib/marketplace-artifact-channel.js';

test('artifact failure retains bounded network cause without sending provider secrets',async()=>{
  const [parent,child]=duplexPair(),frames=[];child.on('data',data=>frames.push(data.toString()));
  const original=Object.assign(Error('PRIVATE_URL_AND_HEADERS'),{cause:Object.assign(Error('PRIVATE_TOKEN'),{code:'EPERM'})});
  const server=artifacts.serveArtifacts(parent,{download:async()=>{throw original;},cleanup:async()=>{}}),client=artifacts.artifactClient(child);
  try{
    await assert.rejects(client.request({namespace:'openai',name:'chatgpt',version:'PUBLIC',targetPlatform:'darwin-arm64'}),error=>{
      assert.equal(error.artifactStage,'UNKNOWN');assert.deepEqual(error.catalogCodes,['EPERM']);
      assert.match(error.message,/TRANSPORT_FAILURE/);assert.equal(error.cause,undefined);return true;
    });
    assert.equal(frames.join('').includes('PRIVATE'),false);
  }finally{client.close();await server.close();}
});

test('legacy artifact refusal remains a failure, never a successful installation',async()=>{
  const [parent,child]=duplexPair(),client=artifacts.artifactClient(child);
  try{const pending=assert.rejects(client.request({}),/failed or was refused/);parent.write('{"id":1,"ok":false}\n');await pending;}
  finally{client.close();parent.destroy();}
});

test('unrecognised artifact failure metadata retires the channel without exposing it',async()=>{
  for(const error of [
    {version:2,stage:'METADATA',category:'POLICY',codes:[]},
    {version:1,stage:'PRIVATE',category:'POLICY',codes:[]},
    {version:1,stage:'METADATA',category:'POLICY',codes:['PRIVATE']},
    {version:1,stage:'METADATA',category:'POLICY',codes:[],url:'PRIVATE'},
  ]){
    const [parent,child]=duplexPair(),client=artifacts.artifactClient(child);
    try{
      const pending=assert.rejects(client.request({}),failure=>!failure.message.includes('PRIVATE'));
      parent.write(JSON.stringify({id:1,ok:false,error})+'\n');await pending;
      await assert.rejects(client.request({}),/unavailable/);
    }finally{client.close();parent.destroy();}
  }
});
