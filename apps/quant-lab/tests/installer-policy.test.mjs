import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));

test('current public product metadata withholds legacy ZIP downloads',async()=>{
  const [release,metadata]=await Promise.all(['product-release.json','public-product-metadata.json'].map(async file=>JSON.parse(await readFile(root+file,'utf8'))));
  assert.equal(release.deployedPublic,false);
  assert.equal(release.downloadHosted,false);
  assert.deepEqual(release.publicUrls,[]);
  assert.deepEqual(metadata.downloads,[]);
  assert.match(metadata.websiteHandoffState,/WITHDRAW_LEGACY_ZIP_DOWNLOADS/);
  for(const item of release.artifacts)assert.doesNotMatch(item.url??item.name,/\.zip$/i);
  assert.equal(release.withheldLegacyDownloads?.length,2);
});
