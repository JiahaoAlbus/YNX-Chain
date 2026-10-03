const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('original YNX artwork exact bytes and dimensions',()=>{
  const bytes=fs.readFileSync(path.join(root,'assets/ynx-logo.png'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'df071f540f21d54e92286fd709df5293187c269058850820adb11e7c5087c12d');
  assert.equal(bytes.readUInt32BE(16),798);
  assert.equal(bytes.readUInt32BE(20),420);
});
test('product logo contains the whole original image without shrinking',()=>{
  const source=read('src/YNXBrandLogo.tsx');
  assert.match(source,/resizeMode="contain"/);
  assert.match(source,/aspectRatio: 798 \/ 420/);
  assert.match(source,/flexShrink: 0/);
  assert.match(source,/accessibilityLabel="YNX"/);
});
test('main and settings own original brand; nested guest avoids duplicate artwork',()=>{
  assert.equal((read('App.tsx').match(/<YNXBrandLogo\/>/g)||[]).length,2);
  const guest=read('src/GuestExperience.tsx');
  assert.doesNotMatch(guest,/<YNXBrandLogo/);
  assert.match(guest,/<View style=\{g\.brand\}><View>/);
  assert.match(guest,/g\.wordmark\}>YNX/);
  assert.match(guest,/g\.product\}>CARD/);
});
test('wallet provider artwork remains separate from product branding',()=>{
  const guest=read('src/GuestExperience.tsx');
  assert.match(guest,/assets\/metamask-fox\.png/);
  assert.match(guest,/assets\/icon\.png/);
  assert.match(guest,/selectedWalletKind==="metamask"/);
  assert.match(guest,/YNX Wallet logo/);
});
