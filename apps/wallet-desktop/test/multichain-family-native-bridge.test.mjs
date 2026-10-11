import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';
import {PasswordWalletVault} from '../src/password-wallet-vault.mjs';
import {createMnemonicFamilyAccounts} from '../src/multichain-family-accounts.mjs';
import {FamilyRead} from '../src/multichain-family-read.mjs';
import {FamilyNetworks} from '../src/multichain-family-networks.mjs';
import {BitcoinReadAdapter} from '../src/multichain-bitcoin.mjs';
import {TronReadAdapter, tronAddress} from '../src/multichain-tron.mjs';
const PUBLIC_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PUBLIC_PASSWORD = 'PUBLIC fixture only password 2026';
async function fixture(t, mnemonic = true) {
  const directory = await mkdtemp(path.join(tmpdir(), 'ynx-family-native-public-'));
  const filePath = path.join(directory, 'wallet-vault-v3.json');
  const life = new DesktopKeyLifecycle(); life.setFocused(true); t.after(() => life.lock());
  const vault = new PasswordWalletVault({filePath, authorization: life}); life.authorizer = vault.authorizer();
  await life.custody(guard => vault.setup({password: PUBLIC_PASSWORD, confirmation: PUBLIC_PASSWORD}, guard)); await life.unlock({password: PUBLIC_PASSWORD});
  const status = await life.run(() => vault.importAccount(mnemonic ? {kind: 'recovery-phrase', value: PUBLIC_PHRASE} : {kind: 'private-key', value: '1'.padStart(64, '0')}));
  life.setAccount(status.account); await life.unlock({password: PUBLIC_PASSWORD});
  const service = createMnemonicFamilyAccounts({vault, getContext: async () => ({account: (await vault.status()).account, ...life.status()})});
  return {filePath, life, vault, service};
}
test('actual parent vault plus combined dependency runtime derive BTC and TRON via production public bridge', async t => {
  const f = await fixture(t), before = await readFile(f.filePath);
  const btc = await f.life.run(() => f.service.account({family: 'bitcoin', network: 'mainnet'}));
  const tron = await f.life.run(() => f.service.account({family: 'tron', network: 'nile'}));
  assert.equal(btc.address, 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'); assert.equal(btc.path, "m/84'/0'/0'/0/0");
  assert.equal(tron.address, 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH'); assert.equal(tron.path, "m/44'/195'/0'/0/0");
  assert.notEqual(btc.address, btc.vaultAccount); assert.equal(btc.vaultAccount, tron.vaultAccount); assert.equal(tron.networkVerified, false);
  assert.equal(JSON.stringify([btc, tron]).includes(PUBLIC_PHRASE), false); assert.deepEqual(await readFile(f.filePath), before);
});
test('actual original vault post-action focus gate rejects newly derived public output without changing account', async t => {
  const f = await fixture(t), before = await readFile(f.filePath), original = f.vault.withMnemonic.bind(f.vault);
  f.vault.withMnemonic = (action, permission) => original((...args) => {const result = action(...args); f.life.setFocused(false); return result;}, permission);
  await assert.rejects(f.life.run(() => f.service.account({family: 'bitcoin', network: 'testnet4'})));
  assert.equal(f.life.status().locked, true); assert.deepEqual(await readFile(f.filePath), before);
});
test('actual private-key-only parent account reports mnemonic unavailable for both families', async t => {
  const f = await fixture(t, false), before = await readFile(f.filePath);
  for (const family of ['bitcoin', 'tron']) await assert.rejects(f.life.run(() => f.service.account({family, network: 'mainnet'})), error => error.data?.code === 'MNEMONIC_NOT_AVAILABLE');
  assert.deepEqual(await readFile(f.filePath), before);
});
test('production public accounts and actual adapters compose with synthetic chain responses without balance rounding', async t => {
  const f = await fixture(t), before = await readFile(f.filePath);
  const networks = new FamilyNetworks({filePath: path.join(path.dirname(f.filePath), 'family-networks.json')});
  const genesis = '00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043';
  const tronGenesis = 'a'.repeat(64); let reads = 0;
  const service = new FamilyRead({networks, accounts: f.service, getContext: async () => ({account: (await f.vault.status()).account, ...f.life.status()}), createAdapter: async n => n.family === 'bitcoin'
    ? new BitcoinReadAdapter({network: n.network, request: async ({path: route}) => {reads++; if (route === '/block-height/0') return genesis; if (route.endsWith('/utxo')) return [{txid: 'b'.repeat(64), vout: 0, value: 123456789, status: {confirmed: true, block_height: 42, block_hash: 'c'.repeat(64)}}]; throw Error('Unexpected route');}})
    : new TronReadAdapter({network: {id: n.network, genesisBlockId: n.genesis}, transport: async (_network, route, body) => {reads++; if (route === '/wallet/getblockbynum') return {blockID: tronGenesis, block_header: {raw_data: {number: 0}}}; if (route === '/wallet/getaccount') return {address: tronAddress(body.address).hex, balance: '1234567'}; throw Error('Unexpected route');}})});
  await service.configure({family: 'bitcoin', network: 'testnet4', rpcUrl: 'https://public.example/api', genesis: null});
  await service.configure({family: 'tron', network: 'nile', rpcUrl: 'https://public.example', genesis: tronGenesis});
  const btc = await f.life.run(() => service.balances({family: 'bitcoin', network: 'testnet4'}));
  const trx = await f.life.run(() => service.balances({family: 'tron', network: 'nile'}));
  assert.equal(btc.assets[0].display, '1.23456789'); assert.equal(trx.assets[0].display, '1.234567');
  assert.equal(btc.assets[0].verification, 'provider-reported-not-spv'); assert.ok(reads > 0); assert.deepEqual(await readFile(f.filePath), before);
});
