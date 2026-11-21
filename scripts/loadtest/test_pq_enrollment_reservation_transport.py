"""Real Unix FD/SQLite controls; synthetic children are NOT a Core signer."""
import base64
import copy
import importlib.util
import json
import os
from pathlib import Path
import socket
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock


spec=importlib.util.spec_from_file_location('reservation_transport',Path(__file__).with_name('pq-enrollment-reservation-transport.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
raw=m.original.canonical;sha=m.b.sha


class EnrollmentReservationTransportControls(unittest.TestCase):
    def setUp(self):
        self.base=Path(tempfile.mkdtemp()).resolve();self.retain_originals=False
        self.addCleanup(lambda:None if self.retain_originals else shutil.rmtree(self.base))
        self.root=self.base/'original';self.root.mkdir(mode=0o700)
        (self.root/'workload').mkdir(mode=0o700)
        self.source=m.INSPECTED_SYNTHETIC_HANDSHAKE
        self.plan=dict(version='YNX-PQ-LOOPBACK-NETWORK/v1',syntheticOnly=True,publicNetwork=False,
            rootDir=str(self.root),nativeChainId='642399',originalGenesisHash='a'*64,migrationStateHash='b'*64)
        self.workload=dict(version='YNX-PQ-LOOPBACK-WORKLOAD/v1',syntheticOnly=True,networkStarted=False,
            deployedSourceQualification=False,authorityGranted=False,mode='online',nativeChainId='642399',
            originalGenesisHash='a'*64,migrationStateHash='b'*64,ownerCapacity='5',totalMemberCapacity='500',
            batchSize='1',outstandingPerOwner='1',batchWaitNanoseconds='0',transactions=None,
            owners=[dict(index=i,owner='UNIT-OWNER-'+str(i),initialNonce='1',memberCapacity='100') for i in range(5)])
        self.persist();self.instances=0

    def persist(self):
        for name,value in (('network-plan.json',self.plan),('workload/PUBLIC-WORKLOAD.json',self.workload)):
            path=self.root/name;path.write_bytes(raw(value));path.chmod(0o600)
        self.plan_pin=sha(raw(self.plan));self.workload_pin=sha(raw(self.workload))

    def pins(self):return m.PinnedOriginals(self.root,self.source,self.plan_pin,self.workload_pin)

    def case(self,*,timeout=2,stop=None,guard=lambda:None):
        self.instances+=1;pins=self.pins();folder=self.base/('case-'+str(self.instances));folder.mkdir(mode=0o700)
        ledger=m.d.DurableLedger(pins.plan(),folder/'original.sqlite',lambda event:None,guard,enabled=True)
        self.addCleanup(ledger.close)
        transcript=m.PrivateTranscript(folder/'frames');self.addCleanup(transcript.close)
        parent,child=socket.socketpair();self.addCleanup(parent.close);self.addCleanup(child.close)
        exchange=m.ReservationExchange(parent,ledger,pins,transcript,timeout=timeout,stop=stop,enabled=True)
        ready=dict(version=m.PREFIX+'READY/v1',sourceCommit=self.source,root=str(self.root),
            planPath=str(pins.plan_path),planSHA256=self.plan_pin,workloadPath=str(pins.workload_path),
            workloadSHA256=self.workload_pin,ownerIndex=4,ownerAddress=pins.owner['address'],nextNonce='2')
        return exchange,child,ready

    def child(self,sock,ready,*,before='',request_change='',after='',ready_raw=None):
        # Consume the actual inherited FD and INIT. All keys/wires below are
        # deliberately invalid controls; the marker means ACK observed only.
        body='''import socket,os,sys,json,base64
s=socket.socket(fileno=int(sys.argv[1]));s.settimeout(3)
def enc(v):return json.dumps(v,separators=(',',':')).encode()+b'\\n'
def line():
 b=bytearray()
 while not b.endswith(b'\\n'):
  part=s.recv(1)
  if not part:raise EOFError('parent closed without ACK')
  b.extend(part)
 return json.loads(b)
'''
        body+=before+'\ns.sendall('+repr(ready_raw or m.frame('READY',ready))+')\ni=line()\n'
        body+="r=dict(version='YNX-PQ-LAB-ENROLLMENT-REQUEST/v1',fundingOperationId=i['fundingOperationId'],migrationOperationId='c'*64,ownerIndex=i['ownerIndex'],fundingNonce=i['fundingNonce'],targetOwner='UNIT-TARGET',fundingAmount='3',activationHeight='9',pka=base64.b64encode(b'a'*2592).decode(),pkb=base64.b64encode(b'b'*64).decode())\n"
        body+='import hashlib\n'+request_change+'\n'
        body+="f=dict(version='YNX-PQ-ENROLLMENT-RESERVE-REQUEST/v1',sourceCommit=i['sourceCommit'],index=i['index'],planSHA256="+repr(self.plan_pin)+",workloadSHA256="+repr(self.workload_pin)+",requestSHA256=hashlib.sha256(enc(r)[:-1]).hexdigest(),request=r)\ns.sendall(enc(f))\n"
        body+=after or "a=line()\nassert a['requestSHA256']==f['requestSHA256']\nassert a['fundingOperationId']==r['fundingOperationId'] and a['migrationOperationId']==r['migrationOperationId']\nassert a['signingAuthorized'] is False and a['nonceReleased'] is False and a['automaticRetry'] is False\nprint('CONTROL_ACK_OBSERVED',flush=True)\n"
        process=subprocess.Popen([sys.executable,'-B','-c',body,str(sock.fileno())],pass_fds=(sock.fileno(),),
            stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,close_fds=True)
        sock.close()
        def retire():
            if process.poll() is None:process.kill()
            process.communicate(timeout=2)
        self.addCleanup(retire);return process

    def assert_pending(self,exchange):
        self.assertEqual(exchange.ledger.audit()['originalPending'][0]['pending'],0)
        self.assertEqual(exchange.ledger.audit()['originalPending'][0]['nextNonce'],2)
        with self.assertRaises(ValueError):exchange.ledger.reserve(100_000_000)

    def test_real_child_ack_follows_full_pair_and_complete_denominator_stays_pending(self):
        exchange,peer,ready=self.case();child=self.child(peer,ready)
        out=exchange.run();stdout,stderr=child.communicate(timeout=3)
        self.assertEqual((child.returncode,stderr),(0,b''));self.assertEqual(stdout,b'CONTROL_ACK_OBSERVED\n')
        self.assertIsNone(out['firstCause']);self.assertTrue(out['reservationReturnObserved'] and out['ackSendCompleted'])
        self.assertFalse(out['ackReceiptObserved'] or out['signingObserved'] or out['signingAuthorized'] or out['nonceReleased'])
        self.assertEqual((exchange.ledger.audit()['configuredDemand'],exchange.ledger.next_release),(100,1))
        self.assertEqual(exchange.ledger.row(99)['status'],'not_released');self.assert_pending(exchange)
        ids=dict(exchange.ledger.db.execute('SELECT role,operation_id FROM enrollment_ids'))
        self.assertEqual(ids,dict(funding=out['fundingOperationId'],migration=out['migrationOperationId']))
        self.assertEqual(set(p.name for p in exchange.transcript.path.iterdir()),
                         {'ready.jsonl','init.jsonl','request.jsonl','ack-intent.jsonl','result.json'})
        self.assertGreater(out['reservationDurabilityElapsedNs'],0)

    def test_default_normal_source_gate_cannot_create_socket_or_process(self):
        with mock.patch.object(m.socket,'socketpair',side_effect=AssertionError('no socket')), \
             mock.patch('subprocess.Popen',side_effect=AssertionError('no producer')):
            out=m.normal_reservation(enabled=True,binary='/caller-supplied',source=self.source)
        self.assertIsNone(m.NORMAL_RESERVATION_PRODUCER);self.assertTrue(out['missingEvidence'])
        self.assertFalse(out['ackSendCompleted']);self.assertEqual(out['status'],'UNKNOWN')

    def test_independent_pins_and_original_capacity_scope_are_not_supplied_by_ready(self):
        with self.assertRaisesRegex(ValueError,'file SHA'):m.PinnedOriginals(self.root,self.source,'f'*64,self.workload_pin)
        for change in ({'memberCapacity':'99'},{'index':True},{'initialNonce':'2'}):
            saved=copy.deepcopy(self.workload);self.workload['owners'][4].update(change);self.persist()
            with self.assertRaises(ValueError):self.pins()
            self.workload=saved;self.persist()
        self.plan['publicNetwork']=True;self.persist()
        with self.assertRaises(ValueError):self.pins()

    def test_wrong_ready_source_owner_nonce_or_extra_field_cannot_reserve(self):
        for changes in ({'sourceCommit':'f'*40},{'ownerIndex':True},{'nextNonce':'3'},{'planSHA256':'f'*64}):
            exchange,peer,ready=self.case();ready.update(changes);peer.sendall(m.frame('READY',ready))
            out=exchange.run();self.assertEqual(out['initBytesSent'],0);self.assertEqual(exchange.ledger.audit()['claimed'],0)
            self.assertIsNotNone(out['firstCause'])
        exchange,peer,ready=self.case();ready['authorityGranted']=True;peer.sendall(raw(ready)+b'\n')
        out=exchange.run();self.assertEqual(out['initBytesSent'],0)

    def test_duplicate_noncanonical_and_truncated_frames_preserve_raw_rejection(self):
        for original in (b'{"version":',b'{"version":"x","version":"y"}\n',b'{}\r\n'):
            exchange,peer,_=self.case();peer.sendall(original);peer.shutdown(socket.SHUT_WR)
            out=exchange.run();self.assertIsNotNone(out['firstCause']);self.assertEqual(out['initBytesSent'],0)
            self.assertEqual((exchange.transcript.path/'ready.jsonl').read_bytes(),original)

    def test_oversized_original_frame_retains_bounded_prefix_without_ack(self):
        exchange,peer,ready=self.case()
        child=self.child(peer,ready,ready_raw=b'x'*(m.FRAME_LIMIT+1))
        out=exchange.run();child.communicate(timeout=3)
        self.assertFalse(out['ackSendCompleted']);self.assertTrue(out['frameReadTruncated'])
        self.assertEqual((exchange.transcript.path/'ready.jsonl').stat().st_size,m.FRAME_LIMIT)

    def test_wrong_request_nonce_id_or_target_never_gets_ack(self):
        for change in ("r['fundingNonce']='3'","r['fundingOperationId']='e'*64","r['targetOwner']='UNIT-OWNER-4'"):
            exchange,peer,ready=self.case();child=self.child(peer,ready,request_change=change)
            out=exchange.run();stdout,_=child.communicate(timeout=3)
            self.assertEqual(out['ackBytesSent'],0);self.assertNotIn(b'CONTROL_ACK_OBSERVED',stdout);self.assert_pending(exchange)

    def test_cancel_after_durable_return_prevents_ack_and_preserves_both_ids(self):
        stop=threading.Event();exchange,peer,ready=self.case(stop=stop);child=self.child(peer,ready)
        prepare=exchange.ledger.prepare_enrollment_pair
        def cancelled(*args,**kwargs):
            value=prepare(*args,**kwargs);stop.set();return value
        with mock.patch.object(exchange.ledger,'prepare_enrollment_pair',side_effect=cancelled):out=exchange.run()
        child.communicate(timeout=3);self.assertEqual(out['firstCause']['type'],'InterruptedError')
        self.assertTrue(out['reservationReturnObserved']);self.assertEqual(out['ackBytesSent'],0)
        self.assertEqual(exchange.ledger.db.execute('SELECT count(*) FROM enrollment_ids').fetchone()[0],2)
        self.assert_pending(exchange)

    def test_post_commit_directory_fsync_failure_cannot_send_ack_or_reconstruct_return(self):
        exchange,peer,ready=self.case();child=self.child(peer,ready);prepare=exchange.ledger.prepare_enrollment_pair
        def failure(*args,**kwargs):
            with mock.patch.object(m.d.os,'fsync',side_effect=OSError('UNIT pair directory fsync failed')):
                return prepare(*args,**kwargs)
        with mock.patch.object(exchange.ledger,'prepare_enrollment_pair',side_effect=failure):out=exchange.run()
        child.communicate(timeout=3);self.assertFalse(out['reservationReturnObserved']);self.assertEqual(out['ackBytesSent'],0)
        request=exchange.ledger.db.execute('SELECT request_sha256 FROM enrollment_pairs').fetchone()[0]
        path=exchange.ledger.path;plan=exchange.ledger.plan;pin=exchange.ledger.plan_sha256;exchange.ledger.close()
        reopened=m.d.open_readonly(path,plan,pin);self.addCleanup(reopened.close)
        observed=reopened.read_enrollment_pair(0,request)
        self.assertFalse(observed['durabilityReturnObserved'] or observed['signingAuthorized'] or observed['nonceReleased'])
        with self.assertRaisesRegex(ValueError,'cannot be retried'):exchange.run()

    def test_original_guard_failure_after_full_reservation_blocks_ack(self):
        exchange,peer,ready=self.case();child=self.child(peer,ready);prepare=exchange.ledger.prepare_enrollment_pair
        def failure(*args,**kwargs):
            value=prepare(*args,**kwargs)
            exchange.ledger.check_resources=mock.Mock(side_effect=RuntimeError('UNIT original owned RSS exceeded'))
            return value
        with mock.patch.object(exchange.ledger,'prepare_enrollment_pair',side_effect=failure):out=exchange.run()
        child.communicate(timeout=3);self.assertEqual(out['ackBytesSent'],0)
        self.assertIn('owned RSS',out['firstCause']['message']);self.assert_pending(exchange)

    def test_ack_lost_or_partial_send_is_unknown_and_never_retried(self):
        exchange,peer,ready=self.case();child=self.child(peer,ready);send=exchange.send
        def broken(raw_frame,key):
            if key=='ackBytesSent':
                n=exchange.peer.send(raw_frame[:17]);exchange.out[key]=n
                raise BrokenPipeError('UNIT ACK delivery unknown')
            return send(raw_frame,key)
        with mock.patch.object(exchange,'send',side_effect=broken):out=exchange.run()
        child.communicate(timeout=3);self.assertEqual(out['ackBytesSent'],17);self.assertFalse(out['ackSendCompleted'])
        self.assertTrue(out['reservationReturnObserved']);self.assert_pending(exchange)
        with self.assertRaisesRegex(ValueError,'cannot be retried'):exchange.run()

    def test_timeout_cancel_and_child_exit_before_request_keep_original_claim(self):
        exchange,peer,ready=self.case(timeout=.05);out=exchange.run()
        self.assertEqual(out['firstCause']['type'],'TimeoutError');self.assertEqual(exchange.ledger.audit()['claimed'],0)
        stop=threading.Event();stop.set();exchange,peer,ready=self.case(stop=stop);out=exchange.run()
        self.assertEqual(out['firstCause']['type'],'InterruptedError')
        exchange,peer,ready=self.case();child=self.child(peer,ready,request_change='sys.exit(7)')
        out=exchange.run();child.communicate(timeout=3)
        self.assertEqual(out['firstCause']['type'],'EOFError');self.assert_pending(exchange)

    def test_pinned_file_change_before_ack_fails_with_original_request_retained(self):
        exchange,peer,ready=self.case();child=self.child(peer,ready);prepare=exchange.ledger.prepare_enrollment_pair
        def changed(*args,**kwargs):
            value=prepare(*args,**kwargs);exchange.pins.plan_path.write_bytes(b'changed');return value
        with mock.patch.object(exchange.ledger,'prepare_enrollment_pair',side_effect=changed):out=exchange.run()
        child.communicate(timeout=3);self.assertTrue(out['reservationReturnObserved']);self.assertEqual(out['ackBytesSent'],0)
        self.assertIn('pinned bytes changed',out['firstCause']['message']);self.assert_pending(exchange)

    def test_transcript_failure_preserves_original_timeout_and_no_ack(self):
        exchange,peer,ready=self.case(timeout=.05)
        with mock.patch.object(exchange.transcript,'write',side_effect=OSError('UNIT original transcript failure')):out=exchange.run()
        self.assertEqual(out['firstCause']['type'],'TimeoutError');self.assertTrue(out['cleanupDebt'])
        self.assertFalse(out['originalFramesRetained'] or out['ackSendCompleted'])

    def test_existing_transcript_or_ledger_cannot_be_reused_and_socket_kind_is_strict(self):
        exchange,peer,ready=self.case()
        with self.assertRaises(FileExistsError):m.PrivateTranscript(exchange.transcript.path)
        a,b=socket.socketpair(type=socket.SOCK_DGRAM)
        try:
            with self.assertRaises(ValueError):m.ReservationExchange(a,exchange.ledger,exchange.pins,exchange.transcript,enabled=True)
        finally:a.close();b.close()
        exchange.ledger.close()
        with self.assertRaises(ValueError):m.ReservationExchange(exchange.peer,exchange.ledger,exchange.pins,exchange.transcript,enabled=True)

    def test_frame_open_failure_is_not_reported_retained_when_result_file_succeeds(self):
        for name in ('ready.jsonl','request.jsonl'):
            exchange,peer,ready=self.case();child=self.child(peer,ready);open_original=os.open;calls=[]
            def fail_open(path,*args,**kwargs):
                if path==name:calls.append(path);raise OSError('UNIT frame open failure')
                return open_original(path,*args,**kwargs)
            with mock.patch.object(m.os,'open',side_effect=fail_open):out=exchange.run()
            child.communicate(timeout=3)
            self.assertEqual(calls,[name]);self.assertFalse((exchange.transcript.path/name).exists())
            self.assertEqual(out['frameRetention'][name]['status'],'NOT_RETAINED')
            self.assertFalse(out['originalFramesRetained']);self.assertTrue(out['cleanupDebt'])
            self.assertEqual(out['ackBytesSent'],0);self.assertEqual(out['resultRetention']['status'],'RETAINED')
            stored=json.loads((exchange.transcript.path/'result.json').read_bytes())
            self.assertEqual(stored['originalFramesRetained'],out['originalFramesRetained'])
            self.assertEqual(stored['frameRetention'],out['frameRetention'])

    def test_partial_frame_write_and_barrier_failure_keep_original_files_unknown(self):
        for mode,name in (('short','ready.jsonl'),('fsync','request.jsonl'),('fsync','ack-intent.jsonl')):
            exchange,peer,ready=self.case();child=self.child(peer,ready);write=os.write;sync=os.fsync;hits=[]
            def matches(fd):
                path=exchange.transcript.path/name
                return path.exists() and (os.fstat(fd).st_dev,os.fstat(fd).st_ino)==(path.stat().st_dev,path.stat().st_ino)
            def short(fd,data):
                if mode=='short' and matches(fd):
                    if not hits:hits.append(fd);return write(fd,data[:7])
                    raise OSError('UNIT partial frame write failure')
                return write(fd,data)
            def failed_sync(fd):
                if mode=='fsync' and matches(fd):hits.append(fd);raise OSError('UNIT frame fsync failure')
                return sync(fd)
            with mock.patch.object(m.os,'write',side_effect=short),mock.patch.object(m.os,'fsync',side_effect=failed_sync):out=exchange.run()
            child.communicate(timeout=3);self.assertTrue(hits);self.assertTrue((exchange.transcript.path/name).exists())
            if mode=='short':self.assertEqual((exchange.transcript.path/name).stat().st_size,7)
            self.assertFalse(out['originalFramesRetained']);self.assertTrue(out['cleanupDebt'])
            self.assertEqual(out['frameRetention'][name]['status'],'NOT_RETAINED');self.assertEqual(out['ackBytesSent'],0)
            self.assertIn('frame',out['firstCause']['message'])

    def test_keyboard_interrupt_retains_original_cause_and_propagates_without_ack(self):
        exchange,peer,ready=self.case();child=self.child(peer,ready)
        with mock.patch.object(exchange.ledger,'prepare_enrollment_pair',side_effect=KeyboardInterrupt('UNIT original interrupt')):
            with self.assertRaises(KeyboardInterrupt):exchange.run()
        child.communicate(timeout=3)
        stored=json.loads((exchange.transcript.path/'result.json').read_bytes())
        self.assertEqual(stored['firstCause']['type'],'KeyboardInterrupt');self.assertEqual(stored['ackBytesSent'],0)
        self.assert_pending(exchange)

    def test_audit_fixture_failure_retains_original_frames_and_typed_cause_after_cleanup(self):
        with mock.patch.object(m.d.DurableLedger,'prepare_enrollment_pair',side_effect=TimeoutError('UNIT original fixture interrupted')):
            with self.assertRaisesRegex(AssertionError,'TimeoutError'):self.audit_case()
        self.assertTrue(self.retain_originals)
        path=self.base/'case-1/frames/result.json';before=path.read_bytes()
        observed=json.loads(before)
        self.assertEqual(observed['firstCause']['type'],'TimeoutError')
        self.assertEqual(observed['ackBytesSent'],0);self.assertFalse(observed['nonceReleased'])
        self.doCleanups()
        self.assertEqual(path.read_bytes(),before)
        self.assertTrue((self.base/'case-1/original.sqlite').is_file())

    def audit_case(self):
        exchange,peer,ready=self.case();child=self.child(peer,ready);out=exchange.run()
        stdout,stderr=child.communicate(timeout=3)
        if child.returncode!=0 or out['firstCause'] is not None:
            # Keep this ORIGINAL controlled operation and its private frames;
            # a later fresh fixture is not a retry or evidence it succeeded.
            self.retain_originals=True
            cause=out['firstCause']
            self.fail(dict(childExit=child.returncode,
                firstCauseType=None if cause is None else cause['type'],
                firstCauseSHA256=None if cause is None else sha(raw(cause)),
                ackBytesSent=out['ackBytesSent'],originalFramesRetained=out['originalFramesRetained'],
                cleanupDebt=out['cleanupDebt'],controlledOriginalsRetained=True))
        exchange.ledger.close();artifact=exchange.ledger.artifact()
        def write(path,value):
            path.parent.mkdir(mode=0o700,parents=True,exist_ok=True);path.write_bytes(value);path.chmod(0o600)
        marker=dict(version='YNX-PQ-SYNTHETIC-ENROLLMENT-ATTEMPT/v1',sourceCommit=self.source,
            root=str(self.root),planSHA256=self.plan_pin,workloadSHA256=self.workload_pin,outcome='UNKNOWN')
        write(self.root/'SYNTHETIC-ENROLLMENT-ATTEMPT.json',raw(marker))
        write(self.root/'SYNTHETIC-ENROLLMENT-PEER-ACK.json',(exchange.transcript.path/'ack-intent.jsonl').read_bytes()[:-1])
        frame=json.loads((exchange.transcript.path/'request.jsonl').read_bytes());r=frame['request']
        # CONTROL byte relation only: these are not Core-authenticated outboxes.
        for role in ('funding','migration'):
            write(self.root/'workload/sender-public/0004'/r[role+'OperationId']/'request.json',raw(r))
        files={p.name:dict(bytes=p.stat().st_size,sha256=sha(p.read_bytes())) for p in exchange.transcript.path.iterdir()}
        for name in ('SYNTHETIC-ENROLLMENT-ATTEMPT.json','SYNTHETIC-ENROLLMENT-PEER-ACK.json'):
            value=(self.root/name).read_bytes();files[name]=dict(bytes=len(value),sha256=sha(value))
        args=dict(pins=exchange.pins,transcript=exchange.transcript.path,database=exchange.ledger.path,
            database_pin={k:artifact[k] for k in ('bytes','sha256','planSHA256')},file_pins=files,enabled=True)
        return exchange,args,r

    def test_stopped_peer_ack_and_both_outbox_requests_join_without_authority(self):
        exchange,args,r=self.audit_case();before=exchange.ledger.path.read_bytes()
        out=m.audit_private_reservation(**args)
        self.assertTrue(out['localPairReservationObserved'] and out['peerAckBytesMatch'] and out['bothOutboxRequestBytesMatch'])
        self.assertEqual(out['status'],'UNKNOWN');self.assertTrue(out['originalLedgerReadOnly'])
        self.assertFalse(out['durabilityReturnReconstructed'] or out['signingObserved'] or out['nonceReleased'] or out['sourceCIQualified'])
        self.assertEqual(before,exchange.ledger.path.read_bytes())

    def test_missing_peer_or_one_original_request_stays_unknown_without_recreation(self):
        exchange,args,r=self.audit_case();peer=self.root/'SYNTHETIC-ENROLLMENT-PEER-ACK.json';original=peer.read_bytes();peer.unlink()
        out=m.audit_private_reservation(**args)
        self.assertEqual(out['status'],'UNKNOWN');self.assertTrue(out['missingEvidence']);self.assertFalse(out['peerAckBytesMatch'])
        self.assertFalse(peer.exists());peer.write_bytes(original);peer.chmod(0o600)
        missing=self.root/'workload/sender-public/0004'/r['migrationOperationId']/'request.json';missing.unlink()
        out=m.audit_private_reservation(**args);self.assertTrue(out['peerAckBytesMatch'])
        self.assertFalse(out['bothOutboxRequestBytesMatch']);self.assertTrue(out['missingEvidence']);self.assertFalse(missing.exists())

    def test_independent_peer_ack_sha_and_request_identity_changes_are_rejected(self):
        exchange,args,r=self.audit_case();path=self.root/'SYNTHETIC-ENROLLMENT-PEER-ACK.json';old=path.read_bytes()
        changed=json.loads(old);changed['migrationOperationId']='d'*64;path.write_bytes(raw(changed))
        out=m.audit_private_reservation(**args);self.assertIn('file SHA',out['firstCause']['message'])
        args['file_pins'][path.name]=dict(bytes=path.stat().st_size,sha256=sha(path.read_bytes()))
        out=m.audit_private_reservation(**args);self.assertIn('peer ACK',out['firstCause']['message']);self.assertFalse(out['peerAckBytesMatch'])
        path.write_bytes(old);args['file_pins'][path.name]=dict(bytes=len(old),sha256=sha(old))
        target=self.root/'workload/sender-public/0004'/r['fundingOperationId']/'request.json';changed=copy.deepcopy(r);changed['fundingNonce']='3';target.write_bytes(raw(changed))
        out=m.audit_private_reservation(**args);self.assertIn('funding outbox',out['firstCause']['message']);self.assertFalse(out['bothOutboxRequestBytesMatch'])

    def test_wrong_database_pin_alias_or_private_mode_cannot_promote_join(self):
        exchange,args,r=self.audit_case();wrong=copy.deepcopy(args['database_pin']);wrong['sha256']='f'*64
        out=m.audit_private_reservation(**dict(args,database_pin=wrong))
        self.assertFalse(out['originalLedgerReadOnly']);self.assertIn('database SHA',out['firstCause']['message'])
        path=self.root/'SYNTHETIC-ENROLLMENT-PEER-ACK.json';path.chmod(0o644)
        out=m.audit_private_reservation(**args);self.assertIn('owner-only',out['firstCause']['message'])
        self.assertFalse(out['peerAckBytesMatch']);path.chmod(0o600)
        alias=path.with_name('alias');path.rename(alias);path.symlink_to(alias)
        out=m.audit_private_reservation(**args);self.assertFalse(out['peerAckBytesMatch']);self.assertIsNotNone(out['firstCause'])

    def test_original_exchange_failure_is_retained_and_not_reconstructed_as_ack_receipt(self):
        exchange,args,r=self.audit_case();path=exchange.transcript.path/'result.json';value=json.loads(path.read_bytes())
        value['ackSendCompleted']=False;value['firstCause']=dict(type='BrokenPipeError',message='UNIT original delivery uncertain')
        path.write_bytes(raw(value));args['file_pins'][path.name]=dict(bytes=path.stat().st_size,sha256=sha(path.read_bytes()))
        out=m.audit_private_reservation(**args)
        self.assertEqual(out['originalExchangeFirstCause'],value['firstCause']);self.assertTrue(out['peerAckBytesMatch'])
        self.assertFalse(out['ackReceiptObserved'] or out['durabilityReturnReconstructed'] or out['nonceReleased'])


if __name__=='__main__':unittest.main()
