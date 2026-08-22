import assert from 'node:assert/strict';

const root='/opt/ynx/preflight/finance/artifacts';
const valid=name=>typeof name==='string'&&/^p0\d{3,}$/.test(name);
const authorize=(carrier,basename,stats)=>{
  assert.equal(carrier.startsWith(`${root}/`),true);
  const name=carrier.slice(root.length+1); assert.equal(valid(name),true);
  assert.equal(basename,'ynx-finance-7824af677dd0-linux-amd64-p0146.tar.gz');
  assert.deepEqual(stats,{carrier:'0:0:755:3',digest:'0:0:755:2',archive:'0:0:644:1'});
  return `${carrier}/sha256-d8dcd45174dd50c93ef45af7d10d36dc078d6f4982da08dc92b9470e8290a59d/${basename}`;
};
const stats={carrier:'0:0:755:3',digest:'0:0:755:2',archive:'0:0:644:1'};
assert.equal(authorize(`${root}/p0219`,'ynx-finance-7824af677dd0-linux-amd64-p0146.tar.gz',stats),`${root}/p0219/sha256-d8dcd45174dd50c93ef45af7d10d36dc078d6f4982da08dc92b9470e8290a59d/ynx-finance-7824af677dd0-linux-amd64-p0146.tar.gz`);
for(const value of [`${root}/sha256-d8dcd45174dd50c93ef45af7d10d36dc078d6f4982da08dc92b9470e8290a59d`,`${root}/p0219/sibling`,`${root}/../p0219`,`/tmp/p0219`])assert.throws(()=>authorize(value,'ynx-finance-7824af677dd0-linux-amd64-p0146.tar.gz',stats));
assert.throws(()=>authorize(`${root}/p0219`,'other.tar.gz',stats));
for(const key of Object.keys(stats))assert.throws(()=>authorize(`${root}/p0219`,'ynx-finance-7824af677dd0-linux-amd64-p0146.tar.gz',{...stats,[key]:'0:0:755:1'}));
console.log('finance carrier authorization regression: pass');
