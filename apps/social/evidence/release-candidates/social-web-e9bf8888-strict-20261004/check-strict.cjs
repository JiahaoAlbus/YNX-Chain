const fs=require('node:fs'),crypto=require('node:crypto'),zlib=require('node:zlib'),path=require('node:path');
const root=__dirname,manifestRaw=fs.readFileSync(path.join(root,'original-source-manifest.json')),manifest=JSON.parse(manifestRaw);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const archive=fs.readFileSync(path.join(root,'social-web-deploy-strict.tgz')),tar=zlib.gunzipSync(archive);
const expected=new Map(manifest.files.map(f=>[f.path,f]));expected.set('artifact-files.json',{bytes:manifestRaw.length,sha256:sha(manifestRaw)});
const seen=new Set(),entries=[];let offset=0;
const text=b=>b.toString('utf8').replace(/\0.*$/s,'');
while(offset+512<=tar.length){const h=tar.subarray(offset,offset+512);if(h.every(b=>b===0)){if(!tar.subarray(offset).every(b=>b===0))throw Error('Nonzero archive tail');break}
if(h.toString('ascii',257,263)!=='ustar\0'||h.toString('ascii',263,265)!=='00')throw Error('Non-USTAR header');
let checksum=0;for(let n=0;n<512;n++)checksum+=n>=148&&n<156?32:h[n];if(checksum!==parseInt(text(h.subarray(148,156)).trim(),8))throw Error('Invalid header checksum');
const prefix=text(h.subarray(345,500)),name=(prefix?prefix+'/':'')+text(h.subarray(0,100));
if(name.startsWith('/')||name.split('/').some(p=>p==='..'||p.startsWith('._'))||seen.has(name))throw Error('Unsafe or duplicate path');
if(![0,48].includes(h[156])||text(h.subarray(157,257)))throw Error('Nonregular/PAX/link entry');
const count=parseInt(text(h.subarray(124,136)).trim(),8),file=expected.get(name);if(!Number.isSafeInteger(count)||count<0||offset+512+count>tar.length||!file)throw Error('Unexpected entry');
const bytes=tar.subarray(offset+512,offset+512+count);if(count!==file.bytes||sha(bytes)!==file.sha256)throw Error('Byte mismatch: '+name);
seen.add(name);entries.push({path:name,bytes:count,sha256:sha(bytes)});offset+=512+Math.ceil(count/512)*512;
}
if(seen.size!==31||seen.size!==expected.size)throw Error('Incomplete exact inventory');
const result={source:manifest.source,archiveBytes:archive.length,archiveSHA256:sha(archive),originalManifestSHA256:sha(manifestRaw),physicalRegularEntries:entries.length,metadataEntries:0,byteMismatches:0,entries,scope:'Original e9 file bytes only; A routing contract, publication, public acceptance and full Social are not verified'};
console.log(JSON.stringify(result,null,2));
