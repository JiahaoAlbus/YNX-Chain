import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {FamilyNetworks} from '../src/multichain-family-networks.mjs';
import {FamilyRead} from '../src/multichain-family-read.mjs';
const btc = {family: 'bitcoin', network: 'testnet4', rpcUrl: 'https://public.example/api', genesis: null};
const tron = {family: 'tron', network: 'nile', rpcUrl: 'https://public.example', genesis: 'a'.repeat(64)};
async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'ynx-family-read-public-')), filePath = path.join(dir, 'networks.json'), networks = new FamilyNetworks({filePath});
  let context = {account: 'PUBLIC-base', revision: 1, locked: false};
  const service = new FamilyRead({networks, accounts: {account: async () => ({address: 'PUBLIC-address'})}, getContext: async () => context, createAdapter: async () => ({verify: async () => true, readAddress: async () => ({confirmedSats: '123456789', unconfirmedSats: '1'}), balance: async () => ({sun: '1234567', activated: true})})});
  return {service, networks, filePath, change: value => {context = {...context, ...value};}};
}
test('verified settings persist separately and native balances keep exact BTC/TRX decimals', async () => {const f = await fixture(); await f.service.configure(btc); await f.service.configure(tron); const reopened = new FamilyNetworks({filePath: f.filePath}); assert.equal((await reopened.read()).networks.length, 2); assert.equal((await f.service.balances({family: 'bitcoin', network: 'testnet4'})).assets[0].display, '1.23456789'); const trx = (await f.service.balances({family: 'tron', network: 'nile'})).assets[0]; assert.equal(trx.display, '1.234567'); assert.equal(trx.verification, 'provider-reported-not-consensus');});
test('failed genesis verification never saves settings or returns synthetic zero balance', async () => {const f = await fixture(); f.service.createAdapter = async () => ({verify: async () => {throw Error('PUBLIC wrong genesis');}}); await assert.rejects(f.service.configure(tron)); assert.equal((await f.networks.read()).networks.length, 0); await assert.rejects(f.service.balances({family: 'tron', network: 'nile'}), {code: 'FAMILY_NETWORK_REQUIRED'});});
test('network/account change during awaited balance prevents stale result', async () => {const f = await fixture(); await f.service.configure(btc); f.service.createAdapter = async () => ({readAddress: async () => {f.change({revision: 2}); return {confirmedSats: '0', unconfirmedSats: '0'};}}); await assert.rejects(f.service.balances({family: 'bitcoin', network: 'testnet4'}), {code: 'MULTICHAIN_CONTEXT_CHANGED'});});
test('private URLs, unknown chains and invalid genesis leave old settings unchanged', async () => {const f = await fixture(); await f.service.configure(btc); const before = await readFile(f.filePath, 'utf8'); for (const bad of [{...btc, rpcUrl: 'https://127.0.0.1'}, {...tron, genesis: '0'.repeat(64)}, {...btc, network: 'unknown'}]) await assert.rejects(f.service.configure(bad)); assert.equal(await readFile(f.filePath, 'utf8'), before);});
test('configuration revision compare rejects stale concurrent save', async () => {const f = await fixture(); await f.networks.put(btc, 0); await assert.rejects(f.networks.put(tron, 0), {code: 'MULTICHAIN_CONTEXT_CHANGED'}); assert.equal((await f.networks.read()).networks.length, 1);});
