import assert from 'node:assert/strict';

const root='/opt/ynx/preflight/finance/artifacts';
const valid=name=>typeof name==='string'&&/^p0\d{3,}$/.test(name);
const authorize=(carrier,basename)=>{
  assert.equal(carrier.startsWith(`${root}/`),true);
  const name=carrier.slice(root.length+1); assert.equal(valid(name),true);
  assert.equal(basename,'ynx-finance-7824af677dd0-linux-amd64-p0146.tar.gz');
  return `${carrier}/sha256-d8dcd45174dd50c93ef45af7d10d36dc078d6f4982da08dc92b9470e8290a59d/${basename}`;
};
assert.equal(authorize(`${root}/p0219`,'ynx-finance-7824af677dd0-linux-amd64-p0146.tar.gz'),`${root}/p0219/sha256-d8dcd45174dd50c93ef45af7d10d36dc078d6f4982da08dc92b9470e8290a59d/ynx-finance-7824af677dd0-linux-amd64-p0146.tar.gz`);
for(const value of [`${root}/sha256-d8dcd45174dd50c93ef45af7d10d36dc078d6f4982da08dc92b9470e8290a59d`,`${root}/p0219/sibling`,`${root}/../p0219`,`/tmp/p0219`])assert.throws(()=>authorize(value,'ynx-finance-7824af677dd0-linux-amd64-p0146.tar.gz'));
assert.throws(()=>authorize(`${root}/p0219`,'other.tar.gz'));
console.log('finance carrier authorization regression: pass');
