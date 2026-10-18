import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {FileTransactionIntentStore} from '../../transaction-intent-store.mjs';
import {DesktopKeyLifecycle} from '../../key-lifecycle.mjs';
import {createPQOriginalRecord} from '../../wallet-pq-intent-record.mjs';
import {preparePQTransferTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {createPQTransactionSubmission} from './submission.mjs';

// The runner supplies the actual frozen R95 factory and its original PUBLIC
// Electron/borrow fixture. This is not real installed IPC or user approval.
export function registerPQAuthFactoryCustodyTests({auth, createPUBLICPeer, brandPUBLICBorrow, expectedURL}) {
  const vector = JSON.parse(gunzipSync(readFileSync(new URL('../../../test/fixtures/pq-public-http-af1cbaf.json.gz', import.meta.url)), {maxOutputLength:8 * 1024 * 1024}));
  const wire = vector.originals.find(row => row.name === 'transfer-lost-response').wire;
  const account = vector.owner, networkId = vector.networkId;
  const original = createPQOriginalRecord({account, kind:'pq-transfer', operationId:'QA-factory-custody-original', request:preparePQTransferTransport(Buffer.from(wire,'base64'))});

  async function fixture(t, closeFailure = null) {
    const directory = await fs.mkdtemp(path.join(tmpdir(),'ynx-pq-factory-custody-'));
    t.after(() => fs.rm(directory,{recursive:true,force:true}));
    const filePath = path.join(directory,'journal.json'), store = new FileTransactionIntentStore({filePath});
    await store.reserveOriginal(account,'pq-transfer'); store.captureOriginal(account,original,'pq-transfer');
    await store.saveOriginal(account,original.hash,()=>{});
    const lifecycle = new DesktopKeyLifecycle({authorizer:{available:()=>true,authenticate:async()=>{},inProcess:true},focused:()=>true,schedule:()=>null,unschedule:()=>{}});
    lifecycle.setAccount(account); await lifecycle.unlock(); t.after(() => lifecycle.lock());
    const peer = createPUBLICPeer(expectedURL), counts = {acquire:0,read:0,retire:0,join:0,close:0,post:0};
    const borrow = brandPUBLICBorrow({
      readApprovalIdentity:()=>({reviewId:'QA-fresh-broadcast-review',operationId:original.operationId,action:'broadcast'}),
      readOriginal(){counts.read++; throw Error('QA_REVOKED_PEER_MUST_NOT_READ');},
      assertCurrent(){}, async recheck(){}, enterOriginal(){}, completeOriginal(){}, assertCompletedCurrent(){},
      retire(){counts.retire++;}, async join(){counts.join++;},
      async close(){counts.close++; if(closeFailure) throw closeFailure;},
    });
    const capsule = auth.captureOriginalWalletTransactionApprovalIPC(peer.event,'QA-fresh-broadcast-review','broadcast');
    peer.sender.emit('did-start-navigation');
    const controller = createPQTransactionSubmission({intentStore:store,networkId,
      acquireOriginalWalletTransactionPermission:request=>{counts.acquire++; return auth.acquireOriginalWalletTransactionPermission(request,capsule,borrow);},
      isOriginalWalletTransactionPermission:auth.isOriginalWalletTransactionPermission,
      transport:{async submitTransfer(){counts.post++; throw Error('QA_EARLY_FAILURE_MUST_NOT_POST');}},
    });
    return {filePath,store,lifecycle,controller,peer,counts};
  }

  test('actual R95 factory partial is cleaned by the existing consumer after early peer revocation, before journal mutation or POST',async t=>{
    const f=await fixture(t),before=await fs.readFile(f.filePath,'utf8');
    await assert.rejects(f.lifecycle.run(guard=>f.controller.broadcast(original.hash,guard)),error=>{
      assert.equal(error.code,'AUTH_WALLET_TRANSACTION_PERMISSION_NOT_SUPPLIED');
      assert.equal(error.cause.code,'AUTH_TX_APPROVAL_PEER_REVOKED'); return true;
    });
    assert.deepEqual(f.counts,{acquire:1,read:0,retire:1,join:1,close:1,post:0});
    assert.equal(f.peer.sender.listenerCount('destroyed'),0);
    assert.equal(await fs.readFile(f.filePath,'utf8'),before);
    assert.equal((await new FileTransactionIntentStore({filePath:f.filePath}).readPQProgress(account,original.hash,()=>{})).status,'signed-unsubmitted');
    assert.equal(f.controller.assertSafeToClose(),undefined);
  });

  test('actual R95 early partial cleanup failure retains original first cause and singleton debt, fencing further acquisition and POST',async t=>{
    const cleanupFailure=Error('QA_FOREIGN_CLOSE_UNKNOWN'),f=await fixture(t,cleanupFailure),before=await fs.readFile(f.filePath,'utf8');
    await assert.rejects(f.lifecycle.run(guard=>f.controller.broadcast(original.hash,guard)),error=>{
      assert.equal(error.code,'AUTH_WALLET_TRANSACTION_PERMISSION_NOT_SUPPLIED');
      assert.equal(error.cause.code,'AUTH_TX_APPROVAL_PEER_REVOKED');
      assert.equal(error.partial.outcome().cleanupCause,cleanupFailure); return true;
    });
    await assert.rejects(f.lifecycle.run(guard=>f.controller.broadcast(original.hash,guard)),{code:'PQ_TRANSACTION_CLEANUP_PENDING'});
    assert.deepEqual(f.counts,{acquire:1,read:0,retire:1,join:1,close:1,post:0});
    assert.equal(f.peer.sender.listenerCount('destroyed'),0);
    assert.equal(await fs.readFile(f.filePath,'utf8'),before);
    assert.throws(()=>f.controller.assertSafeToClose(),{code:'PQ_TRANSACTION_CLEANUP_PENDING'});
  });
}
