"""Scheduling/transport controls, not validators, signatures or measured TPS."""
import concurrent.futures
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace
from unittest import mock


def module(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


s=module("load_scheduler_controls","pq-independent-scheduler.py")
driver=module("load_normal_controls","pq-independent-load.py")


def plan(count=10,accounts=2):
    return s.make_plan("a"*64,"b"*64,"online",[dict(ownerIndex=4+i,address="synthetic-control-"+str(i),nextNonce=2,capacity=count) for i in range(accounts)],100,count*10_000_000,50_000_000)


def event(ledger,row,kind,at,**fields):ledger.event(dict(kind=kind,index=row["index"],id=row["id"],atNs=at,**fields))


def qualified(ledger,row,at):
    # Structural callback fixture only; no fake node or math result is supplied
    # to a normal execution entry. This ledger never grants native authority.
    value=format(row["index"]+1,"064x");native=format(row["index"]+1000,"064x")
    event(ledger,row,"signed",at,hash=value,nativeHash=native)
    event(ledger,row,"submitted",at+1)
    event(ledger,row,"ack",at+2)
    event(ledger,row,"included",at+3)
    event(ledger,row,"qualified",at+4,hash=value,nativeHash=native,normalVerifierCode="VERIFIED_TRANSACTION_DATA",executionSuccessful=True,executionCode="0",transactionType="pq_transfer",members=1,nativeGrant=False,normalConfirmCode="PROOF_CONFIRMED_DATA",proofReference="CONTROL-ONLY-not-a-proof")


class IndependentLoadControls(unittest.TestCase):
    def test_fixed_arrival_full_denominator_and_no_mode_mixing(self):
        p=plan();self.assertEqual(len(p["rows"]),10);self.assertEqual(p["rows"][-1]["logicalArrivalOffsetNs"],90_000_000)
        self.assertEqual(len({r["id"] for r in p["rows"]}),10)
        ledger=s.Ledger(p,lambda e:None);ledger.release(200_000_000)
        r=ledger.report(210_000_000)
        self.assertEqual(r["configuredDemand"],10);self.assertEqual(r["releasedWithinWindow"],0)
        self.assertEqual(r["notSubmitted"],10);self.assertTrue(all(x>=110 for x in r["releaseLagMs"]))
        self.assertEqual(r["actualQualifiedWindowTPS"],0);self.assertEqual(r["P95FinalConfirmation"],"UNMEASURED")
        with self.assertRaises(ValueError):s.make_plan("a"*64,"b"*64,"mixed",p["accounts"],100,100_000_000,50_000_000)

    def test_one_pending_nonce_only_verified_owner_advances_unknown_is_retained(self):
        ledger=s.Ledger(plan(),lambda e:None);ledger.release(100_000_000)
        first,_=ledger.reserve(100_000_000);second,_=ledger.reserve(100_000_000)
        self.assertNotEqual(first["ownerIndex"],second["ownerIndex"]);self.assertIsNone(ledger.reserve(100_000_000))
        event(ledger,first,"unknown",100_000_010,error="original uncertain operation")
        account=ledger.accounts[first["ownerIndex"]]
        self.assertEqual(account["pending"],first["index"]);self.assertTrue(account["quarantined"]);self.assertEqual(account["nextNonce"],2)
        qualified(ledger,second,100_000_020)
        next_row,_=ledger.reserve(100_000_030)
        self.assertEqual(next_row["ownerIndex"],second["ownerIndex"]);self.assertEqual(next_row["nonce"],3)
        self.assertNotEqual(next_row["operationId"],second["operationId"])

    def test_full_cohort_quantiles_do_not_drop_failed_or_unsent_demand(self):
        ledger=s.Ledger(plan(accounts=10),lambda e:None);ledger.release(100_000_000)
        for i in range(4):row,_=ledger.reserve(100_000_000);qualified(ledger,row,100_000_010+i*10)
        report=ledger.report(150_000_000);q=report["submitToQualifiedReceiptObserved"]
        self.assertEqual(q["denominator"],10);self.assertEqual(q["observed"],4);self.assertEqual(q["censored"],6)
        self.assertIsNone(q["p50Ms"]);self.assertIsNone(q["p95Ms"]);self.assertIsNone(q["p99Ms"])
        self.assertEqual(report["qualifiedWithinWindow"],0);self.assertEqual(report["qualifiedInTail"],4)

    def test_partial_wrong_type_or_native_grant_cannot_release_original_account(self):
        for field,value in (("executionCode","1"),("nativeGrant",True),("transactionType","pq_whole"),("members",16),("normalConfirmCode","ACK")):
            ledger=s.Ledger(plan(),lambda e:None);ledger.release(100_000_000);row,_=ledger.reserve(100_000_000)
            event(ledger,row,"signed",100_000_001,hash="c"*64,nativeHash="d"*64)
            event(ledger,row,"submitted",100_000_002);event(ledger,row,"included",100_000_003)
            fields=dict(hash="c"*64,nativeHash="d"*64,normalVerifierCode="VERIFIED_TRANSACTION_DATA",executionSuccessful=True,executionCode="0",transactionType="pq_transfer",members=1,nativeGrant=False,normalConfirmCode="PROOF_CONFIRMED_DATA",proofReference="CONTROL-ONLY")
            fields[field]=value
            with self.subTest(field=field),self.assertRaises(ValueError):event(ledger,row,"qualified",100_000_004,**fields)
            self.assertEqual(ledger.accounts[row["ownerIndex"]]["pending"],row["index"])
            self.assertEqual(ledger.accounts[row["ownerIndex"]]["nextNonce"],2)

    def test_real_clock_generator_does_not_wait_for_blocked_account_callbacks(self):
        class BlockedNormalCalleeControl:
            def perform(self,row,account,notify,stop):stop.wait();raise RuntimeError("control-only bounded cancellation")
            def stop(self):pass
        result=s.run(plan(count=20),BlockedNormalCalleeControl(),lambda e:None,lambda:None,threading.Event())
        self.assertEqual(result["configuredDemand"],20);self.assertEqual(result["logicalReleased"],20)
        self.assertEqual(result["submitted"],0);self.assertEqual(result["notQualified"],20)
        self.assertEqual(result["actualSubmissionAttemptTPS"],0);self.assertEqual(result["actualSourceEvidencedTPS"],0)
        self.assertEqual(result["terminalCounts"]["unknown"],2)
        self.assertEqual(int(result["offeredWindowEndMonotonicNs"])-int(result["originMonotonicNs"]),result["windowNs"])
        self.assertTrue(all(a["quarantined"] and a["pending"] is not None for a in result["accountState"]))

    def test_durable_controller_io_does_not_backdate_or_block_arrival_clock(self):
        clocks=[];blocked_until=[]
        class ObservedClock(s.ArrivalClock):
            def __init__(self,*args):super().__init__(*args);clocks.append(self)
        class BlockedCallee:
            def perform(self,row,account,notify,stop):stop.wait()
            def stop(self):pass
        def durable_emit(value):
            if value["kind"]=="logical_release" and not blocked_until:
                # Real scheduler thread continues while the controller is
                # blocked in a durable callback; no chain result is mocked.
                clocks[0].thread.join(timeout=1)
                self.assertFalse(clocks[0].thread.is_alive())
                blocked_until.append(time.monotonic_ns()-clocks[0].origin)
        with mock.patch.object(s,"ArrivalClock",ObservedClock):
            result=s.run(plan(count=5),BlockedCallee(),durable_emit,lambda:None,threading.Event())
        actual=[r["releasedNs"] for r in result["rows"]]
        self.assertEqual(actual,clocks[0].offsets)
        self.assertTrue(all(at<blocked_until[0] for at in actual))
        self.assertEqual(result["notSubmitted"],5)

    def test_unresolved_stage_is_censored_and_account_wait_is_separate(self):
        ledger=s.Ledger(plan(),lambda e:None);ledger.release(100_000_000)
        row,_=ledger.reserve(120_000_000)
        event(ledger,row,"normal_stage",130_000_000,stage="checkpoint")
        event(ledger,row,"normal_stage",150_000_000,stage="signer")
        event(ledger,row,"unknown",180_000_000,error="signer outcome unresolved")
        report=ledger.report(200_000_000)
        self.assertEqual(report["completedStageIntervals"]["checkpoint"]["totalNs"],20_000_000)
        self.assertNotIn("signer",report["completedStageIntervals"])
        self.assertEqual(report["releaseToAccountClaim"]["observed"],1)
        self.assertIsNone(report["releaseToAccountClaim"]["p95Ms"])

    def test_duplicate_original_never_reaches_http_or_second_intent(self):
        backend=object.__new__(driver.NormalBackend);backend.submit_lock=threading.Lock();backend.attempted={"a"*64}
        with tempfile.TemporaryDirectory() as temporary,mock.patch.object(driver.urllib.request,"build_opener") as opened:
            path=Path(temporary)
            with self.assertRaisesRegex(RuntimeError,"already attempted"):
                backend.broadcast_and_include({},dict(abciHash="0x"+"a"*64),b"not-used",path,lambda e:None,threading.Event())
            opened.assert_not_called();self.assertEqual(list(path.iterdir()),[])

    def test_original_capacity_and_higher_level_require_complete_actual_prior(self):
        args=SimpleNamespace(mode="pre-signed",rate=100,accounts=100,per_account=5,seconds=5,tail_seconds=30,proof_timeout=30)
        self.assertEqual(driver.validate_options(args),500)
        args.seconds=60
        with self.assertRaises(RuntimeError):driver.validate_options(args)
        args.rate=500;args.prior_result=None;args.prior_result_sha256=None
        with self.assertRaisesRegex(RuntimeError,"preceding level"):driver.validate_escalation(args)

    def test_durable_event_segments_never_overwrite_or_drop_the_full_sequence(self):
        with tempfile.TemporaryDirectory() as temporary,mock.patch.dict(driver.lab.CAPS,logBytes=128):
            path=Path(temporary)/"events.jsonl";journal=driver.Journal(path)
            expected=[dict(index=i,kind="account_claim",logicalId=str(i)*8) for i in range(12)]
            for row in expected:journal.emit(row)
            journal.close()
            self.assertGreater(len(journal.paths),1)
            actual=[]
            for p in journal.paths:
                self.assertLessEqual(p.stat().st_size,128)
                actual.extend(json.loads(line) for line in p.read_text().splitlines())
            self.assertEqual(actual,expected)
            with self.assertRaises(FileExistsError):driver.Journal(path)

    def test_retired_cli_logs_release_fds_but_keep_original_inode_guard(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/".private").mkdir();(root/"public").mkdir()
            with mock.patch.object(driver.lab.os,"sched_getaffinity",return_value={0},create=True),mock.patch.object(driver.lab.os,"sched_setaffinity",create=True):
                window=driver.lab.Window(root,root)
            path=root/"public/finished.log";log=path.open("xb",buffering=0);log.write(b"original")
            process=SimpleNamespace(poll=lambda:0)
            window.logs.append(("finished",log));window.children.append(dict(name="finished",process=process,persistent=False))
            window.retire_log(process);self.assertTrue(log.closed)
            with mock.patch.object(driver.lab.guard,"proc_inventory",return_value=({},None)),mock.patch.object(driver.lab.guard,"owned_set",return_value=set()):
                window.sample()
                replacement=root/"public/replacement";replacement.write_bytes(b"original");os.replace(replacement,path)
                with self.assertRaisesRegex(RuntimeError,"log identity changed"):window.sample()

    @unittest.skipUnless(sys.platform=="linux","real inherited affinity/rlimit and /proc require original hosted Linux job")
    def test_real_worker_thread_spawn_keeps_limits_and_stdin_without_preexec(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/".private").mkdir();(root/"public").mkdir()
            window=driver.lab.Window(Path(__file__).resolve().parents[2],root)
            script="import json,os,resource,sys; assert sorted(os.sched_getaffinity(0))==json.loads(sys.argv[1]); assert resource.getrlimit(resource.RLIMIT_FSIZE)==(int(sys.argv[2]),)*2; assert sys.stdin.buffer.readline()==b'control\\n'"
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                p=pool.submit(window.launch,"actual-thread-limits",[sys.executable,"-I","-c",script,json.dumps(window.cpus),str(driver.lab.CAPS["newBytes"])],stdin_pipe=True,thread_safe=True).result(timeout=5)
                p.stdin.write(b"control\n");p.stdin.flush();p.stdin.close()
                try:self.assertEqual(window.wait(p),0)
                finally:self.assertTrue(window.stop())


if __name__=="__main__":unittest.main()
