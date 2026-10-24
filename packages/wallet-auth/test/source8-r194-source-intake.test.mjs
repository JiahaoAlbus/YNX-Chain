import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{createHash}from'node:crypto';
const root=new URL('../',import.meta.url);
const pins={
 'src/product-session-gateway.js':'d9fa0a06416ae1a4e7ea50018289843394785cc9ba441cc4862bcca2e5003195',
 'src/product-session-gateway-http.js':'cced8361e116eb111ae28848bb10ac45128129ae69898755aa09ae67f7c0e432',
 'src/product-session-gateway-node-host.js':'b252ef02eeb2e3dce045608f66e891d3da0bffc3bbf6c1c1699051429ba8642a',
 'src/original-auth-identity-source-current.js':'d4efda732d5cc21fc443926aa07be11ebb95c1d46d7d84939fc4c5544e79e759',
 'src/original-auth-source-current-v2.js':'e82f6612b691227f06dbed3c55c1dc553b6ebf10f49ff019a372b013a201009a',
 'native/original-developer-principal-data.mjs':'7e0748cb9ab85839843469c6dca087ed0a0bc5d4ffcde34a2d0bf12d8ac9aab3',
 'native/original-ide-publication-approval-contract.mjs':'c37462cbf7bdb9ee7b327f0d33e8712d3bbc7b6aa0ae43a39f7ca426c69e33f6',
 'native/original-ide-approval-state-head-data.mjs':'28aa4713d6e9792294976b5318abc87c9be89b11fdb4f5e2f22152a5eab81786',
 'native/original-ide-project-control-contract.mjs':'86bad0df3624396d12b5c66f0affb3820ce9cd15cf7a92ad59161693da545677'
};
test('canonical successor preserves frozen Auth production leaf bytes',()=>{for(const[f,h]of Object.entries(pins))assert.equal(createHash('sha256').update(readFileSync(new URL(f,root))).digest('hex'),h,f)});
test('required relative native JS closure is included without new public credential or DATA export',()=>{
 const p=JSON.parse(readFileSync(new URL('package.json',root)));
 for(const f of ['original-developer-principal-data.mjs','original-ide-project-control-contract.mjs','original-ide-approval-state-head-data.mjs','original-ide-publication-approval-contract.mjs'])assert.ok(p.files.includes('native/'+f),f);
 assert.equal(p.exports['./product-session-gateway-node-host'].import,'./src/product-session-gateway-node-host.js');
 for(const s of Object.keys(p.exports))assert.doesNotMatch(s,/credential|project-control|developer-principal/);
 assert.equal(p.version,'1.3.0-pq.3.32-auth.22'); // source-only successor; no republished Auth22 tarball.
});
